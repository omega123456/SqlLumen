use rusqlite::{params, Connection, Result};
use std::time::{SystemTime, UNIX_EPOCH};

use super::embedding_to_bytes;
use super::types::{AiMemory, MemoryScope};
use crate::schema_index::storage::sanitize_table_name;

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ── Vec-table naming (one per scope/owner) ──────────────────────────────────

/// Compute the per-connection ai_memory vec0 virtual table name (unchanged).
pub fn vec_table_name(connection_id: &str) -> String {
    format!("ai_memory_vectors_{}", sanitize_table_name(connection_id))
}

/// Compute the per-group ai_memory vec0 virtual table name.
pub fn group_vec_table_name(group_id: &str) -> String {
    format!("ai_memory_vectors_group_{}", sanitize_table_name(group_id))
}

/// Compute the single global ai_memory vec0 virtual table name.
pub fn global_vec_table_name() -> String {
    "ai_memory_vectors_global".to_string()
}

/// Resolve the vec table name for a scope + optional owner.
///
/// Returns an error when the owner id required by the scope is missing.
pub fn vec_table_for_scope(scope: MemoryScope, owner_id: Option<&str>) -> Result<String, String> {
    match scope {
        MemoryScope::Connection => owner_id
            .map(vec_table_name)
            .ok_or_else(|| "connection scope requires a connection id".to_string()),
        MemoryScope::Group => owner_id
            .map(group_vec_table_name)
            .ok_or_else(|| "group scope requires a group id".to_string()),
        MemoryScope::Global => Ok(global_vec_table_name()),
    }
}

// ── Connection-scope row CRUD (table renamed to connection_memories) ─────────

/// Insert a memory row into `connection_memories`. Returns the new row id.
pub fn insert_memory(conn: &Connection, connection_id: &str, content: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO connection_memories (connection_id, content, created_at, source) VALUES (?1, ?2, ?3, 'manual')",
        params![connection_id, content, now_secs()],
    )?;
    Ok(conn.last_insert_rowid())
}

/// List all memories for a connection, ordered by created_at descending.
pub fn list_memories(conn: &Connection, connection_id: &str) -> Result<Vec<AiMemory>> {
    let mut stmt = conn.prepare(
        "SELECT id, connection_id, content, created_at, source FROM connection_memories WHERE connection_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt
        .query_map(params![connection_id], map_connection_row)?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

/// Delete a single connection-scope memory row by id.
pub fn delete_memory(conn: &Connection, memory_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM connection_memories WHERE id = ?1",
        params![memory_id],
    )
    .map_err(|e| {
        tracing::error!(memory_id, %e, "delete_memory: failed to delete memory row");
        e
    })?;
    Ok(())
}

/// Delete all memories for a connection and drop the vec0 table.
pub fn delete_memories_for_connection(conn: &Connection, connection_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM connection_memories WHERE connection_id = ?1",
        params![connection_id],
    )?;
    let table = vec_table_name(connection_id);
    conn.execute_batch(&format!("DROP TABLE IF EXISTS {table}"))?;
    Ok(())
}

