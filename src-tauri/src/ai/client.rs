//! HTTP streaming client for OpenAI-compatible chat completion endpoints.
//!
//! Sends a POST request and reads the SSE response, emitting Tauri events
//! for each token chunk, completion, or error.

use crate::ai::types::{
    parse_sse_line, AiChatRequest, AiTransport, ApiChatRequest, ApiMessage, ApiResponsesRequest,
    ResponsesInputItem, SseParsed, StreamChunkEvent, StreamDoneEvent, StreamErrorEvent,
};
use futures::StreamExt;
use std::time::Duration;
use tauri::{Emitter, Runtime};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

/// Buffer flush interval — tokens are accumulated and flushed roughly every 50ms
/// to avoid flooding the IPC channel with per-token events.
const FLUSH_INTERVAL: Duration = Duration::from_millis(50);

/// Connect timeout for the HTTP client.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// Overall request timeout (generous for long completions).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(330);

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

/// Derive the chat completions URL from a base URL.
///
/// Thin wrapper around [`crate::ai::url::normalise_openai_url`] that pins the
/// final segment to `chat/completions`. Kept `pub` so existing call sites and
/// integration tests continue to have a single entry point for this use case.
pub fn normalise_to_chat_completions_url(base_url: &str) -> String {
    crate::ai::url::normalise_openai_url(base_url, "chat/completions")
}

fn should_use_responses_api(request: &AiChatRequest) -> bool {
    request.prefer_responses_api
}

fn should_fallback_from_responses_status(status: reqwest::StatusCode, body: &str) -> bool {
    if matches!(
        status,
        reqwest::StatusCode::NOT_FOUND
            | reqwest::StatusCode::METHOD_NOT_ALLOWED
            | reqwest::StatusCode::NOT_IMPLEMENTED
    ) {
        return true;
    }

    if !matches!(
        status,
        reqwest::StatusCode::BAD_REQUEST
            | reqwest::StatusCode::UNPROCESSABLE_ENTITY
            | reqwest::StatusCode::UNSUPPORTED_MEDIA_TYPE
    ) {
        return false;
    }

    let normalized_body = body.to_ascii_lowercase();
    [
        "previous_response_id",
        "max_output_tokens",
        "unknown parameter",
        "invalid type for 'input'",
        "invalid value for 'input'",
        "invalid type for 'role'",
        "invalid value for 'role'",
        "invalid_union",
        "developer",
        "instructions",
        "messages[0].role",
        "not supported",
        "unrecognized",
        "does not exist",
        "no such endpoint",
        "unknown field `input`",
        "unknown field \"input\"",
        "unknown field `stream`",
        "unknown field `max_output_tokens`",
        "unknown field \"max_output_tokens\"",
    ]
    .iter()
    .any(|needle| normalized_body.contains(needle))
}

fn extract_responses_error_message(json: &serde_json::Value) -> Option<String> {
    if let Some(message) = json.get("error").and_then(|error| {
        error
            .get("message")
            .and_then(|message| message.as_str())
            .or_else(|| error.as_str())
    }) {
        return Some(message.to_string());
    }

    json.get("message")
        .and_then(|message| message.as_str())
        .map(ToString::to_string)
}

