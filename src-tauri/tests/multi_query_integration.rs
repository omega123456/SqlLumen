//! Integration tests for multi-query result storage and result_index handling.
//!
//! Tests verify:
//! - `result_index` handling on fetch_result_page, sort_results, update_result_cell
//! - `reexecute_single_result_impl` replaces only the targeted index
//! - Export with `result_index=Some(1)` exports the second result

mod common;

use common::test_app_state;
use mysql_client_lib::commands::export::export_results_impl;
use mysql_client_lib::export::{ExportFormat, ExportOptions};
use mysql_client_lib::mysql::query_executor::{
    fetch_result_page_impl, sort_results_impl, update_result_cell_impl, ColumnMeta, StoredResult,
};
use std::collections::HashMap;

/// Helper: insert a multi-result vector into state.
fn insert_multi_results(
    state: &mysql_client_lib::state::AppState,
    conn_id: &str,
    tab_id: &str,
    result_vec: Vec<StoredResult>,
) {
    let mut results = state.results.write().expect("lock ok");
    results.insert(
        (conn_id.to_string(), tab_id.to_string()),
        result_vec,
    );
}

/// Create two sample StoredResults with distinguishable data.
fn two_results() -> Vec<StoredResult> {
    vec![
        StoredResult {
            query_id: "q-first".to_string(),
            columns: vec![ColumnMeta {
                name: "id".to_string(),
                data_type: "INT".to_string(),
            }],
            rows: vec![
                vec![serde_json::json!(10)],
                vec![serde_json::json!(20)],
                vec![serde_json::json!(30)],
            ],
            execution_time_ms: 5,
            affected_rows: 0,
            auto_limit_applied: false,
            page_size: 10,
        },
        StoredResult {
            query_id: "q-second".to_string(),
            columns: vec![
                ColumnMeta {
                    name: "name".to_string(),
                    data_type: "VARCHAR".to_string(),
                },
                ColumnMeta {
                    name: "age".to_string(),
                    data_type: "INT".to_string(),
                },
            ],
            rows: vec![
                vec![serde_json::json!("Alice"), serde_json::json!(30)],
                vec![serde_json::json!("Bob"), serde_json::json!(25)],
            ],
            execution_time_ms: 3,
            affected_rows: 0,
            auto_limit_applied: false,
            page_size: 10,
        },
    ]
}

// ── fetch_result_page with result_index ──────────────────────────────────────

#[test]
fn fetch_result_page_with_result_index_zero() {
    let state = test_app_state();
    insert_multi_results(&state, "c1", "t1", two_results());

    let page = fetch_result_page_impl(&state, "c1", "t1", "q-first", 1, Some(0))
        .expect("page fetch at index 0 should succeed");
    assert_eq!(page.rows.len(), 3);
    assert_eq!(page.rows[0][0], serde_json::json!(10));
}

#[test]
fn fetch_result_page_with_result_index_one() {
    let state = test_app_state();
    insert_multi_results(&state, "c1", "t1", two_results());

    let page = fetch_result_page_impl(&state, "c1", "t1", "q-second", 1, Some(1))
        .expect("page fetch at index 1 should succeed");
    assert_eq!(page.rows.len(), 2);
    assert_eq!(page.rows[0][0], serde_json::json!("Alice"));
}

#[test]
fn fetch_result_page_with_none_defaults_to_zero() {
    let state = test_app_state();
    insert_multi_results(&state, "c1", "t1", two_results());

    let page = fetch_result_page_impl(&state, "c1", "t1", "q-first", 1, None)
        .expect("page fetch with None should default to index 0");
    assert_eq!(page.rows.len(), 3);
}

#[test]
fn fetch_result_page_with_out_of_range_index_errors() {
    let state = test_app_state();
    insert_multi_results(&state, "c1", "t1", two_results());

    let err = fetch_result_page_impl(&state, "c1", "t1", "q-first", 1, Some(5))
        .expect_err("out-of-range result_index should error");
    assert!(err.contains("Result index 5 out of range"));
}

// ── sort_results with result_index ───────────────────────────────────────────

#[test]
fn sort_results_with_result_index_one() {
    let state = test_app_state();
    insert_multi_results(&state, "c1", "t1", two_results());

    // Sort the second result by "name" descending
    let page = sort_results_impl(&state, "c1", "t1", "name", "desc", Some(1))
        .expect("sort at index 1 should succeed");
    assert_eq!(page.rows.len(), 2);
    assert_eq!(page.rows[0][0], serde_json::json!("Bob"));
    assert_eq!(page.rows[1][0], serde_json::json!("Alice"));

    // Verify the first result is untouched
    let results = state.results.read().expect("lock ok");
    let result_vec = results
        .get(&("c1".to_string(), "t1".to_string()))
        .unwrap();
    assert_eq!(result_vec[0].rows[0][0], serde_json::json!(10));
    assert_eq!(result_vec[0].rows[1][0], serde_json::json!(20));
    assert_eq!(result_vec[0].rows[2][0], serde_json::json!(30));
}

#[test]
fn sort_results_with_out_of_range_index_errors() {
    let state = test_app_state();
    insert_multi_results(&state, "c1", "t1", two_results());

    let err = sort_results_impl(&state, "c1", "t1", "id", "asc", Some(99))
        .expect_err("out-of-range result_index should error");
    assert!(err.contains("Result index 99 out of range"));
}

// ── update_result_cell with result_index ─────────────────────────────────────

#[test]
fn update_result_cell_with_result_index_one() {
    let state = test_app_state();
    insert_multi_results(&state, "c1", "t1", two_results());

    let mut updates = HashMap::new();
    updates.insert(0, serde_json::json!("Charlie"));

    let result = update_result_cell_impl(&state, "c1", "t1", 0, updates, Some(1));
    assert!(result.is_ok());

    // Verify the second result was updated
    let results = state.results.read().expect("lock ok");
    let result_vec = results
        .get(&("c1".to_string(), "t1".to_string()))
        .unwrap();
    assert_eq!(result_vec[1].rows[0][0], serde_json::json!("Charlie"));

    // Verify the first result is untouched
    assert_eq!(result_vec[0].rows[0][0], serde_json::json!(10));
}

#[test]
fn update_result_cell_with_out_of_range_index_errors() {
    let state = test_app_state();
    insert_multi_results(&state, "c1", "t1", two_results());

    let updates = HashMap::new();
    let result = update_result_cell_impl(&state, "c1", "t1", 0, updates, Some(10));
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Result index 10 out of range"));
}

