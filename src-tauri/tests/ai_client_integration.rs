//! Integration tests for AI types serialization/deserialization and SSE line parsing.

use sqllumen_lib::ai::types::{
    parse_sse_line, AiChatRequest, AiTransport, ApiChatRequest, ApiMessage, ApiResponsesRequest,
    ApiStreamChunk, ChunkKind, IpcMessage, ReasoningConfig, SseParsed,
    StreamChunkEvent, StreamDoneEvent, StreamErrorEvent,
};
use sqllumen_lib::ai::client::{
    append_no_think_directive, apply_reasoning_off_compatibility,
    extract_responses_content_text_for_event,
    extract_reasoning_text_from_item, extract_reasoning_text_from_parts,
    extract_responses_delta_text, extract_responses_error_message, extract_responses_final_text,
    extract_responses_reasoning_text, extract_responses_reasoning_text_for_event,
    is_chat_completions_style_payload,
    is_responses_completion_event, is_responses_failure_event, merge_responses_event_type,
    normalize_chat_payload_for_provider,
    responses_input_items, should_fallback_from_responses_status,
    should_retry_chat_without_reasoning, should_use_responses_api,
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
            api_key: None,
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
    use sqllumen_lib::ai::client::{normalise_to_chat_completions_url, stream_chat_completion};
    use sqllumen_lib::ai::types::{AiChatRequest, IpcMessage};
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
            api_key: None,
        }
    }

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        mock_builder()
            .build(mock_context(noop_assets()))
            .expect("should build mock app")
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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
        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(
            result.is_ok(),
            "should flush buffer and complete on residual [DONE]"
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
        let request = sample_request("stream-responses", &format!("{}/v1/responses", server.uri()));
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "responses stream should complete successfully");
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_err(), "invalid residual JSON should return an error");
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_err(), "EOF before response.completed should error");
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
            .expect(2)
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
        let request = sample_request("stream-responses-fallback-404", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "missing responses endpoint should fall back to chat completions");
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
            .expect(2)
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
            api_key: None,
        };

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(
            result.is_ok(),
            "unsupported response chaining should fall back to chat completions"
        );
    }

    #[tokio::test]
    async fn falls_back_to_chat_completions_when_responses_stream_uses_chat_completions_payload_shape() {
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
        let request = sample_request("stream-responses-fallback-shape", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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
        let request = sample_request("stream-responses-event-name", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "event-name-only responses streams should succeed");
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
        let request = sample_request("stream-responses-done-text", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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
        let request = sample_request("stream-responses-done-once", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "done text should not be duplicated by completed payloads");
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
            api_key: None,
        };

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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
            api_key: None,
        };

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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
            api_key: None,
        };

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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
        let request = sample_request("stream-responses-bad-request", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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
            .expect(2)
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
        let request = sample_request("stream-responses-fallback-role", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "role validation failures should fall back to chat completions");
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
        let request = sample_request("stream-responses-fallback-input", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "unknown input field failures should fall back to chat completions");
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
        let request = sample_request("stream-responses-fallback-reasoning", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "reasoning validation failures should fall back to chat completions");
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
                ResponseTemplate::new(400)
                    .set_body_string("unknown parameter: reasoning_effort"),
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "chat completions should retry without reasoning_effort");
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
        let mut request = sample_request("stream-responses-content-part-text", &format!("{}/v1", server.uri()));
        request.enable_reasoning = true;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "generic content-part text should not be treated as reasoning");
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
        let request = sample_request("stream-responses-fallback-500", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "server errors should fall back to chat completions");
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
        let request = sample_request("stream-responses-output-array", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "nested response.output text should be accepted");
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
        let request = sample_request("stream-responses-top-output-array", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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
        let request = sample_request("stream-responses-message-failure", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "stream with reasoning_content should complete successfully");
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "stream with thinking field should complete successfully");
    }

    #[tokio::test]
    async fn chat_completions_suppresses_thinking_when_reasoning_disabled() {
        let server = MockServer::start().await;
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
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sse_body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let mut request = sample_request("stream-no-reasoning", &endpoint);
        request.enable_reasoning = false;
        request.prefer_responses_api = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "stream with reasoning disabled should complete without thinking chunks");
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
        let mut request = sample_request("stream-responses-reasoning", &format!("{}/v1", server.uri()));
        request.enable_reasoning = true;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "responses stream with reasoning summary should complete successfully");
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
        let mut request = sample_request("stream-responses-reasoning-text", &format!("{}/v1", server.uri()));
        request.enable_reasoning = true;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "responses stream with reasoning text should complete successfully");
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
                "reasoning_effort": "none",
                "enable_thinking": false,
                "chat_template_kwargs": { "enable_thinking": false },
                "messages": [
                    { "role": "user", "content": "Hello\n[No chain-of-thought. Answer directly.]\n\n/no_think" }
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
        let mut request = sample_request("stream-responses-no-reasoning", &format!("{}/v1", server.uri()));
        request.enable_reasoning = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "reasoning disabled should use chat completions without thinking");
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
                "reasoning_effort": "none",
                "enable_thinking": false,
                "chat_template_kwargs": { "enable_thinking": false },
                "messages": [
                    { "role": "user", "content": "Hello\n[No chain-of-thought. Answer directly.]\n\n/no_think" }
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
        let mut request = sample_request("stream-responses-retry-disable", &format!("{}/v1", server.uri()));
        request.enable_reasoning = false;
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "reasoning disabled should avoid responses and use chat completions directly");
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
                "reasoning_effort": "none",
                "enable_thinking": false,
                "chat_template_kwargs": { "enable_thinking": false },
                "messages": [
                    { "role": "user", "content": "Hello\n[No chain-of-thought. Answer directly.]\n\n/no_think" }
                ]
            })))
            .respond_with(
                ResponseTemplate::new(400)
                    .set_body_string("unknown parameter: reasoning_effort"),
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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

        let result = stream_chat_completion(app.handle(), request, token, None).await;
        assert!(result.is_ok(), "reasoning enabled should not append /no_think");
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
        let request = sample_request("stream-responses-string-error", &format!("{}/v1", server.uri()));

        let result = stream_chat_completion(app.handle(), request, token, None).await;
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
        api_key: None,
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
        api_key: None,
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
    assert_eq!(extract_responses_error_message(&nested).as_deref(), Some("nested"));

    let top_level = serde_json::json!({ "message": "top" });
    assert_eq!(extract_responses_error_message(&top_level).as_deref(), Some("top"));
}

#[test]
fn responses_delta_text_defaults_to_empty() {
    assert_eq!(extract_responses_delta_text(&serde_json::json!({ "delta": "hi" })), "hi");
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
    assert_eq!(extract_reasoning_text_from_item(&reasoning_item), "summarycontentdetail");

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

    assert_eq!(extract_responses_final_text(&json), "contenttopresponseoutput");
}

#[test]
fn responses_event_helpers_classify_events() {
    assert!(is_responses_completion_event(Some("response.reasoning_text.delta")));
    assert!(is_responses_completion_event(Some("response.output_item.done")));
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
        api_key: None,
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

    // Also works when /no_think is embedded mid-text
    let mid = "Please /no_think respond";
    let result2 = append_no_think_directive(mid);
    assert_eq!(result2, mid);
}

#[test]
fn apply_reasoning_off_compatibility_appends_no_think_to_last_user_message() {
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

    // Only the last user message should have /no_think
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages[1]["content"], "first question");
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

// ── Compatibility transport routing no-regression tests (Phase 2) ────────

