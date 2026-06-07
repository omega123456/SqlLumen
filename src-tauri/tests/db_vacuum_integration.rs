//! Vacuum core (`db/vacuum.rs`).

use rusqlite::Connection;
use sqllumen_lib::db::vacuum::{vacuum_if_stale, VACUUM_STALENESS_SECS};

/// Open an in-memory connection with a seeded `_vacuum_state` table.
fn conn_with_vacuum_state(last_vacuum_at: &str) -> Connection {
    let conn = Connection::open_in_memory().expect("should open in-memory connection");
    conn.execute_batch(
        "CREATE TABLE _vacuum_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         INSERT INTO _vacuum_state (key, value) VALUES ('last_vacuum_at', '0');",
    )
    .expect("should create _vacuum_state");
    conn.execute(
        "UPDATE _vacuum_state SET value = ?1 WHERE key = 'last_vacuum_at'",
        [last_vacuum_at],
    )
    .expect("should seed last_vacuum_at");
    conn
}

fn read_last_vacuum_at(conn: &Connection) -> String {
    conn.query_row(
        "SELECT value FROM _vacuum_state WHERE key = 'last_vacuum_at'",
        [],
        |row| row.get(0),
    )
    .expect("should read last_vacuum_at")
}

#[test]
fn test_never_vacuumed_triggers_vacuum_and_updates_timestamp() {
    let conn = conn_with_vacuum_state("0");
    let now = 1_000_000u64;

    let performed = vacuum_if_stale(&conn, now).expect("should run without error");

    assert!(performed, "never-vacuumed DB should be vacuumed");
    assert_eq!(read_last_vacuum_at(&conn), now.to_string());
}

#[test]
fn test_fresh_timestamp_skips_vacuum() {
    let now = 2_000_000u64;
    // Within the staleness window (1 hour ago).
    let last = now - 3_600;
    let conn = conn_with_vacuum_state(&last.to_string());

    let performed = vacuum_if_stale(&conn, now).expect("should run without error");

    assert!(!performed, "fresh DB should not be vacuumed");
    // Timestamp unchanged.
    assert_eq!(read_last_vacuum_at(&conn), last.to_string());
}

#[test]
fn test_stale_timestamp_triggers_vacuum_and_updates_timestamp() {
    let now = 3_000_000u64;
    // Exactly at the staleness threshold (6h ago).
    let last = now - VACUUM_STALENESS_SECS;
    let conn = conn_with_vacuum_state(&last.to_string());

    let performed = vacuum_if_stale(&conn, now).expect("should run without error");

    assert!(performed, "stale DB should be vacuumed");
    assert_eq!(read_last_vacuum_at(&conn), now.to_string());
}

#[test]
fn test_vacuum_drains_freelist_in_incremental_mode() {
    let conn = Connection::open_in_memory().expect("should open in-memory connection");

    // Convert to incremental auto-vacuum mode (requires a VACUUM to take effect).
    conn.execute_batch("PRAGMA auto_vacuum=INCREMENTAL; VACUUM;")
        .expect("should enable incremental auto-vacuum");

    let mode: i64 = conn
        .query_row("PRAGMA auto_vacuum", [], |row| row.get(0))
        .expect("should read auto_vacuum");
    assert_eq!(mode, 2, "DB should be in incremental auto-vacuum mode");

    // Vacuum-state table and a data table to churn.
    conn.execute_batch(
        "CREATE TABLE _vacuum_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         INSERT INTO _vacuum_state (key, value) VALUES ('last_vacuum_at', '0');
         CREATE TABLE churn (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);",
    )
    .expect("should create tables");

    // Insert many rows to grow the file.
    {
        let tx = conn
            .unchecked_transaction()
            .expect("should begin transaction");
        let payload = "x".repeat(512);
        for i in 0..2_000 {
            tx.execute(
                "INSERT INTO churn (id, payload) VALUES (?1, ?2)",
                rusqlite::params![i, payload],
            )
            .expect("should insert");
        }
        tx.commit().expect("should commit inserts");
    }

    // Delete all rows, freeing pages onto the free list.
    conn.execute_batch("DELETE FROM churn;")
        .expect("should delete rows");

    let freelist_before: i64 = conn
        .query_row("PRAGMA freelist_count", [], |row| row.get(0))
        .expect("should read freelist_count");
    assert!(
        freelist_before > 0,
        "expected freed pages on the free list, got {freelist_before}"
    );

    let performed = vacuum_if_stale(&conn, 1_000_000u64).expect("should run without error");
    assert!(performed, "never-vacuumed DB should be vacuumed");

    let freelist_after: i64 = conn
        .query_row("PRAGMA freelist_count", [], |row| row.get(0))
        .expect("should read freelist_count");
    assert_eq!(
        freelist_after, 0,
        "free list should be drained after incremental vacuum"
    );
}