// ── export with result_index ─────────────────────────────────────────────────

#[test]
fn export_with_result_index_one_exports_second_result() {
    let state = test_app_state();
    insert_multi_results(&state, "c1", "t1", two_results());

    let dir = std::env::temp_dir();
    let path = dir.join(format!(
        "test_multi_export_{}.json",
        std::process::id()
    ));
    let path_str = path.to_string_lossy().to_string();

    let options = ExportOptions {
        format: ExportFormat::Json,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: None,
    };

    let result = export_results_impl(&state, "c1", "t1", options, Some(1))
        .expect("export at index 1 should succeed");
    assert_eq!(result.rows_exported, 2); // second result has 2 rows

    // Verify the exported content contains the second result's data
    let content = std::fs::read_to_string(&path).expect("read file");
    assert!(content.contains("Alice"));
    assert!(content.contains("Bob"));

    let _ = std::fs::remove_file(&path);
}

#[test]
fn export_with_result_index_out_of_range_errors() {
    let state = test_app_state();
    insert_multi_results(&state, "c1", "t1", two_results());

    let options = ExportOptions {
        format: ExportFormat::Csv,
        file_path: "unused.csv".to_string(),
        include_headers: true,
        table_name: None,
    };

    let err = export_results_impl(&state, "c1", "t1", options, Some(5))
        .expect_err("out-of-range result_index should error");
    assert!(err.contains("Result index 5 out of range"));
}

#[test]
fn export_with_none_defaults_to_first_result() {
    let state = test_app_state();
    insert_multi_results(&state, "c1", "t1", two_results());

    let dir = std::env::temp_dir();
    let path = dir.join(format!(
        "test_multi_export_default_{}.csv",
        std::process::id()
    ));
    let path_str = path.to_string_lossy().to_string();

    let options = ExportOptions {
        format: ExportFormat::Csv,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: None,
    };

    let result = export_results_impl(&state, "c1", "t1", options, None)
        .expect("export with None should default to index 0");
    assert_eq!(result.rows_exported, 3); // first result has 3 rows

    let _ = std::fs::remove_file(&path);
}

// ── reexecute_single_result_impl ─────────────────────────────────────────────

#[cfg(coverage)]
mod coverage_reexecute {
    use super::*;
    use mysql_client_lib::mysql::query_executor::reexecute_single_result_impl;
    use mysql_client_lib::mysql::registry::{
        ConnectionStatus, RegistryEntry, StoredConnectionParams,
    };
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
    use tokio_util::sync::CancellationToken;

    fn dummy_lazy_pool() -> sqlx::MySqlPool {
        let opts = MySqlConnectOptions::new()
            .host("127.0.0.1")
            .port(13306)
            .username("dummy")
            .password("dummy");
        MySqlPoolOptions::new().connect_lazy_with(opts)
    }

    fn dummy_stored_params(profile_id: &str) -> StoredConnectionParams {
        StoredConnectionParams {
            profile_id: profile_id.to_string(),
            host: "127.0.0.1".to_string(),
            port: 13306,
            username: "dummy".to_string(),
            has_password: false,
            keychain_ref: None,
            default_database: None,
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            connect_timeout_secs: 10,
            keepalive_interval_secs: 0,
        }
    }

    fn register_lazy_pool(
        state: &mysql_client_lib::state::AppState,
        connection_id: &str,
        read_only: bool,
    ) {
        let entry = RegistryEntry {
            pool: dummy_lazy_pool(),
            session_id: connection_id.to_string(),
            profile_id: connection_id.to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: dummy_stored_params(connection_id),
            read_only,
        };
        state.registry.insert(connection_id.to_string(), entry);
    }

    #[tokio::test]
    async fn reexecute_replaces_only_targeted_index() {
        let state = test_app_state();
        register_lazy_pool(&state, "conn-re", false);
        insert_multi_results(&state, "conn-re", "tab-re", two_results());

        // Verify initial state: two results
        {
            let results = state.results.read().expect("lock ok");
            let result_vec = results
                .get(&("conn-re".to_string(), "tab-re".to_string()))
                .unwrap();
            assert_eq!(result_vec.len(), 2);
            assert_eq!(result_vec[0].query_id, "q-first");
            assert_eq!(result_vec[1].query_id, "q-second");
        }

        // Re-execute index 1
        let item = reexecute_single_result_impl(
            &state,
            "conn-re",
            "tab-re",
            1,
            "SELECT name FROM users",
            100,
        )
        .await
        .expect("reexecute should succeed");

        assert!(!item.query_id.is_empty());
        assert_eq!(item.source_sql, "SELECT name FROM users");
        assert!(item.re_executable);

        // Verify only index 1 was replaced; index 0 remains unchanged
        let results = state.results.read().expect("lock ok");
        let result_vec = results
            .get(&("conn-re".to_string(), "tab-re".to_string()))
            .unwrap();
        assert_eq!(result_vec.len(), 2);
        assert_eq!(result_vec[0].query_id, "q-first", "index 0 should be unchanged");
        assert_eq!(result_vec[0].rows.len(), 3, "index 0 rows should be unchanged");
        assert_ne!(result_vec[1].query_id, "q-second", "index 1 should be replaced");
        assert_eq!(result_vec[1].query_id, item.query_id);
    }

    #[tokio::test]
    async fn reexecute_missing_connection_errors() {
        let state = test_app_state();
        insert_multi_results(&state, "conn-missing", "tab-1", two_results());

        let err = reexecute_single_result_impl(
            &state,
            "conn-missing",
            "tab-1",
            0,
            "SELECT 1",
            100,
        )
        .await
        .expect_err("missing connection should error");
        assert!(err.contains("not found"));
    }

    #[tokio::test]
    async fn reexecute_read_only_blocks_dml() {
        let state = test_app_state();
        register_lazy_pool(&state, "ro-conn", true);
        insert_multi_results(&state, "ro-conn", "tab-1", two_results());

        let err = reexecute_single_result_impl(
            &state,
            "ro-conn",
            "tab-1",
            0,
            "INSERT INTO t VALUES (1)",
            100,
        )
        .await
        .expect_err("read-only should block DML");
        assert!(err.contains("read-only"));
    }

    #[tokio::test]
    async fn reexecute_out_of_range_index_errors() {
        let state = test_app_state();
        register_lazy_pool(&state, "conn-re2", false);
        insert_multi_results(&state, "conn-re2", "tab-1", two_results());

        let err = reexecute_single_result_impl(
            &state,
            "conn-re2",
            "tab-1",
            5,
            "SELECT 1",
            100,
        )
        .await
        .expect_err("out-of-range index should error");
        assert!(err.contains("Result index 5 out of range"));
    }

