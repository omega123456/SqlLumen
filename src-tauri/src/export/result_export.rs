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

use super::stream_writer::{RowSink, RowWrite, XLSX_SHEET_ROW_LIMIT};
use super::ExportFormat;
use crate::mysql::query_executor::RunDatabase;
use crate::state::{
    AppState, ResultExportCancel, ResultExportJobProgress, ResultExportJobs, ResultExportStatus,
};

/// Refusal for results that are not truncated, or can't be re-run safely.
pub const FULL_EXPORT_UNAVAILABLE_MESSAGE: &str = "Full export isn't available for this result.";

/// Finished jobs are dropped this long after they end.
pub const RESULT_EXPORT_JOB_STALE_AFTER: Duration = Duration::from_secs(5 * 60);

/// Progress is published to the job map every this many rows (and on the first row).
pub const PROGRESS_REPORT_EVERY_ROWS: u64 = 256;

/// Pool-acquire timeout for an export `KILL QUERY`, as for the ceiling KILL.
#[cfg(not(coverage))]
const EXPORT_KILL_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(1);

/// How long a finished re-run waits for in-flight cancel KILLs before it
/// releases the editor session: the KILL's 1 s pool acquire plus its round trip.
pub const CANCEL_KILL_WAIT: Duration = Duration::from_secs(2);

/// Input of `start_result_export` (the IPC arguments).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResultExportInput {
    pub connection_id: String,
    pub tab_id: String,
    pub result_index: usize,
    pub query_id: String,
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

// ── Validation ────────────────────────────────────────────────────────────────

/// Check that the cached result exists, is current, is truncated and can be
/// re-run. Returns its source SQL and run database.
pub fn validate_full_export(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    result_index: usize,
    query_id: &str,
) -> Result<(String, RunDatabase), String> {
    let cached = state.result_cache.get(connection_id, tab_id);
    if cached.is_expired() {
        return Err(crate::mysql::result_view::RESULTS_EXPIRED_MESSAGE.to_string());
    }
    let entry = cached
        .into_entry()
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;
    let stored = entry.value.get(result_index).ok_or_else(|| {
        format!(
            "Result index {result_index} out of range (total: {})",
            entry.value.len()
        )
    })?;
    if stored.query_id != query_id {
        return Err(crate::mysql::result_view::STALE_QUERY_MESSAGE.to_string());
    }
    let rerunnable = stored.truncated
        && stored.full_export_blocked_reason.is_none()
        && stored.run_database != RunDatabase::NotCaptured
        && !stored.source_sql.trim().is_empty();
    if !rerunnable {
        return Err(FULL_EXPORT_UNAVAILABLE_MESSAGE.to_string());
    }
    Ok((stored.source_sql.clone(), stored.run_database.clone()))
}

/// Validate the request and register a running job. The caller then runs
/// [`run_result_export_job`] in the background and returns the job id.
pub fn start_result_export_impl(
    state: &AppState,
    input: StartResultExportInput,
) -> Result<PreparedResultExport, String> {
    if input.file_path.trim().is_empty() {
        return Err("Choose a file to export to.".to_string());
    }
    let (source_sql, run_database) = validate_full_export(
        state,
        &input.connection_id,
        &input.tab_id,
        input.result_index,
        &input.query_id,
    )?;
    let job_id = uuid::Uuid::new_v4().to_string();
    let cancel = register_job(&state.result_export_jobs, &job_id, &input.connection_id);
    let target_path = PathBuf::from(&input.file_path);
    tracing::info!(
        job_id,
        connection_id = input.connection_id,
        tab_id = input.tab_id,
        result_index = input.result_index,
        format = ?input.format,
        "result export: job started"
    );
    Ok(PreparedResultExport {
        job_id,
        connection_id: input.connection_id,
        source_sql,
        run_database,
        format: input.format,
        temp_path: temp_path_for(&target_path),
        target_path,
        include_headers: input.include_headers,
        table_name: input.table_name,
        jobs: state.result_export_jobs.clone(),
        cancel,
    })
}

// ── Job bookkeeping ───────────────────────────────────────────────────────────

