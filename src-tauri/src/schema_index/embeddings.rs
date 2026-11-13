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
            EmbeddingError::ClientBuild(error) => {
                write!(f, "Failed to create HTTP client: {error}")
            }
            EmbeddingError::HttpRequest(error) => {
                write!(f, "Embedding HTTP request failed: {error}")
            }
            EmbeddingError::HttpStatus { status, body } => {
                write!(f, "Embedding HTTP {status}: {body}")
            }
            EmbeddingError::ParseError(error) => {
                write!(f, "Failed to parse embedding response: {error}")
            }
            EmbeddingError::EmptyResponse => write!(f, "Embedding response contained no data"),
            EmbeddingError::RetriesExhausted(error) => {
                write!(f, "Embedding retries exhausted: {error}")
            }
        }
    }
}

impl std::error::Error for EmbeddingError {}

// ── Core functions ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub struct EmbeddingModel<'a> {
    pub base_url: &'a str,
    pub model: &'a str,
}

#[derive(Debug, Clone)]
pub struct EmbeddingInput {
    pub texts: Vec<String>,
    pub dimensions: Option<u32>,
}

impl EmbeddingInput {
    pub fn texts(texts: Vec<String>) -> Self {
        Self {
            texts,
            dimensions: None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct EmbeddingCall<'a> {
    pub model: EmbeddingModel<'a>,
    pub request_timeout: Duration,
}

struct EmbeddingEndpoint<'a> {
    url: &'a str,
    model: &'a str,
    dimensions: Option<u32>,
    request_timeout: Duration,
}

pub async fn embed_texts(
    client: &reqwest::Client,
    model: EmbeddingModel<'_>,
    input: EmbeddingInput,
) -> Result<Vec<Vec<f32>>, EmbeddingError> {
    let call = EmbeddingCall {
        model,
        request_timeout: EMBED_TIMEOUT,
    };
    embed_texts_with_timeout(client, call, input).await
}

pub async fn embed_texts_with_timeout(
    client: &reqwest::Client,
    call: EmbeddingCall<'_>,
    input: EmbeddingInput,
) -> Result<Vec<Vec<f32>>, EmbeddingError> {
    let base_url = call.model.base_url;
    let model = call.model.model;
    let EmbeddingInput { texts, dimensions } = input;
    if base_url.trim().is_empty() {
        return Err(EmbeddingError::HttpRequest(
            "endpoint not configured: base_url is empty".to_string(),
        ));
    }

    let url = crate::ai::url::normalise_openai_url(base_url, "embeddings");
    let endpoint = EmbeddingEndpoint {
        url: &url,
        model,
        dimensions,
        request_timeout: call.request_timeout,
    };

    if texts.is_empty() {
        tracing::debug!(model = %model, "embed_texts: empty input list — nothing to embed");
        return Ok(vec![]);
    }

    let text_count = texts.len();
    tracing::debug!(
        model = %model,
        total_inputs = text_count,
        "embed_texts: starting (OpenAI-compatible /v1/embeddings)"
    );

    let mut all_embeddings: Vec<(usize, Vec<f32>)> = Vec::with_capacity(text_count);
    let mut batch_size = MAX_BATCH_SIZE.min(text_count);
    let mut offset = 0;

    while offset < text_count {
        let end = (offset + batch_size).min(text_count);
        let batch: Vec<String> = texts[offset..end].to_vec();
        let batch_len = batch.len();

        tracing::debug!(
            model = %model,
            offset,
            batch_len,
            "embed_texts: sending HTTP batch to embeddings endpoint"
        );
        let batch_started = Instant::now();

        match send_embedding_request(client, &endpoint, batch).await {
            Ok(response) => {
                let dims = response
                    .data
                    .first()
                    .map(|datum| datum.embedding.len())
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
                batch_size = MAX_BATCH_SIZE.min(text_count - offset);
            }
            Err(error) if is_retryable_status(&error) => {
                tracing::warn!(
                    model = %model,
                    offset,
                    batch_len,
                    error = %error,
                    "embed_texts: retryable HTTP error — halving batch size and retrying"
                );
                if batch_size <= 1 {
                    return Err(EmbeddingError::RetriesExhausted(error.to_string()));
                }
                // Halve batch size and retry (up to MAX_RETRIES times from the same offset)
                let mut retries = 0;
                let mut current_batch_size = batch_size / 2;
                let mut last_error = error;

                loop {
                    retries += 1;
                    if retries > MAX_RETRIES {
                        return Err(EmbeddingError::RetriesExhausted(last_error.to_string()));
                    }

                    let retry_end = (offset + current_batch_size).min(text_count);
                    let retry_batch: Vec<String> = texts[offset..retry_end].to_vec();
                    let retry_batch_len = retry_batch.len();

                    match send_embedding_request(client, &endpoint, retry_batch).await {
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
                        Err(retry_error) if is_retryable_status(&retry_error) => {
                            tracing::warn!(
                                model = %model,
                                offset,
                                attempt = retries,
                                current_batch_size,
                                error = %retry_error,
                                "embed_texts: retry batch still retryable — halving further"
                            );
                            if current_batch_size <= 1 {
                                return Err(EmbeddingError::RetriesExhausted(
                                    retry_error.to_string(),
                                ));
                            }
                            current_batch_size /= 2;
                            if current_batch_size == 0 {
                                current_batch_size = 1;
                            }
                            last_error = retry_error;
                        }
                        Err(retry_error) => return Err(retry_error),
                    }
                }
            }
            Err(error) => {
                tracing::warn!(
                    model = %model,
                    offset,
                    batch_len,
                    error = %error,
                    "embed_texts: non-retryable embedding HTTP error"
                );
                return Err(error);
            }
        }
    }

    // Sort by original index and return just the vectors
    all_embeddings.sort_by_key(|(index, _)| *index);
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
    let embedding_model = EmbeddingModel { base_url, model };
    let probe = EmbeddingInput::texts(vec!["test".to_string()]);
    let result = embed_texts(client, embedding_model, probe).await?;

    let first = result
        .into_iter()
        .next()
        .ok_or(EmbeddingError::EmptyResponse)?;
    let dim = first.len();
    tracing::debug!(model = %model, dimension = dim, "detect_embedding_dimension: resolved vector size");
    Ok(dim)
}

// ── Helpers ───────────────────────────────────────────────────────────────

async fn send_embedding_request(
    client: &reqwest::Client,
    endpoint: &EmbeddingEndpoint<'_>,
    input: Vec<String>,
) -> Result<EmbeddingApiResponse, EmbeddingError> {
    let body = EmbeddingApiRequest {
        model: endpoint.model.to_string(),
        input,
        truncate: true,
        encoding_format: "float".to_string(),
        dimensions: endpoint.dimensions,
    };

    let response = client
        .post(endpoint.url)
        .timeout(endpoint.request_timeout)
        .json(&body)
        .send()
        .await
        .map_err(|error| EmbeddingError::HttpRequest(error.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        let body_text = response
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());

        let is_request_rejected = matches!(status.as_u16(), 400 | 413);
        if is_request_rejected {
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
        .map_err(|error| EmbeddingError::ParseError(error.to_string()))?;

    Ok(api_response)
}

const HTTP_BAD_REQUEST: u16 = 400;
const HTTP_PAYLOAD_TOO_LARGE: u16 = 413;
const RETRYABLE_HTTP_STATUSES: [u16; 2] = [HTTP_BAD_REQUEST, HTTP_PAYLOAD_TOO_LARGE];

fn is_retryable_status(error: &EmbeddingError) -> bool {
    matches!(
        error,
        EmbeddingError::HttpStatus { status, .. } if RETRYABLE_HTTP_STATUSES.contains(status)
    )
}
