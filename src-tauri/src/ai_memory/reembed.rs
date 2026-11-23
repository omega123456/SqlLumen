use std::time::Instant;

use crate::schema_index::embeddings::{self, EmbeddingInput};
use crate::state::AppState;

use super::storage;
use super::types::{MemoryReembedProgress, MemoryScope, MemoryVector};
use super::{EmbeddingConfig, read_embedding_config};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReembedTarget {
    pub scope: MemoryScope,
    pub owner_id: Option<String>,
    pub owner_key: String,
}

const PHASE_EMBEDDING: &str = "embedding";
const PHASE_DONE: &str = "done";
const PHASE_ERROR: &str = "error";

type MemoryText = (i64, String);

#[derive(Debug, Clone, Copy)]
struct ReembedCount {
    done: usize,
    total: usize,
}

impl ReembedCount {
    fn empty() -> Self {
        Self { done: 0, total: 0 }
    }

    fn started(total: usize) -> Self {
        Self { done: 0, total }
    }

    fn finished(total: usize) -> Self {
        Self { done: total, total }
    }
}

struct ReembedReporter<F> {
    owner_key: String,
    progress_callback: F,
}

impl<F> ReembedReporter<F>
where
    F: Fn(MemoryReembedProgress),
{
    fn report(&self, phase: &str, count: ReembedCount) -> MemoryReembedProgress {
        MemoryReembedProgress {
            owner_key: self.owner_key.clone(),
            phase: phase.to_string(),
            done: count.done,
            total: count.total,
            error: None,
        }
    }

    fn progress(&self, phase: &str, count: ReembedCount) {
        (self.progress_callback)(self.report(phase, count));
    }

    fn failure(&self, message: String, count: ReembedCount) -> String {
        let report = MemoryReembedProgress {
            error: Some(message.clone()),
            ..self.report(PHASE_ERROR, count)
        };
        (self.progress_callback)(report);
        message
    }
}

struct EmbeddedMemories {
    dimension: usize,
    embeddings: Vec<Vec<f32>>,
}

fn lock_database(
    state: &AppState,
) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, String> {
    state.db.lock().map_err(|error| format!("DB lock: {error}"))
}

fn load_memory_texts(state: &AppState, target: &ReembedTarget) -> Result<Vec<MemoryText>, String> {
    let conn = lock_database(state)?;
    storage::get_memory_texts_scoped(&conn, target.scope, target.owner_id.as_deref())
}

fn load_embedding_config<F>(
    state: &AppState,
    reporter: &ReembedReporter<F>,
    total: usize,
) -> Result<EmbeddingConfig, String>
where
    F: Fn(MemoryReembedProgress),
{
    let conn = lock_database(state)?;
    read_embedding_config(&conn).map_err(|error| {
        tracing::error!(owner_key = %reporter.owner_key, reason = %error, "reembed_memories: embedding not configured");
        reporter.failure(error, ReembedCount::started(total))
    })
}

fn recreate_vec_table(state: &AppState, table_name: &str, dimension: usize) -> Result<(), String> {
    let conn = lock_database(state)?;
    conn.execute_batch(&format!("DROP TABLE IF EXISTS {table_name}"))
        .map_err(|error| error.to_string())?;
    storage::ensure_vec_table_named(&conn, table_name, dimension)
        .map_err(|error| error.to_string())?;
    Ok(())
}

struct ReembedBatch<'a, F> {
    state: &'a AppState,
    texts: &'a [MemoryText],
    reporter: &'a ReembedReporter<F>,
}

