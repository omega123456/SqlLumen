//! HTTP streaming client for OpenAI-compatible chat completion endpoints.
//!
//! Sends a POST request and reads the SSE response, emitting Tauri events
//! for each token chunk, completion, or error.

use crate::ai::types::{
    AiChatRequest, ApiChatRequest, ApiMessage, SseParsed, StreamChunkEvent, StreamDoneEvent,
    StreamErrorEvent, parse_sse_line,
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
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);

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

    let result = stream_chat_inner(app_handle, &request, &cancellation_token).await;

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
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    // Send the request, racing against cancellation
    let response = tokio::select! {
        biased;
        _ = cancellation_token.cancelled() => {
            return Err("Stream cancelled".to_string());
        }
        result = client.post(&request.endpoint).json(&api_request).send() => {
            result.map_err(|e| format!("HTTP request failed: {e}"))?
        }
    };

    // Check HTTP status
    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());
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
                    },
                );
                return Ok(());
            }
        }
    }
}
