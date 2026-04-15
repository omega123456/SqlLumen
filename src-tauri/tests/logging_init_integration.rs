//! Covers `logging::init_logging`, filter reload, and double-init error (one test — global subscriber).

mod common;

struct RustLogGuard {
    previous: Option<String>,
}

impl RustLogGuard {
    fn isolate() -> Self {
        let previous = std::env::var("RUST_LOG").ok();
        std::env::remove_var("RUST_LOG");
        Self { previous }
    }
}

impl Drop for RustLogGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(v) => {
                std::env::set_var("RUST_LOG", v);
            }
            None => {
                std::env::remove_var("RUST_LOG");
            }
        }
    }
}

#[test]
fn init_logging_and_reload_helpers() {
    let _g = RustLogGuard::isolate();
    let dir = tempfile::tempdir().expect("tempdir");
    let init = sqllumen_lib::logging::init_logging(dir.path()).expect("init logging");
    assert!(!init.rust_log_env_set);

    // Emit a tracing event to exercise BracketLevelFormat::format_event
    tracing::info!(target: "sqllumen_lib::logging", "logging init integration test event");

    let log_files: Vec<_> = std::fs::read_dir(dir.path())
        .expect("read log dir")
        .filter_map(|e| e.ok())
        .collect();
    assert!(
        !log_files.is_empty(),
        "expected rolling log file under log dir"
    );

    let conn = common::test_db();
    sqllumen_lib::db::settings::set_setting(
        &conn,
        sqllumen_lib::logging::LOG_LEVEL_SETTING_KEY,
        "warn",
    )
    .expect("set log.level");
    sqllumen_lib::logging::apply_log_level_from_settings(&conn, &init.filter_reload);

    sqllumen_lib::logging::reload_log_level_from_setting_value(Some(&init.filter_reload), "error");
    sqllumen_lib::logging::reload_log_level_from_setting_value(None, "trace");
    sqllumen_lib::logging::reload_log_level_from_setting_value(Some(&init.filter_reload), "bogus");

    let second = sqllumen_lib::logging::init_logging(dir.path());
    let err = match second {
        Err(e) => e,
        Ok(_) => panic!("second init should fail"),
    };
    assert!(
        err.contains("subscriber") || err.contains("already"),
        "unexpected err: {err}"
    );
}
