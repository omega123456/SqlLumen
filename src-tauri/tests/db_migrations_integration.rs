//! Migration runner (`db/migrations.rs`).

use rusqlite::Connection;
use sqllumen_lib::db::migrations::run_migrations;

fn test_conn() -> Connection {
    Connection::open_in_memory().expect("should open in-memory connection")
}

#[test]
fn test_run_migrations_creates_migrations_table() {
    let conn = test_conn();
    run_migrations(&conn).expect("should run migrations without error");

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_migrations'",
            [],
            |row| row.get(0),
        )
        .expect("should query sqlite_master");

    assert_eq!(count, 1);
}

#[test]
fn test_run_migrations_applies_initial_migration() {
    let conn = test_conn();
    run_migrations(&conn).expect("should run migrations");

    let applied: String = conn
        .query_row(
            "SELECT name FROM _migrations WHERE name = '001_initial'",
            [],
            |row| row.get(0),
        )
        .expect("should find 001_initial in _migrations");

    assert_eq!(applied, "001_initial");
}

#[test]
fn test_run_migrations_creates_settings_table() {
    let conn = test_conn();
    run_migrations(&conn).expect("should run migrations");

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='settings'",
            [],
            |row| row.get(0),
        )
        .expect("should query sqlite_master");

    assert_eq!(count, 1);
}

#[test]
fn test_run_migrations_creates_connections_table() {
    let conn = test_conn();
    run_migrations(&conn).expect("should run migrations");

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='connections'",
            [],
            |row| row.get(0),
        )
        .expect("should query sqlite_master");

    assert_eq!(count, 1);
}

#[test]
fn test_run_migrations_creates_connection_groups_table() {
    let conn = test_conn();
    run_migrations(&conn).expect("should run migrations");

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='connection_groups'",
            [],
            |row| row.get(0),
        )
        .expect("should query sqlite_master");

    assert_eq!(count, 1);
}

#[test]
fn test_run_migrations_applies_014_vacuum_state() {
    let conn = test_conn();
    run_migrations(&conn).expect("should run migrations");

    let applied: String = conn
        .query_row(
            "SELECT name FROM _migrations WHERE name = '014_vacuum_state'",
            [],
            |row| row.get(0),
        )
        .expect("should find 014_vacuum_state in _migrations");
    assert_eq!(applied, "014_vacuum_state");

    let table_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_vacuum_state'",
            [],
            |row| row.get(0),
        )
        .expect("should query sqlite_master");
    assert_eq!(table_count, 1, "_vacuum_state table should exist");

    let seeded: String = conn
        .query_row(
            "SELECT value FROM _vacuum_state WHERE key='last_vacuum_at'",
            [],
            |row| row.get(0),
        )
        .expect("should find seeded last_vacuum_at row");
    assert_eq!(seeded, "0");
}

#[test]
fn test_run_migrations_is_idempotent() {
    let conn = test_conn();
    run_migrations(&conn).expect("first run should succeed");
    run_migrations(&conn).expect("second run should also succeed (idempotent)");

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM _migrations WHERE name = '001_initial'",
            [],
            |row| row.get(0),
        )
        .expect("should query _migrations count");

    assert_eq!(count, 1);
}
