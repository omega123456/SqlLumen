//! Covers `logging::init_logging`, filter reload, and double-init error (nextest runs each test in its own process, so each may install the global subscriber once).

use crate::common;
use std::path::PathBuf;
use tempfile::TempDir;

const RUST_LOG_DIRECTIVES: &str = "warn";

fn initialized_log_db_path(dir: &TempDir) -> PathBuf {
    let log_db_path = dir.path().join("sqllumen-logs.db");
    // Mirror production startup ordering: the logs database is initialized
    // (migrations applied + auto-vacuum conversion) once before logging is wired
    // up. The log-writer thread then opens the already-migrated database with a
    // plain open + pragmas via `open_log_database`.
    sqllumen_lib::logging::log_store::initialize_log_database(&log_db_path)
        .expect("initialize log db");
    log_db_path
}

#[test]
fn init_logging_and_reload_helpers() {
    let dir = tempfile::tempdir().expect("tempdir");
    let log_db_path = initialized_log_db_path(&dir);
    let init = sqllumen_lib::logging::init_logging(&log_db_path, None).expect("init logging");
    let filter_reload = init
        .settings_filter_reload
        .expect("settings drive the filter when RUST_LOG is unset");

    // Emit a tracing event to exercise BracketLevelFormat::format_event
    tracing::info!(target: "sqllumen_lib::logging", "logging init integration test event");

    assert!(
        log_db_path.exists(),
        "expected sqlite log database to be created"
    );

    let log_conn =
        sqllumen_lib::logging::log_store::open_log_database(&log_db_path).expect("open log db");
    for _ in 0..20 {
        let count: i64 = log_conn
            .query_row("SELECT COUNT(*) FROM log_entries", [], |row| row.get(0))
            .expect("count log entries");
        if count > 0 {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let count: i64 = log_conn
        .query_row("SELECT COUNT(*) FROM log_entries", [], |row| row.get(0))
        .expect("count log entries");
    assert!(
        count > 0,
        "expected emitted log event to reach sqlite log store"
    );

    let conn = common::test_db();
    sqllumen_lib::db::settings::set_setting(
        &conn,
        sqllumen_lib::logging::LOG_LEVEL_SETTING_KEY,
        "warn",
    )
    .expect("set log.level");
    sqllumen_lib::logging::apply_log_level_from_settings(&conn, &filter_reload);

    sqllumen_lib::logging::reload_log_level_from_setting_value(Some(&filter_reload), "error");
    sqllumen_lib::logging::reload_log_level_from_setting_value(None, "trace");
    sqllumen_lib::logging::reload_log_level_from_setting_value(Some(&filter_reload), "bogus");

    let second = sqllumen_lib::logging::init_logging(&log_db_path, None);
    let err = match second {
        Err(e) => e,
        Ok(_) => panic!("second init should fail"),
    };
    assert!(
        err.contains("subscriber") || err.contains("already"),
        "unexpected err: {err}"
    );
}

#[test]
fn init_logging_with_rust_log_keeps_the_filter_away_from_settings() {
    let dir = tempfile::tempdir().expect("tempdir");
    let log_db_path = initialized_log_db_path(&dir);
    let init = sqllumen_lib::logging::init_logging(&log_db_path, Some(RUST_LOG_DIRECTIVES))
        .expect("init logging");

    assert!(init.settings_filter_reload.is_none());
}
