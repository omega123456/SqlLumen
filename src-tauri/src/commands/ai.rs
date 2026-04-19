//! Tauri commands for AI chat — streaming completions, cancellation, model listing, and query expansion.

use crate::ai::client::stream_chat_completion;
use crate::ai::types::{
    AiChatRequest, AiModelInfo, AiModelsResponse, AiQueryExpandRequest, AiQueryExpandResponse,
    OpenAiModelsApiResponse,
};
use crate::state::AppState;
use std::time::Duration;
use tauri::Runtime;
use tokio_util::sync::CancellationToken;

#[cfg(not(coverage))]
use tauri::State;

/// Spawn a streaming AI chat completion task. Returns immediately.
///
/// The task reads the SSE stream from the configured endpoint and emits
/// `ai-stream-chunk`, `ai-stream-done`, or `ai-stream-error` events.
pub async fn ai_chat_impl<R: Runtime>(
    state: &AppState,
    app_handle: tauri::AppHandle<R>,
    request: AiChatRequest,
) -> Result<(), String> {
    let stream_id = request.stream_id.clone();
    let token = CancellationToken::new();

    // Store the cancellation token so `ai_cancel` can find it.
    {
        let mut map = state
            .ai_requests
            .lock()
            .map_err(|e| format!("Failed to lock ai_requests: {e}"))?;
        map.insert(stream_id.clone(), token.clone());
    }

    let ai_requests = state.ai_requests.clone();
    let task_token = token.clone();

    tokio::task::spawn(async move {
        let _ = stream_chat_completion(&app_handle, request, task_token).await;

        // Clean up the token from state when done (whether success, error, or cancel).
        if let Ok(mut map) = ai_requests.lock() {
            map.remove(&stream_id);
        }
    });

    Ok(())
}

/// Cancel an in-progress AI chat stream by its stream ID.
pub fn ai_cancel_impl(state: &AppState, stream_id: String) -> Result<(), String> {
    let mut map = state
        .ai_requests
        .lock()
        .map_err(|e| format!("Failed to lock ai_requests: {e}"))?;

    if let Some(token) = map.remove(&stream_id) {
        token.cancel();
        tracing::info!(stream_id = %stream_id, "AI stream cancelled");
    } else {
        tracing::info!(stream_id = %stream_id, "AI cancel: stream not found (may have already completed)");
    }

    Ok(())
}

