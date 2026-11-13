use std::time::Instant;

use crate::schema_index::embeddings::{self, EmbeddingInput};
use crate::schema_index::embeddings_cache::EmbeddingCacheKey;
use crate::state::AppState;

use super::embedding_to_bytes;
use super::storage::{global_vec_table_name, group_vec_table_name, vec_table_name};
use super::types::{AiMemory, MemoryScope};
use super::{read_embedding_config, EmbeddingConfig};

use rusqlite::{params, Connection};

/// One KNN result with its raw distance, so multi-table results can be merged.
struct ScoredMemory {
    memory: AiMemory,
    distance: f64,
}

struct KnnQuery<'a> {
    embedding_bytes: &'a [u8],
    limit: usize,
}

struct KnnTable<'a> {
    scope: MemoryScope,
    vec_table: &'a str,
}

pub struct MemorySearch<'a> {
    pub connection_id: &'a str,
    pub group_id: Option<&'a str>,
    pub query: &'a str,
    pub limit: usize,
}

fn knn_one_table(
    conn: &Connection,
    table: KnnTable<'_>,
    query: &KnnQuery<'_>,
) -> Result<Vec<ScoredMemory>, String> {
    let KnnTable { scope, vec_table } = table;
    let embedding_bytes = query.embedding_bytes;
    let limit = query.limit;
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
        Ok(statement) => statement,
        Err(error) => {
            let msg = error.to_string();
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
        .query_map(params![embedding_bytes, limit as i64], |row| {
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
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub async fn search_memories_impl(
    state: &AppState,
    search: &MemorySearch<'_>,
) -> Result<Vec<AiMemory>, String> {
    let MemorySearch {
        connection_id,
        group_id,
        query,
        limit,
    } = *search;
    tracing::debug!(
        connection_id,
        has_group = group_id.is_some(),
        query_len = query.len(),
        limit,
        "search_memories: start"
    );

    let EmbeddingConfig { endpoint, model } = {
        let conn = state
            .db
            .lock()
            .map_err(|error| format!("DB lock: {error}"))?;
        match read_embedding_config(&conn) {
            Ok(config) => config,
            Err(error) => {
                tracing::debug!(connection_id, reason = %error, "search_memories: embedding not configured — returning empty");
                return Ok(vec![]);
            }
        }
    };

    // Check cache first, then embed.
    let cached_query_vec = state.embedding_cache.get(&model, query);
    let cache_hit = cached_query_vec.is_some();
    let started = Instant::now();
    let query_vec = match cached_query_vec {
        Some(cached) => {
            tracing::debug!(model = %model, connection_id, "search_memories: query embedding cache hit");
            cached
        }
        None => {
            tracing::debug!(model = %model, connection_id, "search_memories: query embedding cache miss — calling embed_texts");
            let embedding_model = embeddings::EmbeddingModel {
                base_url: &endpoint,
                model: &model,
            };
            let input = EmbeddingInput::texts(vec![query.to_string()]);
            let vecs = embeddings::embed_texts(&state.http_client, embedding_model, input)
                .await
                .map_err(|error| error.to_string())?;
            let embedding = vecs.into_iter().next().ok_or("Empty embedding response")?;
            state
                .embedding_cache
                .insert(EmbeddingCacheKey::new(&model, query), embedding.clone());
            embedding
        }
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
    let conn = state
        .db
        .lock()
        .map_err(|error| format!("DB lock: {error}"))?;

    let knn_query = KnnQuery {
        embedding_bytes: &embedding_bytes,
        limit,
    };
    let mut merged: Vec<ScoredMemory> = Vec::new();

    let global_table = KnnTable {
        scope: MemoryScope::Global,
        vec_table: &global_vec_table_name(),
    };
    merged.extend(knn_one_table(&conn, global_table, &knn_query)?);

    if let Some(gid) = group_id {
        let group_table = KnnTable {
            scope: MemoryScope::Group,
            vec_table: &group_vec_table_name(gid),
        };
        merged.extend(knn_one_table(&conn, group_table, &knn_query)?);
    }

    let connection_table = KnnTable {
        scope: MemoryScope::Connection,
        vec_table: &vec_table_name(connection_id),
    };
    merged.extend(knn_one_table(&conn, connection_table, &knn_query)?);

    // Merge by ascending distance, then truncate to k.
    merged.sort_by(|left, right| {
        left.distance
            .partial_cmp(&right.distance)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    merged.truncate(limit);

    let memories: Vec<AiMemory> = merged.into_iter().map(|scored| scored.memory).collect();

    tracing::debug!(
        connection_id,
        results = memories.len(),
        limit,
        elapsed_ms = knn_started.elapsed().as_millis() as u64,
        "search_memories: merged KNN complete"
    );

    Ok(memories)
}
