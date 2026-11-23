//! Agent run export: the run folder and run.md created before the run, every row streamed to
//! one CSV per result set while the batch runs, the final run.md status for each outcome,
//! progress, cancel, and the startup sweep of old run folders.

use std::path::{Path, PathBuf};

use jiff::tz::TimeZone;
use jiff::{Timestamp, ToSpan};
use serde_json::{Value, json};
use sqllumen_lib::export::run_export::{
    ConnectionSummary, FinalReport, RUN_FILE_NAME, RUN_FOLDER_RETENTION_DAYS,
    RUN_NOT_STARTED_MESSAGE, ResultFileKey, RunDescription, RunExportOptions, RunExportStart,
    RunFiles, RunFinish, RunOutcome, RunPhase, StartRunExportRequest, claim_run, final_document,
    get_run_export_progress_impl, runs_directory, start_run_export_impl, sweep_run_folders,
};
use sqllumen_lib::mysql::query_executor::{
    ColumnMeta, ExecuteMultiQueryRequest, StoredResult, StoredResultParts, execute_multi_query_impl,
};
use sqllumen_lib::mysql::session::TabRun;
use sqllumen_lib::state::AppState;

use crate::common::test_app_state;

const CONNECTION: &str = "run-conn";
const TAB: &str = "run-tab";

fn column(name: &str, data_type: &str) -> ColumnMeta {
    ColumnMeta {
        name: name.to_string(),
        data_type: data_type.to_string(),
    }
}

fn start_request(statements: &[&str]) -> StartRunExportRequest {
    StartRunExportRequest {
        connection_id: CONNECTION.to_string(),
        tab_id: TAB.to_string(),
        connection_name: "Local | dev".to_string(),
        tab_title: "Query 1".to_string(),
        statements: statements.iter().map(|sql| sql.to_string()).collect(),
    }
}

fn start(state: &AppState, statements: &[&str], root: &Path) -> RunExportStart {
    start_run_export_impl(state, &start_request(statements), root).expect("run starts")
}

fn options(start: &RunExportStart) -> RunExportOptions {
    RunExportOptions {
        run_id: start.run_id.clone(),
    }
}

fn read(path: impl AsRef<Path>) -> String {
    std::fs::read_to_string(path).expect("file should exist")
}

fn run_folder(run_file_path: &str) -> PathBuf {
    Path::new(run_file_path)
        .parent()
        .expect("run file has a folder")
        .to_path_buf()
}

fn executed(statement_index: usize, columns: Vec<ColumnMeta>) -> StoredResult {
    let mut stored = StoredResult::new(StoredResultParts {
        columns,
        total_time_ms: 4,
        ..StoredResultParts::empty(format!("q-{statement_index}"))
    });
    stored.statement_index = statement_index;
    stored
}

fn failed(statement_index: usize, error_message: &str) -> StoredResult {
    let mut stored = executed(statement_index, vec![]);
    stored.error_message = Some(error_message.to_string());
    stored
}

#[test]
fn start_creates_an_owner_only_folder_with_a_running_run_file_and_queued_progress() {
    let root = tempfile::tempdir().expect("tempdir");
    let state = test_app_state();

    let started = start(&state, &["SELECT 1", "UPDATE t SET a = 1"], root.path());

    assert!(started.run_file_path.ends_with(RUN_FILE_NAME));
    let folder = run_folder(&started.run_file_path);
    assert_eq!(folder.parent(), Some(runs_directory(root.path()).as_path()));
    assert_owner_only(&folder);
    let document = read(&started.run_file_path);
    assert!(
        document.starts_with("# SqlLumen run: Query 1\n\nStatus: running."),
        "{document}"
    );
    assert!(
        document.contains("| Connection | Local \\| dev |"),
        "{document}"
    );
    assert!(document.contains("| Database | none |"), "{document}");
    assert!(
        document
            .contains("## 2. UPDATE: waiting\n\n```sql\nUPDATE t SET a = 1\n```\n\nNot run yet.")
    );
    let progress = get_run_export_progress_impl(&state, &started.run_id).expect("registered run");
    assert_eq!(progress.phase, RunPhase::Queued);
    assert_eq!(progress.statement_number, 1);
    assert_eq!(progress.statement_count, 2);
    assert_eq!(progress.rows_written, 0);
    assert_eq!(progress.run_file_path, started.run_file_path);
}

