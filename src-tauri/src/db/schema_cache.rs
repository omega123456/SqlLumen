use crate::timestamps::unix_seconds_now;
use rusqlite::{params, Connection, OptionalExtension, Result};

pub fn save_schema_cache_snapshot(
    conn: &Connection,
    connection_id: &str,
    snapshot_json: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO schema_cache_snapshots (connection_id, snapshot_json, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(connection_id) DO UPDATE SET
           snapshot_json = excluded.snapshot_json,
           updated_at = excluded.updated_at",
        params![connection_id, snapshot_json, unix_seconds_now()],
    )?;
    Ok(())
}

pub fn load_schema_cache_snapshot(
    conn: &Connection,
    connection_id: &str,
) -> Result<Option<String>> {
    conn.query_row(
        "SELECT snapshot_json FROM schema_cache_snapshots WHERE connection_id = ?1",
        [connection_id],
        |row| row.get::<_, String>(0),
    )
    .optional()
}