fn extract_responses_delta_text(json: &serde_json::Value) -> String {
    json.get("delta")
        .and_then(|v| v.as_str())
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn extract_responses_final_text(json: &serde_json::Value) -> String {
    let mut text = String::new();

    if let Some(content) = json.get("content") {
        match content {
            serde_json::Value::String(value) => text.push_str(value),
            serde_json::Value::Array(parts) => {
                for part in parts {
                    if let Some(value) = part.as_str() {
                        text.push_str(value);
                        continue;
                    }

                    if let Some(value) = part.get("text").and_then(|v| v.as_str()) {
                        text.push_str(value);
                    }
                }
            }
            _ => {}
        }
    }

    if let Some(value) = json.get("text").and_then(|v| v.as_str()) {
        text.push_str(value);
    }

    if let Some(response) = json.get("response") {
        if let Some(output) = response.get("output").and_then(|v| v.as_array()) {
            for item in output {
                if let Some(content_parts) = item.get("content").and_then(|v| v.as_array()) {
                    for part in content_parts {
                        if let Some(value) = part.get("text").and_then(|v| v.as_str()) {
                            text.push_str(value);
                        }
                    }
                }
            }
        }
    }

    if let Some(output) = json.get("output").and_then(|v| v.as_array()) {
        for item in output {
            if let Some(content_parts) = item.get("content").and_then(|v| v.as_array()) {
                for part in content_parts {
                    if let Some(value) = part.get("text").and_then(|v| v.as_str()) {
                        text.push_str(value);
                    }
                }
            }
        }
    }

    text
}

fn is_responses_completion_event(event_type: Option<&str>) -> bool {
    matches!(
        event_type,
        Some("response.completed")
            | Some("response.output_text.done")
            | Some("response.output_text.delta")
            | Some("response.created")
    )
}

fn is_responses_failure_event(event_type: Option<&str>) -> bool {
    matches!(event_type, Some("response.failed") | Some("error"))
}

fn merge_responses_event_type<'a>(
    sse_event_type: Option<&'a str>,
    json: &'a serde_json::Value,
) -> Option<&'a str> {
    sse_event_type.or_else(|| json.get("type").and_then(|v| v.as_str()))
}

fn is_chat_completions_style_payload(json: &serde_json::Value) -> bool {
    json.get("choices")
        .and_then(|choices| choices.as_array())
        .is_some_and(|choices| !choices.is_empty())
}

fn responses_input_items(request: &AiChatRequest) -> Vec<ResponsesInputItem> {
    if request.previous_response_id.is_none() {
        let mut items = Vec::with_capacity(request.messages.len());
        for message in &request.messages {
            items.push(ResponsesInputItem::from(message));
        }
        return items;
    }

    let mut start_idx = 0;
    for (idx, message) in request.messages.iter().enumerate().rev() {
        if message.role == "assistant" {
            start_idx = idx + 1;
            break;
        }
    }

    let mut incremental_items = Vec::new();
    for message in &request.messages[start_idx..] {
        if message.role != "assistant" {
            incremental_items.push(ResponsesInputItem::from(message));
        }
    }

    if incremental_items.is_empty() {
        let mut items = Vec::with_capacity(request.messages.len());
        for message in &request.messages {
            items.push(ResponsesInputItem::from(message));
        }
        items
    } else {
        incremental_items
    }
}

fn emit_responses_done<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    stream_id: &str,
    response_id: Option<String>,
) {
    let _ = app_handle.emit(
        "ai-stream-done",
        StreamDoneEvent {
            stream_id: stream_id.to_string(),
            response_id,
            transport: AiTransport::Responses,
        },
    );
}

/// Stream a chat completion from an OpenAI-compatible endpoint, emitting Tauri events.
///
/// The function makes a POST request with `stream: true`, reads SSE lines from
/// the response body, buffers tokens at ~50ms intervals, and emits:
/// - `ai-stream-chunk` with accumulated content
/// - `ai-stream-done` on successful completion
/// - `ai-stream-error` on any failure
///
/// Cancellation is supported via `tokio::select!` against the provided token.
pub async fn stream_chat_completion<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    request: AiChatRequest,
    cancellation_token: CancellationToken,
) -> Result<(), String> {
    let stream_id = request.stream_id.clone();
    tracing::info!(stream_id = %stream_id, endpoint = %request.endpoint, model = %request.model, "starting AI stream");

    let result = if should_use_responses_api(&request) {
        match stream_responses_completion(app_handle, &request, &cancellation_token).await {
            Ok(()) => Ok(()),
            Err(responses_error) if responses_error.fallback_to_chat_completions => {
                tracing::warn!(
                    stream_id = %stream_id,
                    endpoint = %request.endpoint,
                    error = %responses_error.message,
                    "Responses API unavailable or incompatible; falling back to chat completions"
                );
                stream_chat_inner(app_handle, &request, &cancellation_token).await
            }
            Err(responses_error) => Err(responses_error.message),
        }
    } else {
        stream_chat_inner(app_handle, &request, &cancellation_token).await
    };

    match &result {
        Ok(()) => {
            tracing::info!(stream_id = %stream_id, "AI stream completed");
        }
        Err(e) => {
            // Only emit error if not cancelled — cancellation is expected/normal.
            if !cancellation_token.is_cancelled() {
                tracing::error!(stream_id = %stream_id, error = %e, "AI stream error");
                let _ = app_handle.emit(
                    "ai-stream-error",
                    StreamErrorEvent {
                        stream_id: stream_id.clone(),
                        error: e.clone(),
                    },
                );
            }
        }
    }

    result
}

