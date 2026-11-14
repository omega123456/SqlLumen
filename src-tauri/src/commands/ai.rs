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

pub async fn ai_chat_impl<R: Runtime>(
    state: &AppState,
    app_handle: tauri::AppHandle<R>,
    request: AiChatRequest,
) -> Result<(), String> {
    let stream_id = request.stream_id.clone();
    let token = CancellationToken::new();

    {
        let mut map = state
            .ai_requests
            .lock()
            .map_err(|error| format!("Failed to lock ai_requests: {error}"))?;
        map.insert(stream_id.clone(), token.clone());
    }

    let ai_requests = state.ai_requests.clone();
    let task_token = token.clone();

    tokio::task::spawn(async move {
        let _ = stream_chat_completion(&app_handle, request, task_token).await;

        if let Ok(mut map) = ai_requests.lock() {
            map.remove(&stream_id);
        }
    });

    Ok(())
}

pub fn ai_cancel_impl(state: &AppState, stream_id: String) -> Result<(), String> {
    let mut map = state
        .ai_requests
        .lock()
        .map_err(|error| format!("Failed to lock ai_requests: {error}"))?;

    match map.remove(&stream_id) {
        Some(token) => {
            token.cancel();
            tracing::info!(stream_id = %stream_id, "AI stream cancelled");
        }
        None => {
            tracing::info!(stream_id = %stream_id, "AI cancel: stream not found (may have already completed)");
        }
    }

    Ok(())
}

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

const LIST_MODELS_TIMEOUT: Duration = Duration::from_secs(5);

const QUERY_EXPAND_TIMEOUT: Duration = Duration::from_secs(60);

const QUERY_EXPAND_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

const EMBEDDING_KEYWORDS: &[&str] = &["embed", "nomic", "bge", "e5-", "e5_", "minilm", "jina"];

const CHAT_MODEL_TYPE_MARKERS: [&str; 3] = ["chat", "completion", "generate"];

fn has_embedding_capability_flag(
    capabilities: &serde_json::Map<String, serde_json::Value>,
) -> bool {
    capabilities
        .get("embedding")
        .and_then(|value| value.as_bool())
        == Some(true)
}

fn has_embedding_capability_type(
    capabilities: &serde_json::Map<String, serde_json::Value>,
) -> bool {
    capabilities
        .get("type")
        .and_then(|value| value.as_str())
        .is_some_and(|capability_type| capability_type.to_lowercase().contains("embed"))
}

fn capabilities_declare_embedding(capabilities: Option<&serde_json::Value>) -> bool {
    let Some(capabilities) = capabilities.and_then(|value| value.as_object()) else {
        return false;
    };
    has_embedding_capability_flag(capabilities) || has_embedding_capability_type(capabilities)
}

pub fn categorise_model(entry: &crate::ai::types::OpenAiModelEntry) -> String {
    if let Some(ref model_type) = entry.model_type {
        let mt = model_type.to_lowercase();
        if mt.contains("embed") {
            return "embedding".to_string();
        }
        let names_chat_model = CHAT_MODEL_TYPE_MARKERS
            .iter()
            .any(|marker| mt.contains(marker));
        if names_chat_model {
            return "chat".to_string();
        }
    }

    if capabilities_declare_embedding(entry.capabilities.as_ref()) {
        return "embedding".to_string();
    }

    let id_lower = entry.id.to_lowercase();
    for keyword in EMBEDDING_KEYWORDS {
        if id_lower.contains(keyword) {
            return "embedding".to_string();
        }
    }

    "chat".to_string()
}

pub async fn list_ai_models_impl(endpoint_base: String) -> Result<AiModelsResponse, String> {
    let url = crate::ai::url::normalise_openai_url(&endpoint_base, "models");

    tracing::info!(url = %url, "listing AI models");

    let client = crate::http_client_builder()
        .timeout(LIST_MODELS_TIMEOUT)
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {error}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("Failed to connect to model endpoint: {error}"))?;

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
        .map_err(|error| format!("Failed to parse models response: {error}"))?;

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

pub async fn ai_query_expand_impl(
    state: &AppState,
    req: AiQueryExpandRequest,
) -> Result<AiQueryExpandResponse, String> {
    tracing::info!(endpoint = %req.endpoint, model = %req.model, "query expansion request");

    let effective_user_message = match &req.conversation_context {
        Some(context) if !context.is_empty() => {
            format!("{context}\n\nCurrent question: {}", req.user_message)
        }
        _ => req.user_message.clone(),
    };

    let mut body_obj = serde_json::json!({
        "model": req.model,
        "messages": [
            { "role": "system", "content": req.system_prompt },
            { "role": "user", "content": effective_user_message },
        ],
        "stream": false,
    })
    .as_object()
    .cloned()
    .unwrap_or_default();
    crate::ai::client::apply_reasoning_off_compatibility(&mut body_obj);
    let body = serde_json::Value::Object(body_obj);

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

            let retry_client = crate::http_client_builder()
                .connect_timeout(QUERY_EXPAND_CONNECT_TIMEOUT)
                .pool_max_idle_per_host(0)
                .build()
                .map_err(|error| format!("Failed to create query expand retry client: {error}"))?;

            send_query_expand_request(&retry_client, &req.endpoint, &body)
                .await
                .map_err(query_expand_retry_error_message)?
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
        .map_err(|error| format!("Failed to parse query expand response: {error}"))?;

    let text = json["choices"]
        .get(0)
        .and_then(|choice| choice["message"]["content"].as_str())
        .unwrap_or("")
        .to_string();

    Ok(AiQueryExpandResponse { text })
}

fn query_expand_retry_error_message(retry_error: reqwest::Error) -> String {
    if retry_error.is_timeout() {
        return format!(
            "Query expand request timed out after {}s: {retry_error}",
            QUERY_EXPAND_TIMEOUT.as_secs()
        );
    }
    format!("Query expand HTTP request failed after retry: {retry_error}")
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
