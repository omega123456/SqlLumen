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
    let mut conn = Connection::open_in_memory().expect("should open in-memory database");
    migrations::run_migrations(&mut conn).expect("should run migrations");
    // Non-cascade test helpers keep foreign keys OFF so existing tests can insert
    // child rows (chunks, history, favorites, schema-cache snapshots) without a
    // parent `connections` row. Migration 013 added ON DELETE CASCADE FKs; this
    // build enforces them, so disable enforcement explicitly here.
    conn.execute_batch("PRAGMA foreign_keys = OFF;")
        .expect("should disable foreign keys for non-cascade test db");
    conn
}

/// Creates a fresh in-memory SQLite database with all migrations applied and
/// foreign-key enforcement turned ON.
///
/// Cascade tests (migration 013 `ON DELETE CASCADE`) require enforcement so that
/// deleting a `connections` row removes its child rows. The default [`test_db`]
/// helper intentionally keeps foreign keys OFF; this helper mirrors the
/// production `initialize_database` behavior by enabling them explicitly after
/// migrations. Do not rely on a default — this build's bundled SQLite enforces
/// foreign keys by default, but the setting is made explicit here regardless.
pub fn test_db_fk_enabled() -> Connection {
    let mut conn = Connection::open_in_memory().expect("should open in-memory database");
    migrations::run_migrations(&mut conn).expect("should run migrations");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("should enable foreign keys for cascade test db");
    conn
}

/// Raw in-memory SQLite connection WITHOUT running migrations. Used by the
/// migration-runner integration suites that exercise `run_migrations` /
/// `run_log_migrations` directly (and the legacy-cutover path) on a blank DB.
pub fn test_conn() -> Connection {
    Connection::open_in_memory().expect("should open in-memory connection")
}

/// Number of rows in `refinery_schema_history` (migration-runner test helper).
pub fn history_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM refinery_schema_history", [], |row| {
        row.get(0)
    })
    .expect("should count refinery_schema_history rows")
}

/// Whether a table with the given name exists (migration-runner test helper).
/// Distinct from the production `migrations::table_exists` which returns a
/// `Result<bool>`.
pub fn table_exists(conn: &Connection, name: &str) -> bool {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [name],
            |row| row.get(0),
        )
        .expect("should query sqlite_master");
    count == 1
}

/// Build a legacy `_migrations` table seeded with the given `NNN_name` rows,
/// simulating an install last touched by the old custom runner.
pub fn seed_legacy_migrations(conn: &Connection, names: &[&str]) {
    conn.execute_batch(
        "CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);",
    )
    .expect("create legacy _migrations");
    for name in names {
        conn.execute(
            "INSERT INTO _migrations (name, applied_at) VALUES (?1, '0')",
            [name],
        )
        .expect("seed legacy row");
    }
}

/// Install the in-memory credential backend (idempotent). Use from suites that do not call [`test_app_state`].
pub fn ensure_fake_backend_once() {
    fake_credentials::ensure_fake_backend_once();
}

/// `AppState` backed by an in-memory migrated DB (for command `_impl` tests).
pub fn test_app_state() -> AppState {
    app_state_with_db(test_db())
}

/// `AppState` backed by an in-memory migrated DB with foreign-key enforcement
/// ON (for cascade-deletion `_impl` tests). Leaves the default FK-off helpers
/// unchanged.
pub fn test_app_state_fk_enabled() -> AppState {
    app_state_with_db(test_db_fk_enabled())
}

/// Build an [`AppState`] around the provided in-memory connection. Shared by the
/// FK-off and FK-enabled state builders so the two only differ in their DB.
fn app_state_with_db(conn: Connection) -> AppState {
    ensure_fake_backend_once();
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
