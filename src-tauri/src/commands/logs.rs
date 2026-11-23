use crate::commands::helpers::lock_connection;
#[cfg(not(coverage))]
use crate::commands::run_blocking_with_state;
use crate::export::csv_writer::write_csv;
use crate::logging::log_store::{self, LogPage};
use crate::state::AppState;
use crate::timestamps::log_timestamp;
use jiff::Timestamp;
use jiff::civil::{Date, Time};
use jiff::fmt::temporal::Pieces;
use jiff::tz::TimeZone;
use serde::Deserialize;
use serde_json::Value;
use std::fs::File;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevelFilter {
    All,
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl LogLevelFilter {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "all" => Ok(Self::All),
            "error" => Ok(Self::Error),
            "warn" => Ok(Self::Warn),
            "info" => Ok(Self::Info),
            "debug" => Ok(Self::Debug),
            "trace" => Ok(Self::Trace),
            other => Err(format!("invalid log level filter: {other}")),
        }
    }

    fn threshold(self) -> Option<i64> {
        match self {
            Self::All => None,
            Self::Error => Some(50),
            Self::Warn => Some(40),
            Self::Info => Some(30),
            Self::Debug => Some(20),
            Self::Trace => Some(10),
        }
    }
}

pub fn list_logs_impl(state: &AppState, request: &ListLogsRequest) -> Result<LogPage, String> {
    let filter = LogLevelFilter::parse(&request.level)?;
    let conn = lock_connection(&state.logs_db)?;
    let query = log_store::LogPageQuery {
        page: request.page,
        level_num: filter.threshold(),
        now: Timestamp::now(),
    };
    log_store::list_logs(&conn, &query).map_err(|error| error.to_string())
}

fn write_exported_logs_csv(
    file_path: &str,
    exported: &[log_store::LogEntry],
) -> Result<i64, String> {
    let mut file = File::create(file_path).map_err(|error| error.to_string())?;
    let columns = vec![
        "timestamp".to_string(),
        "level".to_string(),
        "message".to_string(),
    ];
    let rows = exported
        .iter()
        .map(|entry| {
            vec![
                Value::String(sanitize_export_cell(&entry.timestamp)),
                Value::String(sanitize_export_cell(&entry.level)),
                Value::String(sanitize_export_cell(&entry.message)),
            ]
        })
        .collect::<Vec<_>>();
    let table = crate::export::ExportRows {
        columns: &columns,
        rows: &rows,
    };
    write_csv(&mut file, &table, true).map_err(|error| error.to_string())?;

    i64::try_from(exported.len()).map_err(|_| "exported row count overflow".to_string())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportLogsRequest {
    pub start_timestamp: String,
    pub end_timestamp: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListLogsRequest {
    pub page: i64,
    pub level: String,
}

pub fn export_logs_impl(state: &AppState, request: &ExportLogsRequest) -> Result<i64, String> {
    let range = parse_export_range(&request.start_timestamp, &request.end_timestamp)?;
    let exported = {
        let conn = lock_connection(&state.logs_db)?;
        log_store::export_logs_in_range(&conn, &range.start_timestamp, &range.end_timestamp)
            .map_err(|error| error.to_string())?
    };

    write_exported_logs_csv(&request.file_path, &exported)
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_logs(payload: ListLogsRequest, app: tauri::AppHandle) -> Result<LogPage, String> {
    run_blocking_with_state(app, move |state| list_logs_impl(state, &payload)).await?
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn export_logs(payload: ExportLogsRequest, app: tauri::AppHandle) -> Result<i64, String> {
    run_blocking_with_state(app, move |state| export_logs_impl(state, &payload)).await?
}

struct ExportRange {
    start_timestamp: String,
    end_timestamp: String,
}

struct ParsedBoundary {
    timestamp_utc: Timestamp,
    local_date: Date,
}

const DATE_ONLY_FORMAT: &str = "%Y-%m-%d";

fn parse_export_range(start_timestamp: &str, end_timestamp: &str) -> Result<ExportRange, String> {
    let start = parse_boundary_date(start_timestamp, true)?;
    let end = parse_boundary_date(end_timestamp, false)?;

    if end.timestamp_utc < start.timestamp_utc {
        return Err("end_timestamp must be on or after start_timestamp".to_string());
    }

    let days_between = (end.local_date - start.local_date).get_days();
    let inclusive_days = i64::from(days_between) + 1;
    if inclusive_days > log_store::LOG_RETENTION_DAYS {
        return Err(format!(
            "log export range cannot exceed {} days",
            log_store::LOG_RETENTION_DAYS
        ));
    }

    Ok(ExportRange {
        start_timestamp: log_timestamp(start.timestamp_utc),
        end_timestamp: log_timestamp(end.timestamp_utc),
    })
}

fn boundary_time_of_day(is_start: bool) -> Time {
    if is_start {
        return Time::MIN;
    }
    Time::MAX
}

fn boundary_day_timestamp(date: Date, is_start: bool) -> Result<Timestamp, String> {
    let boundary = date.to_datetime(boundary_time_of_day(is_start));
    let zoned = boundary
        .to_zoned_datetime(TimeZone::UTC)
        .map_err(|error| format!("failed to resolve export boundary timestamp: {error}"))?;
    Ok(zoned.timestamp())
}

fn boundary_label(is_start: bool) -> &'static str {
    if is_start {
        return "start";
    }
    "end"
}

fn parse_boundary_date(value: &str, is_start: bool) -> Result<ParsedBoundary, String> {
    let trimmed = value.trim();
    if let Ok(date) = Date::strptime(DATE_ONLY_FORMAT, trimmed) {
        return Ok(ParsedBoundary {
            timestamp_utc: boundary_day_timestamp(date, is_start)?,
            local_date: date,
        });
    }

    let invalid_timestamp = || format!("invalid {} timestamp: {trimmed}", boundary_label(is_start));
    let instant = trimmed
        .parse::<Timestamp>()
        .map_err(|_| invalid_timestamp())?;
    let pieces = Pieces::parse(trimmed).map_err(|_| invalid_timestamp())?;
    Ok(ParsedBoundary {
        timestamp_utc: instant,
        local_date: pieces.date(),
    })
}

fn sanitize_export_cell(value: &str) -> String {
    match value.chars().next() {
        Some('=' | '+' | '-' | '@' | '\t' | '\r') => format!("'{value}"),
        _ => value.to_string(),
    }
}