#[cfg(unix)]
fn assert_owner_only(folder: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let mode = std::fs::metadata(folder)
        .expect("metadata")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o700);
}

#[cfg(not(unix))]
fn assert_owner_only(_folder: &Path) {}

#[test]
fn a_complete_run_writes_every_row_names_call_sets_and_reports_file_row_counts() {
    let root = tempfile::tempdir().expect("tempdir");
    let state = test_app_state();
    let statements = ["SELECT id, note, token FROM users", "CALL report()"];
    let started = start(&state, &statements, root.path());
    let claim = claim_run(&state, Some(&options(&started)))
        .expect("claim")
        .expect("a run");
    let session = claim.session();
    let user_columns = vec![
        column("id", "INT"),
        column("note", "VARCHAR"),
        column("token", "VARBINARY"),
    ];

    session.begin_statement(0);
    session.open_result(None, &user_columns).expect("open");
    let user_rows = [
        vec![json!(1), Value::Null, json!("3q0=")],
        vec![json!(2), json!(""), Value::Null],
        vec![json!(4), json!("a,b"), json!("not base64!")],
    ];
    user_rows
        .iter()
        .for_each(|row| session.write_row(row).expect("write"));
    let progress = get_run_export_progress_impl(&state, &started.run_id).expect("progress");
    assert_eq!(progress.phase, RunPhase::Writing);
    assert_eq!(progress.rows_written, 3);
    session.close_result(true);
    session.begin_statement(1);
    session
        .open_result(Some(1), &[column("a", "INT")])
        .expect("open set 1");
    session.write_row(&[json!(1)]).expect("write");
    session.close_result(true);
    session
        .open_result(Some(2), &[column("b", "INT")])
        .expect("open set 2");
    session.close_result(true);
    let progress = get_run_export_progress_impl(&state, &started.run_id).expect("progress");
    assert_eq!(progress.statement_number, 2);
    assert!(progress.bytes_written > 0);
    let results = vec![
        executed(0, user_columns.clone()),
        executed(1, vec![column("a", "INT")]),
        executed(1, vec![column("b", "INT")]),
    ];

    let summary = claim.finish(&RunFinish {
        results: &results,
        batch_error: None,
    });

    assert_eq!(summary.outcome, RunOutcome::Complete);
    assert_eq!(summary.statement_count, 2);
    assert!(get_run_export_progress_impl(&state, &started.run_id).is_none());
    assert!(state.editor_sessions.runs.is_empty());
    assert_complete_run_files(&summary.run_file_path);
}

fn assert_complete_run_files(run_file_path: &str) {
    let folder = run_folder(run_file_path);
    assert_eq!(
        read(folder.join("result-1.csv")),
        "id,note,token\n1,\\N,0xDEAD\n2,,\\N\n4,\"a,b\",not base64!\n"
    );
    assert_eq!(read(folder.join("result-2-1.csv")), "a\n1\n");
    assert_eq!(read(folder.join("result-2-2.csv")), "b\n");
    let document = read(run_file_path);
    assert!(
        document.contains("Status: complete. All 2 statements ran."),
        "{document}"
    );
    assert!(document.contains("| Duration | 12 ms |"), "{document}");
    let users_file = folder.join("result-1.csv").display().to_string();
    assert!(document.contains("## 1. SELECT: 3 rows"), "{document}");
    assert!(document.contains(&format!("Rows: 3. Time: 4 ms. File: {users_file}")));
    assert!(document.contains("## 2. CALL: 2 result sets"), "{document}");
    assert!(
        document.contains("- Result set 2: 0 rows. File: "),
        "{document}"
    );
}

