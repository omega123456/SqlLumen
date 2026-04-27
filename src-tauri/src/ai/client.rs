//! HTTP streaming client for OpenAI-compatible chat completion endpoints.
//!
//! Sends a POST request and reads the SSE response, emitting Tauri events
//! for each token chunk, completion, or error.

use crate::ai::chat_compat::{
    append_reasoning_off_directive, build_probe_request, cache_strategy, contains_reasoning_leak,
    inspect_cached_strategy, is_local_eligible, normalize_endpoint_key, normalize_provider_messages,
    normalize_provider_messages_with_strategy, reasoning_strategy_name, ReasoningStrategy,
    StrategyCacheLookup, ASSISTANT_PREFILL_MARKER, NEGATIVE_STRATEGY_TTL, POSITIVE_STRATEGY_TTL,
};
use crate::ai::types::{
    parse_sse_line, AiChatRequest, AiTransport, ApiChatRequest, ApiResponsesRequest,
    ChatTemplateKwargs, ChunkKind, ResponsesInputItem, SseParsed, StreamChunkEvent,
    StreamDoneEvent, StreamErrorEvent,
};
use crate::state::AppState;
use futures::StreamExt;
use serde::Serialize;
use std::time::Duration;
use tauri::{Emitter, Manager, Runtime};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

/// Buffer flush interval — tokens are accumulated and flushed roughly every 50ms
/// to avoid flooding the IPC channel with per-token events.
const FLUSH_INTERVAL: Duration = Duration::from_millis(50);

/// Connect timeout for the HTTP client.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// Overall request timeout (generous for long completions).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(330);

#[derive(Debug, Clone, PartialEq, Eq)]
struct StreamSanitizationState {
    suppress_reasoning: bool,
    prefill_stripper: Option<PrefillStripper>,
    in_think_block: bool,
    pending_tag_prefix: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PrefillStripper {
    buffer: String,
    decided: bool,
}

impl PrefillStripper {
    fn new() -> Self {
        Self {
            buffer: String::new(),
            decided: false,
        }
    }

    fn strip_chunk(&mut self, content: &str) -> String {
        if self.decided {
            return content.to_string();
        }

        self.buffer.push_str(content);

        if ASSISTANT_PREFILL_MARKER.starts_with(&self.buffer) {
            if self.buffer.len() < ASSISTANT_PREFILL_MARKER.len() {
                return String::new();
            }

            self.decided = true;
            self.buffer.clear();
            tracing::debug!("assistant prefill stripped from visible stream content");
            return String::new();
        }

        self.decided = true;
        if let Some(stripped) = self.buffer.strip_prefix(ASSISTANT_PREFILL_MARKER) {
            let flushed = stripped.to_string();
            self.buffer.clear();
            tracing::debug!("assistant prefill stripped from visible stream content");
            return flushed;
        }

        let flushed = std::mem::take(&mut self.buffer);
        flushed
    }