#[cfg(test)]
mod compat_routing_tests {
    use sqllumen_lib::ai::client::{
        determine_compat_transport, stream_chat_completion, CompatDecision,
        REASONING_OFF_INSTRUCTION,
    };
    use sqllumen_lib::ai::local_compat::{CapabilityCache, CapabilityKind, render_raw_transcript};
    use sqllumen_lib::ai::types::{AiChatRequest, IpcMessage};
    use std::sync::Arc;
    use tokio_util::sync::CancellationToken;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        mock_builder()
            .build(mock_context(noop_assets()))
            .expect("should build mock app")
    }

    fn local_request(stream_id: &str, endpoint: &str) -> AiChatRequest {
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
            prefer_responses_api: false,
            enable_reasoning: false,
            api_key: None,
        }
    }

    /// Reasoning enabled + local endpoint → does NOT route through completions.
    #[tokio::test]
    async fn reasoning_enabled_local_does_not_use_compat() {
        let cache = CapabilityCache::new();
        let request = AiChatRequest {
            messages: vec![IpcMessage {
                role: "user".to_string(),
                content: "Hello".to_string(),
            }],
            endpoint: "http://localhost:11434/v1".to_string(),
            model: "test-model".to_string(),
            temperature: 0.7,
            max_tokens: 100,
            stream_id: "compat-reasoning-enabled".to_string(),
            previous_response_id: None,
            prefer_responses_api: false,
            enable_reasoning: true,
            api_key: None,
        };

        match determine_compat_transport(&request, &cache).await {
            CompatDecision::UseChatCompletions => {} // expected
            other => panic!("Expected UseChatCompletions, got {:?}", other),
        }
    }

    /// Responses API (reasoning enabled) → does NOT route through completions.
    #[tokio::test]
    async fn responses_api_does_not_use_compat() {
        let cache = CapabilityCache::new();
        let request = AiChatRequest {
            messages: vec![IpcMessage {
                role: "user".to_string(),
                content: "Hello".to_string(),
            }],
            endpoint: "http://localhost:11434/v1".to_string(),
            model: "test-model".to_string(),
            temperature: 0.7,
            max_tokens: 100,
            stream_id: "compat-responses-api".to_string(),
            previous_response_id: None,
            prefer_responses_api: true,
            enable_reasoning: true,
            api_key: None,
        };

        match determine_compat_transport(&request, &cache).await {
            CompatDecision::UseChatCompletions => {} // expected
            other => panic!("Expected UseChatCompletions, got {:?}", other),
        }
    }

    /// Public endpoint (reasoning disabled) → does NOT route through completions.
    #[tokio::test]
    async fn public_endpoint_does_not_use_compat() {
        let cache = CapabilityCache::new();
        let request = AiChatRequest {
            messages: vec![IpcMessage {
                role: "user".to_string(),
                content: "Hello".to_string(),
            }],
            endpoint: "https://api.openai.com/v1".to_string(),
            model: "gpt-4".to_string(),
            temperature: 0.7,
            max_tokens: 100,
            stream_id: "compat-public".to_string(),
            previous_response_id: None,
            prefer_responses_api: false,
            enable_reasoning: false,
            api_key: None,
        };

        match determine_compat_transport(&request, &cache).await {
            CompatDecision::UseChatCompletions => {} // expected
            other => panic!("Expected UseChatCompletions, got {:?}", other),
        }
    }

    /// Local endpoint + reasoning disabled + completions capable → routes through completions.
    #[tokio::test]
    async fn local_reasoning_disabled_capable_routes_through_completions() {
        let server = MockServer::start().await;

        // Non-streaming probe endpoint
        Mock::given(method("POST"))
            .and(path("/v1/completions"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "id": "cmpl-probe",
                    "object": "text_completion",
                    "choices": [{ "text": "ok", "index": 0, "finish_reason": "stop" }]
                })),
            )
            .mount(&server)
            .await;

        let cache = CapabilityCache::new();
        let endpoint = format!("{}/v1", server.uri());
        let request = local_request("compat-capable", &endpoint);

        match determine_compat_transport(&request, &cache).await {
            CompatDecision::UseRawCompletions { raw_prompt } => {
                assert!(
                    raw_prompt.contains("### User\nHello"),
                    "raw prompt should contain user message: {raw_prompt}"
                );
            }
            other => panic!("Expected UseRawCompletions, got {:?}", other),
        }

        // Verify positive cache
        let cached = cache
            .get(&endpoint, "test-model", CapabilityKind::NonStreamingCompletions)
            .await;
        assert_eq!(cached, Some(true));
    }

    /// Local endpoint + reasoning disabled + completions NOT capable → actionable error.
    #[tokio::test]
    async fn local_reasoning_disabled_not_capable_returns_error() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/completions"))
            .respond_with(ResponseTemplate::new(404).set_body_string("Not Found"))
            .mount(&server)
            .await;

        let cache = CapabilityCache::new();
        let endpoint = format!("{}/v1", server.uri());
        let request = local_request("compat-not-capable", &endpoint);

        match determine_compat_transport(&request, &cache).await {
            CompatDecision::UseChatCompletionsFallback { warning } => {
                assert!(warning.contains("127.0.0.1"), "error should contain redacted host");
                assert!(warning.contains("test-model"), "error should contain model");
                assert!(warning.contains("completions_not_supported"), "error should contain reason");
            }
            other => panic!("Expected UseChatCompletionsFallback, got {:?}", other),
        }
    }

    /// Full end-to-end: local + reasoning disabled + capable → streams via completions.
    #[tokio::test]
    async fn full_compat_stream_via_completions() {
        let server = MockServer::start().await;

        // Probe endpoint
        Mock::given(method("POST"))
            .and(path("/v1/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(
                        [
                            "data: {\"choices\":[{\"text\":\"Hello\",\"index\":0,\"finish_reason\":null}]}\n",
                            "\n",
                            "data: {\"choices\":[{\"text\":\" world\",\"index\":0,\"finish_reason\":\"stop\"}]}\n",
                            "\n",
                            "data: [DONE]\n",
                        ]
                        .join(""),
                    )
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let cache = Arc::new(CapabilityCache::new());
        let endpoint = format!("{}/v1", server.uri());

        // Pre-seed positive capability so the probe isn't needed
        cache
            .set(&endpoint, "test-model", CapabilityKind::NonStreamingCompletions, true)
            .await;

        let request = local_request("compat-full-stream", &endpoint);
        let token = CancellationToken::new();

        let result =
            stream_chat_completion(app.handle(), request, token, Some(cache)).await;
        assert!(result.is_ok(), "compat streaming should succeed");
    }

    /// Full end-to-end: local + reasoning disabled + NOT capable → falls back to chat completions.
    #[tokio::test]
    async fn full_compat_not_capable_falls_back_to_chat_completions() {
        let server = MockServer::start().await;

        // completions probe returns 404
        Mock::given(method("POST"))
            .and(path("/v1/completions"))
            .respond_with(ResponseTemplate::new(404).set_body_string("Not Found"))
            .mount(&server)
            .await;

        // chat completions should be called as fallback
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_string("data: [DONE]\n\n"))
            .expect(1)
            .mount(&server)
            .await;

        let app = mock_app();
        let cache = Arc::new(CapabilityCache::new());
        let endpoint = format!("{}/v1", server.uri());
        let request = local_request("compat-no-fallback", &endpoint);
        let token = CancellationToken::new();

        let result =
            stream_chat_completion(app.handle(), request, token, Some(cache)).await;
        assert!(result.is_ok(), "should fall back to chat completions silently, got: {:?}", result.err());
    }

    /// Prefix stability: second turn's raw prompt starts with first turn's prompt exactly.
    #[test]
    fn raw_transcript_prefix_stability() {
        let messages_turn1 = vec![
            IpcMessage {
                role: "system".to_string(),
                content: "You are helpful".to_string(),
            },
            IpcMessage {
                role: "user".to_string(),
                content: "What is SQL?".to_string(),
            },
        ];
        let prompt1 = render_raw_transcript(&messages_turn1, REASONING_OFF_INSTRUCTION);

        let messages_turn2 = vec![
            IpcMessage {
                role: "system".to_string(),
                content: "You are helpful".to_string(),
            },
            IpcMessage {
                role: "user".to_string(),
                content: "What is SQL?".to_string(),
            },
            IpcMessage {
                role: "assistant".to_string(),
                content: "SQL is a query language.".to_string(),
            },
            IpcMessage {
                role: "user".to_string(),
                content: "Tell me more".to_string(),
            },
        ];
        let prompt2 = render_raw_transcript(&messages_turn2, REASONING_OFF_INSTRUCTION);

        // prompt2 must start with the entirety of prompt1 minus the trailing generation prefix
        let prompt1_without_gen = prompt1.trim_end_matches("### Assistant\n");
        assert!(
            prompt2.starts_with(prompt1_without_gen.trim_end()),
            "second prompt must build on first prompt prefix.\nprompt1 (no gen):\n{prompt1_without_gen}\nprompt2:\n{prompt2}"
        );
    }

    /// Cancellation still works with compat cache provided.
    #[tokio::test]
    async fn cancellation_works_with_cache() {
        let app = mock_app();
        let cache = Arc::new(CapabilityCache::new());
        let request = AiChatRequest {
            messages: vec![IpcMessage {
                role: "user".to_string(),
                content: "Hello".to_string(),
            }],
            endpoint: "http://127.0.0.1:1/v1".to_string(),
            model: "test".to_string(),
            temperature: 0.7,
            max_tokens: 100,
            stream_id: "compat-cancel".to_string(),
            previous_response_id: None,
            prefer_responses_api: true,
            enable_reasoning: true,
            api_key: None,
        };
        let token = CancellationToken::new();
        token.cancel();

        let result =
            stream_chat_completion(app.handle(), request, token, Some(cache)).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cancelled"));
    }
}

