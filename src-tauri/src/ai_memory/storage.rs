use rusqlite::{params, Connection, Result};
use std::time::{SystemTime, UNIX_EPOCH};

use super::embedding_to_bytes;
use super::types::AiMemory;
use crate::schema_index::storage::sanitize_table_name;

/// Compute the per-connection ai_memory vec0 virtual table name.
pub fn vec_table_name(connection_id: &str) -> String {
    format!("ai_memory_vectors_{}", sanitize_table_name(connection_id))
}

/// Insert a memory row into `ai_memories`. Returns the new row id.
pub fn insert_memory(conn: &Connection, connection_id: &str, content: &str) -> Result<i64> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    conn.execute(
        "INSERT INTO ai_memories (connection_id, content, created_at, source) VALUES (?1, ?2, ?3, 'manual')",
        params![connection_id, content, now],
    )?;
    Ok(conn.last_insert_rowid())
}

/// List all memories for a connection, ordered by created_at descending.
pub fn list_memories(conn: &Connection, connection_id: &str) -> Result<Vec<AiMemory>> {
    let mut stmt = conn.prepare(
        "SELECT id, connection_id, content, created_at, source FROM ai_memories WHERE connection_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt
        .query_map(params![connection_id], |row| {
            Ok(AiMemory {
                id: row.get(0)?,
                connection_id: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                source: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

/// Delete a single memory row by id.
pub fn delete_memory(conn: &Connection, memory_id: i64) -> Result<()> {
    conn.execute("DELETE FROM ai_memories WHERE id = ?1", params![memory_id])
        .map_err(|e| {
            tracing::error!(memory_id, %e, "delete_memory: failed to delete memory row");
            e
        })?;
    Ok(())
}

/// Delete all memories for a connection and drop the vec0 table.
pub fn delete_memories_for_connection(conn: &Connection, connection_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM ai_memories WHERE connection_id = ?1",
        params![connection_id],
    )?;
    let table = vec_table_name(connection_id);
    conn.execute_batch(&format!("DROP TABLE IF EXISTS {table}"))?;
    Ok(())
}

/// Create the vec0 virtual table for a connection if it doesn't exist. Returns the table name.
pub fn ensure_vec_table(conn: &Connection, connection_id: &str, dim: usize) -> Result<String> {
    let table = vec_table_name(connection_id);
    conn.execute_batch(&format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS {table} USING vec0(id INTEGER PRIMARY KEY, embedding FLOAT[{dim}] distance_metric=cosine)"
    )).map_err(|e| {
        tracing::error!(connection_id, dim, %e, "ensure_vec_table: failed to create vec0 table");
        e
    })?;
    Ok(table)
}

/// Insert an embedding vector for a memory.
pub fn insert_memory_vector(
    conn: &Connection,
    table_name: &str,
    memory_id: i64,
    embedding: &[f32],
) -> Result<()> {
    let bytes = embedding_to_bytes(embedding);
    conn.execute(
        &format!("INSERT INTO {table_name} (id, embedding) VALUES (?1, ?2)"),
        params![memory_id, bytes],
    )
    .map_err(|e| {
        tracing::error!(table_name, memory_id, %e, "insert_memory_vector: failed to insert vector");
        e
    })?;
    Ok(())
}

/// Delete a memory's vector from the vec table. Gracefully handles missing table.
pub fn delete_memory_vector(conn: &Connection, connection_id: &str, memory_id: i64) -> Result<()> {
    let table = vec_table_name(connection_id);
    let result = conn.execute(
        &format!("DELETE FROM {table} WHERE id = ?1"),
        params![memory_id],
    );
    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("no such table") {
                tracing::warn!(
                    connection_id,
                    memory_id,
                    "delete_memory_vector: vec table does not exist, skipping"
                );
                Ok(())
            } else {
                Err(e)
            }
        }
    }
}

/// Get all (id, content) pairs for a connection — used for re-embedding.
pub fn get_memory_texts(conn: &Connection, connection_id: &str) -> Result<Vec<(i64, String)>> {
    let mut stmt =
        conn.prepare("SELECT id, content FROM ai_memories WHERE connection_id = ?1 ORDER BY id")?;
    let rows = stmt
        .query_map(params![connection_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

/// Get a single memory by id.
pub fn get_memory_by_id(conn: &Connection, memory_id: i64) -> Result<Option<AiMemory>> {
    let mut stmt = conn.prepare(
        "SELECT id, connection_id, content, created_at, source FROM ai_memories WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![memory_id], |row| {
        Ok(AiMemory {
            id: row.get(0)?,
            connection_id: row.get(1)?,
            content: row.get(2)?,
            created_at: row.get(3)?,
            source: row.get(4)?,
        })
    })?;
    match rows.next() {
        Some(Ok(m)) => Ok(Some(m)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}
