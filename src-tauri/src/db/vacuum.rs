use rusqlite::{Connection, OptionalExtension, Result};
use std::time::Duration;

const VACUUM_STALENESS_HOURS: u64 = 6;
pub const VACUUM_STALENESS_SECS: u64 = Duration::from_hours(VACUUM_STALENESS_HOURS).as_secs();

const LAST_VACUUM_AT_KEY: &str = "last_vacuum_at";

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

fn get_last_vacuum_at(conn: &Connection) -> Result<u64> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM _vacuum_state WHERE key = ?1",
            [LAST_VACUUM_AT_KEY],
            |row| row.get(0),
        )
        .optional()?;

    Ok(raw
        .and_then(|text| text.trim().parse::<u64>().ok())
        .unwrap_or(0))
}

fn set_last_vacuum_at(conn: &Connection, ts: u64) -> Result<()> {
    conn.execute(
        "UPDATE _vacuum_state SET value = ?1 WHERE key = ?2",
        rusqlite::params![ts.to_string(), LAST_VACUUM_AT_KEY],
    )?;
    Ok(())
}

pub fn vacuum_if_stale(conn: &Connection, now: u64) -> Result<bool> {
    let last = get_last_vacuum_at(conn)?;

    let stale = last == 0 || now.saturating_sub(last) >= VACUUM_STALENESS_SECS;
    if !stale {
        return Ok(false);
    }

    {
        let mut stmt = conn.prepare("PRAGMA incremental_vacuum(0)")?;
        let mut rows = stmt.query([])?;
        while rows.next()?.is_some() {}
    }
    set_last_vacuum_at(conn, now)?;
    tracing::info!(now, last_vacuum_at = last, "incremental vacuum performed");

    Ok(true)
}
