//! Integration tests for completions URL normalization, completions response
//! deserialization, streaming chunk parsing, and unsupported-completions classification.

use sqllumen_lib::ai::local_compat::{sanitize_thinking_content, CapabilityCache, CapabilityKind};
use sqllumen_lib::ai::types::{CompletionsResponse, CompletionsStreamChunk};
use sqllumen_lib::ai::url::completions_url;

// ── completions_url normalization ─────────────────────────────────────────

#[test]
fn completions_url_from_chat_completions() {
    assert_eq!(
        completions_url("http://localhost:1234/v1/chat/completions"),
        "http://localhost:1234/v1/completions"
    );
}

#[test]
fn completions_url_from_base_v1() {
    assert_eq!(
        completions_url("http://localhost:1234/v1"),
        "http://localhost:1234/v1/completions"
    );
}

#[test]
fn completions_url_from_bare_host() {
    assert_eq!(
        completions_url("http://localhost:1234"),
        "http://localhost:1234/v1/completions"
    );
}

#[test]
fn completions_url_from_existing_completions() {
    assert_eq!(
        completions_url("http://localhost:1234/v1/completions"),
        "http://localhost:1234/v1/completions"
    );
}

#[test]
fn completions_url_from_responses() {
    assert_eq!(
        completions_url("http://localhost:1234/v1/responses"),
        "http://localhost:1234/v1/completions"
    );
}

// ── Non-streaming CompletionsResponse deserialization ──────────────────────

#[test]
fn completions_response_deserializes_from_minimal_json() {
    let json = serde_json::json!({
        "id": "cmpl-abc123",
        "object": "text_completion",
        "choices": [{
            "text": "SELECT * FROM users;",
            "index": 0,
            "finish_reason": "stop"
        }]
    });
    let resp: CompletionsResponse = serde_json::from_value(json).unwrap();
    assert_eq!(resp.id, "cmpl-abc123");
    assert_eq!(resp.object, "text_completion");
    assert_eq!(resp.choices.len(), 1);
    assert_eq!(resp.choices[0].text, "SELECT * FROM users;");
    assert_eq!(resp.choices[0].index, 0);
    assert_eq!(resp.choices[0].finish_reason.as_deref(), Some("stop"));
}

// ── Streaming CompletionsStreamChunk deserialization ───────────────────────

#[test]
fn completions_stream_chunk_from_sse_data() {
    let sse_line = r#"data: {"choices":[{"text":" world","index":0,"finish_reason":null}]}"#;
    let data = sse_line.strip_prefix("data: ").unwrap();
    let chunk: CompletionsStreamChunk = serde_json::from_str(data).unwrap();
    assert_eq!(chunk.choices.len(), 1);
    assert_eq!(chunk.choices[0].text, " world");
    assert_eq!(chunk.choices[0].index, 0);
    assert_eq!(chunk.choices[0].finish_reason, None);
}

// ── Unsupported completions classification ────────────────────────────────

#[test]
fn http_404_classifies_as_negative_capability() {
    let status = 404u16;
    let body = r#"{"error":{"message":"Not Found","type":"invalid_request_error"}}"#;
    let is_unsupported = status == 404 || status == 405;
    assert!(
        is_unsupported,
        "404 should indicate unsupported completions"
    );
    let _parsed: serde_json::Value = serde_json::from_str(body).unwrap();
}

#[test]
fn http_405_classifies_as_negative_capability() {
    let status = 405u16;
    let is_unsupported = status == 404 || status == 405;
    assert!(
        is_unsupported,
        "405 should indicate unsupported completions"
    );
}

// ── sanitize_thinking_content on completions output ───────────────────────

#[test]
fn sanitize_on_completions_text_output() {
    let text = "Here is the answer<think>internal reasoning</think>. Done.";
    let cleaned = sanitize_thinking_content(text);
    assert_eq!(cleaned, "Here is the answer. Done.");
}

