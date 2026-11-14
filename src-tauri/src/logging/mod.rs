use std::sync::OnceLock;
use tracing::Subscriber;
use tracing_subscriber::fmt::format::{Format, FormatEvent, FormatFields, Full, Writer};
use tracing_subscriber::fmt::time::SystemTime;
use tracing_subscriber::fmt::FmtContext;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::reload;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Registry};

pub mod log_store;
pub mod sqlite_layer;

pub const LOG_LEVEL_SETTING_KEY: &str = "log.level";

static SQLITE_LOG_WRITER_GUARD: OnceLock<sqlite_layer::SqliteLogWriterGuard> = OnceLock::new();

pub type LogFilterReloadHandle = reload::Handle<EnvFilter, Registry>;

pub struct LoggingInit {
    pub filter_reload: LogFilterReloadHandle,
    pub rust_log_env_set: bool,
}

fn default_env_filter() -> EnvFilter {
    EnvFilter::try_new("info,sqlx=warn").unwrap_or_else(|_| EnvFilter::new("info"))
}

fn env_filter_from_rust_log() -> Option<EnvFilter> {
    if std::env::var("RUST_LOG").is_err() {
        return None;
    }
    EnvFilter::try_from_default_env().ok()
}

pub fn parse_log_level_setting(setting: &str) -> Option<EnvFilter> {
    let level = setting.trim().to_lowercase();
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

pub fn apply_log_level_from_settings(conn: &rusqlite::Connection, handle: &LogFilterReloadHandle) {
    if std::env::var("RUST_LOG").is_ok() {
        return;
    }
    let Ok(Some(raw)) = crate::db::settings::get_setting(conn, LOG_LEVEL_SETTING_KEY) else {
        return;
    };
    if let Some(filter) = parse_log_level_setting(&raw) {
        if let Err(error) = handle.reload(filter) {
            tracing::warn!(
                target: "sqllumen_lib::logging",
                "failed to reload log filter from settings: {error}"
            );
        }
    }
}

pub fn reload_log_level_from_setting_value(handle: Option<&LogFilterReloadHandle>, value: &str) {
    if std::env::var("RUST_LOG").is_ok() {
        return;
    }
    let Some(reload_handle) = handle else {
        return;
    };
    if let Some(filter) = parse_log_level_setting(value) {
        if let Err(error) = reload_handle.reload(filter) {
            tracing::warn!(
                target: "sqllumen_lib::logging",
                "failed to reload log filter: {error}"
            );
        }
    }
}

const ANSI_RESET: &str = "\x1b[0m";

fn level_ansi_prefix(level: &tracing::Level) -> &'static str {
    match *level {
        tracing::Level::TRACE => "\x1b[2m",
        tracing::Level::DEBUG => "\x1b[36m",
        tracing::Level::INFO => "\x1b[32m",
        tracing::Level::WARN => "\x1b[1;33m",
        tracing::Level::ERROR => "\x1b[1;31m",
    }
}

fn bracket_level_event_format() -> Format<Full, SystemTime> {
    tracing_subscriber::fmt::format()
        .with_timer(SystemTime)
        .with_level(false)
        .with_target(true)
}

struct BracketLevelFormat {
    inner: Format<Full, SystemTime>,
    colored: bool,
}

impl BracketLevelFormat {
    fn new(colored: bool) -> Self {
        Self {
            inner: bracket_level_event_format(),
            colored,
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
        context: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &tracing::Event<'_>,
    ) -> std::fmt::Result {
        let level = event.metadata().level();
        self.write_level_tag(&mut writer, level)?;
        self.inner.format_event(context, writer, event)
    }
}

impl BracketLevelFormat {
    fn write_level_tag(&self, writer: &mut Writer<'_>, level: &tracing::Level) -> std::fmt::Result {
        if !self.colored {
            return write!(writer, "[{}] ", level.as_str());
        }
        write!(
            writer,
            "{}[{}]{} ",
            level_ansi_prefix(level),
            level.as_str(),
            ANSI_RESET
        )
    }
}

fn build_initial_filter() -> EnvFilter {
    env_filter_from_rust_log().unwrap_or_else(default_env_filter)
}

#[cfg(target_os = "windows")]
fn try_enable_windows_ansi_stderr() {
    use std::os::windows::io::AsRawHandle;
    const ENABLE_VIRTUAL_TERMINAL_PROCESSING: u32 = 0x0004;
    extern "system" {
        fn GetConsoleMode(hConsoleHandle: *mut core::ffi::c_void, lpMode: *mut u32) -> i32;
        fn SetConsoleMode(hConsoleHandle: *mut core::ffi::c_void, dwMode: u32) -> i32;
    }
    // SAFETY: the stderr handle comes from the stdlib and SetConsoleMode only runs after GetConsoleMode succeeds on it.
    unsafe {
        let handle = std::io::stderr().as_raw_handle() as *mut core::ffi::c_void;
        let mut mode: u32 = 0;
        if GetConsoleMode(handle, &mut mode) != 0 {
            SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn try_enable_windows_ansi_stderr() {}

fn stderr_wants_color() -> bool {
    std::env::var_os("NO_COLOR").is_none()
}

pub fn init_logging(log_db_path: &std::path::Path) -> Result<LoggingInit, String> {
    let rust_log_env_set = std::env::var("RUST_LOG").is_ok();

    try_enable_windows_ansi_stderr();

    let sqlite_layer::SqliteLogging {
        layer: sqlite_layer,
        guard: sqlite_guard,
    } = sqlite_layer::init_sqlite_layer(log_db_path)?;
    let _ = SQLITE_LOG_WRITER_GUARD.set(sqlite_guard);

    let initial_filter = build_initial_filter();
    let (reload_layer, reload_handle) = reload::Layer::new(initial_filter);

    let stderr_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stderr)
        .event_format(BracketLevelFormat::new(stderr_wants_color()));

    tracing_subscriber::registry()
        .with(reload_layer)
        .with(stderr_layer)
        .with(sqlite_layer)
        .try_init()
        .map_err(|_| "tracing subscriber already initialized".to_string())?;

    Ok(LoggingInit {
        filter_reload: reload_handle,
        rust_log_env_set,
    })
}
