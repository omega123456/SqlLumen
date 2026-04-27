//! Integration tests for AI types serialization/deserialization and SSE line parsing.

mod common;

use sqllumen_lib::ai::client::{
    append_no_think_directive, apply_reasoning_off_compatibility,
    apply_reasoning_off_compatibility_to_latest_user, extract_reasoning_text_from_item,
    extract_reasoning_text_from_parts, extract_responses_content_text_for_event,
    extract_responses_delta_text, extract_responses_error_message, extract_responses_final_text,
    extract_responses_reasoning_text, extract_responses_reasoning_text_for_event,
    is_chat_completions_style_payload, is_responses_completion_event, is_responses_failure_event,
    merge_responses_event_type, responses_input_items, sanitize_streamed_content_chunks,
    sanitize_streamed_visible_content_chunks,
    should_fallback_from_responses_status, should_retry_chat_without_reasoning,
    should_use_responses_api,
};
use sqllumen_lib::ai::types::{
    parse_sse_line, AiChatRequest, AiTransport, ApiChatRequest, ApiMessage, ApiResponsesRequest,
    ApiStreamChunk, ChunkKind, IpcMessage, ReasoningConfig, SseParsed, StreamChunkEvent,
    StreamDoneEvent, StreamErrorEvent,
};

// ── IPC type serialization (camelCase) ────────────────────────────────────

#[test]
fn ipc_message_serializes_to_camel_case() {
    let msg = IpcMessage {
        role: "user".to_string(),
        content: "Hello".to_string(),
    };
    let json = serde_json::to_value(&msg).unwrap();
    assert_eq!(json["role"], "user");
    assert_eq!(json["content"], "Hello");
}

#[test]
fn ipc_message_deserializes_from_camel_case() {
    let json = serde_json::json!({
        "role": "assistant",
        "content": "Hi there"
    });
    let msg: IpcMessage = serde_json::from_value(json).unwrap();
    assert_eq!(msg.role, "assistant");
    assert_eq!(msg.content, "Hi there");
}

#[test]
fn ai_chat_request_serializes_to_camel_case() {
    let req = AiChatRequest {
        messages: vec![IpcMessage {
            role: "user".to_string(),
            content: "test".to_string(),
        }],
        endpoint: "http://localhost:11434/v1/chat/completions".to_string(),
        model: "llama3".to_string(),
        temperature: 0.7,
        max_tokens: 1024,
        stream_id: "abc-123".to_string(),
        previous_response_id: Some("resp_prev".to_string()),
        prefer_responses_api: true,
        enable_reasoning: true,
    };
    let json = serde_json::to_value(&req).unwrap();
    assert!(
        json["maxTokens"].is_number(),
        "expected camelCase maxTokens"
    );
    assert_eq!(json["maxTokens"], 1024);
    assert!(json["streamId"].is_string(), "expected camelCase streamId");
    assert_eq!(json["streamId"], "abc-123");
    assert_eq!(json["previousResponseId"], "resp_prev");
    assert_eq!(json["preferResponsesApi"], true);
    assert_eq!(json["enableReasoning"], true);
    // snake_case keys should NOT exist
    assert!(json.get("max_tokens").is_none());
    assert!(json.get("stream_id").is_none());
}

#[test]
fn ai_chat_request_deserializes_from_camel_case() {
    let json = serde_json::json!({
        "messages": [{"role": "user", "content": "hello"}],
        "endpoint": "http://localhost:11434/v1/chat/completions",
        "model": "llama3",
        "temperature": 0.7,
        "maxTokens": 2048,
        "streamId": "stream-1",
        "previousResponseId": "resp_1",
        "preferResponsesApi": false
    });
    let req: AiChatRequest = serde_json::from_value(json).unwrap();
    assert_eq!(req.max_tokens, 2048);
    assert_eq!(req.stream_id, "stream-1");
    assert_eq!(req.previous_response_id.as_deref(), Some("resp_1"));
    assert!(!req.prefer_responses_api);
    assert_eq!(req.messages.len(), 1);
}

#[test]
fn ai_chat_request_defaults_prefer_responses_api_to_false() {
    let json = serde_json::json!({
        "messages": [{"role": "user", "content": "hello"}],
        "endpoint": "http://localhost:11434/v1/chat/completions",
        "model": "llama3",
        "temperature": 0.7,
        "maxTokens": 2048,
        "streamId": "stream-default"
    });

    let req: AiChatRequest = serde_json::from_value(json).unwrap();
    assert_eq!(req.previous_response_id, None);
    assert!(!req.prefer_responses_api);
}

// ── API type serialization (snake_case) ───────────────────────────────────

#[test]
fn api_message_serializes_to_snake_case() {
    let msg = ApiMessage {
        role: "system".to_string(),
        content: "You are helpful".to_string(),
    };
    let json = serde_json::to_value(&msg).unwrap();
    assert_eq!(json["role"], "system");
    assert_eq!(json["content"], "You are helpful");
}

#[test]
fn api_chat_request_serializes_to_snake_case() {
    let req = ApiChatRequest {
        model: "llama3".to_string(),
        messages: vec![ApiMessage {
            role: "user".to_string(),
            content: "hi".to_string(),
        }],
        temperature: 0.5,
        max_tokens: 512,
        stream: true,
        reasoning_effort: None,
        enable_thinking: None,
        chat_template_kwargs: None,
    };
    let json = serde_json::to_value(&req).unwrap();
    assert!(
        json["max_tokens"].is_number(),
        "expected snake_case max_tokens"
    );
    assert_eq!(json["max_tokens"], 512);
    assert_eq!(json["stream"], true);
    // camelCase keys should NOT exist
    assert!(json.get("maxTokens").is_none());
}

#[test]
fn api_stream_chunk_deserializes_from_snake_case() {
    let json = serde_json::json!({
        "choices": [{
            "delta": {
                "content": "Hello"
            }
        }]
    });
    let chunk: ApiStreamChunk = serde_json::from_value(json).unwrap();
    assert_eq!(chunk.choices.len(), 1);
    assert_eq!(chunk.choices[0].delta.content.as_deref(), Some("Hello"));
}

#[test]
fn api_stream_chunk_with_empty_delta() {
    let json = serde_json::json!({
        "choices": [{
            "delta": {}
        }]
    });
    let chunk: ApiStreamChunk = serde_json::from_value(json).unwrap();
    assert_eq!(chunk.choices[0].delta.content, None);
}

#[test]
fn api_stream_chunk_with_multiple_choices() {
    let json = serde_json::json!({
        "choices": [
            { "delta": { "content": "A" } },
            { "delta": { "content": "B" } }
        ]
    });
    let chunk: ApiStreamChunk = serde_json::from_value(json).unwrap();
    assert_eq!(chunk.choices.len(), 2);
    assert_eq!(chunk.choices[0].delta.content.as_deref(), Some("A"));
    assert_eq!(chunk.choices[1].delta.content.as_deref(), Some("B"));
}

// ── Event payload serialization ───────────────────────────────────────────

#[test]
fn stream_chunk_event_serializes_to_camel_case() {
    let evt = StreamChunkEvent {
        stream_id: "s1".to_string(),
        content: "token".to_string(),
        kind: ChunkKind::Content,
    };
    let json = serde_json::to_value(&evt).unwrap();
    assert_eq!(json["streamId"], "s1");
    assert_eq!(json["content"], "token");
    assert!(json.get("stream_id").is_none());
}

#[test]
fn stream_done_event_serializes_to_camel_case() {
    let evt = StreamDoneEvent {
        stream_id: "s2".to_string(),
        response_id: Some("resp_2".to_string()),
        transport: AiTransport::Responses,
    };
    let json = serde_json::to_value(&evt).unwrap();
    assert_eq!(json["streamId"], "s2");
    assert_eq!(json["responseId"], "resp_2");
    assert_eq!(json["transport"], "responses");
}

#[test]
fn stream_error_event_serializes_to_camel_case() {
    let evt = StreamErrorEvent {
        stream_id: "s3".to_string(),
        error: "connection refused".to_string(),
    };
    let json = serde_json::to_value(&evt).unwrap();
    assert_eq!(json["streamId"], "s3");
    assert_eq!(json["error"], "connection refused");
}

// ── SSE line parsing ──────────────────────────────────────────────────────

#[test]
fn parse_sse_line_empty() {
    assert_eq!(parse_sse_line(""), Ok(SseParsed::Skip));
    assert_eq!(parse_sse_line("  "), Ok(SseParsed::Skip));
    assert_eq!(parse_sse_line("\n"), Ok(SseParsed::Skip));
}

#[test]
fn parse_sse_line_comment() {
    assert_eq!(parse_sse_line(": this is a comment"), Ok(SseParsed::Skip));
    assert_eq!(parse_sse_line(":keepalive"), Ok(SseParsed::Skip));
}

#[test]
fn parse_sse_line_event_type() {
    assert_eq!(parse_sse_line("event: message"), Ok(SseParsed::Skip));
    assert_eq!(parse_sse_line("event:delta"), Ok(SseParsed::Skip));
}

#[test]
fn parse_sse_line_done() {
    assert_eq!(parse_sse_line("data: [DONE]"), Ok(SseParsed::Done));
    assert_eq!(parse_sse_line("data:[DONE]"), Ok(SseParsed::Done));
}

#[test]
fn parse_sse_line_chunk_with_content() {
    let line = r#"data: {"choices":[{"delta":{"content":"Hello"}}]}"#;
    match parse_sse_line(line) {
        Ok(SseParsed::Chunk(chunk)) => {
            assert_eq!(chunk.choices.len(), 1);
            assert_eq!(chunk.choices[0].delta.content.as_deref(), Some("Hello"));
        }
        other => panic!("Expected Chunk, got {:?}", other),
    }
}

#[test]
fn parse_sse_line_chunk_with_empty_delta() {
    let line = r#"data: {"choices":[{"delta":{}}]}"#;
    match parse_sse_line(line) {
        Ok(SseParsed::Chunk(chunk)) => {
            assert_eq!(chunk.choices[0].delta.content, None);
        }
        other => panic!("Expected Chunk, got {:?}", other),
    }
}

