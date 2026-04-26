//! HTTP streaming client for OpenAI-compatible chat completion endpoints.
//!
//! Sends a POST request and reads the SSE response, emitting Tauri events
//! for each token chunk, completion, or error.

use crate::ai::local_compat::{
    CapabilityCache, CapabilityKind, LocalCompatPolicy, ThinkingSanitizer, redact_endpoint,
    render_raw_transcript, sanitize_thinking_content,
};
use crate::ai::types::{
    parse_sse_line, AiChatRequest, AiTransport, ApiChatRequest, ApiMessage, ApiResponsesRequest,
    ChatTemplateKwargs, ChunkKind, CompletionsRequest, CompletionsResponse,
    CompletionsStreamChunk, ResponsesInputItem, SseParsed, StreamChunkEvent, StreamDoneEvent,
    StreamErrorEvent,
};
use futures::StreamExt;
use std::sync::Arc;
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

/// Timeout for the non-streaming completions capability probe.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// Shorter probe timeout for the rerank path (2s probe + 4s call = 6s budget).
pub const RERANK_PROBE_TIMEOUT_SECS: u64 = 2;

/// Instruction prepended to raw transcripts when reasoning is disabled.
pub const REASONING_OFF_INSTRUCTION: &str =
    "Do not use chain-of-thought or internal reasoning. Respond directly and concisely.";

/// Stable directive appended to every user message when reasoning is disabled.
/// Applied uniformly so that multi-turn replays produce byte-identical payloads
/// for provider prefix-cache reuse.
pub const REASONING_OFF_DIRECTIVE: &str =
    "\n[No chain-of-thought. Answer directly.]";

/// Normalize a chat-completions message list for provider-wire stability.
///
/// When `reasoning_enabled` is false, appends [`REASONING_OFF_DIRECTIVE`] to
/// **every** user message (not just the last one), ensuring that historical
/// turns replay identically on subsequent requests. Duplicate directives are
/// never accumulated. System and assistant messages are never modified.
///
/// When `reasoning_enabled` is true, messages are returned as-is (cloned).
///
/// The input slice is never mutated.
pub fn normalize_chat_payload_for_provider(
    messages: &[ApiMessage],
    reasoning_enabled: bool,
) -> Vec<ApiMessage> {
    if reasoning_enabled {
        return messages.to_vec();
    }

    messages
        .iter()
        .map(|msg| {
            if msg.role == "user" {
                let mut content = msg.content.clone();
                // Append REASONING_OFF_DIRECTIVE if not already present
                if !content.ends_with(REASONING_OFF_DIRECTIVE)
                    && !content.contains(REASONING_OFF_DIRECTIVE)
                {
                    content.push_str(REASONING_OFF_DIRECTIVE);
                }
                // Append /no_think if not already present (as standalone token)
                if !content.split_whitespace().any(|token| token == "/no_think") {
                    content.push_str("\n\n/no_think");
                }
                ApiMessage {
                    role: msg.role.clone(),
                    content,
                }
            } else {
                msg.clone()
            }
        })
        .collect()
}

// ── Compatibility transport decision ──────────────────────────────────────

/// Result of evaluating whether a request should use the raw completions
/// compatibility transport.
#[derive(Debug)]
pub enum CompatDecision {
    /// Use the raw `/v1/completions` endpoint with the rendered prompt.
    UseRawCompletions { raw_prompt: String },
    /// Use the standard chat completions (or responses) transport.
    UseChatCompletions,
    /// The endpoint was eligible but completions probe failed; fall back to chat
    /// and notify the frontend via event.
    UseChatCompletionsFallback { warning: String },
}

/// Build an actionable compatibility error message that identifies endpoint,
/// model, reason, and suggested next action.
pub fn format_compat_error(endpoint: &str, model: &str, reason: &str) -> String {
    let safe_endpoint = redact_endpoint(endpoint);
    format!(
        "Compatibility error: endpoint=\"{safe_endpoint}\", model=\"{model}\", \
         reason=\"{reason}\". \
         Check that your local provider supports /v1/completions for this model."
    )
}

/// Decide whether a request should be routed through the raw completions
/// compatibility transport. Only applicable to local endpoints with reasoning
/// disabled and not using the Responses API.
pub async fn determine_compat_transport(
    request: &AiChatRequest,
    capability_cache: &CapabilityCache,
) -> CompatDecision {
    let using_responses_chaining =
        request.prefer_responses_api && request.previous_response_id.is_some();
    if !LocalCompatPolicy::is_eligible(
        &request.endpoint,
        request.enable_reasoning,
        using_responses_chaining,
    ) {
        tracing::debug!(
            endpoint = %request.endpoint,
            transport = "chat_completions",
            "AI transport selected"
        );
        return CompatDecision::UseChatCompletions;
    }

    match capability_cache
        .get(
            &request.endpoint,
            &request.model,
            CapabilityKind::NonStreamingCompletions,
        )
        .await
    {
        Some(true) => {
            // Fix 4: If streaming completions is known-negative, fall back to
            // chat completions rather than attempting raw streaming that will fail.
            let streaming_cached = capability_cache
                .get(
                    &request.endpoint,
                    &request.model,
                    CapabilityKind::StreamingCompletions,
                )
                .await;
            if streaming_cached == Some(false) {
                tracing::warn!(
                    endpoint = %request.endpoint,
                    model = %request.model,
                    "completions probe positive but streaming negative — returning compat error"
                );
                return CompatDecision::UseChatCompletionsFallback {
                    warning: format_compat_error(
                        &request.endpoint,
                        &request.model,
                        "Streaming completions previously failed for this provider. \
                         Re-enable reasoning or restart the app to retry.",
                    ),
                };
            }

            tracing::info!(
                endpoint = %request.endpoint,
                model = %request.model,
                transport = "raw_completions_compat",
                "AI transport selected"
            );
            tracing::info!(
                endpoint = %request.endpoint,
                model = %request.model,
                "completions capability probe positive"
            );
            let raw_prompt =
                render_raw_transcript(&request.messages, REASONING_OFF_INSTRUCTION);
            CompatDecision::UseRawCompletions { raw_prompt }
        }
        Some(false) => {
            let reason = "completions_not_supported";
            tracing::warn!(
                endpoint = %request.endpoint,
                model = %request.model,
                reason = %reason,
                "completions capability probe negative, compat not available"
            );
            let err = format_compat_error(
                &request.endpoint,
                &request.model,
                reason,
            );
            tracing::warn!(
                endpoint = %request.endpoint,
                model = %request.model,
                error = %err,
                "compatibility error surfaced to user"
            );
            CompatDecision::UseChatCompletionsFallback { warning: err }
        }
        None => {
            let probe_ok =
                probe_completions_capability(&request.endpoint, &request.model, request.api_key.as_deref()).await;
            if probe_ok {
                capability_cache
                    .set(
                        &request.endpoint,
                        &request.model,
                        CapabilityKind::NonStreamingCompletions,
                        true,
                    )
                    .await;
                tracing::info!(
                    endpoint = %request.endpoint,
                    model = %request.model,
                    "completions capability probe positive"
                );
                tracing::info!(
                    endpoint = %request.endpoint,
                    model = %request.model,
                    transport = "raw_completions_compat",
                    "AI transport selected"
                );
                let raw_prompt =
                    render_raw_transcript(&request.messages, REASONING_OFF_INSTRUCTION);
                CompatDecision::UseRawCompletions { raw_prompt }
            } else {
                capability_cache
                    .set(
                        &request.endpoint,
                        &request.model,
                        CapabilityKind::NonStreamingCompletions,
                        false,
                    )
                    .await;
                let reason = "completions_not_supported";
                tracing::warn!(
                    endpoint = %request.endpoint,
                    model = %request.model,
                    reason = %reason,
                    "completions capability probe negative, compat not available"
                );
                let err = format_compat_error(
                    &request.endpoint,
                    &request.model,
                    reason,
                );
                tracing::warn!(
                    endpoint = %request.endpoint,
                    model = %request.model,
                    error = %err,
                    "compatibility error surfaced to user"
                );
                CompatDecision::UseChatCompletionsFallback { warning: err }
            }
        }
    }
}

