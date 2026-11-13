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

#[derive(Debug, Clone, Copy)]
pub struct HistoryQuery<'a> {
    pub connection_id: &'a str,
    pub page: i64,
    pub page_size: i64,
    pub search: Option<&'a str>,
    pub since: Option<&'a str>,
}

pub fn list_history(conn: &Connection, query: &HistoryQuery<'_>) -> Result<HistoryPage> {
    use rusqlite::types::Value;

    let HistoryQuery {
        connection_id,
        page,
        page_size,
        search,
        since,
    } = *query;

    let offset = (page.max(1) - 1) * page_size;

    // Build the shared WHERE clause and its bound parameters dynamically so the
    // search/since filters compose without a combinatorial explosion of SQL.
    let mut where_clause = String::from("WHERE connection_id = ?1");
    let mut filter_params: Vec<Value> = vec![Value::Text(connection_id.to_string())];
    let mut next_index = 2;

    if let Some(term) = search {
        where_clause.push_str(&format!(" AND sql_text LIKE ?{next_index}"));
        filter_params.push(Value::Text(format!("%{term}%")));
        next_index += 1;
    }
    if let Some(cutoff) = since {
        where_clause.push_str(&format!(" AND timestamp >= ?{next_index}"));
        filter_params.push(Value::Text(cutoff.to_string()));
        next_index += 1;
    }

    let count_sql = format!("SELECT COUNT(*) FROM query_history {where_clause}");
    let total: i64 = conn.query_row(
        &count_sql,
        rusqlite::params_from_iter(filter_params.iter()),
        |row| row.get(0),
    )?;

    let list_sql = format!(
        "SELECT id, connection_id, database_name, sql_text, timestamp, duration_ms, row_count, affected_rows, success, error_message
         FROM query_history
         {where_clause}
         ORDER BY timestamp DESC
         LIMIT ?{limit_idx} OFFSET ?{offset_idx}",
        limit_idx = next_index,
        offset_idx = next_index + 1,
    );
    let mut list_params = filter_params;
    list_params.push(Value::Integer(page_size));
    list_params.push(Value::Integer(offset));

    let mut stmt = conn.prepare(&list_sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(list_params.iter()), map_row)?;
    let entries = rows.collect::<Result<Vec<_>>>()?;

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
