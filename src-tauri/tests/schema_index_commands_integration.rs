//! Integration tests for schema index command `_impl` functions.

mod common;

#[cfg(coverage)]
use sqllumen_lib::commands::schema_index::{
    build_schema_index_impl, force_rebuild_schema_index_impl, invalidate_schema_index_impl,
};
use sqllumen_lib::commands::schema_index::{
    get_index_status_impl, list_indexed_tables_impl, semantic_search_impl, IndexErrorPayload,
    IndexStatusResponse, IndexedTableInfo,
};
use sqllumen_lib::db::settings;
use sqllumen_lib::init_sqlite_vec;
use sqllumen_lib::schema_index::storage;
use sqllumen_lib::schema_index::types::{IndexMeta, IndexStatus};
use sqllumen_lib::state::AppState;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

fn test_state() -> AppState {
    common::ensure_fake_backend_once();
    let conn = common::test_db();
    AppState {
        db: Arc::new(Mutex::new(conn)),
        registry: sqllumen_lib::mysql::registry::ConnectionRegistry::new(),
        app_handle: None,
        results: std::sync::RwLock::new(HashMap::new()),
        log_filter_reload: Mutex::new(None),
        running_queries: tokio::sync::RwLock::new(HashMap::new()),
        dump_jobs: Arc::new(std::sync::RwLock::new(HashMap::new())),
        import_jobs: Arc::new(std::sync::RwLock::new(HashMap::new())),
        ai_requests: Arc::new(Mutex::new(HashMap::new())),
        index_build_tokens: Arc::new(Mutex::new(HashMap::new())),
        session_profile_map: Arc::new(Mutex::new(HashMap::new())),
        session_ref_counts: Arc::new(Mutex::new(HashMap::new())),
        http_client: reqwest::Client::new(),
    }
}

/// Like `test_state()` but with sqlite-vec loaded (needed for vec table operations).
fn test_state_with_vec() -> AppState {
    init_sqlite_vec();
    common::ensure_fake_backend_once();
    let conn = common::test_db();
    AppState {
        db: Arc::new(Mutex::new(conn)),
        registry: sqllumen_lib::mysql::registry::ConnectionRegistry::new(),
        app_handle: None,
        results: std::sync::RwLock::new(HashMap::new()),
        log_filter_reload: Mutex::new(None),
        running_queries: tokio::sync::RwLock::new(HashMap::new()),
        dump_jobs: Arc::new(std::sync::RwLock::new(HashMap::new())),
        import_jobs: Arc::new(std::sync::RwLock::new(HashMap::new())),
        ai_requests: Arc::new(Mutex::new(HashMap::new())),
        index_build_tokens: Arc::new(Mutex::new(HashMap::new())),
        session_profile_map: Arc::new(Mutex::new(HashMap::new())),
        session_ref_counts: Arc::new(Mutex::new(HashMap::new())),
        http_client: reqwest::Client::new(),
    }
}

// ── get_index_status_impl ───────────────────────────────────────────────────

#[test]
fn get_index_status_not_configured_when_no_embedding_model() {
    let state = test_state();

    // Register a fake session in the session_profile_map
    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert("sess-1".to_string(), "profile-1".to_string());
    }

    let result = get_index_status_impl(&state, "sess-1".to_string());
    assert!(result.is_ok());
    let status = result.unwrap();
    assert_eq!(status.status, "not_configured");
}

#[test]
fn get_index_status_not_configured_when_session_not_found() {
    let state = test_state();

    // No session registered anywhere
    let result = get_index_status_impl(&state, "unknown-session".to_string());
    assert!(result.is_ok());
    let status = result.unwrap();
    assert_eq!(status.status, "not_configured");
}

#[test]
fn get_index_status_stale_when_no_meta_exists() {
    let state = test_state();

    // Set embedding model setting
    {
        let conn = state.db.lock().unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "nomic-embed-text").unwrap();
        settings::set_setting(&conn, "ai.endpoint", "http://localhost:11434").unwrap();
    }

    // Register session → profile mapping
    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert("sess-1".to_string(), "profile-1".to_string());
    }

    let result = get_index_status_impl(&state, "sess-1".to_string());
    assert!(result.is_ok());
    let status = result.unwrap();
    assert_eq!(status.status, "stale");
}

#[test]
fn get_index_status_stale_when_model_changed() {
    let state = test_state();

    // Set current embedding model
    {
        let conn = state.db.lock().unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "new-model").unwrap();
        settings::set_setting(&conn, "ai.endpoint", "http://localhost:11434").unwrap();
    }

    // Insert meta with a different model
    {
        let conn = state.db.lock().unwrap();
        let meta = IndexMeta {
            connection_id: "profile-1".to_string(),
            model_id: "old-model".to_string(),
            embedding_dimension: 384,
            last_build_at: Some("2024-01-01T00:00:00Z".to_string()),
            status: IndexStatus::Ready,
            vec_schema_version: Some(1),
        };
        storage::upsert_index_meta(&conn, &meta).unwrap();
    }

    // Register session → profile mapping
    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert("sess-1".to_string(), "profile-1".to_string());
    }

    let result = get_index_status_impl(&state, "sess-1".to_string());
    assert!(result.is_ok());
    let status = result.unwrap();
    assert_eq!(status.status, "stale");
}

#[test]
fn get_index_status_ready_when_model_matches() {
    let state = test_state();

    // Set current embedding model
    {
        let conn = state.db.lock().unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "nomic-embed-text").unwrap();
        settings::set_setting(&conn, "ai.endpoint", "http://localhost:11434").unwrap();
    }

    // Insert meta with the same model, status = ready
    {
        let conn = state.db.lock().unwrap();
        let meta = IndexMeta {
            connection_id: "profile-1".to_string(),
            model_id: "nomic-embed-text".to_string(),
            embedding_dimension: 384,
            last_build_at: Some("2024-01-01T00:00:00Z".to_string()),
            status: IndexStatus::Ready,
            vec_schema_version: Some(1),
        };
        storage::upsert_index_meta(&conn, &meta).unwrap();
    }

    // Register session → profile mapping
    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert("sess-1".to_string(), "profile-1".to_string());
    }

    let result = get_index_status_impl(&state, "sess-1".to_string());
    assert!(result.is_ok());
    let status = result.unwrap();
    assert_eq!(status.status, "ready");
}

