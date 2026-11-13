use crate::ai::types::{
    parse_sse_line, AiChatRequest, AiTransport, ApiChatRequest, ApiMessage, ApiStreamChunk,
    SseParsed,
};
use futures::StreamExt;
use tauri::Runtime;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::reasoning::{
    apply_no_think_to_last_user_message, chat_reasoning_compat_fields, reasoning_effort_level,
    should_retry_chat_without_reasoning, ChatReasoningCompat,
};
use super::{
    build_streaming_client, is_flush_due, normalise_to_chat_completions_url, read_error_body,
    take_complete_line, HttpTarget, StreamEmitter, STREAM_CANCELLED_MESSAGE,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum LineOutcome {
    Continue,
    Done,
}

fn build_chat_request(request: &AiChatRequest) -> ApiChatRequest {
    let ChatReasoningCompat {
        enable_thinking,
        chat_template_kwargs,
    } = chat_reasoning_compat_fields(request.enable_reasoning);
    let mut api_request = ApiChatRequest {
        model: request.model.clone(),
        messages: request.messages.iter().map(ApiMessage::from).collect(),
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: true,
        reasoning_effort: Some(reasoning_effort_level(request.enable_reasoning).to_string()),
        enable_thinking,
        chat_template_kwargs,
    };
    if !request.enable_reasoning {
        apply_no_think_to_last_user_message(&mut api_request.messages);
    }
    api_request
}

struct ChatSend<'a> {
    target: &'a HttpTarget<'a>,
    request: &'a AiChatRequest,
    cancellation_token: &'a CancellationToken,
}

async fn send_chat_request(
    send: &ChatSend<'_>,
    api_request: &ApiChatRequest,
) -> Result<reqwest::Response, String> {
    let target = send.target;
    tokio::select! {
        biased;
        _ = send.cancellation_token.cancelled() => Err(STREAM_CANCELLED_MESSAGE.to_string()),
        result = target.client.post(target.url).json(api_request).send() => {
            result.map_err(|error| format!("HTTP request failed: {error}"))
        }
    }
}

async fn send_chat_with_reasoning_retry(
    send: &ChatSend<'_>,
    api_request: &ApiChatRequest,
) -> Result<reqwest::Response, String> {
    let response = send_chat_request(send, api_request).await?;
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = read_error_body(response).await;
    let can_retry_without_reasoning = api_request.reasoning_effort.is_some()
        && should_retry_chat_without_reasoning(status, &body);
    if !can_retry_without_reasoning {
        return Err(format!("HTTP {status}: {body}"));
    }
    let request = send.request;
    if !request.enable_reasoning {
        return Err(format!(
            "Provider rejected reasoning disable parameter reasoning_effort=none; cannot safely disable thinking for this endpoint/model. HTTP {status}: {body}"
        ));
    }
    tracing::warn!(
        endpoint = %request.endpoint,
        model = %request.model,
        status = %status,
        "chat completions endpoint rejected reasoning_effort; retrying without it"
    );

    let retry_request = ApiChatRequest {
        reasoning_effort: None,
        ..api_request.clone()
    };
    let response = send_chat_request(send, &retry_request).await?;
    let retry_status = response.status();
    if retry_status.is_success() {
        return Ok(response);
    }
    let retry_body = read_error_body(response).await;
    Err(format!("HTTP {retry_status}: {retry_body}"))
}

struct ChatStream<'a, R: Runtime> {
    emitter: StreamEmitter<'a, R>,
    enable_reasoning: bool,
    content_buffer: String,
    thinking_buffer: String,
    line_buffer: String,
    last_flush: Instant,
}