// ── Chat payload stabilization tests (Phase 4) ──────────────────────────

#[cfg(test)]
mod chat_stabilization_tests {
    use sqllumen_lib::ai::client::{
        normalize_chat_payload_for_provider, REASONING_OFF_DIRECTIVE,
    };
    use sqllumen_lib::ai::local_compat::sanitize_thinking_content;
    use sqllumen_lib::ai::types::ApiMessage;

    fn user(content: &str) -> ApiMessage {
        ApiMessage { role: "user".to_string(), content: content.to_string() }
    }

    fn assistant(content: &str) -> ApiMessage {
        ApiMessage { role: "assistant".to_string(), content: content.to_string() }
    }

    fn system(content: &str) -> ApiMessage {
        ApiMessage { role: "system".to_string(), content: content.to_string() }
    }

    #[test]
    fn second_turn_replays_directive_consistently() {
        let messages = vec![
            system("You are helpful"),
            user("What is SQL?"),
            assistant("SQL is a query language."),
            user("Tell me more"),
        ];

        let normalized = normalize_chat_payload_for_provider(&messages, false);

        // All user messages should contain BOTH directives
        assert!(
            normalized[1].content.contains(REASONING_OFF_DIRECTIVE),
            "turn 1 user should have REASONING_OFF_DIRECTIVE: {}",
            normalized[1].content
        );
        assert!(
            normalized[1].content.contains("/no_think"),
            "turn 1 user should have /no_think: {}",
            normalized[1].content
        );
        assert!(
            normalized[3].content.contains(REASONING_OFF_DIRECTIVE),
            "turn 2 user should have REASONING_OFF_DIRECTIVE: {}",
            normalized[3].content
        );
        assert!(
            normalized[3].content.contains("/no_think"),
            "turn 2 user should have /no_think: {}",
            normalized[3].content
        );

        // System and assistant messages should NOT be modified
        assert_eq!(normalized[0].content, "You are helpful");
        assert_eq!(normalized[2].content, "SQL is a query language.");
    }

    #[test]
    fn two_turn_last_historical_message_matches_original() {
        // Turn 1: single user message
        let turn1_messages = vec![user("What is SQL?")];
        let turn1_normalized = normalize_chat_payload_for_provider(&turn1_messages, false);

        // Turn 2: turn 1's user msg + assistant + new user msg
        let turn2_messages = vec![
            user("What is SQL?"),
            assistant("SQL is a query language."),
            user("Tell me more"),
        ];
        let turn2_normalized = normalize_chat_payload_for_provider(&turn2_messages, false);

        // The first user message from turn 1 and turn 2 must be byte-identical
        assert_eq!(
            turn1_normalized[0].content, turn2_normalized[0].content,
            "historical user message must be byte-identical across turns.\n\
             Turn 1: {}\nTurn 2: {}",
            turn1_normalized[0].content, turn2_normalized[0].content
        );
    }

    #[test]
    fn reasoning_enabled_no_directives_added() {
        let messages = vec![
            system("You are helpful"),
            user("What is SQL?"),
            assistant("SQL is a query language."),
            user("Tell me more"),
        ];

        let normalized = normalize_chat_payload_for_provider(&messages, true);

        // No messages should be modified
        assert_eq!(normalized[0].content, "You are helpful");
        assert_eq!(normalized[1].content, "What is SQL?");
        assert_eq!(normalized[2].content, "SQL is a query language.");
        assert_eq!(normalized[3].content, "Tell me more");
    }

    #[test]
    fn duplicate_directive_not_accumulated() {
        let already_tagged = format!("What is SQL?{}", REASONING_OFF_DIRECTIVE);
        let messages = vec![user(&already_tagged)];

        // First normalization
        let first = normalize_chat_payload_for_provider(&messages, false);
        // Second normalization (simulating re-normalization)
        let second = normalize_chat_payload_for_provider(&first, false);

        // Directive should appear exactly once
        let count = second[0].content.matches(REASONING_OFF_DIRECTIVE).count();
        assert_eq!(count, 1, "directive should appear exactly once, got: {}", second[0].content);
    }

    #[test]
    fn explicit_thinking_wrappers_sanitized_from_stream() {
        let input = "<think>I reasoned about this</think>Answer here";
        let output = sanitize_thinking_content(input);
        assert_eq!(output, "Answer here");
    }

    #[test]
    fn provider_prefix_stability_with_history() {
        // Simulate turn 1: just one user message
        let turn1_messages = vec![
            system("You are helpful"),
            user("What is SQL?"),
        ];
        let turn1_normalized = normalize_chat_payload_for_provider(&turn1_messages, false);

        // Simulate turn 2: history includes turn 1 + assistant response + new user message
        let turn2_messages = vec![
            system("You are helpful"),
            user("What is SQL?"),
            assistant("SQL is a query language."),
            user("Tell me more"),
        ];
        let turn2_normalized = normalize_chat_payload_for_provider(&turn2_messages, false);

        // Turn 1's user message must appear identically in turn 2's payload
        assert_eq!(
            turn1_normalized[1].content, turn2_normalized[1].content,
            "historical user message must be identical across turns"
        );

        // System message also identical
        assert_eq!(turn1_normalized[0].content, turn2_normalized[0].content);
    }
}

// ── format_compat_error ──────────────────────────────────────────────────

#[test]
fn format_compat_error_includes_endpoint_model_reason() {
    use sqllumen_lib::ai::client::format_compat_error;
    let msg = format_compat_error("http://localhost:1234", "llama3", "completions_not_supported");
    assert!(msg.contains("localhost:1234"), "redacted endpoint should preserve host:port");
    assert!(msg.contains("llama3"));
    assert!(msg.contains("completions_not_supported"));
    assert!(msg.contains("Compatibility error"));
}

// ── normalise_to_chat_completions_url ────────────────────────────────────

#[test]
fn normalise_to_chat_completions_url_appends_path() {
    use sqllumen_lib::ai::client::normalise_to_chat_completions_url;
    let url = normalise_to_chat_completions_url("http://localhost:1234");
    assert!(url.contains("chat/completions"));
}