#[test]
fn get_index_status_building_when_token_present() {
    let state = test_state();

    // Set current embedding model
    {
        let conn = state.db.lock().unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "nomic-embed-text").unwrap();
        settings::set_setting(&conn, "ai.endpoint", "http://localhost:11434").unwrap();
    }

    // Register session → profile mapping
    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert("sess-1".to_string(), "profile-1".to_string());
    }

    // Insert a build token for this profile
    {
        let mut tokens = state.index_build_tokens.lock().unwrap();
        tokens.insert("profile-1".to_string(), CancellationToken::new());
    }

    let result = get_index_status_impl(&state, "sess-1".to_string());
    assert!(result.is_ok());
    let status = result.unwrap();
    assert_eq!(status.status, "building");
}

#[test]
fn get_index_status_error_when_meta_status_is_error() {
    let state = test_state();

    // Set current embedding model
    {
        let conn = state.db.lock().unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "nomic-embed-text").unwrap();
        settings::set_setting(&conn, "ai.endpoint", "http://localhost:11434").unwrap();
    }

    // Insert meta with error status
    {
        let conn = state.db.lock().unwrap();
        let meta = IndexMeta {
            connection_id: "profile-1".to_string(),
            model_id: "nomic-embed-text".to_string(),
            embedding_dimension: 384,
            last_build_at: None,
            status: IndexStatus::Error,
            vec_schema_version: Some(1),
        };
        storage::upsert_index_meta(&conn, &meta).unwrap();
    }

    // Register session → profile mapping
    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert("sess-1".to_string(), "profile-1".to_string());
    }

    let result = get_index_status_impl(&state, "sess-1".to_string());
    assert!(result.is_ok());
    let status = result.unwrap();
    assert_eq!(status.status, "error");
}

// ── get_index_status via registry fallback ──────────────────────────────────

#[tokio::test]
async fn get_index_status_resolves_profile_from_registry() {
    let state = test_state();

    // Set current embedding model
    {
        let conn = state.db.lock().unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "nomic-embed-text").unwrap();
        settings::set_setting(&conn, "ai.endpoint", "http://localhost:11434").unwrap();
    }

    // Don't register in session_profile_map — but register a connection in the registry
    // with a matching session_id → profile_id
    use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(13306)
        .username("dummy")
        .password("dummy");
    let pool = MySqlPoolOptions::new().connect_lazy_with(opts);

    state.registry.insert(
        "sess-from-registry".to_string(),
        RegistryEntry {
            pool,
            session_id: "sess-from-registry".to_string(),
            profile_id: "profile-registry".to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: StoredConnectionParams {
                profile_id: "profile-registry".to_string(),
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
                keepalive_interval_secs: 60,
            },
            read_only: false,
        },
    );

    // No meta for this profile → should be stale
    let result = get_index_status_impl(&state, "sess-from-registry".to_string());
    assert!(result.is_ok());
    let status = result.unwrap();
    assert_eq!(status.status, "stale");
}

// ── list_indexed_tables_impl ────────────────────────────────────────────────

#[tokio::test]
async fn list_indexed_tables_empty_for_unknown_profile() {
    let state = test_state();

    // Register a session → profile mapping
    use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(13306)
        .username("dummy")
        .password("dummy");
    let pool = MySqlPoolOptions::new().connect_lazy_with(opts);

    state.registry.insert(
        "sess-empty".to_string(),
        RegistryEntry {
            pool,
            session_id: "sess-empty".to_string(),
            profile_id: "profile-empty".to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: StoredConnectionParams {
                profile_id: "profile-empty".to_string(),
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
                keepalive_interval_secs: 60,
            },
            read_only: false,
        },
    );

    let result = list_indexed_tables_impl(&state, "sess-empty".to_string());
    assert!(result.is_ok());
    let tables = result.unwrap();
    assert!(tables.is_empty());
}

#[tokio::test]
async fn list_indexed_tables_returns_chunks() {
    let state = test_state_with_vec();

    // Register a session in registry
    use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
    use sqllumen_lib::schema_index::types::{ChunkInsert, ChunkType};
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(13306)
        .username("dummy")
        .password("dummy");
    let pool = MySqlPoolOptions::new().connect_lazy_with(opts);

    state.registry.insert(
        "sess-chunks".to_string(),
        RegistryEntry {
            pool,
            session_id: "sess-chunks".to_string(),
            profile_id: "profile-chunks".to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: StoredConnectionParams {
                profile_id: "profile-chunks".to_string(),
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
                keepalive_interval_secs: 60,
            },
            read_only: false,
        },
    );

    // Create vec table and insert a chunk
    {
        let conn = state.db.lock().unwrap();
        storage::create_vec_table(&conn, "profile-chunks", 4).unwrap();

        let chunk = ChunkInsert {
            connection_id: "profile-chunks".to_string(),
            chunk_key: "table:mydb.users".to_string(),
            db_name: "mydb".to_string(),
            table_name: "users".to_string(),
            chunk_type: ChunkType::Table,
            ddl_text: "CREATE TABLE users (id INT)".to_string(),
            ddl_hash: "abc123".to_string(),
            model_id: "nomic-embed-text".to_string(),
            ref_db_name: None,
            ref_table_name: None,
            embedding: vec![0.1, 0.2, 0.3, 0.4],
        };
        storage::insert_chunk(&conn, &chunk).unwrap();
    }

    let result = list_indexed_tables_impl(&state, "sess-chunks".to_string());
    assert!(result.is_ok());
    let tables = result.unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].db_name, "mydb");
    assert_eq!(tables[0].table_name, "users");
    assert_eq!(tables[0].chunk_type, "table");
    assert_eq!(tables[0].model_id, "nomic-embed-text");
}