/// Send a non-streaming request to `/v1/completions` and return the sanitised text.
///
/// Used by hidden calls (query expansion, rerank) that always run with reasoning off.
pub async fn send_non_streaming_completions(
    endpoint: &str,
    model: &str,
    raw_prompt: String,
    api_key: Option<&str>,
    timeout_secs: u64,
) -> Result<String, String> {
    let url = crate::ai::url::completions_url(endpoint);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let req = CompletionsRequest {
        model: model.to_string(),
        prompt: raw_prompt,
        max_tokens: None,
        stream: Some(false),
        stop: Some(vec!["\n\n### User\n".to_string(), "\n\n### Assistant\n".to_string()]),
    };

    let mut request_builder = client.post(&url).json(&req);
    if let Some(key) = api_key {
        if !key.is_empty() {
            request_builder = request_builder.header("Authorization", format!("Bearer {key}"));
        }
    }

    let resp = request_builder
        .send()
        .await
        .map_err(|e| {
            tracing::warn!("compat non-streaming request error: {e}");
            format_compat_error(endpoint, model, "Provider request failed. Check provider logs.")
        })?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());
        return Err(format_compat_error(endpoint, model, &format!("HTTP {status}: {body}")));
    }

    let parsed: CompletionsResponse = resp
        .json()
        .await
        .map_err(|e| format_compat_error(endpoint, model, &format!("parse error: {e}")))?;

    let text = parsed
        .choices
        .first()
        .map(|c| c.text.clone())
        .unwrap_or_default();

    Ok(sanitize_thinking_content(&text))
}

/// Run a hidden (non-streaming, reasoning-off) LLM call through the compatibility
/// policy. Returns the generated text on success, or an error string.
///
/// Error `"not_eligible"` means the endpoint is not local and the caller should
/// fall back to the existing chat-completions path.
pub async fn run_hidden_compat_call(
    endpoint: &str,
    model: &str,
    messages: &[crate::ai::types::IpcMessage],
    api_key: Option<&str>,
    capability_cache: &CapabilityCache,
    timeout_secs: u64,
    call_name: &str,
    probe_timeout_secs: Option<u64>,
) -> Result<String, String> {
    use crate::ai::local_compat::is_local_endpoint;

    if !is_local_endpoint(endpoint) {
        return Err("not_eligible".to_string());
    }

    let cached = capability_cache
        .get(endpoint, model, CapabilityKind::NonStreamingCompletions)
        .await;

    match cached {
        Some(true) => {
            tracing::info!(
                endpoint = %endpoint,
                model = %model,
                call_name = %call_name,
                "hidden compat call: using cached positive capability"
            );
            let raw_prompt = render_raw_transcript(messages, REASONING_OFF_INSTRUCTION);
            send_non_streaming_completions(endpoint, model, raw_prompt, api_key, timeout_secs).await
        }
        Some(false) => {
            tracing::info!(
                endpoint = %endpoint,
                model = %model,
                call_name = %call_name,
                "hidden compat call: cached negative — immediate fallback"
            );
            Err(format_compat_error(endpoint, model, "completions_not_supported"))
        }
        None => {
            let probe_timeout = Duration::from_secs(probe_timeout_secs.unwrap_or(PROBE_TIMEOUT.as_secs()));
            let probe_ok = probe_completions_capability_with_timeout(endpoint, model, probe_timeout, api_key).await;
            capability_cache
                .set(
                    endpoint,
                    model,
                    CapabilityKind::NonStreamingCompletions,
                    probe_ok,
                )
                .await;
            if probe_ok {
                tracing::info!(
                    endpoint = %endpoint,
                    model = %model,
                    call_name = %call_name,
                    "hidden compat call: probe succeeded"
                );
                let raw_prompt = render_raw_transcript(messages, REASONING_OFF_INSTRUCTION);
                send_non_streaming_completions(endpoint, model, raw_prompt, api_key, timeout_secs).await
            } else {
                tracing::warn!(
                    endpoint = %endpoint,
                    model = %model,
                    call_name = %call_name,
                    "hidden compat call: probe failed — immediate fallback"
                );
                Err(format_compat_error(endpoint, model, "completions_not_supported"))
            }
        }
    }
}

