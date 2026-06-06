use sqllumen_lib::logging::parse_log_level_setting;
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