#[test]
fn list_indexed_tables_session_not_in_registry() {
    let state = test_state();

    let result = list_indexed_tables_impl(&state, "unknown-session".to_string());
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found in registry"));
}

// ── Session ref count and build tracking ────────────────────────────────────

#[test]
fn session_profile_map_and_ref_counts_work() {
    let state = test_state();

    // Simulate adding sessions
    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert("sess-a".to_string(), "profile-x".to_string());
        map.insert("sess-b".to_string(), "profile-x".to_string());
    }
    {
        let mut counts = state.session_ref_counts.lock().unwrap();
        *counts.entry("profile-x".to_string()).or_insert(0) += 1;
        *counts.entry("profile-x".to_string()).or_insert(0) += 1;
    }

    // Check ref count
    {
        let counts = state.session_ref_counts.lock().unwrap();
        assert_eq!(*counts.get("profile-x").unwrap(), 2);
    }

    // Simulate removing one session
    {
        let mut counts = state.session_ref_counts.lock().unwrap();
        if let Some(count) = counts.get_mut("profile-x") {
            *count = count.saturating_sub(1);
        }
    }
    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.remove("sess-a");
    }

    // Check ref count is 1
    {
        let counts = state.session_ref_counts.lock().unwrap();
        assert_eq!(*counts.get("profile-x").unwrap(), 1);
    }

    // Check sess-b still mapped
    {
        let map = state.session_profile_map.lock().unwrap();
        assert!(map.contains_key("sess-b"));
        assert!(!map.contains_key("sess-a"));
    }
}

#[test]
fn build_token_cancellation_on_cleanup() {
    let state = test_state();

    let token = CancellationToken::new();
    let token_clone = token.clone();

    // Insert build token
    {
        let mut tokens = state.index_build_tokens.lock().unwrap();
        tokens.insert("profile-y".to_string(), token);
    }

    assert!(!token_clone.is_cancelled());

    // Cancel and remove
    {
        let mut tokens = state.index_build_tokens.lock().unwrap();
        if let Some(t) = tokens.remove("profile-y") {
            t.cancel();
        }
    }

    assert!(token_clone.is_cancelled());
}

// ── close_connection cleanup integration ────────────────────────────────────

#[tokio::test]
async fn close_connection_decrements_ref_count() {
    let state = test_state();

    use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(13306)
        .username("dummy")
        .password("dummy");
    let pool = MySqlPoolOptions::new().connect_lazy_with(opts);

    state.registry.insert(
        "sess-close".to_string(),
        RegistryEntry {
            pool,
            session_id: "sess-close".to_string(),
            profile_id: "profile-close".to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: StoredConnectionParams {
                profile_id: "profile-close".to_string(),
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
                keepalive_interval_secs: 60,
            },
            read_only: false,
        },
    );

    // Set up session tracking
    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert("sess-close".to_string(), "profile-close".to_string());
    }
    {
        let mut counts = state.session_ref_counts.lock().unwrap();
        counts.insert("profile-close".to_string(), 1);
    }

    // Insert a build token that should be cancelled on last ref close
    let token = CancellationToken::new();
    let token_clone = token.clone();
    {
        let mut tokens = state.index_build_tokens.lock().unwrap();
        tokens.insert("profile-close".to_string(), token);
    }

    // Close the connection
    let result = sqllumen_lib::commands::mysql::close_connection_impl(&state, "sess-close").await;
    assert!(result.is_ok());

    // The build token should have been cancelled (last ref = 0)
    assert!(token_clone.is_cancelled());

    // Session tracking should be cleaned up
    {
        let map = state.session_profile_map.lock().unwrap();
        assert!(!map.contains_key("sess-close"));
    }
    {
        let counts = state.session_ref_counts.lock().unwrap();
        assert!(!counts.contains_key("profile-close"));
    }
    {
        let tokens = state.index_build_tokens.lock().unwrap();
        assert!(!tokens.contains_key("profile-close"));
    }
}

#[tokio::test]
async fn close_connection_does_not_cancel_when_other_sessions_exist() {
    let state = test_state();

    use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

    let make_pool = || {
        let opts = MySqlConnectOptions::new()
            .host("127.0.0.1")
            .port(13306)
            .username("dummy")
            .password("dummy");
        MySqlPoolOptions::new().connect_lazy_with(opts)
    };

    let make_params = || StoredConnectionParams {
        profile_id: "profile-multi".to_string(),
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
        keepalive_interval_secs: 60,
    };

    // Register two sessions for the same profile
    state.registry.insert(
        "sess-a".to_string(),
        RegistryEntry {
            pool: make_pool(),
            session_id: "sess-a".to_string(),
            profile_id: "profile-multi".to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: make_params(),
            read_only: false,
        },
    );
    state.registry.insert(
        "sess-b".to_string(),
        RegistryEntry {
            pool: make_pool(),
            session_id: "sess-b".to_string(),
            profile_id: "profile-multi".to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: make_params(),
            read_only: false,
        },
    );

    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert("sess-a".to_string(), "profile-multi".to_string());
        map.insert("sess-b".to_string(), "profile-multi".to_string());
    }
    {
        let mut counts = state.session_ref_counts.lock().unwrap();
        counts.insert("profile-multi".to_string(), 2);
    }

    let token = CancellationToken::new();
    let token_clone = token.clone();
    {
        let mut tokens = state.index_build_tokens.lock().unwrap();
        tokens.insert("profile-multi".to_string(), token);
    }

    // Close only one session
    let result = sqllumen_lib::commands::mysql::close_connection_impl(&state, "sess-a").await;
    assert!(result.is_ok());

    // Token should NOT be cancelled (ref count is still 1)
    assert!(!token_clone.is_cancelled());

    // Ref count should be 1
    {
        let counts = state.session_ref_counts.lock().unwrap();
        assert_eq!(*counts.get("profile-multi").unwrap(), 1);
    }

    // sess-a mapping should be gone, sess-b should remain
    {
        let map = state.session_profile_map.lock().unwrap();
        assert!(!map.contains_key("sess-a"));
        assert!(map.contains_key("sess-b"));
    }
}