fn write_jobs(
    jobs: &ResultExportJobs,
) -> std::sync::RwLockWriteGuard<'_, HashMap<String, ResultExportJobProgress>> {
    jobs.write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn update_job(jobs: &ResultExportJobs, job_id: &str, f: impl FnOnce(&mut ResultExportJobProgress)) {
    if let Some(job) = write_jobs(jobs).get_mut(job_id) {
        f(job);
    }
}

/// Drop finished jobs that ended more than [`RESULT_EXPORT_JOB_STALE_AFTER`] ago.
pub fn cleanup_stale_jobs(jobs: &mut HashMap<String, ResultExportJobProgress>) {
    let now = SystemTime::now();
    jobs.retain(|_, job| match job.completed_at {
        Some(completed_at) => now
            .duration_since(completed_at)
            .map_or(true, |age| age < RESULT_EXPORT_JOB_STALE_AFTER),
        None => true,
    });
}

/// Register a running job for `connection_id` (cleaning up stale ones first).
/// Returns the job's shared cancel state.
pub fn register_job(
    jobs: &ResultExportJobs,
    job_id: &str,
    connection_id: &str,
) -> Arc<ResultExportCancel> {
    let mut map = write_jobs(jobs);
    cleanup_stale_jobs(&mut map);
    let cancel = Arc::new(ResultExportCancel::default());
    map.insert(
        job_id.to_string(),
        ResultExportJobProgress {
            status: ResultExportStatus::Running,
            rows_written: 0,
            bytes_written: 0,
            elapsed_ms: 0,
            stopped_at_sheet_limit: false,
            error: None,
            job_id: job_id.to_string(),
            cancel_requested: false,
            mysql_thread_id: None,
            connection_id: connection_id.to_string(),
            started_at: Instant::now(),
            completed_at: None,
            cancel: Arc::clone(&cancel),
        },
    );
    cancel
}

/// Record (or clear) the editor-session thread the job's re-run streams on.
pub fn set_job_thread(jobs: &ResultExportJobs, job_id: &str, thread_id: Option<u64>) {
    update_job(jobs, job_id, |job| job.mysql_thread_id = thread_id);
}

/// True when cancel was requested for the job (or the job is unknown).
pub fn is_cancel_requested(jobs: &ResultExportJobs, job_id: &str) -> bool {
    jobs.read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(job_id)
        .is_none_or(|job| job.cancel_requested)
}

/// A cancel `KILL QUERY` registered against a streaming job. The job waits
/// for it (see [`wait_for_cancel_kills`]) before releasing the editor session.
/// Dropping it marks the KILL finished, whether or not it was sent.
#[derive(Debug)]
pub struct CancelKill {
    pub thread_id: u64,
    pub connection_id: String,
    cancel: Arc<ResultExportCancel>,
}

impl CancelKill {
    /// Record that the KILL reached the server.
    pub fn mark_sent(&self) {
        self.cancel.kill_sent.store(true, Ordering::SeqCst);
    }
}

impl Drop for CancelKill {
    fn drop(&mut self) {
        self.cancel.kills_in_flight.fetch_sub(1, Ordering::SeqCst);
        self.cancel.kill_done.notify_waiters();
    }
}

/// Flag a job for cancellation. Returns the KILL to send when the job is
/// running and its re-run is streaming. The KILL is registered under the
/// job-map write lock, so once the job clears its thread id no new KILL can
/// target its session.
pub fn request_cancel(jobs: &ResultExportJobs, job_id: &str) -> Result<Option<CancelKill>, String> {
    let mut map = write_jobs(jobs);
    let job = map
        .get_mut(job_id)
        .ok_or_else(|| format!("Export job '{job_id}' not found"))?;
    if job.status != ResultExportStatus::Running {
        return Ok(None);
    }
    job.cancel_requested = true;
    job.cancel.requested.store(true, Ordering::SeqCst);
    Ok(job.mysql_thread_id.map(|thread_id| {
        job.cancel.kills_in_flight.fetch_add(1, Ordering::SeqCst);
        CancelKill {
            thread_id,
            connection_id: job.connection_id.clone(),
            cancel: Arc::clone(&job.cancel),
        }
    }))
}

