//! Repository for the `session_snapshots` table.
//!
//! Owns all SQL for storing, listing, fetching, and deleting workspace session
//! snapshots. Snapshots persist the full `SessionState` JSON the frontend restore
//! engine produces, plus lightweight metadata (timestamp, trigger, counts, and a
//! per-connection summary) so the dialog can render without parsing the heavy blob.
//!
//! The backend treats `summary_json` and `state_json` as opaque strings; it never
//! interprets their contents. Insert-and-prune happens atomically so the stored
//! count can never exceed the retention limit after a successful create.

use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

/// Per-connection summary stored inside `summary_json` and surfaced in listings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotConnectionSummary {
    pub name: String,
    pub tab_count: i64,
}

/// A snapshot summary returned by the list endpoint. Excludes `state_json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSummary {
    pub id: i64,
    pub created_at: String,
    pub trigger_type: String,
    pub connection_count: i64,
    pub tab_count: i64,
    pub connections: Vec<SnapshotConnectionSummary>,
}

/// Data for inserting a new snapshot. `summary_json` and `state_json` are opaque
/// strings produced by the frontend.
#[derive(Debug, Clone)]
pub struct NewSnapshot {
    pub trigger_type: String,
    pub connection_count: i64,
    pub tab_count: i64,
    pub summary_json: String,
    pub state_json: String,
}

/// Insert a single snapshot and prune the oldest rows beyond `keep`, atomically.
///
/// Pruning deletes the oldest rows ordered by `created_at` ASC (ties broken by
/// `id` ASC so the oldest inserted row goes first) until at most `keep` rows
/// remain. Manual snapshots are not exempt. Returns the new row id.
pub fn insert_and_prune(conn: &Connection, snapshot: &NewSnapshot, keep: i64) -> Result<i64> {
    let now = timestamp_now();
    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "INSERT INTO session_snapshots
            (created_at, trigger_type, connection_count, tab_count, summary_json, state_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            now,
            snapshot.trigger_type,
            snapshot.connection_count,
            snapshot.tab_count,
            snapshot.summary_json,
            snapshot.state_json,
        ],
    )?;
    let new_id = tx.last_insert_rowid();

    // Keep only the `keep` newest rows; delete everything else (the oldest).
    // `keep < 1` is clamped to 0 so the SQL is well-formed (deletes all but none).
    let keep = keep.max(0);
    tx.execute(
        "DELETE FROM session_snapshots
         WHERE id NOT IN (
             SELECT id FROM session_snapshots
             ORDER BY created_at DESC, id DESC
             LIMIT ?1
         )",
        params![keep],
    )?;

    tx.commit()?;
    Ok(new_id)
}

/// List snapshot summaries, newest first. Excludes the heavy `state_json` column.
/// The `connections` field is parsed from each row's `summary_json`.
pub fn list_summaries(conn: &Connection) -> Result<Vec<SnapshotSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, created_at, trigger_type, connection_count, tab_count, summary_json
         FROM session_snapshots
         ORDER BY created_at DESC, id DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let summary_json: String = row.get(5)?;
        let connections: Vec<SnapshotConnectionSummary> =
            serde_json::from_str(&summary_json).unwrap_or_default();
        Ok(SnapshotSummary {
            id: row.get(0)?,
            created_at: row.get(1)?,
            trigger_type: row.get(2)?,
            connection_count: row.get(3)?,
            tab_count: row.get(4)?,
            connections,
        })
    })?;
    rows.collect::<Result<Vec<_>>>()
}

/// Fetch the full `state_json` for a single snapshot id. Returns `None` if no
/// snapshot with that id exists.
pub fn get_state_json(conn: &Connection, id: i64) -> Result<Option<String>> {
    let result = conn.query_row(
        "SELECT state_json FROM session_snapshots WHERE id = ?1",
        params![id],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(state) => Ok(Some(state)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Delete a single snapshot by id. Returns `true` if a row was removed.
pub fn delete_snapshot(conn: &Connection, id: i64) -> Result<bool> {
    let rows = conn.execute("DELETE FROM session_snapshots WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

/// ISO-8601 / RFC-3339 timestamp string, matching the data-row convention in
/// `db/history.rs`. RFC-3339 sorts correctly lexicographically for ordering.
fn timestamp_now() -> String {
    chrono::Utc::now().to_rfc3339()
}