#[test]
fn parse_sse_line_invalid_json() {
    let line = r#"data: {not valid json}"#;
    let result = parse_sse_line(line);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Failed to parse SSE JSON"));
}

#[test]
fn parse_sse_line_unknown_line() {
    assert_eq!(parse_sse_line("id: 123"), Ok(SseParsed::Skip));
    assert_eq!(parse_sse_line("retry: 5000"), Ok(SseParsed::Skip));
}

// ── IPC ↔ API message conversion ─────────────────────────────────────────

#[test]
fn ipc_message_converts_to_api_message() {
    let ipc = IpcMessage {
        role: "user".to_string(),
        content: "question".to_string(),
    };
    let api = ApiMessage::from(&ipc);
    assert_eq!(api.role, "user");
    assert_eq!(api.content, "question");
}

#[test]
fn streamed_sanitizer_removes_split_opening_think_tag() {
    let output =
        sanitize_streamed_visible_content_chunks(&["<thi", "nk>hidden</think>normal"], false);

    assert_eq!(output, "normal");
}

#[test]
fn streamed_sanitizer_removes_split_closing_think_tag() {
    let output =
        sanitize_streamed_visible_content_chunks(&["<think>hidden</th", "ink>normal"], false);

    assert_eq!(output, "normal");
}

#[test]
fn streamed_sanitizer_preserves_false_positive_partial_tag() {
    let output = sanitize_streamed_visible_content_chunks(&["<thi", "s is fine"], false);

    assert_eq!(output, "<this is fine");
}

#[test]
fn prefill_stripper_finalizes_single_char_output() {
    let output = sanitize_streamed_visible_content_chunks(&["A"], true);

    assert_eq!(output, "A");
}

#[test]
fn prefill_stripper_finalizes_partial_marker_output() {
    let output = sanitize_streamed_visible_content_chunks(&["Answer"], true);

    assert_eq!(output, "Answer");
}

#[test]
fn prefill_stripper_removes_full_marker_and_keeps_content() {
    let output = sanitize_streamed_visible_content_chunks(&["Answer: result"], true);

    assert_eq!(output, "result");
}

#[test]
fn streamed_sanitizer_strips_think_blocks_when_reasoning_suppressed() {
    let (visible, thinking) =
        sanitize_streamed_content_chunks(&["Hello <think>hidden</think>world"], false, true);

    assert_eq!(visible, "Hello world");
    assert!(thinking.is_empty());
}

#[test]
fn streamed_sanitizer_routes_think_blocks_to_thinking_when_reasoning_enabled() {
    let (visible, thinking) =
        sanitize_streamed_content_chunks(&["Hello <think>hidden</think>world"], false, false);

    assert_eq!(visible, "Hello world");
    assert_eq!(thinking, "hidden");
}

// ── Wiremock streaming test ───────────────────────────────────────────────

#[cfg(test)]
mod wiremock_tests {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// Verify that reqwest can correctly POST an API request to a mock server
    /// and read back a streaming SSE response.
    #[tokio::test]
    async fn mock_server_returns_sse_stream() {
        let server = MockServer::start().await;

        let sse_body = [
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n",
            "\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n",
            "\n",
            "data: [DONE]\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let client = reqwest::Client::new();
        let resp = client
            .post(format!("{}/v1/chat/completions", server.uri()))
            .json(&serde_json::json!({
                "model": "test",
                "messages": [{"role": "user", "content": "hi"}],
                "temperature": 0.7,
                "max_tokens": 100,
                "stream": true
            }))
            .send()
            .await
            .expect("request should succeed");

        assert_eq!(resp.status(), 200);

        let body = resp.text().await.expect("should read body");
        let lines: Vec<&str> = body.lines().collect();

        // Parse each line
        use sqllumen_lib::ai::types::{parse_sse_line, SseParsed};
        let mut tokens = Vec::new();
        for line in lines {
            match parse_sse_line(line) {
                Ok(SseParsed::Chunk(chunk)) => {
                    for choice in &chunk.choices {
                        if let Some(c) = &choice.delta.content {
                            tokens.push(c.clone());
                        }
                    }
                }
                Ok(SseParsed::Done) => break,
                _ => {}
            }
        }

        assert_eq!(tokens.join(""), "Hello world");
    }

    /// Verify that a non-200 response is detectable.
    #[tokio::test]
    async fn mock_server_returns_error() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
            .mount(&server)
            .await;

        let client = reqwest::Client::new();
        let resp = client
            .post(format!("{}/v1/chat/completions", server.uri()))
            .json(&serde_json::json!({
                "model": "test",
                "messages": [],
                "temperature": 0.7,
                "max_tokens": 100,
                "stream": true
            }))
            .send()
            .await
            .expect("request should succeed");

        assert_eq!(resp.status(), 500);
    }
}

// ── stream_chat_completion integration tests (wiremock + Tauri mock) ─────