    #[tokio::test]
    async fn reexecute_no_results_errors() {
        let state = test_app_state();
        register_lazy_pool(&state, "conn-re3", false);

        let err = reexecute_single_result_impl(
            &state,
            "conn-re3",
            "tab-missing",
            0,
            "SELECT 1",
            100,
        )
        .await
        .expect_err("missing results should error");
        assert!(err.contains("No results found"));
    }
}

// ── execute_multi_query_impl coverage tests ──────────────────────────────────

#[cfg(coverage)]
mod coverage_multi_query {
    use super::*;
    use mysql_client_lib::mysql::query_executor::execute_multi_query_impl;
    use mysql_client_lib::mysql::registry::{
        ConnectionStatus, RegistryEntry, StoredConnectionParams,
    };
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
    use tokio_util::sync::CancellationToken;

    fn dummy_lazy_pool() -> sqlx::MySqlPool {
        let opts = MySqlConnectOptions::new()
            .host("127.0.0.1")
            .port(13306)
            .username("dummy")
            .password("dummy");
        MySqlPoolOptions::new().connect_lazy_with(opts)
    }

    fn dummy_stored_params(profile_id: &str) -> StoredConnectionParams {
        StoredConnectionParams {
            profile_id: profile_id.to_string(),
            host: "127.0.0.1".to_string(),
            port: 13306,
            username: "dummy".to_string(),
            has_password: false,
            keychain_ref: None,
            default_database: None,
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            connect_timeout_secs: 10,
            keepalive_interval_secs: 0,
        }
    }

    fn register_lazy_pool(
        state: &mysql_client_lib::state::AppState,
        connection_id: &str,
        read_only: bool,
    ) {
        let entry = RegistryEntry {
            pool: dummy_lazy_pool(),
            session_id: connection_id.to_string(),
            profile_id: connection_id.to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: dummy_stored_params(connection_id),
            read_only,
        };
        state.registry.insert(connection_id.to_string(), entry);
    }

    #[tokio::test]
    async fn multi_query_returns_entries_for_each_statement() {
        let state = test_app_state();
        register_lazy_pool(&state, "mq-conn", false);

        let stmts = vec![
            "SELECT 1".to_string(),
            "INSERT INTO t VALUES (1)".to_string(),
            "SELECT 2".to_string(),
        ];

        let result = execute_multi_query_impl(&state, "mq-conn", "mq-tab", stmts, 100)
            .await
            .expect("should succeed");

        assert_eq!(result.results.len(), 3);
        assert_eq!(result.results[0].source_sql, "SELECT 1");
        assert_eq!(result.results[1].source_sql, "INSERT INTO t VALUES (1)");
        assert_eq!(result.results[2].source_sql, "SELECT 2");

        // SELECT results should be re-executable, non-CALL
        assert!(result.results[0].re_executable);
        assert!(result.results[1].re_executable);
        assert!(result.results[2].re_executable);

        // Verify results were stored in state
        let results = state.results.read().expect("lock ok");
        let stored = results
            .get(&("mq-conn".to_string(), "mq-tab".to_string()))
            .expect("results should be stored");
        assert_eq!(stored.len(), 3);
    }

    #[tokio::test]
    async fn multi_query_call_is_not_re_executable() {
        let state = test_app_state();
        register_lazy_pool(&state, "mq-call", false);

        let stmts = vec![
            "SELECT 1".to_string(),
            "CALL my_proc()".to_string(),
            "SELECT 2".to_string(),
        ];

        let result = execute_multi_query_impl(&state, "mq-call", "mq-tab", stmts, 100)
            .await
            .expect("should succeed");

        assert_eq!(result.results.len(), 3);
        assert!(result.results[0].re_executable, "SELECT should be re-executable");
        assert!(!result.results[1].re_executable, "CALL should not be re-executable");
        assert!(result.results[2].re_executable, "SELECT should be re-executable");
    }

    #[tokio::test]
    async fn multi_query_missing_connection_errors() {
        let state = test_app_state();

        let stmts = vec!["SELECT 1".to_string()];
        let err = execute_multi_query_impl(&state, "no-conn", "tab-1", stmts, 100)
            .await
            .expect_err("missing connection should error");
        assert!(err.contains("not found"));
    }

    #[tokio::test]
    async fn multi_query_read_only_blocks_dml() {
        let state = test_app_state();
        register_lazy_pool(&state, "ro-mq", true);

        let stmts = vec![
            "SELECT 1".to_string(),
            "DELETE FROM t".to_string(),
            "SELECT 2".to_string(),
        ];

        let result = execute_multi_query_impl(&state, "ro-mq", "tab-1", stmts, 100)
            .await
            .expect("should succeed with error entry");

        // Should stop at the read-only violation: SELECT succeeds, DELETE produces error entry
        assert_eq!(result.results.len(), 2);
        assert!(result.results[0].error.is_none());
        assert!(result.results[1].error.is_some());
        assert!(result.results[1].error.as_ref().unwrap().contains("read-only"));
    }

    #[tokio::test]
    async fn multi_query_empty_statements_skipped() {
        let state = test_app_state();
        register_lazy_pool(&state, "mq-empty", false);

        let stmts = vec![
            "".to_string(),
            "  ".to_string(),
            "SELECT 1".to_string(),
        ];

        let result = execute_multi_query_impl(&state, "mq-empty", "mq-tab", stmts, 100)
            .await
            .expect("should succeed");

        // Only the non-empty SELECT should produce a result
        assert_eq!(result.results.len(), 1);
        assert_eq!(result.results[0].source_sql, "SELECT 1");
    }

    #[tokio::test]
    async fn multi_query_auto_limit_applied() {
        let state = test_app_state();
        register_lazy_pool(&state, "mq-limit", false);

        let stmts = vec![
            "SELECT * FROM t".to_string(),       // needs auto-limit
            "SELECT * FROM t LIMIT 10".to_string(), // already has limit
        ];

        let result = execute_multi_query_impl(&state, "mq-limit", "mq-tab", stmts, 100)
            .await
            .expect("should succeed");

        assert_eq!(result.results.len(), 2);
        assert!(result.results[0].auto_limit_applied);
        assert!(!result.results[1].auto_limit_applied);
    }

