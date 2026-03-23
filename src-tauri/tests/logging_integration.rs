use chrono::NaiveDate;
use mysql_client_lib::logging::{parse_log_level_setting, prune_old_logs, ROLLING_LOG_STEM};
use std::fs::File;
use std::path::Path;

fn touch(path: &Path) {
    File::create(path).unwrap();
}

#[test]
fn prune_only_today_no_deletes() {
    let dir = tempfile::tempdir().unwrap();
    let today = NaiveDate::from_ymd_opt(2025, 3, 22).unwrap();
    touch(&dir.path().join("mysql-client.2025-03-22.log"));
    prune_old_logs(dir.path(), ROLLING_LOG_STEM, today).unwrap();
    assert!(dir.path().join("mysql-client.2025-03-22.log").exists());
}

#[test]
fn prune_deletes_stale_keeps_recent() {
    let dir = tempfile::tempdir().unwrap();
    let today = NaiveDate::from_ymd_opt(2025, 3, 22).unwrap();
    touch(&dir.path().join("mysql-client.2025-03-22.log"));
    touch(&dir.path().join("mysql-client.2025-03-21.log"));
    touch(&dir.path().join("mysql-client.2025-03-10.log"));
    prune_old_logs(dir.path(), ROLLING_LOG_STEM, today).unwrap();
    assert!(dir.path().join("mysql-client.2025-03-22.log").exists());
    assert!(dir.path().join("mysql-client.2025-03-21.log").exists());
    assert!(!dir.path().join("mysql-client.2025-03-10.log").exists());
}

#[test]
fn prune_protects_only_pre_today_when_it_would_be_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let today = NaiveDate::from_ymd_opt(2025, 3, 22).unwrap();
    touch(&dir.path().join("mysql-client.2025-03-22.log"));
    touch(&dir.path().join("mysql-client.2025-03-10.log"));
    prune_old_logs(dir.path(), ROLLING_LOG_STEM, today).unwrap();
    assert!(dir.path().join("mysql-client.2025-03-22.log").exists());
    assert!(dir.path().join("mysql-client.2025-03-10.log").exists());
}

#[test]
fn prune_yesterday_and_stale_deletes_only_stale() {
    let dir = tempfile::tempdir().unwrap();
    let today = NaiveDate::from_ymd_opt(2025, 3, 22).unwrap();
    touch(&dir.path().join("mysql-client.2025-03-22.log"));
    touch(&dir.path().join("mysql-client.2025-03-21.log"));
    touch(&dir.path().join("mysql-client.2025-03-10.log"));
    prune_old_logs(dir.path(), ROLLING_LOG_STEM, today).unwrap();
    assert!(dir.path().join("mysql-client.2025-03-22.log").exists());
    assert!(dir.path().join("mysql-client.2025-03-21.log").exists());
    assert!(!dir.path().join("mysql-client.2025-03-10.log").exists());
}

#[test]
fn parse_log_level_accepts_known_levels() {
    assert!(parse_log_level_setting("DEBUG").is_some());
    assert!(parse_log_level_setting("warn").is_some());
    assert!(parse_log_level_setting("bogus").is_none());
}
