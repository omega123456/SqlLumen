//! Streaming full export against the in-process mock MySQL server: the job
//! lifecycle, rows beyond the ceiling, no injected LIMIT, the `USE` of the
//! original database and its restore (including the NULL cases), cancel via
//! the mock's kill hook, a mid-stream failure, refusal for CALL and locking
//! results, and `close_connection` cancelling a running export.
//!
//! Omitted from `cargo sqllumen-llvm-cov`, like the other mock-server suites:
//! instrumented builds hit sqlx pool-acquire timeouts against the mock. The
//! job bookkeeping is covered by `result_export_job_integration.rs`.

#![cfg(not(coverage))]

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use opensrv_mysql::{ColumnFlags, ColumnType, ErrorKind};
use serde_json::json;
use sqllumen_lib::commands::connections::{save_connection_impl, SaveConnectionInput};
use sqllumen_lib::commands::mysql::{close_connection_impl, open_connection_impl};
use sqllumen_lib::export::result_export::{
    cancel_result_export_impl, get_result_export_progress_impl, run_result_export_job,
    start_result_export_impl, temp_path_for, StartResultExportInput,
    FULL_EXPORT_UNAVAILABLE_MESSAGE,
};
use sqllumen_lib::export::ExportFormat;
use sqllumen_lib::mysql::query_executor::{
    execute_call_query_impl, execute_query_impl, ColumnMeta, RunDatabase, StoredResult,
};
use sqllumen_lib::state::{AppState, ResultExportJobProgress, ResultExportStatus};

use crate::common;
use crate::common::log_capture::LogCaptureGuard;
use crate::common::mock_mysql_server::{
    MockCell, MockColumnDef, MockMySqlServer, MockQueryStep, MockScript, MockStreamStep,
};

const TAB: &str = "tab-1";
const QID: &str = "stored-query";

fn n_column() -> Vec<MockColumnDef> {
    vec![MockColumnDef {
        name: "n",
        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
        colflags: ColumnFlags::empty(),
    }]
}

fn n_row(index: usize) -> Vec<MockCell> {
    vec![MockCell::I64(index as i64)]
}

fn connection_id_step() -> MockQueryStep {
    MockQueryStep {
        query: "SELECT CONNECTION_ID()",
        columns: vec![MockColumnDef {
            name: "CONNECTION_ID()",
            coltype: ColumnType::MYSQL_TYPE_LONGLONG,
            colflags: ColumnFlags::UNSIGNED_FLAG,
        }],
        rows: vec![vec![MockCell::U64(42)]],
        error: None,
        affected_rows: None,
    }
}

/// `SELECT DATABASE()` answers `database` (`None` = NULL) on every call.
fn database_step(database: Option<&'static [u8]>) -> MockQueryStep {
    MockQueryStep {
        query: "SELECT DATABASE()",
        columns: vec![MockColumnDef {
            name: "DATABASE()",
            coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
            colflags: ColumnFlags::empty(),
        }],
        rows: vec![vec![database.map_or(MockCell::Null, MockCell::Bytes)]],
        error: None,
        affected_rows: None,
    }
}

/// A kill-aware stream paused `pause` after every row.
fn killable_stream(query: &'static str, rows: usize, pause: Duration) -> MockStreamStep {
    MockStreamStep {
        throttle: Some((1, pause)),
        stops_on_kill: true,
        ..MockStreamStep::new(query, n_column(), rows, n_row)
    }
}

fn script(mut steps: Vec<MockQueryStep>, stream_steps: Vec<MockStreamStep>) -> MockScript {
    steps.insert(0, connection_id_step());
    MockScript {
        steps,
        stream_steps,
        ..MockScript::default()
    }
}

/// Start the mock, open a connection to it and set the row ceiling.
async fn open(script: MockScript, ceiling: usize) -> (MockMySqlServer, Arc<AppState>, String) {
    let server = MockMySqlServer::start_with(script).await;
    let state = common::test_app_state();
    let profile_id = save_connection_impl(
        &state,
        SaveConnectionInput {
            name: "Export mock".to_string(),
            host: "127.0.0.1".to_string(),
            port: i64::from(server.port),
            username: "root".to_string(),
            password: None,
            default_database: None,
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            color: None,
            group_id: None,
            read_only: false,
            sort_order: 0,
            connect_timeout_secs: Some(2),
            keepalive_interval_secs: Some(0),
        },
    )
    .expect("save connection");
    let opened = open_connection_impl(&state, &profile_id)
        .await
        .expect("open connection");
    state.result_cache.set_row_ceiling(ceiling);
    (server, Arc::new(state), opened.session_id)
}

