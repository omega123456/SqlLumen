//! HTTP client for OpenAI-compatible `/v1/embeddings` endpoints.
//!
//! Provides batch embedding generation with automatic retry on payload-too-large
//! errors, and dimension detection for model configuration.

use crate::ai::types::{EmbeddingApiRequest, EmbeddingApiResponse};
use std::fmt;
use std::time::Duration;

/// Maximum number of texts per embedding API call.
const MAX_BATCH_SIZE: usize = 32;

/// Maximum number of retry attempts when halving batch size.
const MAX_RETRIES: u32 = 3;

/// HTTP request timeout for embedding calls.
const EMBED_TIMEOUT: Duration = Duration::from_secs(30);

// ── Error type ────────────────────────────────────────────────────────────

/// Errors that can occur when calling the embedding API.
#[derive(Debug)]
pub enum EmbeddingError {
    /// Failed to build the HTTP client.
    ClientBuild(String),
    /// HTTP request failed (network error, timeout, etc.).
    HttpRequest(String),
    /// Server returned a non-success status code that is not retryable.
    HttpStatus { status: u16, body: String },
    /// Failed to parse the JSON response.
    ParseError(String),
    /// The response contained no embedding data.
    EmptyResponse,
    /// All retry attempts exhausted after batch-size halving.
    RetriesExhausted(String),
}

impl fmt::Display for EmbeddingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EmbeddingError::ClientBuild(e) => write!(f, "Failed to create HTTP client: {e}"),
            EmbeddingError::HttpRequest(e) => write!(f, "Embedding HTTP request failed: {e}"),
            EmbeddingError::HttpStatus { status, body } => {
                write!(f, "Embedding HTTP {status}: {body}")
            }
            EmbeddingError::ParseError(e) => {
                write!(f, "Failed to parse embedding response: {e}")
            }
            EmbeddingError::EmptyResponse => write!(f, "Embedding response contained no data"),
            EmbeddingError::RetriesExhausted(e) => {
                write!(f, "Embedding retries exhausted: {e}")
            }
        }
    }
}

impl std::error::Error for EmbeddingError {}

// ── URL normalisation ─────────────────────────────────────────────────────

/// Normalise a base URL to the `/v1/embeddings` endpoint.
///
/// Strips known path suffixes like `/chat/completions`, `/models`, etc.,
/// ensures the URL includes `/v1`, and appends `/embeddings`.
fn normalise_to_embeddings_url(base_url: &str) -> String {
    let mut base = base_url.trim().trim_end_matches('/').to_string();

    // Strip known suffixes
    for suffix in &[
        "/chat/completions",
        "/completions",
        "/models",
        "/embeddings",
    ] {
        if base.ends_with(suffix) {
            base = base[..base.len() - suffix.len()].to_string();
            break;
        }
    }

    // Ensure base ends with /v1
    if !base.ends_with("/v1") {
        base = format!("{}/v1", base.trim_end_matches('/'));
    }

    format!("{base}/embeddings")
}

// ── Core functions ────────────────────────────────────────────────────────

