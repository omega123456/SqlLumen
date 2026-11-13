//! `start_sql_import_impl` and `execute_sql_import` against the in-process mock
//! MySQL server: success, errors with and without stop-on-error, a missing file
//! and cancellation.

use std::time::{Duration, Instant};

use opensrv_mysql::ErrorKind;
use sqllumen_lib::commands::sql_dump::{
    get_import_progress_impl, start_sql_import_impl, StartImportInput,
};
use sqllumen_lib::export::sql_import::{execute_sql_import, SqlImportJob};
use sqllumen_lib::state::{AppState, ImportJobProgress, ImportJobStatus};

use crate::common;
use crate::common::mock_mysql_server::{MockMySqlServer, MockQueryStep};
use crate::common::mock_session::mock_pool;

const JOB_DEADLINE: Duration = Duration::from_secs(5);
const JOB_POLL_INTERVAL: Duration = Duration::from_millis(10);
const IMPORT_SCRIPT: &str =
    "INSERT INTO t VALUES (1);\nINSERT INTO broken VALUES (2);\nINSERT INTO t VALUES (3);\n";

fn import_steps() -> Vec<MockQueryStep> {
    vec![
        MockQueryStep::ok_affected("INSERT INTO t VALUES (1)", 1),
        MockQueryStep {
            error: Some((ErrorKind::ER_NO_SUCH_TABLE, b"Table 'broken' doesn't exist")),
            ..MockQueryStep::ok_affected("INSERT INTO broken VALUES (2)", 0)
        },
        MockQueryStep::ok_affected("INSERT INTO t VALUES (3)", 2),
    ]
}

fn write_script(dir: &tempfile::TempDir, content: &str) -> String {
    let path = dir.path().join("import.sql");
    std::fs::write(&path, content).expect("write import script");
    path.to_string_lossy().into_owned()
}

fn import_input(file_path: String, stop_on_error: bool) -> StartImportInput {
    StartImportInput {
        connection_id: "conn-import".to_string(),
        file_path,
        stop_on_error,
    }
}

async fn wait_for_import(state: &AppState, job_id: &str) -> ImportJobProgress {
    let deadline = Instant::now() + JOB_DEADLINE;
    loop {
        let progress = get_import_progress_impl(state, job_id).expect("job exists");
        let is_settled = progress.status != ImportJobStatus::Running || Instant::now() >= deadline;
        if is_settled {
            return progress;
        }
        tokio::time::sleep(JOB_POLL_INTERVAL).await;
    }
}

async fn run_import(script: &str, stop_on_error: bool) -> ImportJobProgress {
    let server = MockMySqlServer::start_script(import_steps()).await;
    let state = common::test_app_state();
    let dir = tempfile::tempdir().expect("temp dir");
    let input = import_input(write_script(&dir, script), stop_on_error);
    let job_id = start_sql_import_impl(&state, input, mock_pool(server.port))
        .await
        .expect("import starts");
    wait_for_import(&state, &job_id).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_clean_script_completes_every_statement() {
    let progress = run_import(
        "INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (3);\n",
        false,
    )
    .await;

    assert_eq!(progress.status, ImportJobStatus::Completed);
    assert_eq!(progress.statements_total, 2);
    assert_eq!(progress.statements_done, 2);
    assert!(progress.errors.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn errors_are_collected_when_the_import_continues() {
    let progress = run_import(IMPORT_SCRIPT, false).await;

    assert_eq!(progress.status, ImportJobStatus::Completed);
    assert_eq!(progress.statements_done, 3);
    assert_eq!(progress.errors.len(), 1);
    assert_eq!(progress.errors[0].statement_index, 1);
    assert!(progress.errors[0].error_message.contains("broken"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stop_on_error_fails_the_job_at_the_first_error() {
    let progress = run_import(IMPORT_SCRIPT, true).await;

    assert_eq!(progress.status, ImportJobStatus::Failed);
    assert_eq!(progress.statements_done, 2);
    assert_eq!(progress.errors.len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_missing_script_fails_the_job() {
    let server = MockMySqlServer::start_script(vec![]).await;
    let state = common::test_app_state();
    let dir = tempfile::tempdir().expect("temp dir");
    let missing = dir
        .path()
        .join("missing.sql")
        .to_string_lossy()
        .into_owned();

    let job_id =
        start_sql_import_impl(&state, import_input(missing, false), mock_pool(server.port))
            .await
            .expect("import starts");
    let progress = wait_for_import(&state, &job_id).await;

    assert_eq!(progress.status, ImportJobStatus::Failed);
}

fn cancelled_progress(job_id: &str) -> ImportJobProgress {
    ImportJobProgress {
        job_id: job_id.to_string(),
        status: ImportJobStatus::Running,
        statements_total: 0,
        statements_done: 0,
        errors: Vec::new(),
        stop_on_error: false,
        cancel_requested: true,
        completed_at: None,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cancel_requested_before_the_first_statement_cancels_the_import() {
    let server = MockMySqlServer::start_script(import_steps()).await;
    let state = common::test_app_state();
    let dir = tempfile::tempdir().expect("temp dir");
    let file_path = write_script(&dir, IMPORT_SCRIPT);
    state
        .import_jobs
        .write()
        .expect("import jobs lock")
        .insert("job-cancel".to_string(), cancelled_progress("job-cancel"));
    let import_jobs = std::sync::Arc::clone(&state.import_jobs);
    let history_db = std::sync::Arc::clone(&state.db);
    let pool = mock_pool(server.port);

    let outcome = tokio::task::spawn_blocking(move || {
        let job = SqlImportJob {
            file_path: &file_path,
            stop_on_error: false,
            job_id: "job-cancel",
            import_jobs: &import_jobs,
            history_db: &history_db,
            connection_id: "conn-import",
        };
        execute_sql_import(&pool, &job)
    })
    .await
    .expect("import task");

    assert!(outcome.is_ok());
    let progress = get_import_progress_impl(&state, "job-cancel").expect("job");
    assert_eq!(progress.status, ImportJobStatus::Cancelled);
    assert_eq!(progress.statements_done, 0);
}