// ── semantic_search_impl ────────────────────────────────────────────────────

/// Helper to register a lazy pool in the registry for a given session/profile.
fn register_dummy_session(state: &AppState, session_id: &str, profile_id: &str) {
    use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(13306)
        .username("dummy")
        .password("dummy");
    let pool = MySqlPoolOptions::new().connect_lazy_with(opts);

    state.registry.insert(
        session_id.to_string(),
        RegistryEntry {
            pool,
            session_id: session_id.to_string(),
            profile_id: profile_id.to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: StoredConnectionParams {
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
                keepalive_interval_secs: 60,
            },
            read_only: false,
        },
    );
}

#[tokio::test]
async fn semantic_search_no_model_configured() {
    let state = test_state();

    // Register session in registry so resolve_profile_id succeeds
    register_dummy_session(&state, "sess-search", "profile-search");

    let result = semantic_search_impl(
        &state,
        "sess-search".to_string(),
        vec!["find users".to_string()],
    )
    .await;

    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .contains("No embedding model configured"));
}

#[tokio::test]
async fn semantic_search_empty_queries_returns_empty() {
    let state = test_state();

    // Set embedding model
    {
        let conn = state.db.lock().unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "nomic-embed-text").unwrap();
    }

    // Register session in registry
    register_dummy_session(&state, "sess-search2", "profile-search2");

    let result = semantic_search_impl(&state, "sess-search2".to_string(), vec![]).await;

    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
}

#[tokio::test]
async fn semantic_search_session_not_found() {
    let state = test_state();

    let result = semantic_search_impl(
        &state,
        "nonexistent-session".to_string(),
        vec!["find users".to_string()],
    )
    .await;

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[tokio::test]
async fn semantic_search_with_queries_hits_coverage_stub() {
    let state = test_state();

    // Set embedding model
    {
        let conn = state.db.lock().unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "nomic-embed-text").unwrap();
    }

    // Register session in registry
    register_dummy_session(&state, "sess-search3", "profile-search3");

    let result = semantic_search_impl(
        &state,
        "sess-search3".to_string(),
        vec!["find all users".to_string()],
    )
    .await;

    // In coverage mode, returns a stub error; in normal mode, embedding fails
    // because there's no real endpoint — either way it's an error.
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("stub")
            || err.contains("Embedding")
            || err.contains("search")
            || err.contains("failed"),
        "Expected an error about stub, embedding, or search, got: {err}"
    );
}

// ── Serde round-trip tests for response types ───────────────────────────────

#[test]
fn index_status_response_serde_round_trip() {
    let response = IndexStatusResponse {
        status: "ready".to_string(),
        tables_done: Some(10),
        tables_total: Some(20),
        error: None,
    };

    let json = serde_json::to_string(&response).unwrap();
    let deserialized: IndexStatusResponse = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.status, "ready");
    assert_eq!(deserialized.tables_done, Some(10));
    assert_eq!(deserialized.tables_total, Some(20));
    assert!(deserialized.error.is_none());
}

#[test]
fn index_status_response_serde_with_error() {
    let response = IndexStatusResponse {
        status: "error".to_string(),
        tables_done: None,
        tables_total: None,
        error: Some("Build failed".to_string()),
    };

    let json = serde_json::to_string(&response).unwrap();
    let deserialized: IndexStatusResponse = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.status, "error");
    assert_eq!(deserialized.error, Some("Build failed".to_string()));
}

#[test]
fn index_status_response_debug_and_clone() {
    let response = IndexStatusResponse {
        status: "building".to_string(),
        tables_done: Some(5),
        tables_total: Some(15),
        error: None,
    };

    let cloned = response.clone();
    assert_eq!(cloned.status, response.status);
    assert_eq!(cloned.tables_done, response.tables_done);

    // Debug trait
    let debug_str = format!("{:?}", response);
    assert!(debug_str.contains("building"));
}

#[test]
fn indexed_table_info_serde_round_trip() {
    let info = IndexedTableInfo {
        db_name: "mydb".to_string(),
        table_name: "users".to_string(),
        chunk_type: "table".to_string(),
        embedded_at: "2024-01-15T12:00:00Z".to_string(),
        model_id: "nomic-embed-text".to_string(),
    };

    let json = serde_json::to_string(&info).unwrap();
    let deserialized: IndexedTableInfo = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.db_name, "mydb");
    assert_eq!(deserialized.table_name, "users");
    assert_eq!(deserialized.chunk_type, "table");
    assert_eq!(deserialized.model_id, "nomic-embed-text");
}

#[test]
fn indexed_table_info_debug_and_clone() {
    let info = IndexedTableInfo {
        db_name: "testdb".to_string(),
        table_name: "orders".to_string(),
        chunk_type: "fk_edge".to_string(),
        embedded_at: "2024-06-01T00:00:00Z".to_string(),
        model_id: "text-embedding-3-small".to_string(),
    };

    let cloned = info.clone();
    assert_eq!(cloned.db_name, info.db_name);

    let debug_str = format!("{:?}", info);
    assert!(debug_str.contains("orders"));
}

#[test]
fn index_error_payload_serde_round_trip() {
    let payload = IndexErrorPayload {
        profile_id: "profile-1".to_string(),
        error: "Embedding service timeout".to_string(),
    };

    let json = serde_json::to_string(&payload).unwrap();
    let deserialized: IndexErrorPayload = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.profile_id, "profile-1");
    assert_eq!(deserialized.error, "Embedding service timeout");
}

