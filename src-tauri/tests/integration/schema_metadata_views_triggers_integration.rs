#[cfg(not(coverage))]
use crate::common::mock_mysql_server::{MockCell, MockColumnDef, MockMySqlServer, MockQueryStep};
#[cfg(not(coverage))]
use opensrv_mysql::{ColumnFlags, ColumnType};
use rusqlite::Connection;
use sqllumen_lib::mysql::query_executor::{fetch_schema_metadata_full_impl, TriggerMeta, ViewMeta};
use sqllumen_lib::mysql::registry::{
    ConnectionRegistry, ConnectionStatus, RegistryEntry, StoredConnectionParams,
};
use sqllumen_lib::mysql::table_data_cache::TableDataCache;
use sqllumen_lib::state::AppState;
#[cfg(not(coverage))]
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use std::sync::{Arc, Mutex};

fn test_state() -> AppState {
    #[cfg(coverage)]
    crate::common::ensure_fake_backend_once();

    let mut conn = Connection::open_in_memory().expect("should open in-memory db");
    sqllumen_lib::db::migrations::run_migrations(&mut conn).expect("should run migrations");
    AppState {
        db: Arc::new(Mutex::new(conn)),
        logs_db: Arc::new(Mutex::new(
            Connection::open_in_memory().expect("should open in-memory logs db"),
        )),
        registry: ConnectionRegistry::new(),
        app_handle: None,
        result_cache: Arc::new(
            sqllumen_lib::mysql::result_cache::ResultCache::new_for_test(
                1800,
                std::env::temp_dir().join("sqllumen-test-schema-metadata-vt-results"),
            ),
        ),
        table_data_cache: Arc::new(TableDataCache::new_for_test(
            1800,
            std::env::temp_dir().join("sqllumen-test-schema-metadata-vt-table-data"),
        )),
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
        http_client: sqllumen_lib::http_client(),
        embedding_cache: sqllumen_lib::schema_index::embeddings_cache::EmbeddingCache::new(),
    }
}

#[cfg(not(coverage))]
fn text_col(name: &'static str) -> MockColumnDef {
    MockColumnDef {
        name,
        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
        colflags: ColumnFlags::empty(),
    }
}

#[cfg(not(coverage))]
fn pool_for(port: u16) -> sqlx::MySqlPool {
    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(port)
        .username("root")
        .password("");
    MySqlPoolOptions::new().connect_lazy_with(opts)
}

