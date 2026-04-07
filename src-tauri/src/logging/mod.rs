//! Application logging: daily log files under `app_data_dir/logs`, stderr output,
//! reloadable `EnvFilter` for a future settings UI, and startup retention pruning.

use chrono::{Local, NaiveDate};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tracing::Subscriber;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::fmt::format::{Format, FormatEvent, FormatFields, Full, Writer};
use tracing_subscriber::fmt::time::SystemTime;
use tracing_subscriber::fmt::FmtContext;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::reload;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Registry};

/// SQLite settings key for persisted log level (`trace` | `debug` | `info` | `warn` | `error`).
pub const LOG_LEVEL_SETTING_KEY: &str = "log.level";

/// Base name for daily log files: `{stem}.{YYYY-MM-DD}.log` (via `tracing-appender` suffix API).
pub const ROLLING_LOG_STEM: &str = "mysql-client";

static LOG_WORKER_GUARD: OnceLock<tracing_appender::non_blocking::WorkerGuard> = OnceLock::new();

/// Handle to reload the global `EnvFilter` (e.g. when `log.level` changes in settings).
pub type LogFilterReloadHandle = reload::Handle<EnvFilter, Registry>;

/// Result of [`init_logging`].
pub struct LoggingInit {
    pub filter_reload: LogFilterReloadHandle,
    pub rust_log_env_set: bool,
}

fn default_env_filter() -> EnvFilter {
    EnvFilter::try_new("info,sqlx=warn").unwrap_or_else(|_| EnvFilter::new("info"))
}

fn env_filter_from_rust_log() -> Option<EnvFilter> {
    if std::env::var("RUST_LOG").is_ok() {
        EnvFilter::try_from_default_env().ok()
    } else {
        None
    }
}

/// Parse a `log.level` setting value into an `EnvFilter` (with `sqlx=warn`).
pub fn parse_log_level_setting(s: &str) -> Option<EnvFilter> {
    let level = s.trim().to_lowercase();
    let directive = match level.as_str() {
        "trace" => "trace,sqlx=warn",
        "debug" => "debug,sqlx=warn",
        "info" => "info,sqlx=warn",
        "warn" => "warn,sqlx=warn",
        "error" => "error,sqlx=warn",
        _ => return None,
    };
    EnvFilter::try_new(directive).ok()
}

/// Apply `log.level` from SQLite when `RUST_LOG` is not set. Ignores invalid values.
pub fn apply_log_level_from_settings(conn: &rusqlite::Connection, handle: &LogFilterReloadHandle) {
    if std::env::var("RUST_LOG").is_ok() {
        return;
    }
    let Ok(Some(raw)) = crate::db::settings::get_setting(conn, LOG_LEVEL_SETTING_KEY) else {
        return;
    };
    if let Some(filter) = parse_log_level_setting(&raw) {
        if let Err(e) = handle.reload(filter) {
            tracing::warn!(
                target: "mysql_client_lib::logging",
                "failed to reload log filter from settings: {e}"
            );
        }
    }
}

/// Reload log filter after the user saves `log.level` (no-op if `RUST_LOG` is set).
pub fn reload_log_level_from_setting_value(handle: Option<&LogFilterReloadHandle>, value: &str) {
    if std::env::var("RUST_LOG").is_ok() {
        return;
    }
    let Some(h) = handle else {
        return;
    };
    if let Some(filter) = parse_log_level_setting(value) {
        if let Err(e) = h.reload(filter) {
            tracing::warn!(
                target: "mysql_client_lib::logging",
                "failed to reload log filter: {e}"
            );
        }
    }
}

fn bracket_level_event_format() -> Format<Full, SystemTime> {
    tracing_subscriber::fmt::format()
        .with_timer(SystemTime)
        .with_level(false)
        .with_target(true)
}

/// Writes `[LEVEL]` first, then the standard full line (timestamp, target, fields).
struct BracketLevelFormat {
    inner: Format<Full, SystemTime>,
}

impl BracketLevelFormat {
    fn new() -> Self {
        Self {
            inner: bracket_level_event_format(),
        }
    }
}

