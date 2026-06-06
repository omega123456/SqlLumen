use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const LOG_DB_FILE_NAME: &str = "sqllumen-logs.db";
pub const LOG_PAGE_SIZE: i64 = 20;
pub const LOG_RETENTION_DAYS: i64 = 7;
pub const LOG_VIEWER_MIN_UNIVERSE: i64 = 1000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: i64,
    pub timestamp: String,
    pub level: String,
    pub target: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub entries: Vec<LogEntry>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewLogEntry {
    pub timestamp: String,
    pub level: String,
    pub level_num: i64,
    pub target: String,
    pub message: String,
}

pub fn open_log_database(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            rusqlite::Error::InvalidParameterName(format!(
                "Failed to create log database directory '{}': {error}",
                parent.display()
            ))
        })?;
    }

    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA busy_timeout=5000;",
    )?;
    init_schema(&conn)?;
    Ok(conn)
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS log_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            level TEXT NOT NULL,
            level_num INTEGER NOT NULL,
            target TEXT NOT NULL,
            message TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_log_entries_timestamp
            ON log_entries(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_log_entries_level_num_timestamp
            ON log_entries(level_num, timestamp DESC);",
    )
}

pub fn insert_log_entries(conn: &mut Connection, entries: &[NewLogEntry]) -> Result<()> {
    if entries.is_empty() {
        return Ok(());
    }

    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO log_entries (timestamp, level, level_num, target, message)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for entry in entries {
            stmt.execute(params![
                entry.timestamp,
                entry.level,
                entry.level_num,
                entry.target,
                entry.message,
            ])?;
        }
    }
    tx.commit()
}

pub fn list_logs(
    conn: &Connection,
    page: i64,
    level_num: Option<i64>,
    now: DateTime<Utc>,
) -> Result<LogPage> {
    let page = page.max(1);
    let offset = (page - 1) * LOG_PAGE_SIZE;
    let last_24h_cutoff = (now - Duration::hours(24)).to_rfc3339();
    let last_24h_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM log_entries WHERE timestamp >= ?1",
        params![last_24h_cutoff],
        |row| row.get(0),
    )?;
    let universe_size = last_24h_count.max(LOG_VIEWER_MIN_UNIVERSE);

    let total = if let Some(threshold) = level_num {
        conn.query_row(
            "SELECT COUNT(*) FROM (
                SELECT id, level_num
                FROM log_entries
                ORDER BY timestamp DESC, id DESC
                LIMIT ?1
            ) universe
            WHERE level_num >= ?2",
            params![universe_size, threshold],
            |row| row.get(0),
        )?
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM (
                SELECT id
                FROM log_entries
                ORDER BY timestamp DESC, id DESC
                LIMIT ?1
            ) universe",
            params![universe_size],
            |row| row.get(0),
        )?
    };

    let entries = if let Some(threshold) = level_num {
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, level, target, message
             FROM (
                SELECT id, timestamp, level, level_num, target, message
                FROM log_entries
                ORDER BY timestamp DESC, id DESC
                LIMIT ?1
             ) universe
             WHERE level_num >= ?2
             ORDER BY timestamp DESC, id DESC
             LIMIT ?3 OFFSET ?4",
        )?;
        let rows = stmt.query_map(
            params![universe_size, threshold, LOG_PAGE_SIZE, offset],
            map_log_row,
        )?;
        rows.collect::<Result<Vec<_>>>()?
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, level, target, message
             FROM (
                SELECT id, timestamp, level, target, message
                FROM log_entries
                ORDER BY timestamp DESC, id DESC
                LIMIT ?1
             ) universe
             ORDER BY timestamp DESC, id DESC
             LIMIT ?2 OFFSET ?3",
        )?;
        let rows = stmt.query_map(params![universe_size, LOG_PAGE_SIZE, offset], map_log_row)?;
        rows.collect::<Result<Vec<_>>>()?
    };

    Ok(LogPage {
        entries,
        total,
        page,
        page_size: LOG_PAGE_SIZE,
    })
}

pub fn export_logs_in_range(
    conn: &Connection,
    start_timestamp: &str,
    end_timestamp: &str,
) -> Result<Vec<LogEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, timestamp, level, target, message
         FROM log_entries
         WHERE timestamp >= ?1 AND timestamp <= ?2
         ORDER BY timestamp ASC, id ASC",
    )?;
    let rows = stmt.query_map(params![start_timestamp, end_timestamp], map_log_row)?;
    rows.collect::<Result<Vec<_>>>()
}

pub fn prune_logs(conn: &Connection, now: DateTime<Utc>) -> Result<usize> {
    let cutoff = (now - Duration::days(LOG_RETENTION_DAYS)).to_rfc3339();
    conn.execute(
        "DELETE FROM log_entries WHERE timestamp < ?1",
        params![cutoff],
    )
}

fn map_log_row(row: &rusqlite::Row<'_>) -> Result<LogEntry> {
    Ok(LogEntry {
        id: row.get(0)?,
        timestamp: row.get(1)?,
        level: row.get(2)?,
        target: row.get(3)?,
        message: row.get(4)?,
    })
}