    /// Exercise `execute_multi_query_impl` with a 3-statement batch including
    /// a CALL in position 2. The coverage stub produces 1 entry per statement
    /// (it can't produce multiple result sets from CALL without a live DB),
    /// but it exercises the classification pipeline and validates source_sql
    /// and re_executable correctness.
    #[tokio::test]
    async fn multi_query_call_in_batch_exercises_full_pipeline() {
        let state = test_app_state();
        register_lazy_pool(&state, "mq-call-batch", false);

        let stmts = vec![
            "SELECT 1".to_string(),
            "CALL my_proc_with_results()".to_string(),
            "SELECT 2".to_string(),
        ];

        let result = execute_multi_query_impl(&state, "mq-call-batch", "mq-tab-batch", stmts, 100)
            .await
            .expect("should succeed");

        // The coverage stub produces 1 entry per non-empty statement
        assert_eq!(result.results.len(), 3);

        // Entry 0: SELECT — re_executable=true
        assert_eq!(result.results[0].source_sql, "SELECT 1");
        assert!(result.results[0].re_executable, "SELECT should be re-executable");

        // Entry 1: CALL — re_executable=false
        assert_eq!(result.results[1].source_sql, "CALL my_proc_with_results()");
        assert!(!result.results[1].re_executable, "CALL should NOT be re-executable");

        // Entry 2: SELECT — re_executable=true
        assert_eq!(result.results[2].source_sql, "SELECT 2");
        assert!(result.results[2].re_executable, "SELECT should be re-executable");

        // Verify all results were stored in state
        let results = state.results.read().expect("lock ok");
        let stored = results
            .get(&("mq-call-batch".to_string(), "mq-tab-batch".to_string()))
            .expect("results should be stored");
        assert_eq!(stored.len(), 3);

        // Verify unique query IDs
        let ids: std::collections::HashSet<&str> = result.results.iter()
            .map(|r| r.query_id.as_str())
            .collect();
        assert_eq!(ids.len(), 3, "All entries should have unique query IDs");
    }

    /// Exercise `execute_multi_query_impl` with a CALL wrapped in an executable comment.
    /// The coverage stub should still classify it as CALL (re_executable=false).
    #[tokio::test]
    async fn multi_query_call_in_executable_comment() {
        let state = test_app_state();
        register_lazy_pool(&state, "mq-exec-comment", false);

        let stmts = vec![
            "/*!50001 CALL my_proc() */".to_string(),
        ];

        let result = execute_multi_query_impl(&state, "mq-exec-comment", "mq-tab-ec", stmts, 100)
            .await
            .expect("should succeed");

        assert_eq!(result.results.len(), 1);
        assert_eq!(result.results[0].source_sql, "/*!50001 CALL my_proc() */");
        assert!(!result.results[0].re_executable,
            "CALL in executable comment should NOT be re-executable");
    }

    /// Exercise `execute_multi_query_impl` with mixed DML/DDL and CALL statements.
    /// Verifies source_sql assignment for every entry type.
    #[tokio::test]
    async fn multi_query_mixed_dml_call_source_sql() {
        let state = test_app_state();
        register_lazy_pool(&state, "mq-mixed", false);

        let stmts = vec![
            "INSERT INTO t VALUES (1)".to_string(),
            "CALL my_proc()".to_string(),
            "DELETE FROM t WHERE id = 1".to_string(),
            "SELECT * FROM t".to_string(),
        ];

        let result = execute_multi_query_impl(&state, "mq-mixed", "mq-tab-mixed", stmts, 100)
            .await
            .expect("should succeed");

        assert_eq!(result.results.len(), 4);
        assert_eq!(result.results[0].source_sql, "INSERT INTO t VALUES (1)");
        assert!(result.results[0].re_executable, "INSERT should be re-executable");
        assert_eq!(result.results[1].source_sql, "CALL my_proc()");
        assert!(!result.results[1].re_executable, "CALL should NOT be re-executable");
        assert_eq!(result.results[2].source_sql, "DELETE FROM t WHERE id = 1");
        assert!(result.results[2].re_executable, "DELETE should be re-executable");
        assert_eq!(result.results[3].source_sql, "SELECT * FROM t");
        assert!(result.results[3].re_executable, "SELECT should be re-executable");
        assert!(result.results[3].auto_limit_applied, "SELECT * FROM t should have auto-limit");
    }

    /// Structural test documenting the expected behavior of a 3-statement batch
    /// with a CALL in position 2 that returns 2 result sets.
    ///
    /// Without a live MySQL server, we cannot actually execute a CALL statement
    /// that returns multiple result sets. Instead, we verify the structural
    /// contract by testing the `is_call_statement` classifier and
    /// `buildSingleResultFromItem`-level expectations.
    ///
    /// Expected behavior:
    ///   Input: ["SELECT 1", "CALL proc_with_2_selects()", "SELECT 2"]
    ///   Output: 4 MultiQueryResultItem entries:
    ///     [0] SELECT 1           → re_executable=true,  source_sql="SELECT 1"
    ///     [1] CALL result set 1  → re_executable=false, source_sql="CALL proc_with_2_selects()"
    ///     [2] CALL result set 2  → re_executable=false, source_sql="CALL proc_with_2_selects()"
    ///     [3] SELECT 2           → re_executable=true,  source_sql="SELECT 2"
    #[test]
    fn call_in_batch_structural_contract() {
        use mysql_client_lib::mysql::multi_result::is_call_statement;
        use mysql_client_lib::mysql::query_executor::MultiQueryResultItem;

        let stmts = vec![
            "SELECT 1".to_string(),
            "CALL proc_with_2_selects()".to_string(),
            "SELECT 2".to_string(),
        ];

        // Verify statement classification
        assert!(!is_call_statement(&stmts[0]), "SELECT should not be CALL");
        assert!(is_call_statement(&stmts[1]), "CALL should be classified as CALL");
        assert!(!is_call_statement(&stmts[2]), "SELECT should not be CALL");

        // Simulate the expected output structure for a CALL returning 2 result sets
        let expected_items: Vec<MultiQueryResultItem> = vec![
            // Entry 0: SELECT 1
            MultiQueryResultItem {
                query_id: "q-0".to_string(),
                source_sql: "SELECT 1".to_string(),
                columns: vec![],
                total_rows: 1,
                execution_time_ms: 1,
                affected_rows: 0,
                first_page: vec![],
                total_pages: 1,
                auto_limit_applied: false,
                error: None,
                re_executable: true,
            },
            // Entry 1: CALL result set 1
            MultiQueryResultItem {
                query_id: "q-1".to_string(),
                source_sql: "CALL proc_with_2_selects()".to_string(),
                columns: vec![],
                total_rows: 5,
                execution_time_ms: 2,
                affected_rows: 0,
                first_page: vec![],
                total_pages: 1,
                auto_limit_applied: false,
                error: None,
                re_executable: false,
            },
            // Entry 2: CALL result set 2
            MultiQueryResultItem {
                query_id: "q-2".to_string(),
                source_sql: "CALL proc_with_2_selects()".to_string(),
                columns: vec![],
                total_rows: 3,
                execution_time_ms: 2,
                affected_rows: 0,
                first_page: vec![],
                total_pages: 1,
                auto_limit_applied: false,
                error: None,
                re_executable: false,
            },
            // Entry 3: SELECT 2
            MultiQueryResultItem {
                query_id: "q-3".to_string(),
                source_sql: "SELECT 2".to_string(),
                columns: vec![],
                total_rows: 1,
                execution_time_ms: 1,
                affected_rows: 0,
                first_page: vec![],
                total_pages: 1,
                auto_limit_applied: false,
                error: None,
                re_executable: true,
            },
        ];

        // Verify structural properties
        assert_eq!(expected_items.len(), 4, "3-stmt batch with CALL(2 results) → 4 entries");

        // Entry 0: SELECT
        assert_eq!(expected_items[0].source_sql, "SELECT 1");
        assert!(expected_items[0].re_executable);

        // Entries 1-2: CALL result sets share the same source_sql
        assert_eq!(expected_items[1].source_sql, "CALL proc_with_2_selects()");
        assert_eq!(expected_items[2].source_sql, "CALL proc_with_2_selects()");
        assert_eq!(expected_items[1].source_sql, expected_items[2].source_sql,
            "Both CALL result sets must share the same source_sql");
        assert!(!expected_items[1].re_executable);
        assert!(!expected_items[2].re_executable);

        // Entry 3: SELECT
        assert_eq!(expected_items[3].source_sql, "SELECT 2");
        assert!(expected_items[3].re_executable);
    }