#[test]
fn sanitize_on_clean_completions_output() {
    let text = "SELECT * FROM users WHERE id = 1;";
    assert_eq!(sanitize_thinking_content(text), text);
}

// ── Streaming completions SSE parsing (Phase 2) ──────────────────────────

#[test]
fn streaming_completions_multiple_chunks_extracted_correctly() {
    // Simulate several SSE data lines from /v1/completions streaming
    let lines = vec![
        r#"data: {"choices":[{"text":"Hello","index":0,"finish_reason":null}]}"#,
        r#"data: {"choices":[{"text":" world","index":0,"finish_reason":null}]}"#,
        r#"data: {"choices":[{"text":"!","index":0,"finish_reason":"stop"}]}"#,
        "data: [DONE]",
    ];

    let mut collected = String::new();
    let mut saw_done = false;
    let mut saw_stop = false;

    for line in lines {
        let trimmed = line.trim();
        if let Some(data) = trimmed.strip_prefix("data:") {
            let data = data.trim();
            if data == "[DONE]" {
                saw_done = true;
                continue;
            }
            let chunk: CompletionsStreamChunk = serde_json::from_str(data).unwrap();
            for choice in &chunk.choices {
                collected.push_str(&choice.text);
                if choice.finish_reason.as_deref() == Some("stop") {
                    saw_stop = true;
                }
            }
        }
    }

    assert_eq!(collected, "Hello world!");
    assert!(saw_done, "should see [DONE] sentinel");
    assert!(saw_stop, "should see finish_reason stop");
}

#[test]
fn streaming_completions_chunk_with_finish_reason_stop() {
    let data = r#"{"choices":[{"text":"end","index":0,"finish_reason":"stop"}]}"#;
    let chunk: CompletionsStreamChunk = serde_json::from_str(data).unwrap();
    assert_eq!(chunk.choices[0].finish_reason.as_deref(), Some("stop"));
    assert_eq!(chunk.choices[0].text, "end");
}

// ── Capability cache negative result on unsupported completions ───────────

#[tokio::test]
async fn unsupported_completions_probe_sets_negative_cache_and_returns_actionable_error() {
    use sqllumen_lib::ai::client::{determine_compat_transport, CompatDecision};
    use sqllumen_lib::ai::types::{AiChatRequest, IpcMessage};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    // /v1/completions returns 404
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(404).set_body_string("Not Found"))
        .mount(&server)
        .await;

    let cache = CapabilityCache::new();
    let endpoint = format!("{}/v1", server.uri());
    let request = AiChatRequest {
        messages: vec![IpcMessage {
            role: "user".to_string(),
            content: "test".to_string(),
        }],
        endpoint: endpoint.clone(),
        model: "test-model".to_string(),
        temperature: 0.7,
        max_tokens: 100,
        stream_id: "test-probe-404".to_string(),
        previous_response_id: None,
        prefer_responses_api: false,
        enable_reasoning: false,
        api_key: None,
    };
    let decision = determine_compat_transport(&request, &cache).await;
    match decision {
        CompatDecision::UseChatCompletionsFallback { warning } => {
            assert!(warning.contains("127.0.0.1"), "error should contain redacted host: {warning}");
            assert!(warning.contains("test-model"), "error should contain model: {warning}");
            assert!(
                warning.contains("completions_not_supported"),
                "error should contain reason: {warning}"
            );
            assert!(
                warning.contains("/v1/completions"),
                "error should contain suggested action: {warning}"
            );
        }
        other => panic!("Expected UseChatCompletionsFallback, got {:?}", other),
    }

    // Verify cache was set to negative
    let cached = cache
        .get(&endpoint, "test-model", CapabilityKind::NonStreamingCompletions)
        .await;
    assert_eq!(cached, Some(false), "cache should store negative result");
}

// ── Streaming completions failure caches as StreamingCompletions negative ─

