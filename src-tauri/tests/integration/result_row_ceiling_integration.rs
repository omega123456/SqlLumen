//! The hard row ceiling against the in-process mock MySQL server: truncation,
//! `KILL QUERY` (and the drain fallback), CALL draining, the `SELECT DATABASE()`
//! re-run context, the late-KILL race, the row-limit clamp, the live setting,
//! user cancel, and execute / re-execute view specs.
//!
//! Omitted from `cargo sqllumen-llvm-cov`, like the other mock-server suites:
//! instrumented builds hit sqlx pool-acquire timeouts against the mock.

#![cfg(not(coverage))]

use std::time::{Duration, Instant};

use opensrv_mysql::ErrorKind;
use serde_json::json;
use sqllumen_lib::commands::connections::{save_connection_impl, SaveConnectionInput};
use sqllumen_lib::commands::mysql::open_connection_impl;
use sqllumen_lib::commands::settings::{load_results_max_rows, set_setting_impl};
use sqllumen_lib::mysql::query_executor::{
    cancel_query_impl, execute_call_query_impl, execute_multi_query_impl, execute_query_impl,
    reexecute_single_result_impl, FullExportBlockedReason, RunDatabase, StoredResult,
};
use sqllumen_lib::mysql::result_view::ResultViewSpec;
use sqllumen_lib::state::AppState;

use crate::common;
use crate::common::editor_session_fixtures::{
    call_query, connection_id_step, database_step, editor_query, n_column, n_row, n_stream,
    single_row_step, EDITOR_TAB,
};
use crate::common::log_capture::LogCaptureGuard;
use crate::common::mock_mysql_server::{
    MockMySqlServer, MockQueryStep, MockScript, MockStreamRows, MockStreamStep,
};