/// Send a minimal non-streaming request to `/v1/completions` to check support.
///
/// Returns `true` if the endpoint responds with HTTP 200 and a valid
/// `CompletionsResponse` shape.
pub async fn probe_completions_capability(endpoint: &str, model: &str, api_key: Option<&str>) -> bool {
    probe_completions_capability_with_timeout(endpoint, model, PROBE_TIMEOUT, api_key).await
}

/// Probe with a caller-specified timeout.
pub async fn probe_completions_capability_with_timeout(
    endpoint: &str,
    model: &str,
    timeout: Duration,
    api_key: Option<&str>,
) -> bool {
    let url = crate::ai::url::completions_url(endpoint);
    let client = match reqwest::Client::builder()
        .timeout(timeout)
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    let req = CompletionsRequest {
        model: model.to_string(),
        prompt: "Hello".to_string(),
        max_tokens: Some(1),
        stream: Some(false),
        stop: None,
    };

    let mut request_builder = client.post(&url).json(&req);
    if let Some(key) = api_key {
        if !key.is_empty() {
            request_builder = request_builder.header("Authorization", format!("Bearer {key}"));
        }
    }

    let resp = match request_builder.send().await {
        Ok(r) => r,
        Err(_) => return false,
    };

    if !resp.status().is_success() {
        return false;
    }

    resp.json::<CompletionsResponse>().await.is_ok()
}

/// Stream a completion from the raw `/v1/completions` endpoint, emitting Tauri
/// events that are indistinguishable from the chat completions transport to
/// the frontend.
pub async fn send_streaming_completions<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    stream_id: &str,
    endpoint: &str,
    model: &str,
    raw_prompt: String,
    api_key: Option<&str>,
    cancellation_token: &CancellationToken,
    capability_cache: &CapabilityCache,
) -> Result<(), String> {
    let url = crate::ai::url::completions_url(endpoint);

    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let req = CompletionsRequest {
        model: model.to_string(),
        prompt: raw_prompt,
        max_tokens: None,
        stream: Some(true),
        stop: Some(vec!["\n\n### User\n".to_string(), "\n\n### Assistant\n".to_string()]),
    };

    let response = tokio::select! {
        biased;
        _ = cancellation_token.cancelled() => {
            return Err("Stream cancelled".to_string());
        }
        result = {
            let mut request_builder = client.post(&url).json(&req);
            if let Some(key) = api_key {
                if !key.is_empty() {
                    request_builder = request_builder.header("Authorization", format!("Bearer {key}"));
                }
            }
            request_builder.send()
        } => {
            result.map_err(|e| {
                tracing::warn!("compat streaming request error: {e}");
                format_compat_error(endpoint, model, "Provider request failed. Check provider logs.")
            })?
        }
    };

    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());
        tracing::warn!(
            endpoint = %endpoint,
            model = %model,
            status = %status,
            body = %body,
            "streaming completions request failed"
        );
        capability_cache
            .set(endpoint, model, CapabilityKind::StreamingCompletions, false)
            .await;
        return Err(format_compat_error(
            endpoint,
            model,
            "streaming_completions_failed",
        ));
    }

    let mut byte_stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut line_buffer = String::new();
    let mut last_flush = Instant::now();
    let mut thinking_sanitizer = ThinkingSanitizer::new();

    loop {
        let chunk_result = tokio::select! {
            biased;
            _ = cancellation_token.cancelled() => {
                let _ = thinking_sanitizer.finish();
                flush_buffer(app_handle, stream_id, &mut buffer, ChunkKind::Content);
                return Err("Stream cancelled".to_string());
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
                    if trimmed.is_empty()
                        || trimmed.starts_with(':')
                        || trimmed.starts_with("event:")
                    {
                        continue;
                    }

                    if let Some(data) = trimmed.strip_prefix("data:") {
                        let data = data.trim();
                        if data == "[DONE]" {
                            let sr = thinking_sanitizer.finish();
                            if !sr.is_empty() {
                                buffer.push_str(&sr);
                            }
                            flush_buffer(
                                app_handle,
                                stream_id,
                                &mut buffer,
                                ChunkKind::Content,
                            );
                            let _ = app_handle.emit(
                                "ai-stream-done",
                                StreamDoneEvent {
                                    stream_id: stream_id.to_string(),
                                    response_id: None,
                                    transport: AiTransport::ChatCompletions,
                                },
                            );
                            return Ok(());
                        }

                        let chunk: CompletionsStreamChunk =
                            match serde_json::from_str(data) {
                                Ok(c) => c,
                                Err(_e) => {
                                    flush_buffer(
                                        app_handle,
                                        stream_id,
                                        &mut buffer,
                                        ChunkKind::Content,
                                    );
                                    capability_cache
                                        .set(
                                            endpoint,
                                            model,
                                            CapabilityKind::StreamingCompletions,
                                            false,
                                        )
                                        .await;
                                    return Err(format_compat_error(
                                        endpoint,
                                        model,
                                        "streaming_completions_failed",
                                    ));
                                }
                            };

                        for choice in &chunk.choices {
                            let sanitized = thinking_sanitizer.push(&choice.text);
                            buffer.push_str(&sanitized);
                        }

                        if last_flush.elapsed() >= FLUSH_INTERVAL {
                            flush_buffer(
                                app_handle,
                                stream_id,
                                &mut buffer,
                                ChunkKind::Content,
                            );
                            last_flush = Instant::now();
                        }
                    }
                }
            }
            Some(Err(_e)) => {
                // Flush residual from sanitizer
                let residual = thinking_sanitizer.finish();
                if !residual.is_empty() {
                    buffer.push_str(&residual);
                }
                flush_buffer(app_handle, stream_id, &mut buffer, ChunkKind::Content);
                capability_cache
                    .set(endpoint, model, CapabilityKind::StreamingCompletions, false)
                    .await;
                return Err(format_compat_error(
                    endpoint,
                    model,
                    "streaming_completions_failed",
                ));
            }
            None => {
                // EOF — handle residual line buffer
                if !line_buffer.is_empty() {
                    let trimmed = line_buffer.trim();
                    if let Some(data) = trimmed.strip_prefix("data:") {
                        let data = data.trim();
                        if data == "[DONE]" {
                            // Fall through to emit done
                        } else {
                            match serde_json::from_str::<CompletionsStreamChunk>(data) {
                                Ok(chunk) => {
                                    for choice in &chunk.choices {
                                        let sanitized =
                                            thinking_sanitizer.push(&choice.text);
                                        buffer.push_str(&sanitized);
                                    }
                                }
                                Err(_e) => {
                                    flush_buffer(
                                        app_handle,
                                        stream_id,
                                        &mut buffer,
                                        ChunkKind::Content,
                                    );
                                    capability_cache
                                        .set(
                                            endpoint,
                                            model,
                                            CapabilityKind::StreamingCompletions,
                                            false,
                                        )
                                        .await;
                                    return Err(format_compat_error(
                                        endpoint,
                                        model,
                                        "streaming_completions_failed",
                                    ));
                                }
                            }
                        }
                    }
                }

                // Flush sanitizer residual
                let sanitizer_residual = thinking_sanitizer.finish();
                if !sanitizer_residual.is_empty() {
                    buffer.push_str(&sanitizer_residual);
                }
                flush_buffer(app_handle, stream_id, &mut buffer, ChunkKind::Content);
                let _ = app_handle.emit(
                    "ai-stream-done",
                    StreamDoneEvent {
                        stream_id: stream_id.to_string(),
                        response_id: None,
                        transport: AiTransport::ChatCompletions,
                    },
                );
                return Ok(());
            }
        }
    }
}

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

