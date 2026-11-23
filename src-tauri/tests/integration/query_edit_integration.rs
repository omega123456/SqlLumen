//! Integration tests for `analyze_query_for_edit_impl` and `update_result_cell_impl`.

use crate::common::test_app_state;
use sqllumen_lib::mysql::query_executor::{
    ColumnMeta, StoredResult, analyze_query_for_edit_impl, update_result_cell_impl,
};
use std::collections::HashMap;
use std::sync::Arc;

fn users_q1_result(rows: Vec<Vec<serde_json::Value>>) -> StoredResult {
    StoredResult::new(sqllumen_lib::mysql::query_executor::StoredResultParts {
        query_id: "q1".to_string(),
        columns: vec![
            ColumnMeta {
                name: "id".to_string(),
                data_type: "INT".to_string(),
            },
            ColumnMeta {
                name: "name".to_string(),
                data_type: "VARCHAR".to_string(),
            },
            ColumnMeta {
                name: "email".to_string(),
                data_type: "VARCHAR".to_string(),
            },
        ],
        rows: crate::common::shared_rows(rows),
        execution_time_ms: 10,
        total_time_ms: 10,
        affected_rows: 0,
        auto_limit_applied: false,
    })
}

// ── update_result_cell_impl tests ──────────────────────────────────────────────

#[test]
fn update_result_cell_successful() {
    let state = test_app_state();

    // Insert a stored result
    state.result_cache.insert(
        sqllumen_lib::mysql::result_cache::CacheKey::new("conn-1", "tab-1"),
        vec![users_q1_result(vec![
            vec![
                serde_json::json!(1),
                serde_json::json!("Alice"),
                serde_json::json!("alice@example.com"),
            ],
            vec![
                serde_json::json!(2),
                serde_json::json!("Bob"),
                serde_json::json!("bob@example.com"),
            ],
        ])],
    );

    // Update name in row 0
    let mut updates = HashMap::new();
    updates.insert(1, serde_json::json!("Alice Updated"));

    let result = update_result_cell_impl(
        &state,
        sqllumen_lib::mysql::query_executor::UpdateResultCellRequest {
            connection_id: "conn-1".to_string(),
            tab_id: "tab-1".to_string(),
            row_index: 0,
            updates,
            result_index: None,
            query_id: "q1".to_string(),
        },
    );
    assert!(result.is_ok());

    // Verify the update
    let entry = state
        .result_cache
        .get("conn-1", "tab-1")
        .into_entry()
        .unwrap();
    let stored = &entry.value[0];
    assert_eq!(stored.rows[0][1], serde_json::json!("Alice Updated"));
    // Other cells should be unchanged
    assert_eq!(stored.rows[0][0], serde_json::json!(1));
    assert_eq!(stored.rows[0][2], serde_json::json!("alice@example.com"));
    // Other row should be unchanged
    assert_eq!(stored.rows[1][1], serde_json::json!("Bob"));
}

#[test]
fn update_result_cell_result_not_found() {
    let state = test_app_state();

    let updates = HashMap::new();
    let result = update_result_cell_impl(
        &state,
        sqllumen_lib::mysql::query_executor::UpdateResultCellRequest {
            connection_id: "conn-1".to_string(),
            tab_id: "nonexistent-tab".to_string(),
            row_index: 0,
            updates,
            result_index: None,
            query_id: "q1".to_string(),
        },
    );
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .contains("No results found for tab 'nonexistent-tab'")
    );
}