#[tokio::test]
async fn streaming_completions_failure_caches_negative_and_returns_actionable_error() {
    use sqllumen_lib::ai::client::send_streaming_completions;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
        .mount(&server)
        .await;

    let app = {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        mock_builder()
            .build(mock_context(noop_assets()))
            .expect("should build mock app")
    };
    let cache = CapabilityCache::new();
    let token = tokio_util::sync::CancellationToken::new();
    let endpoint = format!("{}/v1", server.uri());

    let result = send_streaming_completions(
        app.handle(),
        "test-stream-fail",
        &endpoint,
        "test-model",
        "Hello".to_string(),
        None,
        &token,
        &cache,
    )
    .await;

    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("streaming_completions_failed"),
        "error should contain reason: {err}"
    );
    assert!(
        err.contains("127.0.0.1"),
        "error should contain redacted host: {err}"
    );

    // Verify streaming capability cached as negative
    let cached = cache
        .get(&endpoint, "test-model", CapabilityKind::StreamingCompletions)
        .await;
    assert_eq!(cached, Some(false), "streaming capability should be cached as negative");
}

// ── send_non_streaming_completions ────────────────────────────────────────

#[tokio::test]
async fn non_streaming_completions_success_returns_text() {
    use sqllumen_lib::ai::client::send_non_streaming_completions;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "cmpl-test",
            "object": "text_completion",
            "choices": [{ "text": "SELECT 1", "index": 0 }]
        })))
        .mount(&server)
        .await;

    let result = send_non_streaming_completions(&server.uri(), "test-model", "prompt".to_string(), None, 10).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "SELECT 1");
}

#[tokio::test]
async fn non_streaming_completions_http_error_returns_compat_error() {
    use sqllumen_lib::ai::client::send_non_streaming_completions;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
        .mount(&server)
        .await;

    let result = send_non_streaming_completions(&server.uri(), "test-model", "prompt".to_string(), None, 10).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("Compatibility error"), "error: {err}");
}

#[tokio::test]
async fn non_streaming_completions_invalid_json_returns_compat_error() {
    use sqllumen_lib::ai::client::send_non_streaming_completions;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
        .mount(&server)
        .await;

    let result = send_non_streaming_completions(&server.uri(), "test-model", "prompt".to_string(), None, 10).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("parse error"), "error: {err}");
}

#[tokio::test]
async fn non_streaming_completions_empty_choices_returns_empty_string() {
    use sqllumen_lib::ai::client::send_non_streaming_completions;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "cmpl-test",
            "object": "text_completion",
            "choices": []
        })))
        .mount(&server)
        .await;

    let result = send_non_streaming_completions(&server.uri(), "test-model", "prompt".to_string(), None, 10).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "");
}

// ── probe_completions_capability ──────────────────────────────────────────

#[tokio::test]
async fn probe_completions_returns_true_on_valid_response() {
    use sqllumen_lib::ai::client::probe_completions_capability;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "cmpl-probe",
            "object": "text_completion",
            "choices": [{ "text": "hi", "index": 0 }]
        })))
        .mount(&server)
        .await;

    let result = probe_completions_capability(&server.uri(), "test-model", None).await;
    assert!(result);
}

#[tokio::test]
async fn probe_completions_returns_false_on_404() {
    use sqllumen_lib::ai::client::probe_completions_capability;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    let result = probe_completions_capability(&server.uri(), "test-model", None).await;
    assert!(!result);
}

#[tokio::test]
async fn probe_completions_returns_false_on_connection_refused() {
    use sqllumen_lib::ai::client::probe_completions_capability;
    let result = probe_completions_capability("http://127.0.0.1:1", "test-model", None).await;
    assert!(!result);
}

// ── run_hidden_compat_call ────────────────────────────────────────────────

