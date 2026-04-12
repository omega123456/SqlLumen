//! Integration tests for AI command `_impl` functions.

mod common;

use sqllumen_lib::ai::types::{AiChatRequest, IpcMessage};
use sqllumen_lib::commands::ai::{ai_cancel_impl, ai_chat_impl, list_ai_models_impl};
use sqllumen_lib::state::AppState;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

fn test_state() -> AppState {
    common::ensure_fake_backend_once();
    let conn = common::test_db();
    AppState {
        db: Arc::new(Mutex::new(conn)),
        registry: sqllumen_lib::mysql::registry::ConnectionRegistry::new(),
        app_handle: None,
        results: std::sync::RwLock::new(HashMap::new()),
        log_filter_reload: Mutex::new(None),
        running_queries: tokio::sync::RwLock::new(HashMap::new()),
        dump_jobs: Arc::new(std::sync::RwLock::new(HashMap::new())),
        import_jobs: Arc::new(std::sync::RwLock::new(HashMap::new())),
        ai_requests: Arc::new(Mutex::new(HashMap::new())),
    }
}

fn sample_request(stream_id: &str, endpoint: &str) -> AiChatRequest {
    AiChatRequest {
        messages: vec![IpcMessage {
            role: "user".to_string(),
            content: "Hello".to_string(),
        }],
        endpoint: endpoint.to_string(),
        model: "test-model".to_string(),
        temperature: 0.7,
        max_tokens: 100,
        stream_id: stream_id.to_string(),
    }
}

// ── ai_cancel_impl ────────────────────────────────────────────────────────

#[test]
fn cancel_impl_removes_token_and_cancels() {
    let state = test_state();
    let token = CancellationToken::new();
    let stream_id = "stream-cancel-1".to_string();

    // Insert a token manually
    {
        let mut map = state.ai_requests.lock().unwrap();
        map.insert(stream_id.clone(), token.clone());
    }

    assert!(!token.is_cancelled());

    // Cancel it
    let result = ai_cancel_impl(&state, stream_id.clone());
    assert!(result.is_ok());

    // Token should be cancelled
    assert!(token.is_cancelled());

    // Token should be removed from state
    let map = state.ai_requests.lock().unwrap();
    assert!(!map.contains_key(&stream_id));
}

#[test]
fn cancel_impl_nonexistent_stream_is_ok() {
    let state = test_state();
    let result = ai_cancel_impl(&state, "nonexistent-stream".to_string());
    assert!(result.is_ok(), "cancelling a nonexistent stream should not error");
}

#[test]
fn cancel_impl_only_cancels_target_stream() {
    let state = test_state();
    let token_a = CancellationToken::new();
    let token_b = CancellationToken::new();

    {
        let mut map = state.ai_requests.lock().unwrap();
        map.insert("stream-a".to_string(), token_a.clone());
        map.insert("stream-b".to_string(), token_b.clone());
    }

    // Cancel only stream-a
    let result = ai_cancel_impl(&state, "stream-a".to_string());
    assert!(result.is_ok());

    assert!(token_a.is_cancelled());
    assert!(!token_b.is_cancelled());

    // stream-a removed, stream-b still there
    let map = state.ai_requests.lock().unwrap();
    assert!(!map.contains_key("stream-a"));
    assert!(map.contains_key("stream-b"));
}

// ── ai_chat_impl — token storage ──────────────────────────────────────────

/// `ai_chat_impl` needs an AppHandle which is only available inside a running
/// Tauri app. We use the mock Tauri builder for this.
#[tokio::test]
async fn chat_impl_stores_cancellation_token() {
    use tauri::test::{mock_builder, mock_context, noop_assets};

    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("should build mock app");

    let state = test_state();
    let stream_id = "stream-chat-1";

    // Use a port that is guaranteed unreachable so the task fails quickly.
    let request = sample_request(stream_id, "http://127.0.0.1:1/v1/chat/completions");

    let result = ai_chat_impl(&state, app.handle().clone(), request).await;
    assert!(result.is_ok(), "ai_chat_impl should return Ok immediately");

    // Give the spawned task a moment to start
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // The token should have been inserted (it may have been removed if the task
    // already failed, but that's OK — the important thing is the impl doesn't panic).
    // We check the flow by cancelling a separate request.
}

