//! Integration tests for query cancellation via `cancel_query_impl`.
//!
//! Tests verify:
//! - No-op cancel returns `Ok(false)` when no running query exists
//! - Thread ID tracking in `running_queries` works correctly
//! - `KILL QUERY` is issued when a running query exists (non-coverage, mock MySQL)

use crate::common;
use sqllumen_lib::mysql::pool::SslSettings;

use sqllumen_lib::mysql::query_executor::cancel_query_impl;
use sqllumen_lib::state::AppState;

// ── No-op cancel (no running query) ──────────────────────────────────────────

#[tokio::test]
async fn cancel_query_returns_false_when_no_running_query() {
    let state = common::test_app_state();

    let result = cancel_query_impl(
        &state,
        &sqllumen_lib::commands::requests::ConnectionTabRequest {
            connection_id: "conn-1".to_string(),
            tab_id: "tab-1".to_string(),
        },
    )
    .await;
    assert_eq!(
        result,
        Ok(false),
        "should return Ok(false) for missing query"
    );
}

#[tokio::test]
async fn cancel_query_returns_false_for_wrong_connection_id() {
    let state = common::test_app_state();

    // Insert a thread ID for a different connection
    state
        .running_queries
        .write()
        .await
        .insert(("conn-other".to_string(), "tab-1".to_string()), 42u64);

    let result = cancel_query_impl(
        &state,
        &sqllumen_lib::commands::requests::ConnectionTabRequest {
            connection_id: "conn-1".to_string(),
            tab_id: "tab-1".to_string(),
        },
    )
    .await;
    assert_eq!(
        result,
        Ok(false),
        "should return Ok(false) for wrong connection"
    );
}

#[tokio::test]
async fn cancel_query_returns_false_for_wrong_tab_id() {
    let state = common::test_app_state();

    // Insert a thread ID for a different tab
    state
        .running_queries
        .write()
        .await
        .insert(("conn-1".to_string(), "tab-other".to_string()), 42u64);

    let result = cancel_query_impl(
        &state,
        &sqllumen_lib::commands::requests::ConnectionTabRequest {
            connection_id: "conn-1".to_string(),
            tab_id: "tab-1".to_string(),
        },
    )
    .await;
    assert_eq!(result, Ok(false), "should return Ok(false) for wrong tab");
}

// ── Running queries tracking ─────────────────────────────────────────────────

#[tokio::test]
async fn running_queries_insert_and_remove() {
    let state = common::test_app_state();
    let key = ("conn-1".to_string(), "tab-1".to_string());

    // Initially empty
    assert!(state.running_queries.read().await.is_empty());

    // Insert
    state
        .running_queries
        .write()
        .await
        .insert(key.clone(), 999u64);

    {
        let running = state.running_queries.read().await;
        assert_eq!(running.get(&key), Some(&999u64));
    }

    // Remove
    state.running_queries.write().await.remove(&key);
    assert!(state.running_queries.read().await.is_empty());
}

// ── Coverage-mode tests ──────────────────────────────────────────────────────

#[cfg(coverage)]
mod coverage_cancel {
    use super::*;
    use sqllumen_lib::mysql::query_executor::execute_query_impl;
    use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
    use tokio_util::sync::CancellationToken;