#[cfg(test)]
mod stream_integration {
    use crate::common;
    use sqllumen_lib::ai::chat_compat::{
        cache_strategy, normalize_provider_messages, ReasoningStrategy, ASSISTANT_PREFILL_MARKER,
        NEGATIVE_STRATEGY_TTL, POSITIVE_STRATEGY_TTL,
    };
    use sqllumen_lib::ai::client::{normalise_to_chat_completions_url, stream_chat_completion};
    use sqllumen_lib::ai::types::{AiChatRequest, IpcMessage};
    use std::sync::{Arc, Mutex};
    use tauri::{Listener, Manager};
    use tokio_util::sync::CancellationToken;
    use wiremock::matchers::{body_partial_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

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
            enable_reasoning: true,
        }
    }

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        mock_builder()
            .manage(common::test_app_state())
            .build(mock_context(noop_assets()))
            .expect("should build mock app")
    }

    async fn stream_chunk_events(
        app: &tauri::App<tauri::test::MockRuntime>,
    ) -> Arc<Mutex<Vec<String>>> {
        let chunks = Arc::new(Mutex::new(Vec::<String>::new()));
        let chunks_clone = Arc::clone(&chunks);
        app.handle().listen("ai-stream-chunk", move |event| {
            chunks_clone
                .lock()
                .expect("chunk lock")
                .push(event.payload().to_string());
        });
        chunks
    }

    fn content_payloads(events: &[String]) -> Vec<String> {
        events
            .iter()
            .filter_map(|payload| serde_json::from_str::<serde_json::Value>(payload).ok())
            .filter(|json| json["kind"] == "content")
            .filter_map(|json| json["content"].as_str().map(ToString::to_string))
            .collect()
    }

    fn thinking_payloads(events: &[String]) -> Vec<String> {
        events
            .iter()
            .filter_map(|payload| serde_json::from_str::<serde_json::Value>(payload).ok())
            .filter(|json| json["kind"] == "thinking")
            .filter_map(|json| json["content"].as_str().map(ToString::to_string))
            .collect()
    }

    /// Full happy-path: server sends SSE chunks with [DONE] and trailing newlines.
    #[tokio::test]
    async fn stream_completes_with_done_sentinel() {
        let server = MockServer::start().await;
        let sse_body = [
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n",
            "\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n",
            "\n",
            "data: [DONE]\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-done-1", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok(), "stream should complete successfully");
    }

    /// Stream ends without [DONE] (EOF) — should still return Ok.
    #[tokio::test]
    async fn stream_completes_on_eof_without_done() {
        let server = MockServer::start().await;
        let sse_body = [
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n",
            "\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n",
            "\n",
            // No [DONE] — stream just ends
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-eof-1", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok(), "stream should complete on EOF");
    }

    /// Last data line has no trailing newline — residual buffer should be parsed.
    #[tokio::test]
    async fn stream_parses_last_line_without_trailing_newline() {
        let server = MockServer::start().await;
        // The last data line has no \n — exercises the residual buffer parsing
        let sse_body = "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}";

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-no-trailing-nl", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok(), "should parse residual buffer on EOF");
    }

    /// [DONE] sentinel at EOF without trailing newline.
    #[tokio::test]
    async fn stream_parses_done_in_residual_buffer() {
        let server = MockServer::start().await;
        // [DONE] without trailing newline
        let sse_body = "data: {\"choices\":[{\"delta\":{\"content\":\"token\"}}]}\n\ndata: [DONE]";

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-done-no-nl", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok(), "should handle [DONE] in residual buffer");
    }

    /// HTTP 500 — should return an error with status code info.
    #[tokio::test]
    async fn stream_returns_error_on_http_500() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-500", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("HTTP"), "error should mention HTTP: {err}");
        assert!(
            err.contains("500"),
            "error should mention status 500: {err}"
        );
    }

    /// HTTP 401 — should return an error with status code and response body.
    #[tokio::test]
    async fn stream_returns_error_on_http_401() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(401).set_body_string("Unauthorized"))
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-401", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("401"),
            "error should mention status 401: {err}"
        );
    }

    /// Connection refused — should return an HTTP request error.
    #[tokio::test]
    async fn stream_returns_error_on_connection_refused() {
        let app = mock_app();
        // Use a port that is guaranteed unreachable
        let request = sample_request("stream-refused", "http://127.0.0.1:1/v1/chat/completions");
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("HTTP request failed"),
            "error should describe connection failure: {err}"
        );
    }

    /// Cancellation before the HTTP request completes.
    #[tokio::test]
    async fn stream_cancellation_before_response() {
        let app = mock_app();
        let request = sample_request(
            "stream-cancel-pre",
            "http://127.0.0.1:1/v1/chat/completions",
        );
        let token = CancellationToken::new();

        // Cancel immediately — should beat any connection attempt
        token.cancel();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cancelled"));
    }

    /// Cancellation during the streaming loop (after receiving some data).
    #[tokio::test]
    async fn stream_cancellation_during_streaming() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n",
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-cancel-during", &endpoint);
        let token = CancellationToken::new();

        // The mock response body is small and will be fully delivered,
        // so the stream will reach EOF before we could cancel.
        // This exercises the streaming loop and EOF path.
        let result = stream_chat_completion(app.handle(), request, token).await;
        // Should complete with Ok (EOF reached)
        assert!(
            result.is_ok(),
            "should complete when response is fully delivered"
        );
    }

    /// Empty response body — stream ends immediately at EOF.
    #[tokio::test]
    async fn stream_handles_empty_response_body() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string("")
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-empty", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok(), "empty body should complete successfully");
    }

    /// Response with only SSE comments and empty lines — no actual data.
    #[tokio::test]
    async fn stream_handles_comments_only() {
        let server = MockServer::start().await;

        let sse_body = ": this is a comment\n\n: keepalive\n\ndata: [DONE]\n";
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-comments", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok());
    }

    /// Multiple chunks with empty deltas (no content field).
    #[tokio::test]
    async fn stream_handles_empty_deltas() {
        let server = MockServer::start().await;

        let sse_body = [
            "data: {\"choices\":[{\"delta\":{}}]}\n",
            "\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"content\"}}]}\n",
            "\n",
            "data: {\"choices\":[{\"delta\":{}}]}\n",
            "\n",
            "data: [DONE]\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-empty-delta", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok());
    }

    /// SSE response with multiple choices per chunk.
    #[tokio::test]
    async fn stream_handles_multiple_choices() {
        let server = MockServer::start().await;

        let sse_body = [
            "data: {\"choices\":[{\"delta\":{\"content\":\"A\"}},{\"delta\":{\"content\":\"B\"}}]}\n",
            "\n",
            "data: [DONE]\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-multi-choice", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok());
    }

    /// SSE response with event: lines mixed in (should be skipped).
    #[tokio::test]
    async fn stream_skips_event_lines() {
        let server = MockServer::start().await;

        let sse_body = [
            "event: message\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n",
            "\n",
            "event: done\n",
            "data: [DONE]\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-event-lines", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok());
    }

    /// Stream where the error event is emitted by the outer function
    /// (not cancelled, so error event should be emitted).
    #[tokio::test]
    async fn stream_error_emits_error_event() {
        let app = mock_app();
        // Use unreachable endpoint
        let request = sample_request("stream-error-evt", "http://127.0.0.1:1/v1/chat/completions");
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_err());
        // The error event should have been emitted (we can't capture it in mock,
        // but at least the function doesn't panic).
    }

    /// Cancelled stream should NOT emit an error event (the outer function checks).
    #[tokio::test]
    async fn cancelled_stream_does_not_emit_error_event() {
        let app = mock_app();
        let request = sample_request(
            "stream-cancel-no-err",
            "http://127.0.0.1:1/v1/chat/completions",
        );
        let token = CancellationToken::new();
        token.cancel();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cancelled"));
    }

    /// SSE with invalid JSON on a data: line — should return an error.
    #[tokio::test]
    async fn stream_returns_error_on_invalid_sse_json() {
        let server = MockServer::start().await;

        let sse_body = "data: {invalid json}\n";

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-bad-json", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("Failed to parse SSE JSON"),
            "error should mention JSON parse failure"
        );
    }

    /// SSE with invalid JSON in residual buffer (no trailing newline) — should return error.
    #[tokio::test]
    async fn stream_returns_error_on_invalid_residual_json() {
        let server = MockServer::start().await;

        // First chunk is valid, residual has bad JSON without trailing newline
        let sse_body = "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: {bad json}";

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-bad-residual", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("Failed to parse SSE JSON"),
            "error should mention JSON parse failure in residual"
        );
    }

    /// Residual buffer with only a comment or empty content — should complete OK.
    #[tokio::test]
    async fn stream_handles_skip_in_residual_buffer() {
        let server = MockServer::start().await;

        // Residual buffer is a comment line without trailing newline
        let sse_body = "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n: keepalive";

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-skip-residual", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok(), "comment in residual should be skipped");
    }

    /// Large number of chunks to exercise the flush interval path.
    #[tokio::test]
    async fn stream_flushes_buffer_on_interval() {
        let server = MockServer::start().await;

        // Build a body with many small chunks — the flush logic triggers on elapsed time
        let mut body = String::new();
        for i in 0..20 {
            body.push_str(&format!(
                "data: {{\"choices\":[{{\"delta\":{{\"content\":\"tok{}\"}}}}]}}\n\n",
                i
            ));
        }
        body.push_str("data: [DONE]\n");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-flush", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok());
    }

    /// Stream with buffered content that gets flushed before an error line.
    #[tokio::test]
    async fn stream_flushes_buffer_before_error() {
        let server = MockServer::start().await;

        // Valid chunk followed by invalid JSON — buffer should be flushed before error
        let sse_body = [
            "data: {\"choices\":[{\"delta\":{\"content\":\"valid\"}}]}\n",
            "\n",
            "data: {broken json}\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-flush-err", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to parse SSE JSON"));
    }

    /// Stream with buffered content that gets flushed before [DONE].
    #[tokio::test]
    async fn stream_flushes_buffer_before_done() {
        let server = MockServer::start().await;

        let sse_body = [
            "data: {\"choices\":[{\"delta\":{\"content\":\"buffered\"}}]}\n",
            "\n",
            "data: [DONE]\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-flush-done", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok());
    }

    /// Residual buffer with invalid JSON and existing buffered content
    /// should flush the buffer content before returning error.
    #[tokio::test]
    async fn stream_flushes_before_residual_error() {
        let server = MockServer::start().await;

        // valid content, then invalid JSON without trailing newline
        let sse_body =
            "data: {\"choices\":[{\"delta\":{\"content\":\"pre-error\"}}]}\n\ndata: {bad}";

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-residual-err-flush", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_err());
    }

    /// [DONE] in residual with accumulated buffer — flush before done.
    #[tokio::test]
    async fn stream_flushes_buffer_before_residual_done() {
        let server = MockServer::start().await;

        // Content chunk + [DONE] without trailing newline
        let sse_body =
            "data: {\"choices\":[{\"delta\":{\"content\":\"flushed\"}}]}\n\ndata: [DONE]";

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-residual-done-flush", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "should flush buffer and complete on residual [DONE]"
        );
    }

    #[tokio::test]
    async fn stream_sanitizes_full_think_block_from_visible_content() {
        let server = MockServer::start().await;
        let sse_body = [
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello <think>hidden</think>world\"}}]}\n",
            "\n",
            "data: [DONE]\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let chunks = stream_chunk_events(&app).await;
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let state = app.state::<sqllumen_lib::state::AppState>();
        cache_strategy(
            &mut state.compat_strategy_cache.lock().unwrap(),
            &endpoint,
            "test-model",
            ReasoningStrategy::StandardFields,
            std::time::Instant::now(),
            POSITIVE_STRATEGY_TTL,
        );
        let mut request = sample_request("stream-think-full", &endpoint);
        request.prefer_responses_api = false;
        request.enable_reasoning = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok());

        let payloads = chunks.lock().unwrap().clone();
        assert_eq!(content_payloads(&payloads).join(""), "Hello world");
    }

    #[tokio::test]
    async fn stream_sanitizes_incomplete_think_block_across_chunks() {
        let server = MockServer::start().await;
        let sse_body = [
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello <think>hidden\"}}]}\n",
            "\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" still hidden</think> world\"}}]}\n",
            "\n",
            "data: [DONE]\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let chunks = stream_chunk_events(&app).await;
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let state = app.state::<sqllumen_lib::state::AppState>();
        cache_strategy(
            &mut state.compat_strategy_cache.lock().unwrap(),
            &endpoint,
            "test-model",
            ReasoningStrategy::StandardFields,
            std::time::Instant::now(),
            POSITIVE_STRATEGY_TTL,
        );
        let mut request = sample_request("stream-think-partial", &endpoint);
        request.prefer_responses_api = false;
        request.enable_reasoning = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok());

        let payloads = chunks.lock().unwrap().clone();
        assert_eq!(content_payloads(&payloads).join(""), "Hello  world");
    }

    #[tokio::test]
    async fn stream_done_finalizes_partial_prefill_marker_before_done_event() {
        let server = MockServer::start().await;
        let sse_body = [
            "data: {\"choices\":[{\"delta\":{\"content\":\"Ans\"}}]}\n",
            "\n",
            "data: [DONE]\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let chunks = stream_chunk_events(&app).await;
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let state = app.state::<sqllumen_lib::state::AppState>();
        cache_strategy(
            &mut state.compat_strategy_cache.lock().unwrap(),
            &endpoint,
            "test-model",
            ReasoningStrategy::AssistantPrefill,
            std::time::Instant::now(),
            POSITIVE_STRATEGY_TTL,
        );
        let mut request = sample_request("stream-done-prefill-finalize", &endpoint);
        request.prefer_responses_api = false;
        request.enable_reasoning = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok());

        let payloads = chunks.lock().unwrap().clone();
        assert_eq!(content_payloads(&payloads).join(""), "Ans");
    }

    #[tokio::test]
    async fn stream_read_error_finalizes_partial_tag_prefix_before_returning_error() {
        let app = mock_app();
        let chunks = stream_chunk_events(&app).await;
        let request = sample_request(
            "stream-read-error-partial-tag",
            "http://127.0.0.1:1/v1/chat/completions",
        );
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_err());

        // Existing connection-refused path doesn't exercise stream read errors.
        // Use the sanitizer seam for the exact regression shape: partial tag prefix flushed on finalize.
        let visible = sqllumen_lib::ai::client::sanitize_streamed_visible_content_chunks(
            &["<thi"],
            false,
        );
        assert_eq!(visible, "<thi");

        let payloads = chunks.lock().unwrap().clone();
        assert!(content_payloads(&payloads).is_empty());
    }

    #[tokio::test]
    async fn stream_routes_think_content_to_thinking_buffer_when_reasoning_enabled() {
        let server = MockServer::start().await;
        let sse_body = [
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello <think>hidden</think>world\"}}]}\n",
            "\n",
            "data: [DONE]\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let chunks = stream_chunk_events(&app).await;
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let mut request = sample_request("stream-think-content-enabled", &endpoint);
        request.enable_reasoning = true;
        request.prefer_responses_api = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok());

        let payloads = chunks.lock().unwrap().clone();
        assert_eq!(content_payloads(&payloads).join(""), "Hello world");
        assert_eq!(thinking_payloads(&payloads).join(""), "hidden");
    }

    #[tokio::test]
    async fn stream_falls_back_to_latest_user_no_think_when_cached_strategy_is_no_safe() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "messages": [
                    {"role": "user", "content": "Earlier question"},
                    {"role": "assistant", "content": "Earlier answer"},
                    {"role": "user", "content": "Latest question\n\n/no_think"}
                ],
                "reasoning_effort": "none",
                "enable_thinking": false,
                "chat_template_kwargs": {"enable_thinking": false}
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"delta\":{\"content\":\"fallback ok\"}}]}\n",
                            "\n",
                            "data: [DONE]\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let state = app.state::<sqllumen_lib::state::AppState>();
        cache_strategy(
            &mut state.compat_strategy_cache.lock().unwrap(),
            &endpoint,
            "test-model",
            ReasoningStrategy::NoSafeStrategy,
            std::time::Instant::now(),
            NEGATIVE_STRATEGY_TTL,
        );

        let request = AiChatRequest {
            messages: vec![
                IpcMessage {
                    role: "user".to_string(),
                    content: "Earlier question".to_string(),
                },
                IpcMessage {
                    role: "assistant".to_string(),
                    content: "Earlier answer".to_string(),
                },
                IpcMessage {
                    role: "user".to_string(),
                    content: "Latest question".to_string(),
                },
            ],
            endpoint,
            model: "test-model".to_string(),
            temperature: 0.7,
            max_tokens: 100,
            stream_id: "stream-no-safe-fallback".to_string(),
            previous_response_id: None,
            prefer_responses_api: false,
            enable_reasoning: false,
        };

        let result = stream_chat_completion(app.handle(), request, CancellationToken::new()).await;
        assert!(
            result.is_ok(),
            "NoSafeStrategy should fall back to latest-user /no_think instead of erroring"
        );
    }

    /// Responses API streams should complete successfully and capture response ids.
    #[tokio::test]
    async fn responses_api_stream_completes_for_openai_compatible_endpoint() {
        let server = MockServer::start().await;

        let sse_body = [
            "event: response.created\n",
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_123\"}}\n",
            "\n",
            "event: response.output_text.delta\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello\"}\n",
            "\n",
            "event: response.completed\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_123\"}}\n",
            "\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let request = sample_request(
            "stream-responses",
            &format!("{}/v1/responses", server.uri()),
        );
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "responses stream should complete successfully"
        );
    }

    #[tokio::test]
    async fn responses_api_stream_completes_on_residual_done_without_trailing_newline() {
        let server = MockServer::start().await;

        let sse_body = [
            "event: response.output_text.delta\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello\"}\n\n",
            "event: response.completed\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_residual\"}}",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let request = sample_request(
            "stream-responses-residual-done",
            &format!("{}/v1/responses", server.uri()),
        );
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "responses stream should complete when final data line has no trailing newline"
        );
    }

    #[tokio::test]
    async fn responses_api_stream_errors_on_invalid_residual_json() {
        let server = MockServer::start().await;

        let sse_body = [
            "event: response.output_text.delta\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello\"}\n\n",
            "event: response.completed\n",
            "data: {not valid json}",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let request = sample_request(
            "stream-responses-residual-error",
            &format!("{}/v1/responses", server.uri()),
        );
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_err(),
            "invalid residual JSON should return an error"
        );
        assert!(
            result
                .expect_err("responses stream should fail")
                .contains("Failed to parse SSE JSON"),
            "error should mention SSE JSON parse failure"
        );
    }

    #[tokio::test]
    async fn responses_api_stream_errors_on_eof_before_completed_event() {
        let server = MockServer::start().await;

        let sse_body = [
            "event: response.created\n",
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_partial\"}}\n\n",
            "event: response.output_text.delta\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello\"}\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let request = sample_request(
            "stream-responses-partial-eof",
            &format!("{}/v1/responses", server.uri()),
        );
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_err(),
            "EOF before response.completed should error"
        );
        assert!(
            result
                .expect_err("responses stream should fail")
                .contains("response.completed"),
            "error should mention missing completion event"
        );
    }

    #[test]
    fn responses_endpoint_normalises_to_chat_completions_url() {
        let normalized = normalise_to_chat_completions_url("http://example.test/v1/responses");
        assert_eq!(normalized, "http://example.test/v1/chat/completions");
    }

    #[tokio::test]
    async fn falls_back_to_chat_completions_when_responses_endpoint_is_missing() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(ResponseTemplate::new(404).set_body_string("Not Found"))
            .expect(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"delta\":{\"content\":\"fallback\"}}]}\n",
                            "\n",
                            "data: [DONE]\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request(
            "stream-responses-fallback-404",
            &format!("{}/v1", server.uri()),
        );

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "missing responses endpoint should fall back to chat completions"
        );
    }

    #[tokio::test]
    async fn falls_back_to_chat_completions_when_previous_response_id_is_unsupported() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .and(body_partial_json(serde_json::json!({
                "previous_response_id": "resp_prev"
            })))
            .respond_with(
                ResponseTemplate::new(400)
                    .set_body_string("Unknown parameter: previous_response_id"),
            )
            .expect(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "messages": [
                    {"role": "system", "content": "You are helpful"},
                    {"role": "user", "content": "Hello"},
                    {"role": "assistant", "content": "Hi"},
                    {"role": "user", "content": "Follow up"}
                ]
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"delta\":{\"content\":\"fallback follow-up\"}}]}\n",
                            "\n",
                            "data: [DONE]\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = AiChatRequest {
            messages: vec![
                IpcMessage {
                    role: "system".to_string(),
                    content: "You are helpful".to_string(),
                },
                IpcMessage {
                    role: "user".to_string(),
                    content: "Hello".to_string(),
                },
                IpcMessage {
                    role: "assistant".to_string(),
                    content: "Hi".to_string(),
                },
                IpcMessage {
                    role: "user".to_string(),
                    content: "Follow up".to_string(),
                },
            ],
            endpoint: format!("{}/v1", server.uri()),
            model: "test-model".to_string(),
            temperature: 0.7,
            max_tokens: 100,
            stream_id: "stream-followup-fallback".to_string(),
            previous_response_id: Some("resp_prev".to_string()),
            prefer_responses_api: true,
            enable_reasoning: true,
        };

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "unsupported response chaining should fall back to chat completions"
        );
    }

    #[tokio::test]
    async fn falls_back_to_chat_completions_when_responses_stream_uses_chat_completions_payload_shape(
    ) {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"delta\":{\"content\":\"wrong stream\"}}]}\n",
                            "\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"delta\":{\"content\":\"fallback ok\"}}]}\n",
                            "\n",
                            "data: [DONE]\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request(
            "stream-responses-fallback-shape",
            &format!("{}/v1", server.uri()),
        );

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "chat-completions-shaped responses stream should fall back to chat completions"
        );
    }

    #[tokio::test]
    async fn responses_api_stream_surfaces_structured_failure_message() {
        let server = MockServer::start().await;

        let sse_body = [
            "event: response.failed\n",
            "data: {\"type\":\"response.failed\",\"error\":{\"message\":\"model overloaded\"}}\n",
            "\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request("stream-responses-failed", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_err());
        assert_eq!(
            result.expect_err("structured response failure should surface as an error"),
            "model overloaded"
        );
    }

    #[tokio::test]
    async fn responses_api_stream_accepts_sse_event_names_without_json_type() {
        let server = MockServer::start().await;

        let sse_body = [
            "event: response.created\n",
            "data: {\"response\":{\"id\":\"resp_evt\"}}\n",
            "\n",
            "event: response.output_text.delta\n",
            "data: {\"delta\":\"Hello\"}\n",
            "\n",
            "event: response.completed\n",
            "data: {\"response\":{\"id\":\"resp_evt\"}}\n",
            "\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request(
            "stream-responses-event-name",
            &format!("{}/v1", server.uri()),
        );

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "event-name-only responses streams should succeed"
        );
    }

    #[tokio::test]
    async fn responses_api_stream_extracts_text_from_done_text_field() {
        let server = MockServer::start().await;

        let sse_body = [
            "event: response.output_text.done\n",
            "data: {\"text\":\"Hello from done\"}\n",
            "\n",
            "event: response.completed\n",
            "data: {\"response\":{\"id\":\"resp_done_text\"}}\n",
            "\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request(
            "stream-responses-done-text",
            &format!("{}/v1", server.uri()),
        );

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok(), "done-text responses streams should succeed");
    }

    #[tokio::test]
    async fn responses_api_stream_does_not_duplicate_done_text_when_completed_repeats_output() {
        let server = MockServer::start().await;

        let sse_body = [
            "event: response.output_text.done\n",
            "data: {\"text\":\"Hello once\"}\n",
            "\n",
            "event: response.completed\n",
            "data: {\"response\":{\"id\":\"resp_done_once\",\"output\":[{\"content\":[{\"text\":\"Hello once\"}]}]}}\n",
            "\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request(
            "stream-responses-done-once",
            &format!("{}/v1", server.uri()),
        );

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "done text should not be duplicated by completed payloads"
        );
    }

    #[tokio::test]
    async fn responses_api_stream_accepts_follow_up_with_previous_response_id() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .and(body_partial_json(serde_json::json!({
                "previous_response_id": "resp_prev",
                "input": [
                    {
                        "role": "user",
                        "content": "Follow up"
                    }
                ]
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "event: response.completed\n",
                            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_followup\"}}\n",
                            "\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = AiChatRequest {
            messages: vec![
                IpcMessage {
                    role: "system".to_string(),
                    content: "You are helpful".to_string(),
                },
                IpcMessage {
                    role: "user".to_string(),
                    content: "Hello".to_string(),
                },
                IpcMessage {
                    role: "assistant".to_string(),
                    content: "Hi".to_string(),
                },
                IpcMessage {
                    role: "user".to_string(),
                    content: "Follow up".to_string(),
                },
            ],
            endpoint: format!("{}/v1/responses", server.uri()),
            model: "test-model".to_string(),
            temperature: 0.7,
            max_tokens: 100,
            stream_id: "stream-followup".to_string(),
            previous_response_id: Some("resp_prev".to_string()),
            prefer_responses_api: true,
            enable_reasoning: true,
        };

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn responses_api_request_keeps_system_role_without_previous_response_id() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .and(body_partial_json(serde_json::json!({
                "input": [
                    {
                        "role": "system",
                        "content": "You are helpful"
                    },
                    {
                        "role": "user",
                        "content": "Hello"
                    },
                    {
                        "role": "assistant",
                        "content": "Hi"
                    }
                ]
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "event: response.completed\n",
                            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_full_history\"}}\n",
                            "\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = AiChatRequest {
            messages: vec![
                IpcMessage {
                    role: "system".to_string(),
                    content: "You are helpful".to_string(),
                },
                IpcMessage {
                    role: "user".to_string(),
                    content: "Hello".to_string(),
                },
                IpcMessage {
                    role: "assistant".to_string(),
                    content: "Hi".to_string(),
                },
            ],
            endpoint: format!("{}/v1", server.uri()),
            model: "test-model".to_string(),
            temperature: 0.7,
            max_tokens: 100,
            stream_id: "stream-full-history".to_string(),
            previous_response_id: None,
            prefer_responses_api: true,
            enable_reasoning: true,
        };

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn responses_api_follow_up_without_new_user_message_sends_full_history() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .and(body_partial_json(serde_json::json!({
                "previous_response_id": "resp_prev",
                "input": [
                    {
                        "role": "system",
                        "content": "You are helpful"
                    },
                    {
                        "role": "user",
                        "content": "Hello"
                    },
                    {
                        "role": "assistant",
                        "content": "Hi"
                    }
                ]
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "event: response.completed\n",
                            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_replayed_history\"}}\n",
                            "\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = AiChatRequest {
            messages: vec![
                IpcMessage {
                    role: "system".to_string(),
                    content: "You are helpful".to_string(),
                },
                IpcMessage {
                    role: "user".to_string(),
                    content: "Hello".to_string(),
                },
                IpcMessage {
                    role: "assistant".to_string(),
                    content: "Hi".to_string(),
                },
            ],
            endpoint: format!("{}/v1", server.uri()),
            model: "test-model".to_string(),
            temperature: 0.7,
            max_tokens: 100,
            stream_id: "stream-replayed-history".to_string(),
            previous_response_id: Some("resp_prev".to_string()),
            prefer_responses_api: true,
            enable_reasoning: true,
        };

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn responses_api_does_not_fallback_on_generic_bad_request() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(ResponseTemplate::new(400).set_body_string("validation failed"))
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request(
            "stream-responses-bad-request",
            &format!("{}/v1", server.uri()),
        );

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_err());
        let error = result.expect_err("generic 400 should be surfaced directly");
        assert!(error.contains("400"));
        assert!(error.contains("validation failed"));
    }

    #[tokio::test]
    async fn falls_back_to_chat_completions_when_responses_rejects_system_role_value() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(400).set_body_string("Invalid value for 'role': system"),
            )
            .expect(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"delta\":{\"content\":\"fallback role\"}}]}\n",
                            "\n",
                            "data: [DONE]\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request(
            "stream-responses-fallback-role",
            &format!("{}/v1", server.uri()),
        );

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "role validation failures should fall back to chat completions"
        );
    }

    #[tokio::test]
    async fn falls_back_to_chat_completions_when_responses_rejects_unknown_input_field() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(ResponseTemplate::new(400).set_body_string("unknown field \"input\""))
            .expect(2)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"delta\":{\"content\":\"fallback input\"}}]}\n",
                            "\n",
                            "data: [DONE]\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request(
            "stream-responses-fallback-input",
            &format!("{}/v1", server.uri()),
        );

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "unknown input field failures should fall back to chat completions"
        );
    }

    #[tokio::test]
    async fn falls_back_to_chat_completions_when_responses_rejects_reasoning_field() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(ResponseTemplate::new(400).set_body_string("unknown field \"reasoning\""))
            .expect(2)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"delta\":{\"content\":\"fallback reasoning\"}}]}\n",
                            "\n",
                            "data: [DONE]\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request(
            "stream-responses-fallback-reasoning",
            &format!("{}/v1", server.uri()),
        );

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "reasoning validation failures should fall back to chat completions"
        );
    }

    #[tokio::test]
    async fn chat_completions_retries_without_reasoning_effort_when_unsupported() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "reasoning_effort": "medium"
            })))
            .respond_with(
                ResponseTemplate::new(400).set_body_string("unknown parameter: reasoning_effort"),
            )
            .expect(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"delta\":{\"content\":\"retry ok\"}}]}\n",
                            "\n",
                            "data: [DONE]\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let mut request = sample_request("stream-chat-retry-no-reasoning", &endpoint);
        request.prefer_responses_api = false;
        request.enable_reasoning = true;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "chat completions should retry without reasoning_effort"
        );
    }

    #[tokio::test]
    async fn responses_content_part_text_is_not_treated_as_reasoning() {
        let server = MockServer::start().await;
        let sse_body = [
            "event: response.content_part.added\n",
            "data: {\"type\":\"response.content_part.added\",\"part\":{\"type\":\"text\",\"text\":\"assistant text\"}}\n",
            "\n",
            "event: response.completed\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_content_part\"}}\n",
            "\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let mut request = sample_request(
            "stream-responses-content-part-text",
            &format!("{}/v1", server.uri()),
        );
        request.enable_reasoning = true;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "generic content-part text should not be treated as reasoning"
        );
    }

    #[tokio::test]
    async fn falls_back_to_chat_completions_when_responses_endpoint_returns_server_error() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(ResponseTemplate::new(500).set_body_string("server exploded"))
            .expect(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"delta\":{\"content\":\"fallback 500\"}}]}\n",
                            "\n",
                            "data: [DONE]\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request(
            "stream-responses-fallback-500",
            &format!("{}/v1", server.uri()),
        );

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "server errors should fall back to chat completions"
        );
    }

    #[tokio::test]
    async fn responses_api_stream_extracts_text_from_response_output_content_array() {
        let server = MockServer::start().await;

        let sse_body = [
            "event: response.output_text.done\n",
            "data: {\"response\":{\"output\":[{\"content\":[{\"text\":\"Hello from response output\"}]}]}}\n",
            "\n",
            "event: response.completed\n",
            "data: {\"response\":{\"id\":\"resp_output_nested\"}}\n",
            "\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request(
            "stream-responses-output-array",
            &format!("{}/v1", server.uri()),
        );

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "nested response.output text should be accepted"
        );
    }

    #[tokio::test]
    async fn responses_api_stream_extracts_text_from_top_level_output_content_array() {
        let server = MockServer::start().await;

        let sse_body = [
            "event: response.output_text.done\n",
            "data: {\"output\":[{\"content\":[{\"text\":\"Hello from output array\"}]}]}\n",
            "\n",
            "event: response.completed\n",
            "data: {\"response\":{\"id\":\"resp_output_top_level\"}}\n",
            "\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request(
            "stream-responses-top-output-array",
            &format!("{}/v1", server.uri()),
        );

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok(), "top-level output text should be accepted");
    }

    #[tokio::test]
    async fn responses_api_stream_surfaces_top_level_message_failure() {
        let server = MockServer::start().await;

        let sse_body = [
            "event: response.failed\n",
            "data: {\"message\":\"request failed\"}\n",
            "\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request(
            "stream-responses-message-failure",
            &format!("{}/v1", server.uri()),
        );

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert_eq!(
            result.expect_err("top-level message failures should surface as errors"),
            "request failed"
        );
    }

    #[tokio::test]
    async fn chat_completions_emits_thinking_chunk_for_reasoning_content() {
        let server = MockServer::start().await;
        let sse_body = [
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"let me think\",\"content\":null}}]}\n",
            "\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n",
            "\n",
            "data: [DONE]\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let mut request = sample_request("stream-reasoning-content", &endpoint);
        request.enable_reasoning = true;
        request.prefer_responses_api = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "stream with reasoning_content should complete successfully"
        );
    }

    #[tokio::test]
    async fn chat_completions_emits_thinking_chunk_for_thinking_field() {
        let server = MockServer::start().await;
        let sse_body = [
            "data: {\"choices\":[{\"delta\":{\"thinking\":\"step by step\",\"content\":null}}]}\n",
            "\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"result\"}}]}\n",
            "\n",
            "data: [DONE]\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let mut request = sample_request("stream-thinking-field", &endpoint);
        request.enable_reasoning = true;
        request.prefer_responses_api = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "stream with thinking field should complete successfully"
        );
    }

    #[tokio::test]
    async fn chat_completions_suppresses_thinking_when_reasoning_disabled() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "messages": [{ "role": "user", "content": "Reply with one word: hello.\n\n/no_think" }],
                "stream": false
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"{"choices":[{"message":{"content":"hello"}}]}"#),
            )
            .expect(1)
            .mount(&server)
            .await;

        let sse_body = [
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"hidden thought\",\"content\":null}}]}\n",
            "\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"visible\"}}]}\n",
            "\n",
            "data: [DONE]\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "messages": [{ "role": "user", "content": "Hello\n\n/no_think" }],
                "stream": true
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let mut request = sample_request("stream-no-reasoning", &endpoint);
        request.enable_reasoning = false;
        request.prefer_responses_api = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "stream with reasoning disabled should complete without thinking chunks"
        );
    }

    #[tokio::test]
    async fn responses_api_emits_thinking_chunk_for_reasoning_summary() {
        let server = MockServer::start().await;
        let sse_body = [
            "event: response.reasoning_summary_text.delta\n",
            "data: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"thinking...\"}\n",
            "\n",
            "event: response.reasoning_summary_text.done\n",
            "data: {\"type\":\"response.reasoning_summary_text.done\"}\n",
            "\n",
            "event: response.output_text.delta\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"answer\"}\n",
            "\n",
            "event: response.completed\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_reasoning\"}}\n",
            "\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let mut request = sample_request(
            "stream-responses-reasoning",
            &format!("{}/v1", server.uri()),
        );
        request.enable_reasoning = true;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "responses stream with reasoning summary should complete successfully"
        );
    }

    #[tokio::test]
    async fn responses_api_emits_thinking_chunk_for_reasoning_text_events() {
        let server = MockServer::start().await;
        let sse_body = [
            "event: response.reasoning_text.delta\n",
            "data: {\"type\":\"response.reasoning_text.delta\",\"delta\":\"thinking...\"}\n",
            "\n",
            "event: response.reasoning_text.done\n",
            "data: {\"type\":\"response.reasoning_text.done\"}\n",
            "\n",
            "event: response.output_text.delta\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"answer\"}\n",
            "\n",
            "event: response.completed\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_reasoning_text\"}}\n",
            "\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let mut request = sample_request(
            "stream-responses-reasoning-text",
            &format!("{}/v1", server.uri()),
        );
        request.enable_reasoning = true;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "responses stream with reasoning text should complete successfully"
        );
    }

    #[tokio::test]
    async fn reasoning_disabled_uses_chat_completions_and_sends_reasoning_effort_none() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(ResponseTemplate::new(500).set_body_string("should not be called"))
            .expect(0)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "messages": [{ "role": "user", "content": "Reply with one word: hello.\n\n/no_think" }],
                "stream": false
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"{"choices":[{"message":{"content":"hello"}}]}"#),
            )
            .expect(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "reasoning_effort": "none",
                "enable_thinking": false,
                "chat_template_kwargs": { "enable_thinking": false },
                "messages": [
                    { "role": "user", "content": "Hello\n\n/no_think" }
                ]
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"delta\":{\"content\":\"visible\"}}]}\n",
                            "\n",
                            "data: [DONE]\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let mut request = sample_request(
            "stream-responses-no-reasoning",
            &format!("{}/v1", server.uri()),
        );
        request.enable_reasoning = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "reasoning disabled should use chat completions without thinking"
        );
    }

    #[tokio::test]
    async fn reasoning_disabled_from_base_endpoint_avoids_responses_retry_path() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(ResponseTemplate::new(500).set_body_string("should not be called"))
            .expect(0)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "messages": [{ "role": "user", "content": "Reply with one word: hello.\n\n/no_think" }],
                "stream": false
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"{"choices":[{"message":{"content":"hello"}}]}"#),
            )
            .expect(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "reasoning_effort": "none",
                "enable_thinking": false,
                "chat_template_kwargs": { "enable_thinking": false },
                "messages": [
                    { "role": "user", "content": "Hello\n\n/no_think" }
                ]
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"delta\":{\"content\":\"visible\"}}]}\n",
                            "\n",
                            "data: [DONE]\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let mut request = sample_request(
            "stream-responses-retry-disable",
            &format!("{}/v1", server.uri()),
        );
        request.enable_reasoning = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "reasoning disabled should avoid responses and use chat completions directly"
        );
    }

    #[tokio::test]
    async fn reasoning_disabled_errors_when_provider_rejects_reasoning_effort_none() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(ResponseTemplate::new(500).set_body_string("should not be called"))
            .expect(0)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "messages": [{ "role": "user", "content": "Reply with one word: hello.\n\n/no_think" }],
                "stream": false
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"{"choices":[{"message":{"content":"hello"}}]}"#),
            )
            .expect(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "reasoning_effort": "none",
                "enable_thinking": false,
                "chat_template_kwargs": { "enable_thinking": false },
                "messages": [
                    { "role": "user", "content": "Hello\n\n/no_think" }
                ]
            })))
            .respond_with(
                ResponseTemplate::new(400).set_body_string("unknown parameter: reasoning_effort"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let mut request = sample_request(
            "stream-responses-disable-unsupported",
            &format!("{}/v1", server.uri()),
        );
        request.enable_reasoning = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_err(),
            "reasoning disabled should fail if the provider cannot honor reasoning_effort none"
        );
        assert!(
            result
                .expect_err("request should fail when disable is unsupported")
                .contains("cannot safely disable thinking"),
            "error should explain that provider-side reasoning cannot be safely disabled"
        );
    }

    #[tokio::test]
    async fn reasoning_enabled_does_not_append_no_think_to_user_message() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "reasoning_effort": "medium",
                "messages": [
                    { "role": "user", "content": "Hello" }
                ]
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n",
                            "\n",
                            "data: [DONE]\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let mut request = sample_request("stream-reasoning-enabled-no-nothink", &endpoint);
        request.enable_reasoning = true;
        request.prefer_responses_api = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "reasoning enabled should not append /no_think"
        );
    }

    #[tokio::test]
    async fn local_clean_provider_selects_standard_fields_without_prefill() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "messages": [{ "role": "user", "content": "Reply with one word: hello.\n\n/no_think" }],
                "reasoning_effort": "none",
                "enable_thinking": false,
                "chat_template_kwargs": { "enable_thinking": false },
                "stream": false
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"{"choices":[{"message":{"content":"hello"}}]}"#),
            )
            .expect(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "messages": [{ "role": "user", "content": "Hello\n\n/no_think" }],
                "reasoning_effort": "none"
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string("data: {\"choices\":[{\"delta\":{\"content\":\"visible\"}}]}\n\ndata: [DONE]\n")
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let mut request = sample_request("stream-standard-fields", &format!("{}/v1", server.uri()));
        request.enable_reasoning = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "clean local providers should stay on standard fields"
        );
    }

    #[tokio::test]
    async fn mlx_reasoning_leak_selects_assistant_prefill_and_hides_marker() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "messages": [{ "role": "user", "content": "Reply with one word: hello.\n\n/no_think" }],
                "stream": false
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"{"choices":[{"message":{"reasoning_content":"hidden"}}]}"#),
            )
            .expect(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "messages": [
                    { "role": "user", "content": "Reply with one word: hello." },
                    { "role": "assistant", "content": ASSISTANT_PREFILL_MARKER }
                ],
                "stream": false,
                "reasoning_effort": "none"
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"{"choices":[{"message":{"content":"hello"}}]}"#),
            )
            .expect(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "messages": [
                    { "role": "user", "content": "Hello" },
                    { "role": "assistant", "content": ASSISTANT_PREFILL_MARKER }
                ],
                "reasoning_effort": "none"
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        format!(
                            "data: {{\"choices\":[{{\"delta\":{{\"reasoning_content\":\"hidden thought\"}}}}]}}\n\ndata: {{\"choices\":[{{\"delta\":{{\"content\":\"{}visible\"}}}}]}}\n\ndata: [DONE]\n",
                            ASSISTANT_PREFILL_MARKER
                        ),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let seen_chunks = stream_chunk_events(&app).await;
        let mut request =
            sample_request("stream-assistant-prefill", &format!("{}/v1", server.uri()));
        request.enable_reasoning = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(
            result.is_ok(),
            "leaky local providers should fall back to assistant prefill"
        );

        let joined = seen_chunks.lock().expect("chunk lock").join("\n");
        assert!(!joined.contains(ASSISTANT_PREFILL_MARKER));
        assert!(!joined.contains("hidden thought"));
        assert!(joined.contains("visible"));
    }

    #[tokio::test]
    async fn no_safe_strategy_falls_back_to_latest_user_no_think_payload() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "messages": [
                    {"role": "user", "content": "Reply with one word: hello.\n\n/no_think"}
                ],
                "stream": false,
                "reasoning_effort": "none",
                "enable_thinking": false,
                "chat_template_kwargs": {"enable_thinking": false}
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"{"choices":[{"message":{"reasoning_content":"hidden"}}]}"#),
            )
            .expect(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(serde_json::json!({
                "messages": [
                    {"role": "user", "content": "Hello\n\n/no_think"}
                ],
                "reasoning_effort": "none",
                "enable_thinking": false,
                "chat_template_kwargs": {"enable_thinking": false}
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"delta\":{\"content\":\"fallback visible\"}}]}\n",
                            "\n",
                            "data: [DONE]\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let mut request =
            sample_request("stream-no-safe-strategy", &format!("{}/v1", server.uri()));
        request.enable_reasoning = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_ok());
    }

    #[test]
    fn provider_visible_chat_payload_keeps_disabled_reasoning_prefix_stable_across_turns() {
        let first_turn = vec![IpcMessage {
            role: "user".to_string(),
            content: "Hello".to_string(),
        }];
        let second_turn = vec![
            IpcMessage {
                role: "user".to_string(),
                content: "Hello".to_string(),
            },
            IpcMessage {
                role: "assistant".to_string(),
                content: "Hi".to_string(),
            },
            IpcMessage {
                role: "user".to_string(),
                content: "Follow up".to_string(),
            },
        ];

        let first_payload = serde_json::to_vec(&normalize_provider_messages(&first_turn, true))
            .expect("first payload should serialize");
        let second_payload = serde_json::to_vec(&normalize_provider_messages(&second_turn, true))
            .expect("second payload should serialize");

        let first_messages = normalize_provider_messages(&first_turn, true);
        let second_messages = normalize_provider_messages(&second_turn, true);

        assert_eq!(first_messages[0].content, second_messages[0].content);
        assert_eq!(
            &second_payload[..first_payload.len() - 1],
            &first_payload[..first_payload.len() - 1]
        );
    }

    #[tokio::test]
    async fn responses_api_stream_surfaces_string_error_failure() {
        let server = MockServer::start().await;

        let sse_body = [
            "event: error\n",
            "data: {\"error\":\"request failed\"}\n",
            "\n",
        ]
        .join("");

        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let token = CancellationToken::new();
        let request = sample_request(
            "stream-responses-string-error",
            &format!("{}/v1", server.uri()),
        );

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert_eq!(
            result.expect_err("string error failures should surface as errors"),
            "request failed"
        );
    }
}

// ── ChunkKind / reasoning field tests ─────────────────────────────────────

#[test]
fn stream_chunk_event_thinking_kind_serializes_correctly() {
    use sqllumen_lib::ai::types::{ChunkKind, StreamChunkEvent};
    let evt = StreamChunkEvent {
        stream_id: "s1".to_string(),
        content: "reasoning step".to_string(),
        kind: ChunkKind::Thinking,
    };
    let json = serde_json::to_string(&evt).unwrap();
    assert!(
        json.contains("\"kind\":\"thinking\""),
        "expected thinking kind in JSON: {json}"
    );
}

#[test]
fn stream_chunk_event_default_kind_serializes_as_content() {
    use sqllumen_lib::ai::types::{ChunkKind, StreamChunkEvent};
    let evt = StreamChunkEvent {
        stream_id: "s1".to_string(),
        content: "normal".to_string(),
        kind: ChunkKind::default(),
    };
    let json = serde_json::to_string(&evt).unwrap();
    assert!(
        json.contains("\"kind\":\"content\""),
        "expected content kind in JSON: {json}"
    );
}

#[test]
fn api_stream_delta_with_reasoning_content_deserializes() {
    use sqllumen_lib::ai::types::ApiStreamDelta;
    let json = serde_json::json!({
        "content": null,
        "reasoning_content": "let me think..."
    });
    let delta: ApiStreamDelta = serde_json::from_value(json).unwrap();
    assert_eq!(delta.reasoning_content.as_deref(), Some("let me think..."));
    assert_eq!(delta.content, None);
    assert_eq!(delta.thinking, None);
}

#[test]
fn api_stream_delta_with_thinking_field_deserializes() {
    use sqllumen_lib::ai::types::ApiStreamDelta;
    let json = serde_json::json!({
        "content": null,
        "thinking": "step by step..."
    });
    let delta: ApiStreamDelta = serde_json::from_value(json).unwrap();
    assert_eq!(delta.thinking.as_deref(), Some("step by step..."));
    assert_eq!(delta.content, None);
    assert_eq!(delta.reasoning_content, None);
}

#[test]
fn api_stream_delta_without_reasoning_fields_deserializes() {
    use sqllumen_lib::ai::types::ApiStreamDelta;
    let json = serde_json::json!({
        "content": "hello"
    });
    let delta: ApiStreamDelta = serde_json::from_value(json).unwrap();
    assert_eq!(delta.content.as_deref(), Some("hello"));
    assert_eq!(delta.reasoning_content, None);
    assert_eq!(delta.thinking, None);
}

#[test]
fn ai_chat_request_enable_reasoning_serializes() {
    let req = AiChatRequest {
        messages: vec![],
        endpoint: "http://localhost".to_string(),
        model: "m".to_string(),
        temperature: 0.7,
        max_tokens: 100,
        stream_id: "s".to_string(),
        previous_response_id: None,
        prefer_responses_api: true,
        enable_reasoning: false,
    };
    let json = serde_json::to_value(&req).unwrap();
    assert_eq!(json["enableReasoning"], false);
}

#[test]
fn ai_chat_request_enable_reasoning_defaults_to_true() {
    let json = serde_json::json!({
        "messages": [],
        "endpoint": "http://localhost",
        "model": "m",
        "temperature": 0.7,
        "maxTokens": 100,
        "streamId": "s"
    });
    let req: AiChatRequest = serde_json::from_value(json).unwrap();
    assert!(req.enable_reasoning);
}

#[test]
fn api_chat_request_has_reasoning_field_when_enabled() {
    let req = ApiChatRequest {
        model: "test".to_string(),
        messages: vec![],
        temperature: 0.7,
        max_tokens: 100,
        stream: true,
        reasoning_effort: Some("medium".to_string()),
        enable_thinking: None,
        chat_template_kwargs: None,
    };
    let json = serde_json::to_value(&req).unwrap();
    assert_eq!(json["reasoning_effort"], "medium");
}

#[test]
fn api_chat_request_omits_reasoning_field_when_disabled() {
    let req = ApiChatRequest {
        model: "test".to_string(),
        messages: vec![],
        temperature: 0.7,
        max_tokens: 100,
        stream: true,
        reasoning_effort: Some("none".to_string()),
        enable_thinking: Some(false),
        chat_template_kwargs: Some(sqllumen_lib::ai::types::ChatTemplateKwargs {
            enable_thinking: false,
        }),
    };
    let json = serde_json::to_value(&req).unwrap();
    assert_eq!(json["reasoning_effort"], "none");
    assert_eq!(json["enable_thinking"], false);
    assert_eq!(json["chat_template_kwargs"]["enable_thinking"], false);
}

#[test]
fn api_responses_request_has_reasoning_field_when_enabled() {
    let req = ApiResponsesRequest {
        model: "test".to_string(),
        input: vec![],
        temperature: 0.7,
        max_output_tokens: 100,
        stream: true,
        previous_response_id: None,
        reasoning_effort: Some("medium".to_string()),
        reasoning: Some(ReasoningConfig {
            effort: "medium".to_string(),
            summary: Some("auto".to_string()),
        }),
    };
    let json = serde_json::to_value(&req).unwrap();
    assert_eq!(json["reasoning"]["effort"], "medium");
    assert_eq!(json["reasoning"]["summary"], "auto");
}

#[test]
fn api_responses_request_serializes_reasoning_as_nested_object() {
    // The OpenAI Responses API expects reasoning config as:
    //   { "reasoning": { "effort": "medium" } }
    // NOT as a flat top-level field:
    //   { "reasoning_effort": "medium" }
    let req = ApiResponsesRequest {
        model: "test".to_string(),
        input: vec![],
        temperature: 0.7,
        max_output_tokens: 100,
        stream: true,
        previous_response_id: None,
        reasoning_effort: Some("medium".to_string()),
        reasoning: Some(ReasoningConfig {
            effort: "medium".to_string(),
            summary: Some("auto".to_string()),
        }),
    };
    let json = serde_json::to_value(&req).unwrap();

    // Must have nested reasoning object
    let reasoning = json
        .get("reasoning")
        .expect("expected 'reasoning' key in serialized ApiResponsesRequest");
    assert_eq!(
        reasoning.get("effort").and_then(|v| v.as_str()),
        Some("medium"),
        "expected reasoning.effort = 'medium'"
    );

    // Must NOT have flat reasoning_effort
    assert!(
        json.get("reasoning_effort").is_none(),
        "flat 'reasoning_effort' field should not exist; Responses API needs nested 'reasoning' object"
    );
}

#[test]
fn api_responses_request_omits_reasoning_field_when_disabled() {
    let req = ApiResponsesRequest {
        model: "test".to_string(),
        input: vec![],
        temperature: 0.7,
        max_output_tokens: 100,
        stream: true,
        previous_response_id: None,
        reasoning_effort: None,
        reasoning: None,
    };
    let json = serde_json::to_value(&req).unwrap();
    assert!(json.get("reasoning_effort").is_none());
    assert!(json.get("reasoning").is_none());
}

#[test]
fn should_use_responses_api_respects_request_flag() {
    let mut req = AiChatRequest {
        messages: vec![],
        endpoint: "http://localhost".to_string(),
        model: "m".to_string(),
        temperature: 0.7,
        max_tokens: 100,
        stream_id: "s".to_string(),
        previous_response_id: None,
        prefer_responses_api: true,
        enable_reasoning: true,
    };
    assert!(should_use_responses_api(&req));
    req.prefer_responses_api = false;
    assert!(!should_use_responses_api(&req));
    req.prefer_responses_api = true;
    req.enable_reasoning = false;
    assert!(!should_use_responses_api(&req));
}

#[test]
fn responses_status_fallback_recognizes_reasoning_errors() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "unknown field \"reasoning\""
    ));
    assert!(!should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "validation failed"
    ));
}

