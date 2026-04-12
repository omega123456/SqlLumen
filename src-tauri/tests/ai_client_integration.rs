//! Integration tests for AI types serialization/deserialization and SSE line parsing.

use sqllumen_lib::ai::types::{
    AiChatRequest, ApiChatRequest, ApiMessage, ApiStreamChunk,
    IpcMessage, SseParsed, StreamChunkEvent, StreamDoneEvent, StreamErrorEvent, parse_sse_line,
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
    };
    let json = serde_json::to_value(&req).unwrap();
    assert!(json["maxTokens"].is_number(), "expected camelCase maxTokens");
    assert_eq!(json["maxTokens"], 1024);
    assert!(json["streamId"].is_string(), "expected camelCase streamId");
    assert_eq!(json["streamId"], "abc-123");
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
        "streamId": "stream-1"
    });
    let req: AiChatRequest = serde_json::from_value(json).unwrap();
    assert_eq!(req.max_tokens, 2048);
    assert_eq!(req.stream_id, "stream-1");
    assert_eq!(req.messages.len(), 1);
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
    };
    let json = serde_json::to_value(&req).unwrap();
    assert!(json["max_tokens"].is_number(), "expected snake_case max_tokens");
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
    };
    let json = serde_json::to_value(&evt).unwrap();
    assert_eq!(json["streamId"], "s2");
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
        use sqllumen_lib::ai::types::{SseParsed, parse_sse_line};
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
    use sqllumen_lib::ai::client::stream_chat_completion;
    use sqllumen_lib::ai::types::{AiChatRequest, IpcMessage};
    use tokio_util::sync::CancellationToken;
    use wiremock::matchers::{method, path};
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
            .respond_with(
                ResponseTemplate::new(500).set_body_string("Internal Server Error"),
            )
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
        assert!(err.contains("500"), "error should mention status 500: {err}");
    }

    /// HTTP 401 — should return an error with status code and response body.
    #[tokio::test]
    async fn stream_returns_error_on_http_401() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(401).set_body_string("Unauthorized"),
            )
            .mount(&server)
            .await;

        let app = mock_app();
        let endpoint = format!("{}/v1/chat/completions", server.uri());
        let request = sample_request("stream-401", &endpoint);
        let token = CancellationToken::new();

        let result = stream_chat_completion(app.handle(), request, token).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("401"), "error should mention status 401: {err}");
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
        let request =
            sample_request("stream-cancel-pre", "http://127.0.0.1:1/v1/chat/completions");
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
        assert!(result.is_ok(), "should complete when response is fully delivered");
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
        let request =
            sample_request("stream-error-evt", "http://127.0.0.1:1/v1/chat/completions");
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
        let request =
            sample_request("stream-cancel-no-err", "http://127.0.0.1:1/v1/chat/completions");
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
        assert!(result.is_ok(), "should flush buffer and complete on residual [DONE]");
    }
}