// ── Thin Tauri command wrappers ────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub async fn ai_chat(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    request: AiChatRequest,
) -> Result<(), String> {
    ai_chat_impl(&state, app_handle, request).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn ai_cancel(state: State<'_, AppState>, stream_id: String) -> Result<(), String> {
    ai_cancel_impl(&state, stream_id)
}

// ── Model listing ─────────────────────────────────────────────────────────

/// Timeout for the model listing HTTP request (quick probe).
const LIST_MODELS_TIMEOUT: Duration = Duration::from_secs(5);

/// Timeout for the non-streaming query expansion request.
const QUERY_EXPAND_TIMEOUT: Duration = Duration::from_secs(60);

/// Connect timeout for the one-off retry client.
const QUERY_EXPAND_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// Heuristic keywords that indicate an embedding model.
const EMBEDDING_KEYWORDS: &[&str] = &["embed", "nomic", "bge", "e5-", "e5_", "minilm", "jina"];

/// Determine the category of a model (`"chat"` or `"embedding"`).
///
/// First checks server-provided metadata (type field, capabilities),
/// then falls back to a keyword heuristic on the model ID.
pub fn categorise_model(entry: &crate::ai::types::OpenAiModelEntry) -> String {
    // 1. Check server-provided `type` field
    if let Some(ref model_type) = entry.model_type {
        let mt = model_type.to_lowercase();
        if mt.contains("embed") {
            return "embedding".to_string();
        }
        if mt.contains("chat") || mt.contains("completion") || mt.contains("generate") {
            return "chat".to_string();
        }
    }

    // 2. Check capabilities object
    if let Some(ref caps) = entry.capabilities {
        if let Some(obj) = caps.as_object() {
            // Some servers expose { "embedding": true } or { "type": "embedding" }
            if obj.get("embedding").and_then(|v| v.as_bool()) == Some(true) {
                return "embedding".to_string();
            }
            if let Some(cap_type) = obj.get("type").and_then(|v| v.as_str()) {
                if cap_type.to_lowercase().contains("embed") {
                    return "embedding".to_string();
                }
            }
        }
    }

    // 3. Fall back to keyword heuristic on the model ID
    let id_lower = entry.id.to_lowercase();
    for keyword in EMBEDDING_KEYWORDS {
        if id_lower.contains(keyword) {
            return "embedding".to_string();
        }
    }

    "chat".to_string()
}

/// List available models from an OpenAI-compatible `/v1/models` endpoint.
///
/// Makes a GET request, parses the standard `{ "data": [{ "id": "..." }] }`
/// response, categorises each model, and returns a simplified list.
pub async fn list_ai_models_impl(endpoint_base: String) -> Result<AiModelsResponse, String> {
    let url = crate::ai::url::normalise_openai_url(&endpoint_base, "models");

    tracing::info!(url = %url, "listing AI models");

    let client = reqwest::Client::builder()
        .timeout(LIST_MODELS_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to model endpoint: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());
        return Err(format!("HTTP {status}: {body}"));
    }

    let api_response: OpenAiModelsApiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse models response: {e}"))?;

    let models = api_response
        .data
        .iter()
        .map(|entry| AiModelInfo {
            id: entry.id.clone(),
            name: None,
            category: categorise_model(entry),
        })
        .collect();

    Ok(AiModelsResponse { models })
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_ai_models(endpoint: String) -> Result<AiModelsResponse, String> {
    list_ai_models_impl(endpoint).await
}

// ── Query expansion (non-streaming) ───────────────────────────────────────

/// Non-streaming chat completion for query expansion.
///
/// Sends a single system+user message pair to the chat completions endpoint
/// and returns the assistant's response text.
///
/// Uses `state.http_client` first, then retries once with a fresh non-pooled
/// client if the initial send fails. This avoids intermittent failures from
/// stale keep-alive connections while still allowing longer local-model cold
/// starts to complete.
pub async fn ai_query_expand_impl(
    state: &AppState,
    req: AiQueryExpandRequest,
) -> Result<AiQueryExpandResponse, String> {
    tracing::info!(endpoint = %req.endpoint, model = %req.model, "query expansion request");

    // Build user message, optionally prepending conversation context.
    let effective_user_message = match &req.conversation_context {
        Some(ctx) if !ctx.is_empty() => format!("{ctx}\n\nCurrent question: {}", req.user_message),
        _ => req.user_message.clone(),
    };

    let body = serde_json::json!({
        "model": req.model,
        "messages": [
            { "role": "system", "content": req.system_prompt },
            { "role": "user", "content": effective_user_message },
        ],
        "stream": false,
    });

    let response = match send_query_expand_request(&state.http_client, &req.endpoint, &body).await {
        Ok(response) => response,
        Err(first_error) => {
            tracing::warn!(
                endpoint = %req.endpoint,
                model = %req.model,
                error = %first_error,
                timeout_secs = QUERY_EXPAND_TIMEOUT.as_secs(),
                "query expansion request failed on shared client; retrying with a fresh connection"
            );

            let retry_client = reqwest::Client::builder()
                .connect_timeout(QUERY_EXPAND_CONNECT_TIMEOUT)
                .pool_max_idle_per_host(0)
                .build()
                .map_err(|e| format!("Failed to create query expand retry client: {e}"))?;

            send_query_expand_request(&retry_client, &req.endpoint, &body)
                .await
                .map_err(|retry_error| {
                    if retry_error.is_timeout() {
                        format!(
                            "Query expand request timed out after {}s: {retry_error}",
                            QUERY_EXPAND_TIMEOUT.as_secs()
                        )
                    } else {
                        format!("Query expand HTTP request failed after retry: {retry_error}")
                    }
                })?
        }
    };

    let status = response.status();
    if !status.is_success() {
        let body_text = response
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());
        return Err(format!("HTTP {status}: {body_text}"));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse query expand response: {e}"))?;

    let text = json["choices"]
        .get(0)
        .and_then(|c| c["message"]["content"].as_str())
        .unwrap_or("")
        .to_string();

    Ok(AiQueryExpandResponse { text })
}

async fn send_query_expand_request(
    client: &reqwest::Client,
    endpoint: &str,
    body: &serde_json::Value,
) -> Result<reqwest::Response, reqwest::Error> {
    let chat_url = crate::ai::client::normalise_to_chat_completions_url(endpoint);
    client
        .post(&chat_url)
        .timeout(QUERY_EXPAND_TIMEOUT)
        .json(body)
        .send()
        .await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn ai_query_expand(
    state: State<'_, AppState>,
    req: AiQueryExpandRequest,
) -> Result<AiQueryExpandResponse, String> {
    ai_query_expand_impl(&state, req).await
}
