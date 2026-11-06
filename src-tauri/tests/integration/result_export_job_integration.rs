//! Streaming full-export job bookkeeping without MySQL (coverage-visible):
//! validation and refusals, job state transitions, progress accounting, the
//! temp-file rename on success, cleanup on cancel and failure, lazy cleanup of
//! finished jobs and the connection-scoped cancel lookup.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};
use sqllumen_lib::commands::mysql::close_connection_impl;
use sqllumen_lib::export::result_export::{
    cancel_result_export_impl, cancel_result_exports_for_connection, cleanup_stale_jobs,
    get_result_export_progress_impl, is_cancel_requested, register_job, request_cancel,
    run_result_export_job, running_job_ids_for_connection, set_job_thread,
    start_result_export_impl, temp_path_for, validate_full_export, wait_for_cancel_kills,
    ExportOutcome, ExportPipeline, PreparedResultExport, StartResultExportInput,
    FULL_EXPORT_UNAVAILABLE_MESSAGE, PROGRESS_REPORT_EVERY_ROWS, RESULT_EXPORT_JOB_STALE_AFTER,
};
use sqllumen_lib::export::stream_writer::RowWrite;
use sqllumen_lib::export::ExportFormat;
use sqllumen_lib::mysql::query_executor::{
    ColumnMeta, FullExportBlockedReason, RunDatabase, StoredResult,
};
use sqllumen_lib::mysql::result_view::{RESULTS_EXPIRED_MESSAGE, STALE_QUERY_MESSAGE};
use sqllumen_lib::state::{AppState, ResultExportStatus};

use crate::common;
use crate::common::log_capture::LogCaptureGuard;

const CONN: &str = "conn-export";
const TAB: &str = "tab-export";
const QID: &str = "query-export";

fn truncated_result() -> StoredResult {
    let mut stored = StoredResult::new(
        QID.to_string(),
        vec![ColumnMeta {
            name: "n".to_string(),
            data_type: "BIGINT".to_string(),
        }],
        common::shared_rows(vec![vec![json!(1)], vec![json!(2)]]),
        1,
        2,
        0,
        false,
    );
    stored.truncated = true;
    stored.row_ceiling = 2;
    stored.source_sql = "SELECT n FROM big".to_string();
    stored.run_database = RunDatabase::Named("shop".to_string());
    stored
}

fn state_with(stored: StoredResult) -> AppState {
    let state = common::test_app_state();
    state.result_cache.insert(CONN, TAB, vec![stored]);
    state
}

fn input(file_path: &Path, format: ExportFormat) -> StartResultExportInput {
    StartResultExportInput {
        connection_id: CONN.to_string(),
        tab_id: TAB.to_string(),
        result_index: 0,
        query_id: QID.to_string(),
        format,
        file_path: file_path.to_string_lossy().into_owned(),
        include_headers: true,
        table_name: None,
    }
}

fn prepare(state: &AppState, target: &Path, format: ExportFormat) -> PreparedResultExport {
    start_result_export_impl(state, input(target, format)).expect("start")
}

fn status(state: &AppState, job_id: &str) -> ResultExportStatus {
    get_result_export_progress_impl(state, job_id)
        .expect("progress")
        .status
}

fn rows(count: usize) -> Vec<Vec<Value>> {
    (0..count).map(|i| vec![json!(i)]).collect()
}

// ── Validation ────────────────────────────────────────────────────────────────

#[test]
fn temp_path_appends_tmp_to_the_target() {
    assert_eq!(
        temp_path_for(Path::new("/exports/result.csv")),
        PathBuf::from("/exports/result.csv.tmp")
    );
}

