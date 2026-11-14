use rusqlite::{Connection, Result};
use std::path::PathBuf;

pub fn open_database(db_path: PathBuf) -> Result<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            rusqlite::Error::InvalidParameterName(format!(
                "Failed to create database directory '{}': {error}",
                parent.display()
            ))
        })?;
    }

    let conn = Connection::open(&db_path)?;

    conn.execute_batch("PRAGMA journal_mode=WAL;")?;

    Ok(conn)
}
