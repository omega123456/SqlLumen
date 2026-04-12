//! Tauri commands for AI chat — streaming completions, cancellation, and model listing.

use crate::ai::client::stream_chat_completion;
use crate::ai::types::{
    AiChatRequest, AiModelInfo, AiModelsResponse, OpenAiModelsApiResponse,
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

/// Normalise an endpoint URL to a `/v1/models` path.
///
/// Strips any trailing `/chat/completions` and ensures the URL ends with `/v1/models`.
fn normalise_to_models_url(endpoint_base: &str) -> Result<String, String> {
    let mut base = endpoint_base.trim().trim_end_matches('/').to_string();

    // Strip /chat/completions suffix if present
    if base.ends_with("/chat/completions") {
        base = base[..base.len() - "/chat/completions".len()].to_string();
    }

    // Ensure base ends with /v1
    if !base.ends_with("/v1") {
        // If it doesn't end with /v1, append it
        base = format!("{}/v1", base.trim_end_matches('/'));
    }

    Ok(format!("{}/models", base))
}

/// List available models from an OpenAI-compatible `/v1/models` endpoint.
///
/// Makes a GET request, parses the standard `{ "data": [{ "id": "..." }] }`
/// response, and returns a simplified list of model IDs.
pub async fn list_ai_models_impl(endpoint_base: String) -> Result<AiModelsResponse, String> {
    let url = normalise_to_models_url(&endpoint_base)?;

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
        .into_iter()
        .map(|entry| AiModelInfo {
            id: entry.id,
            name: None,
        })
        .collect();

    Ok(AiModelsResponse { models })
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_ai_models(endpoint: String) -> Result<AiModelsResponse, String> {
    list_ai_models_impl(endpoint).await
}