#[test]
fn a_truncated_rerunnable_result_validates() {
    let state = state_with(truncated_result());
    let (sql, database) = validate_full_export(&state, CONN, TAB, 0, QID).expect("valid");
    assert_eq!(sql, "SELECT n FROM big");
    assert_eq!(database, RunDatabase::Named("shop".to_string()));

    let mut no_database = truncated_result();
    no_database.run_database = RunDatabase::NoDatabase;
    let state = state_with(no_database);
    let (_, database) = validate_full_export(&state, CONN, TAB, 0, QID).expect("valid");
    assert_eq!(database, RunDatabase::NoDatabase);
}

#[test]
fn results_that_cannot_be_rerun_are_refused() {
    let mut untruncated = truncated_result();
    untruncated.truncated = false;
    let mut call = truncated_result();
    call.full_export_blocked_reason = Some(FullExportBlockedReason::Call);
    let mut locking = truncated_result();
    locking.full_export_blocked_reason = Some(FullExportBlockedReason::Locking);
    let mut unknown = truncated_result();
    unknown.full_export_blocked_reason = Some(FullExportBlockedReason::UnknownDatabase);
    let mut not_captured = truncated_result();
    not_captured.run_database = RunDatabase::NotCaptured;
    let mut no_sql = truncated_result();
    no_sql.source_sql = "  ".to_string();

    for stored in [untruncated, call, locking, unknown, not_captured, no_sql] {
        let state = state_with(stored);
        let dir = tempfile::tempdir().expect("dir");
        let error =
            start_result_export_impl(&state, input(&dir.path().join("x.csv"), ExportFormat::Csv))
                .expect_err("refused");
        assert_eq!(error, FULL_EXPORT_UNAVAILABLE_MESSAGE);
        assert!(
            state.result_export_jobs.read().expect("jobs").is_empty(),
            "a refused export registers no job"
        );
    }
}

#[test]
fn missing_stale_and_expired_results_are_refused() {
    let state = common::test_app_state();
    let error = validate_full_export(&state, CONN, TAB, 0, QID).expect_err("no results");
    assert!(error.contains("No results found"), "{error}");

    let state = state_with(truncated_result());
    let error = validate_full_export(&state, CONN, TAB, 3, QID).expect_err("index");
    assert!(error.contains("out of range"), "{error}");
    let error = validate_full_export(&state, CONN, TAB, 0, "older-query").expect_err("stale");
    assert_eq!(error, STALE_QUERY_MESSAGE);

    state.result_cache.remove(CONN, TAB);
    let error = validate_full_export(&state, CONN, TAB, 0, QID).expect_err("expired");
    assert_eq!(error, RESULTS_EXPIRED_MESSAGE);
}

#[test]
fn an_empty_file_path_is_refused() {
    let state = state_with(truncated_result());
    let error = start_result_export_impl(&state, input(Path::new("  "), ExportFormat::Csv))
        .expect_err("refused");
    assert_eq!(error, "Choose a file to export to.");
}

// ── Job registration, progress and cancel bookkeeping ─────────────────────────

#[test]
fn starting_registers_a_running_job_with_its_connection() {
    let state = state_with(truncated_result());
    let dir = tempfile::tempdir().expect("dir");
    let target = dir.path().join("out.csv");
    let prepared = prepare(&state, &target, ExportFormat::Csv);

    assert_eq!(prepared.connection_id, CONN);
    assert_eq!(prepared.source_sql, "SELECT n FROM big");
    assert_eq!(prepared.target_path, target);
    assert_eq!(prepared.temp_path, temp_path_for(&target));
    let progress = get_result_export_progress_impl(&state, &prepared.job_id).expect("progress");
    assert_eq!(progress.status, ResultExportStatus::Running);
    assert_eq!(progress.connection_id, CONN);
    assert_eq!(progress.rows_written, 0);
    assert!(!progress.cancel_requested);
    assert_eq!(
        running_job_ids_for_connection(&state.result_export_jobs, CONN),
        vec![prepared.job_id.clone()]
    );

    // IPC shape: exactly the contract's camelCase fields.
    let value = serde_json::to_value(&progress).expect("serialize");
    let mut keys: Vec<&str> = value
        .as_object()
        .expect("object")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        vec![
            "bytesWritten",
            "elapsedMs",
            "error",
            "rowsWritten",
            "status",
            "stoppedAtSheetLimit"
        ]
    );
    assert_eq!(value["status"], json!("running"));

    let error = get_result_export_progress_impl(&state, "nope").expect_err("unknown");
    assert_eq!(error, "Export job 'nope' not found");
}

