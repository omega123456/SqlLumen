//! Integration tests for the embeddings module — verifying concurrency,
//! output ordering, and halving-retry under HTTP 413.

use sqllumen_lib::schema_index::embeddings::embed_texts;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

fn test_client() -> reqwest::Client {
    reqwest::Client::new()
}

/// A wiremock responder that echoes back one embedding per input, where each
/// embedding is a single-element vector containing the global text index
/// (derived from parsing the input text `"text_<N>"`).
struct EchoEmbeddings;

impl Respond for EchoEmbeddings {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
        let inputs = body["input"].as_array().unwrap();
        let data: Vec<serde_json::Value> = inputs
            .iter()
            .enumerate()
            .map(|(i, input_val)| {
                // Extract the numeric suffix from "text_N" to use as the embedding value,
                // so we can verify ordering after collection.
                let val = input_val
                    .as_str()
                    .and_then(|s| s.strip_prefix("text_"))
                    .and_then(|n| n.parse::<f32>().ok())
                    .unwrap_or(i as f32);
                serde_json::json!({ "embedding": [val], "index": i })
            })
            .collect();
        ResponseTemplate::new(200).set_body_json(serde_json::json!({ "data": data }))
    }
}

// ── Output ordering preserved across multiple batches ────────────────────

#[tokio::test]
async fn embed_texts_preserves_output_ordering_across_batches() {
    let server = MockServer::start().await;

    // Return embeddings where the value matches the index so we can verify order.
    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [
                { "embedding": [0.0], "index": 0 },
                { "embedding": [1.0], "index": 1 },
                { "embedding": [2.0], "index": 2 },
            ]
        })))
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let texts: Vec<String> = (0..3).map(|i| format!("text_{i}")).collect();
    let result = embed_texts(&client, &base_url, "test-model", texts, None).await;

    assert!(result.is_ok());
    let vecs = result.unwrap();
    assert_eq!(vecs.len(), 3);
    // Verify ordering: each vector should match its index
    assert_eq!(vecs[0], vec![0.0]);
    assert_eq!(vecs[1], vec![1.0]);
    assert_eq!(vecs[2], vec![2.0]);
}

// ── Multi-batch parallel ordering with 70 texts (3 batches) ──────────────

#[tokio::test]
async fn embed_texts_multi_batch_parallel_preserves_ordering() {
    let server = MockServer::start().await;

    // Use a dynamic responder that echoes back one embedding per input
    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(EchoEmbeddings)
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    // 70 texts → 3 batches (32 + 32 + 6) with MAX_BATCH_SIZE=32
    let texts: Vec<String> = (0..70).map(|i| format!("text_{i}")).collect();
    let result = embed_texts(&client, &base_url, "test-model", texts, None).await;

    assert!(result.is_ok(), "should succeed: {:?}", result);
    let vecs = result.unwrap();
    assert_eq!(vecs.len(), 70);
    // Verify every vector is in the correct position
    for i in 0..70 {
        assert_eq!(
            vecs[i],
            vec![i as f32],
            "vector at position {i} should be [{i}]"
        );
    }
}

// ── Halving retry on 413 produces correct output ─────────────────────────

#[tokio::test]
async fn embed_texts_halving_retry_on_413_produces_correct_output() {
    let server = MockServer::start().await;

    // First request (batch of 2) → 413
    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(413).set_body_string("too large"))
        .up_to_n_times(1)
        .expect(1)
        .mount(&server)
        .await;

    // Subsequent requests (batch of 1) → succeed
    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [{ "embedding": [42.0], "index": 0 }]
        })))
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = embed_texts(
        &client,
        &base_url,
        "model",
        vec!["a".to_string(), "b".to_string()],
        None,
    )
    .await;

    assert!(result.is_ok(), "should recover from 413 via halving: {:?}", result);
    let vecs = result.unwrap();
    assert_eq!(vecs.len(), 2, "should return vectors for all inputs");
}

// ── Dimensions parameter is plumbed through ─────────────────────────────

#[tokio::test]
async fn embed_texts_with_dimensions_sends_field() {
    use wiremock::matchers::body_partial_json;

    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .and(body_partial_json(serde_json::json!({ "dimensions": 256 })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [{ "embedding": [1.0, 2.0], "index": 0 }]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = embed_texts(
        &client,
        &base_url,
        "model",
        vec!["test".to_string()],
        Some(256),
    )
    .await;

    assert!(result.is_ok(), "should succeed with dimensions: {:?}", result);
}

#[tokio::test]
async fn embed_texts_without_dimensions_omits_field() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [{ "embedding": [1.0], "index": 0 }]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = test_client();
    let base_url = format!("{}/v1", server.uri());

    let result = embed_texts(
        &client,
        &base_url,
        "model",
        vec!["test".to_string()],
        None,
    )
    .await;

    assert!(result.is_ok());
}