    fn finalize(&mut self) -> String {
        if self.decided {
            return String::new();
        }

        self.decided = true;
        std::mem::take(&mut self.buffer)
    }
}

fn trailing_tag_prefix_len(input: &str, tokens: &[&str]) -> usize {
    let mut max_len = 0;

    for token in tokens {
        let upper = token.len().min(input.len());
        for prefix_len in 1..=upper {
            if input.ends_with(&token[..prefix_len]) {
                max_len = max_len.max(prefix_len);
            }
        }
    }

    max_len
}

fn should_suppress_reasoning(strategy: ReasoningStrategy, enable_reasoning: bool) -> bool {
    !enable_reasoning
        && matches!(
            strategy,
            ReasoningStrategy::StandardFields | ReasoningStrategy::AssistantPrefill
        )
}

fn sanitize_visible_content_chunk(
    content: &str,
    sanitization: &mut StreamSanitizationState,
    mut thinking_buffer: Option<&mut String>,
) -> String {
    let sanitized = if let Some(stripper) = sanitization.prefill_stripper.as_mut() {
        stripper.strip_chunk(content)
    } else {
        content.to_string()
    };

    if sanitized.is_empty() {
        return String::new();
    }

    let mut combined = std::mem::take(&mut sanitization.pending_tag_prefix);
    combined.push_str(&sanitized);
    let mut output = String::new();
    let mut cursor = 0;

    while cursor < combined.len() {
        if sanitization.in_think_block {
            if let Some(close_idx) = combined[cursor..].find("</think>") {
                if !sanitization.suppress_reasoning {
                    if let Some(thinking) = thinking_buffer.as_deref_mut() {
                        thinking.push_str(&combined[cursor..cursor + close_idx]);
                    }
                }
                cursor += close_idx + "</think>".len();
                sanitization.in_think_block = false;
                continue;
            }

            let remaining = &combined[cursor..];
            let pending_len = trailing_tag_prefix_len(remaining, &["</think>"]);
            let think_text_end = remaining.len() - pending_len;
            if !sanitization.suppress_reasoning {
                if let Some(thinking) = thinking_buffer.as_deref_mut() {
                    thinking.push_str(&remaining[..think_text_end]);
                }
            }
            if pending_len > 0 {
                sanitization.pending_tag_prefix = remaining[remaining.len() - pending_len..].to_string();
            }

            return output;
        }

        if let Some(open_idx) = combined[cursor..].find("<think>") {
            output.push_str(&combined[cursor..cursor + open_idx]);
            cursor += open_idx + "<think>".len();
            sanitization.in_think_block = true;
            continue;
        }

        let remaining = &combined[cursor..];
        let pending_len = trailing_tag_prefix_len(remaining, &["<think>", "</think>"]);
        if pending_len > 0 {
            output.push_str(&remaining[..remaining.len() - pending_len]);
            sanitization.pending_tag_prefix = remaining[remaining.len() - pending_len..].to_string();
        } else {
            output.push_str(remaining);
        }

        return output;
    }

    output
}

fn finalize_visible_content_sanitization(
    sanitization: &mut StreamSanitizationState,
    mut thinking_buffer: Option<&mut String>,
) -> String {
    let mut output = String::new();

    if let Some(stripper) = sanitization.prefill_stripper.as_mut() {
        let flushed = stripper.finalize();
        if !flushed.is_empty() {
            output.push_str(&sanitize_visible_content_chunk(
                &flushed,
                sanitization,
                thinking_buffer.as_deref_mut(),
            ));
        }
    }

    if !sanitization.in_think_block && !sanitization.pending_tag_prefix.is_empty() {
        output.push_str(&std::mem::take(&mut sanitization.pending_tag_prefix));
    } else if sanitization.in_think_block
        && !sanitization.suppress_reasoning
        && !sanitization.pending_tag_prefix.is_empty()
    {
        if let Some(thinking) = thinking_buffer {
            thinking.push_str(&std::mem::take(&mut sanitization.pending_tag_prefix));
        }
    }

    output
}

pub fn sanitize_streamed_content_chunks(
    chunks: &[&str],
    use_prefill_stripper: bool,
    suppress_reasoning: bool,
) -> (String, String) {
    let mut sanitization = StreamSanitizationState {
        suppress_reasoning,
        prefill_stripper: if use_prefill_stripper {
            Some(PrefillStripper::new())
        } else {
            None
        },
        in_think_block: false,
        pending_tag_prefix: String::new(),
    };
    let mut output = String::new();
    let mut thinking = String::new();

    for chunk in chunks {
        output.push_str(&sanitize_visible_content_chunk(
            chunk,
            &mut sanitization,
            Some(&mut thinking),
        ));
    }

    output.push_str(&finalize_visible_content_sanitization(
        &mut sanitization,
        Some(&mut thinking),
    ));

    (output, thinking)
}

pub fn sanitize_streamed_visible_content_chunks(
    chunks: &[&str],
    use_prefill_stripper: bool,
) -> String {
    sanitize_streamed_content_chunks(chunks, use_prefill_stripper, true).0
}

fn apply_reasoning_off_fields_impl(
    body: &mut serde_json::Map<String, serde_json::Value>,
    apply_no_think_messages: bool,
) {
    let (effort, enable_thinking, kwargs) = reasoning_off_fields();
    body.insert(
        "reasoning_effort".to_string(),
        serde_json::Value::String(effort.to_string()),
    );
    body.insert(
        "enable_thinking".to_string(),
        serde_json::Value::Bool(enable_thinking),
    );
    body.insert(
        "chat_template_kwargs".to_string(),
        serde_json::json!({ "enable_thinking": kwargs.enable_thinking }),
    );

    if apply_no_think_messages {
        apply_no_think_to_json_messages(body);
    }
}

pub fn apply_reasoning_off_fields_for_strategy(
    body: &mut serde_json::Value,
    strategy: &ReasoningStrategy,
) {
    let Some(object) = body.as_object_mut() else {
        return;
    };

    match strategy {
        ReasoningStrategy::StandardFields => apply_reasoning_off_compatibility(object),
        ReasoningStrategy::AssistantPrefill => apply_reasoning_off_fields_impl(object, false),
        ReasoningStrategy::NoSafeStrategy => {}
    }
}

fn apply_no_think_to_latest_json_user_message(body: &mut serde_json::Map<String, serde_json::Value>) {
    let Some(messages) = body.get_mut("messages").and_then(|v| v.as_array_mut()) else {
        return;
    };

    for msg in messages.iter_mut().rev() {
        if msg.get("role").and_then(|r| r.as_str()) != Some("user") {
            continue;
        }

        if let Some(obj) = msg.as_object_mut() {
            if let Some(content) = obj.get("content").and_then(|c| c.as_str()) {
                obj.insert(
                    "content".to_string(),
                    serde_json::Value::String(append_no_think_directive(content)),
                );
            }
        }
        break;
    }
}

fn provider_messages_with_latest_user_reasoning_off(
    messages: &[crate::ai::types::IpcMessage],
) -> Vec<crate::ai::types::ApiMessage> {
    let mut provider_messages: Vec<crate::ai::types::ApiMessage> =
        messages.iter().map(crate::ai::types::ApiMessage::from).collect();

    if let Some(last_user) = provider_messages.iter_mut().rev().find(|m| m.role == "user") {
        last_user.content = append_no_think_directive(&last_user.content);
    }

    provider_messages
}

fn inspect_strategy_cache_phase(
    state: &AppState,
    endpoint: &str,
    normalized_endpoint: &str,
    model: &str,
    now: std::time::Instant,
    phase: &str,
) -> Result<Option<ReasoningStrategy>, String> {
    let lookup = state
        .compat_strategy_cache
        .lock()
        .map_err(|e| format!("Failed to lock compat strategy cache: {e}"))?
        .pipe(|cache| inspect_cached_strategy(&cache, endpoint, model, now));

    match lookup {
        StrategyCacheLookup::Hit(cached) => {
            tracing::debug!(
                endpoint = %normalized_endpoint,
                model = %model,
                strategy = reasoning_strategy_name(cached.strategy),
                phase,
                "reasoning strategy cache HIT"
            );
            Ok(Some(cached.strategy))
        }
        StrategyCacheLookup::Expired(cached) => {
            tracing::debug!(
                endpoint = %normalized_endpoint,
                model = %model,
                strategy = reasoning_strategy_name(cached.strategy),
                phase,
                "reasoning strategy cache EXPIRED"
            );
            Ok(None)
        }
        StrategyCacheLookup::Miss => {
            tracing::debug!(
                endpoint = %normalized_endpoint,
                model = %model,
                phase,
                "reasoning strategy cache MISS"
            );
            Ok(None)
        }
    }
}

pub async fn prepare_local_compat_request(
    state: &AppState,
    client: &reqwest::Client,
    endpoint: &str,
    model: &str,
    messages: Vec<crate::ai::types::IpcMessage>,
) -> Result<(ReasoningStrategy, Vec<crate::ai::types::ApiMessage>, serde_json::Value), String> {
    let strategy = match resolve_strategy_for_endpoint(
        state,
        client,
        endpoint,
        model,
        &normalise_to_chat_completions_url(endpoint),
        &CancellationToken::new(),
    )
    .await
    {
        Ok(strategy) => strategy,
        Err(error) => {
            tracing::warn!(
                endpoint = %normalize_endpoint_key(endpoint),
                model = %model,
                error = %error,
                "local reasoning compatibility probe failed; falling back to latest-user /no_think strategy"
            );
            ReasoningStrategy::NoSafeStrategy
        }
    };

    let (provider_messages, partial_body) = match strategy {
        ReasoningStrategy::StandardFields | ReasoningStrategy::AssistantPrefill => {
            let provider_messages = normalize_provider_messages_with_strategy(&messages, true, &strategy);
            let mut partial_body = serde_json::json!({});
            apply_reasoning_off_fields_for_strategy(&mut partial_body, &strategy);
            (provider_messages, partial_body)
        }
        ReasoningStrategy::NoSafeStrategy => {
            tracing::warn!(
                endpoint = %normalize_endpoint_key(endpoint),
                model = %model,
                "no safe local cache-coherent reasoning strategy found; falling back to latest-user /no_think strategy"
            );
            let provider_messages = provider_messages_with_latest_user_reasoning_off(&messages);
            let mut partial_body = serde_json::json!({
                "messages": provider_messages,
            });
            apply_reasoning_off_compatibility_to_latest_user(
                partial_body.as_object_mut().expect("messages object"),
            );
            let provider_messages = partial_body
                .get("messages")
                .and_then(|value| value.as_array())
                .map(|messages| serde_json::from_value(serde_json::Value::Array(messages.clone())).unwrap_or_default())
                .unwrap_or_default();
            (provider_messages, partial_body)
        }
    };

    Ok((strategy, provider_messages, partial_body))
}

fn apply_probe_reasoning_off_fields(
    body: &mut serde_json::Map<String, serde_json::Value>,
    use_assistant_prefill: bool,
) {
    apply_reasoning_off_fields_impl(body, !use_assistant_prefill);
}

fn serialize_probe_body<T: Serialize>(
    request: &T,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    serde_json::to_value(request)
        .map_err(|e| format!("Failed to serialize probe request: {e}"))?
        .as_object()
        .cloned()
        .ok_or_else(|| "Failed to serialize probe request body".to_string())
}

async fn run_reasoning_probe(
    client: &reqwest::Client,
    chat_url: &str,
    model: &str,
    strategy: ReasoningStrategy,
    cancellation_token: &CancellationToken,
) -> Result<bool, String> {
    tracing::info!(
        endpoint = %normalize_endpoint_key(chat_url),
        model = %model,
        strategy = reasoning_strategy_name(strategy),
        "attempting local reasoning-compat probe"
    );

    let probe_messages = build_probe_request("", model)
        .into_iter()
        .map(|m| crate::ai::types::IpcMessage {
            role: m.role,
            content: m.content,
        })
        .collect::<Vec<_>>();

    let probe_messages = match strategy {
        ReasoningStrategy::StandardFields => normalize_provider_messages(&probe_messages, true),
        ReasoningStrategy::AssistantPrefill => normalize_provider_messages_with_strategy(
            &probe_messages,
            true,
            &ReasoningStrategy::AssistantPrefill,
        ),
        ReasoningStrategy::NoSafeStrategy => return Ok(false),
    };

    let probe_request = ApiChatRequest {
        model: model.to_string(),
        messages: probe_messages,
        temperature: 0.0,
        max_tokens: 8,
        stream: false,
        reasoning_effort: None,
        enable_thinking: None,
        chat_template_kwargs: None,
    };

    let mut body = serialize_probe_body(&probe_request)?;
    apply_probe_reasoning_off_fields(
        &mut body,
        matches!(strategy, ReasoningStrategy::AssistantPrefill),
    );

    let response = tokio::select! {
        biased;
        _ = cancellation_token.cancelled() => {
            return Err("Stream cancelled".to_string())
        }
        result = client.post(chat_url).json(&serde_json::Value::Object(body)).send() => {
            result.map_err(|e| format!("HTTP probe request failed: {e}"))?
        }
    };

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read probe response body: {e}"))?;

    if !status.is_success() {
        if should_retry_chat_without_reasoning(status, &body) {
            return Err(format!(
                "Provider rejected reasoning disable parameter reasoning_effort=none; cannot safely disable thinking for this endpoint/model. HTTP {status}: {body}"
            ));
        }

        return Err(format!("HTTP {status}: {body}"));
    }

    let clean = !contains_reasoning_leak(&body);
    if clean {
        tracing::info!(
            endpoint = %normalize_endpoint_key(chat_url),
            model = %model,
            strategy = reasoning_strategy_name(strategy),
            outcome = "clean",
            "local reasoning-compat probe completed"
        );
    } else {
        tracing::warn!(
            endpoint = %normalize_endpoint_key(chat_url),
            model = %model,
            strategy = reasoning_strategy_name(strategy),
            outcome = "leak_detected",
            "local reasoning-compat probe detected hidden reasoning leakage"
        );
    }

    Ok(clean)
}

pub async fn resolve_strategy_for_endpoint(
    state: &AppState,
    client: &reqwest::Client,
    endpoint: &str,
    model: &str,
    chat_url: &str,
    cancellation_token: &CancellationToken,
) -> Result<ReasoningStrategy, String> {
    let normalized_endpoint = normalize_endpoint_key(endpoint);
    if let Some(strategy) = inspect_strategy_cache_phase(
        state,
        endpoint,
        &normalized_endpoint,
        model,
        std::time::Instant::now(),
        "before_probe_lock",
    )? {
        return Ok(strategy);
    }

    let key = (normalized_endpoint.clone(), model.to_string());
    let probe_lock = {
        let mut locks = state
            .compat_strategy_probe_locks
            .lock()
            .map_err(|e| format!("Failed to lock compat probe guards: {e}"))?;
        locks
            .entry(key.clone())
            .or_insert_with(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    };

    let _guard = probe_lock.lock().await;

    if let Some(strategy) = inspect_strategy_cache_phase(
        state,
        endpoint,
        &normalized_endpoint,
        model,
        std::time::Instant::now(),
        "after_probe_lock",
    )? {
        return Ok(strategy);
    }

    let selected = if run_reasoning_probe(
        client,
        chat_url,
        model,
        ReasoningStrategy::StandardFields,
        cancellation_token,
    )
    .await?
    {
        ReasoningStrategy::StandardFields
    } else if run_reasoning_probe(
        client,
        chat_url,
        model,
        ReasoningStrategy::AssistantPrefill,
        cancellation_token,
    )
    .await?
    {
        ReasoningStrategy::AssistantPrefill
    } else {
        ReasoningStrategy::NoSafeStrategy
    };

    let ttl = if matches!(selected, ReasoningStrategy::NoSafeStrategy) {
        NEGATIVE_STRATEGY_TTL
    } else {
        POSITIVE_STRATEGY_TTL
    };

    state
        .compat_strategy_cache
        .lock()
        .map_err(|e| format!("Failed to lock compat strategy cache: {e}"))
        .map(|mut cache| {
            cache_strategy(
                &mut cache,
                endpoint,
                model,
                selected,
                std::time::Instant::now(),
                ttl,
            )
        })?;

    if matches!(selected, ReasoningStrategy::NoSafeStrategy) {
        tracing::warn!(
            endpoint = %normalize_endpoint_key(endpoint),
            model = %model,
            strategy = reasoning_strategy_name(selected),
            "no safe reasoning-off strategy found for local provider"
        );
        Ok(selected)
    } else {
        Ok(selected)
    }
}

trait Pipe: Sized {
    fn pipe<R>(self, f: impl FnOnce(Self) -> R) -> R {
        f(self)
    }
}

impl<T> Pipe for T {}

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

fn chat_reasoning_compat_fields(
    enable_reasoning: bool,
    local_compatibility_enabled: bool,
) -> (Option<bool>, Option<ChatTemplateKwargs>) {
    if enable_reasoning || !local_compatibility_enabled {
        return (None, None);
    }

    let (_effort, enable_thinking, kwargs) = reasoning_off_fields();
    (Some(enable_thinking), Some(kwargs))
}

pub fn apply_reasoning_off_compatibility(body: &mut serde_json::Map<String, serde_json::Value>) {
    apply_reasoning_off_fields_impl(body, true);
}

pub fn apply_reasoning_off_compatibility_to_latest_user(
    body: &mut serde_json::Map<String, serde_json::Value>,
) {
    let (effort, enable_thinking, kwargs) = reasoning_off_fields();
    body.insert(
        "reasoning_effort".to_string(),
        serde_json::Value::String(effort.to_string()),
    );
    body.insert(
        "enable_thinking".to_string(),
        serde_json::Value::Bool(enable_thinking),
    );
    body.insert(
        "chat_template_kwargs".to_string(),
        serde_json::json!({ "enable_thinking": kwargs.enable_thinking }),
    );
    apply_no_think_to_latest_json_user_message(body);
}

/// Append `/no_think` to content unless it already contains the directive as a
/// standalone whitespace-delimited token.
pub fn append_no_think_directive(content: &str) -> String {
    append_reasoning_off_directive(content)
}

/// Apply `/no_think` to every user message in a JSON body's `messages` array.
///
/// No-op if `messages` is missing, not an array, or has no user message with
/// string content.
pub fn apply_no_think_to_json_messages(body: &mut serde_json::Map<String, serde_json::Value>) {
    let messages = match body.get_mut("messages").and_then(|v| v.as_array_mut()) {
        Some(arr) => arr,
        None => return,
    };

    for msg in messages
        .iter_mut()
        .filter(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
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

pub fn should_retry_responses_without_reasoning(
    status: reqwest::StatusCode,
    body: &str,
) -> bool {
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
            if matches!(
                part_type,
                Some("summary_text") | Some("reasoning_text") | Some("text")
            ) {
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

            text.push_str(&extract_text_from_response_part(
                part,
                &["output_text", "text"],
            ));
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
        | Some("response.completed")
            if !already_streamed_reasoning =>
        {
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
        Some("response.content_part.added") if should_treat_content_part_as_visible_text(json) => {
            json.get("part")
                .map(|part| extract_text_from_response_part(part, &["output_text", "text"]))
                .unwrap_or_default()
        }
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
        Some("response.completed") if !already_streamed_output => {
            extract_responses_final_text(json)
        }
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
) -> Result<(), String> {
    if let Some(state) = app_handle.try_state::<AppState>() {
        stream_chat_completion_with_state(&state, app_handle, request, cancellation_token).await
    } else {
        stream_chat_inner_without_state(app_handle, &request, &cancellation_token).await
    }
}

async fn stream_chat_inner_without_state<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    request: &AiChatRequest,
    cancellation_token: &CancellationToken,
) -> Result<(), String> {
    struct EphemeralState {
        compat_strategy_cache:
            std::sync::Arc<std::sync::Mutex<crate::ai::chat_compat::StrategyCache>>,
        compat_strategy_probe_locks: std::sync::Arc<
            std::sync::Mutex<
                std::collections::HashMap<(String, String), std::sync::Arc<tokio::sync::Mutex<()>>>,
            >,
        >,
    }

    let ephemeral = EphemeralState {
        compat_strategy_cache: std::sync::Arc::new(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )),
        compat_strategy_probe_locks: std::sync::Arc::new(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )),
    };

    let state = AppState {
        db: std::sync::Arc::new(std::sync::Mutex::new(
            rusqlite::Connection::open_in_memory()
                .map_err(|e| format!("Failed to create fallback DB: {e}"))?,
        )),
        registry: crate::mysql::registry::ConnectionRegistry::new(),
        app_handle: None,
        results: std::sync::RwLock::new(std::collections::HashMap::new()),
        log_filter_reload: std::sync::Mutex::new(None),
        running_queries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        dump_jobs: std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        import_jobs: std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        ai_requests: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        compat_strategy_cache: ephemeral.compat_strategy_cache,
        compat_strategy_probe_locks: ephemeral.compat_strategy_probe_locks,
        index_build_tokens: std::sync::Arc::new(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )),
        session_profile_map: std::sync::Arc::new(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )),
        session_ref_counts: std::sync::Arc::new(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )),
        http_client: reqwest::Client::new(),
        embedding_cache: crate::schema_index::embeddings_cache::EmbeddingCache::new(),
    };

