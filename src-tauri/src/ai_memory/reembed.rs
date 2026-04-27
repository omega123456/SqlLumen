use std::time::Instant;

use crate::schema_index::embeddings;
use crate::state::AppState;

use super::read_embedding_config;
use super::storage;
use super::types::MemoryReembedProgress;

/// Re-embed all memories for a connection. Calls `progress_callback` with progress updates.
pub async fn reembed_memories_impl<F>(
    state: &AppState,
    connection_id: &str,
    progress_callback: F,
) -> Result<(), String>
where
    F: Fn(MemoryReembedProgress) + Send + 'static,
{
    let make_progress =
        |phase: &str, done: usize, total: usize, error: Option<String>| MemoryReembedProgress {
            connection_id: connection_id.to_string(),
            phase: phase.to_string(),
            done,
            total,
            error,
        };

    tracing::debug!(connection_id, "reembed_memories: start");
    progress_callback(make_progress("embedding", 0, 0, None));

    // Load all memory texts
    let texts = {
        let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
        storage::get_memory_texts(&conn, connection_id).map_err(|e| e.to_string())?
    };

    if texts.is_empty() {
        tracing::debug!(
            connection_id,
            "reembed_memories: no memories — nothing to re-embed"
        );
        progress_callback(make_progress("done", 0, 0, None));
        return Ok(());
    }

    let total = texts.len();
    tracing::debug!(
        connection_id,
        total,
        "reembed_memories: loaded memory texts"
    );

    // Read embedding config
    let (endpoint, model) = {
        let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
        read_embedding_config(&conn).map_err(|e| {
            tracing::error!(connection_id, reason = %e, "reembed_memories: embedding not configured");
            progress_callback(make_progress("error", 0, total, Some(e.clone())));
            e
        })?
    };

    tracing::debug!(
        connection_id,
        model = %model,
        total,
        "reembed_memories: embedding config ready — calling embed_texts"
    );

    // Detect embedding dimension
    let dim = embeddings::detect_embedding_dimension(&state.http_client, &endpoint, &model)
        .await
        .map_err(|e| {
            let err = e.to_string();
            tracing::error!(connection_id, model = %model, error = %err, "reembed_memories: failed to detect embedding dimension");
            progress_callback(make_progress("error", 0, total, Some(err.clone())));
            err
        })?;

    tracing::debug!(connection_id, model = %model, dim, "reembed_memories: dimension detected");

    // Embed all texts BEFORE touching the vec table
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
        tracing::error!(connection_id, model = %model, error = %err, "reembed_memories: embed_texts failed");
        progress_callback(make_progress("error", 0, total, Some(err.clone())));
        err
    })?;

    if all_embeddings.len() != total {
        let err = format!(
            "Embedding count mismatch: expected {} embeddings, got {}",
            total,
            all_embeddings.len()
        );
        tracing::error!(connection_id, model = %model, expected = total, got = all_embeddings.len(), "reembed_memories: embedding count mismatch");
        progress_callback(make_progress("error", 0, total, Some(err.clone())));
        return Err(err);
    }

    tracing::debug!(
        connection_id,
        model = %model,
        total,
        elapsed_ms = embed_started.elapsed().as_millis() as u64,
        "reembed_memories: all embeddings generated — recreating vec table"
    );

    // All embeddings succeeded — now safe to drop and recreate vec table
    {
        let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
        let table = storage::vec_table_name(connection_id);
        conn.execute_batch(&format!("DROP TABLE IF EXISTS {table}"))
            .map_err(|e| e.to_string())?;
        storage::ensure_vec_table(&conn, connection_id, dim).map_err(|e| e.to_string())?;
    }

    // Insert embeddings
    let insert_started = Instant::now();
    let table_name = storage::vec_table_name(connection_id);
    {
        let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
        for (i, ((id, _), embedding)) in texts.iter().zip(all_embeddings.iter()).enumerate() {
            storage::insert_memory_vector(&conn, &table_name, *id, embedding)
                .map_err(|e| {
                    let err = e.to_string();
                    tracing::error!(connection_id, memory_id = id, error = %err, "reembed_memories: failed to insert vector");
                    progress_callback(make_progress("error", i, total, Some(err.clone())));
                    err
                })?;
            progress_callback(make_progress("embedding", i + 1, total, None));
        }
    }

    tracing::debug!(
        connection_id,
        model = %model,
        total,
        elapsed_ms = insert_started.elapsed().as_millis() as u64,
        "reembed_memories: all vectors inserted — done"
    );

    progress_callback(make_progress("done", total, total, None));
    Ok(())
}