#[test]
fn index_error_payload_debug_and_clone() {
    let payload = IndexErrorPayload {
        profile_id: "profile-abc".to_string(),
        error: "Connection refused".to_string(),
    };

    let cloned = payload.clone();
    assert_eq!(cloned.profile_id, payload.profile_id);

    let debug_str = format!("{:?}", payload);
    assert!(debug_str.contains("Connection refused"));
}

#[test]
fn index_status_response_camel_case_serialization() {
    let response = IndexStatusResponse {
        status: "ready".to_string(),
        tables_done: Some(5),
        tables_total: Some(10),
        error: None,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("tablesDone"));
    assert!(json.contains("tablesTotal"));
    assert!(!json.contains("tables_done"));
}

#[test]
fn indexed_table_info_camel_case_serialization() {
    let info = IndexedTableInfo {
        db_name: "mydb".to_string(),
        table_name: "users".to_string(),
        chunk_type: "table".to_string(),
        embedded_at: "2024-01-15T12:00:00Z".to_string(),
        model_id: "nomic".to_string(),
    };

    let json = serde_json::to_string(&info).unwrap();
    assert!(json.contains("dbName"));
    assert!(json.contains("tableName"));
    assert!(json.contains("chunkType"));
    assert!(json.contains("embeddedAt"));
    assert!(json.contains("modelId"));
}

// ── Endpoint validation ─────────────────────────────────────────────────────

#[test]
fn get_index_status_should_return_not_configured_when_endpoint_empty_but_model_set() {
    let state = test_state();
    {
        let conn = state.db.lock().unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "nomic-embed-text").unwrap();
    }
    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert(
            "sess-endpoint-test".to_string(),
            "profile-endpoint-test".to_string(),
        );
    }
    let result = get_index_status_impl(&state, "sess-endpoint-test".to_string());
    assert!(result.is_ok());
    let status = result.unwrap();
    assert_eq!(
        status.status, "not_configured",
        "Should return 'not_configured' when ai.endpoint is empty"
    );
}

// ── force_rebuild_schema_index_impl ─────────────────────────────────────────

// The force_rebuild_schema_index_impl function requires a tauri::AppHandle which
// can't be obtained in non-coverage test builds (Wry ≠ MockRuntime). Instead, we
// test the individual behaviors it composes:
//   1. storage::delete_all_chunks wipes chunks (covered in schema_index_storage_integration)
//   2. Cancellation of in-flight tokens
//   3. State management (session_profile_map, ref counts)
// The full pipeline is exercised through E2E tests.

#[test]
fn force_rebuild_deletes_all_chunks_and_vectors() {
    // Verifies the core "wipe" step that force_rebuild_schema_index_impl performs
    let state = test_state_with_vec();
    let profile_id = "profile-force-wipe";

    {
        use sqllumen_lib::schema_index::types::{ChunkInsert, ChunkType};

        let conn = state.db.lock().unwrap();
        storage::create_vec_table(&conn, profile_id, 4).unwrap();

        let chunk = ChunkInsert {
            connection_id: profile_id.to_string(),
            chunk_key: "table:mydb.users".to_string(),
            db_name: "mydb".to_string(),
            table_name: "users".to_string(),
            chunk_type: ChunkType::Table,
            ddl_text: "CREATE TABLE users (id INT)".to_string(),
            ddl_hash: "abc123".to_string(),
            model_id: "nomic-embed-text".to_string(),
            ref_db_name: None,
            ref_table_name: None,
            embedding: vec![0.1, 0.2, 0.3, 0.4],
        };
        storage::insert_chunk(&conn, &chunk).unwrap();

        // Verify chunk exists before wipe
        let chunks = storage::list_chunks(&conn, profile_id).unwrap();
        assert_eq!(chunks.len(), 1, "Chunk should exist before force wipe");

        // Wipe — this is the same call force_rebuild_schema_index_impl makes
        storage::delete_all_chunks(&conn, profile_id).unwrap();

        // Verify chunks are gone
        let chunks = storage::list_chunks(&conn, profile_id).unwrap();
        assert!(chunks.is_empty(), "All chunks should be deleted after wipe");
    }
}

#[test]
fn force_rebuild_cancels_inflight_build_token() {
    // Verifies the cancellation step that force_rebuild_schema_index_impl performs
    let state = test_state();
    let profile_id = "profile-force-cancel";

    let token = CancellationToken::new();
    let token_clone = token.clone();

    {
        let mut tokens = state.index_build_tokens.lock().unwrap();
        tokens.insert(profile_id.to_string(), token);
    }

    assert!(
        !token_clone.is_cancelled(),
        "Token should not be cancelled initially"
    );

    // Simulate what force_rebuild does: remove and cancel existing token
    {
        let mut tokens = state.index_build_tokens.lock().unwrap();
        if let Some(old_token) = tokens.remove(profile_id) {
            old_token.cancel();
        }
    }

    assert!(
        token_clone.is_cancelled(),
        "Old build token should be cancelled by force rebuild"
    );
}

