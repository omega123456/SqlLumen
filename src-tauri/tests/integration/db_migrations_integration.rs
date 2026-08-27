//! Migration runner (`db/migrations.rs`) — refinery-backed main DB path with
//! one-time cutover from the legacy `_migrations` tracking table.

use refinery::Target;
use sqllumen_lib::db::migrations::run_migrations;

use crate::common::{history_count, seed_legacy_migrations, table_exists, test_conn};

mod embedded_main {
    use refinery::embed_migrations;
    embed_migrations!("migrations/main");
}

#[test]
fn test_run_migrations_creates_refinery_history_table() {
    let mut conn = test_conn();
    run_migrations(&mut conn).expect("should run migrations without error");

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='refinery_schema_history'",
            [],
            |row| row.get(0),
        )
        .expect("should query sqlite_master");

    assert_eq!(count, 1);
    assert!(
        !table_exists(&conn, "_migrations"),
        "no legacy _migrations table on a fresh install"
    );
}

#[test]
fn test_run_migrations_records_initial_migration() {
    let mut conn = test_conn();
    run_migrations(&mut conn).expect("should run migrations");

    let name: String = conn
        .query_row(
            "SELECT name FROM refinery_schema_history WHERE version = 1",
            [],
            |row| row.get(0),
        )
        .expect("should find version 1 in refinery_schema_history");

    // refinery's name() is the part after `V1__`, so `V1__initial.sql` => "initial".
    assert_eq!(name, "initial");
}

#[test]
fn test_run_migrations_creates_settings_table() {
    let mut conn = test_conn();
    run_migrations(&mut conn).expect("should run migrations");

    assert!(table_exists(&conn, "settings"));
}

#[test]
fn test_run_migrations_creates_connections_table() {
    let mut conn = test_conn();
    run_migrations(&mut conn).expect("should run migrations");

    assert!(table_exists(&conn, "connections"));
}

#[test]
fn test_run_migrations_creates_connection_groups_table() {
    let mut conn = test_conn();
    run_migrations(&mut conn).expect("should run migrations");

    assert!(table_exists(&conn, "connection_groups"));
}

#[test]
fn test_run_migrations_applies_v14_vacuum_state() {
    let mut conn = test_conn();
    run_migrations(&mut conn).expect("should run migrations");

    let name: String = conn
        .query_row(
            "SELECT name FROM refinery_schema_history WHERE version = 14",
            [],
            |row| row.get(0),
        )
        .expect("should find version 14 in refinery_schema_history");
    assert_eq!(name, "vacuum_state");

    assert!(
        table_exists(&conn, "_vacuum_state"),
        "_vacuum_state table should exist"
    );

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
    let mut conn = test_conn();
    run_migrations(&mut conn).expect("first run should succeed");
    let second = run_migrations(&mut conn).expect("second run should also succeed (idempotent)");

    assert!(
        second.is_empty(),
        "second run applies nothing on an up-to-date DB"
    );
    assert_eq!(history_count(&conn), 14);
}

// ---------------------------------------------------------------------------
// Cutover state machine
// ---------------------------------------------------------------------------

/// (a) Fresh install: refinery applies everything, history is fully populated,
/// no legacy table remains.
#[test]
fn test_cutover_fresh_install_applies_all_14() {
    let mut conn = test_conn();
    let applied = run_migrations(&mut conn).expect("fresh install should run all migrations");

    assert_eq!(applied, (1..=14).collect::<Vec<i32>>());
    assert_eq!(history_count(&conn), 14);
    assert!(!table_exists(&conn, "_migrations"));
}