/// Cache a truncated, re-runnable result (as a ceiling-truncated run leaves it).
fn cache_truncated(state: &AppState, conn: &str, sql: &str, database: RunDatabase) {
    let mut stored = StoredResult::new(
        QID.to_string(),
        vec![ColumnMeta {
            name: "n".to_string(),
            data_type: "BIGINT".to_string(),
        }],
        common::shared_rows((0..5).map(|i| vec![json!(i)]).collect()),
        1,
        2,
        0,
        false,
    );
    stored.truncated = true;
    stored.row_ceiling = 5;
    stored.source_sql = sql.to_string();
    stored.run_database = database;
    state.result_cache.insert(conn, TAB, vec![stored]);
}

fn input(conn: &str, query_id: &str, target: &Path) -> StartResultExportInput {
    StartResultExportInput {
        connection_id: conn.to_string(),
        tab_id: TAB.to_string(),
        result_index: 0,
        query_id: query_id.to_string(),
        format: ExportFormat::Csv,
        file_path: target.to_string_lossy().into_owned(),
        include_headers: true,
        table_name: None,
    }
}

/// Start the job in the background; returns its id and task.
fn spawn_export(
    state: &Arc<AppState>,
    conn: &str,
    query_id: &str,
    target: &Path,
) -> (String, tokio::task::JoinHandle<()>) {
    let prepared = start_result_export_impl(state, input(conn, query_id, target)).expect("start");
    let job_id = prepared.job_id.clone();
    let task_state = Arc::clone(state);
    let handle = tokio::spawn(async move { run_result_export_job(&task_state, prepared).await });
    (job_id, handle)
}

fn progress(state: &AppState, job_id: &str) -> ResultExportJobProgress {
    get_result_export_progress_impl(state, job_id).expect("progress")
}

