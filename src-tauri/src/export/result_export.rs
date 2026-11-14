use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use serde::Deserialize;

use super::job_retention::cleanup_terminal_jobs;
use super::stream_writer::{RowSink, RowSinkSpec, RowWrite, XLSX_SHEET_ROW_LIMIT};
use super::ExportFormat;
use crate::mysql::query_executor::RunDatabase;
use crate::mysql::result_view::ResultSlotKey;
use crate::state::{
    AppState, ResultExportCancel, ResultExportJobProgress, ResultExportJobs, ResultExportStatus,
};

#[cfg(not(coverage))]
mod database_switch;
mod jobs;
mod pipeline;
mod rerun;
#[cfg(not(coverage))]
mod rerun_stream;
mod validation;
#[cfg(not(coverage))]
use database_switch::*;
pub use jobs::*;
pub use pipeline::*;
pub use rerun::*;
#[cfg(not(coverage))]
use rerun_stream::*;
pub use validation::*;

pub const FULL_EXPORT_UNAVAILABLE_MESSAGE: &str = "Full export isn't available for this result.";

pub const PROGRESS_REPORT_EVERY_ROWS: u64 = 256;

#[cfg(not(coverage))]
const EXPORT_KILL_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(1);

pub const CANCEL_KILL_WAIT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy)]
pub struct ExportKill<'a> {
    pub connection_id: &'a str,
    pub thread_id: u64,
    pub purpose: &'a str,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResultExportInput {
    #[serde(flatten)]
    pub slot: ResultSlotKey,
    pub format: ExportFormat,
    pub file_path: String,
    pub include_headers: bool,
    pub table_name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PreparedResultExport {
    pub job_id: String,
    pub connection_id: String,
    pub source_sql: String,
    pub run_database: RunDatabase,
    pub format: ExportFormat,
    pub target_path: PathBuf,
    pub temp_path: PathBuf,
    pub include_headers: bool,
    pub table_name: Option<String>,
    pub jobs: ResultExportJobs,
    pub cancel: Arc<ResultExportCancel>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExportOutcome {
    Completed,
    Cancelled,
    Failed(String),
}

pub fn temp_path_for(target: &Path) -> PathBuf {
    let mut name = target.as_os_str().to_os_string();
    name.push(".tmp");
    PathBuf::from(name)
}
