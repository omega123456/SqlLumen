use chrono::{Duration, TimeZone, Utc};
use rusqlite::Connection;
use sqllumen_lib::db::migrations::run_log_migrations;
use sqllumen_lib::logging::log_store::{
    export_logs_in_range, initialize_log_database, insert_log_entries, list_logs,
    open_log_database, prune_logs, LogEntry, LOG_PAGE_SIZE,
};
use tempfile::tempdir;

struct TestLevel<'a> {
    name: &'a str,
    num: i64,
}

fn log_entry(
    timestamp: chrono::DateTime<Utc>,
    level: TestLevel<'_>,
    message: &str,
) -> sqllumen_lib::logging::log_store::NewLogEntry {
    sqllumen_lib::logging::log_store::NewLogEntry {
        timestamp: timestamp.to_rfc3339(),
        level: level.name.to_string(),
        level_num: level.num,
        target: "test.target".to_string(),
        message: message.to_string(),
    }
}

fn test_conn() -> Connection {
    let mut conn = Connection::open_in_memory().expect("open in-memory log db");
    run_log_migrations(&mut conn).expect("run log migrations");
    conn
}

fn paged_log_timestamp(now: chrono::DateTime<Utc>, index: i64) -> chrono::DateTime<Utc> {
    let is_recent = index < 960;
    if is_recent {
        return now - Duration::hours(1) + Duration::seconds(index);
    }
    now - Duration::hours(48) - Duration::seconds(index - 960)
}

fn paged_log_level(index: i64) -> TestLevel<'static> {
    let is_error = index % 3 == 0;
    if is_error {
        return TestLevel {
            name: "ERROR",
            num: 50,
        };
    }
    TestLevel {
        name: "INFO",
        num: 30,
    }
}

fn paged_log_rows(
    now: chrono::DateTime<Utc>,
) -> Vec<sqllumen_lib::logging::log_store::NewLogEntry> {
    (0..1040)
        .map(|index| {
            log_entry(
                paged_log_timestamp(now, index),
                paged_log_level(index),
                &format!("message-{index}"),
            )
        })
        .collect()
}

fn first_message(page: &sqllumen_lib::logging::log_store::LogPage) -> Option<&str> {
    page.entries.first().map(|entry| entry.message.as_str())
}

fn last_message(page: &sqllumen_lib::logging::log_store::LogPage) -> Option<&str> {
    page.entries.last().map(|entry| entry.message.as_str())
}

#[test]
fn list_logs_pages_newest_first_with_threshold_and_universe_cap() {
    let mut conn = test_conn();
    let now = Utc.with_ymd_and_hms(2026, 6, 6, 12, 0, 0).unwrap();
    let rows = paged_log_rows(now);

    insert_log_entries(&mut conn, &rows).expect("insert log entries");

    let first_page = list_logs(
        &conn,
        &sqllumen_lib::logging::log_store::LogPageQuery {
            page: 1,
            level_num: Some(40),
            now,
        },
    )
    .expect("list first page");
    assert_eq!(first_page.page, 1);
    assert_eq!(first_page.page_size, LOG_PAGE_SIZE);
    assert_eq!(first_page.total, 334);
    assert_eq!(first_page.entries.len() as i64, LOG_PAGE_SIZE);
    assert_eq!(first_message(&first_page), Some("message-957"));
    assert_eq!(last_message(&first_page), Some("message-900"));
    assert!(first_page
        .entries
        .iter()
        .all(|entry| entry.level == "ERROR"));

    let last_page = list_logs(
        &conn,
        &sqllumen_lib::logging::log_store::LogPageQuery {
            page: 17,
            level_num: Some(40),
            now,
        },
    )
    .expect("list last page");
    assert_eq!(last_page.entries.len(), 14);
    let last_page_messages: Vec<_> = last_page
        .entries
        .iter()
        .map(|entry| entry.message.as_str())
        .collect();
    assert!(last_page_messages.contains(&"message-960"));
    assert!(last_page_messages.contains(&"message-999"));
    assert!(last_page.entries.iter().all(|entry| entry.level == "ERROR"));

    let unfiltered_page = list_logs(
        &conn,
        &sqllumen_lib::logging::log_store::LogPageQuery {
            page: 1,
            level_num: None,
            now,
        },
    )
    .expect("list unfiltered page");
    assert_eq!(unfiltered_page.total, 1000);
    assert_eq!(first_message(&unfiltered_page), Some("message-959"));
}