impl<S, N> FormatEvent<S, N> for BracketLevelFormat
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
    Format<Full, SystemTime>: FormatEvent<S, N>,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &tracing::Event<'_>,
    ) -> std::fmt::Result {
        write!(writer, "[{}] ", event.metadata().level().as_str())?;
        self.inner.format_event(ctx, writer, event)
    }
}

/// List log files matching `{stem}.{YYYY-MM-DD}.log` in `log_dir`.
fn list_dated_log_files(log_dir: &Path, stem: &str) -> io::Result<Vec<(NaiveDate, PathBuf)>> {
    let mut out = Vec::new();
    let prefix = format!("{stem}.");
    const SUFFIX: &str = ".log";
    for entry in fs::read_dir(log_dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !name.starts_with(&prefix) || !name.ends_with(SUFFIX) {
            continue;
        }
        let date_part = &name[prefix.len()..name.len() - SUFFIX.len()];
        if let Ok(d) = NaiveDate::parse_from_str(date_part, "%Y-%m-%d") {
            out.push((d, entry.path()));
        }
    }
    Ok(out)
}

/// Delete rotated log files older than seven days, preserving at least one file dated before today
/// when that would otherwise remove every pre-today file.
pub fn prune_old_logs(log_dir: &Path, stem: &str, today: NaiveDate) -> io::Result<()> {
    let files = list_dated_log_files(log_dir, stem)?;
    if files.is_empty() {
        return Ok(());
    }

    let cutoff = today
        .checked_sub_signed(chrono::Duration::days(7))
        .unwrap_or(today);

    let pre_today: Vec<(NaiveDate, PathBuf)> =
        files.iter().filter(|(d, _)| *d < today).cloned().collect();

    let mut stale_paths: Vec<PathBuf> = files
        .iter()
        .filter(|(d, _)| *d < cutoff)
        .map(|(_, p)| p.clone())
        .collect();

    if !pre_today.is_empty() {
        let would_remain: Vec<_> = pre_today
            .iter()
            .filter(|(_, p)| !stale_paths.contains(p))
            .collect();

        if would_remain.is_empty() {
            let (_, newest_path) = pre_today
                .iter()
                .max_by_key(|(d, _)| d)
                .expect("non-empty pre_today");
            stale_paths.retain(|p| p != newest_path);
        }
    }

    for path in stale_paths {
        if let Err(e) = fs::remove_file(&path) {
            tracing::warn!(
                target: "mysql_client_lib::logging",
                path = %path.display(),
                "failed to remove old log file: {e}"
            );
        }
    }

    Ok(())
}

fn build_initial_filter() -> EnvFilter {
    env_filter_from_rust_log().unwrap_or_else(default_env_filter)
}

/// Initialize global tracing subscriber (stderr + daily log file). Call once at app startup.
pub fn init_logging(log_dir: &Path) -> Result<LoggingInit, String> {
    let rust_log_env_set = std::env::var("RUST_LOG").is_ok();
    fs::create_dir_all(log_dir).map_err(|e| e.to_string())?;

    let today = Local::now().date_naive();
    prune_old_logs(log_dir, ROLLING_LOG_STEM, today).map_err(|e| e.to_string())?;

    let file_appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix(ROLLING_LOG_STEM)
        .filename_suffix("log")
        .build(log_dir)
        .map_err(|e| format!("rolling log appender: {e}"))?;
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let _ = LOG_WORKER_GUARD.set(guard);

    let initial_filter = build_initial_filter();
    let (reload_layer, reload_handle) = reload::Layer::new(initial_filter);

    let stderr_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stderr)
        .event_format(BracketLevelFormat::new());

    let file_layer = tracing_subscriber::fmt::layer()
        .with_writer(non_blocking)
        .with_ansi(false)
        .event_format(BracketLevelFormat::new());

    tracing_subscriber::registry()
        .with(reload_layer)
        .with(stderr_layer)
        .with(file_layer)
        .try_init()
        .map_err(|_| "tracing subscriber already initialized".to_string())?;

    Ok(LoggingInit {
        filter_reload: reload_handle,
        rust_log_env_set,
    })
}