/// Wait until every registered cancel KILL of a job has finished, at most
/// `timeout`. Returns `false` (with a warning) when the wait timed out.
pub async fn wait_for_cancel_kills(
    cancel: &ResultExportCancel,
    job_id: &str,
    timeout: Duration,
) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        // Register for the notification before checking, so a KILL that
        // finishes in between still wakes this task.
        let notified = cancel.kill_done.notified();
        if cancel.kills_in_flight.load(Ordering::SeqCst) == 0 {
            return true;
        }
        if tokio::time::timeout_at(deadline, notified).await.is_err() {
            tracing::warn!(
                job_id,
                "result export: a cancel KILL QUERY is still in flight; releasing the session anyway"
            );
            return false;
        }
    }
}

/// Ids of the running jobs of one connection.
pub fn running_job_ids_for_connection(jobs: &ResultExportJobs, connection_id: &str) -> Vec<String> {
    let map = jobs.read().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut ids: Vec<String> = map
        .values()
        .filter(|job| {
            job.status == ResultExportStatus::Running && job.connection_id == connection_id
        })
        .map(|job| job.job_id.clone())
        .collect();
    ids.sort();
    ids
}

/// Progress of a job (`get_result_export_progress`). A running job reports
/// its live elapsed time.
pub fn get_result_export_progress_impl(
    state: &AppState,
    job_id: &str,
) -> Result<ResultExportJobProgress, String> {
    let mut map = write_jobs(&state.result_export_jobs);
    cleanup_stale_jobs(&mut map);
    let job = map
        .get(job_id)
        .ok_or_else(|| format!("Export job '{job_id}' not found"))?;
    let mut progress = job.clone();
    if progress.status == ResultExportStatus::Running {
        progress.elapsed_ms = progress.started_at.elapsed().as_millis() as u64;
    }
    Ok(progress)
}

/// Cancel a job: flag it, then `KILL QUERY` its re-run if it is streaming. A
/// job still queued for the session sees the flag when it gets the session.
pub async fn cancel_result_export_impl(state: &AppState, job_id: &str) -> Result<(), String> {
    if let Some(kill) = request_cancel(&state.result_export_jobs, job_id)? {
        tracing::info!(
            job_id,
            connection_id = kill.connection_id,
            thread_id = kill.thread_id,
            "result export: cancel requested"
        );
        if kill_export_query(state, &kill.connection_id, kill.thread_id, "cancel").await {
            kill.mark_sent();
        }
    }
    Ok(())
}

/// Cancel every running export of a connection. Called by `close_connection`
/// before the registry entry (and so the pool the KILL needs) is removed.
pub async fn cancel_result_exports_for_connection(state: &AppState, connection_id: &str) {
    for job_id in running_job_ids_for_connection(&state.result_export_jobs, connection_id) {
        if let Err(error) = cancel_result_export_impl(state, &job_id).await {
            tracing::warn!(
                job_id,
                connection_id,
                error,
                "result export: cancel on close failed"
            );
        }
    }
}

// ── Pipeline: sink, progress, finalize ────────────────────────────────────────

/// The export's output side: the sink on the temp file, progress reporting,
/// and the final rename or cleanup. Coverage-visible, so tests drive it with
/// synthetic rows.
pub struct ExportPipeline {
    jobs: ResultExportJobs,
    job_id: String,
    format: ExportFormat,
    temp_path: PathBuf,
    target_path: PathBuf,
    include_headers: bool,
    table_name: Option<String>,
    sheet_row_limit: u32,
    sink: Option<RowSink>,
}

impl ExportPipeline {
    pub fn new(prepared: &PreparedResultExport) -> Self {
        Self {
            jobs: prepared.jobs.clone(),
            job_id: prepared.job_id.clone(),
            format: prepared.format.clone(),
            temp_path: prepared.temp_path.clone(),
            target_path: prepared.target_path.clone(),
            include_headers: prepared.include_headers,
            table_name: prepared.table_name.clone(),
            sheet_row_limit: XLSX_SHEET_ROW_LIMIT,
            sink: None,
        }
    }

    /// Override the XLSX sheet row limit (test seam).
    pub fn with_sheet_row_limit(mut self, sheet_row_limit: u32) -> Self {
        self.sheet_row_limit = sheet_row_limit;
        self
    }

    /// Create the temp file and write the header for the re-run's columns.
    pub fn open(&mut self, columns: &[String]) -> Result<(), String> {
        let sink = RowSink::create_with_sheet_row_limit(
            &self.format,
            &self.temp_path,
            columns,
            self.include_headers,
            self.table_name.as_deref(),
            self.sheet_row_limit,
        )?;
        self.sink = Some(sink);
        Ok(())
    }

