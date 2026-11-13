use super::*;

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
            status: IndexStatus::from_storage_str(&status_str).unwrap_or(IndexStatus::Stale),
            vec_schema_version: row.get(5)?,
        })
    })?;
    match rows.next() {
        Some(Ok(meta)) => Ok(Some(meta)),
        Some(Err(error)) => Err(error),
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
pub(super) fn ensure_vec_schema_version_column(conn: &Connection) -> Result<()> {
    // SQLite doesn't have IF NOT EXISTS for ADD COLUMN, so we attempt the
    // ALTER and ignore the "duplicate column name" error.
    let res = conn.execute_batch(
        "ALTER TABLE schema_index_meta ADD COLUMN vec_schema_version INTEGER DEFAULT NULL",
    );
    match res {
        Ok(_) => Ok(()),
        Err(error) if error.to_string().contains("duplicate column name") => Ok(()),
        Err(error) => Err(error),
    }
}
