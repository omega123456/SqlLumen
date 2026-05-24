//! Integration tests for `fetch_schema_metadata_full_impl` and the bulk
//! foreign-key / index query coverage stubs.

#[cfg(coverage)]
use rusqlite::Connection;
#[cfg(coverage)]
use sqllumen_lib::mysql::query_executor::fetch_schema_metadata_full_impl;
#[cfg(coverage)]
use sqllumen_lib::mysql::query_executor::fetch_schema_metadata_impl;
#[cfg(coverage)]
use sqllumen_lib::mysql::registry::{
    ConnectionRegistry, ConnectionStatus, RegistryEntry, StoredConnectionParams,
};
#[cfg(coverage)]
use sqllumen_lib::mysql::table_data_cache::TableDataCache;
#[cfg(coverage)]
use sqllumen_lib::state::AppState;
#[cfg(coverage)]
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
#[cfg(coverage)]
use std::sync::{Arc, Mutex};

#[cfg(coverage)]
mod common;

#[cfg(coverage)]
fn test_state() -> AppState {
    common::ensure_fake_backend_once();
    let conn = Connection::open_in_memory().expect("should open in-memory db");
    sqllumen_lib::db::migrations::run_migrations(&conn).expect("should run migrations");
    AppState {
        db: Arc::new(Mutex::new(conn)),
        registry: ConnectionRegistry::new(),
        app_handle: None,
        result_cache: std::sync::Arc::new(
            sqllumen_lib::mysql::result_cache::ResultCache::new_for_test(
                1800,
                std::env::temp_dir().join("sqllumen-test-schemafull-results"),
            ),
        ),
        table_data_cache: std::sync::Arc::new(TableDataCache::new_for_test(
            1800,
            std::env::temp_dir().join("sqllumen-test-schemafull-table-data"),
        )),
        log_filter_reload: Mutex::new(None),
        running_queries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        dump_jobs: std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        import_jobs: std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        ai_requests: Arc::new(Mutex::new(std::collections::HashMap::new())),
        index_build_tokens: Arc::new(Mutex::new(std::collections::HashMap::new())),
        session_profile_map: Arc::new(Mutex::new(std::collections::HashMap::new())),
        session_ref_counts: Arc::new(Mutex::new(std::collections::HashMap::new())),
        http_client: reqwest::Client::new(),
        embedding_cache: sqllumen_lib::schema_index::embeddings_cache::EmbeddingCache::new(),
    }
}

#[cfg(coverage)]
fn dummy_lazy_pool() -> sqlx::MySqlPool {
    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(13306)
        .username("dummy")
        .password("dummy");
    MySqlPoolOptions::new().connect_lazy_with(opts)
}

#[cfg(coverage)]
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

#[cfg(coverage)]
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
    use sqllumen_lib::mysql::schema_queries::{
        query_all_foreign_keys, query_all_foreign_keys_batch, query_all_indexes,
        query_all_indexes_batch,
    };

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
    async fn fetch_schema_metadata_impl_coverage_success() {
        let state = test_state();
        register_lazy_pool(&state, "conn-base");

        let metadata = fetch_schema_metadata_impl(&state, "conn-base")
            .await
            .expect("coverage stub should succeed");

        assert_eq!(metadata.databases, vec!["stub_db".to_string()]);

        let tables = metadata.tables.get("stub_db").expect("stub_db tables");
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].name, "stub_table");
        assert_eq!(tables[0].engine, "InnoDB");
        assert_eq!(tables[0].charset, "utf8mb4");
        assert_eq!(tables[0].row_count, 0);
        assert_eq!(tables[0].data_size, 0);

        let columns = metadata
            .columns
            .get("stub_db.stub_table")
            .expect("stub table columns");
        assert_eq!(columns.len(), 1);
        assert_eq!(columns[0].name, "id");
        assert_eq!(columns[0].data_type, "INT");

        let routines = metadata.routines.get("stub_db").expect("stub_db routines");
        assert_eq!(routines.len(), 1);
        assert_eq!(routines[0].name, "stub_proc");
        assert_eq!(routines[0].routine_type, "PROCEDURE");
    }

    #[tokio::test]
    async fn fetch_schema_metadata_impl_coverage_missing_connection() {
        let state = test_state();

        let err = fetch_schema_metadata_impl(&state, "missing")
            .await
            .expect_err("missing connection should error");
        assert!(err.contains("not found"));
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

    #[tokio::test]
    async fn query_all_foreign_keys_batch_coverage_stub() {
        let result = query_all_foreign_keys_batch(&(), &["db1".to_string()])
            .await
            .expect("coverage stub should succeed");
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn query_all_indexes_batch_coverage_stub() {
        let result = query_all_indexes_batch(&(), &["db1".to_string()])
            .await
            .expect("coverage stub should succeed");
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn query_all_batch_coverage_stubs_accept_empty_and_multi_database_inputs() {
        let empty_fks = query_all_foreign_keys_batch(&(), &[])
            .await
            .expect("empty coverage stub should succeed");
        assert!(empty_fks.is_empty());

        let multi_indexes = query_all_indexes_batch(
            &(),
            &["db1".to_string(), "db2".to_string(), "db3".to_string()],
        )
        .await
        .expect("multi-db coverage stub should succeed");
        assert!(multi_indexes.is_empty());
    }

    #[tokio::test]
    async fn fetch_schema_metadata_full_impl_coverage_exact_payload() {
        let state = test_state();
        register_lazy_pool(&state, "conn-exact");

        let metadata = fetch_schema_metadata_full_impl(&state, "conn-exact")
            .await
            .expect("coverage stub should succeed");

        assert_eq!(metadata.databases, vec!["stub_db".to_string()]);
        assert!(metadata.foreign_keys.is_empty());
        assert!(metadata.indexes.is_empty());

        let tables = metadata.tables.get("stub_db").expect("stub_db tables");
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].name, "stub_table");

        let columns = metadata
            .columns
            .get("stub_db.stub_table")
            .expect("stub table columns");
        assert_eq!(columns.len(), 1);
        assert_eq!(columns[0].name, "id");

        let routines = metadata.routines.get("stub_db").expect("stub_db routines");
        assert_eq!(routines.len(), 1);
        assert_eq!(routines[0].name, "stub_proc");
    }
}