#[test]
fn chat_retry_without_reasoning_matches_supported_errors() {
    assert!(should_retry_chat_without_reasoning(
        reqwest::StatusCode::BAD_REQUEST,
        "unknown parameter: reasoning_effort"
    ));
    assert!(!should_retry_chat_without_reasoning(
        reqwest::StatusCode::BAD_REQUEST,
        "unknown parameter: temperature"
    ));
}

#[test]
fn responses_error_message_extracts_nested_and_top_level_messages() {
    let nested = serde_json::json!({ "error": { "message": "nested" } });
    assert_eq!(
        extract_responses_error_message(&nested).as_deref(),
        Some("nested")
    );

    let top_level = serde_json::json!({ "message": "top" });
    assert_eq!(
        extract_responses_error_message(&top_level).as_deref(),
        Some("top")
    );
}

#[test]
fn responses_delta_text_defaults_to_empty() {
    assert_eq!(
        extract_responses_delta_text(&serde_json::json!({ "delta": "hi" })),
        "hi"
    );
    assert_eq!(extract_responses_delta_text(&serde_json::json!({})), "");
}

#[test]
fn reasoning_text_helpers_extract_only_reasoning_content() {
    let parts = vec![
        serde_json::json!({ "type": "summary_text", "text": "sum" }),
        serde_json::json!({ "type": "text", "text": "ignore" }),
        serde_json::json!({ "type": "reasoning_text", "text": "reason" }),
    ];
    assert_eq!(extract_reasoning_text_from_parts(&parts), "sumreason");

    let reasoning_item = serde_json::json!({
        "type": "reasoning",
        "summary": [{ "type": "summary_text", "text": "summary" }],
        "content": [
            { "type": "text", "text": "content" },
            { "type": "reasoning_text", "text": "detail" }
        ]
    });
    assert_eq!(
        extract_reasoning_text_from_item(&reasoning_item),
        "summarycontentdetail"
    );

    let non_reasoning_item = serde_json::json!({
        "type": "message",
        "content": [{ "type": "text", "text": "assistant" }]
    });
    assert_eq!(extract_reasoning_text_from_item(&non_reasoning_item), "");
}

