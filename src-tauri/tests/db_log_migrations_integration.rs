//! Logs-database migration runner (`db/migrations.rs::run_log_migrations`).

use rusqlite::Connection;
use sqllumen_lib::db::migrations::run_log_migrations;

fn test_conn() -> Connection {
    Connection::open_in_memory().expect("should open in-memory connection")
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [name],
            |row| row.get(0),
        )
        .expect("should query sqlite_master");
    count == 1
}

fn index_exists(conn: &Connection, name: &str) -> bool {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
            [name],
            |row| row.get(0),
        )
        .expect("should query sqlite_master");
    count == 1
}

#[test]
fn test_run_log_migrations_applies_both_migrations() {
    let conn = test_conn();
    let applied = run_log_migrations(&conn).expect("should run log migrations");

    assert_eq!(
        applied,
        vec![
            "001_initial_schema".to_string(),
            "002_vacuum_state".to_string()
        ]
    );

    assert!(table_exists(&conn, "log_entries"), "log_entries should exist");
    assert!(
        table_exists(&conn, "_vacuum_state"),
        "_vacuum_state should exist"
    );
    assert!(table_exists(&conn, "_migrations"), "_migrations should exist");
    assert!(index_exists(&conn, "idx_log_entries_timestamp"));
    assert!(index_exists(&conn, "idx_log_entries_level_num_timestamp"));

    let migration_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
        .expect("should count _migrations rows");
    assert_eq!(migration_count, 2);

    let seeded: String = conn
        .query_row(
            "SELECT value FROM _vacuum_state WHERE key='last_vacuum_at'",
            [],
            |row| row.get(0),
        )
        .expect("should find seeded last_vacuum_at");
    assert_eq!(seeded, "0");
}

#[test]
fn test_run_log_migrations_is_idempotent() {
    let conn = test_conn();
    let first = run_log_migrations(&conn).expect("first run should succeed");
    assert!(!first.is_empty(), "first run should apply migrations");

    let second = run_log_migrations(&conn).expect("second run should succeed");
    assert!(
        second.is_empty(),
        "second run should apply nothing (idempotent)"
    );

    let migration_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
        .expect("should count _migrations rows");
    assert_eq!(migration_count, 2);
}

#[test]
fn test_run_log_migrations_non_destructive_on_pre_existing_log_entries() {
    let conn = test_conn();

    // Simulate a pre-existing logs database whose schema was created by the old
    // ad-hoc init path, holding data, with no `_migrations` table yet.
    conn.execute_batch(
        "CREATE TABLE log_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            level TEXT NOT NULL,
            level_num INTEGER NOT NULL,
            target TEXT NOT NULL,
            message TEXT NOT NULL
        );",
    )
    .expect("should pre-create log_entries");
    conn.execute(
        "INSERT INTO log_entries (timestamp, level, level_num, target, message)
         VALUES ('2026-06-07T00:00:00Z', 'INFO', 30, 'test', 'hello')",
        [],
    )
    .expect("should insert pre-existing row");

    let applied = run_log_migrations(&conn).expect("should run log migrations on existing schema");
    assert_eq!(
        applied,
        vec![
            "001_initial_schema".to_string(),
            "002_vacuum_state".to_string()
        ]
    );

    // Pre-existing data must survive.
    let row_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM log_entries", [], |row| row.get(0))
        .expect("should count log_entries rows");
    assert_eq!(row_count, 1, "pre-existing rows must be preserved");

    assert!(table_exists(&conn, "_vacuum_state"));
}