/// Embed a list of texts using the given model via the `/v1/embeddings` endpoint.
///
/// Automatically batches texts (max 32 per call) and retries with halved batch
/// sizes on HTTP 400/413 errors (up to 3 retries).
pub async fn embed_texts(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
    texts: Vec<String>,
) -> Result<Vec<Vec<f32>>, EmbeddingError> {
    if base_url.trim().is_empty() {
        return Err(EmbeddingError::HttpRequest(
            "endpoint not configured: base_url is empty".to_string(),
        ));
    }

    let url = normalise_to_embeddings_url(base_url);

    if texts.is_empty() {
        return Ok(vec![]);
    }

    let mut all_embeddings: Vec<(usize, Vec<f32>)> = Vec::with_capacity(texts.len());
    let mut batch_size = MAX_BATCH_SIZE.min(texts.len());
    let mut offset = 0;

    while offset < texts.len() {
        let end = (offset + batch_size).min(texts.len());
        let batch: Vec<String> = texts[offset..end].to_vec();
        let batch_len = batch.len();

        match send_embedding_request(client, &url, model, batch).await {
            Ok(response) => {
                for item in response.data {
                    all_embeddings.push((offset + item.index, item.embedding));
                }
                offset += batch_len;
                // Reset batch size for next chunk
                batch_size = MAX_BATCH_SIZE.min(texts.len() - offset);
            }
            Err(e) if is_retryable_status(&e) => {
                if batch_size <= 1 {
                    return Err(EmbeddingError::RetriesExhausted(e.to_string()));
                }
                // Halve batch size and retry (up to MAX_RETRIES times from the same offset)
                let mut retries = 0;
                let mut current_batch_size = batch_size / 2;
                let mut last_err = e;

                loop {
                    retries += 1;
                    if retries > MAX_RETRIES {
                        return Err(EmbeddingError::RetriesExhausted(last_err.to_string()));
                    }

                    let retry_end = (offset + current_batch_size).min(texts.len());
                    let retry_batch: Vec<String> = texts[offset..retry_end].to_vec();
                    let retry_batch_len = retry_batch.len();

                    match send_embedding_request(client, &url, model, retry_batch).await {
                        Ok(response) => {
                            for item in response.data {
                                all_embeddings.push((offset + item.index, item.embedding));
                            }
                            offset += retry_batch_len;
                            batch_size = current_batch_size;
                            break;
                        }
                        Err(retry_err) if is_retryable_status(&retry_err) => {
                            if current_batch_size <= 1 {
                                return Err(EmbeddingError::RetriesExhausted(
                                    retry_err.to_string(),
                                ));
                            }
                            current_batch_size /= 2;
                            if current_batch_size == 0 {
                                current_batch_size = 1;
                            }
                            last_err = retry_err;
                        }
                        Err(retry_err) => return Err(retry_err),
                    }
                }
            }
            Err(e) => return Err(e),
        }
    }

    // Sort by original index and return just the vectors
    all_embeddings.sort_by_key(|(idx, _)| *idx);
    Ok(all_embeddings.into_iter().map(|(_, emb)| emb).collect())
}

/// Detect the embedding dimension of a model by embedding a test string.
pub async fn detect_embedding_dimension(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
) -> Result<usize, EmbeddingError> {
    let result = embed_texts(client, base_url, model, vec!["test".to_string()]).await?;

    let first = result
        .into_iter()
        .next()
        .ok_or(EmbeddingError::EmptyResponse)?;
    Ok(first.len())
}

// ── Helpers ───────────────────────────────────────────────────────────────

/// Send a single embedding request to the API.
async fn send_embedding_request(
    client: &reqwest::Client,
    url: &str,
    model: &str,
    input: Vec<String>,
) -> Result<EmbeddingApiResponse, EmbeddingError> {
    let body = EmbeddingApiRequest {
        model: model.to_string(),
        input,
        truncate: true,
        encoding_format: "float".to_string(),
    };

    let response = client
        .post(url)
        .timeout(EMBED_TIMEOUT)
        .json(&body)
        .send()
        .await
        .map_err(|e| EmbeddingError::HttpRequest(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        let body_text = response
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());

        if status.as_u16() == 400 || status.as_u16() == 413 {
            return Err(EmbeddingError::HttpStatus {
                status: status.as_u16(),
                body: body_text,
            });
        }
        return Err(EmbeddingError::HttpStatus {
            status: status.as_u16(),
            body: body_text,
        });
    }

    let api_response: EmbeddingApiResponse = response
        .json()
        .await
        .map_err(|e| EmbeddingError::ParseError(e.to_string()))?;

    Ok(api_response)
}

/// Check whether an error is a retryable HTTP 400/413 status.
fn is_retryable_status(err: &EmbeddingError) -> bool {
    matches!(
        err,
        EmbeddingError::HttpStatus { status, .. } if *status == 400 || *status == 413
    )
}
