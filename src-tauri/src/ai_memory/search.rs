use std::time::Instant;

use crate::schema_index::embeddings::{self, EmbeddingInput};
use crate::schema_index::embeddings_cache::EmbeddingCacheKey;
use crate::state::AppState;

use super::embedding_to_bytes;
use super::storage::{global_vec_table_name, group_vec_table_name, vec_table_name};
use super::types::{AiMemory, MemoryScope};
use super::{read_embedding_config, EmbeddingConfig};

use rusqlite::{params, Connection};

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

fn knn_row_table(scope: MemoryScope) -> &'static str {
    match scope {
        MemoryScope::Connection => "connection_memories",
        MemoryScope::Group => "group_memories",
        MemoryScope::Global => "global_memories",
    }
}

fn knn_sql(table: &KnnTable<'_>) -> String {
    let vec_table = table.vec_table;
    let row_table = knn_row_table(table.scope);
    match table.scope {
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
    }
}

#[derive(Clone, Copy)]
enum MemoryOwner {
    Connection,
    Group,
}

fn owned_memory_from_row(
    row: &rusqlite::Row<'_>,
    owner: MemoryOwner,
) -> rusqlite::Result<ScoredMemory> {
    let owner_id = row.get::<_, Option<String>>(1)?;
    let (scope, connection_id, group_id) = match owner {
        MemoryOwner::Connection => (MemoryScope::Connection, owner_id, None),
        MemoryOwner::Group => (MemoryScope::Group, None, owner_id),
    };
    let memory = AiMemory {
        id: row.get(0)?,
        scope,
        connection_id,
        group_id,
        content: row.get(2)?,
        created_at: row.get(3)?,
        source: row.get(4)?,
    };
    Ok(ScoredMemory {
        memory,
        distance: row.get::<_, f64>(5)?,
    })
}

fn global_memory_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScoredMemory> {
    let memory = AiMemory {
        id: row.get(0)?,
        scope: MemoryScope::Global,
        connection_id: None,
        group_id: None,
        content: row.get(1)?,
        created_at: row.get(2)?,
        source: row.get(3)?,
    };
    Ok(ScoredMemory {
        memory,
        distance: row.get::<_, f64>(4)?,
    })
}

fn scored_memory_from_row(
    row: &rusqlite::Row<'_>,
    scope: MemoryScope,
) -> rusqlite::Result<ScoredMemory> {
    match scope {
        MemoryScope::Connection => owned_memory_from_row(row, MemoryOwner::Connection),
        MemoryScope::Group => owned_memory_from_row(row, MemoryOwner::Group),
        MemoryScope::Global => global_memory_from_row(row),
    }
}

fn is_missing_table_error(message: &str) -> bool {
    message.contains("no such table")
}

fn knn_one_table(
    conn: &Connection,
    table: KnnTable<'_>,
    query: &KnnQuery<'_>,
) -> Result<Vec<ScoredMemory>, String> {
    let KnnTable { scope, vec_table } = table;
    let mut stmt = match conn.prepare(&knn_sql(&table)) {
        Ok(statement) => statement,
        Err(error) if is_missing_table_error(&error.to_string()) => {
            tracing::debug!(
                vec_table,
                scope = scope.as_str(),
                "search_memories: vec table does not exist — skipping level"
            );
            return Ok(vec![]);
        }
        Err(error) => return Err(error.to_string()),
    };

    let rows = stmt
        .query_map(params![query.embedding_bytes, query.limit as i64], |row| {
            scored_memory_from_row(row, scope)
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_search_embedding_config(
    state: &AppState,
    connection_id: &str,
) -> Result<Option<EmbeddingConfig>, String> {
    let conn = state
        .db
        .lock()
        .map_err(|error| format!("DB lock: {error}"))?;
    match read_embedding_config(&conn) {
        Ok(config) => Ok(Some(config)),
        Err(error) => {
            tracing::debug!(connection_id, reason = %error, "search_memories: embedding not configured — returning empty");
            Ok(None)
        }
    }
}

async fn fetch_query_embedding(
    state: &AppState,
    config: &EmbeddingConfig,
    search: &MemorySearch<'_>,
) -> Result<Vec<f32>, String> {
    let EmbeddingConfig { endpoint, model } = config;
    let MemorySearch {
        connection_id,
        query,
        ..
    } = *search;
    if let Some(cached) = state.embedding_cache.get(model, query) {
        tracing::debug!(model = %model, connection_id, "search_memories: query embedding cache hit");
        return Ok(cached);
    }
    tracing::debug!(model = %model, connection_id, "search_memories: query embedding cache miss — calling embed_texts");
    let started = Instant::now();
    let embedding_model = embeddings::EmbeddingModel {
        base_url: endpoint,
        model,
    };
    let input = EmbeddingInput::texts(vec![query.to_string()]);
    let vecs = embeddings::embed_texts(&state.http_client, embedding_model, input)
        .await
        .map_err(|error| error.to_string())?;
    let embedding = vecs.into_iter().next().ok_or("Empty embedding response")?;
    state
        .embedding_cache
        .insert(EmbeddingCacheKey::new(model, query), embedding.clone());
    tracing::debug!(
        model = %model,
        connection_id,
        elapsed_ms = started.elapsed().as_millis() as u64,
        "search_memories: query embedding ready"
    );
    Ok(embedding)
}

fn search_levels(
    conn: &Connection,
    search: &MemorySearch<'_>,
    knn_query: &KnnQuery<'_>,
) -> Result<Vec<ScoredMemory>, String> {
    let mut merged: Vec<ScoredMemory> = Vec::new();
    let global_table = KnnTable {
        scope: MemoryScope::Global,
        vec_table: &global_vec_table_name(),
    };
    merged.extend(knn_one_table(conn, global_table, knn_query)?);

    if let Some(group_id) = search.group_id {
        let group_table = KnnTable {
            scope: MemoryScope::Group,
            vec_table: &group_vec_table_name(group_id),
        };
        merged.extend(knn_one_table(conn, group_table, knn_query)?);
    }

    let connection_table = KnnTable {
        scope: MemoryScope::Connection,
        vec_table: &vec_table_name(search.connection_id),
    };
    merged.extend(knn_one_table(conn, connection_table, knn_query)?);
    Ok(merged)
}

fn closest_memories(mut merged: Vec<ScoredMemory>, limit: usize) -> Vec<AiMemory> {
    merged.sort_by(|left, right| {
        left.distance
            .partial_cmp(&right.distance)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    merged.truncate(limit);
    merged.into_iter().map(|scored| scored.memory).collect()
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

    let Some(config) = load_search_embedding_config(state, connection_id)? else {
        return Ok(vec![]);
    };
    let query_vec = fetch_query_embedding(state, &config, search).await?;
    let embedding_bytes = embedding_to_bytes(&query_vec);

    let knn_started = Instant::now();
    let conn = state
        .db
        .lock()
        .map_err(|error| format!("DB lock: {error}"))?;
    let knn_query = KnnQuery {
        embedding_bytes: &embedding_bytes,
        limit,
    };
    let memories = closest_memories(search_levels(&conn, search, &knn_query)?, limit);

    tracing::debug!(
        connection_id,
        results = memories.len(),
        limit,
        elapsed_ms = knn_started.elapsed().as_millis() as u64,
        "search_memories: merged KNN complete"
    );

    Ok(memories)
}