fn stored_params(profile_id: &str) -> StoredConnectionParams {
    StoredConnectionParams {
        profile_id: profile_id.to_string(),
        host: "127.0.0.1".to_string(),
        port: 13306,
        username: "root".to_string(),
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
fn dummy_lazy_pool() -> sqlx::MySqlPool {
    let opts = sqlx::mysql::MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(13306)
        .username("dummy")
        .password("dummy");
    sqlx::mysql::MySqlPoolOptions::new().connect_lazy_with(opts)
}

fn register_pool(state: &AppState, connection_id: &str, pool: sqlx::MySqlPool) {
    let entry = RegistryEntry {
        pool,
        session_id: connection_id.to_string(),
        profile_id: connection_id.to_string(),
        status: ConnectionStatus::Connected,
        server_version: "8.0.0".to_string(),
        cancellation_token: tokio_util::sync::CancellationToken::new(),
        connection_params: stored_params(connection_id),
        read_only: false,
    };
    state.registry.insert(connection_id.to_string(), entry);
}

#[test]
fn view_and_trigger_meta_expose_name_via_debug_and_serde() {
    let view = ViewMeta {
        name: "active_users".to_string(),
    };
    let trigger = TriggerMeta {
        name: "before_users_insert".to_string(),
    };

    assert!(format!("{view:?}").contains("active_users"));
    assert!(format!("{trigger:?}").contains("before_users_insert"));

    assert_eq!(
        serde_json::to_value(&view).expect("view should serialize")["name"],
        "active_users"
    );
    assert_eq!(
        serde_json::to_value(&trigger).expect("trigger should serialize")["name"],
        "before_users_insert"
    );
}

#[cfg(not(coverage))]
#[tokio::test]
async fn fetch_schema_metadata_full_populates_views_and_triggers_by_database() {
    let steps = vec![
        MockQueryStep {
            query: "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('information_schema','performance_schema','sys','mysql') ORDER BY SCHEMA_NAME",
            columns: vec![text_col("SCHEMA_NAME")],
            rows: vec![vec![MockCell::Bytes(b"app")], vec![MockCell::Bytes(b"analytics")]],
            error: None,
            affected_rows: None,
        },
        MockQueryStep {
            query: "SELECT t.TABLE_SCHEMA, t.TABLE_NAME, COALESCE(t.ENGINE,''), COALESCE(c.CHARACTER_SET_NAME,''), COALESCE(t.TABLE_ROWS,0), COALESCE(t.DATA_LENGTH,0) FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATION_CHARACTER_SET_APPLICABILITY c ON c.COLLATION_NAME = t.TABLE_COLLATION WHERE t.TABLE_SCHEMA NOT IN ('information_schema','performance_schema','sys','mysql') ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME",
            columns: vec![
                text_col("TABLE_SCHEMA"),
                text_col("TABLE_NAME"),
                text_col("ENGINE"),
                text_col("CHARACTER_SET_NAME"),
                text_col("TABLE_ROWS"),
                text_col("DATA_LENGTH"),
            ],
            rows: vec![
                vec![
                    MockCell::Bytes(b"app"),
                    MockCell::Bytes(b"users"),
                    MockCell::Bytes(b"InnoDB"),
                    MockCell::Bytes(b"utf8mb4"),
                    MockCell::Bytes(b"10"),
                    MockCell::Bytes(b"2048"),
                ],
                vec![
                    MockCell::Bytes(b"analytics"),
                    MockCell::Bytes(b"events"),
                    MockCell::Bytes(b"InnoDB"),
                    MockCell::Bytes(b"utf8mb4"),
                    MockCell::Bytes(b"25"),
                    MockCell::Bytes(b"4096"),
                ],
            ],
            error: None,
            affected_rows: None,
        },
        MockQueryStep {
            query: "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA NOT IN ('information_schema','performance_schema','sys','mysql') ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION",
            columns: vec![
                text_col("TABLE_SCHEMA"),
                text_col("TABLE_NAME"),
                text_col("COLUMN_NAME"),
                text_col("DATA_TYPE"),
            ],
            rows: vec![
                vec![
                    MockCell::Bytes(b"app"),
                    MockCell::Bytes(b"users"),
                    MockCell::Bytes(b"id"),
                    MockCell::Bytes(b"int"),
                ],
                vec![
                    MockCell::Bytes(b"analytics"),
                    MockCell::Bytes(b"events"),
                    MockCell::Bytes(b"id"),
                    MockCell::Bytes(b"bigint"),
                ],
            ],
            error: None,
            affected_rows: None,
        },
        MockQueryStep {
            query: "SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA NOT IN ('information_schema','performance_schema','sys','mysql') ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME",
            columns: vec![
                text_col("ROUTINE_SCHEMA"),
                text_col("ROUTINE_NAME"),
                text_col("ROUTINE_TYPE"),
            ],
            rows: vec![vec![
                MockCell::Bytes(b"app"),
                MockCell::Bytes(b"sync_users"),
                MockCell::Bytes(b"PROCEDURE"),
            ]],
            error: None,
            affected_rows: None,
        },
        MockQueryStep {
            query: "SELECT TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, DELETE_RULE, UPDATE_RULE FROM information_schema.KEY_COLUMN_USAGE kcu JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA WHERE kcu.TABLE_SCHEMA IN (?, ?) AND kcu.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
            columns: vec![],
            rows: vec![],
            error: None,
            affected_rows: None,
        },
        MockQueryStep {
            query: "SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NON_UNIQUE, INDEX_TYPE, COLUMN_NAME, CARDINALITY FROM information_schema.STATISTICS WHERE TABLE_SCHEMA IN (?, ?) ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
            columns: vec![],
            rows: vec![],
            error: None,
            affected_rows: None,
        },
        MockQueryStep {
            query: "SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA IN (?, ?) AND TABLE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') ORDER BY TABLE_SCHEMA, TABLE_NAME",
            columns: vec![text_col("TABLE_SCHEMA"), text_col("TABLE_NAME")],
            rows: vec![
                vec![MockCell::Bytes(b"analytics"), MockCell::Bytes(b"daily_events")],
                vec![MockCell::Bytes(b"app"), MockCell::Bytes(b"active_users")],
            ],
            error: None,
            affected_rows: None,
        },
        MockQueryStep {
            query: "SELECT TRIGGER_SCHEMA, TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA IN (?, ?) AND TRIGGER_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') ORDER BY TRIGGER_SCHEMA, TRIGGER_NAME",
            columns: vec![text_col("TRIGGER_SCHEMA"), text_col("TRIGGER_NAME")],
            rows: vec![
                vec![MockCell::Bytes(b"analytics"), MockCell::Bytes(b"after_events_insert")],
                vec![MockCell::Bytes(b"app"), MockCell::Bytes(b"before_users_insert")],
            ],
            error: None,
            affected_rows: None,
        },
    ];

    let server = MockMySqlServer::start_script(steps).await;
    let pool = pool_for(server.port);
    let state = test_state();
    register_pool(&state, "conn-vt", pool);

    let metadata = fetch_schema_metadata_full_impl(&state, "conn-vt")
        .await
        .expect("full metadata should include views and triggers");

    assert_eq!(
        metadata.databases,
        vec!["app".to_string(), "analytics".to_string()]
    );

    let app_views = metadata.views.get("app").expect("app views");
    assert_eq!(app_views.len(), 1);
    assert_eq!(app_views[0].name, "active_users");

    let analytics_views = metadata.views.get("analytics").expect("analytics views");
    assert_eq!(analytics_views.len(), 1);
    assert_eq!(analytics_views[0].name, "daily_events");

    let app_triggers = metadata.triggers.get("app").expect("app triggers");
    assert_eq!(app_triggers.len(), 1);
    assert_eq!(app_triggers[0].name, "before_users_insert");

    let analytics_triggers = metadata
        .triggers
        .get("analytics")
        .expect("analytics triggers");
    assert_eq!(analytics_triggers.len(), 1);
    assert_eq!(analytics_triggers[0].name, "after_events_insert");

    let json = serde_json::to_value(&metadata).expect("metadata should serialize");
    assert_eq!(json["views"]["app"][0]["name"], "active_users");
    assert_eq!(
        json["triggers"]["analytics"][0]["name"],
        "after_events_insert"
    );
}

#[cfg(coverage)]
#[tokio::test]
async fn fetch_schema_metadata_full_coverage_stub_includes_empty_views_and_triggers() {
    let state = test_state();
    register_pool(&state, "conn-vt-coverage", dummy_lazy_pool());

    let metadata = fetch_schema_metadata_full_impl(&state, "conn-vt-coverage")
        .await
        .expect("coverage stub should succeed");

    assert!(metadata.views.is_empty());
    assert!(metadata.triggers.is_empty());

    let json = serde_json::to_value(&metadata).expect("metadata should serialize");
    assert_eq!(json["views"], serde_json::json!({}));
    assert_eq!(json["triggers"], serde_json::json!({}));
}
