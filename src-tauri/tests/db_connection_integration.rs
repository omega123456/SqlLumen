//! On-disk `open_database` and basic SQLite connectivity (`db/connection.rs`).

use mysql_client_lib::db::connection::open_database;
use rusqlite::Connection;

fn unique_temp_path(prefix: &str, file_name: &str) -> std::path::PathBuf {
    let unique = format!(
        "{}_{}_{}",
        prefix,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );

    std::env::temp_dir().join(unique).join(file_name)
}

#[test]
fn test_in_memory_connection_works() {
    let conn = Connection::open_in_memory().expect("should open in-memory connection");
    let result: i64 = conn
        .query_row("SELECT 1", [], |row| row.get(0))
        .expect("should execute simple query");
    assert_eq!(result, 1);
}

#[test]
fn test_open_database_creates_parent_directory_and_supports_queries() {
    let db_path = unique_temp_path("db_open_parent", "nested/app.db");

    let conn =
        open_database(db_path.clone()).expect("should create parent directories and open db");
    let one: i64 = conn
        .query_row("SELECT 1", [], |row| row.get(0))
        .expect("should run a simple query");

    assert_eq!(one, 1);

    drop(conn);
    let root = db_path
        .parent()
        .and_then(|path| path.parent())
        .expect("test path should have a root directory")
        .to_path_buf();
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn test_open_database_enables_wal_mode() {
    let db_path = unique_temp_path("db_open_wal", "wal.db");

    let conn = open_database(db_path.clone()).expect("should open database");
    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode;", [], |row| row.get(0))
        .expect("should query journal mode");

    assert_eq!(journal_mode, "wal");

    drop(conn);
    if let Some(parent) = db_path.parent() {
        let _ = std::fs::remove_dir_all(parent);
    }
}

#[test]
fn test_open_database_returns_error_when_parent_path_is_a_file() {
    let blocker_path = unique_temp_path("db_open_blocker", "blocker");
    let blocker_parent = blocker_path
        .parent()
        .expect("blocker path should have a parent")
        .to_path_buf();
    std::fs::create_dir_all(&blocker_parent).expect("should create blocker parent directory");
    std::fs::write(&blocker_path, "not a directory").expect("should create blocker file");

    let result = open_database(blocker_path.join("child").join("app.db"));

    assert!(
        result.is_err(),
        "should fail when a required parent path is a file"
    );

    let _ = std::fs::remove_dir_all(blocker_parent);
}
