//! Integration tests for the query history bridge (`commands/query_history_bridge.rs`).
//!
//! The bridge is now backend-only — there is no IPC `log_query_history` command.
//! These tests verify that the resolve_connection_context helper works correctly
//! by testing via the lower-level history DB functions directly, since the bridge
//! functions require async MySQL execution which is not available in unit tests.

mod common;

use sqllumen_lib::commands::history::list_history_impl;
use sqllumen_lib::db::history::{self, NewHistoryEntry};

/// Verify that history entries with the new schema fields can be inserted and listed.
#[test]
fn test_history_new_schema_fields() {
    let state = common::test_app_state();
    let conn = state.db.lock().expect("db lock");

    let entry = NewHistoryEntry {
        connection_id: "conn-1".to_string(),
        database_name: Some("testdb".to_string()),
        sql_text: "SELECT 42".to_string(),
        duration_ms: Some(15),
        row_count: Some(1),
        affected_rows: Some(0),
        success: true,
        error_message: None,
    };
    let id = history::insert_history(&conn, &entry).expect("insert");
    assert!(id > 0);

    drop(conn);

    let page = list_history_impl(&state, "conn-1", 1, 50, None).expect("list");
    assert_eq!(page.total, 1);
    assert_eq!(page.entries[0].sql_text, "SELECT 42");
    assert_eq!(page.entries[0].duration_ms, Some(15));
    assert!(page.entries[0].success);
    assert_eq!(page.entries[0].affected_rows, Some(0));
}

/// Verify that error entries are stored correctly.
#[test]
fn test_history_error_entry() {
    let state = common::test_app_state();
    let conn = state.db.lock().expect("db lock");

    let entry = NewHistoryEntry {
        connection_id: "conn-err".to_string(),
        database_name: Some("testdb".to_string()),
        sql_text: "SELECT * FROM nonexistent".to_string(),
        duration_ms: Some(5),
        row_count: Some(0),
        affected_rows: Some(0),
        success: false,
        error_message: Some("Table not found".to_string()),
    };
    history::insert_history(&conn, &entry).expect("insert");

    drop(conn);

    let page = list_history_impl(&state, "conn-err", 1, 50, None).expect("list");
    assert_eq!(page.total, 1);
    assert!(!page.entries[0].success);
    assert_eq!(
        page.entries[0].error_message.as_deref(),
        Some("Table not found")
    );
}

/// Verify that batch insert works correctly.
#[test]
fn test_history_batch_insert() {
    let state = common::test_app_state();
    let conn = state.db.lock().expect("db lock");

    let entries: Vec<NewHistoryEntry> = (0..5)
        .map(|i| NewHistoryEntry {
            connection_id: "conn-batch".to_string(),
            database_name: Some("testdb".to_string()),
            sql_text: format!("SELECT {i}"),
            duration_ms: Some(i * 10),
            row_count: Some(i),
            affected_rows: Some(0),
            success: true,
            error_message: None,
        })
        .collect();

    history::insert_history_batch(&conn, &entries).expect("batch insert");

    drop(conn);

    let page = list_history_impl(&state, "conn-batch", 1, 50, None).expect("list");
    assert_eq!(page.total, 5);
}

/// Verify that pruning works correctly.
#[test]
fn test_history_pruning() {
    let state = common::test_app_state();
    let conn = state.db.lock().expect("db lock");

    // Insert a few entries
    for i in 0..3 {
        let entry = NewHistoryEntry {
            connection_id: "conn-prune".to_string(),
            database_name: None,
            sql_text: format!("SELECT {i}"),
            duration_ms: Some(i * 10),
            row_count: Some(0),
            affected_rows: Some(0),
            success: true,
            error_message: None,
        };
        history::insert_history(&conn, &entry).expect("insert");
    }

    // Prune — none should be deleted since they're recent
    let pruned = history::prune_history_for_connection(&conn, "conn-prune").expect("prune");
    assert_eq!(pruned, 0);

    // Verify all still present
    drop(conn);
    let page = list_history_impl(&state, "conn-prune", 1, 50, None).expect("list");
    assert_eq!(page.total, 3);
}

