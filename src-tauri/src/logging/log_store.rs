use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::db::migrations::{run_log_migrations, MIGRATION_VACUUM_STATE_LOGS};

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

/// Open the logs database with its standard pragmas, creating the parent
/// directory if needed.
///
/// This is the shared base used by both the one-time initializer and the
/// log-writer thread. It performs ONLY directory creation, `Connection::open`,
/// and pragma setup (WAL, synchronous, busy_timeout) — it does NOT run
/// migrations. Callers that open the database after [`initialize_log_database`]
/// has run (e.g. the writer thread) get a plain connection on an
/// already-migrated database.
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
    Ok(conn)
}

/// Initialize the logs database, returning a ready reader connection.
///
/// Opens the database with its standard pragmas (via [`open_log_database`]),
/// runs all pending log migrations, and — when the `002_vacuum_state` migration
/// is newly applied — performs the one-time
/// `PRAGMA auto_vacuum=INCREMENTAL; VACUUM;` conversion outside any transaction
/// (SQLite forbids `VACUUM` inside a transaction, and the migration runner wraps
/// each migration in one).
///
/// This must be called once, before any other code opens the logs database
/// (in particular before the log-writer thread), so migrations and the
/// conversion happen exactly once on a single connection with no concurrency.
pub fn initialize_log_database(path: impl AsRef<Path>) -> Result<Connection> {
    let mut conn = open_log_database(path.as_ref())?;

    let applied = run_log_migrations(&mut conn).map_err(rusqlite::Error::InvalidParameterName)?;

    // When the vacuum-state migration is first applied, convert the database to
    // incremental auto-vacuum mode. Enabling incremental auto-vacuum on an
    // existing database requires a full VACUUM to take effect. VACUUM is illegal
    // inside a transaction, so this runs here in initialization code rather than
    // in migration SQL.
    if applied
        .iter()
        .any(|&version| version == MIGRATION_VACUUM_STATE_LOGS)
    {
        tracing::info!(
            "logs migration 002 newly applied; converting logs database to incremental auto-vacuum"
        );
        crate::db::vacuum::convert_to_incremental_vacuum(&conn, "logs database");
    }

    Ok(conn)
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
