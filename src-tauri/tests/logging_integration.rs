use chrono::NaiveDate;
use sqllumen_lib::logging::{parse_log_level_setting, prune_old_logs, ROLLING_LOG_STEM};
use std::fs::File;
use std::path::Path;
use std::sync::Mutex;
use tracing_subscriber::layer::SubscriberExt;

static RUST_LOG_LOCK: Mutex<()> = Mutex::new(());

struct RustLogGuard {
    previous: Option<String>,
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl RustLogGuard {
    fn set(value: &str) -> Self {
        let guard = RUST_LOG_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = std::env::var("RUST_LOG").ok();
        std::env::set_var("RUST_LOG", value);
        Self {
            previous,
            _guard: guard,
        }
    }

    fn remove() -> Self {
        let guard = RUST_LOG_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = std::env::var("RUST_LOG").ok();
        std::env::remove_var("RUST_LOG");
        Self {
            previous,
            _guard: guard,
        }
    }
}

impl Drop for RustLogGuard {
    fn drop(&mut self) {
        if let Some(previous) = &self.previous {
            std::env::set_var("RUST_LOG", previous);
        } else {
            std::env::remove_var("RUST_LOG");
        }
    }
}

fn touch(path: &Path) {
    File::create(path).unwrap();
}

#[test]
fn prune_only_today_no_deletes() {
    let dir = tempfile::tempdir().unwrap();
    let today = NaiveDate::from_ymd_opt(2025, 3, 22).unwrap();
    touch(&dir.path().join("sqllumen.2025-03-22.log"));
    prune_old_logs(dir.path(), ROLLING_LOG_STEM, today).unwrap();
    assert!(dir.path().join("sqllumen.2025-03-22.log").exists());
}

#[test]
fn prune_deletes_stale_keeps_recent() {
    let dir = tempfile::tempdir().unwrap();
    let today = NaiveDate::from_ymd_opt(2025, 3, 22).unwrap();
    touch(&dir.path().join("sqllumen.2025-03-22.log"));
    touch(&dir.path().join("sqllumen.2025-03-21.log"));
    touch(&dir.path().join("sqllumen.2025-03-10.log"));
    prune_old_logs(dir.path(), ROLLING_LOG_STEM, today).unwrap();
    assert!(dir.path().join("sqllumen.2025-03-22.log").exists());
    assert!(dir.path().join("sqllumen.2025-03-21.log").exists());
    assert!(!dir.path().join("sqllumen.2025-03-10.log").exists());
}

#[test]
fn prune_protects_only_pre_today_when_it_would_be_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let today = NaiveDate::from_ymd_opt(2025, 3, 22).unwrap();
    touch(&dir.path().join("sqllumen.2025-03-22.log"));
    touch(&dir.path().join("sqllumen.2025-03-10.log"));
    prune_old_logs(dir.path(), ROLLING_LOG_STEM, today).unwrap();
    assert!(dir.path().join("sqllumen.2025-03-22.log").exists());
    assert!(dir.path().join("sqllumen.2025-03-10.log").exists());
}

#[test]
fn prune_yesterday_and_stale_deletes_only_stale() {
    let dir = tempfile::tempdir().unwrap();
    let today = NaiveDate::from_ymd_opt(2025, 3, 22).unwrap();
    touch(&dir.path().join("sqllumen.2025-03-22.log"));
    touch(&dir.path().join("sqllumen.2025-03-21.log"));
    touch(&dir.path().join("sqllumen.2025-03-10.log"));
    prune_old_logs(dir.path(), ROLLING_LOG_STEM, today).unwrap();
    assert!(dir.path().join("sqllumen.2025-03-22.log").exists());
    assert!(dir.path().join("sqllumen.2025-03-21.log").exists());
    assert!(!dir.path().join("sqllumen.2025-03-10.log").exists());
}

#[test]
fn parse_log_level_accepts_known_levels() {
    assert!(parse_log_level_setting("DEBUG").is_some());
    assert!(parse_log_level_setting("warn").is_some());
    assert!(parse_log_level_setting("bogus").is_none());
}

#[test]
fn parse_log_level_accepts_trace_and_info() {
    assert!(parse_log_level_setting(" trace ").is_some());
    assert!(parse_log_level_setting("INFO").is_some());
}

#[test]
fn prune_old_logs_ignores_non_matching_and_invalid_filenames() {
    let dir = tempfile::tempdir().unwrap();
    let today = NaiveDate::from_ymd_opt(2025, 3, 22).unwrap();
    touch(&dir.path().join("sqllumen.not-a-date.log"));
    touch(&dir.path().join("other-app.2025-03-01.log"));
    touch(&dir.path().join("sqllumen.2025-03-22.log"));

    prune_old_logs(dir.path(), ROLLING_LOG_STEM, today).unwrap();

    assert!(dir.path().join("sqllumen.not-a-date.log").exists());
    assert!(dir.path().join("other-app.2025-03-01.log").exists());
    assert!(dir.path().join("sqllumen.2025-03-22.log").exists());
}

#[test]
fn apply_log_level_from_settings_returns_early_when_rust_log_is_set() {
    let _guard = RustLogGuard::set("info");
    let conn = common::test_db();
    sqllumen_lib::db::settings::set_setting(
        &conn,
        sqllumen_lib::logging::LOG_LEVEL_SETTING_KEY,
        "warn",
    )
    .expect("set log level setting");

    let subscriber = tracing_subscriber::registry();
    let (layer, handle) =
        tracing_subscriber::reload::Layer::new(tracing_subscriber::EnvFilter::new("debug"));
    let _subscriber = subscriber.with(layer);

    sqllumen_lib::logging::apply_log_level_from_settings(&conn, &handle);
}

#[test]
fn reload_log_level_from_setting_value_returns_early_for_missing_handle_and_rust_log() {
    {
        let _guard = RustLogGuard::remove();
        sqllumen_lib::logging::reload_log_level_from_setting_value(None, "info");
    }

    {
        let _guard = RustLogGuard::set("warn");
        let subscriber = tracing_subscriber::registry();
        let (layer, handle) =
            tracing_subscriber::reload::Layer::new(tracing_subscriber::EnvFilter::new("debug"));
        let _subscriber = subscriber.with(layer);

        sqllumen_lib::logging::reload_log_level_from_setting_value(Some(&handle), "error");
    }
}

mod common;