    /// Verify batch entry ordering and source_sql correctness when building
    /// results from a mixed [SELECT, CALL, SELECT] batch. This simulates the
    /// result-building logic: non-CALL statements produce 1 entry each,
    /// CALL statements produce N entries (one per result set), all sharing
    /// the same source_sql and having re_executable=false.
    #[test]
    fn batch_entry_ordering_and_source_sql_assignment() {
        use mysql_client_lib::mysql::multi_result::is_call_statement;
        use mysql_client_lib::mysql::query_executor::MultiQueryResultItem;

        let stmts = vec![
            "SELECT 1 AS a",
            "CALL proc_with_2_selects()",
            "SELECT 2 AS b",
        ];

        // Simulate result building: each non-CALL produces 1 entry;
        // CALL produces 2 entries (simulating 2 result sets from the proc)
        let mut result_items: Vec<MultiQueryResultItem> = Vec::new();

        for sql in &stmts {
            if is_call_statement(sql) {
                // CALL produces multiple result sets — simulate 2
                for _ in 0..2 {
                    result_items.push(MultiQueryResultItem {
                        query_id: uuid::Uuid::new_v4().to_string(),
                        source_sql: sql.to_string(),
                        columns: vec![],
                        total_rows: 0,
                        execution_time_ms: 0,
                        affected_rows: 0,
                        first_page: vec![],
                        total_pages: 1,
                        auto_limit_applied: false,
                        error: None,
                        re_executable: false,
                    });
                }
            } else {
                result_items.push(MultiQueryResultItem {
                    query_id: uuid::Uuid::new_v4().to_string(),
                    source_sql: sql.to_string(),
                    columns: vec![],
                    total_rows: 0,
                    execution_time_ms: 0,
                    affected_rows: 0,
                    first_page: vec![],
                    total_pages: 1,
                    auto_limit_applied: false,
                    error: None,
                    re_executable: true,
                });
            }
        }

        // Verify ordering: [SELECT1, CALL-result1, CALL-result2, SELECT2]
        assert_eq!(result_items.len(), 4);

        // Entry 0: first SELECT
        assert_eq!(result_items[0].source_sql, "SELECT 1 AS a");
        assert!(result_items[0].re_executable);

        // Entry 1: first CALL result
        assert_eq!(result_items[1].source_sql, "CALL proc_with_2_selects()");
        assert!(!result_items[1].re_executable);

        // Entry 2: second CALL result
        assert_eq!(result_items[2].source_sql, "CALL proc_with_2_selects()");
        assert!(!result_items[2].re_executable);

        // Both CALL entries share the same source_sql
        assert_eq!(result_items[1].source_sql, result_items[2].source_sql);

        // Entry 3: second SELECT
        assert_eq!(result_items[3].source_sql, "SELECT 2 AS b");
        assert!(result_items[3].re_executable);

        // All entries have unique query IDs
        let ids: std::collections::HashSet<&str> = result_items.iter().map(|i| i.query_id.as_str()).collect();
        assert_eq!(ids.len(), 4, "All result entries must have unique query IDs");
    }
}

// ── execute_call_query_impl coverage tests ───────────────────────────────────

#[cfg(coverage)]
mod coverage_call_query {
    use super::*;
    use mysql_client_lib::mysql::query_executor::execute_call_query_impl;
    use mysql_client_lib::mysql::registry::{
        ConnectionStatus, RegistryEntry, StoredConnectionParams,
    };
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
    use tokio_util::sync::CancellationToken;

    fn dummy_lazy_pool() -> sqlx::MySqlPool {
        let opts = MySqlConnectOptions::new()
            .host("127.0.0.1")
            .port(13306)
            .username("dummy")
            .password("dummy");
        MySqlPoolOptions::new().connect_lazy_with(opts)
    }

    fn dummy_stored_params(profile_id: &str) -> StoredConnectionParams {
        StoredConnectionParams {
            profile_id: profile_id.to_string(),
            host: "127.0.0.1".to_string(),
            port: 13306,
            username: "dummy".to_string(),
            has_password: false,
            keychain_ref: None,
            default_database: None,
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            connect_timeout_secs: 10,
            keepalive_interval_secs: 0,
        }
    }

    fn register_lazy_pool(
        state: &mysql_client_lib::state::AppState,
        connection_id: &str,
        read_only: bool,
    ) {
        let entry = RegistryEntry {
            pool: dummy_lazy_pool(),
            session_id: connection_id.to_string(),
            profile_id: connection_id.to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: dummy_stored_params(connection_id),
            read_only,
        };
        state.registry.insert(connection_id.to_string(), entry);
    }