impl<F> ReembedBatch<'_, F>
where
    F: Fn(MemoryReembedProgress),
{
    async fn embed(&self, config: &EmbeddingConfig) -> Result<EmbeddedMemories, String> {
        let Self {
            state,
            texts,
            reporter,
        } = self;
        let owner_key = reporter.owner_key.as_str();
        let total = texts.len();
        let EmbeddingConfig { endpoint, model } = config;
        let failed = |message: String| reporter.failure(message, ReembedCount::started(total));

        let dimension = embeddings::detect_embedding_dimension(&state.http_client, endpoint, model)
        .await
        .map_err(|error| {
            let message = error.to_string();
            tracing::error!(owner_key, model = %model, error = %message, "reembed_memories: failed to detect embedding dimension");
            failed(message)
        })?;
        tracing::debug!(owner_key, model = %model, dim = dimension, "reembed_memories: dimension detected");

        let embed_started = Instant::now();
        let content_strings: Vec<String> =
            texts.iter().map(|(_, content)| content.clone()).collect();
        let embedding_model = embeddings::EmbeddingModel {
            base_url: endpoint,
            model,
        };
        let input = EmbeddingInput::texts(content_strings);
        let embeddings = embeddings::embed_texts(&state.http_client, embedding_model, input)
        .await
        .map_err(|error| {
            let message = error.to_string();
            tracing::error!(owner_key, model = %model, error = %message, "reembed_memories: embed_texts failed");
            failed(message)
        })?;

        let embedding_count = embeddings.len();
        if embedding_count != total {
            let error = format!(
                "Embedding count mismatch: expected {} embeddings, got {}",
                total, embedding_count
            );
            tracing::error!(owner_key, model = %model, expected = total, got = embedding_count, "reembed_memories: embedding count mismatch");
            return Err(failed(error));
        }
        tracing::debug!(
            owner_key,
            model = %model,
            total,
            elapsed_ms = embed_started.elapsed().as_millis() as u64,
            "reembed_memories: all embeddings generated — recreating vec table"
        );
        Ok(EmbeddedMemories {
            dimension,
            embeddings,
        })
    }

    fn insert_vectors(&self, table_name: &str, embedded: &EmbeddedMemories) -> Result<(), String> {
        let conn = lock_database(self.state)?;
        let total = self.texts.len();
        let vectors = self.texts.iter().zip(embedded.embeddings.iter());
        for (text_index, ((memory_id, _), embedding)) in vectors.enumerate() {
            let vector = MemoryVector {
                memory_id: *memory_id,
                embedding,
            };
            let done_so_far = ReembedCount {
                done: text_index,
                total,
            };
            storage::insert_memory_vector(&conn, table_name, &vector)
                .inspect_err(|error| self.log_vector_insert_failure(*memory_id, error))
                .map_err(|error| self.reporter.failure(error.to_string(), done_so_far))?;
            let count = ReembedCount {
                done: text_index + 1,
                total,
            };
            self.reporter.progress(PHASE_EMBEDDING, count);
        }
        Ok(())
    }

    fn log_vector_insert_failure(&self, memory_id: i64, error: &dyn std::fmt::Display) {
        tracing::error!(
            owner_key = %self.reporter.owner_key,
            memory_id,
            error = %error,
            "reembed_memories: failed to insert vector"
        );
    }
}

pub async fn reembed_scope_impl<F>(
    state: &AppState,
    target: ReembedTarget,
    progress_callback: F,
) -> Result<(), String>
where
    F: Fn(MemoryReembedProgress) + Send + 'static,
{
    let reporter = ReembedReporter {
        owner_key: target.owner_key.clone(),
        progress_callback,
    };
    let owner_key = target.owner_key.as_str();
    tracing::debug!(
        owner_key,
        scope = target.scope.as_str(),
        "reembed_memories: start"
    );
    reporter.progress(PHASE_EMBEDDING, ReembedCount::empty());

    let texts = load_memory_texts(state, &target)?;
    if texts.is_empty() {
        tracing::debug!(
            owner_key,
            "reembed_memories: no memories — nothing to re-embed"
        );
        reporter.progress(PHASE_DONE, ReembedCount::empty());
        return Ok(());
    }
    let total = texts.len();
    tracing::debug!(owner_key, total, "reembed_memories: loaded memory texts");

    let config = load_embedding_config(state, &reporter, total)?;
    tracing::debug!(
        owner_key,
        model = %config.model,
        total,
        "reembed_memories: embedding config ready — calling embed_texts"
    );
    let batch = ReembedBatch {
        state,
        texts: &texts,
        reporter: &reporter,
    };
    let embedded = batch.embed(&config).await?;
    let table_name = storage::vec_table_for_scope(target.scope, target.owner_id.as_deref())?;
    recreate_vec_table(state, &table_name, embedded.dimension)?;

    let insert_started = Instant::now();
    batch.insert_vectors(&table_name, &embedded)?;
    tracing::debug!(
        owner_key,
        model = %config.model,
        total,
        elapsed_ms = insert_started.elapsed().as_millis() as u64,
        "reembed_memories: all vectors inserted — done"
    );
    reporter.progress(PHASE_DONE, ReembedCount::finished(total));
    Ok(())
}

pub async fn reembed_memories_impl<F>(
    state: &AppState,
    connection_id: &str,
    progress_callback: F,
) -> Result<(), String>
where
    F: Fn(MemoryReembedProgress) + Send + 'static,
{
    let target = ReembedTarget {
        scope: MemoryScope::Connection,
        owner_id: Some(connection_id.to_string()),
        owner_key: connection_id.to_string(),
    };
    reembed_scope_impl(state, target, progress_callback).await
}