    stream_chat_inner(&state, app_handle, request, cancellation_token).await
}

pub async fn stream_chat_completion_with_state<R: Runtime>(
    state: &AppState,
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
                stream_chat_inner(state, app_handle, &request, &cancellation_token).await
            }
            Err(responses_error) => Err(responses_error.message),
        }
    } else {
        stream_chat_inner(state, app_handle, &request, &cancellation_token).await
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
    state: &AppState,
    app_handle: &tauri::AppHandle<R>,
    request: &AiChatRequest,
    cancellation_token: &CancellationToken,
) -> Result<(), String> {
    let stream_id = &request.stream_id;
    let (enable_thinking, chat_template_kwargs) =
        chat_reasoning_compat_fields(request.enable_reasoning, is_local_eligible(&request.endpoint));

    // Build the API request body
    let client = match reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(e) => return Err(format!("Failed to create HTTP client: {e}")),
    };

    let chat_url = normalise_to_chat_completions_url(&request.endpoint);

    let is_local_endpoint = is_local_eligible(&request.endpoint);
    let strategy = if !request.enable_reasoning && is_local_endpoint {
        match resolve_strategy_for_endpoint(
            state,
            &client,
            &request.endpoint,
            &request.model,
            &chat_url,
            cancellation_token,
        )
        .await
        {
            Ok(strategy) => strategy,
            Err(error) => {
                tracing::warn!(
                    endpoint = %normalize_endpoint_key(&request.endpoint),
                    model = %request.model,
                    error = %error,
                    "local reasoning compatibility probe failed; falling back to latest-user /no_think strategy"
                );
                ReasoningStrategy::NoSafeStrategy
            }
        }
    } else {
        ReasoningStrategy::StandardFields
    };

    tracing::info!(
        endpoint = %normalize_endpoint_key(&request.endpoint),
        model = %request.model,
        strategy = reasoning_strategy_name(strategy),
        "selected reasoning compatibility strategy for AI request"
    );

    if matches!(strategy, ReasoningStrategy::AssistantPrefill) && !request.enable_reasoning {
        // Streaming chat-completions providers usually do not expose cache-token counters,
        // so exact-prefix replay can be verified by payload shape but KV-cache misses cannot
        // be conclusively detected without provider support.
        tracing::debug!(
            endpoint = %normalize_endpoint_key(&request.endpoint),
            model = %request.model,
            "provider cache-hit diagnostics unavailable for this streaming request because cache token counts are not exposed"
        );
    }

    let provider_messages = if !request.enable_reasoning
        && is_local_endpoint
        && !matches!(strategy, ReasoningStrategy::NoSafeStrategy)
    {
        normalize_provider_messages_with_strategy(&request.messages, true, &strategy)
    } else if !request.enable_reasoning {
        if is_local_endpoint && matches!(strategy, ReasoningStrategy::NoSafeStrategy) {
            tracing::warn!(
                endpoint = %normalize_endpoint_key(&request.endpoint),
                model = %request.model,
                "no safe local cache-coherent reasoning strategy found; falling back to latest-user /no_think strategy"
            );
        }
        provider_messages_with_latest_user_reasoning_off(&request.messages)
    } else {
        request
            .messages
            .iter()
            .map(crate::ai::types::ApiMessage::from)
            .collect()
    };

    let api_request = ApiChatRequest {
        model: request.model.clone(),
        messages: provider_messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: true,
        reasoning_effort: if request.enable_reasoning {
            Some("medium".to_string())
        } else {
            Some("none".to_string())
        },
        enable_thinking,
        chat_template_kwargs,
    };

    let mut sanitization = StreamSanitizationState {
        suppress_reasoning: should_suppress_reasoning(strategy, request.enable_reasoning),
        prefill_stripper: if matches!(strategy, ReasoningStrategy::AssistantPrefill)
            && !request.enable_reasoning
        {
            Some(PrefillStripper::new())
        } else {
            None
        },
        in_think_block: false,
        pending_tag_prefix: String::new(),
    };

    async fn send_chat_request(
        client: &reqwest::Client,
        chat_url: &str,
        api_request: &ApiChatRequest,
        cancellation_token: &CancellationToken,
    ) -> Result<reqwest::Response, String> {
        tokio::select! {
            biased;
            _ = cancellation_token.cancelled() => {
                Err("Stream cancelled".to_string())
            }
            result = client.post(chat_url).json(api_request).send() => {
                result.map_err(|e| format!("HTTP request failed: {e}"))
            }
        }
    }

    // Send the request, racing against cancellation
    let mut response =
        send_chat_request(&client, &chat_url, &api_request, cancellation_token).await?;

    // Check HTTP status
    let status = response.status();
    if !status.is_success() {
        let body = match response.text().await {
            Ok(body) => body,
            Err(_) => "<failed to read body>".to_string(),
        };

        if api_request.reasoning_effort.is_some()
            && should_retry_chat_without_reasoning(status, &body)
        {
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
            response =
                send_chat_request(&client, &chat_url, &retry_request, cancellation_token).await?;

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
                let finalized =
                    finalize_visible_content_sanitization(&mut sanitization, Some(&mut thinking_buffer));
                if !finalized.is_empty() {
                    buffer.push_str(&finalized);
                }
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
                            accumulate_thinking(
                                &chunk,
                                &mut thinking_buffer,
                                request.enable_reasoning && !sanitization.suppress_reasoning,
                            );
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
                                        let sanitized = sanitize_visible_content_chunk(
                                            content,
                                            &mut sanitization,
                                            Some(&mut thinking_buffer),
                                        );
                                        if !sanitized.is_empty() {
                                            buffer.push_str(&sanitized);
                                        }
                                    }
                                }
                            }

                            // Flush buffers at ~50ms intervals
                            if last_flush.elapsed() >= FLUSH_INTERVAL {
                                flush_buffer(
                                    app_handle,
                                    stream_id,
                                    &mut thinking_buffer,
                                    ChunkKind::Thinking,
                                );
                                flush_buffer(
                                    app_handle,
                                    stream_id,
                                    &mut buffer,
                                    ChunkKind::Content,
                                );
                                last_flush = Instant::now();
                            }
                        }
                        Ok(SseParsed::Done) => {
                            let finalized = finalize_visible_content_sanitization(
                                &mut sanitization,
                                Some(&mut thinking_buffer),
                            );
                            if !finalized.is_empty() {
                                buffer.push_str(&finalized);
                            }
                            flush_both_buffers(
                                app_handle,
                                stream_id,
                                &mut thinking_buffer,
                                &mut buffer,
                            );
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
                            let finalized = finalize_visible_content_sanitization(
                                &mut sanitization,
                                Some(&mut thinking_buffer),
                            );
                            if !finalized.is_empty() {
                                buffer.push_str(&finalized);
                            }
                            flush_both_buffers(
                                app_handle,
                                stream_id,
                                &mut thinking_buffer,
                                &mut buffer,
                            );
                            return Err(e);
                        }
                    }
                }
            }
            Some(Err(e)) => {
                let finalized =
                    finalize_visible_content_sanitization(&mut sanitization, Some(&mut thinking_buffer));
                if !finalized.is_empty() {
                    buffer.push_str(&finalized);
                }
                flush_both_buffers(app_handle, stream_id, &mut thinking_buffer, &mut buffer);
                return Err(format!("Stream read error: {e}"));
            }
            None => {
                // EOF — process any remaining buffered content (last line without trailing newline)
                if !line_buffer.is_empty() {
                    let remaining = std::mem::take(&mut line_buffer);
                    match parse_sse_line(&remaining) {
                        Ok(SseParsed::Chunk(chunk)) => {
                            accumulate_thinking(
                                &chunk,
                                &mut thinking_buffer,
                                request.enable_reasoning && !sanitization.suppress_reasoning,
                            );
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
                                        let sanitized = sanitize_visible_content_chunk(
                                            content,
                                            &mut sanitization,
                                            Some(&mut thinking_buffer),
                                        );
                                        if !sanitized.is_empty() {
                                            buffer.push_str(&sanitized);
                                        }
                                    }
                                }
                            }
                        }
                        Ok(SseParsed::Done) => {
                            let finalized = finalize_visible_content_sanitization(
                                &mut sanitization,
                                Some(&mut thinking_buffer),
                            );
                            if !finalized.is_empty() {
                                buffer.push_str(&finalized);
                            }
                            flush_both_buffers(
                                app_handle,
                                stream_id,
                                &mut thinking_buffer,
                                &mut buffer,
                            );
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
                            let finalized = finalize_visible_content_sanitization(
                                &mut sanitization,
                                Some(&mut thinking_buffer),
                            );
                            if !finalized.is_empty() {
                                buffer.push_str(&finalized);
                            }
                            flush_both_buffers(
                                app_handle,
                                stream_id,
                                &mut thinking_buffer,
                                &mut buffer,
                            );
                            return Err(e);
                        }
                    }
                }

                // Stream ended without [DONE] — flush and emit done anyway
                let finalized =
                    finalize_visible_content_sanitization(&mut sanitization, Some(&mut thinking_buffer));
                if !finalized.is_empty() {
                    buffer.push_str(&finalized);
                }
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

    let text_to_append =
        extract_responses_content_text_for_event(event_type, json, state.saw_streamed_output_text);

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
        cancellation_token: &CancellationToken,
    ) -> Result<reqwest::Response, ResponsesStreamError> {
        tokio::select! {
            biased;
            _ = cancellation_token.cancelled() => {
                Err(ResponsesStreamError::new("Stream cancelled", false))
            }
            result = client.post(responses_url).json(api_request).send() => {
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

    let mut response =
        send_responses_request(&client, &responses_url, &api_request, cancellation_token).await?;

    let status = response.status();
    if !status.is_success() {
        let body = match response.text().await {
            Ok(body) => body,
            Err(_) => "<failed to read body>".to_string(),
        };

        if should_retry_responses_without_reasoning(status, &body) {
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

            response =
                send_responses_request(&client, &responses_url, &retry_request, cancellation_token)
                    .await?;
            let retry_status = response.status();
            if !retry_status.is_success() {
                let retry_body = match response.text().await {
                    Ok(body) => body,
                    Err(_) => "<failed to read body>".to_string(),
                };
                return Err(ResponsesStreamError::new(
                    format!("HTTP {retry_status}: {retry_body}"),
                    retry_status.is_server_error()
                        || should_fallback_from_responses_status(retry_status, &retry_body),
                ));
            }
        } else if should_fallback_from_responses_status(status, &body) {
            return Err(ResponsesStreamError::new(
                format!("HTTP {status}: {body}"),
                true,
            ));
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
                        let json: serde_json::Value =
                            serde_json::from_str(data.trim()).map_err(|e| {
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
                                emit_responses_done(
                                    app_handle,
                                    stream_id,
                                    stream_state.response_id.clone(),
                                );
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
                ));
            }
            None => {
                let trimmed = line_buffer.trim();
                if let Some(data) = trimmed.strip_prefix("data:") {
                    let json: serde_json::Value =
                        serde_json::from_str(data.trim()).map_err(|e| {
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