#[test]
fn export_logs_returns_oldest_first_in_requested_range() {
    let mut conn = test_conn();
    let now = Utc.with_ymd_and_hms(2026, 6, 6, 12, 0, 0).unwrap();
    let rows = vec![
        log_entry(
            now - Duration::days(2),
            TestLevel {
                name: "INFO",
                num: 30,
            },
            "older",
        ),
        log_entry(
            now - Duration::days(1),
            TestLevel {
                name: "WARN",
                num: 40,
            },
            "middle",
        ),
        log_entry(
            now,
            TestLevel {
                name: "ERROR",
                num: 50,
            },
            "newer",
        ),
    ];
    insert_log_entries(&mut conn, &rows).expect("insert log entries");

    let exported: Vec<LogEntry> = export_logs_in_range(
        &conn,
        &(now - Duration::days(2)).to_rfc3339(),
        &(now - Duration::hours(1)).to_rfc3339(),
    )
    .expect("export log range");

    let messages: Vec<_> = exported
        .iter()
        .map(|entry| entry.message.as_str())
        .collect();
    assert_eq!(messages, vec!["older", "middle"]);
}

#[test]
fn prune_logs_removes_rows_older_than_seven_days() {
    let mut conn = test_conn();
    let now = Utc.with_ymd_and_hms(2026, 6, 6, 12, 0, 0).unwrap();
    let rows = vec![
        log_entry(
            now - Duration::days(8),
            TestLevel {
                name: "INFO",
                num: 30,
            },
            "stale",
        ),
        log_entry(
            now - Duration::days(7),
            TestLevel {
                name: "INFO",
                num: 30,
            },
            "edge",
        ),
        log_entry(
            now - Duration::days(1),
            TestLevel {
                name: "INFO",
                num: 30,
            },
            "fresh",
        ),
    ];
    insert_log_entries(&mut conn, &rows).expect("insert log entries");

    let deleted = prune_logs(&conn, now).expect("prune log entries");
    assert_eq!(deleted, 1);

    let remaining = export_logs_in_range(
        &conn,
        &(now - Duration::days(10)).to_rfc3339(),
        &now.to_rfc3339(),
    )
    .expect("read remaining rows");
    let messages: Vec<_> = remaining
        .iter()
        .map(|entry| entry.message.as_str())
        .collect();
    assert_eq!(messages, vec!["edge", "fresh"]);
}

#[test]
fn open_log_database_errors_when_parent_directory_cannot_be_created() {
    let dir = tempdir().expect("create tempdir");
    // A regular file stands in for what would need to be a directory, so
    // create_dir_all fails when resolving the database path's parent.
    let blocking_file = dir.path().join("not-a-directory");
    std::fs::write(&blocking_file, b"x").expect("write blocking file");

    let db_path = blocking_file.join("nested").join("logs.db");
    let result = open_log_database(&db_path);

    assert!(
        result.is_err(),
        "expected open_log_database to fail when the parent cannot be created"
    );
}

#[test]
fn initialize_log_database_yields_incremental_mode_with_schema() {
    let dir = tempdir().expect("create tempdir");
    let db_path = dir.path().join("sqllumen-logs.db");

    let conn = initialize_log_database(&db_path).expect("initialize log database");

    let mode: i64 = conn
        .query_row("PRAGMA auto_vacuum;", [], |row| row.get(0))
        .expect("query auto_vacuum");
    assert_eq!(
        mode, 2,
        "expected logs database in incremental auto-vacuum mode"
    );

    for table in &["log_entries", "_vacuum_state", "refinery_schema_history"] {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |row| row.get(0),
            )
            .expect("query sqlite_master");
        assert_eq!(count, 1, "table '{table}' should exist");
    }

    let seeded: String = conn
        .query_row(
            "SELECT value FROM _vacuum_state WHERE key='last_vacuum_at'",
            [],
            |row| row.get(0),
        )
        .expect("query seeded vacuum state");
    assert_eq!(seeded, "0");
}

#[test]
fn initialize_log_database_preserves_pre_existing_rows() {
    let dir = tempdir().expect("create tempdir");
    let db_path = dir.path().join("sqllumen-logs.db");

    // Simulate a pre-upgrade logs database: only the log_entries table and a row,
    // with no migration system in place.
    {
        let mut conn = Connection::open(&db_path).expect("open pre-existing log db");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS log_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                level TEXT NOT NULL,
                level_num INTEGER NOT NULL,
                target TEXT NOT NULL,
                message TEXT NOT NULL
            );",
        )
        .expect("create pre-existing schema");
        let now = Utc.with_ymd_and_hms(2026, 6, 6, 12, 0, 0).unwrap();
        insert_log_entries(
            &mut conn,
            &[log_entry(
                now,
                TestLevel {
                    name: "info",
                    num: 4,
                },
                "pre-existing",
            )],
        )
        .expect("insert pre-existing row");
    }

    let conn = initialize_log_database(&db_path).expect("initialize existing log database");

    let mode: i64 = conn
        .query_row("PRAGMA auto_vacuum;", [], |row| row.get(0))
        .expect("query auto_vacuum");
    assert_eq!(mode, 2, "expected incremental mode after conversion");

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM log_entries", [], |row| row.get(0))
        .expect("count log entries");
    assert_eq!(count, 1, "pre-existing rows must survive conversion");

    let message: String = conn
        .query_row("SELECT message FROM log_entries", [], |row| row.get(0))
        .expect("read message");
    assert_eq!(message, "pre-existing");
}
