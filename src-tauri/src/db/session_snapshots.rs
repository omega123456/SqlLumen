use crate::timestamps::stored_timestamp_now;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotConnectionSummary {
    pub name: String,
    pub tab_count: i64,
}

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

#[derive(Debug, Clone)]
pub struct NewSnapshot {
    pub trigger_type: String,
    pub connection_count: i64,
    pub tab_count: i64,
    pub summary_json: String,
    pub state_json: String,
}

pub fn insert_and_prune(conn: &Connection, snapshot: &NewSnapshot, keep: i64) -> Result<i64> {
    let now = stored_timestamp_now();
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

pub fn get_state_json(conn: &Connection, id: i64) -> Result<Option<String>> {
    let result = conn.query_row(
        "SELECT state_json FROM session_snapshots WHERE id = ?1",
        params![id],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(state) => Ok(Some(state)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error),
    }
}

pub fn delete_snapshot(conn: &Connection, id: i64) -> Result<bool> {
    let rows = conn.execute("DELETE FROM session_snapshots WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}