    fn dummy_lazy_pool() -> sqllumen_lib::mysql::pool::BackgroundPool {
        crate::common::mock_session::unreachable_pool()
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
            ssl: SslSettings::default(),
            connect_timeout_secs: 10,
            keepalive_interval_secs: 0,
            session_password: None,
        }
    }

    fn register_lazy_pool(state: &AppState, connection_id: &str) {
        let entry = RegistryEntry {
            pool: dummy_lazy_pool(),
            session_id: connection_id.to_string(),
            profile_id: connection_id.to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: dummy_stored_params(connection_id),
            read_only: false,
        };
        state.registry.insert(connection_id.to_string(), entry);
    }

    #[tokio::test]
    async fn execute_query_coverage_stub_tracks_running_queries() {
        let state = common::test_app_state();
        register_lazy_pool(&state, "conn-cov");

        // Before execution, running_queries should be empty
        assert!(state.running_queries.read().await.is_empty());

        // Execute — the coverage stub inserts and removes dummy thread ID 42
        let result = execute_query_impl(
            &state,
            &sqllumen_lib::mysql::query_executor::ExecuteQueryRequest {
                connection_id: "conn-cov".to_string(),
                tab_id: "tab-1".to_string(),
                sql: "SELECT 1".to_string(),
                row_limit: Some(100),
                view_spec: None,
            },
        )
        .await
        .expect("coverage stub should succeed");

        assert!(!result.query_id.is_empty());

        // After execution, running_queries should be empty (cleanup happened)
        assert!(state.running_queries.read().await.is_empty());
    }

    #[tokio::test]
    async fn cancel_query_no_op_coverage() {
        let state = common::test_app_state();

        // No running query → Ok(false)
        let result = cancel_query_impl(
            &state,
            &sqllumen_lib::commands::requests::ConnectionTabRequest {
                connection_id: "conn-1".to_string(),
                tab_id: "tab-1".to_string(),
            },
        )
        .await;
        assert_eq!(result, Ok(false));
    }

    #[tokio::test]
    async fn cancel_query_found_thread_id_with_connection() {
        let state = common::test_app_state();
        register_lazy_pool(&state, "conn-cancel");

        // Insert a running query thread ID
        state
            .running_queries
            .write()
            .await
            .insert(("conn-cancel".to_string(), "tab-1".to_string()), 999u64);

        // Coverage stub: thread ID found + connection exists → Ok(true)
        let result = cancel_query_impl(
            &state,
            &sqllumen_lib::commands::requests::ConnectionTabRequest {
                connection_id: "conn-cancel".to_string(),
                tab_id: "tab-1".to_string(),
            },
        )
        .await;
        assert_eq!(
            result,
            Ok(true),
            "should return Ok(true) when thread ID found and connection exists"
        );
    }

    #[tokio::test]
    async fn cancel_query_found_thread_id_no_connection() {
        let state = common::test_app_state();

        // Insert a running query thread ID but do NOT register a pool
        state
            .running_queries
            .write()
            .await
            .insert(("no-conn".to_string(), "tab-1".to_string()), 123u64);

        // Coverage stub: thread ID found but connection not in registry → Err
        let result = cancel_query_impl(
            &state,
            &sqllumen_lib::commands::requests::ConnectionTabRequest {
                connection_id: "no-conn".to_string(),
                tab_id: "tab-1".to_string(),
            },
        )
        .await;
        assert!(result.is_err(), "should error when connection not found");
        assert!(
            result.unwrap_err().contains("not found"),
            "error should mention connection not found"
        );
    }
}

// ── Non-coverage: KILL QUERY via mock MySQL server ───────────────────────────

#[cfg(not(coverage))]
mod mock_cancel {
    use super::*;
    use crate::common::mock_mysql_server::MockMySqlServer;
    use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
    use tokio_util::sync::CancellationToken;

    fn dummy_stored_params(profile_id: &str) -> StoredConnectionParams {
        StoredConnectionParams {
            profile_id: profile_id.to_string(),
            host: "127.0.0.1".to_string(),
            port: 13306,
            username: "dummy".to_string(),
            has_password: false,
            keychain_ref: None,
            default_database: None,
            ssl: SslSettings::default(),
            connect_timeout_secs: 10,
            keepalive_interval_secs: 0,
            session_password: None,
        }
    }

    fn register_pool(
        state: &AppState,
        connection_id: &str,
        pool: sqllumen_lib::mysql::pool::BackgroundPool,
    ) {
        let entry = RegistryEntry {
            pool,
            session_id: connection_id.to_string(),
            profile_id: connection_id.to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: dummy_stored_params(connection_id),
            read_only: false,
        };
        state.registry.insert(connection_id.to_string(), entry);
    }

    async fn start_mock_accepting_kill(
    ) -> (MockMySqlServer, sqllumen_lib::mysql::pool::BackgroundPool) {
        let server = MockMySqlServer::start_script(vec![]).await;

        let pool = crate::common::mock_session::mock_pool(server.port);

        (server, pool)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_query_issues_kill_when_thread_id_found() {
        let (server, pool) = start_mock_accepting_kill().await;
        let state = common::test_app_state();

        // Register the mock pool in the state registry so cancel_query_impl can find it
        register_pool(&state, "conn-1", pool);

        // Simulate a running query by inserting a thread ID
        state
            .running_queries
            .write()
            .await
            .insert(("conn-1".to_string(), "tab-1".to_string()), 12345u64);

        // cancel_query_impl should find the thread ID and issue KILL QUERY 12345
        // The mock server returns OK for unmatched queries (like KILL QUERY 12345)
        let result = cancel_query_impl(
            &state,
            &sqllumen_lib::commands::requests::ConnectionTabRequest {
                connection_id: "conn-1".to_string(),
                tab_id: "tab-1".to_string(),
            },
        )
        .await;
        assert_eq!(
            result,
            Ok(true),
            "should return Ok(true) after issuing KILL QUERY"
        );
        assert_eq!(server.killed_thread_ids(), vec![12345]);
        let kill_was_text_query = server
            .text_queries()
            .contains(&"KILL QUERY 12345".to_string());
        assert!(
            kill_was_text_query,
            "KILL QUERY should arrive as a text query"
        );
    }
}