    /// Write one row and publish progress on the first row and every
    /// [`PROGRESS_REPORT_EVERY_ROWS`] rows.
    pub fn accept_row(&mut self, row: &[serde_json::Value]) -> Result<RowWrite, String> {
        let sink = self
            .sink
            .as_mut()
            .ok_or_else(|| "The export file is not open.".to_string())?;
        let outcome = sink.write_row(row)?;
        let rows = sink.rows_written();
        if outcome == RowWrite::Written && (rows == 1 || rows % PROGRESS_REPORT_EVERY_ROWS == 0) {
            let bytes = sink.bytes_written();
            update_job(&self.jobs, &self.job_id, |job| {
                job.rows_written = rows;
                job.bytes_written = bytes;
            });
        }
        Ok(outcome)
    }

    /// Finish the job: on success, finish the file and rename it onto the
    /// target; otherwise delete the temp file and leave the target untouched.
    /// A cancel request turns a completed re-run into a cancelled export.
    /// `restore_error` (a failed database restore) is reported in the job's
    /// error without failing a completed export. Returns the final status.
    pub fn complete(
        mut self,
        outcome: ExportOutcome,
        restore_error: Option<String>,
    ) -> ResultExportStatus {
        let outcome = if outcome == ExportOutcome::Completed
            && is_cancel_requested(&self.jobs, &self.job_id)
        {
            ExportOutcome::Cancelled
        } else {
            outcome
        };
        let mut rows_written = self.sink.as_ref().map_or(0, RowSink::rows_written);
        let mut bytes_written = self.sink.as_ref().map_or(0, RowSink::bytes_written);
        let mut stopped_at_sheet_limit = false;

        let (status, mut error) = match outcome {
            ExportOutcome::Completed => match self.finish_file() {
                Ok(summary) => {
                    rows_written = summary.rows_written;
                    bytes_written = summary.bytes_written;
                    stopped_at_sheet_limit = summary.stopped_at_sheet_limit;
                    (ResultExportStatus::Completed, None)
                }
                Err(message) => (ResultExportStatus::Failed, Some(message)),
            },
            ExportOutcome::Cancelled => (ResultExportStatus::Cancelled, None),
            ExportOutcome::Failed(message) => (ResultExportStatus::Failed, Some(message)),
        };
        if status != ResultExportStatus::Completed {
            self.sink = None;
            self.remove_temp_file();
        }
        if let Some(restore) = restore_error {
            error = Some(match error {
                Some(message) => format!("{message} {restore}"),
                None => restore,
            });
        }

        match status {
            ResultExportStatus::Completed => tracing::info!(
                job_id = self.job_id,
                rows_written,
                bytes_written,
                stopped_at_sheet_limit,
                "result export: completed"
            ),
            ResultExportStatus::Cancelled => {
                tracing::info!(job_id = self.job_id, "result export: cancelled")
            }
            _ => tracing::warn!(job_id = self.job_id, ?error, "result export: failed"),
        }

        update_job(&self.jobs, &self.job_id, |job| {
            job.status = status;
            job.rows_written = rows_written;
            job.bytes_written = bytes_written;
            job.stopped_at_sheet_limit = stopped_at_sheet_limit;
            job.error = error;
            job.mysql_thread_id = None;
            job.elapsed_ms = job.started_at.elapsed().as_millis() as u64;
            job.completed_at = Some(SystemTime::now());
        });
        status
    }

    fn finish_file(&mut self) -> Result<super::stream_writer::StreamSummary, String> {
        let sink = self
            .sink
            .take()
            .ok_or_else(|| "The query returned no result set to export.".to_string())?;
        let summary = sink.finish()?;
        std::fs::rename(&self.temp_path, &self.target_path)
            .map_err(|e| format!("Failed to save the export file: {e}"))?;
        Ok(summary)
    }

    fn remove_temp_file(&self) {
        match std::fs::remove_file(&self.temp_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => tracing::warn!(
                job_id = self.job_id,
                path = %self.temp_path.display(),
                %error,
                "result export: couldn't delete the temp file"
            ),
        }
    }
}

// ── Live MySQL: the re-run ────────────────────────────────────────────────────