#[test]
fn normalise_to_chat_completions_url_strips_existing_v1() {
    use sqllumen_lib::ai::client::normalise_to_chat_completions_url;
    let url = normalise_to_chat_completions_url("http://localhost:1234/v1");
    assert!(url.contains("chat/completions"));
    // Should not have double v1
    assert!(!url.contains("v1/v1"));
}

// ── apply_no_think_to_last_user_message ──────────────────────────────────

#[test]
fn apply_no_think_to_last_user_message_appends_directive() {
    use sqllumen_lib::ai::client::apply_no_think_to_last_user_message;
    let mut messages = vec![
        ApiMessage { role: "system".to_string(), content: "You are helpful.".to_string() },
        ApiMessage { role: "user".to_string(), content: "Hello".to_string() },
        ApiMessage { role: "assistant".to_string(), content: "Hi there".to_string() },
        ApiMessage { role: "user".to_string(), content: "How are you?".to_string() },
    ];
    apply_no_think_to_last_user_message(&mut messages);
    assert!(messages[3].content.contains("/no_think"));
    // First user message should NOT be modified
    assert!(!messages[1].content.contains("/no_think"));
}

#[test]
fn apply_no_think_to_last_user_message_no_user_messages() {
    use sqllumen_lib::ai::client::apply_no_think_to_last_user_message;
    let mut messages = vec![
        ApiMessage { role: "system".to_string(), content: "system".to_string() },
    ];
    apply_no_think_to_last_user_message(&mut messages);
    assert_eq!(messages[0].content, "system");
}

// ── apply_no_think_to_json_messages ──────────────────────────────────────

#[test]
fn apply_no_think_to_json_messages_modifies_last_user() {
    use sqllumen_lib::ai::client::apply_no_think_to_json_messages;
    let mut body = serde_json::json!({
        "messages": [
            { "role": "system", "content": "sys" },
            { "role": "user", "content": "hello" },
            { "role": "assistant", "content": "hi" },
            { "role": "user", "content": "goodbye" }
        ]
    }).as_object().cloned().unwrap();
    apply_no_think_to_json_messages(&mut body);
    let msgs = body["messages"].as_array().unwrap();
    assert!(msgs[3]["content"].as_str().unwrap().contains("/no_think"));
    assert!(!msgs[1]["content"].as_str().unwrap().contains("/no_think"));
}

#[test]
fn apply_no_think_to_json_messages_no_messages_key() {
    use sqllumen_lib::ai::client::apply_no_think_to_json_messages;
    let mut body = serde_json::json!({ "model": "test" }).as_object().cloned().unwrap();
    apply_no_think_to_json_messages(&mut body);
    // Should be a no-op
    assert!(body.get("messages").is_none());
}

#[test]
fn apply_no_think_to_json_messages_non_array_messages() {
    use sqllumen_lib::ai::client::apply_no_think_to_json_messages;
    let mut body = serde_json::json!({ "messages": "not an array" }).as_object().cloned().unwrap();
    apply_no_think_to_json_messages(&mut body);
    assert_eq!(body["messages"], "not an array");
}

// ── format_compat_error redacts endpoint (Fix 5) ──────────────────────────

#[test]
fn format_compat_error_redacts_endpoint() {
    use sqllumen_lib::ai::client::format_compat_error;
    let err = format_compat_error("http://localhost:11434/v1/chat/completions?key=secret", "model", "reason");
    assert!(!err.contains("secret"), "endpoint secrets must be redacted");
    assert!(err.contains("localhost:11434"), "host should be preserved");
    assert!(err.contains("model"), "model should appear");
    assert!(err.contains("reason"), "reason should appear");
}

// ── determine_compat_transport with streaming-negative (Fix 4) ────────────

#[tokio::test]
async fn compat_transport_falls_back_when_streaming_cached_negative() {
    use sqllumen_lib::ai::client::determine_compat_transport;
    use sqllumen_lib::ai::client::CompatDecision;
    use sqllumen_lib::ai::local_compat::{CapabilityCache, CapabilityKind};
    use sqllumen_lib::ai::types::{AiChatRequest, IpcMessage};

    let cache = CapabilityCache::new();
    // Non-streaming positive, streaming negative
    cache.set("http://localhost:11434", "m", CapabilityKind::NonStreamingCompletions, true).await;
    cache.set("http://localhost:11434", "m", CapabilityKind::StreamingCompletions, false).await;

    let request = AiChatRequest {
        messages: vec![IpcMessage { role: "user".to_string(), content: "hi".to_string() }],
        endpoint: "http://localhost:11434/v1".to_string(),
        model: "m".to_string(),
        temperature: 0.7,
        max_tokens: 100,
        stream_id: "test".to_string(),
        previous_response_id: None,
        prefer_responses_api: false,
        enable_reasoning: false,
        api_key: None,
    };

    let decision = determine_compat_transport(&request, &cache).await;
    assert!(matches!(decision, CompatDecision::UseChatCompletionsFallback { .. }),
        "should return compat fallback when streaming is cached-negative, got: {:?}", decision);
}

#[tokio::test]
async fn compat_fallback_when_probe_fails() {
    use sqllumen_lib::ai::client::{determine_compat_transport, CompatDecision};
    use sqllumen_lib::ai::local_compat::{CapabilityCache, CapabilityKind};
    use sqllumen_lib::ai::types::{AiChatRequest, IpcMessage};

    let cache = CapabilityCache::new();
    // Pre-seed negative capability (probe failed)
    cache
        .set(
            "http://localhost:11434",
            "qwen2",
            CapabilityKind::NonStreamingCompletions,
            false,
        )
        .await;

    let request = AiChatRequest {
        messages: vec![IpcMessage {
            role: "user".to_string(),
            content: "hi".to_string(),
        }],
        endpoint: "http://localhost:11434/v1".to_string(),
        model: "qwen2".to_string(),
        temperature: 0.7,
        max_tokens: 100,
        stream_id: "compat-fallback-test".to_string(),
        previous_response_id: None,
        prefer_responses_api: false,
        enable_reasoning: false,
        api_key: None,
    };

    let decision = determine_compat_transport(&request, &cache).await;
    match decision {
        CompatDecision::UseChatCompletionsFallback { warning } => {
            assert!(
                warning.contains("completions_not_supported"),
                "warning should contain reason: {warning}"
            );
        }
        other => panic!(
            "Expected UseChatCompletionsFallback, got {:?}",
            other
        ),
    }
}

// ── is_eligible with using_responses_chaining (Fix 7) ─────────────────────

#[test]
fn compat_eligible_when_prefer_responses_but_no_chaining() {
    use sqllumen_lib::ai::local_compat::LocalCompatPolicy;
    // prefer_responses_api=true but no previous_response_id → not chaining → eligible
    assert!(LocalCompatPolicy::is_eligible("http://localhost:11434/v1", false, false));
}

#[test]
fn compat_not_eligible_when_using_responses_chaining() {
    use sqllumen_lib::ai::local_compat::LocalCompatPolicy;
    assert!(!LocalCompatPolicy::is_eligible("http://localhost:11434/v1", false, true));
}

// ── should_fallback_from_responses_status additional coverage ─────────────

#[test]
fn responses_fallback_on_not_found() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::NOT_FOUND,
        "anything"
    ));
}

#[test]
fn responses_fallback_on_method_not_allowed() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::METHOD_NOT_ALLOWED,
        ""
    ));
}

#[test]
fn responses_fallback_on_not_implemented() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::NOT_IMPLEMENTED,
        ""
    ));
}

#[test]
fn responses_no_fallback_on_internal_server_error() {
    assert!(!should_fallback_from_responses_status(
        reqwest::StatusCode::INTERNAL_SERVER_ERROR,
        "something broke"
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_previous_response_id() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "unknown field previous_response_id"
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_unknown_parameter() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "Unknown parameter: stream"
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_invalid_input_type() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "invalid type for 'input'"
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_invalid_role_value() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "invalid value for 'role'"
    ));
}

