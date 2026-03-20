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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_in_memory_connection_works() {
        let conn = Connection::open_in_memory().expect("should open in-memory connection");
        // Verify basic SQLite operation works
        let result: i64 = conn
            .query_row("SELECT 1", [], |row| row.get(0))
            .expect("should execute simple query");
        assert_eq!(result, 1);
    }

    #[test]
    fn test_wal_mode_is_enabled() {
        let dir = std::env::temp_dir();
        let db_path = dir.join(format!(
            "test_wal_{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));

        let conn = open_database(db_path.clone()).expect("should open database");

        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode;", [], |row| row.get(0))
            .expect("should query journal_mode");

        assert_eq!(journal_mode, "wal");

        // Cleanup
        drop(conn);
        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_file(db_path.with_extension("db-wal"));
        let _ = std::fs::remove_file(db_path.with_extension("db-shm"));
    }

    #[test]
    fn test_creates_parent_directory() {
        let dir = std::env::temp_dir();
        let unique_name = format!(
            "test_mkdir_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let nested_path = dir.join(&unique_name).join("app.db");

        let conn = open_database(nested_path.clone());
        assert!(
            conn.is_ok(),
            "should create parent directories and open database"
        );

        // Cleanup
        drop(conn);
        let _ = std::fs::remove_dir_all(dir.join(&unique_name));
    }

    #[test]
    fn test_open_database_fails_when_parent_is_a_file() {
        let dir = std::env::temp_dir();
        let blocker_name = format!(
            "test_blocker_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let blocker_path = dir.join(&blocker_name);

        // Create a FILE at the path where a directory is needed
        std::fs::write(&blocker_path, "not a directory").expect("should create blocker file");

        // Try to open a database inside this "file" — create_dir_all should fail
        let db_path = blocker_path.join("subdir").join("test.db");
        let result = open_database(db_path);
        assert!(result.is_err(), "should fail when parent path is a file");

        // Cleanup
        let _ = std::fs::remove_file(&blocker_path);
    }
}
