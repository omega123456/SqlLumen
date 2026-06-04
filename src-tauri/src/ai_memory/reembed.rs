use std::time::Instant;

use crate::schema_index::embeddings;
use crate::state::AppState;

use super::read_embedding_config;
use super::storage;
use super::types::{MemoryReembedProgress, MemoryScope};

/// Re-embed all memories for a given scope + owner.
///
/// `owner_key` is the generic identifier reported in progress events
/// (`"global"`, `"group_{id}"`, or a connection id). `owner_id` is the actual
/// owner id used to target the row/vec tables (`None` for global). Behaviour is
/// identical to the previous per-connection re-embed for the connection scope.
pub async fn reembed_scope_impl<F>(
    state: &AppState,
    scope: MemoryScope,
    owner_id: Option<String>,
    owner_key: &str,
    progress_callback: F,
) -> Result<(), String>
where
    F: Fn(MemoryReembedProgress) + Send + 'static,
{
    let owner_key_owned = owner_key.to_string();
    let make_progress =
        move |phase: &str, done: usize, total: usize, error: Option<String>| MemoryReembedProgress {
            owner_key: owner_key_owned.clone(),
            phase: phase.to_string(),
            done,
            total,
            error,
        };

    tracing::debug!(owner_key, scope = scope.as_str(), "reembed_memories: start");
    progress_callback(make_progress("embedding", 0, 0, None));

    // Load all memory texts for this scope/owner.
    let texts = {
        let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
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
    let (endpoint, model) = {
        let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
        read_embedding_config(&conn).map_err(|e| {
            tracing::error!(owner_key, reason = %e, "reembed_memories: embedding not configured");
            progress_callback(make_progress("error", 0, total, Some(e.clone())));
            e
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
        .map_err(|e| {
            let err = e.to_string();
            tracing::error!(owner_key, model = %model, error = %err, "reembed_memories: failed to detect embedding dimension");
            progress_callback(make_progress("error", 0, total, Some(err.clone())));
            err
        })?;

    tracing::debug!(owner_key, model = %model, dim, "reembed_memories: dimension detected");

    // Embed all texts BEFORE touching the vec table.
    let embed_started = Instant::now();
    let content_strings: Vec<String> = texts.iter().map(|(_, c)| c.clone()).collect();
    let all_embeddings = embeddings::embed_texts(
        &state.http_client,
        &endpoint,
        &model,
        content_strings,
        None,
    )
    .await
    .map_err(|e| {
        let err = e.to_string();
        tracing::error!(owner_key, model = %model, error = %err, "reembed_memories: embed_texts failed");
        progress_callback(make_progress("error", 0, total, Some(err.clone())));
        err
    })?;

    if all_embeddings.len() != total {
        let err = format!(
            "Embedding count mismatch: expected {} embeddings, got {}",
            total,
            all_embeddings.len()
        );
        tracing::error!(owner_key, model = %model, expected = total, got = all_embeddings.len(), "reembed_memories: embedding count mismatch");
        progress_callback(make_progress("error", 0, total, Some(err.clone())));
        return Err(err);
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
        let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
        conn.execute_batch(&format!("DROP TABLE IF EXISTS {table_name}"))
            .map_err(|e| e.to_string())?;
        storage::ensure_vec_table_named(&conn, &table_name, dim).map_err(|e| e.to_string())?;
    }

    // Insert embeddings.
    let insert_started = Instant::now();
    {
        let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
        for (i, ((id, _), embedding)) in texts.iter().zip(all_embeddings.iter()).enumerate() {
            storage::insert_memory_vector(&conn, &table_name, *id, embedding)
                .map_err(|e| {
                    let err = e.to_string();
                    tracing::error!(owner_key, memory_id = id, error = %err, "reembed_memories: failed to insert vector");
                    progress_callback(make_progress("error", i, total, Some(err.clone())));
                    err
                })?;
            progress_callback(make_progress("embedding", i + 1, total, None));
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
    reembed_scope_impl(
        state,
        MemoryScope::Connection,
        Some(connection_id.to_string()),
        connection_id,
        progress_callback,
    )
    .await
}