#[tokio::test]
async fn force_rebuild_wipe_then_early_return_when_no_model() {
    // Simulate the force_rebuild_schema_index_impl flow:
    // 1. resolve profile (via registry)
    // 2. cancel old token
    // 3. wipe chunks
    // 4. read settings → no model → Ok(())
    let state = test_state_with_vec();
    let profile_id = "profile-force-nomodel";

    // Setup: register session in registry
    register_dummy_session(&state, "sess-force-nomodel", profile_id);

    // Setup: insert a chunk
    {
        use sqllumen_lib::schema_index::types::{ChunkInsert, ChunkType};

        let conn = state.db.lock().unwrap();
        storage::create_vec_table(&conn, profile_id, 4).unwrap();

        let chunk = ChunkInsert {
            connection_id: profile_id.to_string(),
            chunk_key: "table:testdb.orders".to_string(),
            db_name: "testdb".to_string(),
            table_name: "orders".to_string(),
            chunk_type: ChunkType::Table,
            ddl_text: "CREATE TABLE orders (id INT)".to_string(),
            ddl_hash: "def456".to_string(),
            model_id: "nomic-embed-text".to_string(),
            ref_db_name: None,
            ref_table_name: None,
            embedding: vec![0.5, 0.6, 0.7, 0.8],
        };
        storage::insert_chunk(&conn, &chunk).unwrap();
    }

    // Step 1: resolve profile
    let resolved = state.registry.get_profile_id("sess-force-nomodel").unwrap();
    assert_eq!(resolved, profile_id);

    // Step 2: cancel old token (none exists, but the code handles that)
    {
        let mut tokens = state.index_build_tokens.lock().unwrap();
        if let Some(old_token) = tokens.remove(profile_id) {
            old_token.cancel();
        }
    }

    // Step 3: wipe chunks
    {
        let conn = state.db.lock().unwrap();
        storage::delete_all_chunks(&conn, profile_id).unwrap();

        // Verify wipe
        let chunks = storage::list_chunks(&conn, profile_id).unwrap();
        assert!(chunks.is_empty(), "Chunks should be wiped");
    }

    // Step 4: read settings — no model configured → early return Ok
    let embedding_model = {
        let conn = state.db.lock().unwrap();
        settings::get_setting(&conn, "ai.embeddingModel")
            .unwrap()
            .unwrap_or_default()
    };
    assert!(
        embedding_model.is_empty(),
        "No embedding model configured — force rebuild returns early"
    );
}

#[tokio::test]
async fn force_rebuild_wipe_with_model_but_no_endpoint() {
    // When embedding model is set but endpoint is empty, force_rebuild should
    // wipe chunks and return Ok without starting a build.
    let state = test_state_with_vec();
    let profile_id = "profile-force-noep";

    register_dummy_session(&state, "sess-force-noep", profile_id);

    {
        use sqllumen_lib::schema_index::types::{ChunkInsert, ChunkType};

        let conn = state.db.lock().unwrap();
        storage::create_vec_table(&conn, profile_id, 4).unwrap();

        let chunk = ChunkInsert {
            connection_id: profile_id.to_string(),
            chunk_key: "table:testdb.products".to_string(),
            db_name: "testdb".to_string(),
            table_name: "products".to_string(),
            chunk_type: ChunkType::Table,
            ddl_text: "CREATE TABLE products (id INT)".to_string(),
            ddl_hash: "ghi789".to_string(),
            model_id: "nomic-embed-text".to_string(),
            ref_db_name: None,
            ref_table_name: None,
            embedding: vec![0.1, 0.2, 0.3, 0.4],
        };
        storage::insert_chunk(&conn, &chunk).unwrap();

        // Set model but no endpoint
        settings::set_setting(&conn, "ai.embeddingModel", "nomic-embed-text").unwrap();
    }

    // Wipe chunks (simulating force rebuild)
    {
        let conn = state.db.lock().unwrap();
        storage::delete_all_chunks(&conn, profile_id).unwrap();
    }

    // Check endpoint is empty
    let endpoint = {
        let conn = state.db.lock().unwrap();
        settings::get_setting(&conn, "ai.endpoint")
            .unwrap()
            .unwrap_or_default()
    };
    assert!(
        endpoint.is_empty(),
        "Endpoint is empty — force rebuild returns Ok after wipe"
    );

    // Verify chunks are gone
    {
        let conn = state.db.lock().unwrap();
        let chunks = storage::list_chunks(&conn, profile_id).unwrap();
        assert!(chunks.is_empty());
    }
}

// ── build_schema_index_impl (coverage-mode) ─────────────────────────────
//
// In coverage mode, the _impl functions don't take AppHandle (they don't use it).
// This allows direct testing of all code paths. These tests are gated on
// #[cfg(coverage)] because the function signatures differ between modes.

#[cfg(coverage)]
#[tokio::test]
async fn build_schema_index_session_not_found() {
    let state = test_state();

    let result = build_schema_index_impl(&state, "nonexistent-sess".to_string()).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[cfg(coverage)]
#[tokio::test]
async fn build_schema_index_no_model_returns_ok() {
    let state = test_state();

    // Register session in registry
    register_dummy_session(&state, "sess-build-nomodel", "profile-build-nomodel");

    // No ai.embeddingModel set → early return Ok
    let result = build_schema_index_impl(&state, "sess-build-nomodel".to_string()).await;
    assert!(result.is_ok());

    // Session should now be tracked in session_profile_map
    {
        let map = state.session_profile_map.lock().unwrap();
        assert!(map.contains_key("sess-build-nomodel"));
    }
    // Ref count should be 1
    {
        let counts = state.session_ref_counts.lock().unwrap();
        assert_eq!(*counts.get("profile-build-nomodel").unwrap(), 1);
    }
}

#[cfg(coverage)]
#[tokio::test]
async fn build_schema_index_already_registered_no_double_ref_count() {
    let state = test_state();

    register_dummy_session(&state, "sess-build-dup", "profile-build-dup");

    // Pre-register the session in session_profile_map (simulate already called once)
    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert(
            "sess-build-dup".to_string(),
            "profile-build-dup".to_string(),
        );
    }
    {
        let mut counts = state.session_ref_counts.lock().unwrap();
        counts.insert("profile-build-dup".to_string(), 1);
    }

    // No model → early return, but should NOT increment ref count
    let result = build_schema_index_impl(&state, "sess-build-dup".to_string()).await;
    assert!(result.is_ok());

    // Ref count should still be 1 (not 2)
    {
        let counts = state.session_ref_counts.lock().unwrap();
        assert_eq!(*counts.get("profile-build-dup").unwrap(), 1);
    }
}

