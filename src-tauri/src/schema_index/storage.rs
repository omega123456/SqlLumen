use std::collections::HashMap;

use rusqlite::{params, Connection, Result};

use super::embedding_to_bytes;
use super::types::{ChunkInsert, ChunkMetadata, ChunkType, FkEdge, IndexMeta, IndexStatus};

/// Current schema version of the vec0 virtual table layout.
/// Increment this when the vec0 CREATE statement changes (e.g. distance metric).
/// Version 1 = cosine distance metric.
pub const VEC_SCHEMA_VERSION: u32 = 2;

/// Sanitize an ID string for use in a SQL table name by replacing
/// non-alphanumeric characters with underscores.
pub fn sanitize_table_name(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect()
}

/// Compute the per-profile vec0 virtual table name.
pub fn vec_table_name(profile_id: &str) -> String {
    format!("schema_index_vectors_{}", sanitize_table_name(profile_id))
}

/// Create a per-profile `schema_index_vectors_{profile}` vec0 virtual table
/// with the given dimension.
pub fn create_vec_table(conn: &Connection, profile_id: &str, dimension: usize) -> Result<()> {
    let table = vec_table_name(profile_id);
    conn.execute_batch(&format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS {table} USING vec0(id INTEGER PRIMARY KEY, embedding FLOAT[{dimension}] distance_metric=cosine)"
    ))?;
    Ok(())
}

/// Drop the per-profile `schema_index_vectors_{profile}` virtual table.
pub fn drop_vec_table(conn: &Connection, profile_id: &str) -> Result<()> {
    let table = vec_table_name(profile_id);
    conn.execute_batch(&format!("DROP TABLE IF EXISTS {table}"))?;
    Ok(())
}

/// Insert a chunk into `schema_index_chunks` and its embedding into the
/// profile-specific vector table. Returns the inserted chunk ID.
pub fn insert_chunk(conn: &Connection, chunk: &ChunkInsert) -> Result<i64> {
    conn.execute(
        "INSERT INTO schema_index_chunks (connection_id, chunk_key, db_name, table_name, chunk_type, ddl_text, ddl_hash, model_id, ref_db_name, ref_table_name, text_for_embedding, row_count_approx)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            chunk.connection_id,
            chunk.chunk_key,
            chunk.db_name,
            chunk.table_name,
            chunk.chunk_type.as_str(),
            chunk.ddl_text,
            chunk.ddl_hash,
            chunk.model_id,
            chunk.ref_db_name,
            chunk.ref_table_name,
            chunk.text_for_embedding,
            chunk.row_count_approx,
        ],
    )?;
    let chunk_id = conn.last_insert_rowid();

    let table = vec_table_name(&chunk.connection_id);
    let bytes = embedding_to_bytes(&chunk.embedding);
    conn.execute(
        &format!("INSERT INTO {table} (id, embedding) VALUES (?1, ?2)"),
        params![chunk_id, bytes],
    )?;

    Ok(chunk_id)
}

/// Update an existing chunk's DDL, hash, model_id, embedded_at, and vector embedding.
pub fn update_chunk_embedding(
    conn: &Connection,
    chunk_id: i64,
    ddl_text: &str,
    ddl_hash: &str,
    model_id: &str,
    embedding: &[f32],
    profile_id: &str,
    text_for_embedding: Option<&str>,
    row_count_approx: Option<i64>,
) -> Result<()> {
    conn.execute(
        "UPDATE schema_index_chunks SET ddl_text = ?1, ddl_hash = ?2, model_id = ?3, embedded_at = datetime('now'), text_for_embedding = ?5, row_count_approx = ?6 WHERE id = ?4",
        params![ddl_text, ddl_hash, model_id, chunk_id, text_for_embedding, row_count_approx],
    )?;

    let table = vec_table_name(profile_id);
    let bytes = embedding_to_bytes(embedding);
    conn.execute(
        &format!("UPDATE {table} SET embedding = ?1 WHERE id = ?2"),
        params![bytes, chunk_id],
    )?;

    Ok(())
}

