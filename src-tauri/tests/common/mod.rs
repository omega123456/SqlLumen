//! Shared helpers for integration tests under `tests/`.
#![allow(dead_code)]
// Each integration test binary only uses a subset of helpers; unused items are expected.

pub mod blob_step_helpers;
pub mod fake_credentials;
pub mod log_capture;
pub mod mock_mysql_server;

use rusqlite::Connection;
use sqllumen_lib::commands::connections::SaveConnectionInput;
use sqllumen_lib::db::migrations;
use sqllumen_lib::mysql::registry::ConnectionRegistry;
use sqllumen_lib::mysql::result_cache::ResultCache;
use sqllumen_lib::mysql::table_data_cache::TableDataCache;
use sqllumen_lib::state::AppState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Creates a fresh in-memory SQLite database with all migrations applied.
pub fn test_db() -> Connection {
    let conn = Connection::open_in_memory().expect("should open in-memory database");
    migrations::run_migrations(&conn).expect("should run migrations");
    conn
}

/// Install the in-memory credential backend (idempotent). Use from suites that do not call [`test_app_state`].
pub fn ensure_fake_backend_once() {
    fake_credentials::ensure_fake_backend_once();
}

/// `AppState` backed by an in-memory migrated DB (for command `_impl` tests).
pub fn test_app_state() -> AppState {
    ensure_fake_backend_once();
    let conn = test_db();
    let (spill_dir, _) = unique_temp_dir("sqllumen-test-spill");
    let result_spill_dir = spill_dir.join("results");
    let table_data_spill_dir = spill_dir.join("table-data");
    AppState {
        db: Arc::new(Mutex::new(conn)),
        logs_db: Arc::new(Mutex::new(
            Connection::open_in_memory().expect("should open in-memory logs db"),
        )),
        registry: ConnectionRegistry::new(),
        app_handle: None,
        result_cache: Arc::new(ResultCache::new_for_test(1800, result_spill_dir)),
        table_data_cache: Arc::new(TableDataCache::new_for_test(1800, table_data_spill_dir)),
        metadata_cache: sqllumen_lib::mysql::metadata_cache::MetadataCache::new(),
        log_filter_reload: Mutex::new(None),
        running_queries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        dump_jobs: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        import_jobs: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        copy_jobs: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        ai_requests: Arc::new(Mutex::new(std::collections::HashMap::new())),
        index_build_tokens: Arc::new(Mutex::new(std::collections::HashMap::new())),
        session_profile_map: Arc::new(Mutex::new(std::collections::HashMap::new())),
        session_ref_counts: Arc::new(Mutex::new(std::collections::HashMap::new())),
        http_client: reqwest::Client::new(),
        embedding_cache: sqllumen_lib::schema_index::embeddings_cache::EmbeddingCache::new(),
    }
}

/// Unique directory under the system temp dir (for filesystem-backed DB tests).
pub fn unique_temp_dir(prefix: &str) -> (PathBuf, String) {
    let dir = std::env::temp_dir();
    let unique = format!(
        "{}_{}_{}",
        prefix,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    (dir.join(&unique), unique)
}

/// Sample `SaveConnectionInput` without a password (no keychain required).
pub fn sample_save_input() -> SaveConnectionInput {
    SaveConnectionInput {
        name: "Test DB".to_string(),
        host: "localhost".to_string(),
        port: 3306,
        username: "root".to_string(),
        password: None,
        default_database: Some("mydb".to_string()),
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        color: None,
        group_id: None,
        read_only: false,
        sort_order: 0,
        connect_timeout_secs: Some(10),
        keepalive_interval_secs: Some(60),
    }
}