#[test]
fn running_progress_reports_live_elapsed_time() {
    let state = common::test_app_state();
    register_job(&state.result_export_jobs, "job-1", CONN);
    std::thread::sleep(Duration::from_millis(15));
    let progress = get_result_export_progress_impl(&state, "job-1").expect("progress");
    assert!(progress.elapsed_ms >= 15, "{}", progress.elapsed_ms);
}

#[test]
fn cancel_requests_flag_the_job_and_return_the_kill_target() {
    let jobs = common::test_app_state().result_export_jobs;
    register_job(&jobs, "job-1", CONN);

    assert!(request_cancel(&jobs, "missing").is_err());
    assert!(
        is_cancel_requested(&jobs, "missing"),
        "unknown jobs count as cancelled"
    );

    assert!(!is_cancel_requested(&jobs, "job-1"));
    let queued_cancel = register_job(&jobs, "job-1b", CONN);
    assert!(request_cancel(&jobs, "job-1").expect("queued").is_none());
    assert!(is_cancel_requested(&jobs, "job-1"));
    assert!(
        !queued_cancel.requested.load(Ordering::SeqCst),
        "other jobs untouched"
    );

    let cancel = register_job(&jobs, "job-2", CONN);
    set_job_thread(&jobs, "job-2", Some(42));
    let kill = request_cancel(&jobs, "job-2")
        .expect("streaming")
        .expect("a KILL target");
    assert_eq!((kill.thread_id, kill.connection_id.as_str()), (42, CONN));
    assert!(cancel.requested.load(Ordering::SeqCst));
    assert_eq!(cancel.kills_in_flight.load(Ordering::SeqCst), 1);
    kill.mark_sent();
    drop(kill);
    assert_eq!(cancel.kills_in_flight.load(Ordering::SeqCst), 0);
    assert!(cancel.kill_sent.load(Ordering::SeqCst));
    set_job_thread(&jobs, "job-2", None);
    assert!(request_cancel(&jobs, "job-2").expect("between").is_none());
    assert_eq!(
        cancel.kills_in_flight.load(Ordering::SeqCst),
        0,
        "no KILL registers once the thread id is cleared"
    );

    // A finished job is not cancelled again.
    register_job(&jobs, "job-3", CONN);
    jobs.write()
        .expect("jobs")
        .get_mut("job-3")
        .expect("job")
        .status = ResultExportStatus::Completed;
    assert!(request_cancel(&jobs, "job-3").expect("done").is_none());
    assert!(!is_cancel_requested(&jobs, "job-3"));
}

#[tokio::test]
async fn the_job_waits_for_an_in_flight_cancel_kill_before_releasing_the_session() {
    let jobs = common::test_app_state().result_export_jobs;
    let cancel = register_job(&jobs, "job-1", CONN);
    // No KILL registered: returns at once.
    assert!(wait_for_cancel_kills(&cancel, "job-1", Duration::from_secs(1)).await);

    set_job_thread(&jobs, "job-1", Some(7));
    let kill = request_cancel(&jobs, "job-1")
        .expect("streaming")
        .expect("a KILL target");
    set_job_thread(&jobs, "job-1", None);

    let finished = Arc::new(AtomicBool::new(false));
    let waiter = {
        let cancel = Arc::clone(&cancel);
        let finished = Arc::clone(&finished);
        tokio::spawn(async move {
            let drained = wait_for_cancel_kills(&cancel, "job-1", Duration::from_secs(2)).await;
            finished.store(true, Ordering::SeqCst);
            drained
        })
    };
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(
        !finished.load(Ordering::SeqCst),
        "the session is held while the KILL is in flight"
    );
    drop(kill);
    assert!(
        waiter.await.expect("waiter"),
        "the wait ends when the KILL finishes"
    );
}