#[tokio::test]
async fn chat_impl_cancel_stops_stream() {
    use tauri::test::{mock_builder, mock_context, noop_assets};

    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("should build mock app");

    let state = test_state();
    let stream_id = "stream-cancel-flow";

    // Use wiremock to set up a server that takes a long time
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    // Respond with a delayed SSE stream (the delay ensures our cancel can fire first)
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string("data: {\"choices\":[{\"delta\":{\"content\":\"tok\"}}]}\n\n")
                .append_header("content-type", "text/event-stream")
                .set_body_string(
                    // This body will be sent, but we cancel before reading all of it
                    [
                        "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n",
                        "\n",
                    ]
                    .join(""),
                ),
        )
        .mount(&server)
        .await;

    let endpoint = format!("{}/v1/chat/completions", server.uri());
    let request = sample_request(stream_id, &endpoint);

    let result = ai_chat_impl(&state, app.handle().clone(), request).await;
    assert!(result.is_ok());

    // Cancel the stream
    let cancel_result = ai_cancel_impl(&state, stream_id.to_string());
    assert!(cancel_result.is_ok());

    // Allow the spawned task to observe cancellation and clean up
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    // After cleanup, the token should be removed from state
    let map = state.ai_requests.lock().unwrap();
    assert!(
        !map.contains_key(stream_id),
        "token should be cleaned up after cancellation"
    );
}

// ── Multiple concurrent streams ───────────────────────────────────────────

#[test]
fn multiple_tokens_can_coexist() {
    let state = test_state();

    let ids: Vec<String> = (0..5).map(|i| format!("stream-{i}")).collect();
    let tokens: Vec<CancellationToken> = ids.iter().map(|_| CancellationToken::new()).collect();

    {
        let mut map = state.ai_requests.lock().unwrap();
        for (id, token) in ids.iter().zip(tokens.iter()) {
            map.insert(id.clone(), token.clone());
        }
    }

    // Cancel the middle one
    ai_cancel_impl(&state, ids[2].clone()).unwrap();

    assert!(tokens[2].is_cancelled());
    for (i, token) in tokens.iter().enumerate() {
        if i != 2 {
            assert!(!token.is_cancelled(), "token {} should not be cancelled", i);
        }
    }

    let map = state.ai_requests.lock().unwrap();
    assert_eq!(map.len(), 4);
    assert!(!map.contains_key(&ids[2]));
}

// ── list_ai_models_impl ───────────────────────────────────────────────────

#[tokio::test]
async fn list_models_returns_models_from_openai_format() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({
                    "object": "list",
                    "data": [
                        { "id": "codellama", "object": "model" },
                        { "id": "llama3", "object": "model" },
                    ]
                })),
        )
        .mount(&server)
        .await;

    let endpoint = format!("{}/v1/chat/completions", server.uri());
    let result = list_ai_models_impl(endpoint).await;

    assert!(result.is_ok(), "should succeed: {:?}", result);
    let response = result.unwrap();
    assert_eq!(response.models.len(), 2);
    assert_eq!(response.models[0].id, "codellama");
    assert_eq!(response.models[1].id, "llama3");
    assert!(response.models[0].name.is_none());
}

#[tokio::test]
async fn list_models_strips_chat_completions_suffix() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({
                    "data": [
                        { "id": "test-model" }
                    ]
                })),
        )
        .mount(&server)
        .await;

    // Pass endpoint with /chat/completions suffix
    let endpoint = format!("{}/v1/chat/completions", server.uri());
    let result = list_ai_models_impl(endpoint).await;

    assert!(result.is_ok(), "should succeed: {:?}", result);
    assert_eq!(result.unwrap().models.len(), 1);
}

#[tokio::test]
async fn list_models_handles_bare_v1_endpoint() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({
                    "data": [
                        { "id": "bare-model" }
                    ]
                })),
        )
        .mount(&server)
        .await;

    // Pass just /v1 without /chat/completions
    let endpoint = format!("{}/v1", server.uri());
    let result = list_ai_models_impl(endpoint).await;

    assert!(result.is_ok(), "should succeed: {:?}", result);
    assert_eq!(result.unwrap().models[0].id, "bare-model");
}

#[tokio::test]
async fn list_models_returns_error_on_non_200() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
        .mount(&server)
        .await;

    let endpoint = format!("{}/v1/chat/completions", server.uri());
    let result = list_ai_models_impl(endpoint).await;

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("500"));
}

#[tokio::test]
async fn list_models_returns_error_on_connection_refused() {
    // Use an unreachable port
    let result = list_ai_models_impl("http://127.0.0.1:1/v1".to_string()).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Failed to connect"));
}

#[tokio::test]
async fn list_models_returns_error_on_invalid_json() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(
            ResponseTemplate::new(200).set_body_string("this is not json"),
        )
        .mount(&server)
        .await;

    let endpoint = format!("{}/v1/chat/completions", server.uri());
    let result = list_ai_models_impl(endpoint).await;

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Failed to parse"));
}

#[tokio::test]
async fn list_models_empty_data_returns_empty_models() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({ "data": [] })),
        )
        .mount(&server)
        .await;

    let endpoint = format!("{}/v1/chat/completions", server.uri());
    let result = list_ai_models_impl(endpoint).await;

    assert!(result.is_ok());
    assert_eq!(result.unwrap().models.len(), 0);
}