/// Issue `KILL QUERY <thread_id>` over a pool connection (1 s acquire timeout).
/// Returns `false`, with a warning, when it could not be sent.
#[cfg(not(coverage))]
pub async fn kill_export_query(
    state: &AppState,
    connection_id: &str,
    thread_id: u64,
    purpose: &str,
) -> bool {
    let Some(pool) = state.registry.get_pool(connection_id) else {
        tracing::warn!(
            connection_id,
            thread_id,
            purpose,
            "result export: no pool for KILL QUERY"
        );
        return false;
    };
    let mut conn = match tokio::time::timeout(EXPORT_KILL_ACQUIRE_TIMEOUT, pool.acquire()).await {
        Ok(Ok(conn)) => conn,
        Ok(Err(error)) => {
            tracing::warn!(connection_id, thread_id, purpose, %error, "result export: no pool connection for KILL QUERY");
            return false;
        }
        Err(_) => {
            tracing::warn!(
                connection_id,
                thread_id,
                purpose,
                "result export: no pool connection for KILL QUERY within 1 s"
            );
            return false;
        }
    };
    let kill_sql = format!("KILL QUERY {thread_id}");
    tracing::debug!(
        connection_id,
        thread_id,
        purpose,
        "result export: issuing KILL QUERY"
    );
    crate::mysql::query_log::log_outgoing_sql(&kill_sql);
    match sqlx::query(sqlx::AssertSqlSafe(kill_sql.as_str()))
        .execute(&mut *conn)
        .await
    {
        Ok(result) => {
            crate::mysql::query_log::log_execute_result(&result);
            true
        }
        Err(error) => {
            crate::mysql::query_log::log_execute_error(&error);
            tracing::warn!(connection_id, thread_id, purpose, %error, "result export: KILL QUERY failed");
            false
        }
    }
}

/// Coverage stub: the KILL needs a live pool.
#[cfg(coverage)]
pub async fn kill_export_query(
    state: &AppState,
    connection_id: &str,
    _thread_id: u64,
    _purpose: &str,
) -> bool {
    state.registry.get_pool(connection_id).is_some()
}

/// Run a registered export job to its end: re-run, stream, restore, finalize.
#[cfg(not(coverage))]
pub async fn run_result_export_job(state: &AppState, prepared: PreparedResultExport) {
    let mut pipeline = ExportPipeline::new(&prepared);
    let (outcome, restore_error) = rerun_into_pipeline(state, &prepared, &mut pipeline).await;
    pipeline.complete(outcome, restore_error);
}

/// Coverage stub: the re-run needs a live editor session, so the job fails
/// (and cleans up) without touching MySQL.
#[cfg(coverage)]
pub async fn run_result_export_job(state: &AppState, prepared: PreparedResultExport) {
    let message = if state.registry.contains(&prepared.connection_id) {
        "Full export needs a live MySQL session.".to_string()
    } else {
        format!(
            "Connection '{}' not found in registry",
            prepared.connection_id
        )
    };
    let outcome = if is_cancel_requested(&prepared.jobs, &prepared.job_id) {
        ExportOutcome::Cancelled
    } else {
        ExportOutcome::Failed(message)
    };
    ExportPipeline::new(&prepared).complete(outcome, None);
}