pub fn should_use_responses_api(request: &AiChatRequest) -> bool {
    request.prefer_responses_api && request.enable_reasoning
}

/// Canonical reasoning-off fields. Returns the three values used to disable
/// reasoning across both typed (`ApiChatRequest`) and JSON-body callers.
fn reasoning_off_fields() -> (&'static str, bool, ChatTemplateKwargs) {
    (
        "none",
        false,
        ChatTemplateKwargs {
            enable_thinking: false,
        },
    )
}

fn chat_reasoning_compat_fields(enable_reasoning: bool) -> (Option<bool>, Option<ChatTemplateKwargs>) {
    if enable_reasoning {
        return (None, None);
    }

    let (_effort, enable_thinking, kwargs) = reasoning_off_fields();
    (Some(enable_thinking), Some(kwargs))
}

pub fn apply_reasoning_off_compatibility(body: &mut serde_json::Map<String, serde_json::Value>) {
    let (effort, enable_thinking, _kwargs) = reasoning_off_fields();
    body.insert(
        "reasoning_effort".to_string(),
        serde_json::Value::String(effort.to_string()),
    );
    body.insert("enable_thinking".to_string(), serde_json::Value::Bool(enable_thinking));
    body.insert(
        "chat_template_kwargs".to_string(),
        serde_json::json!({ "enable_thinking": enable_thinking }),
    );
    apply_no_think_to_json_messages(body);
}

/// Append `/no_think` to content unless it already contains the directive as a
/// standalone whitespace-delimited token.
pub fn append_no_think_directive(content: &str) -> String {
    if content.split_whitespace().any(|token| token == "/no_think") {
        return content.to_string();
    }
    format!("{content}\n\n/no_think")
}

/// Find the last user message in a slice and append the `/no_think` directive.
pub fn apply_no_think_to_last_user_message(messages: &mut [ApiMessage]) {
    if let Some(msg) = messages.iter_mut().rev().find(|m| m.role == "user") {
        msg.content = append_no_think_directive(&msg.content);
    }
}

/// Apply `/no_think` to the last user message in a JSON body's `messages` array.
///
/// No-op if `messages` is missing, not an array, or has no user message with
/// string content.
pub fn apply_no_think_to_json_messages(body: &mut serde_json::Map<String, serde_json::Value>) {
    let messages = match body.get_mut("messages").and_then(|v| v.as_array_mut()) {
        Some(arr) => arr,
        None => return,
    };

    if let Some(msg) = messages
        .iter_mut()
        .rev()
        .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
    {
        if let Some(obj) = msg.as_object_mut() {
            if let Some(content) = obj.get("content").and_then(|c| c.as_str()) {
                let updated = append_no_think_directive(content);
                obj.insert("content".to_string(), serde_json::Value::String(updated));
            }
        }
    }
}

pub fn should_fallback_from_responses_status(status: reqwest::StatusCode, body: &str) -> bool {
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
        "unknown field `reasoning`",
        "unknown field \"reasoning\"",
        "unknown field `summary`",
        "unknown field \"summary\"",
        "unknown field `effort`",
        "unknown field \"effort\"",
        "reasoning.effort",
        "reasoning.summary",
        "invalid value for 'reasoning'",
        "invalid value for 'reasoning.effort'",
        "invalid value for 'reasoning.summary'",
    ]
    .iter()
    .any(|needle| normalized_body.contains(needle))
}

pub fn should_retry_chat_without_reasoning(status: reqwest::StatusCode, body: &str) -> bool {
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
        "reasoning_effort",
        "unknown field `reasoning_effort`",
        "unknown field \"reasoning_effort\"",
        "unknown parameter: reasoning_effort",
        "unknown parameter 'reasoning_effort'",
        "unsupported parameter: reasoning_effort",
        "invalid value for 'reasoning_effort'",
        "reasoning effort",
    ]
    .iter()
    .any(|needle| normalized_body.contains(needle))
}