#[tokio::test]
async fn the_wait_for_a_stuck_cancel_kill_times_out() {
    let capture = LogCaptureGuard::start();
    let jobs = common::test_app_state().result_export_jobs;
    let cancel = register_job(&jobs, "job-1", CONN);
    set_job_thread(&jobs, "job-1", Some(7));
    let _kill = request_cancel(&jobs, "job-1")
        .expect("streaming")
        .expect("a KILL target");

    assert!(!wait_for_cancel_kills(&cancel, "job-1", Duration::from_millis(20)).await);
    assert!(capture
        .contents()
        .contains("a cancel KILL QUERY is still in flight"));
}

#[test]
fn the_connection_lookup_returns_only_that_connections_running_jobs() {
    let jobs = common::test_app_state().result_export_jobs;
    register_job(&jobs, "b", CONN);
    register_job(&jobs, "a", CONN);
    register_job(&jobs, "other", "conn-other");
    register_job(&jobs, "done", CONN);
    jobs.write()
        .expect("jobs")
        .get_mut("done")
        .expect("job")
        .status = ResultExportStatus::Failed;

    assert_eq!(
        running_job_ids_for_connection(&jobs, CONN),
        vec!["a".to_string(), "b".to_string()]
    );
    assert_eq!(
        running_job_ids_for_connection(&jobs, "conn-other"),
        vec!["other".to_string()]
    );
    assert!(running_job_ids_for_connection(&jobs, "conn-none").is_empty());
}

#[test]
fn stale_finished_jobs_are_cleaned_up_lazily() {
    let state = common::test_app_state();
    register_job(&state.result_export_jobs, "old", CONN);
    register_job(&state.result_export_jobs, "recent", CONN);
    register_job(&state.result_export_jobs, "running", CONN);
    {
        let mut jobs = state.result_export_jobs.write().expect("jobs");
        let old = jobs.get_mut("old").expect("old");
        old.status = ResultExportStatus::Completed;
        old.completed_at =
            Some(SystemTime::now() - RESULT_EXPORT_JOB_STALE_AFTER - Duration::from_secs(1));
        let recent = jobs.get_mut("recent").expect("recent");
        recent.status = ResultExportStatus::Cancelled;
        recent.completed_at = Some(SystemTime::now());
        // A clock that went backwards keeps the job.
        let mut future = recent.clone();
        future.completed_at = Some(SystemTime::now() + Duration::from_secs(60));
        jobs.insert("future".to_string(), future);
    }

    let mut map = state.result_export_jobs.read().expect("jobs").clone();
    cleanup_stale_jobs(&mut map);
    assert!(!map.contains_key("old"));

    assert!(get_result_export_progress_impl(&state, "old").is_err());
    for kept in ["recent", "running", "future"] {
        assert!(
            get_result_export_progress_impl(&state, kept).is_ok(),
            "{kept}"
        );
    }
}

#[tokio::test]
async fn cancel_commands_flag_jobs_and_tolerate_a_missing_pool() {
    let state = common::test_app_state();
    register_job(&state.result_export_jobs, "job-1", CONN);
    set_job_thread(&state.result_export_jobs, "job-1", Some(7));
    register_job(&state.result_export_jobs, "job-2", CONN);
    register_job(&state.result_export_jobs, "job-other", "conn-other");

    cancel_result_export_impl(&state, "job-1")
        .await
        .expect("cancel without a pool still succeeds");
    assert!(is_cancel_requested(&state.result_export_jobs, "job-1"));
    assert!(cancel_result_export_impl(&state, "missing").await.is_err());

    cancel_result_exports_for_connection(&state, CONN).await;
    assert!(is_cancel_requested(&state.result_export_jobs, "job-2"));
    assert!(!is_cancel_requested(&state.result_export_jobs, "job-other"));
}