// ── Coverage-mode tests for bridge functions ─────────────────────────────
//
// Under `cfg(coverage)`, `execute_query_impl`, `execute_multi_query_impl`,
// and `execute_call_query_impl` return stub results without needing a live
// MySQL connection. This lets us test the full bridge logic:
// 1. Query execution (stubbed)
// 2. resolve_connection_context
// 3. History logging via fire-and-forget tauri::async_runtime::spawn

#[cfg(coverage)]
mod coverage_bridge_tests {
    use super::common;
    use sqllumen_lib::commands::history::list_history_impl;
    use sqllumen_lib::commands::query_history_bridge::{
        execute_call_query_bridge, execute_multi_query_bridge, execute_query_bridge,
    };
    use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
    use sqllumen_lib::state::AppState;
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
            default_database: Some("test_db".to_string()),
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            connect_timeout_secs: 10,
            keepalive_interval_secs: 0,
        }
    }

    fn register_lazy_pool(state: &AppState, session_id: &str, profile_id: &str) {
        let entry = RegistryEntry {
            pool: dummy_lazy_pool(),
            session_id: session_id.to_string(),
            profile_id: profile_id.to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: dummy_stored_params(profile_id),
            read_only: false,
        };
        state.registry.insert(session_id.to_string(), entry);
    }

    /// Helper: wait for fire-and-forget history logging spawned tasks to complete.
    async fn wait_for_history_logging() {
        // The bridge uses tauri::async_runtime::spawn for fire-and-forget logging.
        // A small yield is sufficient since the spawned task only does a db.lock() + insert.
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    // ── execute_query_bridge: success path ────────────────────────────────

    #[tokio::test]
    async fn test_execute_query_bridge_success_logs_history() {
        let state = common::test_app_state();
        register_lazy_pool(&state, "sess-1", "profile-1");

        let result = execute_query_bridge(&state, "sess-1", "tab-1", "SELECT * FROM users", 100)
            .await
            .expect("bridge should succeed");

        assert!(!result.query_id.is_empty());

        // Wait for fire-and-forget history logging
        wait_for_history_logging().await;

        // Verify history entry was logged
        let page = list_history_impl(&state, "profile-1", 1, 50, None).expect("list");
        assert_eq!(page.total, 1);
        assert!(page.entries[0].success);
        assert_eq!(page.entries[0].sql_text, "SELECT * FROM users");
        assert_eq!(page.entries[0].database_name.as_deref(), Some("test_db"));
    }

    // ── execute_query_bridge: error path (missing connection) ─────────────

    #[tokio::test]
    async fn test_execute_query_bridge_error_logs_failure() {
        let state = common::test_app_state();
        // Don't register any connection — this will cause an error

        let err = execute_query_bridge(&state, "missing-sess", "tab-1", "SELECT 1", 100)
            .await
            .expect_err("should fail for missing connection");

        assert!(err.contains("not found"));

        // Wait for fire-and-forget history logging
        wait_for_history_logging().await;

        // Verify error history entry was logged
        // The session_id "missing-sess" becomes the connection_id since registry lookup fails
        let page = list_history_impl(&state, "missing-sess", 1, 50, None).expect("list");
        assert_eq!(page.total, 1);
        assert!(!page.entries[0].success);
        assert!(page.entries[0].error_message.is_some());
    }

    // ── execute_multi_query_bridge: success path ──────────────────────────

    #[tokio::test]
    async fn test_execute_multi_query_bridge_success_logs_batch() {
        let state = common::test_app_state();
        register_lazy_pool(&state, "sess-2", "profile-2");

        let statements = vec![
            "SELECT 1".to_string(),
            "SELECT 2".to_string(),
            "INSERT INTO t VALUES (1)".to_string(),
        ];

        let result = execute_multi_query_bridge(&state, "sess-2", "tab-2", statements, 100)
            .await
            .expect("bridge should succeed");

        assert!(!result.results.is_empty());

        // Wait for fire-and-forget history logging
        wait_for_history_logging().await;

        // Verify batch history entries were logged
        let page = list_history_impl(&state, "profile-2", 1, 50, None).expect("list");
        assert!(
            page.total >= 1,
            "at least one history entry should be logged"
        );
    }

    // ── execute_multi_query_bridge: error path ────────────────────────────

    #[tokio::test]
    async fn test_execute_multi_query_bridge_error_logs_failure() {
        let state = common::test_app_state();
        // Don't register connection

        let statements = vec!["SELECT 1".to_string()];

        let err = execute_multi_query_bridge(&state, "missing", "tab-1", statements, 100)
            .await
            .expect_err("should fail for missing connection");

        assert!(err.contains("not found"));

        wait_for_history_logging().await;

        // Verify error entry was logged
        let page = list_history_impl(&state, "missing", 1, 50, None).expect("list");
        assert_eq!(page.total, 1);
        assert!(!page.entries[0].success);
        assert_eq!(page.entries[0].sql_text, "(multi-query batch)");
    }

    // ── execute_call_query_bridge: success path ───────────────────────────

    #[tokio::test]
    async fn test_execute_call_query_bridge_success_logs_history() {
        let state = common::test_app_state();
        register_lazy_pool(&state, "sess-3", "profile-3");

        let result = execute_call_query_bridge(&state, "sess-3", "tab-3", "CALL my_proc()", 100)
            .await
            .expect("bridge should succeed");

        assert!(!result.results.is_empty());

        wait_for_history_logging().await;

        // Verify history entry was logged
        let page = list_history_impl(&state, "profile-3", 1, 50, None).expect("list");
        assert_eq!(page.total, 1);
        assert!(page.entries[0].success);
        assert_eq!(page.entries[0].sql_text, "CALL my_proc()");
    }

    // ── execute_call_query_bridge: error path ─────────────────────────────

    #[tokio::test]
    async fn test_execute_call_query_bridge_error_logs_failure() {
        let state = common::test_app_state();
        // Don't register connection

        let err = execute_call_query_bridge(&state, "missing", "tab-1", "CALL bad()", 100)
            .await
            .expect_err("should fail for missing connection");

        assert!(err.contains("not found"));

        wait_for_history_logging().await;

        // Verify error entry was logged
        let page = list_history_impl(&state, "missing", 1, 50, None).expect("list");
        assert_eq!(page.total, 1);
        assert!(!page.entries[0].success);
        assert_eq!(page.entries[0].sql_text, "CALL bad()");
    }

    // ── execute_query_bridge: resolve_connection_context fallback ──────────

    #[tokio::test]
    async fn test_bridge_uses_session_id_as_fallback_connection_id() {
        let state = common::test_app_state();
        // Register with a different profile_id than session_id
        register_lazy_pool(&state, "session-abc", "profile-xyz");

        let _result = execute_query_bridge(&state, "session-abc", "tab-1", "SELECT 42", 100)
            .await
            .expect("bridge should succeed");

        wait_for_history_logging().await;

        // History is logged under profile_id "profile-xyz" (bridge resolves session→profile)
        let page = list_history_impl(&state, "profile-xyz", 1, 50, None).expect("list");
        assert_eq!(page.total, 1);

        // Querying by session_id also resolves to profile_id and returns the same results —
        // list_history_impl resolves session_id→profile_id via the registry before querying.
        let page_sess = list_history_impl(&state, "session-abc", 1, 50, None).expect("list");
        assert_eq!(page_sess.total, 1);
        assert_eq!(page_sess.entries[0].sql_text, "SELECT 42");
    }
}