pub fn extract_responses_error_message(json: &serde_json::Value) -> Option<String> {
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

pub fn extract_responses_delta_text(json: &serde_json::Value) -> String {
    json.get("delta")
        .and_then(|v| v.as_str())
        .map(ToString::to_string)
        .unwrap_or_default()
}

pub fn extract_reasoning_text_from_parts(parts: &[serde_json::Value]) -> String {
    let mut text = String::new();

    for part in parts {
        let part_type = part.get("type").and_then(|v| v.as_str());
        if matches!(part_type, Some("summary_text") | Some("reasoning_text")) {
            if let Some(value) = part.get("text").and_then(|v| v.as_str()) {
                text.push_str(value);
            }
        }
    }

    text
}

pub fn extract_reasoning_text_from_item(item: &serde_json::Value) -> String {
    if item.get("type").and_then(|v| v.as_str()) != Some("reasoning") {
        return String::new();
    }

    let mut text = String::new();

    if let Some(summary) = item.get("summary").and_then(|v| v.as_array()) {
        text.push_str(&extract_reasoning_text_from_parts(summary));
    }

    if let Some(content) = item.get("content").and_then(|v| v.as_array()) {
        for part in content {
            let part_type = part.get("type").and_then(|v| v.as_str());
            if matches!(part_type, Some("summary_text") | Some("reasoning_text") | Some("text"))
            {
                if let Some(value) = part.get("text").and_then(|v| v.as_str()) {
                    text.push_str(value);
                }
            }
        }
    }

    text
}

pub fn extract_responses_reasoning_text(json: &serde_json::Value) -> String {
    let mut text = String::new();

    if let Some(delta) = json.get("delta").and_then(|v| v.as_str()) {
        text.push_str(delta);
    }

    if let Some(part) = json.get("part") {
        if let Some(part_type) = part.get("type").and_then(|v| v.as_str()) {
            if matches!(part_type, "summary_text" | "reasoning_text") {
                if let Some(value) = part.get("text").and_then(|v| v.as_str()) {
                    text.push_str(value);
                }
            }
        }
    }

    if let Some(item) = json.get("item") {
        text.push_str(&extract_reasoning_text_from_item(item));
    }

    if let Some(output) = json.get("output").and_then(|v| v.as_array()) {
        for item in output {
            text.push_str(&extract_reasoning_text_from_item(item));
        }
    }

    if let Some(response) = json.get("response") {
        if let Some(output) = response.get("output").and_then(|v| v.as_array()) {
            for item in output {
                text.push_str(&extract_reasoning_text_from_item(item));
            }
        }
    }

    text
}

fn should_treat_content_part_as_visible_text(json: &serde_json::Value) -> bool {
    json.get("item_id")
        .and_then(|value| value.as_str())
        .map(|item_id| !item_id.starts_with("rs_"))
        .unwrap_or(true)
}

fn extract_text_from_response_part(part: &serde_json::Value, allowed_types: &[&str]) -> String {
    let part_type = part.get("type").and_then(|v| v.as_str());
    if part_type.is_some_and(|value| allowed_types.contains(&value)) {
        return part
            .get("text")
            .and_then(|v| v.as_str())
            .map(ToString::to_string)
            .unwrap_or_default();
    }

    String::new()
}

fn extract_text_from_message_item(item: &serde_json::Value) -> String {
    if item.get("type").and_then(|v| v.as_str()) == Some("reasoning") {
        return String::new();
    }

    let mut text = String::new();

    if let Some(content) = item.get("content").and_then(|v| v.as_array()) {
        for part in content {
            if let Some(value) = part.as_str() {
                text.push_str(value);
                continue;
            }

            text.push_str(&extract_text_from_response_part(part, &["output_text", "text"]));
        }
    }

    text
}

pub fn extract_responses_reasoning_text_for_event(
    event_type: Option<&str>,
    json: &serde_json::Value,
    already_streamed_reasoning: bool,
) -> String {
    match event_type {
        Some("response.reasoning_summary_text.delta") | Some("response.reasoning_text.delta") => {
            extract_responses_delta_text(json)
        }
        Some("response.reasoning_summary_text.done") | Some("response.reasoning_text.done") => {
            if already_streamed_reasoning {
                String::new()
            } else {
                json.get("text")
                    .and_then(|v| v.as_str())
                    .map(ToString::to_string)
                    .unwrap_or_else(|| extract_responses_reasoning_text(json))
            }
        }
        Some("response.reasoning_summary_part.added") | Some("response.content_part.added") => json
            .get("part")
            .map(|part| extract_text_from_response_part(part, &["summary_text", "reasoning_text"]))
            .unwrap_or_default(),
        Some("response.reasoning_summary_part.done")
        | Some("response.content_part.done")
        | Some("response.output_item.done")
        | Some("response.completed") if !already_streamed_reasoning => {
            extract_responses_reasoning_text(json)
        }
        _ => String::new(),
    }
}

pub fn extract_responses_content_text_for_event(
    event_type: Option<&str>,
    json: &serde_json::Value,
    already_streamed_output: bool,
) -> String {
    match event_type {
        Some("response.output_text.delta") => extract_responses_delta_text(json),
        Some("response.content_part.added") if should_treat_content_part_as_visible_text(json) => json
            .get("part")
            .map(|part| extract_text_from_response_part(part, &["output_text", "text"]))
            .unwrap_or_default(),
        Some("response.output_text.done") if !already_streamed_output => json
            .get("text")
            .and_then(|v| v.as_str())
            .map(ToString::to_string)
            .unwrap_or_default(),
        Some("response.content_part.done")
            if !already_streamed_output && should_treat_content_part_as_visible_text(json) =>
        {
            json.get("part")
                .map(|part| extract_text_from_response_part(part, &["output_text", "text"]))
                .unwrap_or_default()
        }
        Some("response.output_item.done") if !already_streamed_output => json
            .get("item")
            .map(extract_text_from_message_item)
            .unwrap_or_default(),
        Some("response.completed") if !already_streamed_output => extract_responses_final_text(json),
        _ => String::new(),
    }
}

pub fn extract_responses_final_text(json: &serde_json::Value) -> String {
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
                // Skip reasoning output items — they are not answer text
                if item.get("type").and_then(|v| v.as_str()) == Some("reasoning") {
                    continue;
                }
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
            // Skip reasoning output items — they are not answer text
            if item.get("type").and_then(|v| v.as_str()) == Some("reasoning") {
                continue;
            }
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

pub fn is_responses_completion_event(event_type: Option<&str>) -> bool {
    matches!(
        event_type,
        Some("response.completed")
            | Some("response.output_text.done")
            | Some("response.output_text.delta")
            | Some("response.created")
            | Some("response.reasoning_summary_text.delta")
            | Some("response.reasoning_summary_text.done")
            | Some("response.reasoning_summary_part.added")
            | Some("response.reasoning_summary_part.done")
            | Some("response.reasoning_text.delta")
            | Some("response.reasoning_text.done")
            | Some("response.output_item.added")
            | Some("response.output_item.done")
            | Some("response.content_part.added")
            | Some("response.content_part.done")
    )
}

/// Emit a stream chunk event, reducing boilerplate at each call site.
fn emit_chunk<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    stream_id: &str,
    content: String,
    kind: ChunkKind,
) {
    let _ = app_handle.emit(
        "ai-stream-chunk",
        StreamChunkEvent {
            stream_id: stream_id.to_string(),
            content,
            kind,
        },
    );
}

/// Flush a buffer if non-empty, emitting a chunk event and resetting it.
fn flush_buffer<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    stream_id: &str,
    buffer: &mut String,
    kind: ChunkKind,
) {
    if !buffer.is_empty() {
        emit_chunk(app_handle, stream_id, std::mem::take(buffer), kind);
    }
}