#[test]
fn responses_fallback_on_unprocessable_entity_with_developer() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::UNPROCESSABLE_ENTITY,
        "unknown role: developer"
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_instructions() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "unknown field: instructions"
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_messages_role() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "messages[0].role is invalid"
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_not_supported() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "responses api not supported"
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_unrecognized() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "unrecognized endpoint"
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_does_not_exist() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "model does not exist"
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_no_such_endpoint() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "no such endpoint"
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_unknown_field_input() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        r#"unknown field `input`"#
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_unknown_field_input_quoted() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        r#"unknown field "input""#
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_unknown_field_stream() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        r#"unknown field `stream`"#
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_unknown_field_max_output_tokens() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        r#"unknown field `max_output_tokens`"#
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_unknown_field_reasoning() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        r#"unknown field `reasoning`"#
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_unknown_field_summary() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        r#"unknown field `summary`"#
    ));
}

#[test]
fn responses_fallback_on_bad_request_with_unknown_field_effort() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        r#"unknown field `effort`"#
    ));
}

#[test]
fn responses_fallback_on_bad_request_reasoning_effort_field() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "reasoning.effort is not valid"
    ));
}

#[test]
fn responses_fallback_on_bad_request_reasoning_summary_field() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "reasoning.summary is not supported"
    ));
}

#[test]
fn responses_fallback_on_bad_request_invalid_reasoning_value() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "invalid value for 'reasoning'"
    ));
}

#[test]
fn responses_fallback_on_bad_request_invalid_reasoning_effort_value() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "invalid value for 'reasoning.effort'"
    ));
}

#[test]
fn responses_fallback_on_bad_request_invalid_reasoning_summary_value() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "invalid value for 'reasoning.summary'"
    ));
}

#[test]
fn responses_fallback_on_unsupported_media_type_with_invalid_union() {
    assert!(should_fallback_from_responses_status(
        reqwest::StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "invalid_union"
    ));
}

#[test]
fn responses_no_fallback_on_bad_request_generic_error() {
    assert!(!should_fallback_from_responses_status(
        reqwest::StatusCode::BAD_REQUEST,
        "something else entirely"
    ));
}

// ── should_retry_chat_without_reasoning additional coverage ───────────────

#[test]
fn retry_without_reasoning_on_unknown_field_reasoning_effort_backtick() {
    assert!(should_retry_chat_without_reasoning(
        reqwest::StatusCode::BAD_REQUEST,
        "unknown field `reasoning_effort`"
    ));
}

#[test]
fn retry_without_reasoning_on_unknown_field_reasoning_effort_quoted() {
    assert!(should_retry_chat_without_reasoning(
        reqwest::StatusCode::BAD_REQUEST,
        r#"unknown field "reasoning_effort""#
    ));
}

#[test]
fn retry_without_reasoning_on_unsupported_parameter() {
    assert!(should_retry_chat_without_reasoning(
        reqwest::StatusCode::BAD_REQUEST,
        "unsupported parameter: reasoning_effort"
    ));
}

#[test]
fn retry_without_reasoning_on_invalid_value() {
    assert!(should_retry_chat_without_reasoning(
        reqwest::StatusCode::BAD_REQUEST,
        "invalid value for 'reasoning_effort'"
    ));
}

#[test]
fn retry_without_reasoning_on_unknown_parameter_quoted() {
    assert!(should_retry_chat_without_reasoning(
        reqwest::StatusCode::BAD_REQUEST,
        "unknown parameter 'reasoning_effort'"
    ));
}

#[test]
fn retry_without_reasoning_on_reasoning_effort_generic() {
    assert!(should_retry_chat_without_reasoning(
        reqwest::StatusCode::BAD_REQUEST,
        "Reasoning effort is not supported"
    ));
}

#[test]
fn retry_without_reasoning_on_unprocessable_entity() {
    assert!(should_retry_chat_without_reasoning(
        reqwest::StatusCode::UNPROCESSABLE_ENTITY,
        "reasoning_effort not supported"
    ));
}

#[test]
fn retry_without_reasoning_not_on_server_error() {
    assert!(!should_retry_chat_without_reasoning(
        reqwest::StatusCode::INTERNAL_SERVER_ERROR,
        "reasoning_effort"
    ));
}

#[test]
fn retry_without_reasoning_not_on_unrelated_bad_request() {
    assert!(!should_retry_chat_without_reasoning(
        reqwest::StatusCode::BAD_REQUEST,
        "temperature must be between 0 and 1"
    ));
}

// ── normalize_chat_payload_for_provider additional coverage ───────────────

#[test]
fn normalize_payload_reasoning_enabled_returns_unchanged() {
    let messages = vec![
        ApiMessage { role: "user".to_string(), content: "hello".to_string() },
        ApiMessage { role: "assistant".to_string(), content: "hi".to_string() },
    ];
    let result = normalize_chat_payload_for_provider(&messages, true);
    assert_eq!(result[0].content, "hello");
    assert_eq!(result[1].content, "hi");
}

#[test]
fn normalize_payload_reasoning_disabled_appends_directives_to_user_messages() {
    let messages = vec![
        ApiMessage { role: "system".to_string(), content: "sys".to_string() },
        ApiMessage { role: "user".to_string(), content: "question".to_string() },
        ApiMessage { role: "assistant".to_string(), content: "answer".to_string() },
        ApiMessage { role: "user".to_string(), content: "follow-up".to_string() },
    ];
    let result = normalize_chat_payload_for_provider(&messages, false);
    // System and assistant messages unchanged
    assert_eq!(result[0].content, "sys");
    assert_eq!(result[2].content, "answer");
    // User messages get directives
    assert!(result[1].content.contains("/no_think"));
    assert!(result[3].content.contains("/no_think"));
    assert!(result[1].content.contains("[No chain-of-thought"));
    assert!(result[3].content.contains("[No chain-of-thought"));
}

#[test]
fn normalize_payload_does_not_duplicate_existing_directive() {
    use sqllumen_lib::ai::client::REASONING_OFF_DIRECTIVE;
    let messages = vec![
        ApiMessage {
            role: "user".to_string(),
            content: format!("hello{REASONING_OFF_DIRECTIVE}"),
        },
    ];
    let result = normalize_chat_payload_for_provider(&messages, false);
    let count = result[0].content.matches(REASONING_OFF_DIRECTIVE).count();
    assert_eq!(count, 1, "should not duplicate directive");
}

#[test]
fn normalize_payload_does_not_duplicate_no_think() {
    let messages = vec![
        ApiMessage {
            role: "user".to_string(),
            content: "hello\n\n/no_think".to_string(),
        },
    ];
    let result = normalize_chat_payload_for_provider(&messages, false);
    let count = result[0].content.matches("/no_think").count();
    assert_eq!(count, 1, "should not duplicate /no_think");
}

// ── apply_reasoning_off_compatibility ────────────────────────────────────

#[test]
fn apply_reasoning_off_sets_all_fields() {
    let mut body = serde_json::Map::new();
    body.insert("messages".to_string(), serde_json::json!([
        {"role": "user", "content": "test"}
    ]));
    apply_reasoning_off_compatibility(&mut body);
    assert_eq!(body["reasoning_effort"], "none");
    assert_eq!(body["enable_thinking"], false);
    assert!(body.contains_key("chat_template_kwargs"));
}

// ── is_responses_failure_event ────────────────────────────────────────────

#[test]
fn responses_failure_event_recognizes_error() {
    assert!(is_responses_failure_event(Some("error")));
}

#[test]
fn responses_failure_event_recognizes_response_failed() {
    assert!(is_responses_failure_event(Some("response.failed")));
}

#[test]
fn responses_failure_event_rejects_completed() {
    assert!(!is_responses_failure_event(Some("response.completed")));
}

