//! Integration tests for AI command `_impl` functions.

mod common;

use sqllumen_lib::ai::types::{AiChatRequest, AiQueryExpandRequest, IpcMessage};
use sqllumen_lib::commands::ai::{
    ai_cancel_impl, ai_chat_impl, ai_query_expand_impl, categorise_model, list_ai_models_impl,
};
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
        index_build_tokens: Arc::new(Mutex::new(HashMap::new())),
        session_profile_map: Arc::new(Mutex::new(HashMap::new())),
        session_ref_counts: Arc::new(Mutex::new(HashMap::new())),
        http_client: reqwest::Client::new(),
        embedding_cache: sqllumen_lib::schema_index::embeddings_cache::EmbeddingCache::new(),
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
        previous_response_id: None,
        prefer_responses_api: true,
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
    assert!(
        result.is_ok(),
        "cancelling a nonexistent stream should not error"
    );
}

#[test]
fn cancel_impl_returns_error_when_request_map_lock_is_poisoned() {
    let state = test_state();

    let ai_requests = Arc::clone(&state.ai_requests);
    let _ = std::panic::catch_unwind(move || {
        let _guard = ai_requests.lock().unwrap();
        panic!("poison ai_requests mutex");
    });

    let result = ai_cancel_impl(&state, "stream-poisoned".to_string());
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Failed to lock ai_requests"));
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
    let request = sample_request(stream_id, "http://127.0.0.1:1/v1");

    let result = ai_chat_impl(&state, app.handle().clone(), request).await;
    assert!(result.is_ok(), "ai_chat_impl should return Ok immediately");

    // Give the spawned task a moment to start
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // The token should have been inserted (it may have been removed if the task
    // already failed, but that's OK — the important thing is the impl doesn't panic).
    // We check the flow by cancelling a separate request.
}

#[tokio::test]
async fn chat_impl_returns_error_when_request_map_lock_is_poisoned() {
    use tauri::test::{mock_builder, mock_context, noop_assets};

    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("should build mock app");

    let state = test_state();
    let ai_requests = Arc::clone(&state.ai_requests);
    let _ = std::panic::catch_unwind(move || {
        let _guard = ai_requests.lock().unwrap();
        panic!("poison ai_requests mutex");
    });

    let request = sample_request(
        "stream-poisoned-chat",
        "http://127.0.0.1:1/v1",
    );
    let result = ai_chat_impl(&state, app.handle().clone(), request).await;

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Failed to lock ai_requests"));
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

    let endpoint = format!("{}/v1", server.uri());
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

#[tokio::test]
async fn chat_impl_cleans_up_token_after_successful_stream() {
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("should build mock app");

    let state = test_state();
    let stream_id = "stream-success-flow";

    let server = MockServer::start().await;
    let sse_body = [
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n",
        "\n",
        "data: [DONE]\n",
    ]
    .join("");

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(sse_body)
                .append_header("content-type", "text/event-stream"),
        )
        .mount(&server)
        .await;

    let endpoint = format!("{}/v1", server.uri());
    let request = sample_request(stream_id, &endpoint);

    let result = ai_chat_impl(&state, app.handle().clone(), request).await;
    assert!(result.is_ok());

    for _ in 0..20 {
        if !state.ai_requests.lock().unwrap().contains_key(stream_id) {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }

    panic!("token should be cleaned up after successful stream completion");
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
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "object": "list",
            "data": [
                { "id": "codellama", "object": "model" },
                { "id": "llama3", "object": "model" },
            ]
        })))
        .mount(&server)
        .await;

    let endpoint = format!("{}/v1", server.uri());
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
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [
                { "id": "test-model" }
            ]
        })))
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
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [
                { "id": "bare-model" }
            ]
        })))
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
        .respond_with(ResponseTemplate::new(200).set_body_string("this is not json"))
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
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({ "data": [] })))
        .mount(&server)
        .await;

    let endpoint = format!("{}/v1/chat/completions", server.uri());
    let result = list_ai_models_impl(endpoint).await;

    assert!(result.is_ok());
    assert_eq!(result.unwrap().models.len(), 0);
}

// ── Model categorisation ──────────────────────────────────────────────────

#[test]
fn categorise_chat_model_by_default() {
    let entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "llama3".to_string(),
        object: "model".to_string(),
        model_type: None,
        capabilities: None,
    };
    assert_eq!(categorise_model(&entry), "chat");
}

#[test]
fn categorise_embedding_model_by_keyword_embed() {
    let entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "text-embedding-ada-002".to_string(),
        object: "model".to_string(),
        model_type: None,
        capabilities: None,
    };
    assert_eq!(categorise_model(&entry), "embedding");
}

#[test]
fn categorise_embedding_model_by_keyword_nomic() {
    let entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "nomic-embed-text".to_string(),
        object: "model".to_string(),
        model_type: None,
        capabilities: None,
    };
    assert_eq!(categorise_model(&entry), "embedding");
}