async fn stream_chat_inner<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    request: &AiChatRequest,
    cancellation_token: &CancellationToken,
) -> Result<(), String> {
    let stream_id = &request.stream_id;

    // Build the API request body
    let api_request = ApiChatRequest {
        model: request.model.clone(),
        messages: request.messages.iter().map(ApiMessage::from).collect(),
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: true,
    };

    // Create the HTTP client
    let client = match reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(e) => return Err(format!("Failed to create HTTP client: {e}")),
    };

    let chat_url = normalise_to_chat_completions_url(&request.endpoint);

    // Send the request, racing against cancellation
    let response = tokio::select! {
        biased;
        _ = cancellation_token.cancelled() => {
            return Err("Stream cancelled".to_string());
        }
        result = client.post(&chat_url).json(&api_request).send() => {
            result.map_err(|e| format!("HTTP request failed: {e}"))?
        }
    };

    // Check HTTP status
    let status = response.status();
    if !status.is_success() {
        let body = match response.text().await {
            Ok(body) => body,
            Err(_) => "<failed to read body>".to_string(),
        };
        return Err(format!("HTTP {status}: {body}"));
    }

    // Stream the response body
    let mut byte_stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut line_buffer = String::new();
    let mut last_flush = Instant::now();

    loop {
        let chunk_result = tokio::select! {
            biased;
            _ = cancellation_token.cancelled() => {
                // Flush any remaining buffer before returning
                if !buffer.is_empty() {
                    let _ = app_handle.emit(
                        "ai-stream-chunk",
                        StreamChunkEvent {
                            stream_id: stream_id.clone(),
                            content: std::mem::take(&mut buffer),
                        },
                    );
                }
                return Err("Stream cancelled".to_string());
            }
            chunk = byte_stream.next() => chunk,
        };

        match chunk_result {
            Some(Ok(bytes)) => {
                let text = String::from_utf8_lossy(&bytes);
                line_buffer.push_str(&text);

                // Process complete lines
                while let Some(newline_pos) = line_buffer.find('\n') {
                    let line = line_buffer[..newline_pos].to_string();
                    line_buffer = line_buffer[newline_pos + 1..].to_string();

                    match parse_sse_line(&line) {
                        Ok(SseParsed::Chunk(chunk)) => {
                            for choice in &chunk.choices {
                                if let Some(content) = &choice.delta.content {
                                    buffer.push_str(content);
                                }
                            }

                            // Flush buffer at ~50ms intervals
                            if !buffer.is_empty() && last_flush.elapsed() >= FLUSH_INTERVAL {
                                let _ = app_handle.emit(
                                    "ai-stream-chunk",
                                    StreamChunkEvent {
                                        stream_id: stream_id.clone(),
                                        content: std::mem::take(&mut buffer),
                                    },
                                );
                                last_flush = Instant::now();
                            }
                        }
                        Ok(SseParsed::Done) => {
                            // Flush remaining buffer
                            if !buffer.is_empty() {
                                let _ = app_handle.emit(
                                    "ai-stream-chunk",
                                    StreamChunkEvent {
                                        stream_id: stream_id.clone(),
                                        content: std::mem::take(&mut buffer),
                                    },
                                );
                            }

                            let _ = app_handle.emit(
                                "ai-stream-done",
                                StreamDoneEvent {
                                    stream_id: stream_id.clone(),
                                    response_id: None,
                                    transport: AiTransport::ChatCompletions,
                                },
                            );
                            return Ok(());
                        }
                        Ok(SseParsed::Skip) => {
                            // Empty, comment, or event lines — skip
                        }
                        Err(e) => {
                            tracing::error!(stream_id = %stream_id, error = %e, "SSE parse error");
                            // Flush any accumulated content before error
                            if !buffer.is_empty() {
                                let _ = app_handle.emit(
                                    "ai-stream-chunk",
                                    StreamChunkEvent {
                                        stream_id: stream_id.clone(),
                                        content: std::mem::take(&mut buffer),
                                    },
                                );
                            }
                            return Err(e);
                        }
                    }
                }
            }
            Some(Err(e)) => {
                return Err(format!("Stream read error: {e}"));
            }
            None => {
                // EOF — process any remaining buffered content (last line without trailing newline)
                if !line_buffer.is_empty() {
                    let remaining = std::mem::take(&mut line_buffer);
                    match parse_sse_line(&remaining) {
                        Ok(SseParsed::Chunk(chunk)) => {
                            for choice in &chunk.choices {
                                if let Some(content) = &choice.delta.content {
                                    buffer.push_str(content);
                                }
                            }
                        }
                        Ok(SseParsed::Done) => {
                            // Flush remaining buffer before done
                            if !buffer.is_empty() {
                                let _ = app_handle.emit(
                                    "ai-stream-chunk",
                                    StreamChunkEvent {
                                        stream_id: stream_id.clone(),
                                        content: std::mem::take(&mut buffer),
                                    },
                                );
                            }
                            let _ = app_handle.emit(
                                "ai-stream-done",
                                StreamDoneEvent {
                                    stream_id: stream_id.clone(),
                                    response_id: None,
                                    transport: AiTransport::ChatCompletions,
                                },
                            );
                            return Ok(());
                        }
                        Ok(SseParsed::Skip) => {
                            // Empty or comment — nothing to do
                        }
                        Err(e) => {
                            tracing::error!(stream_id = %stream_id, error = %e, "SSE parse error on residual buffer");
                            if !buffer.is_empty() {
                                let _ = app_handle.emit(
                                    "ai-stream-chunk",
                                    StreamChunkEvent {
                                        stream_id: stream_id.clone(),
                                        content: std::mem::take(&mut buffer),
                                    },
                                );
                            }
                            return Err(e);
                        }
                    }
                }

                // Stream ended without [DONE] — flush and emit done anyway
                if !buffer.is_empty() {
                    let _ = app_handle.emit(
                        "ai-stream-chunk",
                        StreamChunkEvent {
                            stream_id: stream_id.clone(),
                            content: std::mem::take(&mut buffer),
                        },
                    );
                }
                let _ = app_handle.emit(
                    "ai-stream-done",
                    StreamDoneEvent {
                        stream_id: stream_id.clone(),
                        response_id: None,
                        transport: AiTransport::ChatCompletions,
                    },
                );
                return Ok(());
            }
        }
    }
}

