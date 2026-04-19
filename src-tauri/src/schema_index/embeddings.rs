//! HTTP client for OpenAI-compatible `/v1/embeddings` endpoints.
//!
//! Provides batch embedding generation with automatic retry on payload-too-large
//! errors, and dimension detection for model configuration.
//!
//! Batches are processed with bounded concurrency (`EMBED_CONCURRENCY`) so that
//! multiple HTTP requests fly in parallel, improving throughput for large schemas.

use crate::ai::types::{EmbeddingApiRequest, EmbeddingApiResponse};
use futures::StreamExt;
use std::fmt;
use std::time::{Duration, Instant};

/// Maximum number of texts per embedding API call.
const MAX_BATCH_SIZE: usize = 32;

/// Maximum number of retry attempts when halving batch size.
const MAX_RETRIES: u32 = 3;

/// HTTP request timeout for embedding calls.
const EMBED_TIMEOUT: Duration = Duration::from_secs(30);

/// Maximum number of batches to process concurrently.
const EMBED_CONCURRENCY: usize = 4;

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
/// Automatically batches texts (max 32 per call) and processes up to
/// `EMBED_CONCURRENCY` batches in parallel. Each batch retries with halved
/// batch sizes on HTTP 400/413 errors (up to 3 retries).
pub async fn embed_texts(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
    texts: Vec<String>,
    dimensions: Option<u32>,
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

    let texts_len = texts.len();

    // Pre-compute batches: (global_offset, batch_texts)
    let batch_size = MAX_BATCH_SIZE.min(texts_len);
    let mut batches: Vec<(usize, Vec<String>)> = Vec::new();
    let mut offset = 0;
    while offset < texts_len {
        let end = (offset + batch_size).min(texts_len);
        batches.push((offset, texts[offset..end].to_vec()));
        offset = end;
    }

    tracing::debug!(
        model = %model,
        total_inputs = texts_len,
        batch_count = batches.len(),
        concurrency = EMBED_CONCURRENCY,
        "embed_texts: starting parallel batched embedding (OpenAI-compatible /v1/embeddings)"
    );

    // Process batches with bounded concurrency
    let results: Vec<Result<Vec<(usize, Vec<f32>)>, EmbeddingError>> =
        futures::stream::iter(batches)
            .map(|(global_offset, batch)| {
                let url = url.clone();
                let model = model.to_string();
                async move {
                    embed_batch_with_retry(client, &url, &model, batch, dimensions, global_offset)
                        .await
                }
            })
            .buffered(EMBED_CONCURRENCY)
            .collect()
            .await;

    // Flatten, sort by global index, return
    let mut all_embeddings: Vec<(usize, Vec<f32>)> = Vec::with_capacity(texts_len);
    for result in results {
        all_embeddings.extend(result?);
    }
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

/// Process a single batch with halving-retry on retryable HTTP errors.
///
/// On success, returns `(global_index, embedding)` pairs. On a retryable
/// 400/413 error, splits the batch in half and retries each half sequentially,
/// up to `MAX_RETRIES` cumulative halvings.
async fn embed_batch_with_retry(
    client: &reqwest::Client,
    url: &str,
    model: &str,
    batch: Vec<String>,
    dimensions: Option<u32>,
    global_offset: usize,
) -> Result<Vec<(usize, Vec<f32>)>, EmbeddingError> {
    let batch_len = batch.len();
    let started = Instant::now();

    tracing::debug!(
        model = %model,
        global_offset,
        batch_len,
        "embed_batch_with_retry: sending HTTP batch"
    );

    // Try the full batch first
    match send_embedding_request(client, url, model, batch.clone(), dimensions).await {
        Ok(response) => {
            let dims = response
                .data
                .first()
                .map(|d| d.embedding.len())
                .unwrap_or(0);
            tracing::debug!(
                model = %model,
                global_offset,
                batch_len,
                vectors_in_response = response.data.len(),
                vector_dims = dims,
                elapsed_ms = started.elapsed().as_millis() as u64,
                "embed_batch_with_retry: batch succeeded"
            );
            return Ok(response
                .data
                .into_iter()
                .map(|item| (global_offset + item.index, item.embedding))
                .collect());
        }
        Err(e) if is_retryable_status(&e) => {
            tracing::warn!(
                model = %model,
                global_offset,
                batch_len,
                error = %e,
                "embed_batch_with_retry: retryable HTTP error — halving batch size"
            );
            if batch_len <= 1 {
                return Err(EmbeddingError::RetriesExhausted(e.to_string()));
            }
            // Fall through to halving retry below
        }
        Err(e) => {
            tracing::warn!(
                model = %model,
                global_offset,
                batch_len,
                error = %e,
                "embed_batch_with_retry: non-retryable error"
            );
            return Err(e);
        }
    }

    // Halving retry: process the batch sequentially with smaller sub-batches
    let mut results: Vec<(usize, Vec<f32>)> = Vec::with_capacity(batch_len);
    let mut sub_offset = 0;
    let mut sub_size = (batch_len / 2).max(1);
    let mut retries: u32 = 0;

    while sub_offset < batch_len {
        let sub_end = (sub_offset + sub_size).min(batch_len);
        let sub_batch: Vec<String> = batch[sub_offset..sub_end].to_vec();
        let sub_batch_len = sub_batch.len();

        match send_embedding_request(client, url, model, sub_batch, dimensions).await {
            Ok(response) => {
                tracing::debug!(
                    model = %model,
                    global_offset,
                    sub_offset,
                    sub_batch_len,
                    attempt = retries,
                    "embed_batch_with_retry: retry sub-batch succeeded"
                );
                for item in response.data {
                    results.push((global_offset + sub_offset + item.index, item.embedding));
                }
                sub_offset = sub_end;
            }
            Err(e) if is_retryable_status(&e) => {
                retries += 1;
                tracing::warn!(
                    model = %model,
                    global_offset,
                    sub_offset,
                    attempt = retries,
                    sub_size,
                    error = %e,
                    "embed_batch_with_retry: sub-batch still retryable — halving further"
                );
                if retries > MAX_RETRIES || sub_size <= 1 {
                    return Err(EmbeddingError::RetriesExhausted(e.to_string()));
                }
                sub_size = (sub_size / 2).max(1);
            }
            Err(e) => return Err(e),
        }
    }

    Ok(results)
}

/// Send a single embedding request to the API.
async fn send_embedding_request(
    client: &reqwest::Client,
    url: &str,
    model: &str,
    input: Vec<String>,
    dimensions: Option<u32>,
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