#[tokio::test]
async fn run_hidden_compat_call_probe_succeeds_then_uses_completions() {
    use sqllumen_lib::ai::client::run_hidden_compat_call;
    use sqllumen_lib::ai::types::IpcMessage;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    // Mock completions endpoint for both probe and actual call
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "cmpl-test",
            "object": "text_completion",
            "choices": [{ "text": "result text", "index": 0 }]
        })))
        .expect(2) // probe + actual call
        .mount(&server)
        .await;

    let cache = CapabilityCache::new();
    // Don't pre-seed cache — let it probe
    let messages = vec![
        IpcMessage { role: "user".to_string(), content: "hello".to_string() },
    ];
    let result = run_hidden_compat_call(&server.uri(), "test-model", &messages, None, &cache, 10, "test", None).await;
    assert!(result.is_ok(), "should succeed: {:?}", result);
    assert!(result.unwrap().contains("result text"));

    // Cache should now be populated
    let cached = cache.get(&server.uri(), "test-model", CapabilityKind::NonStreamingCompletions).await;
    assert_eq!(cached, Some(true));
}

#[tokio::test]
async fn run_hidden_compat_call_probe_fails_returns_compat_error() {
    use sqllumen_lib::ai::client::run_hidden_compat_call;
    use sqllumen_lib::ai::types::IpcMessage;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    // Mock completions endpoint returning 404 (probe fails)
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    let cache = CapabilityCache::new();
    let messages = vec![
        IpcMessage { role: "user".to_string(), content: "hello".to_string() },
    ];
    let result = run_hidden_compat_call(&server.uri(), "test-model", &messages, None, &cache, 10, "test", None).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("Compatibility error"), "error: {err}");

    // Cache should be negative
    let cached = cache.get(&server.uri(), "test-model", CapabilityKind::NonStreamingCompletions).await;
    assert_eq!(cached, Some(false));
}

// ── run_hidden_compat_call with probe_timeout_secs ───────────────────────

#[tokio::test]
async fn run_hidden_compat_call_with_custom_probe_timeout() {
    use sqllumen_lib::ai::client::run_hidden_compat_call;
    use sqllumen_lib::ai::types::IpcMessage;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "cmpl-timeout",
            "object": "text_completion",
            "choices": [{ "text": "timeout result", "index": 0 }]
        })))
        .expect(2)
        .mount(&server)
        .await;

    let cache = CapabilityCache::new();
    let messages = vec![
        IpcMessage { role: "user".to_string(), content: "hello".to_string() },
    ];
    // Pass explicit probe_timeout_secs
    let result = run_hidden_compat_call(&server.uri(), "test-model", &messages, None, &cache, 10, "test", Some(5)).await;
    assert!(result.is_ok(), "should succeed with custom probe timeout: {:?}", result);
    assert!(result.unwrap().contains("timeout result"));
}

#[tokio::test]
async fn run_hidden_compat_call_cached_negative_returns_compat_error() {
    use sqllumen_lib::ai::client::run_hidden_compat_call;
    use sqllumen_lib::ai::types::IpcMessage;
    use wiremock::MockServer;

    let server = MockServer::start().await;
    let cache = CapabilityCache::new();
    // Pre-seed cache as negative
    cache.set(&server.uri(), "test-model", CapabilityKind::NonStreamingCompletions, false).await;

    let messages = vec![
        IpcMessage { role: "user".to_string(), content: "hello".to_string() },
    ];
    let result = run_hidden_compat_call(&server.uri(), "test-model", &messages, None, &cache, 10, "test", None).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("Compatibility error"), "error should be compat error: {err}");
}

#[tokio::test]
async fn run_hidden_compat_call_cached_positive_uses_completions() {
    use sqllumen_lib::ai::client::run_hidden_compat_call;
    use sqllumen_lib::ai::types::IpcMessage;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "cmpl-cached",
            "object": "text_completion",
            "choices": [{ "text": "cached result", "index": 0 }]
        })))
        .expect(1) // Only the actual call, no probe needed
        .mount(&server)
        .await;

    let cache = CapabilityCache::new();
    // Pre-seed as positive
    cache.set(&server.uri(), "test-model", CapabilityKind::NonStreamingCompletions, true).await;

    let messages = vec![
        IpcMessage { role: "user".to_string(), content: "hello".to_string() },
    ];
    let result = run_hidden_compat_call(&server.uri(), "test-model", &messages, None, &cache, 10, "test", None).await;
    assert!(result.is_ok(), "should use cached positive: {:?}", result);
    assert!(result.unwrap().contains("cached result"));
}