#[test]
fn a_cancelled_run_keeps_the_partial_file_and_says_where_it_stopped() {
    let root = tempfile::tempdir().expect("tempdir");
    let state = test_app_state();
    let statements = ["SELECT n FROM big", "SELECT 1", "SELECT 2"];
    let started = start(&state, &statements, root.path());
    let claim = claim_run(&state, Some(&options(&started)))
        .expect("claim")
        .expect("a run");
    let session = claim.session();
    session.begin_statement(0);
    session
        .open_result(None, &[column("n", "BIGINT")])
        .expect("open");
    session.write_row(&[json!(1)]).expect("write");
    session.write_row(&[json!(2)]).expect("write");

    assert!(
        state
            .editor_sessions
            .runs
            .request_cancel(&TabRun::new(CONNECTION, TAB))
    );
    assert!(
        !state
            .editor_sessions
            .runs
            .request_cancel(&TabRun::new(CONNECTION, "other-tab"))
    );
    let results = vec![failed(0, "Query cancelled")];
    let summary = claim.finish(&RunFinish {
        results: &results,
        batch_error: None,
    });

    assert_eq!(
        summary.outcome,
        RunOutcome::Cancelled {
            statement_number: 1
        }
    );
    let folder = run_folder(&summary.run_file_path);
    assert_eq!(read(folder.join("result-1.csv")), "n\n1\n2\n");
    let document = read(&summary.run_file_path);
    assert!(
        document.contains("Status: cancelled at statement 1 of 3. Statements 2–3 did not run."),
        "{document}"
    );
    assert!(document.contains("## 1. SELECT: error"), "{document}");
    assert!(
        document.contains("(incomplete: 2 rows written before the run stopped)"),
        "{document}"
    );
    assert!(!document.contains("may have partly run"), "{document}");
    assert!(document.contains("## 3. SELECT: not run\n\n```sql\nSELECT 2\n```\n\nDid not run."));
}

#[test]
fn a_server_error_stops_the_run_and_a_failed_write_statement_may_have_partly_run() {
    let root = tempfile::tempdir().expect("tempdir");
    let state = test_app_state();
    let statements = [
        "UPDATE users SET active = 1",
        "UPDATE orders SET x = 1",
        "SELECT 1",
    ];
    let started = start(&state, &statements, root.path());
    let claim = claim_run(&state, Some(&options(&started)))
        .expect("claim")
        .expect("a run");
    let mut update = executed(0, vec![]);
    update.affected_rows = 4;
    let results = vec![update, failed(1, "Lock wait timeout exceeded")];

    let summary = claim.finish(&RunFinish {
        results: &results,
        batch_error: None,
    });

    assert_eq!(
        summary.outcome,
        RunOutcome::Stopped {
            statement_number: 2
        }
    );
    let document = read(&summary.run_file_path);
    assert!(
        document
            .contains("Status: stopped at statement 2 of 3 on an error. Statement 3 did not run."),
        "{document}"
    );
    assert!(document.contains("## 1. UPDATE: 4 rows affected"));
    assert!(document.contains("Affected rows: 4. Time: 4 ms."));
    assert!(
        document.contains("Error: Lock wait timeout exceeded\nThe statement may have partly run.")
    );
}

fn write_failed_document() -> String {
    let description = RunDescription {
        tab_title: "Query 1".to_string(),
        connection: ConnectionSummary {
            description: "Local".to_string(),
            database: Some("shop".to_string()),
        },
        statements: vec!["SELECT 1".to_string(), "SELECT n FROM big".to_string()],
        row_ceiling: 100_000,
        started_at: "2026-11-17T12:00:00.000Z".to_string(),
    };
    final_document(&FinalReport {
        description: &description,
        results: &[],
        records: &[],
        outcome: &RunOutcome::WriteFailed {
            statement_number: 2,
            file_name: "result-2.csv".to_string(),
        },
    })
}

#[test]
fn a_write_failure_names_the_file_and_an_unwritable_run_file_fails_the_run() {
    let root = tempfile::tempdir().expect("tempdir");
    let missing_folder = root.path().join("missing");
    let mut files = RunFiles::new(&missing_folder);
    let key = ResultFileKey {
        statement_index: 1,
        set_number: None,
    };

    let error = files
        .open_result(key, &[column("n", "INT")])
        .expect_err("folder is missing");

    assert!(
        error.starts_with("Couldn't write result-2.csv: "),
        "{error}"
    );
    assert_eq!(files.write_failure().map(|failure| failure.key), Some(key));
    assert_eq!(files.write_row(&[json!(1)]), Ok(()), "no open file");
    let document = write_failed_document();
    assert!(
        document.contains("Status: stopped at statement 2 of 2: couldn't write result-2.csv."),
        "{document}"
    );
    assert!(document.contains("| Database | shop |"), "{document}");

    let state = test_app_state();
    let started = start(&state, &["SELECT 1"], root.path());
    let claim = claim_run(&state, Some(&options(&started)))
        .expect("claim")
        .expect("a run");
    std::fs::remove_dir_all(run_folder(&started.run_file_path)).expect("remove run folder");
    claim.session().begin_statement(0);
    let open_error = claim
        .session()
        .open_result(None, &[column("n", "INT")])
        .expect_err("run folder is gone");
    assert!(open_error.starts_with("Couldn't write result-1.csv"));

    let summary = claim.finish(&RunFinish {
        results: &[],
        batch_error: None,
    });

    let RunOutcome::Failed { message } = summary.outcome else {
        panic!("expected a failed outcome, got {:?}", summary.outcome);
    };
    assert!(
        message.starts_with("Couldn't write the run file"),
        "{message}"
    );
}

