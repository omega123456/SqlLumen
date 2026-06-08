//! Logs-database migration runner (`db/migrations.rs::run_log_migrations`) —
//! refinery-backed logs DB path with one-time cutover from the legacy
//! `_migrations` tracking table.

use rusqlite::Connection;
use sqllumen_lib::db::migrations::run_log_migrations;

mod common;
use common::{history_count, seed_legacy_migrations, table_exists, test_conn};

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
    let mut conn = test_conn();
    let applied = run_log_migrations(&mut conn).expect("should run log migrations");

    assert_eq!(applied, vec![1, 2]);

    assert!(
        table_exists(&conn, "log_entries"),
        "log_entries should exist"
    );
    assert!(
        table_exists(&conn, "_vacuum_state"),
        "_vacuum_state should exist"
    );
    assert!(
        table_exists(&conn, "refinery_schema_history"),
        "refinery_schema_history should exist"
    );
    assert!(
        !table_exists(&conn, "_migrations"),
        "no legacy _migrations table on a fresh install"
    );
    assert!(index_exists(&conn, "idx_log_entries_timestamp"));
    assert!(index_exists(&conn, "idx_log_entries_level_num_timestamp"));

    assert_eq!(history_count(&conn), 2);

    // refinery's name() is the part after `V{n}__`.
    let v1_name: String = conn
        .query_row(
            "SELECT name FROM refinery_schema_history WHERE version = 1",
            [],
            |row| row.get(0),
        )
        .expect("should find version 1");
    assert_eq!(v1_name, "initial_schema");

    let v2_name: String = conn
        .query_row(
            "SELECT name FROM refinery_schema_history WHERE version = 2",
            [],
            |row| row.get(0),
        )
        .expect("should find version 2");
    assert_eq!(v2_name, "vacuum_state");

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
    let mut conn = test_conn();
    let first = run_log_migrations(&mut conn).expect("first run should succeed");
    assert!(!first.is_empty(), "first run should apply migrations");

    let second = run_log_migrations(&mut conn).expect("second run should succeed");
    assert!(
        second.is_empty(),
        "second run should apply nothing (idempotent)"
    );

    assert_eq!(history_count(&conn), 2);
}

#[test]
fn test_run_log_migrations_non_destructive_on_pre_existing_log_entries() {
    let mut conn = test_conn();

    // Simulate a pre-existing logs database whose schema was created by the old
    // ad-hoc init path, holding data, with no tracking table yet. V1's
    // `CREATE TABLE IF NOT EXISTS` makes a real run safe over existing tables.
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

    let applied =
        run_log_migrations(&mut conn).expect("should run log migrations on existing schema");
    assert_eq!(applied, vec![1, 2]);

    // Pre-existing data must survive.
    let row_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM log_entries", [], |row| row.get(0))
        .expect("should count log_entries rows");
    assert_eq!(row_count, 1, "pre-existing rows must be preserved");

    assert!(table_exists(&conn, "_vacuum_state"));
}

// ---------------------------------------------------------------------------
// Cutover state machine
// ---------------------------------------------------------------------------

/// (a) Fresh install: refinery applies both migrations, history fully populated,
/// no legacy table remains.
#[test]
fn test_cutover_fresh_install_applies_both() {
    let mut conn = test_conn();
    let applied = run_log_migrations(&mut conn).expect("fresh install should run all migrations");

    assert_eq!(applied, vec![1, 2]);
    assert_eq!(history_count(&conn), 2);
    assert!(!table_exists(&conn, "_migrations"));
    assert!(table_exists(&conn, "log_entries"));
    assert!(table_exists(&conn, "_vacuum_state"));
}

/// (b) Partial legacy upgrade: a real schema built up to V1 plus a legacy
/// `_migrations` listing only `001_initial_schema`. `run_log_migrations` fakes
/// version 1 (its SQL is NOT re-executed) and really applies version 2, drops
/// `_migrations`, and returns exactly `[2]`.
#[test]
fn test_cutover_partial_legacy_upgrade() {
    let mut conn = test_conn();

    // Build a genuine logs schema as if only the first legacy migration ran.
    conn.execute_batch(
        "CREATE TABLE log_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            level TEXT NOT NULL,
            level_num INTEGER NOT NULL,
            target TEXT NOT NULL,
            message TEXT NOT NULL
        );
        CREATE INDEX idx_log_entries_timestamp ON log_entries(timestamp DESC);
        CREATE INDEX idx_log_entries_level_num_timestamp
            ON log_entries(level_num, timestamp DESC);",
    )
    .expect("pre-create v1 schema");

    // Sentinel row — if migration V1 were re-executed it would not drop rows, but
    // the fake path guarantees no SQL runs at all, so the row must survive.
    conn.execute(
        "INSERT INTO log_entries (timestamp, level, level_num, target, message)
         VALUES ('2026-06-07T00:00:00Z', 'INFO', 30, 'sentinel', 'survivor')",
        [],
    )
    .expect("seed sentinel row");

    seed_legacy_migrations(&conn, &["001_initial_schema"]);

    let applied = run_log_migrations(&mut conn).expect("legacy upgrade should succeed");

    assert_eq!(applied, vec![2], "only version 2 applied for real");
    assert_eq!(history_count(&conn), 2, "history fully populated");
    assert!(!table_exists(&conn, "_migrations"), "legacy table dropped");
    assert!(table_exists(&conn, "_vacuum_state"));

    let survivors: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM log_entries WHERE target = 'sentinel'",
            [],
            |row| row.get(0),
        )
        .expect("sentinel row should survive (version 1 not re-executed)");
    assert_eq!(survivors, 1);
}

/// (c) Fully-current legacy upgrade: legacy `_migrations` lists both migrations.
/// Fake both, apply none, return empty, drop `_migrations`.
#[test]
fn test_cutover_fully_current_legacy() {
    let mut conn = test_conn();

    // Build a complete real schema, then strip refinery history and present a
    // full legacy `_migrations` table.
    run_log_migrations(&mut conn).expect("initial run");
    conn.execute_batch("DROP TABLE refinery_schema_history;")
        .expect("drop refinery history");
    seed_legacy_migrations(&conn, &["001_initial_schema", "002_vacuum_state"]);

    let applied = run_log_migrations(&mut conn).expect("fully-current legacy should succeed");

    assert!(applied.is_empty(), "nothing applied for real");
    assert_eq!(history_count(&conn), 2);
    assert!(!table_exists(&conn, "_migrations"));
}

/// (d) Empty / garbage legacy table: no parseable watermark, so the fake step is
/// skipped and refinery real-runs everything; the legacy table is dropped.
#[test]
fn test_cutover_empty_legacy_runs_all() {
    let mut conn = test_conn();

    conn.execute_batch(
        "CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);",
    )
    .expect("create empty legacy table");
    conn.execute(
        "INSERT INTO _migrations (name, applied_at) VALUES ('garbage', '0')",
        [],
    )
    .expect("insert garbage row");

    let applied = run_log_migrations(&mut conn).expect("empty/garbage legacy should run all");

    assert_eq!(applied, vec![1, 2]);
    assert_eq!(history_count(&conn), 2);
    assert!(!table_exists(&conn, "_migrations"));
}