/// Delete all chunks where `(connection_id, db_name, table_name)` matches either the
/// source table or the referenced table. Also deletes corresponding vectors.
pub fn delete_chunks_by_table(
    conn: &Connection,
    connection_id: &str,
    db_name: &str,
    table_name: &str,
) -> Result<()> {
    let vec_table = vec_table_name(connection_id);

    // First collect the IDs to delete from the vector table
    let mut stmt = conn.prepare(
        "SELECT id FROM schema_index_chunks
         WHERE (connection_id = ?1 AND db_name = ?2 AND table_name = ?3)
            OR (connection_id = ?1 AND ref_db_name = ?2 AND ref_table_name = ?3)",
    )?;
    let ids: Vec<i64> = stmt
        .query_map(params![connection_id, db_name, table_name], |row| {
            row.get(0)
        })?
        .collect::<Result<Vec<_>>>()?;

    // Delete from vectors
    for id in &ids {
        conn.execute(
            &format!("DELETE FROM {vec_table} WHERE id = ?1"),
            params![id],
        )?;
    }

    // Delete from chunks
    conn.execute(
        "DELETE FROM schema_index_chunks
         WHERE (connection_id = ?1 AND db_name = ?2 AND table_name = ?3)
            OR (connection_id = ?1 AND ref_db_name = ?2 AND ref_table_name = ?3)",
        params![connection_id, db_name, table_name],
    )?;

    Ok(())
}

/// Delete all chunks and vectors for a connection. Also clears any stored
/// per-table MySQL signatures so a subsequent force-rebuild will re-fetch
/// every table's DDL.
pub fn delete_all_chunks(conn: &Connection, connection_id: &str) -> Result<()> {
    let vec_table = vec_table_name(connection_id);

    // Collect IDs first
    let mut stmt = conn.prepare("SELECT id FROM schema_index_chunks WHERE connection_id = ?1")?;
    let ids: Vec<i64> = stmt
        .query_map(params![connection_id], |row| row.get(0))?
        .collect::<Result<Vec<_>>>()?;

    // Delete from vectors
    for id in &ids {
        conn.execute(
            &format!("DELETE FROM {vec_table} WHERE id = ?1"),
            params![id],
        )?;
    }

    // Delete from chunks
    conn.execute(
        "DELETE FROM schema_index_chunks WHERE connection_id = ?1",
        params![connection_id],
    )?;

    // Drop any stored per-table signatures so the next build re-materializes
    // them alongside fresh DDL.
    delete_all_signatures(conn, connection_id)?;

    // Also wipe FK edges and segment DF for this connection.
    delete_fk_edges_for_connection(conn, connection_id)?;
    delete_segment_df_for_connection(conn, connection_id)?;

    Ok(())
}

/// Delete a single chunk by its connection_id and chunk_key. Also deletes the
/// corresponding vector row. Returns `Ok(())` even if the chunk doesn't exist.
pub fn delete_chunk_by_key(conn: &Connection, connection_id: &str, chunk_key: &str) -> Result<()> {
    let vec_table = vec_table_name(connection_id);

    // Look up the chunk ID first
    let mut stmt = conn.prepare(
        "SELECT id FROM schema_index_chunks WHERE connection_id = ?1 AND chunk_key = ?2",
    )?;
    let ids: Vec<i64> = stmt
        .query_map(params![connection_id, chunk_key], |row| row.get(0))?
        .collect::<Result<Vec<_>>>()?;

    // Delete from vectors
    for id in &ids {
        conn.execute(
            &format!("DELETE FROM {vec_table} WHERE id = ?1"),
            params![id],
        )?;
    }

    // Delete from chunks
    conn.execute(
        "DELETE FROM schema_index_chunks WHERE connection_id = ?1 AND chunk_key = ?2",
        params![connection_id, chunk_key],
    )?;

    Ok(())
}