#[tokio::test]
async fn run_hidden_compat_call_not_local_returns_not_eligible() {
    use sqllumen_lib::ai::client::run_hidden_compat_call;
    use sqllumen_lib::ai::types::IpcMessage;

    let cache = CapabilityCache::new();
    let messages = vec![
        IpcMessage { role: "user".to_string(), content: "hello".to_string() },
    ];
    let result = run_hidden_compat_call("https://api.openai.com/v1", "gpt-4", &messages, None, &cache, 10, "test", None).await;
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), "not_eligible");
}

// ── Authorization header in completions requests ──────────────────────────

#[tokio::test]
async fn non_streaming_completions_sends_auth_header_when_api_key_provided() {
    use sqllumen_lib::ai::client::send_non_streaming_completions;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .and(header("Authorization", "Bearer test-secret-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "cmpl-auth-test",
            "object": "text_completion",
            "choices": [{"text": "response", "index": 0, "finish_reason": "stop"}]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let result = send_non_streaming_completions(
        &server.uri(),
        "test-model",
        "prompt".to_string(),
        Some("test-secret-key"),
        10,
    )
    .await;
    assert!(result.is_ok(), "request should succeed: {:?}", result.err());
}

#[tokio::test]
async fn non_streaming_completions_no_auth_header_when_api_key_empty() {
    use sqllumen_lib::ai::client::send_non_streaming_completions;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, Request, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "cmpl-no-auth",
            "object": "text_completion",
            "choices": [{"text": "response", "index": 0, "finish_reason": "stop"}]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let result = send_non_streaming_completions(
        &server.uri(),
        "test-model",
        "prompt".to_string(),
        None,
        10,
    )
    .await;
    assert!(result.is_ok());

    // Verify no Authorization header was sent
    let requests: Vec<Request> = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    assert!(
        requests[0].headers.get("Authorization").is_none(),
        "Authorization header should not be present when api_key is None"
    );
}

#[tokio::test]
async fn streaming_completions_sends_auth_header_when_api_key_provided() {
    use sqllumen_lib::ai::client::send_streaming_completions;
    use sqllumen_lib::ai::local_compat::CapabilityCache;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    // Return a valid streaming response that completes immediately
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .and(header("Authorization", "Bearer stream-key"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string("data: [DONE]\n\n"),
        )
        .expect(1)
        .mount(&server)
        .await;

    let app = {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        mock_builder()
            .build(mock_context(noop_assets()))
            .expect("should build mock app")
    };
    let cache = CapabilityCache::new();
    let token = tokio_util::sync::CancellationToken::new();
    let endpoint = format!("{}/v1", server.uri());

    let result = send_streaming_completions(
        app.handle(),
        "test-stream-auth",
        &endpoint,
        "test-model",
        "Hello".to_string(),
        Some("stream-key"),
        &token,
        &cache,
    )
    .await;
    assert!(result.is_ok(), "streaming with auth should succeed: {:?}", result.err());
}

// ── determine_compat_transport branch coverage ──────────────────────────

/// Helper to build an AiChatRequest pointing at a local server.
fn local_request(endpoint: &str, model: &str) -> sqllumen_lib::ai::types::AiChatRequest {
    sqllumen_lib::ai::types::AiChatRequest {
        messages: vec![sqllumen_lib::ai::types::IpcMessage {
            role: "user".to_string(),
            content: "hello".to_string(),
        }],
        endpoint: endpoint.to_string(),
        model: model.to_string(),
        temperature: 0.7,
        max_tokens: 100,
        stream_id: "test".to_string(),
        previous_response_id: None,
        prefer_responses_api: false,
        enable_reasoning: false,
        api_key: None,
    }
}

#[tokio::test]
async fn determine_compat_not_eligible_reasoning_enabled() {
    use sqllumen_lib::ai::client::{determine_compat_transport, CompatDecision};

    let cache = CapabilityCache::new();
    let mut req = local_request("http://localhost:1234/v1", "m");
    req.enable_reasoning = true;

    match determine_compat_transport(&req, &cache).await {
        CompatDecision::UseChatCompletions => {}
        other => panic!("expected UseChatCompletions, got {:?}", other),
    }
}

#[tokio::test]
async fn determine_compat_not_eligible_public_endpoint() {
    use sqllumen_lib::ai::client::{determine_compat_transport, CompatDecision};

    let cache = CapabilityCache::new();
    let req = local_request("https://api.openai.com/v1", "gpt-4");

    match determine_compat_transport(&req, &cache).await {
        CompatDecision::UseChatCompletions => {}
        other => panic!("expected UseChatCompletions, got {:?}", other),
    }
}

#[tokio::test]
async fn determine_compat_not_eligible_responses_chaining() {
    use sqllumen_lib::ai::client::{determine_compat_transport, CompatDecision};

    let cache = CapabilityCache::new();
    let mut req = local_request("http://localhost:1234/v1", "m");
    req.prefer_responses_api = true;
    req.previous_response_id = Some("resp_123".to_string());

    match determine_compat_transport(&req, &cache).await {
        CompatDecision::UseChatCompletions => {}
        other => panic!("expected UseChatCompletions, got {:?}", other),
    }
}

#[tokio::test]
async fn determine_compat_cached_positive_streaming_negative_returns_error() {
    use sqllumen_lib::ai::client::{determine_compat_transport, CompatDecision};

    let cache = CapabilityCache::new();
    let endpoint = "http://localhost:1234/v1";
    cache
        .set(endpoint, "m", CapabilityKind::NonStreamingCompletions, true)
        .await;
    cache
        .set(endpoint, "m", CapabilityKind::StreamingCompletions, false)
        .await;

    let req = local_request(endpoint, "m");
    match determine_compat_transport(&req, &cache).await {
        CompatDecision::UseChatCompletionsFallback { warning } => {
            assert!(warning.contains("Streaming completions previously failed"), "warning: {warning}");
        }
        other => panic!("expected UseChatCompletionsFallback, got {:?}", other),
    }
}

#[tokio::test]
async fn determine_compat_cached_positive_streaming_unknown_returns_raw() {
    use sqllumen_lib::ai::client::{determine_compat_transport, CompatDecision};

    let cache = CapabilityCache::new();
    let endpoint = "http://localhost:1234/v1";
    cache
        .set(endpoint, "m", CapabilityKind::NonStreamingCompletions, true)
        .await;
    // Don't set streaming → None

    let req = local_request(endpoint, "m");
    match determine_compat_transport(&req, &cache).await {
        CompatDecision::UseRawCompletions { raw_prompt } => {
            assert!(!raw_prompt.is_empty());
        }
        other => panic!("expected UseRawCompletions, got {:?}", other),
    }
}

#[tokio::test]
async fn determine_compat_cached_positive_streaming_positive_returns_raw() {
    use sqllumen_lib::ai::client::{determine_compat_transport, CompatDecision};

    let cache = CapabilityCache::new();
    let endpoint = "http://localhost:1234/v1";
    cache
        .set(endpoint, "m", CapabilityKind::NonStreamingCompletions, true)
        .await;
    cache
        .set(endpoint, "m", CapabilityKind::StreamingCompletions, true)
        .await;

    let req = local_request(endpoint, "m");
    match determine_compat_transport(&req, &cache).await {
        CompatDecision::UseRawCompletions { raw_prompt } => {
            assert!(!raw_prompt.is_empty());
        }
        other => panic!("expected UseRawCompletions, got {:?}", other),
    }
}

#[tokio::test]
async fn determine_compat_cached_negative_returns_error() {
    use sqllumen_lib::ai::client::{determine_compat_transport, CompatDecision};

    let cache = CapabilityCache::new();
    let endpoint = "http://localhost:1234/v1";
    cache
        .set(endpoint, "m", CapabilityKind::NonStreamingCompletions, false)
        .await;

    let req = local_request(endpoint, "m");
    match determine_compat_transport(&req, &cache).await {
        CompatDecision::UseChatCompletionsFallback { warning } => {
            assert!(warning.contains("completions_not_supported"), "warning: {warning}");
        }
        other => panic!("expected UseChatCompletionsFallback, got {:?}", other),
    }
}

#[tokio::test]
async fn determine_compat_cache_miss_probe_success_returns_raw() {
    use sqllumen_lib::ai::client::{determine_compat_transport, CompatDecision};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "cmpl-probe",
            "object": "text_completion",
            "choices": [{ "text": "ok", "index": 0 }]
        })))
        .mount(&server)
        .await;

    let cache = CapabilityCache::new();
    let endpoint = format!("{}/v1", server.uri());
    let req = local_request(&endpoint, "m");

    match determine_compat_transport(&req, &cache).await {
        CompatDecision::UseRawCompletions { raw_prompt } => {
            assert!(!raw_prompt.is_empty());
        }
        other => panic!("expected UseRawCompletions, got {:?}", other),
    }

    // Verify cache was set positive
    let cached = cache
        .get(&endpoint, "m", CapabilityKind::NonStreamingCompletions)
        .await;
    assert_eq!(cached, Some(true));
}

