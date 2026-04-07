//! `initialize_database` and app bootstrap against a real temp directory + on-disk SQLite.

mod common;

use sqllumen_lib::initialize_database;
use rusqlite::Connection;

#[test]
fn test_initialize_database_succeeds() {
    let (app_data_dir, _) = common::unique_temp_dir("test_init_db");

    let result = initialize_database(&app_data_dir);
    assert!(result.is_ok(), "initialize_database should succeed");

    let conn = result.unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='settings'",
            [],
            |row| row.get(0),
        )
        .expect("should query sqlite_master");
    assert_eq!(count, 1);

    drop(conn);
    let _ = std::fs::remove_dir_all(&app_data_dir);
}

#[test]
fn test_initialize_database_runs_all_migrations() {
    let (app_data_dir, _) = common::unique_temp_dir("test_init_mig");

    let conn = initialize_database(&app_data_dir).expect("should initialize");

    for table in &[
        "settings",
        "connections",
        "connection_groups",
        "_migrations",
    ] {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |row| row.get(0),
            )
            .expect("should query sqlite_master");
        assert_eq!(count, 1, "table '{}' should exist", table);
    }

    drop(conn);
    let _ = std::fs::remove_dir_all(&app_data_dir);
}

#[test]
fn test_initialize_database_enables_wal_mode() {
    let (app_data_dir, _) = common::unique_temp_dir("test_init_wal");

    let conn = initialize_database(&app_data_dir).expect("should initialize");

    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode;", [], |row| row.get(0))
        .expect("should query journal_mode");
    assert_eq!(journal_mode, "wal");

    drop(conn);
    let _ = std::fs::remove_dir_all(&app_data_dir);
}

#[test]
fn test_initialize_database_is_idempotent() {
    let (app_data_dir, _) = common::unique_temp_dir("test_init_idem");

    let conn1 = initialize_database(&app_data_dir).expect("first init should succeed");
    conn1
        .execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('test_key', 'test_value')",
            [],
        )
        .expect("should insert");
    drop(conn1);

    let conn2 = initialize_database(&app_data_dir).expect("second init should succeed");
    let value: String = conn2
        .query_row(
            "SELECT value FROM settings WHERE key = 'test_key'",
            [],
            |row| row.get(0),
        )
        .expect("should find previously inserted value");
    assert_eq!(value, "test_value");

    drop(conn2);
    let _ = std::fs::remove_dir_all(&app_data_dir);
}

#[test]
fn test_initialize_database_surfaces_open_database_errors() {
    let (app_data_dir, _) = common::unique_temp_dir("test_init_open_err");
    std::fs::create_dir_all(&app_data_dir).expect("should create parent dir");
    let blocker = app_data_dir.join("blocked");
    std::fs::write(&blocker, "not a directory").expect("should create blocker file");

    let error = initialize_database(&blocker).expect_err("should surface open failures");

    assert!(error.starts_with("failed to open SQLite database:"));
    let _ = std::fs::remove_dir_all(&app_data_dir);
}

#[test]
fn test_initialize_database_surfaces_migration_errors() {
    let (app_data_dir, _) = common::unique_temp_dir("test_init_migration_err");
    std::fs::create_dir_all(&app_data_dir).expect("should create app data dir");
    let db_path = app_data_dir.join("sqllumen.db");
    let conn = Connection::open(&db_path).expect("should create database file");
    conn.execute("CREATE TABLE _migrations (bad INTEGER)", [])
        .expect("should create incompatible migrations table");
    drop(conn);

    let error = initialize_database(&app_data_dir).expect_err("should surface migration failures");

    assert!(error.starts_with("failed to run database migrations:"));
    let _ = std::fs::remove_dir_all(&app_data_dir);
}