/// Get all (id, content) pairs for a connection — used for re-embedding.
pub fn get_memory_texts(conn: &Connection, connection_id: &str) -> Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, content FROM connection_memories WHERE connection_id = ?1 ORDER BY id",
    )?;
    let rows = stmt
        .query_map(params![connection_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

/// Get a single connection-scope memory by id.
pub fn get_memory_by_id(conn: &Connection, memory_id: i64) -> Result<Option<AiMemory>> {
    let mut stmt = conn.prepare(
        "SELECT id, connection_id, content, created_at, source FROM connection_memories WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![memory_id], map_connection_row)?;
    match rows.next() {
        Some(Ok(m)) => Ok(Some(m)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}

// ── Group-scope row CRUD ────────────────────────────────────────────────────

pub fn insert_group_memory(conn: &Connection, group_id: &str, content: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO group_memories (group_id, content, created_at, source) VALUES (?1, ?2, ?3, 'manual')",
        params![group_id, content, now_secs()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_group_memories(conn: &Connection, group_id: &str) -> Result<Vec<AiMemory>> {
    let mut stmt = conn.prepare(
        "SELECT id, group_id, content, created_at, source FROM group_memories WHERE group_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt
        .query_map(params![group_id], map_group_row)?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn delete_group_memory(conn: &Connection, memory_id: i64) -> Result<()> {
    conn.execute("DELETE FROM group_memories WHERE id = ?1", params![memory_id])?;
    Ok(())
}

pub fn get_group_memory_texts(conn: &Connection, group_id: &str) -> Result<Vec<(i64, String)>> {
    let mut stmt =
        conn.prepare("SELECT id, content FROM group_memories WHERE group_id = ?1 ORDER BY id")?;
    let rows = stmt
        .query_map(params![group_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get_group_memory_by_id(conn: &Connection, memory_id: i64) -> Result<Option<AiMemory>> {
    let mut stmt = conn.prepare(
        "SELECT id, group_id, content, created_at, source FROM group_memories WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![memory_id], map_group_row)?;
    match rows.next() {
        Some(Ok(m)) => Ok(Some(m)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}

// ── Global-scope row CRUD ───────────────────────────────────────────────────

pub fn insert_global_memory(conn: &Connection, content: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO global_memories (content, created_at, source) VALUES (?1, ?2, 'manual')",
        params![content, now_secs()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_global_memories(conn: &Connection) -> Result<Vec<AiMemory>> {
    let mut stmt = conn.prepare(
        "SELECT id, content, created_at, source FROM global_memories ORDER BY created_at DESC",
    )?;
    let rows = stmt
        .query_map([], map_global_row)?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn delete_global_memory(conn: &Connection, memory_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM global_memories WHERE id = ?1",
        params![memory_id],
    )?;
    Ok(())
}

pub fn get_global_memory_texts(conn: &Connection) -> Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare("SELECT id, content FROM global_memories ORDER BY id")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get_global_memory_by_id(conn: &Connection, memory_id: i64) -> Result<Option<AiMemory>> {
    let mut stmt = conn
        .prepare("SELECT id, content, created_at, source FROM global_memories WHERE id = ?1")?;
    let mut rows = stmt.query_map(params![memory_id], map_global_row)?;
    match rows.next() {
        Some(Ok(m)) => Ok(Some(m)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}

// ── Scope-dispatching helpers ───────────────────────────────────────────────

/// Insert a memory at the given scope/owner. Returns the new row id.
pub fn insert_memory_scoped(
    conn: &Connection,
    scope: MemoryScope,
    owner_id: Option<&str>,
    content: &str,
) -> Result<i64, String> {
    match scope {
        MemoryScope::Connection => {
            let id = owner_id.ok_or_else(|| "connection scope requires a connection id".to_string())?;
            insert_memory(conn, id, content).map_err(|e| e.to_string())
        }
        MemoryScope::Group => {
            let id = owner_id.ok_or_else(|| "group scope requires a group id".to_string())?;
            insert_group_memory(conn, id, content).map_err(|e| e.to_string())
        }
        MemoryScope::Global => insert_global_memory(conn, content).map_err(|e| e.to_string()),
    }
}

/// List memories at the given scope/owner, newest first.
pub fn list_memories_scoped(
    conn: &Connection,
    scope: MemoryScope,
    owner_id: Option<&str>,
) -> Result<Vec<AiMemory>, String> {
    match scope {
        MemoryScope::Connection => {
            let id = owner_id.ok_or_else(|| "connection scope requires a connection id".to_string())?;
            list_memories(conn, id).map_err(|e| e.to_string())
        }
        MemoryScope::Group => {
            let id = owner_id.ok_or_else(|| "group scope requires a group id".to_string())?;
            list_group_memories(conn, id).map_err(|e| e.to_string())
        }
        MemoryScope::Global => list_global_memories(conn).map_err(|e| e.to_string()),
    }
}

/// Get a single memory at the given scope by id.
pub fn get_memory_by_id_scoped(
    conn: &Connection,
    scope: MemoryScope,
    memory_id: i64,
) -> Result<Option<AiMemory>, String> {
    match scope {
        MemoryScope::Connection => get_memory_by_id(conn, memory_id),
        MemoryScope::Group => get_group_memory_by_id(conn, memory_id),
        MemoryScope::Global => get_global_memory_by_id(conn, memory_id),
    }
    .map_err(|e| e.to_string())
}

/// Get (id, content) pairs at the given scope/owner — used for re-embedding.
pub fn get_memory_texts_scoped(
    conn: &Connection,
    scope: MemoryScope,
    owner_id: Option<&str>,
) -> Result<Vec<(i64, String)>, String> {
    match scope {
        MemoryScope::Connection => {
            let id = owner_id.ok_or_else(|| "connection scope requires a connection id".to_string())?;
            get_memory_texts(conn, id).map_err(|e| e.to_string())
        }
        MemoryScope::Group => {
            let id = owner_id.ok_or_else(|| "group scope requires a group id".to_string())?;
            get_group_memory_texts(conn, id).map_err(|e| e.to_string())
        }
        MemoryScope::Global => get_global_memory_texts(conn).map_err(|e| e.to_string()),
    }
}

/// Delete a memory row at the given scope by id.
pub fn delete_memory_scoped(
    conn: &Connection,
    scope: MemoryScope,
    memory_id: i64,
) -> Result<(), String> {
    match scope {
        MemoryScope::Connection => delete_memory(conn, memory_id),
        MemoryScope::Group => delete_group_memory(conn, memory_id),
        MemoryScope::Global => delete_global_memory(conn, memory_id),
    }
    .map_err(|e| e.to_string())
}

// ── Vector table operations (scope-aware) ───────────────────────────────────

/// Create the vec0 virtual table for a connection if it doesn't exist. Returns the table name.
pub fn ensure_vec_table(conn: &Connection, connection_id: &str, dim: usize) -> Result<String> {
    ensure_vec_table_named(conn, &vec_table_name(connection_id), dim)
}

/// Create a named vec0 virtual table if it doesn't exist. Returns the table name.
pub fn ensure_vec_table_named(conn: &Connection, table: &str, dim: usize) -> Result<String> {
    conn.execute_batch(&format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS {table} USING vec0(id INTEGER PRIMARY KEY, embedding FLOAT[{dim}] distance_metric=cosine)"
    )).map_err(|e| {
        tracing::error!(table, dim, %e, "ensure_vec_table: failed to create vec0 table");
        e
    })?;
    Ok(table.to_string())
}

/// Ensure the vec0 table for a scope/owner. Returns the table name.
pub fn ensure_vec_table_for_scope(
    conn: &Connection,
    scope: MemoryScope,
    owner_id: Option<&str>,
    dim: usize,
) -> Result<String, String> {
    let table = vec_table_for_scope(scope, owner_id)?;
    ensure_vec_table_named(conn, &table, dim).map_err(|e| e.to_string())
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

/// Delete a memory's vector from a named vec table. Gracefully handles a missing table.
pub fn delete_vector_from_table(conn: &Connection, table: &str, memory_id: i64) -> Result<()> {
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
                    table,
                    memory_id,
                    "delete_vector_from_table: vec table does not exist, skipping"
                );
                Ok(())
            } else {
                Err(e)
            }
        }
    }
}

/// Delete a connection memory's vector. Gracefully handles a missing table.
pub fn delete_memory_vector(conn: &Connection, connection_id: &str, memory_id: i64) -> Result<()> {
    delete_vector_from_table(conn, &vec_table_name(connection_id), memory_id)
}

/// Delete a memory's vector for the given scope/owner. Gracefully handles a missing table.
pub fn delete_memory_vector_scoped(
    conn: &Connection,
    scope: MemoryScope,
    owner_id: Option<&str>,
    memory_id: i64,
) -> Result<(), String> {
    let table = vec_table_for_scope(scope, owner_id)?;
    delete_vector_from_table(conn, &table, memory_id).map_err(|e| e.to_string())
}

// ── Move + cascade ──────────────────────────────────────────────────────────

/// Move a memory from a source scope/owner to a target scope/owner.
///
/// The embedding is computed by the caller (command layer) and passed in as
/// `embedding`. This helper inserts the source row's content into the target
/// row table (under a new id), ensures the target vec table, inserts the
/// vector, then deletes the source row + its vector. Returns the new
/// (target-scope) memory.
///
/// Runs inside its own transaction so a partial move never leaves orphaned
/// rows/vectors.
#[allow(clippy::too_many_arguments)]
pub fn move_memory(
    conn: &mut Connection,
    from_scope: MemoryScope,
    from_owner_id: Option<&str>,
    memory_id: i64,
    to_scope: MemoryScope,
    to_owner_id: Option<&str>,
    embedding: &[f32],
) -> Result<AiMemory, String> {
    let source = get_memory_by_id_scoped(conn, from_scope, memory_id)?
        .ok_or_else(|| format!("Memory with id {memory_id} not found at source scope"))?;

    let target_table = vec_table_for_scope(to_scope, to_owner_id)?;

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let new_id = insert_memory_scoped(&tx, to_scope, to_owner_id, &source.content)?;
    ensure_vec_table_named(&tx, &target_table, embedding.len()).map_err(|e| e.to_string())?;
    insert_memory_vector(&tx, &target_table, new_id, embedding).map_err(|e| e.to_string())?;

    delete_memory_vector_scoped(&tx, from_scope, from_owner_id, memory_id)?;
    delete_memory_scoped(&tx, from_scope, memory_id)?;

    tx.commit().map_err(|e| e.to_string())?;

    get_memory_by_id_scoped(conn, to_scope, new_id)?
        .ok_or_else(|| "Failed to read back moved memory".to_string())
}

/// Delete all `group_memories` for a group and drop its group vec0 table.
pub fn delete_memories_for_group(conn: &Connection, group_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM group_memories WHERE group_id = ?1",
        params![group_id],
    )?;
    let table = group_vec_table_name(group_id);
    conn.execute_batch(&format!("DROP TABLE IF EXISTS {table}"))?;
    Ok(())
}

// ── Row mappers ─────────────────────────────────────────────────────────────

fn map_connection_row(row: &rusqlite::Row) -> Result<AiMemory> {
    Ok(AiMemory {
        id: row.get(0)?,
        scope: MemoryScope::Connection,
        connection_id: row.get::<_, Option<String>>(1)?,
        group_id: None,
        content: row.get(2)?,
        created_at: row.get(3)?,
        source: row.get(4)?,
    })
}

fn map_group_row(row: &rusqlite::Row) -> Result<AiMemory> {
    Ok(AiMemory {
        id: row.get(0)?,
        scope: MemoryScope::Group,
        connection_id: None,
        group_id: row.get::<_, Option<String>>(1)?,
        content: row.get(2)?,
        created_at: row.get(3)?,
        source: row.get(4)?,
    })
}

fn map_global_row(row: &rusqlite::Row) -> Result<AiMemory> {
    Ok(AiMemory {
        id: row.get(0)?,
        scope: MemoryScope::Global,
        connection_id: None,
        group_id: None,
        content: row.get(1)?,
        created_at: row.get(2)?,
        source: row.get(3)?,
    })
}
