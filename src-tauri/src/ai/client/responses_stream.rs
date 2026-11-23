use crate::ai::types::{
    AiChatRequest, AiTransport, ApiResponsesRequest, ChunkKind, ResponsesInputItem,
};
use futures::StreamExt;
use tauri::Runtime;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::reasoning::{reasoning_effort_level, should_fallback_from_responses_status};
use super::responses_text::{
    extract_responses_content_text_for_event, extract_responses_error_message,
    extract_responses_reasoning_text_for_event, is_chat_completions_style_payload,
    is_responses_completion_event, is_responses_failure_event, merge_responses_event_type,
    responses_event_response_id,
};
use super::{
    HttpTarget, ResponsesStreamError, STREAM_CANCELLED_MESSAGE, StreamEmitter,
    build_streaming_client, is_flush_due, read_error_body, take_complete_line,
};

const REASONING_DONE_EVENTS: [&str; 3] = [
    "response.reasoning_summary_text.done",
    "response.reasoning_summary_part.done",
    "response.reasoning_text.done",
];
const RESPONSE_COMPLETED_EVENT: &str = "response.completed";

fn last_assistant_index(request: &AiChatRequest) -> Option<usize> {
    request
        .messages
        .iter()
        .rposition(|message| message.role == "assistant")
}

pub fn responses_input_items(request: &AiChatRequest) -> Vec<ResponsesInputItem> {
    let all_items = || {
        request
            .messages
            .iter()
            .map(ResponsesInputItem::from)
            .collect()
    };
    if request.previous_response_id.is_none() {
        return all_items();
    }
    let start_index = last_assistant_index(request).map_or(0, |index| index + 1);
    let incremental_items: Vec<ResponsesInputItem> = request.messages[start_index..]
        .iter()
        .filter(|message| message.role != "assistant")
        .map(ResponsesInputItem::from)
        .collect();
    if !incremental_items.is_empty() {
        return incremental_items;
    }
    all_items()
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ResponsesPayloadOutcome {
    Continue,
    Done,
}

struct ResponsesStreamState {
    response_id: Option<String>,
    saw_valid_responses_payload: bool,
    saw_streamed_output_text: bool,
    saw_streamed_reasoning: bool,
    thinking_buffer: String,
    content_buffer: String,
    last_flush: Instant,
}

impl ResponsesStreamState {
    fn new() -> Self {
        Self {
            response_id: None,
            saw_valid_responses_payload: false,
            saw_streamed_output_text: false,
            saw_streamed_reasoning: false,
            thinking_buffer: String::new(),
            content_buffer: String::new(),
            last_flush: Instant::now(),
        }
    }

    fn stream_error(&self, message: impl Into<String>) -> ResponsesStreamError {
        ResponsesStreamError::new(message, !self.saw_valid_responses_payload)
    }
}

struct ResponsesSseEvent<'a> {
    json: &'a serde_json::Value,
    event_type: Option<&'a str>,
}

fn is_recognised_responses_payload(event: &ResponsesSseEvent<'_>) -> bool {
    let json = event.json;
    is_responses_completion_event(event.event_type)
        || extract_responses_error_message(json).is_some()
        || json.get("response").is_some()
        || json.get("response_id").is_some()
}

fn check_payload_errors(event: &ResponsesSseEvent<'_>) -> Result<(), ResponsesStreamError> {
    if is_chat_completions_style_payload(event.json) {
        return Err(ResponsesStreamError::new(
            "Responses endpoint returned chat-completions-style stream payload",
            true,
        ));
    }
    let failure_message = extract_responses_error_message(event.json)
        .filter(|_| is_responses_failure_event(event.event_type));
    match failure_message {
        Some(message) => Err(ResponsesStreamError::new(message, false)),
        None => Ok(()),
    }
}

struct ResponsesStream<'a, R: Runtime> {
    emitter: StreamEmitter<'a, R>,
    enable_reasoning: bool,
    state: ResponsesStreamState,
    current_event_type: Option<String>,
    line_buffer: String,
}