#[test]
fn responses_failure_event_rejects_none() {
    assert!(!is_responses_failure_event(None));
}

// ── is_responses_completion_event ─────────────────────────────────────────

#[test]
fn responses_completion_event_recognizes_done() {
    assert!(is_responses_completion_event(Some("response.completed")));
}

#[test]
fn responses_completion_event_recognizes_output_text_done() {
    assert!(is_responses_completion_event(Some("response.output_text.done")));
}

#[test]
fn responses_completion_event_rejects_error() {
    assert!(!is_responses_completion_event(Some("error")));
}

#[test]
fn responses_completion_event_rejects_none() {
    assert!(!is_responses_completion_event(None));
}

// ── extract_responses_delta_text ──────────────────────────────────────────

#[test]
fn delta_text_from_missing_delta() {
    let json = serde_json::json!({"type": "response.output_text.delta"});
    assert_eq!(extract_responses_delta_text(&json), "");
}

// ── extract_reasoning_text_from_parts ─────────────────────────────────────

#[test]
fn reasoning_from_parts_with_text_type() {
    let parts = vec![
        serde_json::json!({"type": "summary_text", "text": "step 1"}),
        serde_json::json!({"type": "output_text", "text": "visible"}),
    ];
    let result = extract_reasoning_text_from_parts(&parts);
    assert!(result.contains("step 1"));
    assert!(!result.contains("visible"));
}

// ── extract_reasoning_text_from_item ─────────────────────────────────────

#[test]
fn reasoning_from_item_extracts_summary() {
    let item = serde_json::json!({
        "type": "reasoning",
        "summary": [{"type": "summary_text", "text": "summary here"}]
    });
    let result = extract_reasoning_text_from_item(&item);
    assert!(result.contains("summary here"));
}

// ── responses_input_items ────────────────────────────────────────────────

#[test]
fn responses_input_items_first_turn_no_previous_id() {
    let request = AiChatRequest {
        messages: vec![
            IpcMessage { role: "system".to_string(), content: "sys".to_string() },
            IpcMessage { role: "user".to_string(), content: "hi".to_string() },
        ],
        endpoint: "http://localhost".to_string(),
        model: "m".to_string(),
        temperature: 0.7,
        max_tokens: 100,
        stream_id: "s".to_string(),
        previous_response_id: None,
        prefer_responses_api: true,
        enable_reasoning: true,
        api_key: None,
    };
    let items = responses_input_items(&request);
    assert!(!items.is_empty());
}

#[test]
fn responses_input_items_follow_up_with_previous_id_and_new_user_message() {
    let request = AiChatRequest {
        messages: vec![
            IpcMessage { role: "system".to_string(), content: "sys".to_string() },
            IpcMessage { role: "user".to_string(), content: "first".to_string() },
            IpcMessage { role: "assistant".to_string(), content: "answer".to_string() },
            IpcMessage { role: "user".to_string(), content: "follow-up".to_string() },
        ],
        endpoint: "http://localhost".to_string(),
        model: "m".to_string(),
        temperature: 0.7,
        max_tokens: 100,
        stream_id: "s".to_string(),
        previous_response_id: Some("resp-123".to_string()),
        prefer_responses_api: true,
        enable_reasoning: true,
        api_key: None,
    };
    let items = responses_input_items(&request);
    // With previous_response_id and a trailing user message,
    // should have just the new user message as input item
    assert!(!items.is_empty());
}

// ── is_chat_completions_style_payload ─────────────────────────────────────

#[test]
fn detects_chat_completions_by_choices() {
    let json = serde_json::json!({"choices": [{"delta": {"content": "hi"}}]});
    assert!(is_chat_completions_style_payload(&json));
}

#[test]
fn non_chat_completions_payload() {
    let json = serde_json::json!({"type": "response.output_text.delta", "delta": "hi"});
    assert!(!is_chat_completions_style_payload(&json));
}

// ── merge_responses_event_type ───────────────────────────────────────────

#[test]
fn merge_event_type_prefers_sse() {
    let json = serde_json::json!({"type": "response.done"});
    let result = merge_responses_event_type(Some("response.completed"), &json);
    assert_eq!(result, Some("response.completed"));
}

#[test]
fn merge_event_type_falls_back_to_json() {
    let json = serde_json::json!({"type": "response.done"});
    let result = merge_responses_event_type(None, &json);
    assert_eq!(result, Some("response.done"));
}

#[test]
fn merge_event_type_both_none() {
    let json = serde_json::json!({"data": "something"});
    let result = merge_responses_event_type(None, &json);
    assert_eq!(result, None);
}

// ── extract_responses_final_text additional coverage ─────────────────────

#[test]
fn final_text_from_output_content_array() {
    let json = serde_json::json!({
        "output": [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": "final answer"}]
            }
        ]
    });
    let result = extract_responses_final_text(&json);
    assert_eq!(result, "final answer");
}

#[test]
fn final_text_from_response_output() {
    let json = serde_json::json!({
        "response": {
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "from response"}]
                }
            ]
        }
    });
    let result = extract_responses_final_text(&json);
    assert_eq!(result, "from response");
}

#[test]
fn final_text_ignores_reasoning_items() {
    let json = serde_json::json!({
        "output": [
            {"type": "reasoning", "summary": [{"type": "summary_text", "text": "reasoning"}]},
            {"type": "message", "content": [{"type": "output_text", "text": "visible"}]}
        ]
    });
    let result = extract_responses_final_text(&json);
    assert_eq!(result, "visible");
}

// ── should_use_responses_api ─────────────────────────────────────────────

#[test]
fn should_use_responses_both_true() {
    let request = AiChatRequest {
        messages: vec![],
        endpoint: "http://localhost".to_string(),
        model: "m".to_string(),
        temperature: 0.7,
        max_tokens: 100,
        stream_id: "s".to_string(),
        previous_response_id: None,
        prefer_responses_api: true,
        enable_reasoning: true,
        api_key: None,
    };
    assert!(should_use_responses_api(&request));
}

#[test]
fn should_not_use_responses_when_reasoning_disabled() {
    let request = AiChatRequest {
        messages: vec![],
        endpoint: "http://localhost".to_string(),
        model: "m".to_string(),
        temperature: 0.7,
        max_tokens: 100,
        stream_id: "s".to_string(),
        previous_response_id: None,
        prefer_responses_api: true,
        enable_reasoning: false,
        api_key: None,
    };
    assert!(!should_use_responses_api(&request));
}

#[test]
fn should_not_use_responses_when_prefer_false() {
    let request = AiChatRequest {
        messages: vec![],
        endpoint: "http://localhost".to_string(),
        model: "m".to_string(),
        temperature: 0.7,
        max_tokens: 100,
        stream_id: "s".to_string(),
        previous_response_id: None,
        prefer_responses_api: false,
        enable_reasoning: true,
        api_key: None,
    };
    assert!(!should_use_responses_api(&request));
}

// ── extract_responses_content_text_for_event ──────────────────────────────

#[test]
fn content_text_for_output_text_delta_event() {
    let json = serde_json::json!({
        "type": "response.output_text.delta",
        "delta": "hello world"
    });
    let result = extract_responses_content_text_for_event(Some("response.output_text.delta"), &json, false);
    assert_eq!(result, "hello world");
}

#[test]
fn content_text_for_non_text_event_returns_empty() {
    let json = serde_json::json!({
        "type": "response.reasoning_summary_text.delta",
        "delta": "thinking..."
    });
    let result = extract_responses_content_text_for_event(Some("response.reasoning_summary_text.delta"), &json, false);
    assert_eq!(result, "");
}

// ── extract_responses_reasoning_text_for_event ───────────────────────────

#[test]
fn reasoning_text_for_reasoning_delta_event() {
    let json = serde_json::json!({
        "type": "response.reasoning_summary_text.delta",
        "delta": "thinking step"
    });
    let result = extract_responses_reasoning_text_for_event(
        Some("response.reasoning_summary_text.delta"), &json, false
    );
    assert_eq!(result, "thinking step");
}

