use rusqlite::{Connection, Result};
use std::path::PathBuf;

/// Opens or creates the SQLite database at the given path.
/// Enables WAL journal mode for better concurrent performance.
pub fn open_database(db_path: PathBuf) -> Result<Connection> {
    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            rusqlite::Error::InvalidParameterName(format!(
                "Failed to create database directory '{}': {e}",
                parent.display()
            ))
        })?;
    }

    let conn = Connection::open(&db_path)?;

    // Enable WAL mode for better concurrent performance
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;

    Ok(conn)
}