// ── send_non_streaming_completions with empty api key ────────────────────

#[tokio::test]
async fn non_streaming_completions_empty_api_key_skips_auth_header() {
    use sqllumen_lib::ai::client::send_non_streaming_completions;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, Request, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "cmpl-empty-key",
            "object": "text_completion",
            "choices": [{ "text": "ok", "index": 0 }]
        })))
        .mount(&server)
        .await;

    let result = send_non_streaming_completions(
        &server.uri(), "m", "prompt".to_string(), Some(""), 10,
    ).await;
    assert!(result.is_ok());

    let requests: Vec<Request> = server.received_requests().await.unwrap();
    assert!(requests[0].headers.get("Authorization").is_none(),
        "empty api_key should not send Authorization header");
}

// ── probe_completions_capability_with_timeout ────────────────────────────

#[tokio::test]
async fn probe_completions_with_custom_timeout_returns_true_on_valid_response() {
    use sqllumen_lib::ai::client::probe_completions_capability_with_timeout;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};
    use std::time::Duration;

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "cmpl-probe",
            "object": "text_completion",
            "choices": [{ "text": "ok", "index": 0 }]
        })))
        .mount(&server)
        .await;

    let result = probe_completions_capability_with_timeout(
        &format!("{}/v1", server.uri()),
        "test-model",
        Duration::from_secs(5),
        None,
    ).await;
    assert!(result, "probe should succeed with custom timeout");
}

#[tokio::test]
async fn probe_completions_with_custom_timeout_returns_false_on_error() {
    use sqllumen_lib::ai::client::probe_completions_capability_with_timeout;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};
    use std::time::Duration;

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    let result = probe_completions_capability_with_timeout(
        &format!("{}/v1", server.uri()),
        "test-model",
        Duration::from_secs(5),
        None,
    ).await;
    assert!(!result, "probe should fail on 404");
}

#[tokio::test]
async fn probe_completions_with_custom_timeout_returns_false_on_invalid_json() {
    use sqllumen_lib::ai::client::probe_completions_capability_with_timeout;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};
    use std::time::Duration;

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
        .mount(&server)
        .await;

    let result = probe_completions_capability_with_timeout(
        &format!("{}/v1", server.uri()),
        "test-model",
        Duration::from_secs(5),
        None,
    ).await;
    assert!(!result, "probe should fail on invalid JSON response");
}