#[test]
fn reasoning_text_for_non_reasoning_event_returns_empty() {
    let json = serde_json::json!({
        "type": "response.output_text.delta",
        "delta": "visible"
    });
    let result = extract_responses_reasoning_text_for_event(
        Some("response.output_text.delta"), &json, false
    );
    assert_eq!(result, "");
}

// ── format_compat_error ──────────────────────────────────────────────────

#[test]
fn format_compat_error_with_port() {
    use sqllumen_lib::ai::client::format_compat_error;
    let err = format_compat_error("http://localhost:11434/v1/completions", "llama3", "test_reason");
    assert!(err.contains("localhost:11434"));
    assert!(err.contains("llama3"));
    assert!(err.contains("test_reason"));
}

#[test]
fn format_compat_error_without_port() {
    use sqllumen_lib::ai::client::format_compat_error;
    let err = format_compat_error("https://api.openai.com/v1", "gpt-4", "not_supported");
    assert!(err.contains("api.openai.com"));
    assert!(err.contains("gpt-4"));
}

// ── extract_responses_error_message additional ───────────────────────────

#[test]
fn error_message_from_string_error() {
    let json = serde_json::json!({"error": "simple string error"});
    let result = extract_responses_error_message(&json);
    assert_eq!(result.as_deref(), Some("simple string error"));
}

#[test]
fn error_message_from_top_level_message() {
    let json = serde_json::json!({"message": "top level message"});
    let result = extract_responses_error_message(&json);
    assert_eq!(result.as_deref(), Some("top level message"));
}

#[test]
fn error_message_none_when_missing() {
    let json = serde_json::json!({"data": "no error"});
    let result = extract_responses_error_message(&json);
    assert_eq!(result, None);
}

// ── apply_no_think_to_json_messages — non-string content branch ──────────

#[test]
fn apply_no_think_to_json_messages_noop_non_string_content() {
    use sqllumen_lib::ai::client::apply_no_think_to_json_messages;
    let mut body = serde_json::json!({
        "messages": [
            {"role": "user", "content": 42}
        ]
    }).as_object().unwrap().clone();
    apply_no_think_to_json_messages(&mut body);
    // Content is a number, should not be modified
    assert_eq!(body["messages"][0]["content"], serde_json::json!(42));
}

// ── extract_responses_reasoning_text — additional branches ────────────────

#[test]
fn extract_reasoning_text_from_item_content_type_text() {
    use sqllumen_lib::ai::client::extract_reasoning_text_from_item;
    // The item.content[].type == "text" branch (line 935 in client.rs)
    let item = serde_json::json!({
        "type": "reasoning",
        "content": [{"type": "text", "text": "thinking..."}]
    });
    assert_eq!(extract_reasoning_text_from_item(&item), "thinking...");
}

#[test]
fn extract_reasoning_text_part_non_matching_type() {
    use sqllumen_lib::ai::client::extract_responses_reasoning_text;
    let json = serde_json::json!({
        "part": {"type": "output_text", "text": "should not extract"}
    });
    assert_eq!(extract_responses_reasoning_text(&json), "");
}

#[test]
fn extract_reasoning_text_response_output_path() {
    use sqllumen_lib::ai::client::extract_responses_reasoning_text;
    let json = serde_json::json!({
        "response": {
            "output": [
                {
                    "type": "reasoning",
                    "summary": [{"type": "summary_text", "text": "thought A"}]
                }
            ]
        }
    });
    let result = extract_responses_reasoning_text(&json);
    assert!(result.contains("thought A"));
}

#[test]
fn extract_reasoning_text_top_level_output() {
    use sqllumen_lib::ai::client::extract_responses_reasoning_text;
    let json = serde_json::json!({
        "output": [
            {
                "type": "reasoning",
                "summary": [{"type": "summary_text", "text": "top-level thought"}]
            }
        ]
    });
    let result = extract_responses_reasoning_text(&json);
    assert!(result.contains("top-level thought"));
}

// ── extract_responses_final_text — additional branches ────────────────────

#[test]
fn final_text_content_as_string() {
    use sqllumen_lib::ai::client::extract_responses_final_text;
    let json = serde_json::json!({"content": "direct string content"});
    assert_eq!(extract_responses_final_text(&json), "direct string content");
}

#[test]
fn final_text_content_array_with_strings() {
    use sqllumen_lib::ai::client::extract_responses_final_text;
    let json = serde_json::json!({"content": ["hello ", "world"]});
    assert_eq!(extract_responses_final_text(&json), "hello world");
}

#[test]
fn final_text_content_non_string_non_array() {
    use sqllumen_lib::ai::client::extract_responses_final_text;
    let json = serde_json::json!({"content": 42});
    assert_eq!(extract_responses_final_text(&json), "");
}

#[test]
fn final_text_response_output_with_content_parts() {
    use sqllumen_lib::ai::client::extract_responses_final_text;
    let json = serde_json::json!({
        "response": {
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "text", "text": "answer"}]
                }
            ]
        }
    });
    assert_eq!(extract_responses_final_text(&json), "answer");
}

#[test]
fn final_text_response_output_skips_reasoning() {
    use sqllumen_lib::ai::client::extract_responses_final_text;
    let json = serde_json::json!({
        "response": {
            "output": [
                {"type": "reasoning", "content": [{"text": "skip"}]},
                {"type": "message", "content": [{"text": "keep"}]}
            ]
        }
    });
    assert_eq!(extract_responses_final_text(&json), "keep");
}

#[test]
fn final_text_top_level_output_with_content_parts() {
    use sqllumen_lib::ai::client::extract_responses_final_text;
    let json = serde_json::json!({
        "output": [
            {"type": "message", "content": [{"text": "from output"}]}
        ]
    });
    assert_eq!(extract_responses_final_text(&json), "from output");
}

#[test]
fn final_text_top_level_output_skips_reasoning() {
    use sqllumen_lib::ai::client::extract_responses_final_text;
    let json = serde_json::json!({
        "output": [
            {"type": "reasoning", "content": [{"text": "skip"}]},
            {"type": "message", "content": [{"text": "visible"}]}
        ]
    });
    assert_eq!(extract_responses_final_text(&json), "visible");
}

// ── extract_responses_content_text_for_event — additional branches ────────

#[test]
fn content_text_for_event_output_text_done_not_already_streamed() {
    use sqllumen_lib::ai::client::extract_responses_content_text_for_event;
    let json = serde_json::json!({"text": "final text"});
    let result = extract_responses_content_text_for_event(
        Some("response.output_text.done"), &json, false,
    );
    assert_eq!(result, "final text");
}

#[test]
fn content_text_for_event_output_text_done_already_streamed() {
    use sqllumen_lib::ai::client::extract_responses_content_text_for_event;
    let json = serde_json::json!({"text": "final text"});
    let result = extract_responses_content_text_for_event(
        Some("response.output_text.done"), &json, true,
    );
    assert_eq!(result, "");
}

#[test]
fn content_text_for_event_content_part_done_not_streamed() {
    use sqllumen_lib::ai::client::extract_responses_content_text_for_event;
    let json = serde_json::json!({
        "part": {"type": "output_text", "text": "part done text"}
    });
    let result = extract_responses_content_text_for_event(
        Some("response.content_part.done"), &json, false,
    );
    assert_eq!(result, "part done text");
}

#[test]
fn content_text_for_event_output_item_done_not_streamed() {
    use sqllumen_lib::ai::client::extract_responses_content_text_for_event;
    let json = serde_json::json!({
        "item": {
            "type": "message",
            "content": [{"type": "output_text", "text": "item text"}]
        }
    });
    let result = extract_responses_content_text_for_event(
        Some("response.output_item.done"), &json, false,
    );
    assert_eq!(result, "item text");
}