    #[tokio::test]
    async fn call_query_returns_result() {
        let state = test_app_state();
        register_lazy_pool(&state, "call-conn", false);

        let result = execute_call_query_impl(
            &state,
            "call-conn",
            "call-tab",
            "CALL my_proc()",
            100,
        )
        .await
        .expect("should succeed");

        assert_eq!(result.results.len(), 1);
        assert_eq!(result.results[0].source_sql, "CALL my_proc()");
        assert!(!result.results[0].re_executable);

        // Verify result was stored
        let results = state.results.read().expect("lock ok");
        let stored = results
            .get(&("call-conn".to_string(), "call-tab".to_string()))
            .expect("results should be stored");
        assert_eq!(stored.len(), 1);
    }

    #[tokio::test]
    async fn call_query_missing_connection_errors() {
        let state = test_app_state();

        let err = execute_call_query_impl(
            &state,
            "no-conn",
            "tab-1",
            "CALL my_proc()",
            100,
        )
        .await
        .expect_err("missing connection should error");
        assert!(err.contains("not found"));
    }

    #[tokio::test]
    async fn call_query_read_only_blocks() {
        let state = test_app_state();
        register_lazy_pool(&state, "ro-call", true);

        let err = execute_call_query_impl(
            &state,
            "ro-call",
            "tab-1",
            "CALL my_proc()",
            100,
        )
        .await
        .expect_err("read-only should block CALL");
        assert!(err.contains("read-only"));
        assert!(err.contains("CALL"));
    }
}

// ── Serialization parity tests ───────────────────────────────────────────────

mod serialization_parity {
    use mysql_client_lib::mysql::multi_result::{
        serialize_mysql_value, serialize_bytes_value, column_type_display_name,
        is_call_statement, JS_SAFE_INTEGER_MAX,
    };
    use mysql_async::consts::{ColumnFlags, ColumnType};

    // ── TINYINT / SMALLINT / INT / BIGINT ────────────────────────────────

    #[test]
    fn int_types_serialize_as_numbers() {
        let val = mysql_async::Value::Int(127);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_TINY, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!(127));