/// Returns `Vec<(chunk_key, ddl_hash)>` for all chunks of a connection.
pub fn get_chunk_hashes(conn: &Connection, connection_id: &str) -> Result<Vec<(String, String)>> {
    let mut stmt = conn
        .prepare("SELECT chunk_key, ddl_hash FROM schema_index_chunks WHERE connection_id = ?1")?;
    let rows = stmt
        .query_map(params![connection_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

/// Get a single chunk by its connection_id and chunk_key.
pub fn get_chunk_by_key(
    conn: &Connection,
    connection_id: &str,
    chunk_key: &str,
) -> Result<Option<ChunkMetadata>> {
    let mut stmt = conn.prepare(
        "SELECT id, connection_id, chunk_key, db_name, table_name, chunk_type, ddl_text, ddl_hash, model_id, embedded_at, ref_db_name, ref_table_name, text_for_embedding, row_count_approx
         FROM schema_index_chunks
         WHERE connection_id = ?1 AND chunk_key = ?2",
    )?;
    let mut rows = stmt.query_map(params![connection_id, chunk_key], |row| {
        row_to_chunk_metadata(row)
    })?;
    match rows.next() {
        Some(Ok(meta)) => Ok(Some(meta)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}

/// List all chunks for a connection.
pub fn list_chunks(conn: &Connection, connection_id: &str) -> Result<Vec<ChunkMetadata>> {
    let mut stmt = conn.prepare(
        "SELECT id, connection_id, chunk_key, db_name, table_name, chunk_type, ddl_text, ddl_hash, model_id, embedded_at, ref_db_name, ref_table_name, text_for_embedding, row_count_approx
         FROM schema_index_chunks
         WHERE connection_id = ?1
         ORDER BY id",
    )?;
    let rows = stmt
        .query_map(params![connection_id], |row| row_to_chunk_metadata(row))?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

/// INSERT OR REPLACE into `schema_index_meta`.
pub fn upsert_index_meta(conn: &Connection, meta: &IndexMeta) -> Result<()> {
    // Ensure the vec_schema_version column exists (added after the initial migration).
    ensure_vec_schema_version_column(conn)?;
    conn.execute(
        "INSERT OR REPLACE INTO schema_index_meta (connection_id, model_id, embedding_dimension, last_build_at, status, vec_schema_version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            meta.connection_id,
            meta.model_id,
            meta.embedding_dimension,
            meta.last_build_at,
            meta.status.as_str(),
            VEC_SCHEMA_VERSION as i64,
        ],
    )?;
    Ok(())
}

/// Get the index metadata for a connection.
pub fn get_index_meta(conn: &Connection, connection_id: &str) -> Result<Option<IndexMeta>> {
    // Ensure the vec_schema_version column exists (added after the initial migration).
    ensure_vec_schema_version_column(conn)?;
    let mut stmt = conn.prepare(
        "SELECT connection_id, model_id, embedding_dimension, last_build_at, status, vec_schema_version
         FROM schema_index_meta
         WHERE connection_id = ?1",
    )?;
    let mut rows = stmt.query_map(params![connection_id], |row| {
        let status_str: String = row.get(4)?;
        Ok(IndexMeta {
            connection_id: row.get(0)?,
            model_id: row.get(1)?,
            embedding_dimension: row.get(2)?,
            last_build_at: row.get(3)?,
            status: IndexStatus::from_str(&status_str).unwrap_or(IndexStatus::Stale),
            vec_schema_version: row.get(5)?,
        })
    })?;
    match rows.next() {
        Some(Ok(meta)) => Ok(Some(meta)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}

/// Update the status of an index for a connection.
pub fn update_index_status(
    conn: &Connection,
    connection_id: &str,
    status: &IndexStatus,
) -> Result<()> {
    conn.execute(
        "UPDATE schema_index_meta SET status = ?1 WHERE connection_id = ?2",
        params![status.as_str(), connection_id],
    )?;
    Ok(())
}

/// Ensure the `vec_schema_version` column exists on the `schema_index_meta` table.
///
/// Old databases created by migration 005 don't have this column. Adding it
/// via `ALTER TABLE … ADD COLUMN` is a no-op if the column already exists
/// (SQLite returns an error that we can safely ignore).
fn ensure_vec_schema_version_column(conn: &Connection) -> Result<()> {
    // SQLite doesn't have IF NOT EXISTS for ADD COLUMN, so we attempt the
    // ALTER and ignore the "duplicate column name" error.
    let res = conn.execute_batch(
        "ALTER TABLE schema_index_meta ADD COLUMN vec_schema_version INTEGER DEFAULT NULL",
    );
    match res {
        Ok(_) => Ok(()),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("duplicate column name") {
                Ok(())
            } else {
                Err(e)
            }
        }
    }
}

// ── schema_index_table_signatures CRUD ──────────────────────────────────

/// Fetch all stored `(db_name, table_name) -> mysql_signature` entries for the
/// given connection. Returned as a `HashMap` for O(1) lookup during the diff.
pub fn get_signatures_for_connection(
    conn: &Connection,
    connection_id: &str,
) -> Result<HashMap<(String, String), String>> {
    let mut stmt = conn.prepare(
        "SELECT db_name, table_name, mysql_signature
         FROM schema_index_table_signatures
         WHERE connection_id = ?1",
    )?;
    let rows = stmt.query_map(params![connection_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let mut out = HashMap::new();
    for row in rows {
        let (db, table, sig) = row?;
        out.insert((db, table), sig);
    }
    Ok(out)
}

/// Insert or replace a batch of `(db_name, table_name, mysql_signature)` rows
/// for the given connection. Uses a single prepared statement — the caller is
/// responsible for wrapping in a transaction when the batch is large.
pub fn upsert_signatures(
    conn: &Connection,
    connection_id: &str,
    entries: &[(String, String, String)],
) -> Result<()> {
    let mut stmt = conn.prepare(
        "INSERT INTO schema_index_table_signatures
            (connection_id, db_name, table_name, mysql_signature, captured_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT (connection_id, db_name, table_name)
         DO UPDATE SET mysql_signature = excluded.mysql_signature,
                       captured_at = excluded.captured_at",
    )?;
    for (db, table, sig) in entries {
        stmt.execute(params![connection_id, db, table, sig])?;
    }
    Ok(())
}

/// Delete a single signature row for `(connection_id, db_name, table_name)`.
/// No-op if the row doesn't exist.
pub fn delete_signature(
    conn: &Connection,
    connection_id: &str,
    db_name: &str,
    table_name: &str,
) -> Result<()> {
    conn.execute(
        "DELETE FROM schema_index_table_signatures
         WHERE connection_id = ?1 AND db_name = ?2 AND table_name = ?3",
        params![connection_id, db_name, table_name],
    )?;
    Ok(())
}

/// Delete all signature rows for a connection. Called from `delete_all_chunks`
/// so a force-rebuild triggers a full DDL re-fetch.
pub fn delete_all_signatures(conn: &Connection, connection_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM schema_index_table_signatures WHERE connection_id = ?1",
        params![connection_id],
    )?;
    Ok(())
}

// ── schema_index_fk_edges CRUD ─────────────────────────────────────────

/// Replace all FK edges for an entire connection.
/// Deletes all existing edges for `connection_id` then inserts the new edges.
pub fn replace_fk_edges_for_connection(
    conn: &Connection,
    connection_id: &str,
    edges: &[FkEdge],
) -> Result<()> {
    delete_fk_edges_for_connection(conn, connection_id)?;
    let mut stmt = conn.prepare(
        "INSERT INTO schema_index_fk_edges (connection_id, src_db, src_tbl, src_col, dst_db, dst_tbl, dst_col, constraint_name, on_delete, on_update)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;
    for edge in edges {
        stmt.execute(params![
            connection_id,
            edge.src_db,
            edge.src_tbl,
            edge.src_col,
            edge.dst_db,
            edge.dst_tbl,
            edge.dst_col,
            edge.constraint_name,
            edge.on_delete.as_deref().unwrap_or("RESTRICT"),
            edge.on_update.as_deref().unwrap_or("RESTRICT"),
        ])?;
    }
    Ok(())
}

/// Replace all FK edges for a specific table (as source).
/// Deletes existing edges for this `(connection_id, src_db, src_tbl)` then
/// inserts the new edges.
pub fn replace_fk_edges_for_table(
    conn: &Connection,
    connection_id: &str,
    src_db: &str,
    src_tbl: &str,
    edges: &[FkEdge],
) -> Result<()> {
    conn.execute(
        "DELETE FROM schema_index_fk_edges WHERE connection_id = ?1 AND src_db = ?2 AND src_tbl = ?3",
        params![connection_id, src_db, src_tbl],
    )?;
    let mut stmt = conn.prepare(
        "INSERT INTO schema_index_fk_edges (connection_id, src_db, src_tbl, src_col, dst_db, dst_tbl, dst_col, constraint_name, on_delete, on_update)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;
    for edge in edges {
        stmt.execute(params![
            connection_id,
            edge.src_db,
            edge.src_tbl,
            edge.src_col,
            edge.dst_db,
            edge.dst_tbl,
            edge.dst_col,
            edge.constraint_name,
            edge.on_delete.as_deref().unwrap_or("RESTRICT"),
            edge.on_update.as_deref().unwrap_or("RESTRICT"),
        ])?;
    }
    Ok(())
}

/// Get all FK edges for a connection.
pub fn get_fk_edges_for_connection(conn: &Connection, connection_id: &str) -> Result<Vec<FkEdge>> {
    let mut stmt = conn.prepare(
        "SELECT connection_id, src_db, src_tbl, src_col, dst_db, dst_tbl, dst_col, constraint_name, on_delete, on_update
         FROM schema_index_fk_edges
         WHERE connection_id = ?1",
    )?;
    let rows = stmt
        .query_map(params![connection_id], |row| {
            Ok(FkEdge {
                connection_id: row.get(0)?,
                src_db: row.get(1)?,
                src_tbl: row.get(2)?,
                src_col: row.get(3)?,
                dst_db: row.get(4)?,
                dst_tbl: row.get(5)?,
                dst_col: row.get(6)?,
                constraint_name: row.get(7)?,
                on_delete: row.get(8)?,
                on_update: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

/// Delete all FK edges for a connection.
pub fn delete_fk_edges_for_connection(conn: &Connection, connection_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM schema_index_fk_edges WHERE connection_id = ?1",
        params![connection_id],
    )?;
    Ok(())
}

/// Map a rusqlite row to ChunkMetadata.
fn row_to_chunk_metadata(row: &rusqlite::Row<'_>) -> Result<ChunkMetadata> {
    let chunk_type_str: String = row.get(5)?;
    Ok(ChunkMetadata {
        id: row.get(0)?,
        connection_id: row.get(1)?,
        chunk_key: row.get(2)?,
        db_name: row.get(3)?,
        table_name: row.get(4)?,
        chunk_type: ChunkType::from_str(&chunk_type_str).unwrap_or(ChunkType::Table),
        ddl_text: row.get(6)?,
        ddl_hash: row.get(7)?,
        model_id: row.get(8)?,
        embedded_at: row.get(9)?,
        ref_db_name: row.get(10)?,
        ref_table_name: row.get(11)?,
        text_for_embedding: row.get(12)?,
        row_count_approx: row.get(13)?,
    })
}

// ── schema_index_segment_df CRUD ───────────────────────────────────────

/// Replace all segment document frequency entries for a connection.
/// `entries` is a list of `(segment, doc_count)`.
pub fn replace_segment_df_for_connection(
    conn: &Connection,
    connection_id: &str,
    entries: &[(String, usize)],
) -> Result<()> {
    delete_segment_df_for_connection(conn, connection_id)?;
    let mut stmt = conn.prepare(
        "INSERT INTO schema_index_segment_df (connection_id, segment, doc_count)
         VALUES (?1, ?2, ?3)",
    )?;
    for (segment, doc_count) in entries {
        stmt.execute(params![connection_id, segment, *doc_count as i64])?;
    }
    Ok(())
}

/// Get segment → doc_count map for a connection.
pub fn get_segment_df_for_connection(
    conn: &Connection,
    connection_id: &str,
) -> Result<HashMap<String, usize>> {
    let mut stmt = conn.prepare(
        "SELECT segment, doc_count FROM schema_index_segment_df WHERE connection_id = ?1",
    )?;
    let rows = stmt.query_map(params![connection_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
    })?;
    let mut map = HashMap::new();
    for row in rows {
        let (seg, count) = row?;
        map.insert(seg, count);
    }
    Ok(map)
}

/// Delete all segment DF entries for a connection.
pub fn delete_segment_df_for_connection(conn: &Connection, connection_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM schema_index_segment_df WHERE connection_id = ?1",
        params![connection_id],
    )?;
    Ok(())
}

/// Count distinct table chunks for a connection (used as N in IDF computation).
pub fn count_table_chunks(conn: &Connection, connection_id: &str) -> Result<usize> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_index_chunks WHERE connection_id = ?1 AND chunk_type = 'table'",
        params![connection_id],
        |row| row.get(0),
    )?;
    Ok(count as usize)
}