#[cfg(coverage)]
#[tokio::test]
async fn build_schema_index_build_already_in_progress_returns_ok() {
    let state = test_state();

    register_dummy_session(&state, "sess-build-dup2", "profile-build-dup2");

    // Set model and endpoint
    {
        let conn = state.db.lock().unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "nomic-embed-text").unwrap();
        settings::set_setting(&conn, "ai.endpoint", "http://localhost:11434").unwrap();
    }

    // Pre-insert a build token (simulate build in progress)
    {
        let mut tokens = state.index_build_tokens.lock().unwrap();
        tokens.insert("profile-build-dup2".to_string(), CancellationToken::new());
    }

    let result = build_schema_index_impl(&state, "sess-build-dup2".to_string()).await;
    assert!(
        result.is_ok(),
        "Should return Ok when build already in progress"
    );
}

#[cfg(coverage)]
#[tokio::test]
async fn build_schema_index_model_set_but_no_endpoint_returns_ok() {
    let state = test_state();

    register_dummy_session(&state, "sess-build-noep", "profile-build-noep");

    // Set model but NOT endpoint
    {
        let conn = state.db.lock().unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "nomic-embed-text").unwrap();
    }

    let result = build_schema_index_impl(&state, "sess-build-noep".to_string()).await;
    assert!(result.is_ok());
}

// ── force_rebuild_schema_index_impl (coverage-mode) ─────────────────────

#[cfg(coverage)]
#[tokio::test]
async fn force_rebuild_session_not_found() {
    let state = test_state();

    let result = force_rebuild_schema_index_impl(&state, "nonexistent-sess".to_string()).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[cfg(coverage)]
#[tokio::test]
async fn force_rebuild_no_model_returns_ok() {
    let state = test_state_with_vec();
    let profile_id = "profile-force-cov-nomodel";

    register_dummy_session(&state, "sess-force-cov-nomodel", profile_id);

    // Create vec table and insert a chunk
    {
        use sqllumen_lib::schema_index::types::{ChunkInsert, ChunkType};
        let conn = state.db.lock().unwrap();
        storage::create_vec_table(&conn, profile_id, 4).unwrap();
        let chunk = ChunkInsert {
            connection_id: profile_id.to_string(),
            chunk_key: "table:testdb.t1".to_string(),
            db_name: "testdb".to_string(),
            table_name: "t1".to_string(),
            chunk_type: ChunkType::Table,
            ddl_text: "CREATE TABLE t1 (id INT)".to_string(),
            ddl_hash: "hash1".to_string(),
            model_id: "nomic-embed-text".to_string(),
            ref_db_name: None,
            ref_table_name: None,
            embedding: vec![0.1, 0.2, 0.3, 0.4],
        };
        storage::insert_chunk(&conn, &chunk).unwrap();
    }

    // No model set → should wipe chunks and return Ok
    let result =
        force_rebuild_schema_index_impl(&state, "sess-force-cov-nomodel".to_string()).await;
    assert!(result.is_ok());

    // Chunks should be wiped
    {
        let conn = state.db.lock().unwrap();
        let chunks = storage::list_chunks(&conn, profile_id).unwrap();
        assert!(
            chunks.is_empty(),
            "Chunks should be wiped after force rebuild"
        );
    }
}

#[cfg(coverage)]
#[tokio::test]
async fn force_rebuild_model_set_no_endpoint_returns_ok() {
    let state = test_state_with_vec();
    let profile_id = "profile-force-cov-noep";

    register_dummy_session(&state, "sess-force-cov-noep", profile_id);

    {
        let conn = state.db.lock().unwrap();
        storage::create_vec_table(&conn, profile_id, 4).unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "nomic-embed-text").unwrap();
    }

    let result = force_rebuild_schema_index_impl(&state, "sess-force-cov-noep".to_string()).await;
    assert!(result.is_ok());
}

#[cfg(coverage)]
#[tokio::test]
async fn force_rebuild_cancels_existing_token() {
    let state = test_state_with_vec();
    let profile_id = "profile-force-cov-cancel";

    register_dummy_session(&state, "sess-force-cov-cancel", profile_id);

    {
        let conn = state.db.lock().unwrap();
        storage::create_vec_table(&conn, profile_id, 4).unwrap();
    }

    // Insert a build token that should be cancelled
    let old_token = CancellationToken::new();
    let old_token_clone = old_token.clone();
    {
        let mut tokens = state.index_build_tokens.lock().unwrap();
        tokens.insert(profile_id.to_string(), old_token);
    }

    let result = force_rebuild_schema_index_impl(&state, "sess-force-cov-cancel".to_string()).await;
    assert!(result.is_ok());

    // Old token should have been cancelled
    assert!(
        old_token_clone.is_cancelled(),
        "Old token should be cancelled during force rebuild"
    );
}

#[cfg(coverage)]
#[tokio::test]
async fn force_rebuild_model_and_endpoint_set_returns_ok() {
    let state = test_state_with_vec();
    let profile_id = "profile-force-cov-full";

    register_dummy_session(&state, "sess-force-cov-full", profile_id);

    {
        let conn = state.db.lock().unwrap();
        storage::create_vec_table(&conn, profile_id, 4).unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "nomic-embed-text").unwrap();
        settings::set_setting(&conn, "ai.endpoint", "http://localhost:11434").unwrap();
    }

    // With both model and endpoint set, the coverage stub still returns Ok
    // (it can't actually build without a real MySQL pool)
    let result = force_rebuild_schema_index_impl(&state, "sess-force-cov-full".to_string()).await;
    assert!(result.is_ok());
}

#[cfg(coverage)]
#[tokio::test]
async fn force_rebuild_already_registered_no_double_ref_count() {
    let state = test_state_with_vec();
    let profile_id = "profile-force-cov-dup";

    register_dummy_session(&state, "sess-force-cov-dup", profile_id);

    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert("sess-force-cov-dup".to_string(), profile_id.to_string());
    }
    {
        let mut counts = state.session_ref_counts.lock().unwrap();
        counts.insert(profile_id.to_string(), 1);
    }

    let result = force_rebuild_schema_index_impl(&state, "sess-force-cov-dup".to_string()).await;
    assert!(result.is_ok());

    let counts = state.session_ref_counts.lock().unwrap();
    assert_eq!(*counts.get(profile_id).unwrap(), 1);
}

