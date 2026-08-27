//! Command-layer log viewer `_impl` functions (`commands/logs.rs`).

use crate::common;

use chrono::{Duration, TimeZone, Utc};
use sqllumen_lib::commands::logs::{export_logs_impl, list_logs_impl};
use sqllumen_lib::db::migrations::run_log_migrations;
use sqllumen_lib::logging::log_store::{insert_log_entries, NewLogEntry, LOG_PAGE_SIZE};
use tempfile::tempdir;

fn seed_log(
    timestamp: chrono::DateTime<Utc>,
    level: &str,
    level_num: i64,
    message: &str,
) -> NewLogEntry {
    NewLogEntry {
        timestamp: timestamp.to_rfc3339(),
        level: level.to_string(),
        level_num,
        target: "sqllumen_lib::tests".to_string(),
        message: message.to_string(),
    }
}

fn prepare_logs_state() -> sqllumen_lib::state::AppState {
    let state = common::test_app_state();
    {
        let mut conn = state.logs_db.lock().expect("lock logs db");
        run_log_migrations(&mut conn).expect("run logs migrations");
    }
    state
}

#[test]
fn list_logs_impl_applies_threshold_and_paging() {
    let state = prepare_logs_state();
    let now = Utc.with_ymd_and_hms(2026, 6, 6, 12, 0, 0).unwrap();
    let mut rows = Vec::new();

    for index in 0..130 {
        let timestamp = now - Duration::minutes(index as i64);
        let (level, level_num) = if index % 2 == 0 {
            ("ERROR", 50)
        } else {
            ("INFO", 30)
        };
        rows.push(seed_log(
            timestamp,
            level,
            level_num,
            &format!("message-{index:03}"),
        ));
    }

    {
        let mut conn = state.logs_db.lock().expect("lock logs db");
        insert_log_entries(&mut conn, &rows).expect("seed logs");
    }

    let first_page = list_logs_impl(&state, 1, "warn").expect("list logs");
    assert_eq!(first_page.page, 1);
    assert_eq!(first_page.page_size, LOG_PAGE_SIZE);
    assert_eq!(first_page.total, 65);
    assert_eq!(first_page.entries.len() as i64, LOG_PAGE_SIZE);
    assert!(first_page
        .entries
        .iter()
        .all(|entry| entry.level == "ERROR"));
    assert_eq!(
        first_page
            .entries
            .first()
            .map(|entry| entry.message.as_str()),
        Some("message-000")
    );

    let last_page = list_logs_impl(&state, 4, "warn").expect("list page 4");
    assert_eq!(last_page.entries.len(), 5);
    assert_eq!(
        last_page.entries.last().map(|entry| entry.message.as_str()),
        Some("message-128")
    );
}

#[test]
fn export_logs_impl_writes_csv_in_oldest_first_order() {
    let state = prepare_logs_state();
    let now = Utc.with_ymd_and_hms(2026, 6, 6, 12, 0, 0).unwrap();

    {
        let mut conn = state.logs_db.lock().expect("lock logs db");
        insert_log_entries(
            &mut conn,
            &[
                seed_log(now - Duration::days(2), "INFO", 30, "older"),
                seed_log(now - Duration::days(1), "WARN", 40, "middle"),
                seed_log(now, "ERROR", 50, "newer"),
            ],
        )
        .expect("seed export logs");
    }

    let export_dir = tempdir().expect("create tempdir");
    let export_path = export_dir.path().join("logs.csv");
    let exported_rows = export_logs_impl(
        &state,
        "2026-06-04",
        "2026-06-05",
        export_path.to_str().expect("path should be valid utf-8"),
    )
    .expect("export logs");

    assert_eq!(exported_rows, 2);

    let csv = std::fs::read_to_string(&export_path).expect("read exported csv");
    let lines: Vec<_> = csv.lines().collect();
    assert_eq!(lines.len(), 3);
    assert_eq!(lines[0], "timestamp,level,message");
    assert!(lines[1].contains(",INFO,older"));
    assert!(lines[2].contains(",WARN,middle"));
}

#[test]
fn export_logs_impl_sanitizes_formula_like_string_cells() {
    let state = prepare_logs_state();
    let timestamp = Utc.with_ymd_and_hms(2026, 6, 6, 12, 0, 0).unwrap();

    {
        let mut conn = state.logs_db.lock().expect("lock logs db");
        insert_log_entries(&mut conn, &[seed_log(timestamp, "INFO", 30, "=SUM(A1:A2)")])
            .expect("seed export logs");
    }

    let export_dir = tempdir().expect("create tempdir");
    let export_path = export_dir.path().join("sanitized-logs.csv");
    export_logs_impl(
        &state,
        "2026-06-06",
        "2026-06-06",
        export_path.to_str().expect("path should be valid utf-8"),
    )
    .expect("export logs");

    let csv = std::fs::read_to_string(&export_path).expect("read exported csv");
    assert!(
        csv.contains("'=SUM(A1:A2)"),
        "unexpected csv contents: {csv}"
    );
}

