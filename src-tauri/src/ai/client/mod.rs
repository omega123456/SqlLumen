use crate::ai::types::{
    AiChatRequest, AiTransport, ChunkKind, StreamChunkEvent, StreamDoneEvent, StreamErrorEvent,
};
use std::time::Duration;
use tauri::{Emitter, Runtime};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

mod chat_stream;
mod reasoning;
mod responses_stream;
mod responses_text;

pub use reasoning::{
    append_no_think_directive, apply_no_think_to_json_messages,
    apply_no_think_to_last_user_message, apply_reasoning_off_compatibility,
    should_fallback_from_responses_status, should_retry_chat_without_reasoning,
};
pub use responses_stream::responses_input_items;
pub use responses_text::{
    extract_reasoning_text_from_item, extract_reasoning_text_from_parts,
    extract_responses_content_text_for_event, extract_responses_delta_text,
    extract_responses_error_message, extract_responses_final_text,
    extract_responses_reasoning_text, extract_responses_reasoning_text_for_event,
    is_chat_completions_style_payload, is_responses_completion_event, is_responses_failure_event,
    merge_responses_event_type,
};

const FLUSH_INTERVAL: Duration = Duration::from_millis(50);

const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

const REQUEST_TIMEOUT: Duration = Duration::from_secs(330);

const STREAM_CANCELLED_MESSAGE: &str = "Stream cancelled";
const UNREADABLE_BODY_PLACEHOLDER: &str = "<failed to read body>";

#[derive(Debug)]
struct ResponsesStreamError {
    message: String,
    fallback_to_chat_completions: bool,
}

impl ResponsesStreamError {
    fn new(message: impl Into<String>, fallback_to_chat_completions: bool) -> Self {
        Self {
            message: message.into(),
            fallback_to_chat_completions,
        }
    }
}

pub fn normalise_to_chat_completions_url(base_url: &str) -> String {
    crate::ai::url::normalise_openai_url(base_url, "chat/completions")
}

pub fn should_use_responses_api(request: &AiChatRequest) -> bool {
    request.prefer_responses_api && request.enable_reasoning
}

fn is_flush_due(last_flush: Instant) -> bool {
    last_flush.elapsed() >= FLUSH_INTERVAL
}

fn build_streaming_client() -> Result<reqwest::Client, reqwest::Error> {
    crate::http_client_builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
}

async fn read_error_body(response: reqwest::Response) -> String {
    response
        .text()
        .await
        .unwrap_or_else(|_| UNREADABLE_BODY_PLACEHOLDER.to_string())
}

fn take_complete_line(line_buffer: &mut String) -> Option<String> {
    let newline_pos = line_buffer.find('\n')?;
    let line = line_buffer[..newline_pos].to_string();
    line_buffer.drain(..=newline_pos);
    Some(line)
}

struct StreamEmitter<'a, R: Runtime> {
    app_handle: &'a tauri::AppHandle<R>,
    stream_id: &'a str,
}

impl<R: Runtime> StreamEmitter<'_, R> {
    fn emit_chunk(&self, content: String, kind: ChunkKind) {
        let _ = self.app_handle.emit(
            "ai-stream-chunk",
            StreamChunkEvent {
                stream_id: self.stream_id.to_string(),
                content,
                kind,
            },
        );
    }

    fn emit_done(&self, response_id: Option<String>, transport: AiTransport) {
        let _ = self.app_handle.emit(
            "ai-stream-done",
            StreamDoneEvent {
                stream_id: self.stream_id.to_string(),
                response_id,
                transport,
            },
        );
    }

    fn flush_buffer(&self, buffer: &mut String, kind: ChunkKind) {
        if !buffer.is_empty() {
            self.emit_chunk(std::mem::take(buffer), kind);
        }
    }

    fn flush_both_buffers(&self, thinking_buffer: &mut String, content_buffer: &mut String) {
        self.flush_buffer(thinking_buffer, ChunkKind::Thinking);
        self.flush_buffer(content_buffer, ChunkKind::Content);
    }
}

struct HttpTarget<'a> {
    client: &'a reqwest::Client,
    url: &'a str,
}

async fn stream_with_preferred_api<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    request: &AiChatRequest,
    cancellation_token: &CancellationToken,
) -> Result<(), String> {
    if !should_use_responses_api(request) {
        return chat_stream::stream_chat_inner(app_handle, request, cancellation_token).await;
    }
    let responses_result =
        responses_stream::stream_responses_completion(app_handle, request, cancellation_token)
            .await;
    match responses_result {
        Ok(()) => Ok(()),
        Err(responses_error) if responses_error.fallback_to_chat_completions => {
            tracing::warn!(
                stream_id = %request.stream_id,
                endpoint = %request.endpoint,
                error = %responses_error.message,
                "Responses API unavailable or incompatible; falling back to chat completions"
            );
            chat_stream::stream_chat_inner(app_handle, request, cancellation_token).await
        }
        Err(responses_error) => Err(responses_error.message),
    }
}

pub async fn stream_chat_completion<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    request: AiChatRequest,
    cancellation_token: CancellationToken,
) -> Result<(), String> {
    let stream_id = request.stream_id.clone();
    tracing::info!(stream_id = %stream_id, endpoint = %request.endpoint, model = %request.model, "starting AI stream");

    let result = stream_with_preferred_api(app_handle, &request, &cancellation_token).await;

    match &result {
        Ok(()) => {
            tracing::info!(stream_id = %stream_id, "AI stream completed");
        }
        Err(error) if !cancellation_token.is_cancelled() => {
            tracing::error!(stream_id = %stream_id, error = %error, "AI stream error");
            let _ = app_handle.emit(
                "ai-stream-error",
                StreamErrorEvent {
                    stream_id: stream_id.clone(),
                    error: error.clone(),
                },
            );
        }
        Err(_) => {}
    }

    result
}