async fn stream_responses_completion<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    request: &AiChatRequest,
    cancellation_token: &CancellationToken,
) -> Result<(), ResponsesStreamError> {
    let stream_id = &request.stream_id;
    let api_request = ApiResponsesRequest {
        model: request.model.clone(),
        input: responses_input_items(request),
        temperature: request.temperature,
        max_output_tokens: request.max_tokens,
        stream: true,
        previous_response_id: request.previous_response_id.clone(),
    };

    let client = match reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            return Err(ResponsesStreamError::new(
                format!("Failed to create HTTP client: {e}"),
                false,
            ))
        }
    };

    let responses_url = crate::ai::url::normalise_to_responses_url(&request.endpoint);

    let response = tokio::select! {
        biased;
        _ = cancellation_token.cancelled() => {
            return Err(ResponsesStreamError::new("Stream cancelled", false));
        }
        result = client.post(&responses_url).json(&api_request).send() => {
            result.map_err(|e| ResponsesStreamError::new(format!("HTTP request failed: {e}"), true))?
        }
    };

    let status = response.status();
    if !status.is_success() {
        let body = match response.text().await {
            Ok(body) => body,
            Err(_) => "<failed to read body>".to_string(),
        };
        return Err(ResponsesStreamError::new(
            format!("HTTP {status}: {body}"),
            status.is_server_error() || should_fallback_from_responses_status(status, &body),
        ));
    }

    let mut byte_stream = response.bytes_stream();
    let mut line_buffer = String::new();
    let mut buffer = String::new();
    let mut last_flush = Instant::now();
    let mut response_id: Option<String> = None;
    let mut saw_response_completed = false;
    let mut saw_valid_responses_payload = false;
    let mut current_event_type: Option<String> = None;
    let mut saw_streamed_output_text = false;

    loop {
        let chunk_result = tokio::select! {
            biased;
            _ = cancellation_token.cancelled() => {
                if !buffer.is_empty() {
                    let _ = app_handle.emit(
                        "ai-stream-chunk",
                        StreamChunkEvent {
                            stream_id: stream_id.clone(),
                            content: std::mem::take(&mut buffer),
                        },
                    );
                }
                return Err(ResponsesStreamError::new("Stream cancelled", false));
            }
            chunk = byte_stream.next() => chunk,
        };

        match chunk_result {
            Some(Ok(bytes)) => {
                let text = String::from_utf8_lossy(&bytes);
                line_buffer.push_str(&text);

                while let Some(newline_pos) = line_buffer.find('\n') {
                    let line = line_buffer[..newline_pos].to_string();
                    line_buffer = line_buffer[newline_pos + 1..].to_string();

                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with(':') {
                        continue;
                    }

                    if let Some(event_type) = trimmed.strip_prefix("event:") {
                        current_event_type = Some(event_type.trim().to_string());
                        continue;
                    }

                    if let Some(data) = trimmed.strip_prefix("data:") {
                        let json: serde_json::Value = serde_json::from_str(data.trim())
                            .map_err(|e| {
                                ResponsesStreamError::new(
                                    format!("Failed to parse SSE JSON: {e}"),
                                    !saw_valid_responses_payload,
                                )
                            })?;

                        if is_chat_completions_style_payload(&json) {
                            return Err(ResponsesStreamError::new(
                                "Responses endpoint returned chat-completions-style stream payload",
                                true,
                            ));
                        }

                        let event_type =
                            merge_responses_event_type(current_event_type.as_deref(), &json);

                        if let Some(message) = extract_responses_error_message(&json) {
                            if is_responses_failure_event(event_type) {
                                return Err(ResponsesStreamError::new(message, false));
                            }
                        }

                        if is_responses_completion_event(event_type)
                            || extract_responses_error_message(&json).is_some()
                            || json.get("response").is_some()
                            || json.get("response_id").is_some()
                        {
                            saw_valid_responses_payload = true;
                        }

                        if let Some(id) = json
                            .get("response")
                            .and_then(|r| r.get("id"))
                            .and_then(|v| v.as_str())
                        {
                            response_id = Some(id.to_string());
                        } else if let Some(id) = json.get("response_id").and_then(|v| v.as_str()) {
                            response_id = Some(id.to_string());
                        } else if let Some(id) = json.get("id").and_then(|v| v.as_str()) {
                            if id.starts_with("resp_") {
                                response_id = Some(id.to_string());
                            }
                        }

                        let text_to_append = if event_type == Some("response.output_text.delta") {
                            extract_responses_delta_text(&json)
                        } else if saw_streamed_output_text {
                            String::new()
                        } else {
                            extract_responses_final_text(&json)
                        };

                        if matches!(
                            event_type,
                            Some("response.output_text.delta") | Some("response.output_text.done")
                        ) && !text_to_append.is_empty()
                        {
                            saw_streamed_output_text = true;
                        }

                        buffer.push_str(&text_to_append);

                        if !buffer.is_empty() && last_flush.elapsed() >= FLUSH_INTERVAL {
                            let _ = app_handle.emit(
                                "ai-stream-chunk",
                                StreamChunkEvent {
                                    stream_id: stream_id.clone(),
                                    content: std::mem::take(&mut buffer),
                                },
                            );
                            last_flush = Instant::now();
                        }

                        if event_type == Some("response.completed") {
                            if !buffer.is_empty() {
                                let _ = app_handle.emit(
                                    "ai-stream-chunk",
                                    StreamChunkEvent {
                                        stream_id: stream_id.clone(),
                                        content: std::mem::take(&mut buffer),
                                    },
                                );
                            }
                            emit_responses_done(app_handle, stream_id, response_id.clone());
                            return Ok(());
                        }

                        current_event_type = None;
                    }
                }
            }
            Some(Err(e)) => {
                return Err(ResponsesStreamError::new(
                    format!("Stream read error: {e}"),
                    !saw_valid_responses_payload,
                ))
            }
            None => {
                let trimmed = line_buffer.trim();
                if let Some(data) = trimmed.strip_prefix("data:") {
                    let json: serde_json::Value = serde_json::from_str(data.trim())
                        .map_err(|e| {
                            ResponsesStreamError::new(
                                format!("Failed to parse SSE JSON: {e}"),
                                !saw_valid_responses_payload,
                            )
                        })?;

                    if is_chat_completions_style_payload(&json) {
                        return Err(ResponsesStreamError::new(
                            "Responses endpoint returned chat-completions-style stream payload",
                            true,
                        ));
                    }

                    let event_type = merge_responses_event_type(current_event_type.as_deref(), &json);

                    if let Some(message) = extract_responses_error_message(&json) {
                        if is_responses_failure_event(event_type) {
                            return Err(ResponsesStreamError::new(message, false));
                        }
                    }

                    if is_responses_completion_event(event_type)
                        || extract_responses_error_message(&json).is_some()
                        || json.get("response").is_some()
                        || json.get("response_id").is_some()
                    {
                        saw_valid_responses_payload = true;
                    }

                    if let Some(id) = json
                        .get("response")
                        .and_then(|r| r.get("id"))
                        .and_then(|v| v.as_str())
                    {
                        response_id = Some(id.to_string());
                    } else if let Some(id) = json.get("response_id").and_then(|v| v.as_str()) {
                        response_id = Some(id.to_string());
                    } else if let Some(id) = json.get("id").and_then(|v| v.as_str()) {
                        if id.starts_with("resp_") {
                            response_id = Some(id.to_string());
                        }
                    }

                    let text_to_append = if event_type == Some("response.output_text.delta") {
                        extract_responses_delta_text(&json)
                    } else if saw_streamed_output_text {
                        String::new()
                    } else {
                        extract_responses_final_text(&json)
                    };

                    buffer.push_str(&text_to_append);

                    if event_type == Some("response.completed") {
                        saw_response_completed = true;
                    }
                }

                if !saw_response_completed {
                    return Err(ResponsesStreamError::new(
                        "Responses stream ended before response.completed",
                        !saw_valid_responses_payload,
                    ));
                }

                if !buffer.is_empty() {
                    let _ = app_handle.emit(
                        "ai-stream-chunk",
                        StreamChunkEvent {
                            stream_id: stream_id.clone(),
                            content: std::mem::take(&mut buffer),
                        },
                    );
                }
                emit_responses_done(app_handle, stream_id, response_id);
                return Ok(());
            }
        }
    }
}