/// Acquire the editor session and stream the re-run into the pipeline.
/// Returns the outcome and, if the database restore failed, its message.
#[cfg(not(coverage))]
async fn rerun_into_pipeline(
    state: &AppState,
    prepared: &PreparedResultExport,
    pipeline: &mut ExportPipeline,
) -> (ExportOutcome, Option<String>) {
    if is_cancel_requested(&prepared.jobs, &prepared.job_id) {
        return (ExportOutcome::Cancelled, None);
    }
    // Queue behind any running editor query (ADR 2026-10-13).
    let mut guard = match crate::mysql::session::acquire(state, &prepared.connection_id).await {
        Ok(guard) => guard,
        Err(error) => return (ExportOutcome::Failed(error), None),
    };
    let session = guard.as_mut().expect("acquire always yields a session");
    let thread_id = session.thread_id;
    set_job_thread(&prepared.jobs, &prepared.job_id, Some(thread_id));

    let mut restore_to = None;
    let mut stream = StreamEnd {
        outcome: ExportOutcome::Cancelled,
        interrupted: false,
        own_kill_sent: false,
    };
    // A cancel that arrived while the job was queued had no thread to KILL.
    if !prepared.cancel.requested.load(Ordering::SeqCst) {
        match switch_to_run_database(&mut session.conn, prepared).await {
            Ok(previous) => {
                restore_to = previous;
                stream =
                    stream_rerun(state, &mut session.conn, prepared, pipeline, thread_id).await;
            }
            Err(_) if prepared.cancel.requested.load(Ordering::SeqCst) => {}
            Err(error) => stream.outcome = ExportOutcome::Failed(error),
        }
    }

    // From here on no cancel KILL can target the session. Wait for the ones
    // already registered, so none of them reaches the next query that runs on
    // the shared session after it is released.
    set_job_thread(&prepared.jobs, &prepared.job_id, None);
    wait_for_cancel_kills(&prepared.cancel, &prepared.job_id, CANCEL_KILL_WAIT).await;
    let kill_sent = stream.own_kill_sent || prepared.cancel.kill_sent.load(Ordering::SeqCst);
    if kill_sent && !stream.interrupted {
        // The KILL may have arrived after the statement ended: absorb it here.
        crate::mysql::multi_result::absorb_late_kill(&mut session.conn, &prepared.connection_id)
            .await;
    }

    let restore_error = match restore_to {
        Some(previous) => {
            restore_database(&mut session.conn, &prepared.connection_id, previous).await
        }
        None => None,
    };
    drop(guard);
    (stream.outcome, restore_error)
}

/// Issue a logged `USE` for `database` on the held connection.
#[cfg(not(coverage))]
async fn use_database_on(
    conn: &mut mysql_async::Conn,
    database: &str,
) -> Result<(), mysql_async::Error> {
    use mysql_async::prelude::Queryable;

    let sql = match crate::mysql::schema_queries::safe_identifier(database) {
        Ok(identifier) => format!("USE {identifier}"),
        Err(message) => {
            return Err(mysql_async::Error::Other(message.into()));
        }
    };
    crate::mysql::query_log::log_outgoing_sql(&sql);
    conn.query_drop(&sql).await.inspect_err(|error| {
        crate::mysql::query_log::log_mysql_async_error(error);
    })
}

/// Read the session's current database and switch to the stored run
/// database when it differs. Returns what to restore afterwards: `None` when
/// no `USE` was issued, `Some(previous)` otherwise (`previous` is `None` when
/// the session had no database).
#[cfg(not(coverage))]
async fn switch_to_run_database(
    conn: &mut mysql_async::Conn,
    prepared: &PreparedResultExport,
) -> Result<Option<Option<String>>, String> {
    use mysql_async::prelude::Queryable;

    let sql = "SELECT DATABASE()";
    crate::mysql::query_log::log_outgoing_sql(sql);
    let current: Option<String> = conn
        .query_first::<Option<String>, _>(sql)
        .await
        .map_err(|error| {
            crate::mysql::query_log::log_mysql_async_error(&error);
            format!("Couldn't read the session's database: {error}")
        })?
        .flatten();

    match &prepared.run_database {
        RunDatabase::Named(database) if current.as_deref() != Some(database.as_str()) => {
            use_database_on(conn, database).await.map_err(|error| {
                tracing::warn!(
                    job_id = prepared.job_id,
                    database,
                    ?error,
                    "result export: couldn't switch to the query's database"
                );
                format!("Couldn't switch to database '{database}': {error}")
            })?;
            Ok(Some(current))
        }
        _ => Ok(None),
    }
}

/// Restore the session's previous database after the re-run. Retries once on
/// error 1317, which a late export `KILL QUERY` can cause. A NULL previous
/// database can't be restored and is skipped with a warning.
#[cfg(not(coverage))]
async fn restore_database(
    conn: &mut mysql_async::Conn,
    connection_id: &str,
    previous: Option<String>,
) -> Option<String> {
    let Some(previous) = previous else {
        tracing::warn!(
            connection_id,
            "result export: the session had no database before the export; it stays on the query's database"
        );
        return None;
    };
    let mut result = use_database_on(conn, &previous).await;
    if matches!(&result, Err(error) if crate::mysql::multi_result::is_query_interrupted(error)) {
        result = use_database_on(conn, &previous).await;
    }
    match result {
        Ok(()) => None,
        Err(error) => {
            tracing::warn!(
                connection_id,
                database = previous,
                ?error,
                "result export: couldn't restore the session's database"
            );
            Some(format!(
                "The session couldn't switch back to database '{previous}': {error}"
            ))
        }
    }
}

