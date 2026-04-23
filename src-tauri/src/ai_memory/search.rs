use std::time::Instant;

use crate::schema_index::embeddings;
use crate::state::AppState;

use super::embedding_to_bytes;
use super::read_embedding_config;
use super::storage::vec_table_name;
use super::types::AiMemory;

use rusqlite::params;

/// Search memories by semantic similarity. Returns results ordered by relevance.
pub async fn search_memories_impl(
    state: &AppState,
    connection_id: &str,
    query: &str,
    k: usize,
) -> Result<Vec<AiMemory>, String> {
    tracing::debug!(
        connection_id,
        query_len = query.len(),
        k,
        "search_memories: start"
    );

    // Read embedding config from settings
    let (endpoint, model) = {
        let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
        match read_embedding_config(&conn) {
            Ok(cfg) => cfg,
            Err(e) => {
                tracing::debug!(connection_id, reason = %e, "search_memories: embedding not configured — returning empty");
                return Ok(vec![]);
            }
        }
    };

    // Check cache first, then embed
    let cache_hit = state.embedding_cache.get(&model, query).is_some();
    let started = Instant::now();
    let query_vec = if let Some(cached) = state.embedding_cache.get(&model, query) {
        tracing::debug!(model = %model, connection_id, "search_memories: query embedding cache hit");
        cached
    } else {
        tracing::debug!(model = %model, connection_id, "search_memories: query embedding cache miss — calling embed_texts");
        let vecs = embeddings::embed_texts(
            &state.http_client,
            &endpoint,
            &model,
            vec![query.to_string()],
            None,
        )
        .await
        .map_err(|e| e.to_string())?;
        let v = vecs.into_iter().next().ok_or("Empty embedding response")?;
        state.embedding_cache.insert(&model, query, v.clone());
        v
    };

    if !cache_hit {
        tracing::debug!(
            model = %model,
            connection_id,
            elapsed_ms = started.elapsed().as_millis() as u64,
            "search_memories: query embedding ready"
        );
    }

    let embedding_bytes = embedding_to_bytes(&query_vec);
    let table = vec_table_name(connection_id);

    // Run KNN query under DB lock
    let knn_started = Instant::now();
    let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;

    let sql = format!(
        "SELECT m.id, m.connection_id, m.content, m.created_at, m.source \
         FROM {table} v JOIN ai_memories m ON m.id = v.id \
         WHERE v.embedding MATCH ?1 AND k = ?2 \
         ORDER BY v.distance"
    );

    let result = conn.prepare(&sql);
    let mut stmt = match result {
        Ok(s) => s,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("no such table") {
                tracing::debug!(
                    connection_id,
                    "search_memories: vec table does not exist — returning empty"
                );
                return Ok(vec![]);
            }
            return Err(msg);
        }
    };

    let rows = stmt
        .query_map(params![embedding_bytes, k as i64], |row| {
            Ok(AiMemory {
                id: row.get(0)?,
                connection_id: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                source: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let memories = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    tracing::debug!(
        connection_id,
        results = memories.len(),
        k,
        elapsed_ms = knn_started.elapsed().as_millis() as u64,
        "search_memories: KNN complete"
    );

    Ok(memories)
}