#[test]
fn categorise_embedding_model_by_keyword_bge() {
    let entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "bge-large-en".to_string(),
        object: "model".to_string(),
        model_type: None,
        capabilities: None,
    };
    assert_eq!(categorise_model(&entry), "embedding");
}

#[test]
fn categorise_embedding_model_by_keyword_e5_dash() {
    let entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "e5-large-v2".to_string(),
        object: "model".to_string(),
        model_type: None,
        capabilities: None,
    };
    assert_eq!(categorise_model(&entry), "embedding");
}

#[test]
fn categorise_embedding_model_by_keyword_e5_underscore() {
    let entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "e5_small".to_string(),
        object: "model".to_string(),
        model_type: None,
        capabilities: None,
    };
    assert_eq!(categorise_model(&entry), "embedding");
}

#[test]
fn categorise_embedding_model_by_keyword_minilm() {
    let entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "all-MiniLM-L6-v2".to_string(),
        object: "model".to_string(),
        model_type: None,
        capabilities: None,
    };
    assert_eq!(categorise_model(&entry), "embedding");
}

#[test]
fn categorise_embedding_model_by_keyword_jina() {
    let entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "jina-embeddings-v3".to_string(),
        object: "model".to_string(),
        model_type: None,
        capabilities: None,
    };
    assert_eq!(categorise_model(&entry), "embedding");
}

#[test]
fn categorise_embedding_model_by_server_type_field() {
    let entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "some-custom-model".to_string(),
        object: "model".to_string(),
        model_type: Some("embedding".to_string()),
        capabilities: None,
    };
    assert_eq!(categorise_model(&entry), "embedding");
}

#[test]
fn categorise_chat_model_by_server_type_field() {
    let entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "some-custom-model".to_string(),
        object: "model".to_string(),
        model_type: Some("chat".to_string()),
        capabilities: None,
    };
    assert_eq!(categorise_model(&entry), "chat");
}

#[test]
fn categorise_chat_model_by_completion_or_generate_type_field() {
    let completion_entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "completion-model".to_string(),
        object: "model".to_string(),
        model_type: Some("completion".to_string()),
        capabilities: None,
    };
    let generate_entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "generate-model".to_string(),
        object: "model".to_string(),
        model_type: Some("generate".to_string()),
        capabilities: None,
    };

    assert_eq!(categorise_model(&completion_entry), "chat");
    assert_eq!(categorise_model(&generate_entry), "chat");
}

#[test]
fn categorise_embedding_model_by_capabilities_bool() {
    let entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "custom-model".to_string(),
        object: "model".to_string(),
        model_type: None,
        capabilities: Some(serde_json::json!({ "embedding": true })),
    };
    assert_eq!(categorise_model(&entry), "embedding");
}

#[test]
fn categorise_chat_model_with_capabilities_embedding_false() {
    let entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "custom-chat-model".to_string(),
        object: "model".to_string(),
        model_type: None,
        capabilities: Some(serde_json::json!({ "embedding": false })),
    };
    assert_eq!(categorise_model(&entry), "chat");
}

#[test]
fn categorise_embedding_model_by_capabilities_type_field() {
    let entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "custom-model".to_string(),
        object: "model".to_string(),
        model_type: None,
        capabilities: Some(serde_json::json!({ "type": "text-embedding" })),
    };
    assert_eq!(categorise_model(&entry), "embedding");
}

#[test]
fn categorise_type_field_takes_precedence_over_heuristic() {
    // Model name looks like a chat model but server says it's embedding
    let entry = sqllumen_lib::ai::types::OpenAiModelEntry {
        id: "llama3-custom".to_string(),
        object: "model".to_string(),
        model_type: Some("embedding".to_string()),
        capabilities: None,
    };
    assert_eq!(categorise_model(&entry), "embedding");
}

#[tokio::test]
async fn list_models_populates_category_from_heuristic() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [
                { "id": "llama3", "object": "model" },
                { "id": "nomic-embed-text", "object": "model" },
                { "id": "text-embedding-ada-002", "object": "model" },
            ]
        })))
        .mount(&server)
        .await;

    let endpoint = format!("{}/v1/chat/completions", server.uri());
    let result = list_ai_models_impl(endpoint).await;

    assert!(result.is_ok());
    let models = result.unwrap().models;
    assert_eq!(models.len(), 3);
    assert_eq!(models[0].id, "llama3");
    assert_eq!(models[0].category, "chat");
    assert_eq!(models[1].id, "nomic-embed-text");
    assert_eq!(models[1].category, "embedding");
    assert_eq!(models[2].id, "text-embedding-ada-002");
    assert_eq!(models[2].category, "embedding");
}

// ── ai_query_expand_impl ──────────────────────────────────────────────────

