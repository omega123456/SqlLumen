//! `BackgroundPool` and the pooled `logged_query` helpers against a server nobody listens on:
//! every checkout, KILL, transfer checkout and import job reports the failure. These run in
//! instrumented builds too, where the checkout is a coverage stub that always fails.

use std::time::{Duration, Instant};

use sqllumen_lib::commands::processlist::{kill_queries_impl, KillQueriesRequest};
use sqllumen_lib::commands::sql_dump::{
    get_import_progress_impl, start_sql_import_impl, StartImportInput,
};
use sqllumen_lib::mysql::connection_options::connect_timed_out_error;
use sqllumen_lib::mysql::logged_query::{
    execute_pooled, fetch_first_decoded_pooled, fetch_first_pooled, placeholder_list, text_values,
    LoggedStatement,
};
use sqllumen_lib::mysql::pool::{KillQuery, KillQueryFailure};
use sqllumen_lib::state::{AppState, ImportJobProgress, ImportJobStatus};

use crate::common;
use crate::common::log_capture::LogCaptureGuard;
use crate::common::mock_session::{
    register_mock_pool, unreachable_pool, MOCK_CONNECT_TIMEOUT_SECS,
};

const CONNECTION_ID: &str = "conn-unreachable";
const THREAD_ID: u64 = 42;
const KILL_CHECKOUT_TIMEOUT: Duration = Duration::from_secs(1);
const PROBE_SQL: &str = "SELECT 1";
const JOB_DEADLINE: Duration = Duration::from_millis(1500);
const JOB_POLL_INTERVAL: Duration = Duration::from_millis(10);
const BACKGROUND_TASK_TURNS: usize = 8;
const DISCONNECT_FAILURE_LOG: &str = "background pool disconnect failed";

fn kill_request() -> KillQuery {
    KillQuery {
        thread_id: THREAD_ID,
        checkout_timeout: KILL_CHECKOUT_TIMEOUT,
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

#[tokio::test]
async fn the_pool_carries_the_profile_connect_timeout() {
    let expected = Duration::from_secs(MOCK_CONNECT_TIMEOUT_SECS);
    assert_eq!(unreachable_pool().connect_timeout(), expected);
}

#[tokio::test]
async fn a_checkout_from_the_background_pool_fails() {
    let checkout = unreachable_pool().checkout().await;
    assert!(checkout.is_err());
}

#[tokio::test]
async fn a_transfer_checkout_fails_before_setting_the_time_zone() {
    let error = unreachable_pool()
        .checkout_for_transfer()
        .await
        .expect_err("no server to check out from");
    assert!(!error.is_empty());
}

#[tokio::test]
async fn kill_query_reports_that_no_pool_connection_was_available() {
    let failure = unreachable_pool()
        .kill_query(kill_request())
        .await
        .expect_err("no server to kill on");
    assert!(matches!(failure, KillQueryFailure::Checkout(_)));
    let message = failure.to_string();
    assert!(
        message.starts_with("no pool connection for KILL QUERY"),
        "{message}"
    );
}

#[test]
fn a_failed_kill_statement_names_the_kill() {
    let failure = KillQueryFailure::Kill(connect_timed_out_error(KILL_CHECKOUT_TIMEOUT));
    let message = failure.to_string();
    assert!(message.starts_with("KILL QUERY failed"), "{message}");
}

#[tokio::test]
async fn pooled_helpers_return_the_checkout_failure() {
    let pool = unreachable_pool();
    let executed = execute_pooled(&pool, LoggedStatement::text(PROBE_SQL)).await;
    let first_row = fetch_first_pooled(&pool, LoggedStatement::text(PROBE_SQL)).await;
    let first_decoded = fetch_first_decoded_pooled(&pool, LoggedStatement::text(PROBE_SQL)).await;
    assert!(executed.is_err());
    assert!(first_row.is_err());
    assert!(first_decoded.is_err());
}

#[test]
fn placeholders_and_text_values_line_up_with_their_inputs() {
    assert_eq!(placeholder_list(3), "?, ?, ?");
    assert_eq!(placeholder_list(0), "");
    let texts = vec!["app".to_string(), "users".to_string()];
    assert_eq!(
        text_values(&texts),
        vec![
            mysql_async::Value::from("app"),
            mysql_async::Value::from("users")
        ]
    );
}

#[tokio::test(flavor = "current_thread")]
async fn disconnecting_an_idle_pool_in_the_background_logs_no_failure() {
    let capture = LogCaptureGuard::start();
    unreachable_pool().disconnect_in_background("unreachable test pool");
    for _ in 0..BACKGROUND_TASK_TURNS {
        tokio::task::yield_now().await;
    }
    assert!(!capture.contents().contains(DISCONNECT_FAILURE_LOG));
}

#[tokio::test]
async fn killing_process_list_queries_reports_each_failure() {
    let state = common::test_app_state();
    register_mock_pool(&state, CONNECTION_ID, unreachable_pool());
    let request = KillQueriesRequest {
        session_id: CONNECTION_ID.to_string(),
        ids: vec![THREAD_ID],
    };

    let results = kill_queries_impl(&state, request)
        .await
        .expect("each kill reports its own result");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, THREAD_ID);
    assert!(!results[0].success);
    assert!(results[0].error.is_some());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_import_whose_checkout_fails_ends_failed() {
    let state = common::test_app_state();
    let input = StartImportInput {
        connection_id: CONNECTION_ID.to_string(),
        file_path: "never-read.sql".to_string(),
        stop_on_error: false,
    };

    let job_id = start_sql_import_impl(&state, input, unreachable_pool())
        .await
        .expect("the job id is returned before any connection is made");
    let progress = wait_for_import(&state, &job_id).await;

    assert_eq!(progress.status, ImportJobStatus::Failed, "{progress:?}");
    assert!(!progress.errors.is_empty(), "{progress:?}");
}
