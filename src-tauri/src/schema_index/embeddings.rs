//! HTTP client for OpenAI-compatible `/v1/embeddings` endpoints.
//!
//! Provides batch embedding generation with automatic retry on payload-too-large
//! errors, and dimension detection for model configuration.

use crate::ai::types::{EmbeddingApiRequest, EmbeddingApiResponse};
use std::fmt;
use std::time::{Duration, Instant};

/// Maximum number of texts per embedding API call.
const MAX_BATCH_SIZE: usize = 32;

/// Maximum number of retry attempts when halving batch size.
const MAX_RETRIES: u32 = 3;

/// HTTP request timeout for embedding calls.
const EMBED_TIMEOUT: Duration = Duration::from_secs(300);

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
    dimensions: Option<u32>,
) -> Result<Vec<Vec<f32>>, EmbeddingError> {
    embed_texts_with_timeout(client, base_url, model, texts, dimensions, EMBED_TIMEOUT).await
}

/// Same as [`embed_texts`] but with an explicit per-request timeout.
///
/// This keeps production behavior on the long default timeout while allowing
/// focused tests to exercise timeout paths without waiting several minutes.
pub async fn embed_texts_with_timeout(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
    texts: Vec<String>,
    dimensions: Option<u32>,
    request_timeout: Duration,
) -> Result<Vec<Vec<f32>>, EmbeddingError> {
    if base_url.trim().is_empty() {
        return Err(EmbeddingError::HttpRequest(
            "endpoint not configured: base_url is empty".to_string(),
        ));
    }

    let url = crate::ai::url::normalise_openai_url(base_url, "embeddings");

    if texts.is_empty() {
        tracing::debug!(model = %model, "embed_texts: empty input list — nothing to embed");
        return Ok(vec![]);
    }

    tracing::debug!(
        model = %model,
        total_inputs = texts.len(),
        "embed_texts: starting (OpenAI-compatible /v1/embeddings)"
    );

    let mut all_embeddings: Vec<(usize, Vec<f32>)> = Vec::with_capacity(texts.len());
    let mut batch_size = MAX_BATCH_SIZE.min(texts.len());
    let mut offset = 0;

    while offset < texts.len() {
        let end = (offset + batch_size).min(texts.len());
        let batch: Vec<String> = texts[offset..end].to_vec();
        let batch_len = batch.len();

        tracing::debug!(
            model = %model,
            offset,
            batch_len,
            "embed_texts: sending HTTP batch to embeddings endpoint"
        );
        let batch_started = Instant::now();

        match send_embedding_request(client, &url, model, batch, dimensions, request_timeout).await {
            Ok(response) => {
                let dims = response
                    .data
                    .first()
                    .map(|d| d.embedding.len())
                    .unwrap_or(0);
                tracing::debug!(
                    model = %model,
                    offset,
                    batch_len,
                    vectors_in_response = response.data.len(),
                    vector_dims = dims,
                    elapsed_ms = batch_started.elapsed().as_millis() as u64,
                    "embed_texts: HTTP batch succeeded"
                );
                for item in response.data {
                    all_embeddings.push((offset + item.index, item.embedding));
                }
                offset += batch_len;
                // Reset batch size for next chunk
                batch_size = MAX_BATCH_SIZE.min(texts.len() - offset);
            }
            Err(e) if is_retryable_status(&e) => {
                tracing::warn!(
                    model = %model,
                    offset,
                    batch_len,
                    error = %e,
                    "embed_texts: retryable HTTP error — halving batch size and retrying"
                );
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

                    match send_embedding_request(
                        client,
                        &url,
                        model,
                        retry_batch,
                        dimensions,
                        request_timeout,
                    )
                    .await
                    {
                        Ok(response) => {
                            tracing::debug!(
                                model = %model,
                                offset,
                                retry_batch_len,
                                attempt = retries,
                                vectors_in_response = response.data.len(),
                                "embed_texts: retry batch succeeded after size reduction"
                            );
                            for item in response.data {
                                all_embeddings.push((offset + item.index, item.embedding));
                            }
                            offset += retry_batch_len;
                            batch_size = current_batch_size;
                            break;
                        }
                        Err(retry_err) if is_retryable_status(&retry_err) => {
                            tracing::warn!(
                                model = %model,
                                offset,
                                attempt = retries,
                                current_batch_size,
                                error = %retry_err,
                                "embed_texts: retry batch still retryable — halving further"
                            );
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
            Err(e) => {
                tracing::warn!(
                    model = %model,
                    offset,
                    batch_len,
                    error = %e,
                    "embed_texts: non-retryable embedding HTTP error"
                );
                return Err(e);
            }
        }
    }

    // Sort by original index and return just the vectors
    all_embeddings.sort_by_key(|(idx, _)| *idx);
    tracing::debug!(
        model = %model,
        output_vectors = all_embeddings.len(),
        "embed_texts: all batches complete"
    );
    Ok(all_embeddings.into_iter().map(|(_, emb)| emb).collect())
}

/// Detect the embedding dimension of a model by embedding a test string.
pub async fn detect_embedding_dimension(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
) -> Result<usize, EmbeddingError> {
    tracing::debug!(
        model = %model,
        "detect_embedding_dimension: probing model with a single test string"
    );
    let result = embed_texts(client, base_url, model, vec!["test".to_string()], None).await?;

    let first = result
        .into_iter()
        .next()
        .ok_or(EmbeddingError::EmptyResponse)?;
    let dim = first.len();
    tracing::debug!(model = %model, dimension = dim, "detect_embedding_dimension: resolved vector size");
    Ok(dim)
}

// ── Helpers ───────────────────────────────────────────────────────────────

/// Send a single embedding request to the API.
async fn send_embedding_request(
    client: &reqwest::Client,
    url: &str,
    model: &str,
    input: Vec<String>,
    dimensions: Option<u32>,
    request_timeout: Duration,
) -> Result<EmbeddingApiResponse, EmbeddingError> {
    let body = EmbeddingApiRequest {
        model: model.to_string(),
        input,
        truncate: true,
        encoding_format: "float".to_string(),
        dimensions,
    };

    let response = client
        .post(url)
        .timeout(request_timeout)
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