/// How the re-run's stream ended.
#[cfg(not(coverage))]
struct StreamEnd {
    outcome: ExportOutcome,
    /// The statement ended with error 1317, which consumed any KILL sent so far.
    interrupted: bool,
    /// The job sent its own KILL (sheet limit or write failure).
    own_kill_sent: bool,
}

/// Re-run the source SQL (no auto-LIMIT, no ceiling) and write every row.
#[cfg(not(coverage))]
async fn stream_rerun(
    state: &AppState,
    conn: &mut mysql_async::Conn,
    prepared: &PreparedResultExport,
    pipeline: &mut ExportPipeline,
    thread_id: u64,
) -> StreamEnd {
    use crate::mysql::multi_result::{is_query_interrupted, map_mysql_error, serialize_row};
    use mysql_async::prelude::Queryable;

    let cancel_requested = || prepared.cancel.requested.load(Ordering::Relaxed);
    crate::mysql::query_log::log_outgoing_sql(&prepared.source_sql);
    let mut result = match conn.query_iter(prepared.source_sql.as_str()).await {
        Ok(result) => result,
        Err(error) => {
            let interrupted = is_query_interrupted(&error);
            let outcome = if interrupted && cancel_requested() {
                ExportOutcome::Cancelled
            } else {
                ExportOutcome::Failed(map_mysql_error(&error))
            };
            return StreamEnd {
                outcome,
                interrupted,
                own_kill_sent: false,
            };
        }
    };

    let columns: Vec<String> = result
        .columns_ref()
        .iter()
        .map(|c| c.name_str().to_string())
        .collect();
    let col_types: Vec<_> = result
        .columns_ref()
        .iter()
        .map(|c| (c.column_type(), c.flags()))
        .collect();

    let mut failure: Option<String> = None;
    // Once set, rows are read and discarded until the stream ends.
    let mut stopping = false;
    let mut interrupted = false;
    let mut own_kill_sent = false;
    if let Err(error) = pipeline.open(&columns) {
        failure = Some(error);
        stopping = true;
        own_kill_sent |=
            kill_export_query(state, &prepared.connection_id, thread_id, "write failure").await;
    }

    let mut row_index = 0usize;
    loop {
        match result.next().await {
            Ok(Some(row)) => {
                if stopping {
                    continue;
                }
                if cancel_requested() {
                    // The cancel KILL did not stop the stream: drain it instead.
                    stopping = true;
                    continue;
                }
                crate::mysql::query_log::log_mysql_async_row(row_index, &row);
                row_index += 1;
                let values = serialize_row(&row, &col_types);
                match pipeline.accept_row(&values) {
                    Ok(RowWrite::Written) => {}
                    Ok(RowWrite::SheetLimitReached) => {
                        stopping = true;
                        own_kill_sent |= kill_export_query(
                            state,
                            &prepared.connection_id,
                            thread_id,
                            "sheet limit",
                        )
                        .await;
                    }
                    Err(error) => {
                        failure = Some(error);
                        stopping = true;
                        own_kill_sent |= kill_export_query(
                            state,
                            &prepared.connection_id,
                            thread_id,
                            "write failure",
                        )
                        .await;
                    }
                }
            }
            Ok(None) => break,
            Err(error) if is_query_interrupted(&error) && (stopping || cancel_requested()) => {
                crate::mysql::query_log::log_mysql_async_error(&error);
                interrupted = true;
                break;
            }
            Err(error) => {
                interrupted = is_query_interrupted(&error);
                if failure.is_none() {
                    failure = Some(map_mysql_error(&error));
                }
                break;
            }
        }
    }
    crate::mysql::query_log::log_mysql_async_row_count(row_index);
    drop(result);

    let outcome = match failure {
        Some(message) => ExportOutcome::Failed(message),
        None if cancel_requested() => ExportOutcome::Cancelled,
        None => ExportOutcome::Completed,
    };
    StreamEnd {
        outcome,
        interrupted,
        own_kill_sent,
    }
}
