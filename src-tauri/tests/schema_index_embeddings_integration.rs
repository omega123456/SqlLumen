//! Integration tests for the schema_index embeddings HTTP client.

use sqllumen_lib::ai::types::EmbeddingApiRequest;
use sqllumen_lib::schema_index::embeddings::{detect_embedding_dimension, embed_texts};
use wiremock::matchers::{body_partial_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn test_client() -> reqwest::Client {
    reqwest::Client::new()
}

// ── embed_texts — happy path ──────────────────────────────────────────────

#[tokio::test]
async fn embed_texts_returns_vectors() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [
                { "embedding": [0.1, 0.2, 0.3], "index": 0 },
                { "embedding": [0.4, 0.5, 0.6], "index": 1 },
            ]
        })))
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1/chat/completions", server.uri());

    let result = embed_texts(
        &client,
        &base_url,
        "test-model",
        vec!["hello".to_string(), "world".to_string()],
        None,
    )
    .await;

    assert!(result.is_ok(), "should succeed: {:?}", result);
    let embeddings = result.unwrap();
    assert_eq!(embeddings.len(), 2);
    assert_eq!(embeddings[0], vec![0.1, 0.2, 0.3]);
    assert_eq!(embeddings[1], vec![0.4, 0.5, 0.6]);
}

#[tokio::test]
async fn embed_texts_empty_input_returns_empty() {
    let client = test_client();
    // No server needed for empty input
    let result = embed_texts(&client, "http://unused", "model", vec![], None).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap().len(), 0);
}

// ── embed_texts — URL normalisation ───────────────────────────────────────

#[tokio::test]
async fn embed_texts_normalises_chat_completions_url() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [{ "embedding": [1.0], "index": 0 }]
        })))
        .mount(&server)
        .await;

    let client = test_client();
    // Pass a /v1/chat/completions URL — should be normalised to /v1/embeddings
    let base_url = format!("{}/v1/chat/completions", server.uri());

    let result = embed_texts(&client, &base_url, "m", vec!["test".to_string()], None).await;
    assert!(result.is_ok(), "should normalise URL: {:?}", result);
    assert_eq!(result.unwrap()[0], vec![1.0]);
}

#[tokio::test]
async fn embed_texts_normalises_bare_v1_url() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [{ "embedding": [2.0], "index": 0 }]
        })))
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = embed_texts(&client, &base_url, "m", vec!["test".to_string()], None).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap()[0], vec![2.0]);
}

// ── embed_texts — HTTP 400 triggers batch halving ─────────────────────────

#[tokio::test]
async fn embed_texts_retries_on_http_400() {
    let server = MockServer::start().await;

    // First call returns 400, subsequent calls succeed
    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(400).set_body_string("Payload too large"))
        .up_to_n_times(1)
        .expect(1)
        .mount(&server)
        .await;

    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [
                { "embedding": [1.0, 2.0], "index": 0 },
                { "embedding": [3.0, 4.0], "index": 1 },
            ]
        })))
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = embed_texts(
        &client,
        &base_url,
        "m",
        vec![
            "a".to_string(),
            "b".to_string(),
            "c".to_string(),
            "d".to_string(),
        ],
        None,
    )
    .await;

    assert!(result.is_ok(), "should retry after 400: {:?}", result);
}

// ── embed_texts — HTTP 413 triggers batch halving ─────────────────────────

#[tokio::test]
async fn embed_texts_retries_on_http_413() {
    let server = MockServer::start().await;

    // First call returns 413, subsequent calls succeed
    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(413).set_body_string("Request Entity Too Large"))
        .up_to_n_times(1)
        .expect(1)
        .mount(&server)
        .await;

    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [
                { "embedding": [1.0], "index": 0 },
            ]
        })))
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = embed_texts(
        &client,
        &base_url,
        "m",
        vec!["a".to_string(), "b".to_string()],
        None,
    )
    .await;

    assert!(result.is_ok(), "should retry after 413: {:?}", result);
}

// ── embed_texts — malformed JSON ──────────────────────────────────────────

#[tokio::test]
async fn embed_texts_returns_error_on_malformed_json() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(200).set_body_string("this is not json"))
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = embed_texts(&client, &base_url, "m", vec!["test".to_string()], None).await;

    assert!(result.is_err());
    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("parse"),
        "error should mention parse failure: {err}"
    );
}

// ── embed_texts — timeout ─────────────────────────────────────────────────

#[tokio::test]
async fn embed_texts_returns_error_on_timeout() {
    let server = MockServer::start().await;

    // Respond with a 35-second delay — exceeds the 30s timeout
    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({
                    "data": [{ "embedding": [1.0], "index": 0 }]
                }))
                .set_delay(std::time::Duration::from_secs(35)),
        )
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = embed_texts(&client, &base_url, "m", vec!["test".to_string()], None).await;

    assert!(result.is_err());
    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("request") || err.contains("timeout") || err.contains("timed out"),
        "error should indicate timeout: {err}"
    );
}

// ── embed_texts — non-retryable HTTP error ────────────────────────────────