/// Poll until `done` holds, returning every progress snapshot seen.
async fn poll_until(
    state: &AppState,
    job_id: &str,
    done: impl Fn(&ResultExportJobProgress) -> bool,
) -> Vec<ResultExportJobProgress> {
    let deadline = Instant::now() + Duration::from_millis(1_500);
    let mut seen = Vec::new();
    loop {
        let snapshot = progress(state, job_id);
        let finished = done(&snapshot);
        seen.push(snapshot);
        if finished {
            return seen;
        }
        assert!(Instant::now() < deadline, "timed out: {:?}", seen.last());
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

async fn finish(
    state: &AppState,
    job_id: &str,
    handle: tokio::task::JoinHandle<()>,
) -> ResultExportJobProgress {
    handle.await.expect("job task");
    progress(state, job_id)
}

fn target_in(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().join("result.csv")
}

fn texts(server: &MockMySqlServer) -> Vec<String> {
    server.text_queries()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_truncated_result_is_rerun_in_full_with_monotonic_progress() {
    let started = Instant::now();
    let sql = "SELECT n FROM big LIMIT 1000000";
    let (server, state, conn) = open(
        script(
            vec![database_step(Some(b"shop"))],
            vec![killable_stream(sql, 40, Duration::from_millis(2))],
        ),
        5,
    )
    .await;
    let run = execute_query_impl(&state, &conn, TAB, sql, 500, None)
        .await
        .expect("truncated run");
    assert!(run.truncated);
    assert_eq!(run.total_rows, 5);

    let dir = tempfile::tempdir().expect("dir");
    let target = target_in(&dir);
    let (job_id, handle) = spawn_export(&state, &conn, &run.query_id, &target);
    let seen = poll_until(&state, &job_id, |p| p.status != ResultExportStatus::Running).await;
    let done = finish(&state, &job_id, handle).await;

    assert_eq!(
        done.status,
        ResultExportStatus::Completed,
        "{:?}",
        done.error
    );
    assert_eq!(done.rows_written, 40, "every row, past the ceiling of 5");
    assert!(done.error.is_none());
    let counts: Vec<u64> = seen.iter().map(|p| p.rows_written).collect();
    assert!(counts.windows(2).all(|w| w[0] <= w[1]), "{counts:?}");
    let contents = std::fs::read_to_string(&target).expect("target");
    assert_eq!(contents.lines().count(), 41);
    assert!(contents.starts_with("n\n0\n1\n"));
    assert!(contents.ends_with("39\n"));
    assert_eq!(done.bytes_written, contents.len() as u64);
    assert!(!temp_path_for(&target).exists());

    // The re-run is the stored SQL verbatim; the database matched, so no USE.
    let queries = texts(&server);
    assert_eq!(
        queries.iter().filter(|q| *q == sql).count(),
        2,
        "{queries:?}"
    );
    assert!(!queries.iter().any(|q| q.starts_with("USE")), "{queries:?}");
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_export_switches_to_the_run_database_and_restores_the_previous_one() {
    let capture = LogCaptureGuard::start();
    let (server, state, conn) = open(
        script(
            vec![database_step(Some(b"crm"))],
            vec![MockStreamStep::new(
                "SELECT n FROM big",
                n_column(),
                12,
                n_row,
            )],
        ),
        5,
    )
    .await;
    cache_truncated(
        &state,
        &conn,
        "SELECT n FROM big",
        RunDatabase::Named("shop".into()),
    );

    let dir = tempfile::tempdir().expect("dir");
    let (job_id, handle) = spawn_export(&state, &conn, QID, &target_in(&dir));
    let done = finish(&state, &job_id, handle).await;

    assert_eq!(
        done.status,
        ResultExportStatus::Completed,
        "{:?}",
        done.error
    );
    assert_eq!(done.rows_written, 12);
    let queries = texts(&server);
    let tail: Vec<&str> = queries
        .iter()
        .rev()
        .take(4)
        .rev()
        .map(String::as_str)
        .collect();
    assert_eq!(
        tail,
        vec![
            "SELECT DATABASE()",
            "USE shop",
            "SELECT n FROM big",
            "USE crm"
        ],
        "{queries:?}"
    );
    assert!(
        !queries.iter().any(|q| q.contains("LIMIT")),
        "no auto-LIMIT is injected: {queries:?}"
    );
    let logs = capture.contents();
    assert!(logs.contains("USE `shop`"), "the USE is logged");
    assert!(logs.contains("USE `crm`"), "the restore is logged");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stored_null_database_issues_no_use() {
    let (server, state, conn) = open(
        script(
            vec![database_step(Some(b"crm"))],
            vec![MockStreamStep::new(
                "SELECT 1 AS n FROM DUAL",
                n_column(),
                7,
                n_row,
            )],
        ),
        5,
    )
    .await;
    cache_truncated(
        &state,
        &conn,
        "SELECT 1 AS n FROM DUAL",
        RunDatabase::NoDatabase,
    );

    let dir = tempfile::tempdir().expect("dir");
    let (job_id, handle) = spawn_export(&state, &conn, QID, &target_in(&dir));
    let done = finish(&state, &job_id, handle).await;

    assert_eq!(
        done.status,
        ResultExportStatus::Completed,
        "{:?}",
        done.error
    );
    assert_eq!(done.rows_written, 7);
    assert!(!texts(&server).iter().any(|q| q.starts_with("USE")));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_null_previous_database_skips_the_restore_with_a_warning() {
    let capture = LogCaptureGuard::start();
    let (server, state, conn) = open(
        script(
            vec![database_step(None)],
            vec![MockStreamStep::new(
                "SELECT n FROM big",
                n_column(),
                3,
                n_row,
            )],
        ),
        5,
    )
    .await;
    cache_truncated(
        &state,
        &conn,
        "SELECT n FROM big",
        RunDatabase::Named("shop".into()),
    );

    let dir = tempfile::tempdir().expect("dir");
    let (job_id, handle) = spawn_export(&state, &conn, QID, &target_in(&dir));
    let done = finish(&state, &job_id, handle).await;

    assert_eq!(
        done.status,
        ResultExportStatus::Completed,
        "{:?}",
        done.error
    );
    let uses: Vec<String> = texts(&server)
        .into_iter()
        .filter(|q| q.starts_with("USE"))
        .collect();
    assert_eq!(uses, vec!["USE shop".to_string()], "no restore USE");
    assert!(capture
        .contents()
        .contains("the session had no database before the export"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancel_kills_the_rerun_deletes_the_temp_file_and_restores_the_database() {
    let capture = LogCaptureGuard::start();
    let (server, state, conn) = open(
        script(
            vec![database_step(Some(b"crm"))],
            vec![killable_stream(
                "SELECT n FROM big",
                5_000,
                Duration::from_millis(2),
            )],
        ),
        5,
    )
    .await;
    cache_truncated(
        &state,
        &conn,
        "SELECT n FROM big",
        RunDatabase::Named("shop".into()),
    );

    let dir = tempfile::tempdir().expect("dir");
    let target = target_in(&dir);
    std::fs::write(&target, "previous export").expect("existing target");
    let (job_id, handle) = spawn_export(&state, &conn, QID, &target);
    poll_until(&state, &job_id, |p| p.rows_written > 0).await;
    assert!(
        temp_path_for(&target).exists(),
        "rows stream to the temp file"
    );

    cancel_result_export_impl(&state, &job_id)
        .await
        .expect("cancel");
    let done = finish(&state, &job_id, handle).await;

    assert_eq!(
        done.status,
        ResultExportStatus::Cancelled,
        "{:?}",
        done.error
    );
    assert!(done.rows_written < 5_000);
    assert_eq!(server.kill_count(), 1);
    assert!(
        capture.contents().contains("KILL QUERY 42"),
        "the KILL is logged"
    );
    assert!(!temp_path_for(&target).exists());
    assert_eq!(
        std::fs::read_to_string(&target).expect("target"),
        "previous export"
    );
    assert_eq!(texts(&server).last().map(String::as_str), Some("USE crm"));

    // Cancelling a finished job is a no-op.
    cancel_result_export_impl(&state, &job_id)
        .await
        .expect("noop");
    assert_eq!(server.kill_count(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_late_cancel_kill_is_absorbed_before_the_session_is_released() {
    // The stream ignores the KILL (it stays pending on the session), and the
    // query already runs in its stored database, so no restore `USE` follows
    // that could absorb it.
    let mut late_kill = script(
        vec![
            database_step(Some(b"shop")),
            MockQueryStep {
                query: "SELECT 1 AS ok LIMIT 1",
                columns: n_column(),
                rows: vec![vec![MockCell::I64(1)]],
                error: None,
                affected_rows: None,
            },
        ],
        vec![MockStreamStep {
            throttle: Some((1, Duration::from_millis(2))),
            ..MockStreamStep::new("SELECT n FROM big", n_column(), 200, n_row)
        }],
    );
    late_kill.kill_hits_next_statement = true;
    let (server, state, conn) = open(late_kill, 5).await;
    cache_truncated(
        &state,
        &conn,
        "SELECT n FROM big",
        RunDatabase::Named("shop".into()),
    );

    let dir = tempfile::tempdir().expect("dir");
    let target = target_in(&dir);
    let (job_id, handle) = spawn_export(&state, &conn, QID, &target);
    poll_until(&state, &job_id, |p| p.rows_written > 0).await;
    cancel_result_export_impl(&state, &job_id)
        .await
        .expect("cancel");
    let done = finish(&state, &job_id, handle).await;

    assert_eq!(
        done.status,
        ResultExportStatus::Cancelled,
        "{:?}",
        done.error
    );
    assert_eq!(server.kill_count(), 1);
    assert!(
        !texts(&server).iter().any(|sql| sql.starts_with("USE ")),
        "no database switch or restore"
    );
    assert_eq!(
        texts(&server).iter().filter(|sql| *sql == "DO 0").count(),
        1,
        "the pending KILL is absorbed before the session is released"
    );

    // The next query on the shared session is not interrupted.
    let next = execute_query_impl(&state, &conn, TAB, "SELECT 1 AS ok LIMIT 1", 500, None)
        .await
        .expect("the next query runs");
    assert_eq!(next.total_rows, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_mid_stream_failure_ends_failed_and_cleans_up() {
    let (server, state, conn) = open(
        script(
            vec![database_step(Some(b"crm"))],
            vec![MockStreamStep {
                end_error: Some((ErrorKind::ER_LOCK_DEADLOCK, b"Deadlock found")),
                ..MockStreamStep::new("SELECT n FROM big", n_column(), 10, n_row)
            }],
        ),
        5,
    )
    .await;
    cache_truncated(
        &state,
        &conn,
        "SELECT n FROM big",
        RunDatabase::Named("shop".into()),
    );

    let dir = tempfile::tempdir().expect("dir");
    let target = target_in(&dir);
    std::fs::write(&target, "previous export").expect("existing target");
    let (job_id, handle) = spawn_export(&state, &conn, QID, &target);
    let done = finish(&state, &job_id, handle).await;

    assert_eq!(done.status, ResultExportStatus::Failed);
    let error = done.error.expect("error");
    assert!(error.contains("Deadlock found"), "{error}");
    assert!(!temp_path_for(&target).exists());
    assert_eq!(
        std::fs::read_to_string(&target).expect("target"),
        "previous export"
    );
    assert_eq!(texts(&server).last().map(String::as_str), Some("USE crm"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_database_switch_fails_the_export_without_rerunning() {
    let (server, state, conn) = open(
        script(
            vec![
                database_step(Some(b"crm")),
                MockQueryStep {
                    query: "USE shop",
                    columns: vec![],
                    rows: vec![],
                    error: Some((ErrorKind::ER_DBACCESS_DENIED_ERROR, b"Access denied")),
                    affected_rows: None,
                },
            ],
            vec![MockStreamStep::new(
                "SELECT n FROM big",
                n_column(),
                3,
                n_row,
            )],
        ),
        5,
    )
    .await;
    cache_truncated(
        &state,
        &conn,
        "SELECT n FROM big",
        RunDatabase::Named("shop".into()),
    );

    let dir = tempfile::tempdir().expect("dir");
    let (job_id, handle) = spawn_export(&state, &conn, QID, &target_in(&dir));
    let done = finish(&state, &job_id, handle).await;

    assert_eq!(done.status, ResultExportStatus::Failed);
    assert!(done
        .error
        .expect("error")
        .contains("Couldn't switch to database 'shop'"));
    assert!(!texts(&server).iter().any(|q| q == "SELECT n FROM big"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn call_and_locking_results_are_refused() {
    let (_server, state, conn) = open(
        script(
            vec![],
            vec![
                MockStreamStep::new(
                    "SELECT n FROM big LIMIT 1000000 FOR UPDATE",
                    n_column(),
                    8,
                    n_row,
                ),
                MockStreamStep::new("CALL fill_report()", n_column(), 8, n_row),
            ],
        ),
        5,
    )
    .await;
    let dir = tempfile::tempdir().expect("dir");

    let locked = execute_query_impl(
        &state,
        &conn,
        TAB,
        "SELECT n FROM big LIMIT 1000000 FOR UPDATE",
        500,
        None,
    )
    .await
    .expect("locking run");
    assert!(locked.truncated);
    let error = start_result_export_impl(&state, input(&conn, &locked.query_id, &target_in(&dir)))
        .expect_err("locking refused");
    assert_eq!(error, FULL_EXPORT_UNAVAILABLE_MESSAGE);

    let call = execute_call_query_impl(&state, &conn, TAB, "CALL fill_report()", 500)
        .await
        .expect("call run");
    assert!(call.results[0].truncated);
    let error = start_result_export_impl(
        &state,
        input(&conn, &call.results[0].query_id, &target_in(&dir)),
    )
    .expect_err("call refused");
    assert_eq!(error, FULL_EXPORT_UNAVAILABLE_MESSAGE);
    assert!(state.result_export_jobs.read().expect("jobs").is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn closing_the_connection_cancels_a_running_export() {
    let capture = LogCaptureGuard::start();
    let (server, state, conn) = open(
        script(
            vec![database_step(Some(b"shop"))],
            vec![killable_stream(
                "SELECT n FROM big",
                5_000,
                Duration::from_millis(2),
            )],
        ),
        5,
    )
    .await;
    cache_truncated(
        &state,
        &conn,
        "SELECT n FROM big",
        RunDatabase::Named("shop".into()),
    );

    let dir = tempfile::tempdir().expect("dir");
    let target = target_in(&dir);
    let (job_id, handle) = spawn_export(&state, &conn, QID, &target);
    poll_until(&state, &job_id, |p| p.rows_written > 0).await;

    close_connection_impl(&state, &conn).await.expect("close");
    let done = finish(&state, &job_id, handle).await;

    assert_eq!(
        done.status,
        ResultExportStatus::Cancelled,
        "{:?}",
        done.error
    );
    assert_eq!(
        server.kill_count(),
        1,
        "the KILL was sent before the pool closed"
    );
    assert!(capture.contents().contains("KILL QUERY 42"));
    assert!(!target.exists());
    assert!(!temp_path_for(&target).exists());
}