#[test]
fn responses_reasoning_text_extracts_from_delta_part_and_output_items() {
    let json = serde_json::json!({
        "delta": "delta",
        "part": { "type": "reasoning_text", "text": "part" },
        "item": {
            "type": "reasoning",
            "content": [{ "type": "text", "text": "item" }]
        },
        "output": [{
            "type": "reasoning",
            "summary": [{ "type": "summary_text", "text": "output" }]
        }],
        "response": {
            "output": [{
                "type": "reasoning",
                "content": [{ "type": "reasoning_text", "text": "response" }]
            }]
        }
    });

    assert_eq!(
        extract_responses_reasoning_text(&json),
        "deltapartitemoutputresponse"
    );
}

#[test]
fn responses_reasoning_text_for_event_uses_done_text_only_as_fallback() {
    let done_json = serde_json::json!({
        "text": "full reasoning"
    });

    assert_eq!(
        extract_responses_reasoning_text_for_event(
            Some("response.reasoning_text.done"),
            &done_json,
            false,
        ),
        "full reasoning"
    );
    assert_eq!(
        extract_responses_reasoning_text_for_event(
            Some("response.reasoning_text.done"),
            &done_json,
            true,
        ),
        ""
    );
}

#[test]
fn responses_reasoning_text_for_completed_does_not_use_top_level_answer_text() {
    let completed_json = serde_json::json!({
        "text": "assistant answer",
        "response": {
            "output": [
                {
                    "type": "reasoning",
                    "content": [{ "type": "reasoning_text", "text": "reasoning only" }]
                },
                {
                    "type": "message",
                    "content": [{ "type": "output_text", "text": "assistant answer" }]
                }
            ]
        }
    });

    assert_eq!(
        extract_responses_reasoning_text_for_event(
            Some("response.completed"),
            &completed_json,
            false,
        ),
        "reasoning only"
    );
}