/// Flush both thinking and content buffers (thinking first).
fn flush_both_buffers<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    stream_id: &str,
    thinking_buffer: &mut String,
    content_buffer: &mut String,
) {
    flush_buffer(app_handle, stream_id, thinking_buffer, ChunkKind::Thinking);
    flush_buffer(app_handle, stream_id, content_buffer, ChunkKind::Content);
}

pub fn is_responses_failure_event(event_type: Option<&str>) -> bool {
    matches!(event_type, Some("response.failed") | Some("error"))
}

pub fn merge_responses_event_type<'a>(
    sse_event_type: Option<&'a str>,
    json: &'a serde_json::Value,
) -> Option<&'a str> {
    sse_event_type.or_else(|| json.get("type").and_then(|v| v.as_str()))
}

pub fn is_chat_completions_style_payload(json: &serde_json::Value) -> bool {
    json.get("choices")
        .and_then(|choices| choices.as_array())
        .is_some_and(|choices| !choices.is_empty())
}

pub fn responses_input_items(request: &AiChatRequest) -> Vec<ResponsesInputItem> {
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
    capability_cache: Option<Arc<CapabilityCache>>,
) -> Result<(), String> {
    let stream_id = request.stream_id.clone();
    tracing::info!(stream_id = %stream_id, endpoint = %request.endpoint, model = %request.model, "starting AI stream");

    // Evaluate compatibility transport decision
    let compat = match &capability_cache {
        Some(cache) => determine_compat_transport(&request, cache).await,
        None => CompatDecision::UseChatCompletions,
    };

    let result = match compat {
        CompatDecision::UseRawCompletions { raw_prompt } => {
            tracing::info!(
                stream_id = %stream_id,
                endpoint = %request.endpoint,
                model = %request.model,
                "raw completions compatibility transport selected"
            );
            send_streaming_completions(
                app_handle,
                &stream_id,
                &request.endpoint,
                &request.model,
                raw_prompt,
                request.api_key.as_deref(),
                &cancellation_token,
                capability_cache.as_ref().expect("cache present when compat selected"),
            )
            .await
        }
        CompatDecision::UseChatCompletionsFallback { warning } => {
            tracing::warn!(
                endpoint = %request.endpoint,
                model = %request.model,
                warning = %warning,
                "completions not supported — falling back to chat completions"
            );
            // Emit warning event to frontend
            let _ = app_handle.emit("ai-compat-fallback", serde_json::json!({
                "streamId": request.stream_id,
                "warning": warning,
            }));
            // Fall through to normal chat completions
            if should_use_responses_api(&request) {
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
                    Err(e) => Err(e.message),
                }
            } else {
                stream_chat_inner(app_handle, &request, &cancellation_token).await
            }
        }
        CompatDecision::UseChatCompletions => {
            if should_use_responses_api(&request) {
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
            }
        }
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
    let (enable_thinking, chat_template_kwargs) =
        chat_reasoning_compat_fields(request.enable_reasoning);

    // Build the API request body
    let raw_messages: Vec<ApiMessage> = request.messages.iter().map(ApiMessage::from).collect();
    let normalized_messages = normalize_chat_payload_for_provider(&raw_messages, request.enable_reasoning);

    let api_request = ApiChatRequest {
        model: request.model.clone(),
        messages: normalized_messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: true,
        reasoning_effort: Some(
            if request.enable_reasoning { "medium" } else { "none" }.to_string(),
        ),
        enable_thinking,
        chat_template_kwargs,
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

    async fn send_chat_request(
        client: &reqwest::Client,
        chat_url: &str,
        api_request: &ApiChatRequest,
        api_key: Option<&str>,
        cancellation_token: &CancellationToken,
    ) -> Result<reqwest::Response, String> {
        tokio::select! {
            biased;
            _ = cancellation_token.cancelled() => {
                Err("Stream cancelled".to_string())
            }
            result = {
                let mut builder = client.post(chat_url).json(api_request);
                if let Some(key) = api_key {
                    if !key.is_empty() {
                        builder = builder.header("Authorization", format!("Bearer {key}"));
                    }
                }
                builder.send()
            } => {
                result.map_err(|e| format!("HTTP request failed: {e}"))
            }
        }
    }

    // Send the request, racing against cancellation
    let mut response = send_chat_request(&client, &chat_url, &api_request, request.api_key.as_deref(), cancellation_token).await?;

    // Check HTTP status
    let status = response.status();
    if !status.is_success() {
        let body = match response.text().await {
            Ok(body) => body,
            Err(_) => "<failed to read body>".to_string(),
        };

        if api_request.reasoning_effort.is_some() && should_retry_chat_without_reasoning(status, &body) {
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
            response = send_chat_request(&client, &chat_url, &retry_request, request.api_key.as_deref(), cancellation_token).await?;

            let retry_status = response.status();
            if !retry_status.is_success() {
                let retry_body = match response.text().await {
                    Ok(body) => body,
                    Err(_) => "<failed to read body>".to_string(),
                };
                return Err(format!("HTTP {retry_status}: {retry_body}"));
            }
        } else {
            return Err(format!("HTTP {status}: {body}"));
        }
    }

    // Stream the response body
    let mut byte_stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut thinking_buffer = String::new();
    let mut line_buffer = String::new();
    let mut last_flush = Instant::now();

    /// Accumulate reasoning fields from a parsed chunk into the thinking buffer
    /// when reasoning is enabled.
    fn accumulate_thinking(
        chunk: &crate::ai::types::ApiStreamChunk,
        thinking_buffer: &mut String,
        enable_reasoning: bool,
    ) {
        if !enable_reasoning {
            return;
        }
        for choice in &chunk.choices {
            if let Some(text) = &choice.delta.reasoning_content {
                thinking_buffer.push_str(text);
            }
            if let Some(text) = &choice.delta.thinking {
                thinking_buffer.push_str(text);
            }
        }
    }

    loop {
        let chunk_result = tokio::select! {
            biased;
            _ = cancellation_token.cancelled() => {
                flush_both_buffers(app_handle, stream_id, &mut thinking_buffer, &mut buffer);
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
                            accumulate_thinking(&chunk, &mut thinking_buffer, request.enable_reasoning);
                            for choice in &chunk.choices {
                                if let Some(content) = &choice.delta.content {
                                    let reasoning_text = choice
                                        .delta
                                        .reasoning_content
                                        .as_deref()
                                        .or(choice.delta.thinking.as_deref());
                                    let is_reasoning_dup = request.enable_reasoning
                                        && reasoning_text.is_some_and(|text| text == content);
                                    if !is_reasoning_dup {
                                        // Defensive: strip leaked thinking wrappers when reasoning is off
                                        if request.enable_reasoning {
                                            buffer.push_str(content);
                                        } else {
                                            buffer.push_str(&sanitize_thinking_content(content));
                                        }
                                    }
                                }
                            }

                            // Flush buffers at ~50ms intervals
                            if last_flush.elapsed() >= FLUSH_INTERVAL {
                                flush_buffer(app_handle, stream_id, &mut thinking_buffer, ChunkKind::Thinking);
                                flush_buffer(app_handle, stream_id, &mut buffer, ChunkKind::Content);
                                last_flush = Instant::now();
                            }
                        }
                        Ok(SseParsed::Done) => {
                            flush_both_buffers(app_handle, stream_id, &mut thinking_buffer, &mut buffer);
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
                            flush_both_buffers(app_handle, stream_id, &mut thinking_buffer, &mut buffer);
                            return Err(e);
                        }
                    }
                }
            }
            Some(Err(e)) => {
                flush_both_buffers(app_handle, stream_id, &mut thinking_buffer, &mut buffer);
                return Err(format!("Stream read error: {e}"));
            }
            None => {
                // EOF — process any remaining buffered content (last line without trailing newline)
                if !line_buffer.is_empty() {
                    let remaining = std::mem::take(&mut line_buffer);
                    match parse_sse_line(&remaining) {
                        Ok(SseParsed::Chunk(chunk)) => {
                            accumulate_thinking(&chunk, &mut thinking_buffer, request.enable_reasoning);
                            for choice in &chunk.choices {
                                if let Some(content) = &choice.delta.content {
                                    let reasoning_text = choice
                                        .delta
                                        .reasoning_content
                                        .as_deref()
                                        .or(choice.delta.thinking.as_deref());
                                    let is_reasoning_dup = request.enable_reasoning
                                        && reasoning_text.is_some_and(|text| text == content);
                                    if !is_reasoning_dup {
                                        if request.enable_reasoning {
                                            buffer.push_str(content);
                                        } else {
                                            buffer.push_str(&sanitize_thinking_content(content));
                                        }
                                    }
                                }
                            }
                        }
                        Ok(SseParsed::Done) => {
                            flush_both_buffers(app_handle, stream_id, &mut thinking_buffer, &mut buffer);
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
                            flush_both_buffers(app_handle, stream_id, &mut thinking_buffer, &mut buffer);
                            return Err(e);
                        }
                    }
                }

                // Stream ended without [DONE] — flush and emit done anyway
                flush_both_buffers(app_handle, stream_id, &mut thinking_buffer, &mut buffer);
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

/// Outcome of processing a single Responses SSE `data:` payload.
enum ResponsesPayloadOutcome {
    /// Continue reading the stream.
    Continue,
    /// `response.completed` seen — stream is done.
    Done,
}

/// Shared state mutated by [`process_responses_payload`].
struct ResponsesStreamState {
    response_id: Option<String>,
    saw_valid_responses_payload: bool,
    saw_streamed_output_text: bool,
    saw_streamed_reasoning: bool,
}

/// Process a single Responses `data:` JSON payload, updating shared buffers/flags.
///
/// Returns `Done` when `response.completed` is seen, `Continue` otherwise.
/// Errors are returned as `ResponsesStreamError`.
fn process_responses_payload<R: Runtime>(
    json: &serde_json::Value,
    event_type: Option<&str>,
    enable_reasoning: bool,
    stream_id: &str,
    app_handle: &tauri::AppHandle<R>,
    thinking_buffer: &mut String,
    content_buffer: &mut String,
    last_flush: &mut Instant,
    state: &mut ResponsesStreamState,
) -> Result<ResponsesPayloadOutcome, ResponsesStreamError> {
    if is_chat_completions_style_payload(json) {
        return Err(ResponsesStreamError::new(
            "Responses endpoint returned chat-completions-style stream payload",
            true,
        ));
    }

    let event_type = merge_responses_event_type(event_type, json);

    if let Some(message) = extract_responses_error_message(json) {
        if is_responses_failure_event(event_type) {
            return Err(ResponsesStreamError::new(message, false));
        }
    }

    if is_responses_completion_event(event_type)
        || extract_responses_error_message(json).is_some()
        || json.get("response").is_some()
        || json.get("response_id").is_some()
    {
        state.saw_valid_responses_payload = true;
    }

    if let Some(id) = json
        .get("response")
        .and_then(|r| r.get("id"))
        .and_then(|v| v.as_str())
    {
        state.response_id = Some(id.to_string());
    } else if let Some(id) = json.get("response_id").and_then(|v| v.as_str()) {
        state.response_id = Some(id.to_string());
    } else if let Some(id) = json.get("id").and_then(|v| v.as_str()) {
        if id.starts_with("resp_") {
            state.response_id = Some(id.to_string());
        }
    }

    let reasoning_text = if enable_reasoning {
        extract_responses_reasoning_text_for_event(event_type, json, state.saw_streamed_reasoning)
    } else {
        String::new()
    };

    if !reasoning_text.is_empty() && enable_reasoning {
        thinking_buffer.push_str(&reasoning_text);
        state.saw_streamed_reasoning = true;
        state.saw_valid_responses_payload = true;
    }

    if matches!(
        event_type,
        Some("response.reasoning_summary_text.done")
            | Some("response.reasoning_summary_part.done")
            | Some("response.reasoning_text.done")
    ) {
        state.saw_valid_responses_payload = true;
        flush_buffer(app_handle, stream_id, thinking_buffer, ChunkKind::Thinking);
    }

    let text_to_append = extract_responses_content_text_for_event(
        event_type,
        json,
        state.saw_streamed_output_text,
    );

    if !text_to_append.is_empty() {
        state.saw_streamed_output_text = true;
    }

    content_buffer.push_str(&text_to_append);

    if last_flush.elapsed() >= FLUSH_INTERVAL {
        flush_buffer(app_handle, stream_id, thinking_buffer, ChunkKind::Thinking);
        flush_buffer(app_handle, stream_id, content_buffer, ChunkKind::Content);
        *last_flush = Instant::now();
    }

    if event_type == Some("response.completed") {
        flush_both_buffers(app_handle, stream_id, thinking_buffer, content_buffer);
        return Ok(ResponsesPayloadOutcome::Done);
    }

    Ok(ResponsesPayloadOutcome::Continue)
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
        reasoning: Some(crate::ai::types::ReasoningConfig {
            effort: if request.enable_reasoning {
                "medium".to_string()
            } else {
                "none".to_string()
            },
            summary: if request.enable_reasoning {
                Some("auto".to_string())
            } else {
                None
            },
        }),
        reasoning_effort: None,
    };

    async fn send_responses_request(
        client: &reqwest::Client,
        responses_url: &str,
        api_request: &ApiResponsesRequest,
        api_key: Option<&str>,
        cancellation_token: &CancellationToken,
    ) -> Result<reqwest::Response, ResponsesStreamError> {
        tokio::select! {
            biased;
            _ = cancellation_token.cancelled() => {
                Err(ResponsesStreamError::new("Stream cancelled", false))
            }
            result = {
                let mut builder = client.post(responses_url).json(api_request);
                if let Some(key) = api_key {
                    if !key.is_empty() {
                        builder = builder.header("Authorization", format!("Bearer {key}"));
                    }
                }
                builder.send()
            } => {
                result.map_err(|e| ResponsesStreamError::new(format!("HTTP request failed: {e}"), true))
            }
        }
    }

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

    let mut response = send_responses_request(&client, &responses_url, &api_request, request.api_key.as_deref(), cancellation_token).await?;

    let status = response.status();
    if !status.is_success() {
        let body = match response.text().await {
            Ok(body) => body,
            Err(_) => "<failed to read body>".to_string(),
        };

        if should_fallback_from_responses_status(status, &body) {
            tracing::warn!(
                endpoint = %request.endpoint,
                model = %request.model,
                status = %status,
                "responses endpoint rejected reasoning config; retrying without reasoning"
            );

            let retry_request = ApiResponsesRequest {
                reasoning: None,
                ..api_request.clone()
            };

             response = send_responses_request(&client, &responses_url, &retry_request, request.api_key.as_deref(), cancellation_token).await?;
            let retry_status = response.status();
            if !retry_status.is_success() {
                let retry_body = match response.text().await {
                    Ok(body) => body,
                    Err(_) => "<failed to read body>".to_string(),
                };
                return Err(ResponsesStreamError::new(
                    format!("HTTP {retry_status}: {retry_body}"),
                    retry_status.is_server_error() || should_fallback_from_responses_status(retry_status, &retry_body),
                ));
            }
        } else {
            return Err(ResponsesStreamError::new(
                format!("HTTP {status}: {body}"),
                status.is_server_error() || should_fallback_from_responses_status(status, &body),
            ));
        }
    }

    let mut byte_stream = response.bytes_stream();
    let mut line_buffer = String::new();
    let mut buffer = String::new();
    let mut thinking_buffer = String::new();
    let mut last_flush = Instant::now();
    let mut stream_state = ResponsesStreamState {
        response_id: None,
        saw_valid_responses_payload: false,
        saw_streamed_output_text: false,
        saw_streamed_reasoning: false,
    };
    let mut saw_response_completed = false;
    let mut current_event_type: Option<String> = None;

    loop {
        let chunk_result = tokio::select! {
            biased;
            _ = cancellation_token.cancelled() => {
                flush_both_buffers(app_handle, stream_id, &mut thinking_buffer, &mut buffer);
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
                                    !stream_state.saw_valid_responses_payload,
                                )
                            })?;

                        match process_responses_payload(
                            &json,
                            current_event_type.as_deref(),
                            request.enable_reasoning,
                            stream_id,
                            app_handle,
                            &mut thinking_buffer,
                            &mut buffer,
                            &mut last_flush,
                            &mut stream_state,
                        )? {
                            ResponsesPayloadOutcome::Done => {
                                emit_responses_done(app_handle, stream_id, stream_state.response_id.clone());
                                return Ok(());
                            }
                            ResponsesPayloadOutcome::Continue => {}
                        }

                        current_event_type = None;
                    }
                }
            }
            Some(Err(e)) => {
                flush_both_buffers(app_handle, stream_id, &mut thinking_buffer, &mut buffer);
                return Err(ResponsesStreamError::new(
                    format!("Stream read error: {e}"),
                    !stream_state.saw_valid_responses_payload,
                ))
            }
            None => {
                let trimmed = line_buffer.trim();
                if let Some(data) = trimmed.strip_prefix("data:") {
                    let json: serde_json::Value = serde_json::from_str(data.trim())
                        .map_err(|e| {
                            ResponsesStreamError::new(
                                format!("Failed to parse SSE JSON: {e}"),
                                !stream_state.saw_valid_responses_payload,
                            )
                        })?;

                    match process_responses_payload(
                        &json,
                        current_event_type.as_deref(),
                        request.enable_reasoning,
                        stream_id,
                        app_handle,
                        &mut thinking_buffer,
                        &mut buffer,
                        &mut last_flush,
                        &mut stream_state,
                    )? {
                        ResponsesPayloadOutcome::Done => {
                            saw_response_completed = true;
                        }
                        ResponsesPayloadOutcome::Continue => {}
                    }
                }

                if !saw_response_completed {
                    return Err(ResponsesStreamError::new(
                        "Responses stream ended before response.completed",
                        !stream_state.saw_valid_responses_payload,
                    ));
                }

                flush_both_buffers(app_handle, stream_id, &mut thinking_buffer, &mut buffer);
                emit_responses_done(app_handle, stream_id, stream_state.response_id);
                return Ok(());
            }
        }
    }
}