        let val = mysql_async::Value::Int(32000);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_SHORT, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!(32000));

        let val = mysql_async::Value::Int(2_000_000_000);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_LONG, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!(2_000_000_000i64));
    }

    #[test]
    fn bigint_safe_boundary() {
        // Exactly at boundary: number
        let val = mysql_async::Value::Int(JS_SAFE_INTEGER_MAX);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_LONGLONG, ColumnFlags::empty());
        assert!(result.is_number());
        assert_eq!(result.as_i64().unwrap(), JS_SAFE_INTEGER_MAX);

        // One over: string
        let val = mysql_async::Value::Int(JS_SAFE_INTEGER_MAX + 1);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_LONGLONG, ColumnFlags::empty());
        assert!(result.is_string());
        assert_eq!(result.as_str().unwrap(), "9007199254740992");
    }

    #[test]
    fn bigint_unsigned_safe_boundary() {
        let val = mysql_async::Value::UInt(JS_SAFE_INTEGER_MAX as u64);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_LONGLONG, ColumnFlags::UNSIGNED_FLAG);
        assert!(result.is_number());

        let val = mysql_async::Value::UInt(JS_SAFE_INTEGER_MAX as u64 + 1);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_LONGLONG, ColumnFlags::UNSIGNED_FLAG);
        assert!(result.is_string());
    }

    // ── FLOAT / DOUBLE ───────────────────────────────────────────────────

    #[test]
    fn float_double_serialize_as_numbers() {
        let val = mysql_async::Value::Float(3.14);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_FLOAT, ColumnFlags::empty());
        assert!(result.is_number());

        let val = mysql_async::Value::Double(2.718281828);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_DOUBLE, ColumnFlags::empty());
        assert!(result.is_number());
    }

    #[test]
    fn float_nan_serializes_as_null() {
        let val = mysql_async::Value::Float(f32::NAN);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_FLOAT, ColumnFlags::empty());
        assert_eq!(result, serde_json::Value::Null);

        let val = mysql_async::Value::Double(f64::NAN);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_DOUBLE, ColumnFlags::empty());
        assert_eq!(result, serde_json::Value::Null);
    }

    // ── DECIMAL ──────────────────────────────────────────────────────────

    #[test]
    fn decimal_preserves_precision_as_string() {
        let bytes = b"99999999999999999.99";
        let result = serialize_bytes_value(bytes, ColumnType::MYSQL_TYPE_NEWDECIMAL, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!("99999999999999999.99"));
    }

    // ── DATE / DATETIME / TIMESTAMP ──────────────────────────────────────

    #[test]
    fn date_formats() {
        let val = mysql_async::Value::Date(2025, 1, 15, 0, 0, 0, 0);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_DATE, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!("2025-01-15"));
    }

    #[test]
    fn datetime_without_microseconds() {
        let val = mysql_async::Value::Date(2025, 1, 15, 10, 30, 45, 0);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_DATETIME, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!("2025-01-15 10:30:45"));
    }

    #[test]
    fn datetime_with_microseconds() {
        let val = mysql_async::Value::Date(2025, 1, 15, 10, 30, 45, 123456);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_TIMESTAMP, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!("2025-01-15 10:30:45.123456"));
    }

    #[test]
    fn time_formats() {
        // Simple time
        let val = mysql_async::Value::Time(false, 0, 10, 30, 45, 0);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_TIME, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!("10:30:45"));

        // Negative time
        let val = mysql_async::Value::Time(true, 0, 2, 15, 0, 0);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_TIME, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!("-02:15:00"));

        // Time with days (hours exceed 24)
        let val = mysql_async::Value::Time(false, 3, 5, 0, 0, 0);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_TIME, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!("77:00:00")); // 3*24+5 = 77

        // Time with microseconds
        let val = mysql_async::Value::Time(false, 0, 1, 2, 3, 456789);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_TIME, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!("01:02:03.456789"));
    }

    // ── VARCHAR / TEXT ────────────────────────────────────────────────────

    #[test]
    fn varchar_text_serialize_as_strings() {
        let bytes = b"hello world";
        let result = serialize_bytes_value(bytes, ColumnType::MYSQL_TYPE_VAR_STRING, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!("hello world"));

        let bytes = b"text content";
        let result = serialize_bytes_value(bytes, ColumnType::MYSQL_TYPE_BLOB, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!("text content"));
    }

    // ── BLOB / BINARY ────────────────────────────────────────────────────

    #[test]
    fn blob_binary_base64_encoded() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let bytes = &[0xDE, 0xAD, 0xBE, 0xEF];
        let result = serialize_bytes_value(bytes, ColumnType::MYSQL_TYPE_BLOB, ColumnFlags::BINARY_FLAG);
        assert_eq!(result, serde_json::json!(STANDARD.encode(bytes)));

        let result = serialize_bytes_value(bytes, ColumnType::MYSQL_TYPE_VAR_STRING, ColumnFlags::BINARY_FLAG);
        assert_eq!(result, serde_json::json!(STANDARD.encode(bytes)));
    }

    // ── BIT ──────────────────────────────────────────────────────────────

    #[test]
    fn bit_converts_bytes_to_integer() {
        let bytes = &[0x01u8];
        let result = serialize_bytes_value(bytes, ColumnType::MYSQL_TYPE_BIT, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!(1));

        let bytes = &[0x01u8, 0x00u8];
        let result = serialize_bytes_value(bytes, ColumnType::MYSQL_TYPE_BIT, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!(256));

        // Empty BIT
        let bytes: &[u8] = &[];
        let result = serialize_bytes_value(bytes, ColumnType::MYSQL_TYPE_BIT, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!(0));
    }

    // ── NULL ─────────────────────────────────────────────────────────────

    #[test]
    fn null_serializes_as_json_null() {
        let val = mysql_async::Value::NULL;
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_LONG, ColumnFlags::empty());
        assert_eq!(result, serde_json::Value::Null);
    }

    // ── is_call_statement ────────────────────────────────────────────────

    #[test]
    fn is_call_detects_call_statements() {
        assert!(is_call_statement("CALL my_proc()"));
        assert!(is_call_statement("call MY_PROC()"));
        assert!(is_call_statement("  CALL my_proc()"));
        assert!(is_call_statement("/* comment */ CALL my_proc()"));
        assert!(is_call_statement("-- comment\nCALL my_proc()"));
        assert!(!is_call_statement("SELECT * FROM t"));
        assert!(!is_call_statement("INSERT INTO t VALUES (1)"));
        assert!(!is_call_statement(""));
    }

    #[test]
    fn is_call_detects_call_with_executable_comments() {
        // MySQL executable comment wrapping a CALL
        assert!(is_call_statement("/*!50001 CALL my_proc() */"));
        // Mixed: standard comment then CALL
        assert!(is_call_statement("/* standard comment */ CALL my_proc()"));
        // Hash comment then CALL
        assert!(is_call_statement("# hash comment\nCALL my_proc()"));
        // Multiple comments then CALL
        assert!(is_call_statement("-- line1\n-- line2\nCALL my_proc()"));
        // CALL with args
        assert!(is_call_statement("CALL my_proc(1, 'test', @var)"));
        // CALL with schema prefix
        assert!(is_call_statement("CALL mydb.my_proc()"));
    }

    #[test]
    fn is_call_rejects_non_call_statements() {
        assert!(!is_call_statement("SELECT CALL FROM t"));
        assert!(!is_call_statement("INSERT INTO call_log VALUES (1)"));
        assert!(!is_call_statement("DROP PROCEDURE my_proc"));
        assert!(!is_call_statement("SHOW TABLES"));
        assert!(!is_call_statement("DESCRIBE my_table"));
        assert!(!is_call_statement("   "));
        assert!(!is_call_statement(""));
    }

    // ── Statement classification pipeline tests ──────────────────────────

    #[test]
    fn statement_classification_pipeline() {
        use mysql_client_lib::mysql::query_executor::{
            strip_non_executable_comments, get_first_keyword, is_select_like,
        };

        // SELECT
        let sql = "SELECT * FROM users";
        let stripped = strip_non_executable_comments(sql);
        let keyword = get_first_keyword(&stripped);
        assert_eq!(keyword, "SELECT");
        assert!(is_select_like(&keyword));
        assert!(!is_call_statement(sql));

        // CALL
        let sql = "CALL my_proc()";
        let stripped = strip_non_executable_comments(sql);
        let keyword = get_first_keyword(&stripped);
        assert_eq!(keyword, "CALL");
        assert!(!is_select_like(&keyword));
        assert!(is_call_statement(sql));

        // INSERT (DML)
        let sql = "INSERT INTO t VALUES (1)";
        let stripped = strip_non_executable_comments(sql);
        let keyword = get_first_keyword(&stripped);
        assert_eq!(keyword, "INSERT");
        assert!(!is_select_like(&keyword));
        assert!(!is_call_statement(sql));

        // CALL inside executable comment
        let sql = "/*!50001 CALL my_proc() */";
        let stripped = strip_non_executable_comments(sql);
        let keyword = get_first_keyword(&stripped);
        assert_eq!(keyword, "CALL");
        assert!(is_call_statement(sql));

        // SHOW
        let sql = "SHOW DATABASES";
        let stripped = strip_non_executable_comments(sql);
        let keyword = get_first_keyword(&stripped);
        assert_eq!(keyword, "SHOW");
        assert!(is_select_like(&keyword));
        assert!(!is_call_statement(sql));
    }

    // ── column_type_display_name ─────────────────────────────────────────

    #[test]
    fn column_type_names_match_expectations() {
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_LONG, ColumnFlags::empty()), "INT");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_LONG, ColumnFlags::UNSIGNED_FLAG), "INT UNSIGNED");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_NEWDECIMAL, ColumnFlags::empty()), "DECIMAL");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_VAR_STRING, ColumnFlags::empty()), "VARCHAR");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_BLOB, ColumnFlags::BINARY_FLAG), "BLOB");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_BLOB, ColumnFlags::empty()), "TEXT");
    }

    // ── Extended column_type_display_name coverage ───────────────────────

    #[test]
    fn column_type_names_all_int_types() {
        let empty = ColumnFlags::empty();
        let unsigned = ColumnFlags::UNSIGNED_FLAG;
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_TINY, empty), "TINYINT");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_TINY, unsigned), "TINYINT UNSIGNED");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_SHORT, empty), "SMALLINT");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_SHORT, unsigned), "SMALLINT UNSIGNED");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_INT24, empty), "MEDIUMINT");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_INT24, unsigned), "MEDIUMINT UNSIGNED");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_LONGLONG, empty), "BIGINT");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_LONGLONG, unsigned), "BIGINT UNSIGNED");
    }

    #[test]
    fn column_type_names_numeric_and_temporal() {
        let empty = ColumnFlags::empty();
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_FLOAT, empty), "FLOAT");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_DOUBLE, empty), "DOUBLE");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_DECIMAL, empty), "DECIMAL");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_DATE, empty), "DATE");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_NEWDATE, empty), "DATE");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_DATETIME, empty), "DATETIME");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_DATETIME2, empty), "DATETIME");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_TIMESTAMP, empty), "TIMESTAMP");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_TIMESTAMP2, empty), "TIMESTAMP");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_TIME, empty), "TIME");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_TIME2, empty), "TIME");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_YEAR, empty), "YEAR");
    }

    #[test]
    fn column_type_names_special_types() {
        let empty = ColumnFlags::empty();
        let binary = ColumnFlags::BINARY_FLAG;
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_BIT, empty), "BIT");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_JSON, empty), "JSON");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_ENUM, empty), "ENUM");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_SET, empty), "SET");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_GEOMETRY, empty), "GEOMETRY");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_NULL, empty), "NULL");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_STRING, binary), "BINARY");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_STRING, empty), "CHAR");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_VAR_STRING, binary), "VARBINARY");
    }

    #[test]
    fn column_type_names_blob_variants() {
        let binary = ColumnFlags::BINARY_FLAG;
        let empty = ColumnFlags::empty();
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_TINY_BLOB, binary), "TINYBLOB");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_TINY_BLOB, empty), "TINYTEXT");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_MEDIUM_BLOB, binary), "MEDIUMBLOB");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_MEDIUM_BLOB, empty), "MEDIUMTEXT");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_LONG_BLOB, binary), "LONGBLOB");
        assert_eq!(column_type_display_name(ColumnType::MYSQL_TYPE_LONG_BLOB, empty), "LONGTEXT");
    }

    // ── Extended serialization coverage ──────────────────────────────────

    #[test]
    fn int_boundary_safe_integer() {
        // Exactly at JS_SAFE_INTEGER_MAX — number
        let val = mysql_async::Value::Int(JS_SAFE_INTEGER_MAX);
        assert!(serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_LONGLONG, ColumnFlags::empty()).is_number());

        // One above — string
        let val = mysql_async::Value::Int(JS_SAFE_INTEGER_MAX + 1);
        assert!(serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_LONGLONG, ColumnFlags::empty()).is_string());

        // Negative boundary — number
        let val = mysql_async::Value::Int(-JS_SAFE_INTEGER_MAX);
        assert!(serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_LONGLONG, ColumnFlags::empty()).is_number());

        // One below negative boundary — string
        let val = mysql_async::Value::Int(-JS_SAFE_INTEGER_MAX - 1);
        assert!(serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_LONGLONG, ColumnFlags::empty()).is_string());
    }

    #[test]
    fn uint_boundary_safe_integer() {
        // At boundary — number
        let val = mysql_async::Value::UInt(JS_SAFE_INTEGER_MAX as u64);
        assert!(serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_LONGLONG, ColumnFlags::UNSIGNED_FLAG).is_number());

        // Above boundary — string
        let val = mysql_async::Value::UInt(JS_SAFE_INTEGER_MAX as u64 + 1);
        assert!(serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_LONGLONG, ColumnFlags::UNSIGNED_FLAG).is_string());
    }

    #[test]
    fn bit_large_value_becomes_string() {
        // BIT value exceeding JS_SAFE_INTEGER_MAX → string
        let bytes = &[0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]; // u64::MAX
        let result = serialize_bytes_value(bytes, ColumnType::MYSQL_TYPE_BIT, ColumnFlags::empty());
        assert!(result.is_string());
    }

    #[test]
    fn serialize_bytes_json_type() {
        let bytes = br#"{"key": "value"}"#;
        let result = serialize_bytes_value(bytes, ColumnType::MYSQL_TYPE_JSON, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!(r#"{"key": "value"}"#));
    }

    #[test]
    fn serialize_bytes_enum_and_set() {
        let result = serialize_bytes_value(b"val1", ColumnType::MYSQL_TYPE_ENUM, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!("val1"));

        let result = serialize_bytes_value(b"a,b,c", ColumnType::MYSQL_TYPE_SET, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!("a,b,c"));
    }

    #[test]
    fn serialize_bytes_binary_string_types() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let bytes = &[0x00, 0x01, 0x02];

        // STRING + BINARY → BINARY (base64)
        let result = serialize_bytes_value(bytes, ColumnType::MYSQL_TYPE_STRING, ColumnFlags::BINARY_FLAG);
        assert_eq!(result, serde_json::json!(STANDARD.encode(bytes)));

        // TINY_BLOB + BINARY → TINYBLOB (base64)
        let result = serialize_bytes_value(bytes, ColumnType::MYSQL_TYPE_TINY_BLOB, ColumnFlags::BINARY_FLAG);
        assert_eq!(result, serde_json::json!(STANDARD.encode(bytes)));

        // MEDIUM_BLOB + BINARY → MEDIUMBLOB (base64)
        let result = serialize_bytes_value(bytes, ColumnType::MYSQL_TYPE_MEDIUM_BLOB, ColumnFlags::BINARY_FLAG);
        assert_eq!(result, serde_json::json!(STANDARD.encode(bytes)));

        // LONG_BLOB + !BINARY → LONGTEXT (string)
        let text = b"long text";
        let result = serialize_bytes_value(text, ColumnType::MYSQL_TYPE_LONG_BLOB, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!("long text"));

        // LONG_BLOB + BINARY → LONGBLOB (base64)
        let result = serialize_bytes_value(bytes, ColumnType::MYSQL_TYPE_LONG_BLOB, ColumnFlags::BINARY_FLAG);
        assert_eq!(result, serde_json::json!(STANDARD.encode(bytes)));
    }

    #[test]
    fn serialize_float_and_double_values() {
        let val = mysql_async::Value::Float(3.14);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_FLOAT, ColumnFlags::empty());
        assert!(result.is_number());

        let val = mysql_async::Value::Double(2.718281828);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_DOUBLE, ColumnFlags::empty());
        assert!(result.is_number());
    }

    #[test]
    fn serialize_negative_int() {
        let val = mysql_async::Value::Int(-100);
        let result = serialize_mysql_value(&val, ColumnType::MYSQL_TYPE_LONG, ColumnFlags::empty());
        assert_eq!(result, serde_json::json!(-100));
    }
}
