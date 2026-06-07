//! Connection-agnostic incremental-vacuum maintenance for any SQLite database
//! carrying a `_vacuum_state` table.
//!
//! The routine reads the per-database `last_vacuum_at` timestamp, decides whether
//! the database is due for an incremental vacuum relative to an injected "now",
//! drains the free list via `PRAGMA incremental_vacuum(0)` when stale, and updates
//! the timestamp. "Now" is injected so the decision is deterministic in tests.

use rusqlite::{Connection, OptionalExtension, Result};

/// Staleness threshold after which a database is considered due for an
/// incremental vacuum (6 hours, in seconds). This value serves a dual purpose:
/// it is both the staleness threshold for [`vacuum_if_stale`] and the period of
/// the recurring maintenance timer in `lib.rs`.
pub const VACUUM_STALENESS_SECS: u64 = 6 * 60 * 60;

/// The `_vacuum_state` key holding the last-vacuum Unix timestamp (seconds).
const LAST_VACUUM_AT_KEY: &str = "last_vacuum_at";

/// One-time conversion of a database to incremental auto-vacuum mode.
///
/// Runs `PRAGMA auto_vacuum=INCREMENTAL; VACUUM;` (the full VACUUM is required
/// for the auto-vacuum mode change to take effect on an existing database), then
/// reads the mode back to confirm it is `2` (INCREMENTAL). This function never
/// fails: every error is absorbed with a `tracing::error!` log line so callers
/// can invoke it as a plain statement during startup without risking an abort.
pub(crate) fn convert_to_incremental_vacuum(conn: &Connection, db_label: &str) {
    if let Err(error) = conn.execute_batch("PRAGMA auto_vacuum=INCREMENTAL; VACUUM;") {
        tracing::error!(
            error = ?error,
            db = db_label,
            "one-time incremental auto-vacuum conversion failed"
        );
    }

    match conn.query_row("PRAGMA auto_vacuum;", [], |row| row.get::<_, i64>(0)) {
        Ok(mode) if mode != 2 => {
            tracing::error!(
                auto_vacuum = mode,
                db = db_label,
                "database auto_vacuum is not INCREMENTAL (2) after conversion"
            );
        }
        Ok(_) => {}
        Err(error) => {
            tracing::error!(
                error = ?error,
                db = db_label,
                "failed to read back auto_vacuum after conversion"
            );
        }
    }
}

/// Read `last_vacuum_at` from `_vacuum_state`. Returns 0 if the row is missing
/// or its value cannot be parsed as a `u64`.
fn get_last_vacuum_at(conn: &Connection) -> Result<u64> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM _vacuum_state WHERE key = ?1",
            [LAST_VACUUM_AT_KEY],
            |row| row.get(0),
        )
        .optional()?;

    Ok(raw.and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(0))
}

/// Update the `last_vacuum_at` row in `_vacuum_state` with the given timestamp.
fn set_last_vacuum_at(conn: &Connection, ts: u64) -> Result<()> {
    conn.execute(
        "UPDATE _vacuum_state SET value = ?1 WHERE key = ?2",
        rusqlite::params![ts.to_string(), LAST_VACUUM_AT_KEY],
    )?;
    Ok(())
}

/// Evaluate staleness against the supplied `now` (Unix seconds). When the
/// database is stale (or has never been vacuumed), drain the free list via
/// `PRAGMA incremental_vacuum(0)`, update `last_vacuum_at` to `now`, and return
/// `Ok(true)`. Otherwise return `Ok(false)` without vacuuming.
///
/// Errors from `incremental_vacuum` are propagated as `Err`; the caller is
/// responsible for the log-and-skip policy. Successful vacuums are logged here.
pub fn vacuum_if_stale(conn: &Connection, now: u64) -> Result<bool> {
    let last = get_last_vacuum_at(conn)?;

    let stale = last == 0 || now.saturating_sub(last) >= VACUUM_STALENESS_SECS;
    if !stale {
        return Ok(false);
    }

    // `PRAGMA incremental_vacuum(0)` yields one row per reclaimed page; the
    // statement must be stepped to completion to drain the whole free list.
    // `execute_batch` stops after the first step, so prepare and exhaust the
    // rows explicitly.
    {
        let mut stmt = conn.prepare("PRAGMA incremental_vacuum(0)")?;
        let mut rows = stmt.query([])?;
        while rows.next()?.is_some() {}
    }
    set_last_vacuum_at(conn, now)?;
    tracing::info!(now, last_vacuum_at = last, "incremental vacuum performed");

    Ok(true)
}