/// A stream of `rows` rows, paused 5 ms per row and stopped by `KILL QUERY`.
fn killable_stream(query: &'static str, rows: usize) -> MockStreamStep {
    MockStreamStep {
        throttle: Some((1, Duration::from_millis(5))),
        stops_on_kill: true,
        ..MockStreamStep::new(
            query,
            n_column(),
            MockStreamRows {
                count: rows,
                make_row: n_row,
            },
        )
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
async fn open(script: MockScript, ceiling: usize) -> (MockMySqlServer, AppState, String) {
    let server = MockMySqlServer::start_with(script).await;
    let state = common::test_app_state();
    let profile_id = save_connection_impl(
        &state,
        SaveConnectionInput {
            name: "Ceiling mock".to_string(),
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
    (server, state, opened.session_id)
}

fn stored(state: &AppState, conn: &str, index: usize) -> StoredResult {
    state
        .result_cache
        .get(conn, EDITOR_TAB)
        .into_entry()
        .expect("cached result")
        .value[index]
        .clone()
}

fn count(server: &MockMySqlServer, sql: &str) -> usize {
    server.text_queries().iter().filter(|q| *q == sql).count()
}

fn sort_desc() -> Option<ResultViewSpec> {
    Some(
        serde_json::from_value(json!({
            "sort": { "column": "n", "direction": "desc" },
            "filters": [
                { "column": "n", "operator": "<", "value": "4" },
                { "column": "missing", "operator": "==", "value": "x" }
            ]
        }))
        .expect("spec"),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn select_over_the_ceiling_is_truncated_killed_and_the_session_stays_usable() {
    let started = Instant::now();
    let capture = LogCaptureGuard::start();
    let (server, state, conn) = open(
        script(
            vec![
                database_step(Some(b"shop")),
                single_row_step("SELECT 1 AS ok LIMIT 1"),
            ],
            vec![killable_stream("SELECT n FROM big LIMIT 1000000", 1_000)],
        ),
        5,
    )
    .await;

    let result = execute_query_impl(
        &state,
        &editor_query(&conn, "SELECT n FROM big LIMIT 1000000"),
    )
    .await
    .expect("truncated success");

    assert!(result.truncated);
    assert_eq!(result.total_rows, 5);
    assert_eq!(result.view_row_count, 5);
    assert_eq!(result.row_ceiling, 5);
    assert_eq!(result.first_window.rows.len(), 5);
    assert_eq!(
        result.applied_row_limit, None,
        "explicit LIMIT: no auto-LIMIT"
    );
    assert_eq!(result.full_export_blocked_reason, None);
    assert_eq!(server.kill_count(), 1);
    assert!(
        capture.contents().contains("KILL QUERY 42"),
        "KILL is logged"
    );
    assert_eq!(count(&server, "SELECT DATABASE()"), 1);

    let cached = stored(&state, &conn, 0);
    assert_eq!(cached.source_sql, "SELECT n FROM big LIMIT 1000000");
    assert_eq!(cached.run_database, RunDatabase::Named("shop".to_string()));

    let next = execute_query_impl(&state, &editor_query(&conn, "SELECT 1 AS ok LIMIT 1"))
        .await
        .expect("the next run on the session succeeds");
    assert!(!next.truncated);
    assert_eq!(next.total_rows, 1);
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_kill_falls_back_to_draining_and_is_still_a_truncated_success() {
    let capture = LogCaptureGuard::start();
    let (server, state, conn) = open(
        script(
            vec![
                database_step(None),
                MockQueryStep {
                    error: Some((
                        ErrorKind::ER_SPECIFIC_ACCESS_DENIED_ERROR,
                        b"KILL not allowed",
                    )),
                    ..single_row_step("KILL QUERY 42")
                },
            ],
            vec![n_stream("SELECT n FROM big LIMIT 1000000", 50)],
        ),
        5,
    )
    .await;

    let result = execute_query_impl(
        &state,
        &editor_query(&conn, "SELECT n FROM big LIMIT 1000000"),
    )
    .await
    .expect("truncated success");

    assert!(result.truncated);
    assert_eq!(result.total_rows, 5);
    assert_eq!(server.kill_count(), 0, "the KILL was refused");
    assert!(capture
        .contents()
        .contains("row ceiling KILL QUERY failed; draining the rest of the result instead"));
    assert_eq!(
        stored(&state, &conn, 0).run_database,
        RunDatabase::NoDatabase
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn exactly_at_the_ceiling_is_not_truncated_and_reads_no_database() {
    let (server, state, conn) = open(
        script(
            vec![database_step(Some(b"shop"))],
            vec![n_stream("SELECT n FROM big LIMIT 1000000", 5)],
        ),
        5,
    )
    .await;

    let result = execute_query_impl(
        &state,
        &editor_query(&conn, "SELECT n FROM big LIMIT 1000000"),
    )
    .await
    .expect("success");
    assert!(!result.truncated);
    assert_eq!(result.total_rows, 5);
    assert_eq!(server.kill_count(), 0);
    assert_eq!(count(&server, "SELECT DATABASE()"), 0);
    assert_eq!(
        stored(&state, &conn, 0).run_database,
        RunDatabase::NotCaptured
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_late_ceiling_kill_is_absorbed_before_the_database_probe() {
    let mut late_kill = script(
        vec![
            database_step(Some(b"shop")),
            single_row_step("SELECT 1 AS ok LIMIT 1"),
        ],
        // The whole stream is already sent when the KILL arrives.
        vec![n_stream("SELECT n FROM big LIMIT 1000000", 6)],
    );
    late_kill.kill_hits_next_statement = true;
    let (server, state, conn) = open(late_kill, 5).await;

    let result = execute_multi_query_impl(
        &state,
        &sqllumen_lib::mysql::query_executor::ExecuteMultiQueryRequest {
            connection_id: conn.to_string(),
            tab_id: EDITOR_TAB.to_string(),
            statements: vec![
                "SELECT n FROM big LIMIT 1000000".to_string(),
                "SELECT 1 AS ok LIMIT 1".to_string(),
            ],
            row_limit: Some(500),
        },
    )
    .await
    .expect("batch succeeds");

    assert_eq!(result.results.len(), 2);
    let truncated = &result.results[0];
    assert!(truncated.error.is_none());
    assert!(truncated.truncated);
    assert_eq!(server.kill_count(), 1);
    assert_eq!(count(&server, "DO 0"), 1, "the late KILL is absorbed");
    // The probe ran after the absorber, so the re-run context is recorded.
    assert_eq!(truncated.full_export_blocked_reason, None);
    assert_eq!(
        stored(&state, &conn, 0).run_database,
        RunDatabase::Named("shop".to_string())
    );
    assert!(result.results[1].error.is_none(), "the next statement ran");
    assert_eq!(result.results[1].total_rows, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_late_ceiling_kill_after_a_locking_select_does_not_fail_the_next_statement() {
    let mut late_kill = script(
        vec![single_row_step("SELECT 1 AS ok LIMIT 1")],
        vec![n_stream("SELECT n FROM big LIMIT 1000000 FOR UPDATE", 6)],
    );
    late_kill.kill_hits_next_statement = true;
    let (server, state, conn) = open(late_kill, 5).await;

    let result = execute_multi_query_impl(
        &state,
        &sqllumen_lib::mysql::query_executor::ExecuteMultiQueryRequest {
            connection_id: conn.to_string(),
            tab_id: EDITOR_TAB.to_string(),
            statements: vec![
                "SELECT n FROM big LIMIT 1000000 FOR UPDATE".to_string(),
                "SELECT 1 AS ok LIMIT 1".to_string(),
            ],
            row_limit: Some(500),
        },
    )
    .await
    .expect("batch succeeds");

    assert_eq!(result.results.len(), 2);
    assert!(result.results[0].truncated);
    assert_eq!(
        result.results[0].full_export_blocked_reason,
        Some(FullExportBlockedReason::Locking)
    );
    assert_eq!(server.kill_count(), 1);
    assert_eq!(count(&server, "DO 0"), 1);
    assert_eq!(
        count(&server, "SELECT DATABASE()"),
        0,
        "locking results never probe"
    );
    assert!(result.results[1].error.is_none(), "the next statement ran");
    assert_eq!(result.results[1].total_rows, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_oversized_last_call_set_is_drained_and_earlier_and_later_items_survive() {
    let (server, state, conn) = open(
        script(
            vec![
                single_row_step("SELECT 1 AS a LIMIT 1"),
                single_row_step("SELECT 2 AS b LIMIT 1"),
            ],
            vec![MockStreamStep {
                leading_ok_affected: vec![3, 1],
                ..n_stream("CALL fill_report()", 40)
            }],
        ),
        5,
    )
    .await;

    let result = execute_multi_query_impl(
        &state,
        &sqllumen_lib::mysql::query_executor::ExecuteMultiQueryRequest {
            connection_id: conn.to_string(),
            tab_id: EDITOR_TAB.to_string(),
            statements: vec![
                "SELECT 1 AS a LIMIT 1".to_string(),
                "CALL fill_report()".to_string(),
                "SELECT 2 AS b LIMIT 1".to_string(),
            ],
            row_limit: Some(500),
        },
    )
    .await
    .expect("batch");

    assert_eq!(result.results.len(), 3);
    assert!(result.results.iter().all(|item| item.error.is_none()));
    let call = &result.results[1];
    assert!(call.truncated);
    assert_eq!(call.total_rows, 5);
    assert_eq!(
        call.full_export_blocked_reason,
        Some(FullExportBlockedReason::Call)
    );
    assert!(!call.re_executable);
    assert_eq!(
        server.kill_count(),
        0,
        "CALL sets are drained, never killed"
    );
    assert_eq!(count(&server, "SELECT DATABASE()"), 0);
    assert_eq!(result.results[2].total_rows, 1);

    let only_call = execute_call_query_impl(&state, &call_query(&conn, "CALL fill_report()"))
        .await
        .expect("call");
    assert_eq!(only_call.results.len(), 1);
    assert!(only_call.results[0].truncated);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_auto_limit_is_clamped_to_the_ceiling_inside_the_impl() {
    let (server, state, conn) = open(
        script(vec![], vec![n_stream("SELECT n FROM big LIMIT 5", 5)]),
        5,
    )
    .await;

    let result = execute_query_impl(
        &state,
        &sqllumen_lib::mysql::query_executor::ExecuteQueryRequest {
            connection_id: conn.to_string(),
            tab_id: EDITOR_TAB.to_string(),
            sql: "SELECT n FROM big".to_string(),
            row_limit: Some(1_000),
            view_spec: None,
        },
    )
    .await
    .expect("clamped run");
    assert_eq!(result.applied_row_limit, Some(5));
    assert!(result.auto_limit_applied);
    assert!(!result.truncated);
    assert_eq!(count(&server, "SELECT n FROM big LIMIT 5"), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_setting_is_read_at_startup_and_updated_live() {
    let (_server, state, conn) = open(
        script(
            vec![database_step(Some(b"shop"))],
            vec![MockStreamStep::new(
                "SELECT n FROM big LIMIT 1000000",
                n_column(),
                MockStreamRows {
                    count: 1_500,
                    make_row: n_row,
                },
            )],
        ),
        100_000,
    )
    .await;

    // Startup: run() seeds the cache from the stored setting.
    {
        let db = state.db.lock().expect("db");
        sqllumen_lib::db::settings::set_setting(&db, "results.maxRows", "2000").expect("seed");
        state
            .result_cache
            .set_row_ceiling(load_results_max_rows(&db));
    }
    assert_eq!(state.result_cache.row_ceiling(), 2_000);
    let untruncated = execute_query_impl(
        &state,
        &editor_query(&conn, "SELECT n FROM big LIMIT 1000000"),
    )
    .await
    .expect("run");
    assert!(!untruncated.truncated);
    assert_eq!(untruncated.total_rows, 1_500);

    // Live: a saved change applies to the next run.
    set_setting_impl(
        &state,
        &sqllumen_lib::commands::settings::SetSettingRequest {
            key: "results.maxRows".to_string(),
            value: "1000".to_string(),
        },
    )
    .expect("save setting");
    let truncated = execute_query_impl(
        &state,
        &editor_query(&conn, "SELECT n FROM big LIMIT 1000000"),
    )
    .await
    .expect("run");
    assert!(truncated.truncated);
    assert_eq!(truncated.total_rows, 1_000);
    assert_eq!(truncated.row_ceiling, 1_000);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_explicit_limit_5000_returns_every_row_with_the_default_settings() {
    let (_server, state, conn) = open(
        script(
            vec![],
            vec![MockStreamStep::new(
                "SELECT n FROM big LIMIT 5000",
                n_column(),
                MockStreamRows {
                    count: 5_000,
                    make_row: n_row,
                },
            )],
        ),
        100_000,
    )
    .await;

    let result = execute_query_impl(&state, &editor_query(&conn, "SELECT n FROM big LIMIT 5000"))
        .await
        .expect("run");
    assert!(!result.truncated);
    assert_eq!(result.total_rows, 5_000);
    assert_eq!(result.view_row_count, 5_000);
    assert_eq!(result.first_window.rows.len(), 1_000);
}

async fn run_big_select(
    state: std::sync::Arc<AppState>,
    conn: String,
) -> Result<sqllumen_lib::mysql::query_executor::ExecuteQueryResult, String> {
    execute_query_impl(
        &state,
        &editor_query(&conn, "SELECT n FROM big LIMIT 1000000"),
    )
    .await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_user_cancel_during_a_run_is_still_query_cancelled() {
    let (server, state, conn) = open(
        script(
            vec![],
            vec![killable_stream("SELECT n FROM big LIMIT 1000000", 400)],
        ),
        100_000,
    )
    .await;
    let state = std::sync::Arc::new(state);

    let runner = tokio::spawn(run_big_select(std::sync::Arc::clone(&state), conn.clone()));
    let key = (conn.clone(), EDITOR_TAB.to_string());
    let deadline = Instant::now() + Duration::from_secs(1);
    while !state.running_queries.read().await.contains_key(&key) {
        assert!(Instant::now() < deadline, "query never started");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(
        cancel_query_impl(
            &state,
            &sqllumen_lib::commands::requests::ConnectionTabRequest {
                connection_id: conn.to_string(),
                tab_id: EDITOR_TAB.to_string()
            }
        )
        .await,
        Ok(true)
    );

    let err = runner
        .await
        .expect("join")
        .expect_err("cancelled run fails");
    assert_eq!(err, "Query cancelled");
    assert_eq!(server.kill_count(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn locking_and_call_results_carry_blocked_reasons_and_never_probe_the_database() {
    let (server, state, conn) = open(
        script(
            vec![],
            vec![
                n_stream("SELECT n FROM big LIMIT 1000000 FOR UPDATE", 6),
                n_stream("SELECT n FROM big LIMIT 3 LOCK IN SHARE MODE", 2),
                n_stream("SELECT n FROM big LIMIT 3 FOR SHARE", 2),
                n_stream("CALL small()", 2),
            ],
        ),
        5,
    )
    .await;

    let locked = execute_query_impl(
        &state,
        &editor_query(&conn, "SELECT n FROM big LIMIT 1000000 FOR UPDATE"),
    )
    .await
    .expect("locking run");
    assert!(locked.truncated);
    assert_eq!(
        locked.full_export_blocked_reason,
        Some(FullExportBlockedReason::Locking)
    );

    // Auto-LIMIT goes before the locking clause ("… LIMIT 3 FOR SHARE").
    state.result_cache.set_row_ceiling(3);
    let share = execute_query_impl(&state, &editor_query(&conn, "SELECT n FROM big FOR SHARE"))
        .await
        .expect("auto-limited locking run");
    assert_eq!(share.applied_row_limit, Some(3));
    assert!(!share.truncated);
    assert_eq!(
        share.full_export_blocked_reason,
        Some(FullExportBlockedReason::Locking)
    );

    let lock_mode = execute_query_impl(
        &state,
        &editor_query(&conn, "SELECT n FROM big LOCK IN SHARE MODE"),
    )
    .await
    .expect("lock in share mode run");
    assert_eq!(lock_mode.total_rows, 2);
    assert_eq!(
        lock_mode.full_export_blocked_reason,
        Some(FullExportBlockedReason::Locking)
    );

    let call = execute_call_query_impl(&state, &call_query(&conn, "CALL small()"))
        .await
        .expect("call");
    assert!(!call.results[0].truncated);
    assert_eq!(
        call.results[0].full_export_blocked_reason,
        Some(FullExportBlockedReason::Call)
    );
    assert_eq!(stored(&state, &conn, 0).source_sql, "CALL small()");
    assert_eq!(count(&server, "SELECT DATABASE()"), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_and_reexecute_with_a_view_spec_return_a_presorted_prefiltered_window() {
    let (_server, state, conn) = open(
        script(vec![], vec![n_stream("SELECT n FROM big LIMIT 10", 10)]),
        100_000,
    )
    .await;

    let result = execute_query_impl(
        &state,
        &sqllumen_lib::mysql::query_executor::ExecuteQueryRequest {
            connection_id: conn.to_string(),
            tab_id: EDITOR_TAB.to_string(),
            sql: "SELECT n FROM big LIMIT 10".to_string(),
            row_limit: Some(500),
            view_spec: sort_desc(),
        },
    )
    .await
    .expect("execute");
    assert_eq!(result.first_window.base_indices, vec![3, 2, 1, 0]);
    assert_eq!(result.view_row_count, 4);
    assert_eq!(result.total_rows, 10);
    assert_eq!(stored(&state, &conn, 0).view_spec.filters.len(), 1);

    let item = reexecute_single_result_impl(
        &state,
        &sqllumen_lib::mysql::query_executor::ReexecuteSingleResultRequest {
            connection_id: conn.to_string(),
            tab_id: EDITOR_TAB.to_string(),
            result_index: 0,
            sql: "SELECT n FROM big LIMIT 10".to_string(),
            row_limit: Some(500),
            view_spec: sort_desc(),
        },
    )
    .await
    .expect("re-execute");
    assert_eq!(item.first_window.base_indices, vec![3, 2, 1, 0]);
    assert_eq!(item.first_window.rows[0][0], json!(3));
    assert_ne!(item.query_id, result.query_id);
}