impl<R: Runtime> ResponsesStream<'_, R> {
    fn flush_all(&mut self) {
        let state = &mut self.state;
        self.emitter
            .flush_both_buffers(&mut state.thinking_buffer, &mut state.content_buffer);
    }

    fn record_metadata(&mut self, event: &ResponsesSseEvent<'_>) {
        if is_recognised_responses_payload(event) {
            self.state.saw_valid_responses_payload = true;
        }
        if let Some(id) = responses_event_response_id(event.json) {
            self.state.response_id = Some(id.to_string());
        }
    }

    fn append_reasoning(&mut self, event: &ResponsesSseEvent<'_>) {
        let state = &mut self.state;
        let reasoning_text = extract_responses_reasoning_text_for_event(
            event.event_type,
            event.json,
            state.saw_streamed_reasoning,
        );
        let has_reasoning_text = self.enable_reasoning && !reasoning_text.is_empty();
        if has_reasoning_text {
            state.thinking_buffer.push_str(&reasoning_text);
            state.saw_streamed_reasoning = true;
            state.saw_valid_responses_payload = true;
        }
        let ends_reasoning = event
            .event_type
            .is_some_and(|event_type| REASONING_DONE_EVENTS.contains(&event_type));
        if ends_reasoning {
            state.saw_valid_responses_payload = true;
            self.emitter
                .flush_buffer(&mut state.thinking_buffer, ChunkKind::Thinking);
        }
    }

    fn append_content(&mut self, event: &ResponsesSseEvent<'_>) {
        let state = &mut self.state;
        let text_to_append = extract_responses_content_text_for_event(
            event.event_type,
            event.json,
            state.saw_streamed_output_text,
        );
        if !text_to_append.is_empty() {
            state.saw_streamed_output_text = true;
        }
        state.content_buffer.push_str(&text_to_append);
    }

    fn flush_if_due(&mut self) {
        if !is_flush_due(self.state.last_flush) {
            return;
        }
        self.flush_all();
        self.state.last_flush = Instant::now();
    }

    fn process_payload(
        &mut self,
        sse_event_type: Option<&str>,
        json: &serde_json::Value,
    ) -> Result<ResponsesPayloadOutcome, ResponsesStreamError> {
        let event = ResponsesSseEvent {
            json,
            event_type: merge_responses_event_type(sse_event_type, json),
        };
        check_payload_errors(&event)?;
        self.record_metadata(&event);
        self.append_reasoning(&event);
        self.append_content(&event);
        self.flush_if_due();
        if event.event_type != Some(RESPONSE_COMPLETED_EVENT) {
            return Ok(ResponsesPayloadOutcome::Continue);
        }
        self.flush_all();
        Ok(ResponsesPayloadOutcome::Done)
    }

    fn process_data(
        &mut self,
        data: &str,
    ) -> Result<ResponsesPayloadOutcome, ResponsesStreamError> {
        let json: serde_json::Value = serde_json::from_str(data.trim()).map_err(|error| {
            self.state
                .stream_error(format!("Failed to parse SSE JSON: {error}"))
        })?;
        let event_type = self.current_event_type.clone();
        self.process_payload(event_type.as_deref(), &json)
    }

    fn handle_line(&mut self, line: &str) -> Result<ResponsesPayloadOutcome, ResponsesStreamError> {
        let trimmed = line.trim();
        let is_blank_or_comment_line = trimmed.is_empty() || trimmed.starts_with(':');
        if is_blank_or_comment_line {
            return Ok(ResponsesPayloadOutcome::Continue);
        }
        if let Some(event_type) = trimmed.strip_prefix("event:") {
            self.current_event_type = Some(event_type.trim().to_string());
            return Ok(ResponsesPayloadOutcome::Continue);
        }
        let Some(data) = trimmed.strip_prefix("data:") else {
            return Ok(ResponsesPayloadOutcome::Continue);
        };
        let outcome = self.process_data(data)?;
        self.current_event_type = None;
        Ok(outcome)
    }

    fn cancel(&mut self) -> Result<(), ResponsesStreamError> {
        self.flush_all();
        Err(ResponsesStreamError::new(STREAM_CANCELLED_MESSAGE, false))
    }

    fn read_failed(&mut self, error: reqwest::Error) -> ResponsesStreamError {
        self.flush_all();
        self.state
            .stream_error(format!("Stream read error: {error}"))
    }

    fn complete(&mut self) {
        self.emitter
            .emit_done(self.state.response_id.clone(), AiTransport::Responses);
    }

    fn finish(&mut self) -> Result<(), ResponsesStreamError> {
        let residual = std::mem::take(&mut self.line_buffer);
        let residual_outcome = match residual.trim().strip_prefix("data:") {
            Some(data) => self.process_data(data)?,
            None => ResponsesPayloadOutcome::Continue,
        };
        if residual_outcome != ResponsesPayloadOutcome::Done {
            return Err(self
                .state
                .stream_error("Responses stream ended before response.completed"));
        }
        self.flush_all();
        self.complete();
        Ok(())
    }
}

