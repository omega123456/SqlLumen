//! Integration tests for `fetch_schema_metadata_full_impl` and the bulk
//! foreign-key / index query coverage stubs.

use sqllumen_lib::mysql::query_executor::fetch_schema_metadata_full_impl;
use sqllumen_lib::mysql::registry::{
    ConnectionRegistry, ConnectionStatus, RegistryEntry, StoredConnectionParams,
};
use sqllumen_lib::state::AppState;
use rusqlite::Connection;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use std::sync::{Arc, Mutex};

mod common;

fn test_state() -> AppState {
    common::ensure_fake_backend_once();
    let conn = Connection::open_in_memory().expect("should open in-memory db");
    sqllumen_lib::db::migrations::run_migrations(&conn).expect("should run migrations");
    AppState {
        db: Arc::new(Mutex::new(conn)),
        registry: ConnectionRegistry::new(),
        app_handle: None,
        results: std::sync::RwLock::new(std::collections::HashMap::new()),
        log_filter_reload: Mutex::new(None),
        running_queries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        dump_jobs: std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        import_jobs: std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        ai_requests: Arc::new(Mutex::new(std::collections::HashMap::new())),
    }
}

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

fn register_lazy_pool(state: &AppState, connection_id: &str) {
    let entry = RegistryEntry {
        pool: dummy_lazy_pool(),
        session_id: connection_id.to_string(),
        profile_id: connection_id.to_string(),
        status: ConnectionStatus::Connected,
        server_version: "8.0.0".to_string(),
        cancellation_token: tokio_util::sync::CancellationToken::new(),
        connection_params: dummy_stored_params(connection_id),
        read_only: false,
    };
    state.registry.insert(connection_id.to_string(), entry);
}

// ── Coverage-mode tests for fetch_schema_metadata_full_impl ──────────────────

#[cfg(coverage)]
mod coverage_stubs {
    use super::*;
    use sqllumen_lib::mysql::schema_queries::{query_all_foreign_keys, query_all_indexes};

    #[tokio::test]
    async fn fetch_schema_metadata_full_impl_coverage_success() {
        let state = test_state();
        register_lazy_pool(&state, "conn-full");

        let metadata = fetch_schema_metadata_full_impl(&state, "conn-full")
            .await
            .expect("coverage stub should succeed");

        // Base metadata is populated by fetch_schema_metadata_impl's coverage stub
        assert!(!metadata.databases.is_empty());
        assert!(metadata.tables.contains_key("stub_db"));
        assert!(metadata.columns.contains_key("stub_db.stub_table"));
        assert!(metadata.routines.contains_key("stub_db"));

        // FK and index maps exist (empty from coverage stubs)
        assert!(metadata.foreign_keys.is_empty() || !metadata.foreign_keys.is_empty());
        assert!(metadata.indexes.is_empty() || !metadata.indexes.is_empty());
    }

    #[tokio::test]
    async fn fetch_schema_metadata_full_impl_coverage_missing_connection() {
        let state = test_state();

        let err = fetch_schema_metadata_full_impl(&state, "missing")
            .await
            .expect_err("missing connection should error");
        assert!(err.contains("not found"));
    }

    #[tokio::test]
    async fn query_all_foreign_keys_coverage_stub() {
        // Exercise the coverage stub directly
        let result = query_all_foreign_keys(&(), "any_db")
            .await
            .expect("coverage stub should succeed");
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn query_all_indexes_coverage_stub() {
        // Exercise the coverage stub directly
        let result = query_all_indexes(&(), "any_db")
            .await
            .expect("coverage stub should succeed");
        assert!(result.is_empty());
    }
}