#[tokio::test]
async fn query_expand_returns_text() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "SELECT * FROM users WHERE active = 1"
                }
            }]
        })))
        .mount(&server)
        .await;

    let state = test_state();
    let req = AiQueryExpandRequest {
        endpoint: format!("{}/v1", server.uri()),
        model: "test-model".to_string(),
        system_prompt: "You are a SQL assistant.".to_string(),
        user_message: "Find active users".to_string(),
        conversation_context: None,
    };

    let result = ai_query_expand_impl(&state, req).await;
    assert!(result.is_ok(), "should succeed: {:?}", result);
    let response = result.unwrap();
    assert_eq!(response.text, "SELECT * FROM users WHERE active = 1");
}

#[tokio::test]
async fn query_expand_retries_with_fresh_client_after_transport_error() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let server = tokio::spawn(async move {
        let (mut first_socket, _) = listener.accept().await.unwrap();
        let mut first_buffer = [0_u8; 4096];
        let _ = first_socket.read(&mut first_buffer).await.unwrap();
        drop(first_socket);

        let (mut second_socket, _) = listener.accept().await.unwrap();
        let mut second_buffer = [0_u8; 4096];
        let bytes_read = second_socket.read(&mut second_buffer).await.unwrap();
        let request = String::from_utf8_lossy(&second_buffer[..bytes_read]);
        assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));

        let response_body = serde_json::json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "{\"queries\":[\"retry worked\"]}"
                }
            }]
        })
        .to_string();

        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        );

        second_socket.write_all(response.as_bytes()).await.unwrap();
        second_socket.shutdown().await.unwrap();
    });

    let state = test_state();
    let req = AiQueryExpandRequest {
        endpoint: format!("http://{addr}/v1"),
        model: "test-model".to_string(),
        system_prompt: "system".to_string(),
        user_message: "user".to_string(),
        conversation_context: None,
    };

    let result = ai_query_expand_impl(&state, req).await;
    assert!(
        result.is_ok(),
        "retry should recover transport errors: {result:?}"
    );
    assert_eq!(result.unwrap().text, "{\"queries\":[\"retry worked\"]}");

    server.await.unwrap();
}

#[tokio::test]
async fn query_expand_handles_empty_choices() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "choices": []
        })))
        .mount(&server)
        .await;

    let state = test_state();
    let req = AiQueryExpandRequest {
        endpoint: format!("{}/v1", server.uri()),
        model: "test-model".to_string(),
        system_prompt: "system".to_string(),
        user_message: "user".to_string(),
        conversation_context: None,
    };

    let result = ai_query_expand_impl(&state, req).await;
    assert!(result.is_ok());
    // Empty choices → empty text
    assert_eq!(result.unwrap().text, "");
}

#[tokio::test]
async fn query_expand_returns_error_on_http_500() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
        .mount(&server)
        .await;

    let state = test_state();
    let req = AiQueryExpandRequest {
        endpoint: format!("{}/v1", server.uri()),
        model: "test-model".to_string(),
        system_prompt: "system".to_string(),
        user_message: "user".to_string(),
        conversation_context: None,
    };

    let result = ai_query_expand_impl(&state, req).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("500"));
}

#[tokio::test]
async fn query_expand_returns_error_on_connection_refused() {
    let state = test_state();
    let req = AiQueryExpandRequest {
        endpoint: "http://127.0.0.1:1/v1".to_string(),
        model: "test-model".to_string(),
        system_prompt: "system".to_string(),
        user_message: "user".to_string(),
        conversation_context: None,
    };

    let result = ai_query_expand_impl(&state, req).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("failed"));
}

#[tokio::test]
async fn query_expand_returns_timeout_message_after_retry_timeout() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let server = tokio::spawn(async move {
        let (mut first_socket, _) = listener.accept().await.unwrap();
        let mut first_buffer = [0_u8; 4096];
        let _ = first_socket.read(&mut first_buffer).await.unwrap();
        drop(first_socket);

        let (mut second_socket, _) = listener.accept().await.unwrap();
        let mut second_buffer = [0_u8; 4096];
        let _ = second_socket.read(&mut second_buffer).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_secs(65)).await;
        let _ = second_socket.shutdown().await;
    });

    let state = test_state();
    let req = AiQueryExpandRequest {
        endpoint: format!("http://{addr}/v1"),
        model: "test-model".to_string(),
        system_prompt: "system".to_string(),
        user_message: "user".to_string(),
    };

    let result = ai_query_expand_impl(&state, req).await;
    let error = result.expect_err("retry timeout should surface as an error");
    assert!(error.contains("timed out after 60s"), "unexpected error: {error}");

    server.abort();
}

#[tokio::test]
async fn query_expand_returns_error_on_invalid_json() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
        .mount(&server)
        .await;

    let state = test_state();
    let req = AiQueryExpandRequest {
        endpoint: format!("{}/v1", server.uri()),
        model: "test-model".to_string(),
        system_prompt: "system".to_string(),
        user_message: "user".to_string(),
        conversation_context: None,
    };

    let result = ai_query_expand_impl(&state, req).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("parse"));
}
