use crate::ai::types::{EmbeddingApiRequest, EmbeddingApiResponse};
use std::fmt;
use std::time::{Duration, Instant};

const MAX_BATCH_SIZE: usize = 32;

const MAX_RETRIES: u32 = 3;

const EMBED_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug)]
pub enum EmbeddingError {
    ClientBuild(String),
    HttpRequest(String),
    HttpStatus { status: u16, body: String },
    ParseError(String),
    EmptyResponse,
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

    let mut batches = EmbeddingBatches {
        client,
        endpoint: &endpoint,
        texts: &texts,
        collected: Vec::with_capacity(text_count),
        offset: 0,
        batch_size: MAX_BATCH_SIZE.min(text_count),
    };
    while !batches.is_done() {
        embed_next_batch(&mut batches).await?;
    }

    let mut collected = batches.collected;
    collected.sort_by_key(|embedding| embedding.index);
    tracing::debug!(
        model = %model,
        output_vectors = collected.len(),
        "embed_texts: all batches complete"
    );
    Ok(collected
        .into_iter()
        .map(|embedding| embedding.vector)
        .collect())
}

struct IndexedEmbedding {
    index: usize,
    vector: Vec<f32>,
}

struct EmbeddingBatches<'a> {
    client: &'a reqwest::Client,
    endpoint: &'a EmbeddingEndpoint<'a>,
    texts: &'a [String],
    collected: Vec<IndexedEmbedding>,
    offset: usize,
    batch_size: usize,
}

impl EmbeddingBatches<'_> {
    fn is_done(&self) -> bool {
        self.offset >= self.texts.len()
    }

    fn batch(&self, size: usize) -> Vec<String> {
        let end = (self.offset + size).min(self.texts.len());
        self.texts[self.offset..end].to_vec()
    }

    fn model(&self) -> &str {
        self.endpoint.model
    }

    async fn send(&self, batch: Vec<String>) -> Result<EmbeddingApiResponse, EmbeddingError> {
        send_embedding_request(self.client, self.endpoint, batch).await
    }

    fn accept(&mut self, response: EmbeddingApiResponse, batch_len: usize) {
        let offset = self.offset;
        let embeddings = response.data.into_iter().map(|item| IndexedEmbedding {
            index: offset + item.index,
            vector: item.embedding,
        });
        self.collected.extend(embeddings);
        self.offset += batch_len;
    }
}

async fn embed_next_batch(batches: &mut EmbeddingBatches<'_>) -> Result<(), EmbeddingError> {
    let batch = batches.batch(batches.batch_size);
    let batch_len = batch.len();
    let offset = batches.offset;
    let model = batches.model().to_string();
    tracing::debug!(
        model = %model,
        offset,
        batch_len,
        "embed_texts: sending HTTP batch to embeddings endpoint"
    );
    let batch_started = Instant::now();

    match batches.send(batch).await {
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
            batches.accept(response, batch_len);
            batches.batch_size = MAX_BATCH_SIZE.min(batches.texts.len() - batches.offset);
            Ok(())
        }
        Err(error) if is_retryable_status(&error) => {
            tracing::warn!(
                model = %model,
                offset,
                batch_len,
                error = %error,
                "embed_texts: retryable HTTP error — halving batch size and retrying"
            );
            retry_with_smaller_batches(batches, error).await
        }
        Err(error) => {
            tracing::warn!(
                model = %model,
                offset,
                batch_len,
                error = %error,
                "embed_texts: non-retryable embedding HTTP error"
            );
            Err(error)
        }
    }
}

async fn retry_with_smaller_batches(
    batches: &mut EmbeddingBatches<'_>,
    error: EmbeddingError,
) -> Result<(), EmbeddingError> {
    if batches.batch_size <= 1 {
        return Err(EmbeddingError::RetriesExhausted(error.to_string()));
    }
    let model = batches.model().to_string();
    let offset = batches.offset;
    let mut current_batch_size = batches.batch_size / 2;
    let mut last_error = error;
    for attempt in 1..=MAX_RETRIES {
        let retry_batch = batches.batch(current_batch_size);
        let retry_batch_len = retry_batch.len();
        let retry_error = match batches.send(retry_batch).await {
            Ok(response) => {
                tracing::debug!(
                    model = %model,
                    offset,
                    retry_batch_len,
                    attempt,
                    vectors_in_response = response.data.len(),
                    "embed_texts: retry batch succeeded after size reduction"
                );
                batches.accept(response, retry_batch_len);
                batches.batch_size = current_batch_size;
                return Ok(());
            }
            Err(retry_error) if is_retryable_status(&retry_error) => retry_error,
            Err(retry_error) => return Err(retry_error),
        };
        tracing::warn!(
            model = %model,
            offset,
            attempt,
            current_batch_size,
            error = %retry_error,
            "embed_texts: retry batch still retryable — halving further"
        );
        if current_batch_size <= 1 {
            return Err(EmbeddingError::RetriesExhausted(retry_error.to_string()));
        }
        current_batch_size = (current_batch_size / 2).max(1);
        last_error = retry_error;
    }
    Err(EmbeddingError::RetriesExhausted(last_error.to_string()))
}

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
