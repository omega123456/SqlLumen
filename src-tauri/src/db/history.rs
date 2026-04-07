use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

/// A single query history entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub connection_id: String,
    pub database_name: Option<String>,
    pub sql_text: String,
    pub timestamp: String,
    pub duration_ms: Option<i64>,
    pub row_count: Option<i64>,
    pub affected_rows: Option<i64>,
    pub success: bool,
    pub error_message: Option<String>,
}

/// Data for inserting a new history entry.
#[derive(Debug, Clone)]
pub struct NewHistoryEntry {
    pub connection_id: String,
    pub database_name: Option<String>,
    pub sql_text: String,
    pub duration_ms: Option<i64>,
    pub row_count: Option<i64>,
    pub affected_rows: Option<i64>,
    pub success: bool,
    pub error_message: Option<String>,
}

/// Pagination result for history queries.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub entries: Vec<HistoryEntry>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

/// Insert a single history entry. Returns the new row id.
pub fn insert_history(conn: &Connection, entry: &NewHistoryEntry) -> Result<i64> {
    let now = timestamp_now();
    conn.execute(
        "INSERT INTO query_history (connection_id, database_name, sql_text, timestamp, duration_ms, row_count, affected_rows, success, error_message)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            entry.connection_id,
            entry.database_name,
            entry.sql_text,
            now,
            entry.duration_ms,
            entry.row_count,
            entry.affected_rows,
            entry.success as i64,
            entry.error_message,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Insert multiple history entries in a single transaction.
pub fn insert_history_batch(conn: &Connection, entries: &[NewHistoryEntry]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let now = timestamp_now();
    {
        let mut stmt = tx.prepare(
            "INSERT INTO query_history (connection_id, database_name, sql_text, timestamp, duration_ms, row_count, affected_rows, success, error_message)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;
        for entry in entries {
            stmt.execute(params![
                entry.connection_id,
                entry.database_name,
                entry.sql_text,
                now,
                entry.duration_ms,
                entry.row_count,
                entry.affected_rows,
                entry.success as i64,
                entry.error_message,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// List history entries for a connection with pagination, newest first.
/// Supports optional search text (LIKE match on sql_text).
pub fn list_history(
    conn: &Connection,
    connection_id: &str,
    page: i64,
    page_size: i64,
    search: Option<&str>,
) -> Result<HistoryPage> {
    let offset = (page.max(1) - 1) * page_size;

    let (count_sql, list_sql);
    let total: i64;
    let entries: Vec<HistoryEntry>;

    if let Some(term) = search {
        let pattern = format!("%{term}%");

        count_sql =
            "SELECT COUNT(*) FROM query_history WHERE connection_id = ?1 AND sql_text LIKE ?2";
        total = conn.query_row(count_sql, params![connection_id, pattern], |row| row.get(0))?;

        list_sql = "SELECT id, connection_id, database_name, sql_text, timestamp, duration_ms, row_count, affected_rows, success, error_message
                     FROM query_history
                     WHERE connection_id = ?1 AND sql_text LIKE ?2
                     ORDER BY timestamp DESC
                     LIMIT ?3 OFFSET ?4";
        let mut stmt = conn.prepare(list_sql)?;
        let rows = stmt.query_map(params![connection_id, pattern, page_size, offset], map_row)?;
        entries = rows.collect::<Result<Vec<_>>>()?;
    } else {
        count_sql = "SELECT COUNT(*) FROM query_history WHERE connection_id = ?1";
        total = conn.query_row(count_sql, params![connection_id], |row| row.get(0))?;

        list_sql = "SELECT id, connection_id, database_name, sql_text, timestamp, duration_ms, row_count, affected_rows, success, error_message
                     FROM query_history
                     WHERE connection_id = ?1
                     ORDER BY timestamp DESC
                     LIMIT ?2 OFFSET ?3";
        let mut stmt = conn.prepare(list_sql)?;
        let rows = stmt.query_map(params![connection_id, page_size, offset], map_row)?;
        entries = rows.collect::<Result<Vec<_>>>()?;
    }

    Ok(HistoryPage {
        entries,
        total,
        page: page.max(1),
        page_size,
    })
}

/// Delete a single history entry by ID.
pub fn delete_history(conn: &Connection, id: i64) -> Result<bool> {
    let rows = conn.execute("DELETE FROM query_history WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

/// Delete all history entries for a connection.
pub fn clear_history(conn: &Connection, connection_id: &str) -> Result<i64> {
    let rows = conn.execute(
        "DELETE FROM query_history WHERE connection_id = ?1",
        params![connection_id],
    )?;
    Ok(rows as i64)
}

/// Prune history for a single connection: delete entries older than 90 days,
/// then enforce max 10,000 entries.
pub fn prune_history_for_connection(conn: &Connection, connection_id: &str) -> Result<i64> {
    let cutoff = chrono::Utc::now() - chrono::Duration::days(90);
    let cutoff_str = cutoff.to_rfc3339();

    let age_deleted = conn.execute(
        "DELETE FROM query_history WHERE connection_id = ?1 AND timestamp < ?2",
        params![connection_id, cutoff_str],
    )? as i64;

    let count_deleted = conn.execute(
        "DELETE FROM query_history
         WHERE connection_id = ?1
           AND id NOT IN (
               SELECT id FROM query_history
               WHERE connection_id = ?1
               ORDER BY timestamp DESC
               LIMIT 10000
           )",
        params![connection_id],
    )? as i64;

    Ok(age_deleted + count_deleted)
}

/// Prune history for all connections.
pub fn prune_all_history(conn: &Connection) -> Result<i64> {
    let connection_ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT DISTINCT connection_id FROM query_history")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.collect::<Result<Vec<_>>>()?
    };

    let mut total_pruned = 0i64;
    for cid in &connection_ids {
        total_pruned += prune_history_for_connection(conn, cid)?;
    }
    Ok(total_pruned)
}

fn map_row(row: &rusqlite::Row) -> Result<HistoryEntry> {
    let success_int: i64 = row.get(8)?;
    Ok(HistoryEntry {
        id: row.get(0)?,
        connection_id: row.get(1)?,
        database_name: row.get(2)?,
        sql_text: row.get(3)?,
        timestamp: row.get(4)?,
        duration_ms: row.get(5)?,
        row_count: row.get(6)?,
        affected_rows: row.get(7)?,
        success: success_int != 0,
        error_message: row.get(9)?,
    })
}

/// ISO-8601 timestamp string.
fn timestamp_now() -> String {
    chrono::Utc::now().to_rfc3339()
}
