use chrono::{Duration, TimeZone, Utc};
use rusqlite::Connection;
use sqllumen_lib::logging::log_store::{
    export_logs_in_range, init_schema, insert_log_entries, list_logs, open_log_database, prune_logs,
    LogEntry, LOG_PAGE_SIZE,
};
use tempfile::tempdir;

fn log_entry(
    timestamp: chrono::DateTime<Utc>,
    level: &str,
    level_num: i64,
    message: &str,
) -> sqllumen_lib::logging::log_store::NewLogEntry {
    sqllumen_lib::logging::log_store::NewLogEntry {
        timestamp: timestamp.to_rfc3339(),
        level: level.to_string(),
        level_num,
        target: "test.target".to_string(),
        message: message.to_string(),
    }
}

fn test_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory log db");
    init_schema(&conn).expect("init log schema");
    conn
}

#[test]
fn list_logs_pages_newest_first_with_threshold_and_universe_cap() {
    let mut conn = test_conn();
    let now = Utc.with_ymd_and_hms(2026, 6, 6, 12, 0, 0).unwrap();
    let recent_start = now - Duration::hours(1);
    let mut rows = Vec::new();

    for index in 0..1040 {
        let timestamp = if index < 960 {
            recent_start + Duration::seconds(index as i64)
        } else {
            now - Duration::hours(48) - Duration::seconds((index - 960) as i64)
        };
        let (level, level_num) = if index % 3 == 0 {
            ("ERROR", 50)
        } else {
            ("INFO", 30)
        };
        rows.push(log_entry(
            timestamp,
            level,
            level_num,
            &format!("message-{index}"),
        ));
    }

    insert_log_entries(&mut conn, &rows).expect("insert log entries");

    let first_page = list_logs(&conn, 1, Some(40), now).expect("list first page");
    assert_eq!(first_page.page, 1);
    assert_eq!(first_page.page_size, LOG_PAGE_SIZE);
    assert_eq!(first_page.total, 334);
    assert_eq!(first_page.entries.len() as i64, LOG_PAGE_SIZE);
    assert_eq!(
        first_page
            .entries
            .first()
            .map(|entry| entry.message.as_str()),
        Some("message-957")
    );
    assert_eq!(
        first_page
            .entries
            .last()
            .map(|entry| entry.message.as_str()),
        Some("message-900")
    );
    assert!(first_page
        .entries
        .iter()
        .all(|entry| entry.level == "ERROR"));

    let last_page = list_logs(&conn, 17, Some(40), now).expect("list last page");
    assert_eq!(last_page.entries.len(), 14);
    let last_page_messages: Vec<_> = last_page
        .entries
        .iter()
        .map(|entry| entry.message.as_str())
        .collect();
    assert!(last_page_messages.contains(&"message-960"));
    assert!(last_page_messages.contains(&"message-999"));
    assert!(last_page.entries.iter().all(|entry| entry.level == "ERROR"));

    let unfiltered_page = list_logs(&conn, 1, None, now).expect("list unfiltered page");
    assert_eq!(unfiltered_page.total, 1000);
    assert_eq!(
        unfiltered_page
            .entries
            .first()
            .map(|entry| entry.message.as_str()),
        Some("message-959")
    );
}

#[test]
fn export_logs_returns_oldest_first_in_requested_range() {
    let mut conn = test_conn();
    let now = Utc.with_ymd_and_hms(2026, 6, 6, 12, 0, 0).unwrap();
    let rows = vec![
        log_entry(now - Duration::days(2), "INFO", 30, "older"),
        log_entry(now - Duration::days(1), "WARN", 40, "middle"),
        log_entry(now, "ERROR", 50, "newer"),
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
        log_entry(now - Duration::days(8), "INFO", 30, "stale"),
        log_entry(now - Duration::days(7), "INFO", 30, "edge"),
        log_entry(now - Duration::days(1), "INFO", 30, "fresh"),
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