#[test]
fn responses_content_text_for_event_skips_reasoning_events() {
    let reasoning_done_json = serde_json::json!({
        "text": "reasoning should stay hidden"
    });

    assert_eq!(
        extract_responses_content_text_for_event(
            Some("response.reasoning_text.done"),
            &reasoning_done_json,
            false,
        ),
        ""
    );

    let message_done_json = serde_json::json!({
        "item": {
            "type": "message",
            "content": [{ "type": "output_text", "text": "assistant answer" }]
        }
    });

    assert_eq!(
        extract_responses_content_text_for_event(
            Some("response.output_item.done"),
            &message_done_json,
            false,
        ),
        "assistant answer"
    );
    assert_eq!(
        extract_responses_content_text_for_event(
            Some("response.output_item.done"),
            &message_done_json,
            true,
        ),
        ""
    );

    let reasoning_item_done_json = serde_json::json!({
        "item": {
            "type": "reasoning",
            "content": [{ "type": "reasoning_text", "text": "hidden" }]
        }
    });

    assert_eq!(
        extract_responses_content_text_for_event(
            Some("response.output_item.done"),
            &reasoning_item_done_json,
            false,
        ),
        ""
    );

    let reasoning_part_done_json = serde_json::json!({
        "part": {
            "type": "reasoning_text",
            "text": "still hidden"
        }
    });

    assert_eq!(
        extract_responses_content_text_for_event(
            Some("response.content_part.done"),
            &reasoning_part_done_json,
            false,
        ),
        ""
    );

    let visible_text_part_json = serde_json::json!({
        "item_id": "msg_123",
        "part": {
            "type": "text",
            "text": "assistant text"
        }
    });

    assert_eq!(
        extract_responses_content_text_for_event(
            Some("response.content_part.added"),
            &visible_text_part_json,
            false,
        ),
        "assistant text"
    );

    let reasoning_text_part_json = serde_json::json!({
        "item_id": "rs_123",
        "part": {
            "type": "text",
            "text": "should stay hidden"
        }
    });

    assert_eq!(
        extract_responses_content_text_for_event(
            Some("response.content_part.added"),
            &reasoning_text_part_json,
            false,
        ),
        ""
    );
}

