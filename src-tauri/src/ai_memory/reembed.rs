use std::time::Instant;

use crate::schema_index::embeddings::{self, EmbeddingInput};
use crate::state::AppState;

use super::storage;
use super::types::{MemoryReembedProgress, MemoryScope, MemoryVector};
use super::{read_embedding_config, EmbeddingConfig};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReembedTarget {
    pub scope: MemoryScope,
    pub owner_id: Option<String>,
    pub owner_key: String,
}

pub async fn reembed_scope_impl<F>(
    state: &AppState,
    target: ReembedTarget,
    progress_callback: F,
) -> Result<(), String>
where
    F: Fn(MemoryReembedProgress) + Send + 'static,
{
    let ReembedTarget {
        scope,
        owner_id,
        owner_key,
    } = target;
    let owner_key = owner_key.as_str();
    let owner_key_owned = owner_key.to_string();
    let make_progress = move |phase: &str, done: usize, total: usize, error: Option<String>| {
        MemoryReembedProgress {
            owner_key: owner_key_owned.clone(),
            phase: phase.to_string(),
            done,
            total,
            error,
        }
    };

    tracing::debug!(owner_key, scope = scope.as_str(), "reembed_memories: start");
    progress_callback(make_progress("embedding", 0, 0, None));

    // Load all memory texts for this scope/owner.
    let texts = {
        let conn = state
            .db
            .lock()
            .map_err(|error| format!("DB lock: {error}"))?;
        storage::get_memory_texts_scoped(&conn, scope, owner_id.as_deref())?
    };

    if texts.is_empty() {
        tracing::debug!(
            owner_key,
            "reembed_memories: no memories — nothing to re-embed"
        );
        progress_callback(make_progress("done", 0, 0, None));
        return Ok(());
    }

    let total = texts.len();
    tracing::debug!(owner_key, total, "reembed_memories: loaded memory texts");

    // Read embedding config.
    let EmbeddingConfig { endpoint, model } = {
        let conn = state
            .db
            .lock()
            .map_err(|error| format!("DB lock: {error}"))?;
        read_embedding_config(&conn).map_err(|error| {
            tracing::error!(owner_key, reason = %error, "reembed_memories: embedding not configured");
            progress_callback(make_progress("error", 0, total, Some(error.clone())));
            error
        })?
    };

    tracing::debug!(
        owner_key,
        model = %model,
        total,
        "reembed_memories: embedding config ready — calling embed_texts"
    );

    // Detect embedding dimension.
    let dim = embeddings::detect_embedding_dimension(&state.http_client, &endpoint, &model)
        .await
        .map_err(|error| {
            let message = error.to_string();
            tracing::error!(owner_key, model = %model, error = %message, "reembed_memories: failed to detect embedding dimension");
            progress_callback(make_progress("error", 0, total, Some(message.clone())));
            message
        })?;

    tracing::debug!(owner_key, model = %model, dim, "reembed_memories: dimension detected");

    // Embed all texts BEFORE touching the vec table.
    let embed_started = Instant::now();
    let content_strings: Vec<String> = texts.iter().map(|(_, content)| content.clone()).collect();
    let embedding_model = embeddings::EmbeddingModel {
        base_url: &endpoint,
        model: &model,
    };
    let input = EmbeddingInput::texts(content_strings);
    let all_embeddings = embeddings::embed_texts(&state.http_client, embedding_model, input)
        .await
    .map_err(|error| {
        let message = error.to_string();
        tracing::error!(owner_key, model = %model, error = %message, "reembed_memories: embed_texts failed");
        progress_callback(make_progress("error", 0, total, Some(message.clone())));
        message
    })?;

    let embedding_count = all_embeddings.len();
    if embedding_count != total {
        let error = format!(
            "Embedding count mismatch: expected {} embeddings, got {}",
            total, embedding_count
        );
        tracing::error!(owner_key, model = %model, expected = total, got = embedding_count, "reembed_memories: embedding count mismatch");
        progress_callback(make_progress("error", 0, total, Some(error.clone())));
        return Err(error);
    }

    tracing::debug!(
        owner_key,
        model = %model,
        total,
        elapsed_ms = embed_started.elapsed().as_millis() as u64,
        "reembed_memories: all embeddings generated — recreating vec table"
    );

    let table_name = storage::vec_table_for_scope(scope, owner_id.as_deref())?;

    // All embeddings succeeded — now safe to drop and recreate vec table.
    {
        let conn = state
            .db
            .lock()
            .map_err(|error| format!("DB lock: {error}"))?;
        conn.execute_batch(&format!("DROP TABLE IF EXISTS {table_name}"))
            .map_err(|error| error.to_string())?;
        storage::ensure_vec_table_named(&conn, &table_name, dim)
            .map_err(|error| error.to_string())?;
    }

    // Insert embeddings.
    let insert_started = Instant::now();
    {
        let conn = state
            .db
            .lock()
            .map_err(|error| format!("DB lock: {error}"))?;
        for (text_index, ((id, _), embedding)) in
            texts.iter().zip(all_embeddings.iter()).enumerate()
        {
            let vector = MemoryVector {
                memory_id: *id,
                embedding,
            };
            storage::insert_memory_vector(&conn, &table_name, &vector)
                .map_err(|error| {
                    let message = error.to_string();
                    tracing::error!(owner_key, memory_id = id, error = %message, "reembed_memories: failed to insert vector");
                    progress_callback(make_progress("error", text_index, total, Some(message.clone())));
                    message
                })?;
            progress_callback(make_progress("embedding", text_index + 1, total, None));
        }
    }

    tracing::debug!(
        owner_key,
        model = %model,
        total,
        elapsed_ms = insert_started.elapsed().as_millis() as u64,
        "reembed_memories: all vectors inserted — done"
    );

    progress_callback(make_progress("done", total, total, None));
    Ok(())
}

/// Re-embed all memories for a connection. Behaviour-preserving wrapper around
/// [`reembed_scope_impl`] for the connection scope.
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