#[test]
fn an_unfinished_claim_marks_the_run_failed_and_unknown_runs_are_refused() {
    let root = tempfile::tempdir().expect("tempdir");
    let state = test_app_state();
    let started = start(&state, &["UPDATE a SET b = 1", "SELECT 1"], root.path());

    let claim = claim_run(&state, Some(&options(&started)))
        .expect("claim")
        .expect("a run");
    drop(claim);

    assert!(state.editor_sessions.runs.is_empty());
    let document = read(&started.run_file_path);
    assert!(
        document.contains("Status: failed. The run stopped before it finished."),
        "{document}"
    );
    assert!(document.contains("May not have run: the run failed before results came back."));
    let unknown = claim_run(&state, Some(&options(&started))).err();
    assert_eq!(unknown.as_deref(), Some(RUN_NOT_STARTED_MESSAGE));
    assert!(claim_run(&state, None).expect("no run").is_none());
}

#[tokio::test]
async fn a_run_on_a_missing_connection_finishes_its_run_file_as_failed() {
    let root = tempfile::tempdir().expect("tempdir");
    let state = test_app_state();
    let started = start(&state, &["SELECT 1"], root.path());

    let error = execute_multi_query_impl(
        &state,
        &ExecuteMultiQueryRequest {
            connection_id: CONNECTION.to_string(),
            tab_id: TAB.to_string(),
            statements: vec!["SELECT 1".to_string()],
            row_limit: Some(500),
            run_export: Some(options(&started)),
        },
    )
    .await
    .expect_err("no such connection");

    assert!(error.contains("not found"), "{error}");
    assert!(state.editor_sessions.runs.is_empty());
    assert!(read(&started.run_file_path).contains("Status: failed."));
}

#[test]
fn reports_when_the_run_folder_cannot_be_created() {
    let root = tempfile::tempdir().expect("tempdir");
    let blocked_root = root.path().join("not-a-directory");
    std::fs::write(&blocked_root, "").expect("write");

    let error = start_run_export_impl(
        &test_app_state(),
        &start_request(&["SELECT 1"]),
        &blocked_root,
    )
    .expect_err("a file is in the way");

    assert!(
        error.starts_with("Couldn't create the run folder"),
        "{error}"
    );
}

#[test]
fn sweep_removes_only_run_folders_past_retention() {
    let root = tempfile::tempdir().expect("tempdir");
    sweep_run_folders(root.path(), Timestamp::now());
    let started = start(&test_app_state(), &["SELECT 1"], root.path());
    let folder = run_folder(&started.run_file_path);

    sweep_run_folders(root.path(), Timestamp::now());
    assert!(folder.exists(), "a fresh run folder is kept");

    let past_retention = Timestamp::now()
        .to_zoned_datetime(TimeZone::UTC)
        .saturating_add((RUN_FOLDER_RETENTION_DAYS + 1).days())
        .timestamp();
    sweep_run_folders(root.path(), past_retention);
    assert!(!folder.exists(), "an expired run folder is removed");
    assert!(runs_directory(root.path()).exists());
}

#[cfg(not(coverage))]
async fn execute_owned(
    state: std::sync::Arc<AppState>,
    request: ExecuteMultiQueryRequest,
) -> Result<sqllumen_lib::mysql::query_executor::MultiQueryResult, String> {
    execute_multi_query_impl(&state, &request).await
}