#[test]
fn export_logs_impl_honors_local_day_timestamps_near_utc_boundaries() {
    let state = prepare_logs_state();

    {
        let mut conn = state.logs_db.lock().expect("lock logs db");
        insert_log_entries(
            &mut conn,
            &[
                seed_log(
                    Utc.with_ymd_and_hms(2026, 6, 1, 3, 30, 0).unwrap(),
                    "INFO",
                    30,
                    "inside-local-day",
                ),
                seed_log(
                    Utc.with_ymd_and_hms(2026, 6, 2, 4, 30, 0).unwrap(),
                    "INFO",
                    30,
                    "outside-local-day",
                ),
            ],
        )
        .expect("seed export logs");
    }

    let export_dir = tempdir().expect("create tempdir");
    let export_path = export_dir.path().join("timezone-logs.csv");
    let exported_rows = export_logs_impl(
        &state,
        "2026-05-31T04:00:00.000-04:00",
        "2026-06-01T03:59:59.999-04:00",
        export_path.to_str().expect("path should be valid utf-8"),
    )
    .expect("export logs");

    assert_eq!(exported_rows, 1);

    let csv = std::fs::read_to_string(&export_path).expect("read exported csv");
    assert!(csv.contains("inside-local-day"));
    assert!(!csv.contains("outside-local-day"));
}

#[test]
fn export_logs_impl_accepts_seven_inclusive_local_days_for_non_utc_offsets() {
    let state = prepare_logs_state();

    {
        let mut conn = state.logs_db.lock().expect("lock logs db");
        insert_log_entries(
            &mut conn,
            &[
                seed_log(
                    Utc.with_ymd_and_hms(2026, 6, 1, 4, 0, 1).unwrap(),
                    "INFO",
                    30,
                    "range-start",
                ),
                seed_log(
                    Utc.with_ymd_and_hms(2026, 6, 8, 3, 0, 0).unwrap(),
                    "INFO",
                    30,
                    "range-end",
                ),
            ],
        )
        .expect("seed export logs");
    }

    let export_dir = tempdir().expect("create tempdir");
    let export_path = export_dir.path().join("seven-days-offset.csv");
    let exported_rows = export_logs_impl(
        &state,
        "2026-06-01T00:00:00.000-04:00",
        "2026-06-07T23:59:59.999-04:00",
        export_path.to_str().expect("path should be valid utf-8"),
    )
    .expect("export logs");

    assert_eq!(exported_rows, 2);

    let csv = std::fs::read_to_string(&export_path).expect("read exported csv");
    assert!(csv.contains("range-start"));
    assert!(csv.contains("range-end"));
}

#[test]
fn export_logs_impl_rejects_ranges_longer_than_seven_days() {
    let state = prepare_logs_state();
    let export_dir = tempdir().expect("create tempdir");
    let export_path = export_dir.path().join("too-wide.csv");

    let error = export_logs_impl(
        &state,
        "2026-06-01",
        "2026-06-08",
        export_path.to_str().expect("path should be valid utf-8"),
    )
    .expect_err("range should be rejected");

    assert!(
        error.contains("cannot exceed 7 days"),
        "unexpected error: {error}"
    );
}

#[test]
fn export_logs_impl_rejects_descending_ranges() {
    let state = prepare_logs_state();
    let export_dir = tempdir().expect("create tempdir");
    let export_path = export_dir.path().join("descending.csv");

    let error = export_logs_impl(
        &state,
        "2026-06-06",
        "2026-06-05",
        export_path.to_str().expect("path should be valid utf-8"),
    )
    .expect_err("descending range should be rejected");

    assert!(error.contains("on or after"), "unexpected error: {error}");
}

#[test]
fn list_logs_impl_rejects_invalid_level() {
    let state = prepare_logs_state();
    let error = list_logs_impl(&state, 1, "bogus").expect_err("invalid level should be rejected");
    assert!(
        error.contains("invalid log level filter"),
        "unexpected error: {error}"
    );
}

#[test]
fn list_logs_impl_surfaces_query_errors() {
    // No schema initialized, so the underlying query fails and is mapped to a String.
    let state = common::test_app_state();
    let error = list_logs_impl(&state, 1, "all").expect_err("query should fail without schema");
    assert!(!error.is_empty(), "expected a non-empty error message");
}

#[test]
fn export_logs_impl_surfaces_query_errors() {
    let state = common::test_app_state();
    let export_dir = tempdir().expect("create tempdir");
    let export_path = export_dir.path().join("missing-schema.csv");
    let error = export_logs_impl(
        &state,
        "2026-06-06",
        "2026-06-06",
        export_path.to_str().expect("path should be valid utf-8"),
    )
    .expect_err("query should fail without schema");
    assert!(!error.is_empty(), "expected a non-empty error message");
}

#[test]
fn export_logs_impl_errors_when_output_path_is_unwritable() {
    let state = prepare_logs_state();
    {
        let mut conn = state.logs_db.lock().expect("lock logs db");
        insert_log_entries(
            &mut conn,
            &[seed_log(
                Utc.with_ymd_and_hms(2026, 6, 6, 12, 0, 0).unwrap(),
                "INFO",
                30,
                "row",
            )],
        )
        .expect("seed export logs");
    }

    // The parent directory does not exist, so File::create fails.
    let export_dir = tempdir().expect("create tempdir");
    let export_path = export_dir.path().join("missing-subdir").join("out.csv");
    let error = export_logs_impl(
        &state,
        "2026-06-06",
        "2026-06-06",
        export_path.to_str().expect("path should be valid utf-8"),
    )
    .expect_err("unwritable path should fail");
    assert!(!error.is_empty(), "expected a non-empty error message");
}

#[test]
fn export_logs_impl_rejects_invalid_timestamps() {
    let state = prepare_logs_state();
    let export_dir = tempdir().expect("create tempdir");
    let export_path = export_dir.path().join("invalid-ts.csv");
    let error = export_logs_impl(
        &state,
        "not-a-date",
        "2026-06-06",
        export_path.to_str().expect("path should be valid utf-8"),
    )
    .expect_err("invalid timestamp should be rejected");
    assert!(
        error.contains("invalid start timestamp"),
        "unexpected error: {error}"
    );
}