#[tokio::test]
async fn closing_a_connection_cancels_its_export_jobs_first() {
    let state = common::test_app_state();
    register_job(&state.result_export_jobs, "job-1", CONN);
    register_job(&state.result_export_jobs, "job-other", "conn-other");

    let error = close_connection_impl(&state, CONN)
        .await
        .expect_err("the connection is not open");
    assert!(error.contains("is not open"), "{error}");
    assert!(is_cancel_requested(&state.result_export_jobs, "job-1"));
    assert!(!is_cancel_requested(&state.result_export_jobs, "job-other"));
}

// ── Pipeline: progress, rename and cleanup ────────────────────────────────────

#[test]
fn a_completed_export_renames_the_temp_file_onto_the_target() {
    let state = state_with(truncated_result());
    let dir = tempfile::tempdir().expect("dir");
    let target = dir.path().join("out.csv");
    std::fs::write(&target, "previous export").expect("existing target");
    let prepared = prepare(&state, &target, ExportFormat::Csv);

    let mut pipeline = ExportPipeline::new(&prepared);
    pipeline.open(&["n".to_string()]).expect("open");
    assert!(prepared.temp_path.exists(), "rows stream to the temp file");
    assert_eq!(
        std::fs::read_to_string(&target).expect("target"),
        "previous export",
        "the target is untouched while streaming"
    );

    let total = PROGRESS_REPORT_EVERY_ROWS as usize + 10;
    for (i, row) in rows(total).iter().enumerate() {
        assert_eq!(pipeline.accept_row(row).expect("row"), RowWrite::Written);
        let reported = get_result_export_progress_impl(&state, &prepared.job_id)
            .expect("progress")
            .rows_written;
        let expected = if i + 1 >= PROGRESS_REPORT_EVERY_ROWS as usize {
            PROGRESS_REPORT_EVERY_ROWS
        } else {
            1
        };
        assert_eq!(reported, expected, "after row {}", i + 1);
    }

    assert_eq!(
        pipeline.complete(ExportOutcome::Completed, None),
        ResultExportStatus::Completed
    );
    let progress = get_result_export_progress_impl(&state, &prepared.job_id).expect("progress");
    assert_eq!(progress.status, ResultExportStatus::Completed);
    assert_eq!(progress.rows_written, total as u64);
    let contents = std::fs::read_to_string(&target).expect("target");
    assert_eq!(progress.bytes_written, contents.len() as u64);
    assert!(contents.starts_with("n\n0\n1\n"));
    assert_eq!(contents.lines().count(), total + 1);
    assert!(progress.completed_at.is_some());
    assert!(progress.error.is_none());
    assert!(!prepared.temp_path.exists());

    // A finished job's elapsed time is frozen.
    let frozen = progress.elapsed_ms;
    std::thread::sleep(Duration::from_millis(5));
    assert_eq!(
        get_result_export_progress_impl(&state, &prepared.job_id)
            .expect("progress")
            .elapsed_ms,
        frozen
    );
}