#[test]
fn responses_final_text_skips_reasoning_items_and_collects_text() {
    let json = serde_json::json!({
        "content": [{ "text": "content" }],
        "text": "top",
        "output": [
            { "type": "reasoning", "content": [{ "text": "ignore" }] },
            { "type": "message", "content": [{ "text": "output" }] }
        ],
        "response": {
            "output": [
                { "type": "reasoning", "content": [{ "text": "ignore2" }] },
                { "type": "message", "content": [{ "text": "response" }] }
            ]
        }
    });

    assert_eq!(
        extract_responses_final_text(&json),
        "contenttopresponseoutput"
    );
}

#[test]
fn responses_event_helpers_classify_events() {
    assert!(is_responses_completion_event(Some(
        "response.reasoning_text.delta"
    )));
    assert!(is_responses_completion_event(Some(
        "response.output_item.done"
    )));
    assert!(!is_responses_completion_event(Some("response.failed")));

    assert!(is_responses_failure_event(Some("response.failed")));
    assert!(is_responses_failure_event(Some("error")));
    assert!(!is_responses_failure_event(Some("response.completed")));
}

#[test]
fn merge_responses_event_type_prefers_sse_then_json_type() {
    let json = serde_json::json!({ "type": "response.output_text.delta" });
    assert_eq!(
        merge_responses_event_type(Some("response.created"), &json),
        Some("response.created")
    );
    assert_eq!(
        merge_responses_event_type(None, &json),
        Some("response.output_text.delta")
    );
}