fn drain_complete_lines<R: Runtime>(
    stream: &mut ResponsesStream<'_, R>,
    bytes: &[u8],
) -> Result<ResponsesPayloadOutcome, ResponsesStreamError> {
    stream.line_buffer.push_str(&String::from_utf8_lossy(bytes));
    while let Some(line) = take_complete_line(&mut stream.line_buffer) {
        if stream.handle_line(&line)? == ResponsesPayloadOutcome::Done {
            stream.complete();
            return Ok(ResponsesPayloadOutcome::Done);
        }
    }
    Ok(ResponsesPayloadOutcome::Continue)
}

async fn consume_responses_stream<R: Runtime>(
    stream: &mut ResponsesStream<'_, R>,
    response: reqwest::Response,
    cancellation_token: &CancellationToken,
) -> Result<(), ResponsesStreamError> {
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
        if drain_complete_lines(stream, &bytes)? == ResponsesPayloadOutcome::Done {
            return Ok(());
        }
    }
}

fn build_responses_request(request: &AiChatRequest) -> ApiResponsesRequest {
    ApiResponsesRequest {
        model: request.model.clone(),
        input: responses_input_items(request),
        temperature: request.temperature,
        max_output_tokens: request.max_tokens,
        stream: true,
        previous_response_id: request.previous_response_id.clone(),
        reasoning: Some(crate::ai::types::ReasoningConfig {
            effort: reasoning_effort_level(request.enable_reasoning).to_string(),
            summary: request.enable_reasoning.then(|| "auto".to_string()),
        }),
        reasoning_effort: None,
    }
}

struct ResponsesSend<'a> {
    target: &'a HttpTarget<'a>,
    request: &'a AiChatRequest,
    cancellation_token: &'a CancellationToken,
}

async fn send_responses_request(
    send: &ResponsesSend<'_>,
    api_request: &ApiResponsesRequest,
) -> Result<reqwest::Response, ResponsesStreamError> {
    let target = send.target;
    tokio::select! {
        biased;
        _ = send.cancellation_token.cancelled() => {
            Err(ResponsesStreamError::new(STREAM_CANCELLED_MESSAGE, false))
        }
        result = target.client.post(target.url).json(api_request).send() => {
            result.map_err(|error| ResponsesStreamError::new(format!("HTTP request failed: {error}"), true))
        }
    }
}

async fn send_responses_with_reasoning_retry(
    send: &ResponsesSend<'_>,
    api_request: &ApiResponsesRequest,
) -> Result<reqwest::Response, ResponsesStreamError> {
    let response = send_responses_request(send, api_request).await?;
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = read_error_body(response).await;
    if !should_fallback_from_responses_status(status, &body) {
        return Err(ResponsesStreamError::new(
            format!("HTTP {status}: {body}"),
            status.is_server_error(),
        ));
    }
    tracing::warn!(
        endpoint = %send.request.endpoint,
        model = %send.request.model,
        status = %status,
        "responses endpoint rejected reasoning config; retrying without reasoning"
    );

    let retry_request = ApiResponsesRequest {
        reasoning: None,
        ..api_request.clone()
    };
    let response = send_responses_request(send, &retry_request).await?;
    let retry_status = response.status();
    if retry_status.is_success() {
        return Ok(response);
    }
    let retry_body = read_error_body(response).await;
    let should_fallback = retry_status.is_server_error()
        || should_fallback_from_responses_status(retry_status, &retry_body);
    Err(ResponsesStreamError::new(
        format!("HTTP {retry_status}: {retry_body}"),
        should_fallback,
    ))
}

pub(super) async fn stream_responses_completion<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    request: &AiChatRequest,
    cancellation_token: &CancellationToken,
) -> Result<(), ResponsesStreamError> {
    let api_request = build_responses_request(request);
    let client = build_streaming_client().map_err(|error| {
        ResponsesStreamError::new(format!("Failed to create HTTP client: {error}"), false)
    })?;
    let responses_url = crate::ai::url::normalise_to_responses_url(&request.endpoint);
    let responses_target = HttpTarget {
        client: &client,
        url: &responses_url,
    };
    let send = ResponsesSend {
        target: &responses_target,
        request,
        cancellation_token,
    };
    let response = send_responses_with_reasoning_retry(&send, &api_request).await?;

    let mut stream = ResponsesStream {
        emitter: StreamEmitter {
            app_handle,
            stream_id: &request.stream_id,
        },
        enable_reasoning: request.enable_reasoning,
        state: ResponsesStreamState::new(),
        current_event_type: None,
        line_buffer: String::new(),
    };
    consume_responses_stream(&mut stream, response, cancellation_token).await
}