#[cfg(not(coverage))]
async fn wait_until_query_runs(state: &AppState, connection_id: &str) {
    use std::time::{Duration, Instant};
    let key = (
        connection_id.to_string(),
        crate::common::editor_session_fixtures::EDITOR_TAB.to_string(),
    );
    let deadline = Instant::now() + Duration::from_secs(1);
    while !state.running_queries.read().await.contains_key(&key) {
        assert!(Instant::now() < deadline, "query never started");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

#[cfg(not(coverage))]
mod against_mock_server {
    use std::sync::Arc;
    use std::time::Duration;

    use opensrv_mysql::ErrorKind;
    use sqllumen_lib::commands::connections::{SaveConnectionInput, save_connection_impl};
    use sqllumen_lib::commands::mysql::open_connection_impl;
    use sqllumen_lib::commands::requests::ConnectionTabRequest;
    use sqllumen_lib::export::run_export::{
        RunExportOptions, RunExportStart, RunOutcome, StartRunExportRequest, start_run_export_impl,
    };
    use sqllumen_lib::mysql::query_executor::{
        ExecuteMultiQueryRequest, MultiQueryResult, cancel_query_impl, execute_multi_query_impl,
    };
    use sqllumen_lib::state::AppState;

    use super::{execute_owned, read, run_folder, wait_until_query_runs};
    use crate::common::editor_session_fixtures::{
        EDITOR_TAB, database_step, n_column, n_row, n_stream, single_row_step,
    };
    use crate::common::mock_mysql_server::{
        MockMySqlServer, MockQueryStep, MockScript, MockStreamRows, MockStreamStep,
    };
    use crate::common::test_app_state;

    const FIRST: &str = "SELECT 1 AS a LIMIT 1";
    const MISSING: &str = "SELECT x FROM missing LIMIT 1";
    const NEVER_RUN: &str = "SELECT 2 AS b LIMIT 1";
    const BIG: &str = "SELECT n FROM big";
    const CEILING: usize = 5;

    async fn open_mock_connection(state: &AppState, port: u16) -> String {
        let profile_id = save_connection_impl(
            state,
            SaveConnectionInput {
                name: "Run export mock".to_string(),
                host: "127.0.0.1".to_string(),
                port: i64::from(port),
                username: "root".to_string(),
                password: None,
                default_database: Some("shop".to_string()),
                ssl_mode: sqllumen_lib::db::ssl_mode::SslMode::Disabled,
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
        open_connection_impl(state, crate::common::open_payload(&profile_id))
            .await
            .expect("open connection")
            .session_id
    }

    struct MockRun {
        server: MockMySqlServer,
        state: Arc<AppState>,
        connection_id: String,
        root: tempfile::TempDir,
    }

    async fn open(script: MockScript) -> MockRun {
        let server = MockMySqlServer::start_with(script).await;
        let state = test_app_state();
        let connection_id = open_mock_connection(&state, server.port).await;
        state.result_cache.set_row_ceiling(CEILING);
        MockRun {
            server,
            state: Arc::new(state),
            connection_id,
            root: tempfile::tempdir().expect("tempdir"),
        }
    }

    fn start_run(mock: &MockRun, statements: &[String]) -> RunExportStart {
        start_run_export_impl(
            &mock.state,
            &StartRunExportRequest {
                connection_id: mock.connection_id.clone(),
                tab_id: EDITOR_TAB.to_string(),
                connection_name: "Run export mock".to_string(),
                tab_title: "Query 1".to_string(),
                statements: statements.to_vec(),
            },
            mock.root.path(),
        )
        .expect("run starts")
    }

    fn run_request(
        mock: &MockRun,
        statements: &[String],
        started: &RunExportStart,
    ) -> ExecuteMultiQueryRequest {
        ExecuteMultiQueryRequest {
            connection_id: mock.connection_id.clone(),
            tab_id: EDITOR_TAB.to_string(),
            statements: statements.to_vec(),
            row_limit: Some(500),
            run_export: Some(RunExportOptions {
                run_id: started.run_id.clone(),
            }),
        }
    }

    async fn run(mock: &MockRun, statements: &[String]) -> MultiQueryResult {
        let started = start_run(mock, statements);
        execute_multi_query_impl(&mock.state, &run_request(mock, statements, &started))
            .await
            .expect("batch")
    }

    fn line_count(path: impl AsRef<std::path::Path>) -> usize {
        read(path).lines().count()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_run_writes_every_row_past_the_ceiling_without_kill_or_auto_limit() {
        let mock = open(MockScript {
            steps: vec![database_step(Some(b"shop"))],
            stream_steps: vec![n_stream(BIG, 20)],
            ..MockScript::default()
        })
        .await;
        let statements = vec![BIG.to_string()];

        let result = run(&mock, &statements).await;

        let item = &result.results[0];
        assert!(item.truncated);
        assert_eq!(item.total_rows, CEILING as i64);
        assert_eq!(item.exported_row_count, Some(20));
        assert_eq!(item.applied_row_limit, None);
        assert_eq!(mock.server.kill_count(), 0);
        assert!(mock.server.text_queries().iter().any(|query| query == BIG));
        let cached = mock
            .state
            .result_cache
            .get(&mock.connection_id, EDITOR_TAB)
            .into_entry()
            .expect("cached result");
        assert_eq!(cached.value[0].rows.len(), CEILING);
        let summary = result.run_export.expect("run summary");
        assert_eq!(summary.outcome, RunOutcome::Complete);
        let folder = run_folder(&summary.run_file_path);
        assert_eq!(line_count(folder.join("result-1.csv")), 21);
        assert!(mock.state.editor_sessions.runs.is_empty());
        assert!(read(&summary.run_file_path).contains("## 1. SELECT: 20 rows"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_oversized_call_set_is_written_in_full_to_a_numbered_file() {
        let mock = open(MockScript {
            stream_steps: vec![MockStreamStep {
                leading_ok_affected: vec![3],
                ..n_stream("CALL fill_report()", 12)
            }],
            ..MockScript::default()
        })
        .await;
        let statements = vec!["CALL fill_report()".to_string()];

        let result = run(&mock, &statements).await;

        assert_eq!(result.results[0].exported_row_count, Some(12));
        assert_eq!(result.results[0].total_rows, CEILING as i64);
        assert_eq!(mock.server.kill_count(), 0);
        let summary = result.run_export.expect("run summary");
        let folder = run_folder(&summary.run_file_path);
        assert_eq!(line_count(folder.join("result-1-1.csv")), 13);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_cancel_while_writing_keeps_the_partial_file() {
        let killable = MockStreamStep {
            throttle: Some((1, Duration::from_millis(5))),
            stops_on_kill: true,
            ..MockStreamStep::new(
                BIG,
                n_column(),
                MockStreamRows {
                    count: 400,
                    make_row: n_row,
                },
            )
        };
        let mock = open(MockScript {
            stream_steps: vec![killable],
            ..MockScript::default()
        })
        .await;
        let statements = vec![BIG.to_string(), FIRST.to_string()];
        let started = start_run(&mock, &statements);
        let request = run_request(&mock, &statements, &started);
        let runner = tokio::spawn(execute_owned(Arc::clone(&mock.state), request));
        wait_until_query_runs(&mock.state, &mock.connection_id).await;
        tokio::time::sleep(Duration::from_millis(30)).await;

        let cancelled = cancel_query_impl(
            &mock.state,
            &ConnectionTabRequest {
                connection_id: mock.connection_id.clone(),
                tab_id: EDITOR_TAB.to_string(),
            },
        )
        .await;

        assert_eq!(cancelled, Ok(true));
        let result = runner.await.expect("join").expect("batch");
        let summary = result.run_export.expect("run summary");
        assert_eq!(
            summary.outcome,
            RunOutcome::Cancelled {
                statement_number: 1
            }
        );
        let partial_rows = line_count(run_folder(&summary.run_file_path).join("result-1.csv"));
        assert!((1..401).contains(&partial_rows), "{partial_rows}");
        let document = read(&summary.run_file_path);
        assert!(
            document.contains("Status: cancelled at statement 1 of 2."),
            "{document}"
        );
        assert!(document.contains("(incomplete: "), "{document}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_server_error_stops_the_run_and_the_run_file_lists_the_rest_as_not_run() {
        let mock = open(MockScript {
            steps: vec![
                single_row_step(FIRST),
                MockQueryStep {
                    error: Some((
                        ErrorKind::ER_NO_SUCH_TABLE,
                        b"Table 'missing' doesn't exist",
                    )),
                    ..single_row_step(MISSING)
                },
            ],
            ..MockScript::default()
        })
        .await;
        let statements = vec![
            FIRST.to_string(),
            MISSING.to_string(),
            NEVER_RUN.to_string(),
        ];

        let result = run(&mock, &statements).await;

        let summary = result.run_export.expect("run summary");
        assert_eq!(
            summary.outcome,
            RunOutcome::Stopped {
                statement_number: 2
            }
        );
        let document = read(&summary.run_file_path);
        assert!(
            document.contains(&format!("at 127.0.0.1:{} |", mock.server.port)),
            "{document}"
        );
        assert!(document.contains("| Database | shop |"), "{document}");
        assert!(document.contains("## 1. SELECT: 1 rows"), "{document}");
        assert!(
            document.contains("Table 'missing' doesn't exist"),
            "{document}"
        );
        assert!(document.contains("## 3. SELECT: not run"), "{document}");
    }
}