#[tokio::test]
async fn embed_texts_returns_error_on_http_500() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = embed_texts(&client, &base_url, "m", vec!["test".to_string()], None).await;

    assert!(result.is_err());
    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("500"),
        "error should mention status 500: {err}"
    );
}

// ── embed_texts — connection refused ──────────────────────────────────────

#[tokio::test]
async fn embed_texts_returns_error_on_connection_refused() {
    let client = test_client();

    let result = embed_texts(
        &client,
        "http://127.0.0.1:1/v1",
        "m",
        vec!["test".to_string()],
        None,
    )
    .await;

    assert!(result.is_err());
    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("request failed") || err.contains("error"),
        "error should describe connection failure: {err}"
    );
}

// ── embed_texts — empty base_url ──────────────────────────────────────────

#[tokio::test]
async fn embed_texts_empty_base_url_returns_clear_error() {
    let client = test_client();
    let result = embed_texts(&client, "", "nomic-embed-text", vec!["test".to_string()], None).await;
    assert!(
        result.is_err(),
        "embed_texts with empty base_url should fail"
    );
    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("endpoint") || err.contains("configured") || err.contains("empty"),
        "error should clearly indicate the endpoint is not configured, got: {err}"
    );
}

// ── detect_embedding_dimension ────────────────────────────────────────────

#[tokio::test]
async fn detect_dimension_returns_correct_length() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [{ "embedding": [0.1, 0.2, 0.3, 0.4, 0.5], "index": 0 }]
        })))
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = detect_embedding_dimension(&client, &base_url, "test-model").await;
    assert!(result.is_ok(), "should succeed: {:?}", result);
    assert_eq!(result.unwrap(), 5);
}

#[tokio::test]
async fn detect_dimension_1536() {
    let server = MockServer::start().await;

    // Simulate a 1536-dimension model
    let embedding: Vec<f32> = (0..1536).map(|i| i as f32 * 0.001).collect();

    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [{ "embedding": embedding, "index": 0 }]
        })))
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = detect_embedding_dimension(&client, &base_url, "ada-002").await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), 1536);
}

#[tokio::test]
async fn detect_dimension_returns_error_on_empty_response() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": []
        })))
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = detect_embedding_dimension(&client, &base_url, "empty-model").await;
    assert!(result.is_err());

    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("no data") || err.contains("contained no data"),
        "error should indicate an empty embedding response: {err}"
    );
}

// ── embed_texts — retries exhausted ───────────────────────────────────────

#[tokio::test]
async fn embed_texts_returns_error_when_retries_exhausted() {
    let server = MockServer::start().await;

    // Always return 400 — retries will be exhausted
    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(400).set_body_string("Always fails"))
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = embed_texts(
        &client,
        &base_url,
        "m",
        vec!["a".to_string(), "b".to_string()],
        None,
    )
    .await;

    assert!(result.is_err());
    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("retries") || err.contains("Retries") || err.contains("exhausted"),
        "error should mention retries exhausted: {err}"
    );
}

// ── truncate field ────────────────────────────────────────────────────────

#[test]
fn embedding_request_serializes_truncate_true() {
    let req = EmbeddingApiRequest {
        model: "bge-m3".to_string(),
        input: vec!["hello".to_string()],
        truncate: true,
        encoding_format: "float".to_string(),
        dimensions: None,
    };
    let json = serde_json::to_value(&req).unwrap();
    assert_eq!(json["truncate"], serde_json::json!(true));
}

#[tokio::test]
async fn embed_texts_sends_truncate_true_in_request_body() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .and(body_partial_json(serde_json::json!({ "truncate": true })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [{ "embedding": [0.1, 0.2], "index": 0 }]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = embed_texts(&client, &base_url, "bge-m3", vec!["test".to_string()], None).await;
    assert!(result.is_ok(), "should succeed: {:?}", result);
    assert_eq!(result.unwrap()[0], vec![0.1, 0.2]);
}

// ── encoding_format field ────────────────────────────────────────────────

#[test]
fn test_embedding_api_request_lacks_encoding_format() {
    // Verify that EmbeddingApiRequest serializes with both 'truncate' and
    // 'encoding_format' fields.
    let req = EmbeddingApiRequest {
        model: "bge-m3".to_string(),
        input: vec!["hello".to_string()],
        truncate: true,
        encoding_format: "float".to_string(),
        dimensions: None,
    };
    let json = serde_json::to_value(&req).unwrap();
    assert!(
        json.get("truncate").is_some(),
        "EmbeddingApiRequest should have 'truncate' field"
    );
    assert!(
        json.get("encoding_format").is_some(),
        "EmbeddingApiRequest should have 'encoding_format' field"
    );
    assert_eq!(json["encoding_format"], "float");
}

#[tokio::test]
async fn embed_texts_sends_encoding_format_float_in_request_body() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .and(body_partial_json(
            serde_json::json!({ "encoding_format": "float" }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [{ "embedding": [0.1, 0.2], "index": 0 }]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = embed_texts(&client, &base_url, "bge-m3", vec!["test".to_string()], None).await;
    assert!(result.is_ok(), "should succeed: {:?}", result);
    assert_eq!(result.unwrap()[0], vec![0.1, 0.2]);
}