// ── invalidate_schema_index_impl (coverage-mode) ────────────────────────

#[cfg(coverage)]
#[tokio::test]
async fn invalidate_schema_index_session_not_found() {
    let state = test_state();

    let result = invalidate_schema_index_impl(
        &state,
        "nonexistent-sess".to_string(),
        vec!["db.table".to_string()],
    )
    .await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[cfg(coverage)]
#[tokio::test]
async fn invalidate_schema_index_ok_for_valid_session() {
    let state = test_state();

    register_dummy_session(&state, "sess-inv", "profile-inv");

    let result = invalidate_schema_index_impl(
        &state,
        "sess-inv".to_string(),
        vec!["testdb.users".to_string()],
    )
    .await;
    assert!(result.is_ok());
}

#[cfg(coverage)]
#[tokio::test]
async fn invalidate_schema_index_with_empty_tables() {
    let state = test_state();

    register_dummy_session(&state, "sess-inv-empty", "profile-inv-empty");

    let result = invalidate_schema_index_impl(&state, "sess-inv-empty".to_string(), vec![]).await;
    assert!(result.is_ok());
}

// ── read_setting helper ─────────────────────────────────────────────────

#[test]
fn read_setting_returns_empty_string_when_not_set() {
    let state = test_state();
    // read_setting is private but we exercise it through the public _impl functions.
    // Confirm that get_index_status works when settings are unset (hitting read_setting).
    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert("sess-rs".to_string(), "profile-rs".to_string());
    }
    let result = get_index_status_impl(&state, "sess-rs".to_string());
    assert!(result.is_ok());
    assert_eq!(result.unwrap().status, "not_configured");
}

#[test]
fn read_setting_returns_value_when_set() {
    let state = test_state();
    {
        let conn = state.db.lock().unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "test-model").unwrap();
        settings::set_setting(&conn, "ai.endpoint", "http://localhost").unwrap();
    }
    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert("sess-rs2".to_string(), "profile-rs2".to_string());
    }
    // With both settings set and no meta, should return "stale"
    let result = get_index_status_impl(&state, "sess-rs2".to_string());
    assert!(result.is_ok());
    assert_eq!(result.unwrap().status, "stale");
}

// ── list_indexed_tables with multiple chunk types ───────────────────────

#[tokio::test]
async fn list_indexed_tables_returns_fk_chunks_too() {
    let state = test_state_with_vec();

    use sqllumen_lib::schema_index::types::{ChunkInsert, ChunkType};

    register_dummy_session(&state, "sess-list-fk", "profile-list-fk");

    {
        let conn = state.db.lock().unwrap();
        storage::create_vec_table(&conn, "profile-list-fk", 4).unwrap();

        // Table chunk
        let table_chunk = ChunkInsert {
            connection_id: "profile-list-fk".to_string(),
            chunk_key: "table:mydb.users".to_string(),
            db_name: "mydb".to_string(),
            table_name: "users".to_string(),
            chunk_type: ChunkType::Table,
            ddl_text: "CREATE TABLE users (id INT)".to_string(),
            ddl_hash: "abc123".to_string(),
            model_id: "test-model".to_string(),
            ref_db_name: None,
            ref_table_name: None,
            embedding: vec![0.1, 0.2, 0.3, 0.4],
        };
        storage::insert_chunk(&conn, &table_chunk).unwrap();

        // FK chunk
        let fk_chunk = ChunkInsert {
            connection_id: "profile-list-fk".to_string(),
            chunk_key: "fk:mydb.orders:fk_user_id".to_string(),
            db_name: "mydb".to_string(),
            table_name: "orders".to_string(),
            chunk_type: ChunkType::Fk,
            ddl_text: "FK: orders → users".to_string(),
            ddl_hash: "fkhash".to_string(),
            model_id: "test-model".to_string(),
            ref_db_name: Some("mydb".to_string()),
            ref_table_name: Some("users".to_string()),
            embedding: vec![0.5, 0.6, 0.7, 0.8],
        };
        storage::insert_chunk(&conn, &fk_chunk).unwrap();
    }

    let result = list_indexed_tables_impl(&state, "sess-list-fk".to_string());
    assert!(result.is_ok());
    let tables = result.unwrap();
    assert_eq!(tables.len(), 2);

    let table_entry = tables.iter().find(|t| t.chunk_type == "table").unwrap();
    assert_eq!(table_entry.table_name, "users");

    let fk_entry = tables.iter().find(|t| t.chunk_type == "fk").unwrap();
    assert_eq!(fk_entry.table_name, "orders");
}

// ── get_index_status with Building meta status ──────────────────────────

#[test]
fn get_index_status_returns_building_from_meta_when_no_token() {
    let state = test_state();

    {
        let conn = state.db.lock().unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "nomic-embed-text").unwrap();
        settings::set_setting(&conn, "ai.endpoint", "http://localhost:11434").unwrap();
    }

    // Insert meta with building status (but no active token)
    {
        let conn = state.db.lock().unwrap();
        let meta = IndexMeta {
            connection_id: "profile-build-meta".to_string(),
            model_id: "nomic-embed-text".to_string(),
            embedding_dimension: 384,
            last_build_at: None,
            status: IndexStatus::Building,
            vec_schema_version: Some(1),
        };
        storage::upsert_index_meta(&conn, &meta).unwrap();
    }

    {
        let mut map = state.session_profile_map.lock().unwrap();
        map.insert(
            "sess-build-meta".to_string(),
            "profile-build-meta".to_string(),
        );
    }

    let result = get_index_status_impl(&state, "sess-build-meta".to_string());
    assert!(result.is_ok());
    let status = result.unwrap();
    assert_eq!(status.status, "building");
}