#[test]
fn cancelled_and_failed_exports_delete_the_temp_file_and_keep_the_target() {
    for outcome in [
        ExportOutcome::Cancelled,
        ExportOutcome::Failed("Query failed: boom".to_string()),
    ] {
        let state = state_with(truncated_result());
        let dir = tempfile::tempdir().expect("dir");
        let target = dir.path().join("out.json");
        std::fs::write(&target, "keep me").expect("existing target");
        let prepared = prepare(&state, &target, ExportFormat::Json);
        let mut pipeline = ExportPipeline::new(&prepared);
        pipeline.open(&["n".to_string()]).expect("open");
        pipeline.accept_row(&[json!(1)]).expect("row");

        let expected = match &outcome {
            ExportOutcome::Cancelled => ResultExportStatus::Cancelled,
            _ => ResultExportStatus::Failed,
        };
        let expected_error = match &outcome {
            ExportOutcome::Failed(message) => Some(message.clone()),
            _ => None,
        };
        assert_eq!(pipeline.complete(outcome, None), expected);
        assert!(!prepared.temp_path.exists());
        assert_eq!(std::fs::read_to_string(&target).expect("target"), "keep me");
        let progress = get_result_export_progress_impl(&state, &prepared.job_id).expect("progress");
        assert_eq!(progress.status, expected);
        assert_eq!(progress.error, expected_error);
        assert_eq!(progress.rows_written, 1);
    }
}

#[test]
fn a_cancel_request_turns_a_completed_rerun_into_a_cancelled_export() {
    let state = state_with(truncated_result());
    let dir = tempfile::tempdir().expect("dir");
    let target = dir.path().join("out.sql");
    let prepared = prepare(&state, &target, ExportFormat::SqlInsert);
    let mut pipeline = ExportPipeline::new(&prepared);
    pipeline.open(&["n".to_string()]).expect("open");
    pipeline.accept_row(&[json!(1)]).expect("row");
    request_cancel(&state.result_export_jobs, &prepared.job_id).expect("cancel");

    assert_eq!(
        pipeline.complete(ExportOutcome::Completed, None),
        ResultExportStatus::Cancelled
    );
    assert!(!target.exists());
    assert!(!prepared.temp_path.exists());
}

#[test]
fn completing_without_an_open_file_or_with_a_failed_rename_fails() {
    let state = state_with(truncated_result());
    let dir = tempfile::tempdir().expect("dir");
    let prepared = prepare(&state, &dir.path().join("never.csv"), ExportFormat::Csv);
    let mut pipeline = ExportPipeline::new(&prepared);
    let error = pipeline.accept_row(&[json!(1)]).expect_err("not open");
    assert_eq!(error, "The export file is not open.");
    assert_eq!(
        pipeline.complete(ExportOutcome::Completed, None),
        ResultExportStatus::Failed
    );
    assert_eq!(
        get_result_export_progress_impl(&state, &prepared.job_id)
            .expect("progress")
            .error
            .as_deref(),
        Some("The query returned no result set to export.")
    );

    // The target is a non-empty directory, so the rename fails.
    let target = dir.path().join("taken");
    std::fs::create_dir(&target).expect("dir target");
    std::fs::write(target.join("inside"), "x").expect("file");
    let prepared = prepare(&state, &target, ExportFormat::Csv);
    let mut pipeline = ExportPipeline::new(&prepared);
    pipeline.open(&["n".to_string()]).expect("open");
    pipeline.accept_row(&[json!(1)]).expect("row");
    assert_eq!(
        pipeline.complete(ExportOutcome::Completed, None),
        ResultExportStatus::Failed
    );
    let error = get_result_export_progress_impl(&state, &prepared.job_id)
        .expect("progress")
        .error
        .expect("error");
    assert!(
        error.starts_with("Failed to save the export file:"),
        "{error}"
    );
    assert!(!prepared.temp_path.exists());
    assert!(target.join("inside").exists());
}

#[test]
fn a_failed_open_surfaces_the_writer_error() {
    let state = state_with(truncated_result());
    let dir = tempfile::tempdir().expect("dir");
    let prepared = prepare(
        &state,
        &dir.path().join("missing").join("out.csv"),
        ExportFormat::Csv,
    );
    let mut pipeline = ExportPipeline::new(&prepared);
    let error = pipeline.open(&["n".to_string()]).expect_err("missing dir");
    assert!(error.starts_with("Failed to create file:"), "{error}");
    assert_eq!(
        pipeline.complete(ExportOutcome::Failed(error), None),
        ResultExportStatus::Failed
    );
}

