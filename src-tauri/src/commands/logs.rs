//! Tauri IPC command wrappers for structured application logs.
//!
//! Under `cfg(coverage)`, the Tauri command wrappers are excluded and tests
//! exercise the `*_impl` functions directly.

use crate::export::csv_writer::write_csv;
use crate::logging::log_store::{self, LogPage};
use crate::state::AppState;
use chrono::{DateTime, NaiveDate, NaiveTime, SecondsFormat, TimeZone, Utc};
use rusqlite::Connection;
use serde_json::Value;
use std::fs::File;
use std::sync::{Arc, MutexGuard};

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

fn lock_logs_db(state: &AppState) -> Result<MutexGuard<'_, Connection>, String> {
    match state.logs_db.lock() {
        Ok(conn) => Ok(conn),
        Err(error) => Err(error.to_string()),
    }
}

pub fn list_logs_impl(state: &AppState, page: i64, level: &str) -> Result<LogPage, String> {
    let filter = LogLevelFilter::parse(level)?;
    let conn = lock_logs_db(state)?;
    log_store::list_logs(&conn, page, filter.threshold(), Utc::now()).map_err(|e| e.to_string())
}

fn write_exported_logs_csv(
    file_path: &str,
    exported: &[log_store::LogEntry],
) -> Result<i64, String> {
    let mut file = File::create(file_path).map_err(|e| e.to_string())?;
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
    write_csv(&mut file, &columns, &rows, true).map_err(|e| e.to_string())?;

    i64::try_from(exported.len()).map_err(|_| "exported row count overflow".to_string())
}

pub fn export_logs_impl(
    state: &AppState,
    start_timestamp: &str,
    end_timestamp: &str,
    file_path: &str,
) -> Result<i64, String> {
    let range = parse_export_range(start_timestamp, end_timestamp)?;
    let exported = {
        let conn = lock_logs_db(state)?;
        log_store::export_logs_in_range(&conn, &range.start_timestamp, &range.end_timestamp)
            .map_err(|e| e.to_string())?
    };

    write_exported_logs_csv(file_path, &exported)
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_logs(
    page: i64,
    level: String,
    state: tauri::State<'_, AppState>,
) -> Result<LogPage, String> {
    let threshold = LogLevelFilter::parse(&level)?.threshold();
    let logs_db = Arc::clone(&state.logs_db);
    // Runs off the main thread so a slow query never freezes the WebView. Note that
    // `logs_db` is a single shared connection, so this lock serializes against log
    // ingestion for the duration of the query.
    tauri::async_runtime::spawn_blocking(move || {
        let conn = logs_db.lock().map_err(|e| e.to_string())?;
        log_store::list_logs(&conn, page, threshold, Utc::now()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn export_logs(
    start_timestamp: String,
    end_timestamp: String,
    file_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<i64, String> {
    let range = parse_export_range(&start_timestamp, &end_timestamp)?;
    let logs_db = Arc::clone(&state.logs_db);
    tauri::async_runtime::spawn_blocking(move || {
        let exported = {
            let conn = logs_db.lock().map_err(|e| e.to_string())?;
            log_store::export_logs_in_range(&conn, &range.start_timestamp, &range.end_timestamp)
                .map_err(|e| e.to_string())?
        };
        write_exported_logs_csv(&file_path, &exported)
    })
    .await
    .map_err(|e| e.to_string())?
}

struct ExportRange {
    start_timestamp: String,
    end_timestamp: String,
}

struct ParsedBoundary {
    timestamp_utc: DateTime<Utc>,
    local_date: NaiveDate,
}

fn parse_export_range(start_timestamp: &str, end_timestamp: &str) -> Result<ExportRange, String> {
    let start = parse_boundary_date(start_timestamp, true)?;
    let end = parse_boundary_date(end_timestamp, false)?;

    if end.timestamp_utc < start.timestamp_utc {
        return Err("end_timestamp must be on or after start_timestamp".to_string());
    }

    let inclusive_days = end
        .local_date
        .signed_duration_since(start.local_date)
        .num_days()
        + 1;
    if inclusive_days > log_store::LOG_RETENTION_DAYS {
        return Err(format!(
            "log export range cannot exceed {} days",
            log_store::LOG_RETENTION_DAYS
        ));
    }

    Ok(ExportRange {
        start_timestamp: start
            .timestamp_utc
            .to_rfc3339_opts(SecondsFormat::Millis, true),
        end_timestamp: end
            .timestamp_utc
            .to_rfc3339_opts(SecondsFormat::Millis, true),
    })
}

fn parse_boundary_date(value: &str, is_start: bool) -> Result<ParsedBoundary, String> {
    let trimmed = value.trim();
    if let Ok(date) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        let timestamp_utc = if is_start {
            Utc.from_utc_datetime(&date.and_time(NaiveTime::MIN))
        } else {
            Utc.from_utc_datetime(
                &date
                    .and_hms_milli_opt(23, 59, 59, 999)
                    .ok_or_else(|| "failed to resolve export end timestamp".to_string())?,
            )
        };
        return Ok(ParsedBoundary {
            timestamp_utc,
            local_date: date,
        });
    }

    let parsed = DateTime::parse_from_rfc3339(trimmed).map_err(|_| {
        format!(
            "invalid {} timestamp: {trimmed}",
            if is_start { "start" } else { "end" }
        )
    })?;
    Ok(ParsedBoundary {
        timestamp_utc: parsed.with_timezone(&Utc),
        local_date: parsed.date_naive(),
    })
}

fn sanitize_export_cell(value: &str) -> String {
    match value.chars().next() {
        Some('=' | '+' | '-' | '@' | '\t' | '\r') => format!("'{value}"),
        _ => value.to_string(),
    }
}
