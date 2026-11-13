//! Streaming full export of a truncated, re-runnable query result.
//!
//! The job re-runs the result's source SQL on the connection's shared editor
//! session (ADR 2026-10-13), in the database the query originally ran in, with
//! no auto-LIMIT and no row ceiling, and pipes every decoded row into a
//! [`RowSink`]. Rows go to `<target>.tmp`, which is renamed to the target only
//! on success and deleted on cancel or failure, so the target is never left
//! half-written. Progress lives in `AppState::result_export_jobs` (the
//! `DumpJobProgress` pattern, with lazy cleanup of finished jobs).
//!
//! Database handling (plan D11): the job reads `SELECT DATABASE()` on the held
//! session. When the stored database differs from the current one it issues
//! `USE` for the stored database directly on the held connection (never through
//! `session::use_database`, which locks the session slot itself), and restores
//! the previous database afterwards on every outcome. A stored NULL database
//! issues no `USE`. A NULL previous database can't be restored (MySQL can't
//! switch back to "no database"), so that restore is skipped with a warning.
//!
//! Only the live-MySQL body (`run_result_export_job`, the KILL) is split into
//! a real implementation and a `#[cfg(coverage)]` stub. Validation, the job
//! bookkeeping and the [`ExportPipeline`] (sink, progress, rename, cleanup)
//! are coverage-visible.

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

/// Refusal for results that are not truncated, or can't be re-run safely.
pub const FULL_EXPORT_UNAVAILABLE_MESSAGE: &str = "Full export isn't available for this result.";

/// Progress is published to the job map every this many rows (and on the first row).
pub const PROGRESS_REPORT_EVERY_ROWS: u64 = 256;

/// Pool-acquire timeout for an export `KILL QUERY`, as for the ceiling KILL.
#[cfg(not(coverage))]
const EXPORT_KILL_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(1);

/// How long a finished re-run waits for in-flight cancel KILLs before it
/// releases the editor session: the KILL's 1 s pool acquire plus its round trip.
pub const CANCEL_KILL_WAIT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy)]
pub struct ExportKill<'a> {
    pub connection_id: &'a str,
    pub thread_id: u64,
    pub purpose: &'a str,
}

/// Input of `start_result_export` (the IPC arguments).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResultExportInput {
    #[serde(flatten)]
    pub slot: ResultSlotKey,
    pub format: ExportFormat,
    pub file_path: String,
    pub include_headers: bool,
    /// Table name for SQL INSERT output.
    pub table_name: Option<String>,
}

/// A validated, registered export job, ready to run.
#[derive(Debug, Clone)]
pub struct PreparedResultExport {
    pub job_id: String,
    pub connection_id: String,
    pub source_sql: String,
    /// The database the query ran in (never `NotCaptured`).
    pub run_database: RunDatabase,
    pub format: ExportFormat,
    pub target_path: PathBuf,
    pub temp_path: PathBuf,
    pub include_headers: bool,
    pub table_name: Option<String>,
    pub jobs: ResultExportJobs,
    /// The job's cancel state (read lock-free on the per-row hot path).
    pub cancel: Arc<ResultExportCancel>,
}

/// How the re-run ended, before the output file is finalized.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExportOutcome {
    Completed,
    Cancelled,
    Failed(String),
}

/// `<target>.tmp`, next to the target so the final rename stays on one volume.
pub fn temp_path_for(target: &Path) -> PathBuf {
    let mut name = target.as_os_str().to_os_string();
    name.push(".tmp");
    PathBuf::from(name)
}