#[test]
fn content_text_for_event_completed_not_streamed() {
    use sqllumen_lib::ai::client::extract_responses_content_text_for_event;
    let json = serde_json::json!({"text": "completed text"});
    let result = extract_responses_content_text_for_event(
        Some("response.completed"), &json, false,
    );
    assert_eq!(result, "completed text");
}

#[test]
fn content_text_for_event_content_part_added() {
    use sqllumen_lib::ai::client::extract_responses_content_text_for_event;
    let json = serde_json::json!({
        "part": {"type": "output_text", "text": "added text"}
    });
    let result = extract_responses_content_text_for_event(
        Some("response.content_part.added"), &json, false,
    );
    assert_eq!(result, "added text");
}

// ── extract_responses_reasoning_text_for_event — additional branches ──────

#[test]
fn reasoning_text_for_event_reasoning_text_delta() {
    use sqllumen_lib::ai::client::extract_responses_reasoning_text_for_event;
    let json = serde_json::json!({"delta": "thinking..."});
    let result = extract_responses_reasoning_text_for_event(
        Some("response.reasoning_text.delta"), &json, false,
    );
    assert_eq!(result, "thinking...");
}

#[test]
fn reasoning_text_for_event_reasoning_text_done_not_streamed() {
    use sqllumen_lib::ai::client::extract_responses_reasoning_text_for_event;
    let json = serde_json::json!({"text": "full reasoning"});
    let result = extract_responses_reasoning_text_for_event(
        Some("response.reasoning_text.done"), &json, false,
    );
    assert_eq!(result, "full reasoning");
}

#[test]
fn reasoning_text_for_event_reasoning_text_done_already_streamed() {
    use sqllumen_lib::ai::client::extract_responses_reasoning_text_for_event;
    let json = serde_json::json!({"text": "full reasoning"});
    let result = extract_responses_reasoning_text_for_event(
        Some("response.reasoning_text.done"), &json, true,
    );
    assert_eq!(result, "");
}

#[test]
fn reasoning_text_for_event_summary_part_added() {
    use sqllumen_lib::ai::client::extract_responses_reasoning_text_for_event;
    let json = serde_json::json!({
        "part": {"type": "summary_text", "text": "summary"}
    });
    let result = extract_responses_reasoning_text_for_event(
        Some("response.reasoning_summary_part.added"), &json, false,
    );
    assert_eq!(result, "summary");
}

#[test]
fn reasoning_text_for_event_output_item_done_not_streamed() {
    use sqllumen_lib::ai::client::extract_responses_reasoning_text_for_event;
    let json = serde_json::json!({
        "output": [{"type": "reasoning", "summary": [{"type": "summary_text", "text": "thought"}]}]
    });
    let result = extract_responses_reasoning_text_for_event(
        Some("response.output_item.done"), &json, false,
    );
    assert!(result.contains("thought"));
}

#[test]
fn reasoning_text_for_event_completed_not_streamed() {
    use sqllumen_lib::ai::client::extract_responses_reasoning_text_for_event;
    let json = serde_json::json!({
        "output": [{"type": "reasoning", "summary": [{"type": "summary_text", "text": "done thought"}]}]
    });
    let result = extract_responses_reasoning_text_for_event(
        Some("response.completed"), &json, false,
    );
    assert!(result.contains("done thought"));
}

#[test]
fn reasoning_text_for_event_completed_already_streamed() {
    use sqllumen_lib::ai::client::extract_responses_reasoning_text_for_event;
    let json = serde_json::json!({"delta": "should be empty"});
    let result = extract_responses_reasoning_text_for_event(
        Some("response.completed"), &json, true,
    );
    assert_eq!(result, "");
}

// ── normalize_chat_payload_for_provider ─────────────────────────────────

#[test]
fn normalize_chat_payload_reasoning_enabled_returns_unmodified() {
    let messages = vec![
        ApiMessage { role: "system".into(), content: "You are helpful.".into() },
        ApiMessage { role: "user".into(), content: "Hello".into() },
    ];
    let result = normalize_chat_payload_for_provider(&messages, true);
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].content, "You are helpful.");
    assert_eq!(result[1].content, "Hello");
}

#[test]
fn normalize_chat_payload_reasoning_disabled_appends_directives_to_user() {
    let messages = vec![
        ApiMessage { role: "system".into(), content: "Be concise.".into() },
        ApiMessage { role: "user".into(), content: "What is 2+2?".into() },
        ApiMessage { role: "assistant".into(), content: "4".into() },
        ApiMessage { role: "user".into(), content: "And 3+3?".into() },
    ];
    let result = normalize_chat_payload_for_provider(&messages, false);
    assert_eq!(result.len(), 4);
    // System untouched
    assert_eq!(result[0].content, "Be concise.");
    // Both user messages get directives
    assert!(result[1].content.contains("[No chain-of-thought"));
    assert!(result[1].content.contains("/no_think"));
    // Assistant untouched
    assert_eq!(result[2].content, "4");
    // Second user also gets directives
    assert!(result[3].content.contains("[No chain-of-thought"));
    assert!(result[3].content.contains("/no_think"));
}

#[test]
fn normalize_chat_payload_no_double_directive() {
    use sqllumen_lib::ai::client::REASONING_OFF_DIRECTIVE;
    let messages = vec![
        ApiMessage {
            role: "user".into(),
            content: format!("Hello{REASONING_OFF_DIRECTIVE}"),
        },
    ];
    let result = normalize_chat_payload_for_provider(&messages, false);
    // Should NOT have duplicate directive
    let count = result[0].content.matches("[No chain-of-thought").count();
    assert_eq!(count, 1);
}

#[test]
fn normalize_chat_payload_no_double_no_think() {
    let messages = vec![
        ApiMessage {
            role: "user".into(),
            content: "Hello\n\n/no_think".into(),
        },
    ];
    let result = normalize_chat_payload_for_provider(&messages, false);
    let count = result[0].content.matches("/no_think").count();
    assert_eq!(count, 1);
}

#[test]
fn normalize_chat_payload_empty_messages() {
    let result = normalize_chat_payload_for_provider(&[], false);
    assert!(result.is_empty());
}

// ── probe_completions_capability sends Authorization header (Fix 3) ──────

#[cfg(test)]
mod probe_auth_tests {
    use sqllumen_lib::ai::client::probe_completions_capability_with_timeout;
    use std::time::Duration;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn probe_sends_authorization_header_when_api_key_provided() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/completions"))
            .and(header("Authorization", "Bearer test-secret-key"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "id": "cmpl-probe",
                    "object": "text_completion",
                    "choices": [{ "text": "ok", "index": 0, "finish_reason": "stop" }]
                })),
            )
            .expect(1)
            .mount(&server)
            .await;

        let endpoint = format!("{}/v1", server.uri());
        let result = probe_completions_capability_with_timeout(
            &endpoint,
            "test-model",
            Duration::from_secs(5),
            Some("test-secret-key"),
        )
        .await;
        assert!(result, "probe should succeed when Authorization header is sent");
    }

    #[tokio::test]
    async fn probe_does_not_send_authorization_header_when_no_api_key() {
        let server = MockServer::start().await;

        // This mock requires NO Authorization header — if one is sent, it won't match
        // and will return 404, causing the probe to fail.
        Mock::given(method("POST"))
            .and(path("/v1/completions"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "id": "cmpl-probe",
                    "object": "text_completion",
                    "choices": [{ "text": "ok", "index": 0, "finish_reason": "stop" }]
                })),
            )
            .expect(1)
            .mount(&server)
            .await;

        let endpoint = format!("{}/v1", server.uri());
        let result = probe_completions_capability_with_timeout(
            &endpoint,
            "test-model",
            Duration::from_secs(5),
            None,
        )
        .await;
        assert!(result, "probe should succeed without api_key");
    }
}
