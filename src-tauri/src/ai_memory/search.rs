use std::time::Instant;

use crate::schema_index::embeddings;
use crate::state::AppState;

use super::embedding_to_bytes;
use super::read_embedding_config;
use super::storage::{global_vec_table_name, group_vec_table_name, vec_table_name};
use super::types::{AiMemory, MemoryScope};

use rusqlite::{params, Connection};

/// One KNN result with its raw distance, so multi-table results can be merged.
struct ScoredMemory {
    memory: AiMemory,
    distance: f64,
}

/// Run a single-table KNN over `vec_table`, joining back to `row_table`.
///
/// `scope` controls how the row columns are mapped back into an `AiMemory`.
/// Missing vec tables are treated as "no results" (returns an empty vec).
fn knn_one_table(
    conn: &Connection,
    scope: MemoryScope,
    vec_table: &str,
    embedding_bytes: &[u8],
    k: usize,
) -> Result<Vec<ScoredMemory>, String> {
    // Select the row columns relevant to the scope plus the vec distance.
    let row_table = match scope {
        MemoryScope::Connection => "connection_memories",
        MemoryScope::Group => "group_memories",
        MemoryScope::Global => "global_memories",
    };

    let sql = match scope {
        MemoryScope::Connection => format!(
            "SELECT m.id, m.connection_id, m.content, m.created_at, m.source, v.distance \
             FROM {vec_table} v JOIN {row_table} m ON m.id = v.id \
             WHERE v.embedding MATCH ?1 AND k = ?2 ORDER BY v.distance"
        ),
        MemoryScope::Group => format!(
            "SELECT m.id, m.group_id, m.content, m.created_at, m.source, v.distance \
             FROM {vec_table} v JOIN {row_table} m ON m.id = v.id \
             WHERE v.embedding MATCH ?1 AND k = ?2 ORDER BY v.distance"
        ),
        MemoryScope::Global => format!(
            "SELECT m.id, m.content, m.created_at, m.source, v.distance \
             FROM {vec_table} v JOIN {row_table} m ON m.id = v.id \
             WHERE v.embedding MATCH ?1 AND k = ?2 ORDER BY v.distance"
        ),
    };

    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("no such table") {
                tracing::debug!(
                    vec_table,
                    scope = scope.as_str(),
                    "search_memories: vec table does not exist — skipping level"
                );
                return Ok(vec![]);
            }
            return Err(msg);
        }
    };

    let rows = stmt
        .query_map(params![embedding_bytes, k as i64], |row| {
            let (memory, distance) = match scope {
                MemoryScope::Connection => (
                    AiMemory {
                        id: row.get(0)?,
                        scope: MemoryScope::Connection,
                        connection_id: row.get::<_, Option<String>>(1)?,
                        group_id: None,
                        content: row.get(2)?,
                        created_at: row.get(3)?,
                        source: row.get(4)?,
                    },
                    row.get::<_, f64>(5)?,
                ),
                MemoryScope::Group => (
                    AiMemory {
                        id: row.get(0)?,
                        scope: MemoryScope::Group,
                        connection_id: None,
                        group_id: row.get::<_, Option<String>>(1)?,
                        content: row.get(2)?,
                        created_at: row.get(3)?,
                        source: row.get(4)?,
                    },
                    row.get::<_, f64>(5)?,
                ),
                MemoryScope::Global => (
                    AiMemory {
                        id: row.get(0)?,
                        scope: MemoryScope::Global,
                        connection_id: None,
                        group_id: None,
                        content: row.get(1)?,
                        created_at: row.get(2)?,
                        source: row.get(3)?,
                    },
                    row.get::<_, f64>(4)?,
                ),
            };
            Ok(ScoredMemory { memory, distance })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Search memories by semantic similarity across all applicable scopes.
///
/// Fans out a KNN over: the global vec table (always), the group vec table (only
/// when `group_id` is set), and the connection vec table. Results from every
/// level are merged, sorted by ascending cosine distance, and truncated to `k`.
/// Missing vec tables are skipped gracefully (return no results for that level).
pub async fn search_memories_impl(
    state: &AppState,
    connection_id: &str,
    group_id: Option<&str>,
    query: &str,
    k: usize,
) -> Result<Vec<AiMemory>, String> {
    tracing::debug!(
        connection_id,
        has_group = group_id.is_some(),
        query_len = query.len(),
        k,
        "search_memories: start"
    );

    // Read embedding config from settings.
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

    // Check cache first, then embed.
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

    // Run the merged KNN under one DB lock.
    let knn_started = Instant::now();
    let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;

    let mut merged: Vec<ScoredMemory> = Vec::new();

    // Global — always.
    merged.extend(knn_one_table(
        &conn,
        MemoryScope::Global,
        &global_vec_table_name(),
        &embedding_bytes,
        k,
    )?);

    // Group — only when the active connection has a group.
    if let Some(gid) = group_id {
        merged.extend(knn_one_table(
            &conn,
            MemoryScope::Group,
            &group_vec_table_name(gid),
            &embedding_bytes,
            k,
        )?);
    }

    // Connection — always.
    merged.extend(knn_one_table(
        &conn,
        MemoryScope::Connection,
        &vec_table_name(connection_id),
        &embedding_bytes,
        k,
    )?);

    // Merge by ascending distance, then truncate to k.
    merged.sort_by(|a, b| {
        a.distance
            .partial_cmp(&b.distance)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    merged.truncate(k);

    let memories: Vec<AiMemory> = merged.into_iter().map(|s| s.memory).collect();

    tracing::debug!(
        connection_id,
        results = memories.len(),
        k,
        elapsed_ms = knn_started.elapsed().as_millis() as u64,
        "search_memories: merged KNN complete"
    );

    Ok(memories)
}