#[test]
fn a_restore_failure_is_reported_without_failing_a_completed_export() {
    let state = state_with(truncated_result());
    let dir = tempfile::tempdir().expect("dir");
    let target = dir.path().join("out.csv");
    let prepared = prepare(&state, &target, ExportFormat::Csv);
    let mut pipeline = ExportPipeline::new(&prepared);
    pipeline.open(&["n".to_string()]).expect("open");
    let restore = "The session couldn't switch back to database 'crm': denied".to_string();
    assert_eq!(
        pipeline.complete(ExportOutcome::Completed, Some(restore.clone())),
        ResultExportStatus::Completed
    );
    let progress = get_result_export_progress_impl(&state, &prepared.job_id).expect("progress");
    assert_eq!(progress.error, Some(restore.clone()));
    assert!(target.exists());

    let prepared = prepare(&state, &dir.path().join("failed.csv"), ExportFormat::Csv);
    let pipeline = ExportPipeline::new(&prepared);
    pipeline.complete(
        ExportOutcome::Failed("Query failed: x".to_string()),
        Some(restore),
    );
    let progress = get_result_export_progress_impl(&state, &prepared.job_id).expect("progress");
    assert_eq!(
        progress.error.as_deref(),
        Some("Query failed: x The session couldn't switch back to database 'crm': denied")
    );
}

#[test]
fn an_xlsx_export_that_hits_the_sheet_limit_reports_it() {
    let state = state_with(truncated_result());
    let dir = tempfile::tempdir().expect("dir");
    let target = dir.path().join("out.xlsx");
    let prepared = prepare(&state, &target, ExportFormat::Xlsx);
    let mut pipeline = ExportPipeline::new(&prepared).with_sheet_row_limit(3);
    pipeline.open(&["n".to_string()]).expect("open");
    let outcomes: Vec<RowWrite> = rows(4)
        .iter()
        .map(|row| pipeline.accept_row(row).expect("row"))
        .collect();
    assert_eq!(outcomes[2], RowWrite::SheetLimitReached);
    assert_eq!(
        pipeline.complete(ExportOutcome::Completed, None),
        ResultExportStatus::Completed
    );
    let progress = get_result_export_progress_impl(&state, &prepared.job_id).expect("progress");
    assert!(progress.stopped_at_sheet_limit);
    assert_eq!(progress.rows_written, 2);
    assert!(target.exists());
}

#[tokio::test]
async fn a_job_without_an_open_connection_fails_and_writes_nothing() {
    let state = Arc::new(state_with(truncated_result()));
    let dir = tempfile::tempdir().expect("dir");
    let target = dir.path().join("out.csv");
    let prepared = prepare(&state, &target, ExportFormat::Csv);
    let job_id = prepared.job_id.clone();
    let temp = prepared.temp_path.clone();

    let task_state = Arc::clone(&state);
    tokio::spawn(async move { run_result_export_job(&task_state, prepared).await })
        .await
        .expect("job task");

    assert_eq!(status(&state, &job_id), ResultExportStatus::Failed);
    let error = get_result_export_progress_impl(&state, &job_id)
        .expect("progress")
        .error
        .expect("error");
    assert!(error.contains("not found in registry"), "{error}");
    assert!(!target.exists());
    assert!(!temp.exists());
}

#[tokio::test]
async fn a_job_cancelled_before_it_starts_ends_cancelled() {
    let state = state_with(truncated_result());
    let dir = tempfile::tempdir().expect("dir");
    let prepared = prepare(&state, &dir.path().join("out.csv"), ExportFormat::Csv);
    let job_id = prepared.job_id.clone();
    cancel_result_export_impl(&state, &job_id)
        .await
        .expect("cancel");
    run_result_export_job(&state, prepared).await;
    assert_eq!(status(&state, &job_id), ResultExportStatus::Cancelled);
}