/// (b) Partial legacy upgrade: a real schema built up to V12 plus a legacy
/// `_migrations` listing versions 1..12. `run_migrations` fakes 1..12 (their
/// SQL is NOT re-executed) and really applies 13 + 14, drops `_migrations`, and
/// returns exactly `[13, 14]`.
#[test]
fn test_cutover_partial_legacy_upgrade() {
    let mut conn = test_conn();

    // Build a genuine schema through V12 with refinery's history populated.
    embedded_main::migrations::runner()
        .set_target(Target::Version(12))
        .run(&mut conn)
        .expect("run to V12");
    assert_eq!(history_count(&conn), 12);

    // Drop refinery history so this looks like a legacy-only install, and write
    // a legacy `_migrations` table reflecting versions 1..12 as applied.
    conn.execute_batch("DROP TABLE refinery_schema_history;")
        .expect("drop refinery history");
    seed_legacy_migrations(
        &conn,
        &[
            "001_initial",
            "002_connection_timeouts",
            "003_history_favorites",
            "004_fix_history_favorites_schema",
            "005_schema_index",
            "006_schema_index_signatures",
            "007_schema_index_content_redesign",
            "008_schema_index_segment_df",
            "009_ai_memory",
            "010_schema_cache",
            "011_ai_memory_multi_level",
            "012_session_snapshots",
        ],
    );

    // Sentinel in a table created by migration V1 — if migration 1 were
    // re-executed its `CREATE TABLE` would not drop existing rows, but the fake
    // path guarantees no SQL runs at all, so the row must survive untouched.
    conn.execute(
        "INSERT INTO connection_groups (id, name, created_at) VALUES (?1, ?2, '0')",
        rusqlite::params!["sentinel-id", "sentinel-group"],
    )
    .expect("seed sentinel row");

    let applied = run_migrations(&mut conn).expect("legacy upgrade should succeed");

    assert_eq!(applied, vec![13, 14], "only 13 and 14 applied for real");
    assert_eq!(history_count(&conn), 14, "history fully populated");
    assert!(!table_exists(&conn, "_migrations"), "legacy table dropped");

    let sentinel: String = conn
        .query_row(
            "SELECT name FROM connection_groups WHERE id = 'sentinel-id'",
            [],
            |row| row.get(0),
        )
        .expect("sentinel row should survive (1..12 not re-executed)");
    assert_eq!(sentinel, "sentinel-group");
}

/// (c) Fully-current legacy upgrade: legacy `_migrations` lists all 14. Fake all,
/// apply none, return empty, drop `_migrations`.
#[test]
fn test_cutover_fully_current_legacy() {
    let mut conn = test_conn();

    // Build a complete real schema, then strip refinery history and present a
    // full legacy `_migrations` table.
    run_migrations(&mut conn).expect("initial run");
    conn.execute_batch("DROP TABLE refinery_schema_history;")
        .expect("drop refinery history");
    seed_legacy_migrations(
        &conn,
        &[
            "001_initial",
            "002_connection_timeouts",
            "003_history_favorites",
            "004_fix_history_favorites_schema",
            "005_schema_index",
            "006_schema_index_signatures",
            "007_schema_index_content_redesign",
            "008_schema_index_segment_df",
            "009_ai_memory",
            "010_schema_cache",
            "011_ai_memory_multi_level",
            "012_session_snapshots",
            "013_connection_cascade_cleanup",
            "014_vacuum_state",
        ],
    );

    let applied = run_migrations(&mut conn).expect("fully-current legacy should succeed");

    assert!(applied.is_empty(), "nothing applied for real");
    assert_eq!(history_count(&conn), 14);
    assert!(!table_exists(&conn, "_migrations"));
}

/// (d) Already on refinery with a stray `_migrations` present: the stray is
/// dropped, no fake seed occurs (history already populated), nothing new is
/// applied.
#[test]
fn test_cutover_already_on_refinery_drops_stray_legacy() {
    let mut conn = test_conn();
    run_migrations(&mut conn).expect("initial run");

    // A stray legacy table somehow present alongside a populated history.
    seed_legacy_migrations(&conn, &["001_initial"]);

    let applied = run_migrations(&mut conn).expect("should succeed and drop the stray");

    assert!(applied.is_empty());
    assert_eq!(history_count(&conn), 14);
    assert!(!table_exists(&conn, "_migrations"), "stray dropped");
}

/// (e) Empty / garbage legacy table: no parseable watermark, so the fake step is
/// skipped and refinery real-runs everything.
#[test]
fn test_cutover_empty_legacy_runs_all() {
    let mut conn = test_conn();

    // Legacy table exists but only holds an unparseable name — no watermark.
    conn.execute_batch(
        "CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);",
    )
    .expect("create empty legacy table");
    conn.execute(
        "INSERT INTO _migrations (name, applied_at) VALUES ('garbage', '0')",
        [],
    )
    .expect("insert garbage row");

    let applied = run_migrations(&mut conn).expect("empty/garbage legacy should run all");

    assert_eq!(applied, (1..=14).collect::<Vec<i32>>());
    assert_eq!(history_count(&conn), 14);
    assert!(!table_exists(&conn, "_migrations"));
}

/// (f) Error path: a corrupt legacy `_migrations` table missing the `name`
/// column makes the watermark read fail; the error is mapped to a `String` with
/// context rather than silently swallowed.
#[test]
fn test_cutover_corrupt_legacy_returns_error() {
    let mut conn = test_conn();

    // `_migrations` exists but lacks the `name` column the watermark read needs.
    conn.execute_batch("CREATE TABLE _migrations (bad INTEGER);")
        .expect("create corrupt legacy table");

    let err = run_migrations(&mut conn).expect_err("corrupt legacy table should error");
    assert!(
        err.contains("main migration error"),
        "error carries DB/operation context, got: {err}"
    );
}
