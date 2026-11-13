//! `cancel_dump_impl`: flags the job and kills the dump's running MySQL thread.

use sqllumen_lib::commands::sql_dump::{
    cancel_dump_impl, get_dump_progress_impl, CancelDumpRequest,
};
use sqllumen_lib::state::{AppState, DumpJobProgress, DumpJobStatus};

use crate::common;
use crate::common::mock_mysql_server::MockMySqlServer;
use crate::common::mock_session::{mock_pool, register_mock_pool};

const CONNECTION_ID: &str = "conn-dump";
const JOB_ID: &str = "dump-job";

fn running_job(mysql_thread_id: Option<u64>) -> DumpJobProgress {
    DumpJobProgress {
        job_id: JOB_ID.to_string(),
        status: DumpJobStatus::Running,
        tables_total: 1,
        tables_done: 0,
        current_table: None,
        bytes_written: 0,
        rows_exported: 0,
        error_message: None,
        cancel_requested: false,
        mysql_thread_id,
        completed_at: None,
    }
}

fn insert_job(state: &AppState, progress: DumpJobProgress) {
    state
        .dump_jobs
        .write()
        .expect("dump jobs lock")
        .insert(JOB_ID.to_string(), progress);
}

fn cancel_request(connection_id: &str) -> CancelDumpRequest {
    CancelDumpRequest {
        job_id: JOB_ID.to_string(),
        connection_id: connection_id.to_string(),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelling_a_fetching_dump_kills_its_thread() {
    let server = MockMySqlServer::start_script(vec![]).await;
    let state = common::test_app_state();
    register_mock_pool(&state, CONNECTION_ID, mock_pool(server.port));
    insert_job(&state, running_job(Some(42)));

    cancel_dump_impl(&state, &cancel_request(CONNECTION_ID))
        .await
        .expect("cancel succeeds");

    let progress = get_dump_progress_impl(&state, JOB_ID).expect("job");
    assert!(progress.cancel_requested);
    assert_eq!(server.kill_count(), 1);
}

#[tokio::test]
async fn cancelling_between_tables_only_flags_the_job() {
    let state = common::test_app_state();
    insert_job(&state, running_job(None));

    cancel_dump_impl(&state, &cancel_request("unused"))
        .await
        .expect("cancel succeeds");

    assert!(
        get_dump_progress_impl(&state, JOB_ID)
            .expect("job")
            .cancel_requested
    );
}

#[tokio::test]
async fn cancelling_needs_a_known_job_and_connection() {
    let state = common::test_app_state();
    let missing_job = cancel_dump_impl(&state, &cancel_request(CONNECTION_ID))
        .await
        .expect_err("unknown job");
    assert!(missing_job.contains("not found"));

    insert_job(&state, running_job(Some(42)));
    let missing_connection = cancel_dump_impl(&state, &cancel_request("missing"))
        .await
        .expect_err("unknown connection");
    assert!(missing_connection.contains("Connection 'missing' not found"));
}