impl<R: Runtime> ChatStream<'_, R> {
    fn flush_all(&mut self) {
        self.emitter
            .flush_both_buffers(&mut self.thinking_buffer, &mut self.content_buffer);
    }

    fn complete(&mut self) {
        self.flush_all();
        self.emitter.emit_done(None, AiTransport::ChatCompletions);
    }

    fn cancel(&mut self) -> Result<(), String> {
        self.flush_all();
        Err(STREAM_CANCELLED_MESSAGE.to_string())
    }

    fn read_failed(&mut self, error: reqwest::Error) -> String {
        self.flush_all();
        format!("Stream read error: {error}")
    }

    fn parse_failed(&mut self, error: String) -> Result<LineOutcome, String> {
        self.flush_all();
        Err(error)
    }

    /// Accumulate reasoning fields into the thinking buffer when reasoning is enabled.
    fn accumulate_thinking(&mut self, chunk: &ApiStreamChunk) {
        if !self.enable_reasoning {
            return;
        }
        let reasoning_parts = chunk
            .choices
            .iter()
            .flat_map(|choice| [&choice.delta.reasoning_content, &choice.delta.thinking])
            .flatten();
        for text in reasoning_parts {
            self.thinking_buffer.push_str(text);
        }
    }

    fn accumulate_content(&mut self, chunk: &ApiStreamChunk) {
        let enable_reasoning = self.enable_reasoning;
        let visible_contents = chunk.choices.iter().filter_map(|choice| {
            let content = choice.delta.content.as_deref()?;
            let reasoning_text = choice
                .delta
                .reasoning_content
                .as_deref()
                .or(choice.delta.thinking.as_deref());
            let is_reasoning_dup =
                enable_reasoning && reasoning_text.is_some_and(|text| text == content);
            (!is_reasoning_dup).then_some(content)
        });
        for content in visible_contents {
            self.content_buffer.push_str(content);
        }
    }

    fn append_chunk(&mut self, chunk: &ApiStreamChunk) {
        self.accumulate_thinking(chunk);
        self.accumulate_content(chunk);
    }

    fn flush_if_due(&mut self) {
        if !is_flush_due(self.last_flush) {
            return;
        }
        self.flush_all();
        self.last_flush = Instant::now();
    }

    fn handle_line(&mut self, line: &str) -> Result<LineOutcome, String> {
        match parse_sse_line(line) {
            Ok(SseParsed::Chunk(chunk)) => {
                self.append_chunk(&chunk);
                self.flush_if_due();
                Ok(LineOutcome::Continue)
            }
            Ok(SseParsed::Done) => {
                self.complete();
                Ok(LineOutcome::Done)
            }
            Ok(SseParsed::Skip) => Ok(LineOutcome::Continue),
            Err(error) => {
                tracing::error!(stream_id = %self.emitter.stream_id, error = %error, "SSE parse error");
                self.parse_failed(error)
            }
        }
    }

    fn handle_residual_line(&mut self, line: &str) -> Result<LineOutcome, String> {
        match parse_sse_line(line) {
            Ok(SseParsed::Chunk(chunk)) => {
                self.append_chunk(&chunk);
                Ok(LineOutcome::Continue)
            }
            Ok(SseParsed::Done | SseParsed::Skip) => Ok(LineOutcome::Continue),
            Err(error) => {
                tracing::error!(stream_id = %self.emitter.stream_id, error = %error, "SSE parse error on residual buffer");
                self.parse_failed(error)
            }
        }
    }

    fn finish(&mut self) -> Result<(), String> {
        let remaining = std::mem::take(&mut self.line_buffer);
        if !remaining.is_empty() {
            self.handle_residual_line(&remaining)?;
        }
        self.complete();
        Ok(())
    }
}

fn drain_complete_lines<R: Runtime>(
    stream: &mut ChatStream<'_, R>,
    bytes: &[u8],
) -> Result<LineOutcome, String> {
    stream.line_buffer.push_str(&String::from_utf8_lossy(bytes));
    while let Some(line) = take_complete_line(&mut stream.line_buffer) {
        if stream.handle_line(&line)? == LineOutcome::Done {
            return Ok(LineOutcome::Done);
        }
    }
    Ok(LineOutcome::Continue)
}

async fn consume_chat_stream<R: Runtime>(
    stream: &mut ChatStream<'_, R>,
    response: reqwest::Response,
    cancellation_token: &CancellationToken,
) -> Result<(), String> {
    let mut byte_stream = response.bytes_stream();
    loop {
        let chunk_result = tokio::select! {
            biased;
            _ = cancellation_token.cancelled() => return stream.cancel(),
            chunk = byte_stream.next() => chunk,
        };
        let Some(chunk) = chunk_result else {
            return stream.finish();
        };
        let bytes = chunk.map_err(|error| stream.read_failed(error))?;
        if drain_complete_lines(stream, &bytes)? == LineOutcome::Done {
            return Ok(());
        }
    }
}

pub(super) async fn stream_chat_inner<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    request: &AiChatRequest,
    cancellation_token: &CancellationToken,
) -> Result<(), String> {
    let api_request = build_chat_request(request);
    let client = build_streaming_client()
        .map_err(|error| format!("Failed to create HTTP client: {error}"))?;
    let chat_url = normalise_to_chat_completions_url(&request.endpoint);
    let chat_target = HttpTarget {
        client: &client,
        url: &chat_url,
    };
    let send = ChatSend {
        target: &chat_target,
        request,
        cancellation_token,
    };
    let response = send_chat_with_reasoning_retry(&send, &api_request).await?;

    let mut stream = ChatStream {
        emitter: StreamEmitter {
            app_handle,
            stream_id: &request.stream_id,
        },
        enable_reasoning: request.enable_reasoning,
        content_buffer: String::new(),
        thinking_buffer: String::new(),
        line_buffer: String::new(),
        last_flush: Instant::now(),
    };
    consume_chat_stream(&mut stream, response, cancellation_token).await
}