#[test]
fn update_result_cell_row_index_out_of_bounds() {
    let state = test_app_state();

    // Insert a stored result with 1 row
    state.result_cache.insert(
        sqllumen_lib::mysql::result_cache::CacheKey::new("conn-1", "tab-1"),
        vec![StoredResult::new(
            sqllumen_lib::mysql::query_executor::StoredResultParts {
                query_id: "q1".to_string(),
                columns: vec![ColumnMeta {
                    name: "id".to_string(),
                    data_type: "INT".to_string(),
                }],
                rows: crate::common::shared_rows(vec![vec![serde_json::json!(1)]]),
                execution_time_ms: 5,
                total_time_ms: 5,
                affected_rows: 0,
                auto_limit_applied: false,
            },
        )],
    );

    let updates = HashMap::new();
    let result = update_result_cell_impl(
        &state,
        sqllumen_lib::mysql::query_executor::UpdateResultCellRequest {
            connection_id: "conn-1".to_string(),
            tab_id: "tab-1".to_string(),
            row_index: 5,
            updates,
            result_index: None,
            query_id: "q1".to_string(),
        },
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Row index 5 out of bounds"));
}

#[test]
fn update_result_cell_multiple_columns() {
    let state = test_app_state();

    // Insert a stored result
    state.result_cache.insert(
        sqllumen_lib::mysql::result_cache::CacheKey::new("conn-1", "tab-1"),
        vec![users_q1_result(vec![vec![
            serde_json::json!(1),
            serde_json::json!("Alice"),
            serde_json::json!("alice@example.com"),
        ]])],
    );

    // Update both name and email at once
    let mut updates = HashMap::new();
    updates.insert(1, serde_json::json!("Alice New"));
    updates.insert(2, serde_json::json!("alice.new@example.com"));

    let result = update_result_cell_impl(
        &state,
        sqllumen_lib::mysql::query_executor::UpdateResultCellRequest {
            connection_id: "conn-1".to_string(),
            tab_id: "tab-1".to_string(),
            row_index: 0,
            updates,
            result_index: None,
            query_id: "q1".to_string(),
        },
    );
    assert!(result.is_ok());

    // Verify both updates
    let entry = state
        .result_cache
        .get("conn-1", "tab-1")
        .into_entry()
        .unwrap();
    let stored = &entry.value[0];
    assert_eq!(stored.rows[0][0], serde_json::json!(1)); // id unchanged
    assert_eq!(stored.rows[0][1], serde_json::json!("Alice New"));
    assert_eq!(
        stored.rows[0][2],
        serde_json::json!("alice.new@example.com")
    );
}

// ── analyze_query_for_edit_impl coverage-stub tests ────────────────────────────

#[tokio::test]
async fn analyze_query_for_edit_connection_not_found() {
    let state = test_app_state();

    let result = analyze_query_for_edit_impl(
        &state,
        &sqllumen_lib::mysql::query_executor::AnalyzeQueryForEditRequest {
            connection_id: "nonexistent-conn".to_string(),
            sql: "SELECT * FROM users".to_string(),
        },
    )
    .await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[tokio::test]
async fn analyze_query_for_edit_non_select() {
    let state = test_app_state();

    // Non-SELECT statements return empty vec without needing a connection
    let result = analyze_query_for_edit_impl(
        &state,
        &sqllumen_lib::mysql::query_executor::AnalyzeQueryForEditRequest {
            connection_id: "conn-1".to_string(),
            sql: "INSERT INTO users VALUES (1)".to_string(),
        },
    )
    .await;
    // Under coverage: extract_tables returns empty → Ok(vec![])
    // Under real: extract_tables returns empty → Ok(vec![])
    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
}

#[tokio::test]
async fn analyze_query_for_edit_empty_sql() {
    let state = test_app_state();

    let result = analyze_query_for_edit_impl(
        &state,
        &sqllumen_lib::mysql::query_executor::AnalyzeQueryForEditRequest {
            connection_id: "conn-1".to_string(),
            sql: "".to_string(),
        },
    )
    .await;
    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
}

// ── update_result_cell_impl row sharing ────────────────────────────────────────

fn insert_three_row_result(state: &sqllumen_lib::state::AppState) {
    state.result_cache.insert(
        sqllumen_lib::mysql::result_cache::CacheKey::new("conn-1", "tab-1"),
        vec![StoredResult::new(
            sqllumen_lib::mysql::query_executor::StoredResultParts {
                query_id: "q1".to_string(),
                columns: vec![
                    ColumnMeta {
                        name: "id".to_string(),
                        data_type: "INT".to_string(),
                    },
                    ColumnMeta {
                        name: "name".to_string(),
                        data_type: "VARCHAR".to_string(),
                    },
                ],
                rows: crate::common::shared_rows(vec![
                    vec![serde_json::json!(1), serde_json::json!("Alice")],
                    vec![serde_json::json!(2), serde_json::json!("Bob")],
                    vec![serde_json::json!(3), serde_json::json!("Cara")],
                ]),
                execution_time_ms: 1,
                total_time_ms: 1,
                affected_rows: 0,
                auto_limit_applied: false,
            },
        )],
    );
}

/// The cached row list of the tab's first result (shared pointer).
fn cached_rows(
    state: &sqllumen_lib::state::AppState,
) -> sqllumen_lib::mysql::query_executor::SharedRows {
    let entry = state
        .result_cache
        .get("conn-1", "tab-1")
        .into_entry()
        .expect("cached result");
    Arc::clone(&entry.value[0].rows)
}

#[test]
fn update_result_cell_leaves_previously_fetched_rows_untouched_and_shares_other_rows() {
    let state = test_app_state();
    insert_three_row_result(&state);

    let before = cached_rows(&state);

    let mut updates = HashMap::new();
    updates.insert(1, serde_json::json!("Bobby"));
    update_result_cell_impl(
        &state,
        sqllumen_lib::mysql::query_executor::UpdateResultCellRequest {
            connection_id: "conn-1".to_string(),
            tab_id: "tab-1".to_string(),
            row_index: 1,
            updates,
            result_index: None,
            query_id: "q1".to_string(),
        },
    )
    .expect("edit succeeds");

    // The Arc handed out before the edit still holds the old value.
    assert_eq!(before[1][1], serde_json::json!("Bob"));

    let after = cached_rows(&state);
    assert_eq!(after[1][1], serde_json::json!("Bobby"));
    assert!(!Arc::ptr_eq(&before, &after), "row list must be replaced");
    assert!(!Arc::ptr_eq(&before[1], &after[1]), "edited row is new");
    assert!(
        Arc::ptr_eq(&before[0], &after[0]),
        "unedited rows are shared"
    );
    assert!(
        Arc::ptr_eq(&before[2], &after[2]),
        "unedited rows are shared"
    );
}

#[test]
fn update_result_cell_result_index_out_of_range_error_unchanged() {
    let state = test_app_state();
    insert_three_row_result(&state);

    let err = update_result_cell_impl(
        &state,
        sqllumen_lib::mysql::query_executor::UpdateResultCellRequest {
            connection_id: "conn-1".to_string(),
            tab_id: "tab-1".to_string(),
            row_index: 0,
            updates: HashMap::new(),
            result_index: Some(3),
            query_id: "q1".to_string(),
        },
    )
    .expect_err("result index 3 does not exist");
    assert_eq!(err, "Result index 3 out of range (total: 1)");
}

#[test]
fn update_result_cell_row_index_out_of_bounds_leaves_cache_unchanged() {
    let state = test_app_state();
    insert_three_row_result(&state);
    let before = cached_rows(&state);

    let mut updates = HashMap::new();
    updates.insert(1, serde_json::json!("ignored"));
    let err = update_result_cell_impl(
        &state,
        sqllumen_lib::mysql::query_executor::UpdateResultCellRequest {
            connection_id: "conn-1".to_string(),
            tab_id: "tab-1".to_string(),
            row_index: 3,
            updates,
            result_index: None,
            query_id: "q1".to_string(),
        },
    )
    .expect_err("row 3 does not exist");
    assert_eq!(err, "Row index 3 out of bounds (total rows: 3)");

    let after = cached_rows(&state);
    assert!(Arc::ptr_eq(&before, &after), "failed edit must not write");
}

#[test]
fn update_result_cell_expired_results_error_unchanged() {
    let state = test_app_state();
    insert_three_row_result(&state);
    state.result_cache.remove("conn-1", "tab-1");

    let err = update_result_cell_impl(
        &state,
        sqllumen_lib::mysql::query_executor::UpdateResultCellRequest {
            connection_id: "conn-1".to_string(),
            tab_id: "tab-1".to_string(),
            row_index: 0,
            updates: HashMap::new(),
            result_index: None,
            query_id: "q1".to_string(),
        },
    )
    .expect_err("removed results are expired");
    assert!(err.starts_with("results_expired:"), "{err}");
}

#[test]
fn update_result_cell_refuses_a_save_for_a_replaced_query() {
    let state = test_app_state();
    insert_three_row_result(&state);
    // A re-run replaces the slot with a new query id; insert does not bump the
    // invalidation version, so only the query-id check can catch the race.
    state.result_cache.insert(
        sqllumen_lib::mysql::result_cache::CacheKey::new("conn-1", "tab-1"),
        vec![StoredResult::new(
            sqllumen_lib::mysql::query_executor::StoredResultParts {
                query_id: "q2".to_string(),
                columns: vec![
                    ColumnMeta {
                        name: "id".to_string(),
                        data_type: "INT".to_string(),
                    },
                    ColumnMeta {
                        name: "name".to_string(),
                        data_type: "VARCHAR".to_string(),
                    },
                ],
                rows: crate::common::shared_rows(vec![
                    vec![serde_json::json!(7), serde_json::json!("Zed")],
                    vec![serde_json::json!(8), serde_json::json!("Yan")],
                ]),
                execution_time_ms: 1,
                total_time_ms: 1,
                affected_rows: 0,
                auto_limit_applied: false,
            },
        )],
    );
    let before = cached_rows(&state);

    let mut updates = HashMap::new();
    updates.insert(1, serde_json::json!("Bobby"));
    let err = update_result_cell_impl(
        &state,
        sqllumen_lib::mysql::query_executor::UpdateResultCellRequest {
            connection_id: "conn-1".to_string(),
            tab_id: "tab-1".to_string(),
            row_index: 1,
            updates,
            result_index: None,
            query_id: "q1".to_string(),
        },
    )
    .expect_err("the save belongs to the replaced query");
    assert_eq!(err, "Results were refreshed during edit");

    let after = cached_rows(&state);
    assert!(Arc::ptr_eq(&before, &after), "the new result is untouched");
    assert_eq!(after[1][1], serde_json::json!("Yan"));
}

#[cfg(not(coverage))]
mod edit_analysis_database {
    use crate::common::editor_session_fixtures::database_step;
    use crate::common::mock_mysql_server::{
        MockCell, MockColumnDef, MockMySqlServer, MockScript, MockStreamRows, MockStreamStep,
    };
    use crate::common::mock_session::{
        mock_connection_params, mock_pool, register_mock_connection,
    };
    use opensrv_mysql::{ColumnFlags, ColumnType};
    use sqllumen_lib::mysql::query_executor::{
        AnalyzeQueryForEditRequest, QueryTableEditInfo, analyze_query_for_edit_impl,
    };
    use sqllumen_lib::state::AppState;
    use std::time::{Duration, Instant};

    const CONNECTION_ID: &str = "conn-edit";
    const REGISTRY_DATABASE: &str = "registry_db";
    const SESSION_DATABASE: &[u8] = b"session_db";
    const BUSY_SESSION_DEADLINE: Duration = Duration::from_secs(1);
    const SERVER_STALL: Duration = Duration::from_millis(1_500);
    const UNANSWERED_READ_DEADLINE: Duration = Duration::from_millis(1_400);

    async fn open_connection() -> (MockMySqlServer, AppState) {
        let server =
            MockMySqlServer::start_script(vec![database_step(Some(SESSION_DATABASE))]).await;
        let state = crate::common::test_app_state();
        let mut params = mock_connection_params(CONNECTION_ID, server.port);
        params.default_database = Some(REGISTRY_DATABASE.to_string());
        register_mock_connection(&state, mock_pool(server.port), params);
        (server, state)
    }

    fn session_database_row(_row_index: usize) -> Vec<MockCell> {
        vec![MockCell::Bytes(SESSION_DATABASE)]
    }

    fn stalled_database_step() -> MockStreamStep {
        let database_column = MockColumnDef {
            name: "DATABASE()",
            coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
            colflags: ColumnFlags::empty(),
        };
        let one_row = MockStreamRows {
            count: 1,
            make_row: session_database_row,
        };
        MockStreamStep {
            throttle: Some((1, SERVER_STALL)),
            ..MockStreamStep::new("SELECT DATABASE()", vec![database_column], one_row)
        }
    }

    async fn open_connection_with_a_stalling_session() -> (MockMySqlServer, AppState) {
        let script = MockScript {
            stream_steps: vec![stalled_database_step()],
            ..MockScript::default()
        };
        let server = MockMySqlServer::start_with(script).await;
        let state = crate::common::test_app_state();
        let mut params = mock_connection_params(CONNECTION_ID, server.port);
        params.default_database = Some(REGISTRY_DATABASE.to_string());
        register_mock_connection(&state, mock_pool(server.port), params);
        (server, state)
    }

    async fn analyze_unqualified_select(state: &AppState) -> Vec<QueryTableEditInfo> {
        let request = AnalyzeQueryForEditRequest {
            connection_id: CONNECTION_ID.to_string(),
            sql: "SELECT * FROM orders".to_string(),
        };
        analyze_query_for_edit_impl(state, &request)
            .await
            .expect("analysis succeeds")
    }

    fn analysed_database(tables: &[QueryTableEditInfo]) -> &str {
        tables
            .first()
            .map(|table| table.database.as_str())
            .expect("one table was analysed")
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_free_editor_session_supplies_its_current_database() {
        let (_server, state) = open_connection().await;
        let session = sqllumen_lib::mysql::session::acquire(&state, CONNECTION_ID)
            .await
            .expect("editor session opens");
        drop(session);

        let tables = analyze_unqualified_select(&state).await;

        assert_eq!(analysed_database(&tables), "session_db");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn without_an_editor_session_the_registry_default_is_used_and_no_session_is_opened() {
        let (_server, state) = open_connection().await;

        let tables = analyze_unqualified_select(&state).await;

        assert_eq!(analysed_database(&tables), REGISTRY_DATABASE);
        assert!(!state.editor_sessions.has_session(CONNECTION_ID));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_busy_editor_session_falls_back_to_the_registry_default_quickly() {
        let (_server, state) = open_connection().await;
        let held_session = sqllumen_lib::mysql::session::acquire(&state, CONNECTION_ID)
            .await
            .expect("editor session opens");
        let started = Instant::now();

        let tables = analyze_unqualified_select(&state).await;

        assert!(
            started.elapsed() < BUSY_SESSION_DEADLINE,
            "{:?}",
            started.elapsed()
        );
        assert_eq!(analysed_database(&tables), REGISTRY_DATABASE);
        drop(held_session);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_unanswered_session_database_read_falls_back_and_discards_the_session() {
        let (server, state) = open_connection_with_a_stalling_session().await;
        let session = sqllumen_lib::mysql::session::acquire(&state, CONNECTION_ID)
            .await
            .expect("editor session opens");
        drop(session);
        let started = Instant::now();

        let tables = analyze_unqualified_select(&state).await;

        assert!(
            started.elapsed() < UNANSWERED_READ_DEADLINE,
            "{:?}",
            started.elapsed()
        );
        assert_eq!(analysed_database(&tables), REGISTRY_DATABASE);
        let connections_before_reacquire = server.connection_count();
        let reopened = sqllumen_lib::mysql::session::acquire(&state, CONNECTION_ID)
            .await
            .expect("editor session reopens");
        drop(reopened);
        assert_eq!(server.connection_count(), connections_before_reacquire + 1);
    }
}