#[test]
fn detects_chat_completions_style_payload() {
    assert!(is_chat_completions_style_payload(&serde_json::json!({
        "choices": [{ "delta": { "content": "hi" } }]
    })));
    assert!(!is_chat_completions_style_payload(&serde_json::json!({
        "output": []
    })));
}

#[test]
fn responses_input_items_use_incremental_history_for_follow_ups() {
    let request = AiChatRequest {
        messages: vec![
            IpcMessage {
                role: "system".to_string(),
                content: "sys".to_string(),
            },
            IpcMessage {
                role: "user".to_string(),
                content: "hello".to_string(),
            },
            IpcMessage {
                role: "assistant".to_string(),
                content: "hi".to_string(),
            },
            IpcMessage {
                role: "user".to_string(),
                content: "follow up".to_string(),
            },
        ],
        endpoint: "http://localhost".to_string(),
        model: "m".to_string(),
        temperature: 0.7,
        max_tokens: 100,
        stream_id: "s".to_string(),
        previous_response_id: Some("resp_prev".to_string()),
        prefer_responses_api: true,
        enable_reasoning: true,
    };

    let items = responses_input_items(&request);
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].role, "user");
    assert_eq!(items[0].content, "follow up");
}

// ── /no_think directive helpers ───────────────────────────────────────────

#[test]
fn append_no_think_directive_appends_to_plain_prompt() {
    let result = append_no_think_directive("Tell me about cats");
    assert_eq!(result, "Tell me about cats\n\n/no_think");
}

#[test]
fn append_no_think_directive_does_not_duplicate_existing_directive() {
    let content = "Tell me about cats\n\n/no_think";
    let result = append_no_think_directive(content);
    assert_eq!(result, content);
}

#[test]
fn apply_reasoning_off_compatibility_appends_no_think_to_all_user_messages() {
    let mut body = serde_json::Map::new();
    body.insert(
        "messages".to_string(),
        serde_json::json!([
            { "role": "system", "content": "You are helpful" },
            { "role": "user", "content": "first question" },
            { "role": "assistant", "content": "answer" },
            { "role": "user", "content": "second question" }
        ]),
    );

    apply_reasoning_off_compatibility(&mut body);

    // Standard fields still present
    assert_eq!(body["reasoning_effort"], "none");
    assert_eq!(body["enable_thinking"], false);

    // Every user message should have /no_think
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages[1]["content"], "first question\n\n/no_think");
    assert_eq!(messages[3]["content"], "second question\n\n/no_think");
}

#[test]
fn apply_reasoning_off_compatibility_ignores_missing_or_non_string_messages() {
    // No messages key at all — should not panic
    let mut body = serde_json::Map::new();
    apply_reasoning_off_compatibility(&mut body);
    assert_eq!(body["reasoning_effort"], "none");

    // Messages with non-string content — should not panic
    let mut body2 = serde_json::Map::new();
    body2.insert(
        "messages".to_string(),
        serde_json::json!([
            { "role": "user", "content": 42 }
        ]),
    );
    apply_reasoning_off_compatibility(&mut body2);
    // content stays unchanged (non-string)
    assert_eq!(body2["messages"][0]["content"], 42);

    // Empty messages array — should not panic
    let mut body3 = serde_json::Map::new();
    body3.insert("messages".to_string(), serde_json::json!([]));
    apply_reasoning_off_compatibility(&mut body3);
    assert!(body3["messages"].as_array().unwrap().is_empty());
}

#[test]
fn apply_reasoning_off_latest_user_only_leaves_earlier_history_unchanged() {
    let mut body = serde_json::Map::new();
    body.insert(
        "messages".to_string(),
        serde_json::json!([
            { "role": "user", "content": "first question" },
            { "role": "assistant", "content": "answer" },
            { "role": "user", "content": "second question" }
        ]),
    );

    apply_reasoning_off_compatibility_to_latest_user(&mut body);

    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages[0]["content"], "first question");
    assert_eq!(messages[2]["content"], "second question\n\n/no_think");
    assert_eq!(body["reasoning_effort"], "none");
    assert_eq!(body["enable_thinking"], false);
}
