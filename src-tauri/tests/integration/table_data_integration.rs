//! Integration tests for table data operations — filter translation and coverage stubs.

use sqllumen_lib::commands::table_data::interpolate_sql_params;
use sqllumen_lib::db::ssl_mode::SslMode;
#[cfg(coverage)]
use sqllumen_lib::mysql::pool::SslSettings;
#[cfg(not(coverage))]
use sqllumen_lib::mysql::table_data::fetch_table_pk_cached;
use sqllumen_lib::mysql::table_data::{
    format_bytes, is_generated_column_extra, parse_enum_values, parse_set_values,
};
use sqllumen_lib::mysql::table_data::{
    translate_filter_model, translate_filter_model_with_columns, ExportTableOptions,
    FilterCondition, PrimaryKeyInfo, SortInfo, TableDataColumnMeta,
};

use crate::common;

use sqllumen_lib::mysql::metadata_cache::MetadataCache;

#[test]
fn format_bytes_matches_frontend_units() {
    // Sub-kilobyte values stay exact.
    assert_eq!(format_bytes(0), "0 B");
    assert_eq!(format_bytes(1), "1 B");
    assert_eq!(format_bytes(1023), "1023 B");
    // Scale into KB / MB / GB / TB, trimming a trailing `.0`.
    assert_eq!(format_bytes(1024), "1 KB");
    assert_eq!(format_bytes(1536), "1.5 KB");
    assert_eq!(format_bytes(4096), "4 KB");
    assert_eq!(format_bytes(12 * 1024 * 1024), "12 MB");
    assert_eq!(format_bytes(1024u64.pow(3)), "1 GB");
    assert_eq!(format_bytes(1024u64.pow(4)), "1 TB");
    assert_eq!(format_bytes(5 * 1024u64.pow(4)), "5 TB");
}

#[cfg(not(coverage))]
#[tokio::test]
async fn fetch_table_pk_cached_returns_cached_metadata_without_querying_mysql() {
    let pool = crate::common::mock_session::unreachable_pool();

    let metadata_cache = MetadataCache::new();
    let cached_pk = Some(PrimaryKeyInfo {
        key_columns: vec!["id".to_string()],
        has_auto_increment: true,
        is_unique_key_fallback: false,
    });
    let cached_columns = vec![TableDataColumnMeta {
        name: "id".to_string(),
        data_type: "INT".to_string(),
        is_boolean_alias: false,
        enum_values: None,
        set_values: None,
        is_nullable: false,
        is_primary_key: true,
        is_unique_key: false,
        has_default: false,
        column_default: None,
        is_binary: false,
        is_auto_increment: true,
        is_generated: false,
    }];

    metadata_cache.insert(
        sqllumen_lib::mysql::metadata_cache::MetadataTableKey::new(
            "cached-connection",
            "cached_db",
            "cached_table",
        ),
        sqllumen_lib::mysql::metadata_cache::TableKeyMetadata {
            primary_key: cached_pk.clone(),
            columns: cached_columns.clone(),
        },
    );

    let result = fetch_table_pk_cached(
        &sqllumen_lib::mysql::table_data::TableDataContext {
            pool: &pool,
            connection_id: "cached-connection",
            metadata_cache: &metadata_cache,
        },
        "cached_db",
        "cached_table",
    )
    .await
    .expect("cache hit should return without touching mysql");

    assert_eq!(result.primary_key, cached_pk);
    assert_eq!(result.columns, cached_columns);

    pool.disconnect().await.expect("pool disconnects");
}

#[cfg(not(coverage))]
mod type_aware_filter_integration {
    use super::*;
    use crate::common::mock_mysql_server::{
        MockCell, MockColumnDef, MockDateTimeValue, MockMySqlServer, MockQueryStep,
    };
    use jiff::civil;
    use opensrv_mysql::{ColumnFlags, ColumnType};
    use rusqlite::Connection;
    use serde::de::DeserializeOwned;
    use serde_json::json;
    use sqllumen_lib::commands::connections::{save_connection_impl, SaveConnectionInput};
    use sqllumen_lib::commands::mysql::{open_connection_impl, OpenConnectionResult};
    use sqllumen_lib::commands::table_data as table_data_commands;
    use sqllumen_lib::mysql::pool::set_test_pool_factory;
    use sqllumen_lib::mysql::registry::ConnectionRegistry;
    use sqllumen_lib::state::AppState;
    use std::sync::{Arc, Mutex};
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;

    fn test_state() -> AppState {
        common::ensure_fake_backend_once();
        let mut conn = Connection::open_in_memory().expect("should open in-memory db");
        sqllumen_lib::db::migrations::run_migrations(&mut conn).expect("should run migrations");
        AppState {
            db: Arc::new(Mutex::new(conn)),
            logs_db: Arc::new(Mutex::new(
                Connection::open_in_memory().expect("should open in-memory logs db"),
            )),
            registry: ConnectionRegistry::new(),
            app_handle: None,
            result_cache: std::sync::Arc::new(
                sqllumen_lib::mysql::result_cache::ResultCache::new_for_test(
                    1800,
                    std::env::temp_dir().join("sqllumen-test-tbldata-results"),
                ),
            ),
            metadata_cache: sqllumen_lib::mysql::metadata_cache::MetadataCache::new(),
            log_filter_reload: Mutex::new(None),
            running_queries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
            editor_sessions: Default::default(),
            dump_jobs: std::sync::Arc::new(
                std::sync::RwLock::new(std::collections::HashMap::new()),
            ),
            import_jobs: std::sync::Arc::new(std::sync::RwLock::new(
                std::collections::HashMap::new(),
            )),
            result_export_jobs: std::sync::Arc::new(std::sync::RwLock::new(
                std::collections::HashMap::new(),
            )),
            copy_jobs: std::sync::Arc::new(
                std::sync::RwLock::new(std::collections::HashMap::new()),
            ),
            ai_requests: Arc::new(Mutex::new(std::collections::HashMap::new())),
            index_build_tokens: Arc::new(Mutex::new(std::collections::HashMap::new())),
            session_profile_map: Arc::new(Mutex::new(std::collections::HashMap::new())),
            session_ref_counts: Arc::new(Mutex::new(std::collections::HashMap::new())),
            http_client: sqllumen_lib::http_client(),
            embedding_cache: sqllumen_lib::schema_index::embeddings_cache::EmbeddingCache::new(),
        }
    }

    fn build_app() -> (
        tauri::App<tauri::test::MockRuntime>,
        tauri::WebviewWindow<tauri::test::MockRuntime>,
    ) {
        let app = mock_builder()
            .manage(test_state())
            .invoke_handler(tauri::generate_handler![
                save_connection,
                open_connection,
                fetch_table_data
            ])
            .build(mock_context(noop_assets()))
            .expect("should build test app");
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("should build test webview");
        (app, webview)
    }

    #[tauri::command]
    fn save_connection(
        data: SaveConnectionInput,
        state: tauri::State<'_, AppState>,
    ) -> Result<String, String> {
        save_connection_impl(&state, data)
    }

    #[derive(Debug, serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct OpenConnectionPayloadDto {
        profile_id: String,
    }

    #[tauri::command]
    async fn open_connection(
        payload: OpenConnectionPayloadDto,
        state: tauri::State<'_, AppState>,
    ) -> Result<OpenConnectionResult, String> {
        open_connection_impl(&state, crate::common::open_payload(&payload.profile_id))
            .await
            .map_err(|error| error.message)
    }

    #[tauri::command]
    async fn fetch_table_data(
        state: tauri::State<'_, AppState>,
        payload: sqllumen_lib::mysql::table_data::FetchTableDataRequest,
    ) -> Result<sqllumen_lib::mysql::table_data::TableDataResponse, String> {
        table_data_commands::fetch_table_data(state, payload).await
    }

    fn invoke_tauri_command<T: DeserializeOwned>(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        cmd: &str,
        body: serde_json::Value,
    ) -> Result<T, serde_json::Value> {
        let url = if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        };

        get_ipc_response(
            webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: url.parse().expect("test URL should parse"),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|response| {
            response
                .deserialize::<T>()
                .expect("IPC response should deserialize")
        })
    }

    fn save_input_json(port: u16) -> serde_json::Value {
        let input = SaveConnectionInput {
            name: "Mock Table Data DB".to_string(),
            host: "127.0.0.1".to_string(),
            port: i64::from(port),
            username: "root".to_string(),
            password: None,
            default_database: None,
            ssl_mode: SslMode::Disabled,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            color: None,
            group_id: None,
            read_only: false,
            sort_order: 0,
            connect_timeout_secs: Some(2),
            keepalive_interval_secs: Some(0),
        };

        json!({
            "name": input.name,
            "host": input.host,
            "port": input.port,
            "username": input.username,
            "password": input.password,
            "defaultDatabase": input.default_database,
            "sslMode": input.ssl_mode,
            "sslCaPath": input.ssl_ca_path,
            "sslCertPath": input.ssl_cert_path,
            "sslKeyPath": input.ssl_key_path,
            "color": input.color,
            "groupId": input.group_id,
            "readOnly": input.read_only,
            "sortOrder": input.sort_order,
            "connectTimeoutSecs": input.connect_timeout_secs,
            "keepaliveIntervalSecs": input.keepalive_interval_secs,
        })
    }

    #[derive(Debug, serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct OpenConnectionResultDto {
        session_id: String,
    }

    const COLUMN_METADATA_QUERY: &str = "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION";
    const PRIMARY_KEY_QUERY: &str = "SELECT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY' ORDER BY kcu.ORDINAL_POSITION";

    fn column_metadata_step(rows: Vec<Vec<MockCell>>) -> MockQueryStep {
        MockQueryStep::with_rows(
            COLUMN_METADATA_QUERY,
            vec![
                MockColumnDef {
                    name: "COLUMN_NAME",
                    coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                    colflags: ColumnFlags::NOT_NULL_FLAG,
                },
                MockColumnDef {
                    name: "DATA_TYPE",
                    coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                    colflags: ColumnFlags::NOT_NULL_FLAG,
                },
                MockColumnDef {
                    name: "COLUMN_TYPE",
                    coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                    colflags: ColumnFlags::NOT_NULL_FLAG,
                },
                MockColumnDef {
                    name: "IS_NULLABLE",
                    coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                    colflags: ColumnFlags::NOT_NULL_FLAG,
                },
                MockColumnDef {
                    name: "COLUMN_KEY",
                    coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                    colflags: ColumnFlags::empty(),
                },
                MockColumnDef {
                    name: "COLUMN_DEFAULT",
                    coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                    colflags: ColumnFlags::empty(),
                },
                MockColumnDef {
                    name: "EXTRA",
                    coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                    colflags: ColumnFlags::NOT_NULL_FLAG,
                },
            ],
            rows,
        )
    }

    fn auto_increment_id_row() -> Vec<MockCell> {
        vec![
            MockCell::Bytes(b"id"),
            MockCell::Bytes(b"int"),
            MockCell::Bytes(b"int(11)"),
            MockCell::Bytes(b"NO"),
            MockCell::Bytes(b"PRI"),
            MockCell::Null,
            MockCell::Bytes(b"auto_increment"),
        ]
    }

    fn timestamp_column_row(name: &'static [u8], nullable: &'static [u8]) -> Vec<MockCell> {
        vec![
            MockCell::Bytes(name),
            MockCell::Bytes(b"timestamp"),
            MockCell::Bytes(b"timestamp"),
            MockCell::Bytes(nullable),
            MockCell::Bytes(b""),
            MockCell::Null,
            MockCell::Bytes(b""),
        ]
    }

    const MOCK_DATETIME_FORMAT: &str = "%Y-%m-%d %H:%M:%S";

    fn datetime_cell(text: &str) -> MockCell {
        MockCell::DateTime(MockDateTimeValue(
            civil::DateTime::strptime(MOCK_DATETIME_FORMAT, text)
                .expect("datetime should be valid"),
        ))
    }

    fn primary_key_step() -> MockQueryStep {
        MockQueryStep::with_rows(
            PRIMARY_KEY_QUERY,
            vec![MockColumnDef {
                name: "COLUMN_NAME",
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::NOT_NULL_FLAG,
            }],
            vec![vec![MockCell::Bytes(b"id")]],
        )
    }

    fn open_mock_session(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        port: u16,
    ) -> String {
        let profile_id: String = invoke_tauri_command(
            webview,
            "save_connection",
            json!({ "data": save_input_json(port) }),
        )
        .expect("save_connection IPC should succeed");

        let open_result: OpenConnectionResultDto = invoke_tauri_command(
            webview,
            "open_connection",
            json!({
                "payload": {
                    "profileId": profile_id,
                }
            }),
        )
        .expect("open_connection IPC should succeed");
        open_result.session_id
    }

    fn users_page_payload(session_id: &str, filter_model: serde_json::Value) -> serde_json::Value {
        json!({
            "payload": {
                "connectionId": session_id,
                "tabId": "table-data-tab-1",
                "database": "pi_management",
                "table": "users",
                "page": 1,
                "pageSize": 50,
                "sortColumn": null,
                "sortDirection": null,
                "filterModel": filter_model
            }
        })
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_avoids_empty_string_comparison_for_timestamp_not_blank_filter() {
        let server = MockMySqlServer::start_script(vec![
            column_metadata_step(vec![
                vec![
                    MockCell::Bytes(b"id"),
                    MockCell::Bytes(b"int"),
                    MockCell::Bytes(b"int(11)"),
                    MockCell::Bytes(b"NO"),
                    MockCell::Bytes(b"PRI"),
                    MockCell::Bytes(b""),
                    MockCell::Bytes(b"auto_increment"),
                ],
                timestamp_column_row(b"email_verified_at", b"YES"),
            ]),
            primary_key_step(),
            MockQueryStep::with_rows(
                "SELECT `id`, `email_verified_at` FROM `pi_management`.`users` WHERE `email_verified_at` IS NOT NULL LIMIT 50 OFFSET 0",
                vec![
                    MockColumnDef { name: "id", coltype: ColumnType::MYSQL_TYPE_LONG, colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG },
                    MockColumnDef { name: "email_verified_at", coltype: ColumnType::MYSQL_TYPE_TIMESTAMP, colflags: ColumnFlags::empty() },
                ],
                vec![vec![
                    MockCell::U32(1),
                    datetime_cell("2024-01-01 00:00:00"),
                ]],
            ),
        ])
        .await;

        set_test_pool_factory(None);

        let (_app, webview) = build_app();

        let session_id = open_mock_session(&webview, server.port);

        let response = invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
            &webview,
            "fetch_table_data",
            users_page_payload(
                &session_id,
                json!([
                    {
                        "column": "email_verified_at",
                        "operator": "IS NOT NULL",
                        "value": ""
                    }
                ]),
            ),
        )
        .expect("type-aware timestamp notBlank filter should succeed");

        assert_eq!(response.rows.len(), 1);

        set_test_pool_factory(None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_serializes_timestamp_columns_as_strings() {
        let server = MockMySqlServer::start_script(vec![
            column_metadata_step(vec![
                auto_increment_id_row(),
                timestamp_column_row(b"created_at", b"NO"),
                timestamp_column_row(b"updated_at", b"YES"),
            ]),
            primary_key_step(),
            MockQueryStep::with_rows(
                "SELECT `id`, `created_at`, `updated_at` FROM `pi_management`.`users` LIMIT 50 OFFSET 0",
                vec![
                    MockColumnDef { name: "id", coltype: ColumnType::MYSQL_TYPE_LONG, colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG },
                    MockColumnDef { name: "created_at", coltype: ColumnType::MYSQL_TYPE_TIMESTAMP, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "updated_at", coltype: ColumnType::MYSQL_TYPE_TIMESTAMP, colflags: ColumnFlags::empty() },
                ],
                vec![vec![
                    MockCell::U32(1),
                    datetime_cell("2024-01-01 00:00:00"),
                    datetime_cell("2024-01-02 03:04:05"),
                ]],
            ),
        ])
        .await;

        set_test_pool_factory(None);

        let (_app, webview) = build_app();

        let session_id = open_mock_session(&webview, server.port);

        let response = invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
            &webview,
            "fetch_table_data",
            users_page_payload(&session_id, serde_json::Value::Null),
        )
        .expect("fetch_table_data IPC should succeed");

        assert_eq!(response.rows.len(), 1);
        assert_eq!(
            response.rows[0][1],
            serde_json::json!("2024-01-01 00:00:00")
        );
        assert_eq!(
            response.rows[0][2],
            serde_json::json!("2024-01-02 03:04:05")
        );

        set_test_pool_factory(None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_returns_enum_values_for_enum_columns() {
        let server = MockMySqlServer::start_script(vec![
            column_metadata_step(vec![
                auto_increment_id_row(),
                vec![
                    MockCell::Bytes(b"status"),
                    MockCell::Bytes(b"enum"),
                    MockCell::Bytes(b"enum('active','disabled')"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Bytes(b"active"),
                    MockCell::Bytes(b""),
                ],
            ]),
            primary_key_step(),
            MockQueryStep::with_rows(
                "SELECT `id`, `status` FROM `pi_management`.`users` LIMIT 50 OFFSET 0",
                vec![
                    MockColumnDef {
                        name: "id",
                        coltype: ColumnType::MYSQL_TYPE_LONG,
                        colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "status",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::empty(),
                    },
                ],
                vec![vec![MockCell::U32(1), MockCell::Bytes(b"active")]],
            ),
        ])
        .await;

        set_test_pool_factory(None);

        let (_app, webview) = build_app();

        let session_id = open_mock_session(&webview, server.port);

        let response = invoke_tauri_command::<serde_json::Value>(
            &webview,
            "fetch_table_data",
            users_page_payload(&session_id, serde_json::Value::Null),
        )
        .expect("fetch_table_data IPC should succeed");

        assert_eq!(
            response["columns"][1]["enumValues"],
            serde_json::json!(["active", "disabled"])
        );

        set_test_pool_factory(None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_returns_set_values_for_set_columns() {
        let server = MockMySqlServer::start_script(vec![
            column_metadata_step(vec![
                auto_increment_id_row(),
                vec![
                    MockCell::Bytes(b"flags"),
                    MockCell::Bytes(b"set"),
                    MockCell::Bytes(b"set('alpha','beta','gamma')"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
            ]),
            primary_key_step(),
            MockQueryStep::with_rows(
                "SELECT `id`, `flags` FROM `pi_management`.`users` LIMIT 50 OFFSET 0",
                vec![
                    MockColumnDef {
                        name: "id",
                        coltype: ColumnType::MYSQL_TYPE_LONG,
                        colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "flags",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::empty(),
                    },
                ],
                vec![vec![MockCell::U32(1), MockCell::Bytes(b"alpha,gamma")]],
            ),
        ])
        .await;

        set_test_pool_factory(None);

        let (_app, webview) = build_app();

        let session_id = open_mock_session(&webview, server.port);

        let response = invoke_tauri_command::<serde_json::Value>(
            &webview,
            "fetch_table_data",
            users_page_payload(&session_id, serde_json::Value::Null),
        )
        .expect("fetch_table_data IPC should succeed");

        assert_eq!(
            response["columns"][1]["setValues"],
            serde_json::json!(["alpha", "beta", "gamma"])
        );

        set_test_pool_factory(None);
    }

    const TINYINT_ONE_VALUE_ABOVE_ONE: i8 = 7;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_serializes_boolean_alias_columns_as_integers() {
        let server = MockMySqlServer::start_script(vec![
            column_metadata_step(vec![
                auto_increment_id_row(),
                vec![
                    MockCell::Bytes(b"is_admin"),
                    MockCell::Bytes(b"tinyint"),
                    MockCell::Bytes(b"tinyint(1)"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
            ]),
            primary_key_step(),
            MockQueryStep::with_rows(
                "SELECT `id`, `is_admin` FROM `pi_management`.`users` LIMIT 50 OFFSET 0",
                vec![
                    MockColumnDef {
                        name: "id",
                        coltype: ColumnType::MYSQL_TYPE_LONG,
                        colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "is_admin",
                        coltype: ColumnType::MYSQL_TYPE_TINY,
                        colflags: ColumnFlags::empty(),
                    },
                ],
                vec![
                    vec![MockCell::U32(1), MockCell::I8(1)],
                    vec![MockCell::U32(2), MockCell::I8(TINYINT_ONE_VALUE_ABOVE_ONE)],
                ],
            ),
        ])
        .await;

        set_test_pool_factory(None);

        let (_app, webview) = build_app();

        let session_id = open_mock_session(&webview, server.port);

        let response = invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
            &webview,
            "fetch_table_data",
            users_page_payload(&session_id, serde_json::Value::Null),
        )
        .expect("fetch_table_data IPC should succeed");

        assert_eq!(response.rows.len(), 2);
        assert_eq!(response.rows[0][1], serde_json::json!(1));
        assert_eq!(
            response.rows[1][1],
            serde_json::json!(TINYINT_ONE_VALUE_ABOVE_ONE)
        );

        set_test_pool_factory(None);
    }
}

// ── Cancellation wiring: fetch registers + cleans up the running query ──────────

#[cfg(not(coverage))]
mod fetch_cancellation_integration {
    use super::*;
    use crate::common::blob_step_helpers::connect_mock_pool;
    use crate::common::column_definition_patch::MockColumnOverride;
    use crate::common::mock_mysql_server::{
        MockCell, MockColumnDef, MockMySqlServer, MockQueryStep, MockScript,
    };
    use opensrv_mysql::{ColumnFlags, ColumnType};
    use sqllumen_lib::mysql::pool::TRANSFER_TIME_ZONE_SQL;
    use sqllumen_lib::mysql::table_data::{
        export_table_data_impl, fetch_table_data_impl, ExportTableOptions,
    };
    use std::collections::HashMap;

    const COLUMN_META_SQL: &str = "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION";
    const PK_SQL: &str = "SELECT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY' ORDER BY kcu.ORDINAL_POSITION";

    fn varchar(name: &'static str, flags: ColumnFlags) -> MockColumnDef {
        MockColumnDef {
            name,
            coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
            colflags: flags,
        }
    }

    fn users_column_metadata_step() -> MockQueryStep {
        MockQueryStep {
            query: COLUMN_META_SQL,
            columns: vec![
                varchar("COLUMN_NAME", ColumnFlags::NOT_NULL_FLAG),
                varchar("DATA_TYPE", ColumnFlags::NOT_NULL_FLAG),
                varchar("COLUMN_TYPE", ColumnFlags::NOT_NULL_FLAG),
                varchar("IS_NULLABLE", ColumnFlags::NOT_NULL_FLAG),
                varchar("COLUMN_KEY", ColumnFlags::empty()),
                varchar("COLUMN_DEFAULT", ColumnFlags::empty()),
                varchar("EXTRA", ColumnFlags::NOT_NULL_FLAG),
            ],
            rows: vec![
                vec![
                    MockCell::Bytes(b"id"),
                    MockCell::Bytes(b"int"),
                    MockCell::Bytes(b"int(11)"),
                    MockCell::Bytes(b"NO"),
                    MockCell::Bytes(b"PRI"),
                    MockCell::Null,
                    MockCell::Bytes(b"auto_increment"),
                ],
                vec![
                    MockCell::Bytes(b"name"),
                    MockCell::Bytes(b"varchar"),
                    MockCell::Bytes(b"varchar(255)"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
            ],
            error: None,
            affected_rows: None,
        }
    }

    fn users_primary_key_step() -> MockQueryStep {
        MockQueryStep {
            query: PK_SQL,
            columns: vec![varchar("COLUMN_NAME", ColumnFlags::NOT_NULL_FLAG)],
            rows: vec![vec![MockCell::Bytes(b"id")]],
            error: None,
            affected_rows: None,
        }
    }

    fn users_page_step() -> MockQueryStep {
        MockQueryStep {
            query: "SELECT `id`, `name` FROM `app_db`.`users` LIMIT 50 OFFSET 0",
            columns: vec![
                MockColumnDef {
                    name: "id",
                    coltype: ColumnType::MYSQL_TYPE_LONG,
                    colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG,
                },
                varchar("name", ColumnFlags::empty()),
            ],
            rows: vec![vec![MockCell::U32(1), MockCell::Bytes(b"alice")]],
            error: None,
            affected_rows: None,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_unregisters_running_query_on_success() {
        let server = MockMySqlServer::start_script(vec![
            users_column_metadata_step(),
            users_primary_key_step(),
            users_page_step(),
        ])
        .await;

        let pool = connect_mock_pool(&server).await;
        let metadata_cache = MetadataCache::new();
        let running_queries = tokio::sync::RwLock::new(HashMap::new());

        let result = fetch_table_data_impl(
            &sqllumen_lib::mysql::table_data::TableDataContext {
                pool: &pool,
                connection_id: "conn-1",
                metadata_cache: &metadata_cache,
            },
            &running_queries,
            &sqllumen_lib::mysql::table_data::TableDataPageQuery {
                tab_id: "tab-1".to_string(),
                database: "app_db".to_string(),
                table: "users".to_string(),
                page: 1,
                page_size: 50,
                sort: None,
                filter_model: vec![],
            },
        )
        .await
        .expect("fetch should succeed");

        pool.disconnect().await.expect("pool disconnects");

        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0][0], serde_json::json!(1));
        assert_eq!(result.rows[0][1], serde_json::json!("alice"));

        // The running-query entry registered during the data query must be
        // removed once the fetch completes (no leak that would shadow a later
        // cancel target for this tab).
        assert!(
            running_queries.read().await.is_empty(),
            "running_queries must be cleaned up after a successful fetch"
        );
    }

    fn flags_column_metadata_step() -> MockQueryStep {
        MockQueryStep {
            query: COLUMN_META_SQL,
            columns: users_column_metadata_step().columns,
            rows: vec![vec![
                MockCell::Bytes(b"flag"),
                MockCell::Bytes(b"tinyint"),
                MockCell::Bytes(b"tinyint(1)"),
                MockCell::Bytes(b"YES"),
                MockCell::Bytes(b""),
                MockCell::Null,
                MockCell::Bytes(b""),
            ]],
            error: None,
            affected_rows: None,
        }
    }

    fn tinyint_flag_column() -> MockColumnDef {
        MockColumnDef {
            name: "flag",
            coltype: ColumnType::MYSQL_TYPE_TINY,
            colflags: ColumnFlags::empty(),
        }
    }

    fn flags_page_step() -> MockQueryStep {
        MockQueryStep::with_rows(
            "SELECT `flag` FROM `app_db`.`flags` LIMIT 50 OFFSET 0",
            vec![tinyint_flag_column()],
            vec![vec![MockCell::I8(7)]],
        )
    }

    fn flags_export_step() -> MockQueryStep {
        MockQueryStep::with_rows(
            "SELECT * FROM `app_db`.`flags`",
            vec![tinyint_flag_column()],
            vec![vec![MockCell::I8(7)]],
        )
    }

    fn flags_page_query() -> sqllumen_lib::mysql::table_data::TableDataPageQuery {
        sqllumen_lib::mysql::table_data::TableDataPageQuery {
            tab_id: "tab-1".to_string(),
            database: "app_db".to_string(),
            table: "flags".to_string(),
            page: 1,
            page_size: 50,
            sort: None,
            filter_model: vec![],
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn grid_shows_a_tinyint_one_value_of_seven_and_keeps_server_session_defaults() {
        let server =
            MockMySqlServer::start_script(vec![flags_column_metadata_step(), flags_page_step()])
                .await;
        let pool = connect_mock_pool(&server).await;
        let metadata_cache = MetadataCache::new();
        let running_queries = tokio::sync::RwLock::new(HashMap::new());
        let context = sqllumen_lib::mysql::table_data::TableDataContext {
            pool: &pool,
            connection_id: "conn-1",
            metadata_cache: &metadata_cache,
        };

        let result = fetch_table_data_impl(&context, &running_queries, &flags_page_query())
            .await
            .expect("fetch should succeed");
        pool.disconnect().await.expect("pool disconnects");

        assert_eq!(result.rows[0][0], serde_json::json!(7));
        let session_changes: Vec<_> = server
            .recorded_queries()
            .into_iter()
            .filter(|query| query.sql.to_ascii_lowercase().contains("time_zone"))
            .collect();
        assert!(session_changes.is_empty(), "{session_changes:?}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn table_export_writes_a_tinyint_one_value_of_seven() {
        let server =
            MockMySqlServer::start_script(vec![flags_column_metadata_step(), flags_export_step()])
                .await;
        let pool = connect_mock_pool(&server).await;
        let metadata_cache = MetadataCache::new();
        let context = sqllumen_lib::mysql::table_data::TableDataContext {
            pool: &pool,
            connection_id: "conn-1",
            metadata_cache: &metadata_cache,
        };
        let dir = tempfile::tempdir().expect("temp dir");
        let file_path = dir.path().join("flags.json");
        let options = ExportTableOptions {
            database: "app_db".to_string(),
            table: "flags".to_string(),
            format: "json".to_string(),
            file_path: file_path.to_string_lossy().into_owned(),
            include_headers: true,
            table_name_for_sql: String::new(),
            filter_model: vec![],
            sort: None,
            page: None,
            page_size: None,
        };

        export_table_data_impl(&context, &options)
            .await
            .expect("export should succeed");
        pool.disconnect().await.expect("pool disconnects");

        let exported: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&file_path).expect("export file"))
                .expect("export is JSON");
        assert_eq!(exported, serde_json::json!([{ "flag": 7 }]));
        let session_changes = server
            .recorded_queries()
            .into_iter()
            .filter(|query| query.sql.to_ascii_lowercase().contains("time_zone"))
            .count();
        assert_eq!(session_changes, 0);
    }

    const FLAGS_EXPORT_SQL: &str = "SELECT * FROM `app_db`.`flags`";
    const UTC_HEADER: &str =
        "/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;\n/*!40103 SET TIME_ZONE='+00:00' */;\n";
    const TIME_ZONE_RESTORE_FOOTER: &str = "/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;\n";
    const UTF8MB4_BIN_CHARACTER_SET: u16 = 46;

    fn flags_export_options(format: &str, file_path: &std::path::Path) -> ExportTableOptions {
        ExportTableOptions {
            database: "app_db".to_string(),
            table: "flags".to_string(),
            format: format.to_string(),
            file_path: file_path.to_string_lossy().into_owned(),
            include_headers: true,
            table_name_for_sql: String::new(),
            filter_model: vec![],
            sort: None,
            page: None,
            page_size: None,
        }
    }

    async fn export_flags(
        server: &MockMySqlServer,
        options: &ExportTableOptions,
    ) -> Result<(), String> {
        let pool = connect_mock_pool(server).await;
        let metadata_cache = MetadataCache::new();
        let context = sqllumen_lib::mysql::table_data::TableDataContext {
            pool: &pool,
            connection_id: "conn-1",
            metadata_cache: &metadata_cache,
        };
        let exported = export_table_data_impl(&context, options).await;
        pool.disconnect().await.expect("pool disconnects");
        exported
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn sql_insert_export_runs_in_utc_and_brackets_rows_with_the_time_zone_lines() {
        let server =
            MockMySqlServer::start_script(vec![flags_column_metadata_step(), flags_export_step()])
                .await;
        let dir = tempfile::tempdir().expect("temp dir");
        let file_path = dir.path().join("flags.sql");

        export_flags(&server, &flags_export_options("sql", &file_path))
            .await
            .expect("export should succeed");

        let exported = std::fs::read_to_string(&file_path).expect("export file");
        assert!(exported.starts_with(UTC_HEADER), "{exported}");
        assert!(exported.ends_with(TIME_ZONE_RESTORE_FOOTER), "{exported}");
        let export_connection = server
            .connection_that_sent(FLAGS_EXPORT_SQL)
            .expect("the export query was sent");
        let statements: Vec<String> = server
            .queries_on_connection(export_connection)
            .into_iter()
            .map(|query| query.sql)
            .collect();
        let time_zone_position = statements
            .iter()
            .position(|sql| sql == TRANSFER_TIME_ZONE_SQL)
            .expect("the export connection switches to UTC");
        let export_position = statements
            .iter()
            .position(|sql| sql == FLAGS_EXPORT_SQL)
            .expect("the export query is on that connection");
        assert!(time_zone_position < export_position, "{statements:?}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn csv_export_keeps_the_server_time_zone_and_writes_no_time_zone_lines() {
        let server =
            MockMySqlServer::start_script(vec![flags_column_metadata_step(), flags_export_step()])
                .await;
        let dir = tempfile::tempdir().expect("temp dir");
        let file_path = dir.path().join("flags.csv");

        export_flags(&server, &flags_export_options("csv", &file_path))
            .await
            .expect("export should succeed");

        let exported = std::fs::read_to_string(&file_path).expect("export file");
        assert!(!exported.contains("TIME_ZONE"), "{exported}");
        let utc_switches = server
            .recorded_queries()
            .into_iter()
            .filter(|query| query.sql == TRANSFER_TIME_ZONE_SQL)
            .count();
        assert_eq!(utc_switches, 0);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn export_into_a_missing_directory_fails_before_the_query_is_sent() {
        let server =
            MockMySqlServer::start_script(vec![flags_column_metadata_step(), flags_export_step()])
                .await;
        let dir = tempfile::tempdir().expect("temp dir");
        let file_path = dir.path().join("missing").join("flags.csv");

        let error = export_flags(&server, &flags_export_options("csv", &file_path))
            .await
            .expect_err("the temp file cannot be created");

        assert!(error.contains("Failed to create file"), "{error}");
        assert_eq!(server.connection_that_sent(FLAGS_EXPORT_SQL), None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn grid_shows_a_bin_collated_text_column_as_text() {
        let column_overrides = HashMap::from([(
            "name",
            MockColumnOverride {
                character_set: Some(UTF8MB4_BIN_CHARACTER_SET),
                decimals: None,
            },
        )]);
        let mut page_step = users_page_step();
        page_step.columns[1] = varchar("name", ColumnFlags::BINARY_FLAG);
        let script = MockScript {
            steps: vec![
                users_column_metadata_step(),
                users_primary_key_step(),
                page_step,
            ],
            column_overrides,
            ..MockScript::default()
        };
        let server = MockMySqlServer::start_with(script).await;
        let pool = connect_mock_pool(&server).await;
        let metadata_cache = MetadataCache::new();
        let running_queries = tokio::sync::RwLock::new(HashMap::new());
        let context = sqllumen_lib::mysql::table_data::TableDataContext {
            pool: &pool,
            connection_id: "conn-1",
            metadata_cache: &metadata_cache,
        };
        let users_page = sqllumen_lib::mysql::table_data::TableDataPageQuery {
            table: "users".to_string(),
            ..flags_page_query()
        };

        let result = fetch_table_data_impl(&context, &running_queries, &users_page)
            .await
            .expect("fetch should succeed");
        pool.disconnect().await.expect("pool disconnects");

        assert_eq!(result.rows[0][1], serde_json::json!("alice"));
    }
}

#[cfg(coverage)]
mod command_wrapper_coverage {
    use super::*;
    use serde::de::DeserializeOwned;
    use serde_json::json;
    use sqllumen_lib::commands::table_data as table_data_commands;
    use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
    use sqllumen_lib::mysql::table_data::{PrimaryKeyInfo, TableDataColumnMeta, TableDataResponse};
    use sqllumen_lib::state::AppState;
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tokio_util::sync::CancellationToken;

    fn dummy_pool() -> sqllumen_lib::mysql::pool::BackgroundPool {
        crate::common::mock_session::unreachable_pool()
    }

    fn register_connection(state: &AppState, connection_id: &str, read_only: bool) {
        state.registry.insert(
            connection_id.to_string(),
            RegistryEntry {
                pool: dummy_pool(),
                session_id: connection_id.to_string(),
                profile_id: connection_id.to_string(),
                status: ConnectionStatus::Connected,
                server_version: "8.0.0".to_string(),
                cancellation_token: CancellationToken::new(),
                connection_params: StoredConnectionParams {
                    profile_id: connection_id.to_string(),
                    host: "127.0.0.1".to_string(),
                    port: 13306,
                    username: "dummy".to_string(),
                    has_password: false,
                    keychain_ref: None,
                    default_database: Some("test_db".to_string()),
                    ssl: SslSettings::default(),
                    connect_timeout_secs: 10,
                    keepalive_interval_secs: 0,
                    session_password: None,
                },
                read_only,
            },
        );
    }

    fn build_app(state: AppState) -> tauri::WebviewWindow<tauri::test::MockRuntime> {
        let app = mock_builder()
            .manage(state)
            .invoke_handler(tauri::generate_handler![
                fetch_table_data,
                fetch_table_page,
                update_table_row,
                insert_table_row,
                delete_table_row,
                export_table_data
            ])
            .build(mock_context(noop_assets()))
            .expect("should build app");

        tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("should build test webview")
    }

    fn invoke_tauri_command<T: DeserializeOwned>(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        cmd: &str,
        body: serde_json::Value,
    ) -> Result<T, serde_json::Value> {
        let url = if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        };

        get_ipc_response(
            webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: url.parse().expect("test URL should parse"),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|response| {
            response
                .deserialize::<T>()
                .expect("IPC response should deserialize")
        })
    }

    #[tauri::command]
    async fn fetch_table_data(
        state: tauri::State<'_, AppState>,
        payload: sqllumen_lib::mysql::table_data::FetchTableDataRequest,
    ) -> Result<sqllumen_lib::mysql::table_data::TableDataResponse, String> {
        table_data_commands::fetch_table_data(state, payload).await
    }

    #[tauri::command]
    async fn fetch_table_page(
        state: tauri::State<'_, AppState>,
        payload: sqllumen_lib::mysql::table_data::FetchTableDataRequest,
    ) -> Result<sqllumen_lib::mysql::table_data::TablePageResult, String> {
        table_data_commands::fetch_table_page(state, payload).await
    }

    #[tauri::command]
    async fn update_table_row(
        state: tauri::State<'_, AppState>,
        payload: sqllumen_lib::mysql::table_data::UpdateTableRowRequest,
    ) -> Result<(), String> {
        table_data_commands::update_table_row(state, payload).await
    }

    #[tauri::command]
    async fn insert_table_row(
        state: tauri::State<'_, AppState>,
        payload: sqllumen_lib::mysql::table_data::InsertTableRowRequest,
    ) -> Result<Vec<(String, serde_json::Value)>, String> {
        table_data_commands::insert_table_row(state, payload).await
    }

    #[tauri::command]
    async fn delete_table_row(
        state: tauri::State<'_, AppState>,
        payload: sqllumen_lib::mysql::table_data::DeleteTableRowRequest,
    ) -> Result<(), String> {
        table_data_commands::delete_table_row(state, payload).await
    }

    #[tauri::command]
    async fn export_table_data(
        state: tauri::State<'_, AppState>,
        payload: sqllumen_lib::mysql::table_data::ExportTableDataRequest,
    ) -> Result<(), String> {
        table_data_commands::export_table_data(state, payload).await
    }

    #[tokio::test]
    async fn fetch_table_data_wrapper_validates_inputs_and_uses_stubbed_impl() {
        let state = common::test_app_state();
        register_connection(&state, "conn-1", false);
        let webview = build_app(state);

        let zero_page_size_err =
            invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
                &webview,
                "fetch_table_data",
                json!({
                    "payload": {
                        "connectionId": "conn-1",
                        "tabId": "table-data-tab-1",
                        "database": "test_db",
                        "table": "users",
                        "page": 1,
                        "pageSize": 0,
                        "sortColumn": null,
                        "sortDirection": null,
                        "filterModel": null
                    }
                }),
            )
            .expect_err("page size zero should error");
        assert!(zero_page_size_err
            .to_string()
            .contains("page_size must be at least 1"));

        let missing_connection_err =
            invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
                &webview,
                "fetch_table_data",
                json!({
                    "payload": {
                        "connectionId": "missing",
                        "tabId": "table-data-tab-1",
                        "database": "test_db",
                        "table": "users",
                        "page": 1,
                        "pageSize": 50,
                        "sortColumn": null,
                        "sortDirection": null,
                        "filterModel": null
                    }
                }),
            )
            .expect_err("missing connection should error");
        assert!(missing_connection_err.to_string().contains("not found"));

        let response = invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
            &webview,
            "fetch_table_data",
            json!({
                "payload": {
                    "connectionId": "conn-1",
                    "tabId": "table-data-tab-1",
                    "database": "test_db",
                    "table": "users",
                    "page": 2,
                    "pageSize": 25,
                    "sortColumn": "name",
                    "sortDirection": "asc",
                    "filterModel": [
                        {
                            "column": "name",
                            "operator": "LIKE",
                            "value": "%ali%"
                        }
                    ]
                }
            }),
        )
        .expect("fetch should succeed");

        assert_eq!(response.current_page, 2);
        assert_eq!(response.page_size, 25);
        assert!(response.rows.is_empty());
    }

    #[tokio::test]
    async fn update_table_row_wrapper_enforces_read_only_and_missing_connection_checks() {
        let read_only_state = common::test_app_state();
        register_connection(&read_only_state, "conn-ro", true);
        let read_only_webview = build_app(read_only_state);

        let read_only_err = invoke_tauri_command::<()>(
            &read_only_webview,
            "update_table_row",
            json!({ "payload": {
                "connectionId": "conn-ro",
                "database": "test_db",
                "table": "users",
                "primaryKeyColumns": ["id"],
                "originalPrimaryKeyValues": { "id": 1 },
                "updatedValues": { "name": "Alice" }
            } }),
        )
        .expect_err("read-only connection should error");
        assert!(read_only_err.to_string().contains("read-only"));

        let state = common::test_app_state();
        let webview = build_app(state);
        let missing_err = invoke_tauri_command::<()>(
            &webview,
            "update_table_row",
            json!({ "payload": {
                "connectionId": "missing",
                "database": "test_db",
                "table": "users",
                "primaryKeyColumns": ["id"],
                "originalPrimaryKeyValues": { "id": 1 },
                "updatedValues": { "name": "Alice" }
            } }),
        )
        .expect_err("missing connection should error");
        assert!(missing_err.to_string().contains("not found"));
    }

    #[tokio::test]
    async fn mutating_table_data_wrappers_succeed_with_registered_writable_connection() {
        let state = common::test_app_state();
        register_connection(&state, "conn-1", false);
        let webview = build_app(state);

        invoke_tauri_command::<()>(
            &webview,
            "update_table_row",
            json!({ "payload": {
                "connectionId": "conn-1",
                "database": "test_db",
                "table": "users",
                "primaryKeyColumns": ["id"],
                "originalPrimaryKeyValues": { "id": 1 },
                "updatedValues": { "name": "Updated" }
            } }),
        )
        .expect("update should succeed");

        let inserted = invoke_tauri_command::<Vec<(String, serde_json::Value)>>(
            &webview,
            "insert_table_row",
            json!({ "payload": {
                "connectionId": "conn-1",
                "database": "test_db",
                "table": "users",
                "values": { "name": "New User" },
                "primaryKeyInfo": {
                    "keyColumns": ["id"],
                    "hasAutoIncrement": true,
                    "isUniqueKeyFallback": false
                }
            } }),
        )
        .expect("insert should succeed");
        assert!(inserted.is_empty());

        invoke_tauri_command::<()>(
            &webview,
            "delete_table_row",
            json!({ "payload": {
                "connectionId": "conn-1",
                "database": "test_db",
                "table": "users",
                "primaryKeyColumns": ["id"],
                "primaryKeyValues": { "id": 1 }
            } }),
        )
        .expect("delete should succeed");

        invoke_tauri_command::<()>(
            &webview,
            "export_table_data",
            json!({
                "payload": {
                    "connectionId": "conn-1",
                    "database": "test_db",
                    "table": "users",
                    "format": "csv",
                    "filePath": "ignored.csv",
                    "includeHeaders": true,
                    "tableNameForSql": "users",
                    "filterModel": [
                        {
                            "column": "name",
                            "operator": "LIKE",
                            "value": "A%"
                        }
                    ],
                    "sortColumn": "id",
                    "sortDirection": "desc"
                }
            }),
        )
        .expect("export should succeed");
    }

    fn sample_cached_response(id: i64) -> TableDataResponse {
        TableDataResponse {
            columns: vec![
                TableDataColumnMeta {
                    name: "id".to_string(),
                    data_type: "BIGINT".to_string(),
                    is_boolean_alias: false,
                    enum_values: None,
                    set_values: None,
                    is_nullable: false,
                    is_primary_key: true,
                    is_unique_key: true,
                    has_default: false,
                    column_default: None,
                    is_binary: false,
                    is_auto_increment: true,
                    is_generated: false,
                },
                TableDataColumnMeta {
                    name: "name".to_string(),
                    data_type: "VARCHAR".to_string(),
                    is_boolean_alias: false,
                    enum_values: None,
                    set_values: None,
                    is_nullable: false,
                    is_primary_key: false,
                    is_unique_key: false,
                    has_default: false,
                    column_default: None,
                    is_binary: false,
                    is_auto_increment: false,
                    is_generated: false,
                },
            ],
            rows: std::sync::Arc::new(vec![std::sync::Arc::from(vec![
                serde_json::json!(id),
                serde_json::json!("Alice"),
            ])]),
            current_page: 1,
            page_size: 50,
            primary_key: Some(PrimaryKeyInfo {
                key_columns: vec!["id".to_string()],
                has_auto_increment: true,
                is_unique_key_fallback: false,
            }),
            execution_time_ms: 12,
        }
    }

    async fn wait_for_history_logging() {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    #[tokio::test]
    async fn fetch_table_page_stores_the_page_as_a_table_page_slot() {
        let state = common::test_app_state();
        let result_cache = std::sync::Arc::clone(&state.result_cache);
        register_connection(&state, "page-conn", false);
        let webview = build_app(state);

        let page = invoke_tauri_command::<serde_json::Value>(
            &webview,
            "fetch_table_page",
            json!({
                "payload": {
                    "connectionId": "page-conn",
                    "tabId": "table-data-tab-1",
                    "database": "test_db",
                    "table": "users",
                    "page": 2,
                    "pageSize": 50,
                    "sortColumn": null,
                    "sortDirection": null,
                    "filterModel": null
                }
            }),
        )
        .expect("fetch_table_page should succeed");

        assert_eq!(page["currentPage"], 2);
        assert_eq!(page["pageSize"], 50);
        assert_eq!(page["viewVersion"], 1);
        let entry = result_cache
            .get("page-conn", "table-data-tab-1")
            .into_entry()
            .expect("the table page should be stored as a result slot");
        assert_eq!(page["queryId"], entry.value[0].query_id.as_str());
        assert_eq!(
            entry.value[0].origin,
            sqllumen_lib::mysql::query_executor::StoredResultOrigin::TablePage
        );
    }

    #[tokio::test]
    async fn fetch_table_data_logs_history_on_success() {
        let state = common::test_app_state();
        let db = std::sync::Arc::clone(&state.db);
        register_connection(&state, "hist-conn", false);
        let webview = build_app(state);

        let _response = invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
            &webview,
            "fetch_table_data",
            json!({
                "payload": {
                    "connectionId": "hist-conn",
                    "tabId": "table-data-tab-1",
                    "database": "test_db",
                    "table": "users",
                    "page": 1,
                    "pageSize": 50,
                    "sortColumn": null,
                    "sortDirection": null,
                    "filterModel": null
                }
            }),
        )
        .expect("fetch should succeed");

        wait_for_history_logging().await;

        // Verify history was logged
        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(
            &conn,
            &sqllumen_lib::db::history::HistoryQuery {
                connection_id: "hist-conn",
                page: 1,
                page_size: 50,
                search: None,
                since: None,
            },
        )
        .expect("list history");
        assert_eq!(page.total, 1, "one history entry should be logged");
        let entry = &page.entries[0];
        assert!(entry.success);
        assert!(entry.sql_text.contains("SELECT * FROM"));
        assert!(entry.sql_text.contains("test_db"));
        assert!(entry.sql_text.contains("users"));
        assert!(entry.sql_text.contains("LIMIT 50 OFFSET 0"));
        assert_eq!(entry.database_name.as_deref(), Some("test_db"));
        assert_eq!(entry.row_count, None);
        assert_eq!(entry.affected_rows, None);
    }

    #[tokio::test]
    async fn fetch_table_data_logs_history_with_sort_and_filter() {
        let state = common::test_app_state();
        let db = std::sync::Arc::clone(&state.db);
        register_connection(&state, "hist-sf", false);
        let webview = build_app(state);

        let _response = invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
            &webview,
            "fetch_table_data",
            json!({
                "payload": {
                    "connectionId": "hist-sf",
                    "tabId": "table-data-tab-1",
                    "database": "mydb",
                    "table": "products",
                    "page": 2,
                    "pageSize": 25,
                    "sortColumn": "name",
                    "sortDirection": "desc",
                    "filterModel": [
                        {
                            "column": "name",
                            "operator": "LIKE",
                            "value": "%widget%"
                        }
                    ]
                }
            }),
        )
        .expect("fetch should succeed");

        wait_for_history_logging().await;

        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(
            &conn,
            &sqllumen_lib::db::history::HistoryQuery {
                connection_id: "hist-sf",
                page: 1,
                page_size: 50,
                search: None,
                since: None,
            },
        )
        .expect("list history");
        assert_eq!(page.total, 1);
        let entry = &page.entries[0];
        assert!(entry.success);
        // Verify SQL contains sort, filter, and pagination
        assert!(entry.sql_text.contains("ORDER BY"));
        assert!(entry.sql_text.contains("DESC"));
        assert!(entry.sql_text.contains("LIMIT 25 OFFSET 25"));
        assert!(entry.sql_text.contains("WHERE"));
        // Verify filter value is interpolated (not raw ?)
        assert!(
            !entry.sql_text.contains(" ? "),
            "History SQL should not contain raw ? placeholders, got: {}",
            entry.sql_text
        );
        assert!(
            entry.sql_text.contains("'%widget%'"),
            "History SQL should contain interpolated filter value, got: {}",
            entry.sql_text
        );
    }

    #[tokio::test]
    async fn fetch_table_data_logs_history_with_raw_sql_fallback_for_invalid_identifiers() {
        let state = common::test_app_state();
        let db = std::sync::Arc::clone(&state.db);
        register_connection(&state, "hist-fallback", false);
        let webview = build_app(state);
        let invalid_database = "d".repeat(65);

        let _response = invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
            &webview,
            "fetch_table_data",
            json!({
                "payload": {
                    "connectionId": "hist-fallback",
                    "tabId": "table-data-tab-1",
                    "database": invalid_database,
                    "table": "users",
                    "page": 1,
                    "pageSize": 10,
                    "sortColumn": null,
                    "sortDirection": null,
                    "filterModel": null
                }
            }),
        )
        .expect("fetch should still succeed via coverage stub");

        wait_for_history_logging().await;

        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(
            &conn,
            &sqllumen_lib::db::history::HistoryQuery {
                connection_id: "hist-fallback",
                page: 1,
                page_size: 50,
                search: None,
                since: None,
            },
        )
        .expect("list history");
        assert_eq!(page.total, 1);

        let entry = &page.entries[0];
        assert!(entry.success);
        assert!(
            entry.sql_text.starts_with("SELECT * FROM `"),
            "fallback should still log a SELECT statement, got: {}",
            entry.sql_text
        );
        assert!(
            entry.sql_text.contains(&invalid_database),
            "fallback SQL should include the original identifier text, got: {}",
            entry.sql_text
        );
        assert!(entry.sql_text.contains("LIMIT 10 OFFSET 0"));
    }

    #[tokio::test]
    async fn fetch_table_data_logs_history_on_missing_connection() {
        let state = common::test_app_state();
        let db = std::sync::Arc::clone(&state.db);
        // Don't register any connection
        let webview = build_app(state);

        let _err = invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
            &webview,
            "fetch_table_data",
            json!({
                "payload": {
                    "connectionId": "missing-conn",
                    "tabId": "table-data-tab-1",
                    "database": "test_db",
                    "table": "users",
                    "page": 1,
                    "pageSize": 50,
                    "sortColumn": null,
                    "sortDirection": null,
                    "filterModel": null
                }
            }),
        )
        .expect_err("should fail for missing connection");

        wait_for_history_logging().await;

        // fetch_table_data returns early before logging when connection is not found
        // (the pool lookup fails before the impl call), so we expect NO history entry
        // since the error path logs with the session_id fallback
        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(
            &conn,
            &sqllumen_lib::db::history::HistoryQuery {
                connection_id: "missing-conn",
                page: 1,
                page_size: 50,
                search: None,
                since: None,
            },
        )
        .expect("list history");
        // No history logged because the error happens before the impl call
        // and the wrapper returns Err before reaching the history logging code
        assert_eq!(
            page.total, 0,
            "no history entry when connection not found (early return)"
        );
    }

    #[tokio::test]
    async fn export_table_data_logs_history_on_success() {
        let state = common::test_app_state();
        let db = std::sync::Arc::clone(&state.db);
        register_connection(&state, "hist-export", false);
        let webview = build_app(state);

        invoke_tauri_command::<()>(
            &webview,
            "export_table_data",
            json!({
                "payload": {
                    "connectionId": "hist-export",
                    "database": "test_db",
                    "table": "orders",
                    "format": "csv",
                    "filePath": "ignored.csv",
                    "includeHeaders": true,
                    "tableNameForSql": "orders",
                    "filterModel": null,
                    "sortColumn": null,
                    "sortDirection": null
                }
            }),
        )
        .expect("export should succeed");

        wait_for_history_logging().await;

        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(
            &conn,
            &sqllumen_lib::db::history::HistoryQuery {
                connection_id: "hist-export",
                page: 1,
                page_size: 50,
                search: None,
                since: None,
            },
        )
        .expect("list history");
        assert_eq!(
            page.total, 1,
            "one history entry should be logged for export"
        );
        let entry = &page.entries[0];
        assert!(entry.success);
        assert!(entry.sql_text.contains("SELECT * FROM"));
        assert!(entry.sql_text.contains("orders"));
        // Export has no LIMIT
        assert!(!entry.sql_text.contains("LIMIT"));
        assert_eq!(entry.database_name.as_deref(), Some("test_db"));
    }

    #[tokio::test]
    async fn export_table_data_logs_history_with_sort_and_filter() {
        let state = common::test_app_state();
        let db = std::sync::Arc::clone(&state.db);
        register_connection(&state, "hist-export-sf", false);
        let webview = build_app(state);

        invoke_tauri_command::<()>(
            &webview,
            "export_table_data",
            json!({
                "payload": {
                    "connectionId": "hist-export-sf",
                    "database": "test_db",
                    "table": "items",
                    "format": "json",
                    "filePath": "ignored.json",
                    "includeHeaders": false,
                    "tableNameForSql": "items",
                    "filterModel": [
                        {
                            "column": "price",
                            "operator": ">",
                            "value": "100"
                        }
                    ],
                    "sortColumn": "price",
                    "sortDirection": "asc"
                }
            }),
        )
        .expect("export should succeed");

        wait_for_history_logging().await;

        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(
            &conn,
            &sqllumen_lib::db::history::HistoryQuery {
                connection_id: "hist-export-sf",
                page: 1,
                page_size: 50,
                search: None,
                since: None,
            },
        )
        .expect("list history");
        assert_eq!(page.total, 1);
        let entry = &page.entries[0];
        assert!(entry.success);
        assert!(entry.sql_text.contains("WHERE"));
        assert!(entry.sql_text.contains("ORDER BY"));
        assert!(entry.sql_text.contains("ASC"));
        // Verify filter value is interpolated
        assert!(
            entry.sql_text.contains("'100'"),
            "Export history SQL should contain interpolated filter value, got: {}",
            entry.sql_text
        );
        assert!(
            !entry.sql_text.contains("?"),
            "Export history SQL should not contain raw ? placeholders, got: {}",
            entry.sql_text
        );
    }

    #[tokio::test]
    async fn update_table_row_logs_history_with_interpolated_values() {
        let state = common::test_app_state();
        let db = std::sync::Arc::clone(&state.db);
        register_connection(&state, "hist-update", false);
        let webview = build_app(state);

        invoke_tauri_command::<()>(
            &webview,
            "update_table_row",
            json!({ "payload": {
                "connectionId": "hist-update",
                "database": "test_db",
                "table": "users",
                "primaryKeyColumns": ["id"],
                "originalPrimaryKeyValues": { "id": 1 },
                "updatedValues": { "name": "Alice" }
            } }),
        )
        .expect("update should succeed");

        wait_for_history_logging().await;

        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(
            &conn,
            &sqllumen_lib::db::history::HistoryQuery {
                connection_id: "hist-update",
                page: 1,
                page_size: 50,
                search: None,
                since: None,
            },
        )
        .expect("list history");
        assert_eq!(page.total, 1);
        let entry = &page.entries[0];
        assert!(entry.success);
        assert!(entry.sql_text.contains("UPDATE"));
        assert!(
            entry.sql_text.contains("'Alice'"),
            "Update history SQL should contain interpolated value 'Alice', got: {}",
            entry.sql_text
        );
        assert!(
            entry.sql_text.contains("1"),
            "Update history SQL should contain PK value 1, got: {}",
            entry.sql_text
        );
        assert!(
            !entry.sql_text.contains("?"),
            "Update history SQL should not contain raw ? placeholders, got: {}",
            entry.sql_text
        );
    }

    #[tokio::test]
    async fn insert_table_row_logs_history_with_interpolated_values() {
        let state = common::test_app_state();
        let db = std::sync::Arc::clone(&state.db);
        register_connection(&state, "hist-insert", false);
        let webview = build_app(state);

        invoke_tauri_command::<Vec<(String, serde_json::Value)>>(
            &webview,
            "insert_table_row",
            json!({ "payload": {
                "connectionId": "hist-insert",
                "database": "test_db",
                "table": "users",
                "values": { "name": "Bob", "age": 30 },
                "primaryKeyInfo": {
                    "keyColumns": ["id"],
                    "hasAutoIncrement": true,
                    "isUniqueKeyFallback": false
                }
            } }),
        )
        .expect("insert should succeed");

        wait_for_history_logging().await;

        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(
            &conn,
            &sqllumen_lib::db::history::HistoryQuery {
                connection_id: "hist-insert",
                page: 1,
                page_size: 50,
                search: None,
                since: None,
            },
        )
        .expect("list history");
        assert_eq!(page.total, 1);
        let entry = &page.entries[0];
        assert!(entry.success);
        assert!(entry.sql_text.contains("INSERT INTO"));
        assert!(
            entry.sql_text.contains("30"),
            "Insert history SQL should contain interpolated value 30, got: {}",
            entry.sql_text
        );
        assert!(
            entry.sql_text.contains("'Bob'"),
            "Insert history SQL should contain interpolated value 'Bob', got: {}",
            entry.sql_text
        );
        assert!(
            !entry.sql_text.contains("?"),
            "Insert history SQL should not contain raw ? placeholders, got: {}",
            entry.sql_text
        );
    }

    #[tokio::test]
    async fn delete_table_row_logs_history_with_interpolated_values() {
        let state = common::test_app_state();
        let db = std::sync::Arc::clone(&state.db);
        register_connection(&state, "hist-delete", false);
        let webview = build_app(state);

        invoke_tauri_command::<()>(
            &webview,
            "delete_table_row",
            json!({ "payload": {
                "connectionId": "hist-delete",
                "database": "test_db",
                "table": "users",
                "primaryKeyColumns": ["id"],
                "primaryKeyValues": { "id": 42 }
            } }),
        )
        .expect("delete should succeed");

        wait_for_history_logging().await;

        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(
            &conn,
            &sqllumen_lib::db::history::HistoryQuery {
                connection_id: "hist-delete",
                page: 1,
                page_size: 50,
                search: None,
                since: None,
            },
        )
        .expect("list history");
        assert_eq!(page.total, 1);
        let entry = &page.entries[0];
        assert!(entry.success);
        assert!(entry.sql_text.contains("DELETE FROM"));
        assert!(
            entry.sql_text.contains("42"),
            "Delete history SQL should contain interpolated PK value 42, got: {}",
            entry.sql_text
        );
        assert!(
            !entry.sql_text.contains("?"),
            "Delete history SQL should not contain raw ? placeholders, got: {}",
            entry.sql_text
        );
    }

    #[tokio::test]
    async fn insert_delete_and_export_wrappers_surface_expected_errors() {
        let read_only_state = common::test_app_state();
        register_connection(&read_only_state, "conn-ro", true);
        let read_only_webview = build_app(read_only_state);

        let insert_read_only = invoke_tauri_command::<Vec<(String, serde_json::Value)>>(
            &read_only_webview,
            "insert_table_row",
            json!({ "payload": {
                "connectionId": "conn-ro",
                "database": "test_db",
                "table": "users",
                "values": { "name": "Blocked" },
                "primaryKeyInfo": {
                    "keyColumns": ["id"],
                    "hasAutoIncrement": true,
                    "isUniqueKeyFallback": false
                }
            } }),
        )
        .expect_err("read-only insert should error");
        assert!(insert_read_only.to_string().contains("read-only"));

        let delete_read_only = invoke_tauri_command::<()>(
            &read_only_webview,
            "delete_table_row",
            json!({ "payload": {
                "connectionId": "conn-ro",
                "database": "test_db",
                "table": "users",
                "primaryKeyColumns": ["id"],
                "primaryKeyValues": { "id": 1 }
            } }),
        )
        .expect_err("read-only delete should error");
        assert!(delete_read_only.to_string().contains("read-only"));

        let state = common::test_app_state();
        let webview = build_app(state);

        let insert_missing = invoke_tauri_command::<Vec<(String, serde_json::Value)>>(
            &webview,
            "insert_table_row",
            json!({ "payload": {
                "connectionId": "missing",
                "database": "test_db",
                "table": "users",
                "values": { "name": "Missing" },
                "primaryKeyInfo": {
                    "keyColumns": ["id"],
                    "hasAutoIncrement": true,
                    "isUniqueKeyFallback": false
                }
            } }),
        )
        .expect_err("missing insert connection should error");
        assert!(insert_missing.to_string().contains("not found"));

        let delete_missing = invoke_tauri_command::<()>(
            &webview,
            "delete_table_row",
            json!({ "payload": {
                "connectionId": "missing",
                "database": "test_db",
                "table": "users",
                "primaryKeyColumns": ["id"],
                "primaryKeyValues": { "id": 1 }
            } }),
        )
        .expect_err("missing delete connection should error");
        assert!(delete_missing.to_string().contains("not found"));

        let export_missing = invoke_tauri_command::<()>(
            &webview,
            "export_table_data",
            json!({
                "payload": {
                    "connectionId": "missing",
                    "database": "test_db",
                    "table": "users",
                    "format": "json",
                    "filePath": "ignored.json",
                    "includeHeaders": false,
                    "tableNameForSql": "users",
                    "filterModel": null,
                    "sortColumn": null,
                    "sortDirection": null
                }
            }),
        )
        .expect_err("missing export connection should error");
        assert!(export_missing.to_string().contains("not found"));
    }
}

// ── build_select_sql tests (coverage mode only — pub(crate) visibility) ───────

#[cfg(coverage)]
mod build_select_sql_tests {
    use sqllumen_lib::commands::table_data::build_select_sql;
    use sqllumen_lib::mysql::table_data::{FilterCondition, SortInfo};

    #[test]
    fn build_select_sql_basic_no_filter_no_sort() {
        let sql = build_select_sql(&sqllumen_lib::commands::table_data::SelectSqlSpec {
            database: "mydb",
            table: "users",
            filter: &[],
            sort: &None,
            limit: Some(sqllumen_lib::commands::table_data::PageWindow {
                page_size: 50,
                offset: 0,
            }),
        });
        assert!(sql.is_some());
        let sql = sql.unwrap();
        assert_eq!(sql, "SELECT * FROM `mydb`.`users` LIMIT 50 OFFSET 0");
    }

    #[test]
    fn build_select_sql_with_sort() {
        let sort = Some(SortInfo {
            column: "name".to_string(),
            direction: "asc".to_string(),
        });
        let sql = build_select_sql(&sqllumen_lib::commands::table_data::SelectSqlSpec {
            database: "mydb",
            table: "users",
            filter: &[],
            sort: &sort,
            limit: Some(sqllumen_lib::commands::table_data::PageWindow {
                page_size: 25,
                offset: 50,
            }),
        })
        .unwrap();
        assert!(sql.contains("ORDER BY `name` ASC"));
        assert!(sql.contains("LIMIT 25 OFFSET 50"));
    }

    #[test]
    fn build_select_sql_with_desc_sort() {
        let sort = Some(SortInfo {
            column: "id".to_string(),
            direction: "desc".to_string(),
        });
        let sql = build_select_sql(&sqllumen_lib::commands::table_data::SelectSqlSpec {
            database: "db",
            table: "tbl",
            filter: &[],
            sort: &sort,
            limit: Some(sqllumen_lib::commands::table_data::PageWindow {
                page_size: 10,
                offset: 0,
            }),
        })
        .unwrap();
        assert!(sql.contains("ORDER BY `id` DESC"));
    }

    #[test]
    fn build_select_sql_with_filter() {
        let filter = vec![FilterCondition {
            column: "status".to_string(),
            operator: "==".to_string(),
            value: "active".to_string(),
        }];
        let sql = build_select_sql(&sqllumen_lib::commands::table_data::SelectSqlSpec {
            database: "db",
            table: "tbl",
            filter: &filter,
            sort: &None,
            limit: Some(sqllumen_lib::commands::table_data::PageWindow {
                page_size: 50,
                offset: 0,
            }),
        })
        .unwrap();
        assert!(sql.contains("WHERE"));
        assert!(sql.contains("`status` = ?"));
    }

    #[test]
    fn build_select_sql_no_limit_for_export() {
        let sql = build_select_sql(&sqllumen_lib::commands::table_data::SelectSqlSpec {
            database: "mydb",
            table: "orders",
            filter: &[],
            sort: &None,
            limit: None,
        })
        .unwrap();
        assert_eq!(sql, "SELECT * FROM `mydb`.`orders`");
        assert!(!sql.contains("LIMIT"));
    }

    #[test]
    fn build_select_sql_with_all_options() {
        let filter = vec![
            FilterCondition {
                column: "name".to_string(),
                operator: "LIKE".to_string(),
                value: "%test%".to_string(),
            },
            FilterCondition {
                column: "age".to_string(),
                operator: ">".to_string(),
                value: "18".to_string(),
            },
        ];
        let sort = Some(SortInfo {
            column: "name".to_string(),
            direction: "asc".to_string(),
        });
        let sql = build_select_sql(&sqllumen_lib::commands::table_data::SelectSqlSpec {
            database: "shop",
            table: "products",
            filter: &filter,
            sort: &sort,
            limit: Some(sqllumen_lib::commands::table_data::PageWindow {
                page_size: 100,
                offset: 200,
            }),
        })
        .unwrap();
        assert!(sql.starts_with("SELECT * FROM `shop`.`products`"));
        assert!(sql.contains("WHERE"));
        assert!(sql.contains("ORDER BY `name` ASC"));
        assert!(sql.contains("LIMIT 100 OFFSET 200"));
    }

    #[test]
    fn build_select_sql_returns_none_for_empty_or_overlong_identifiers() {
        let sort = Some(SortInfo {
            column: "x".repeat(65),
            direction: "asc".to_string(),
        });

        assert!(
            build_select_sql(&sqllumen_lib::commands::table_data::SelectSqlSpec {
                database: "",
                table: "users",
                filter: &[],
                sort: &None,
                limit: Some(sqllumen_lib::commands::table_data::PageWindow {
                    page_size: 10,
                    offset: 0
                })
            })
            .is_none()
        );
        assert!(
            build_select_sql(&sqllumen_lib::commands::table_data::SelectSqlSpec {
                database: "db",
                table: "",
                filter: &[],
                sort: &None,
                limit: Some(sqllumen_lib::commands::table_data::PageWindow {
                    page_size: 10,
                    offset: 0
                })
            })
            .is_none()
        );
        assert!(
            build_select_sql(&sqllumen_lib::commands::table_data::SelectSqlSpec {
                database: "db",
                table: "users",
                filter: &[],
                sort: &sort,
                limit: Some(sqllumen_lib::commands::table_data::PageWindow {
                    page_size: 10,
                    offset: 0
                })
            })
            .is_none()
        );
    }
}

// ── translate_filter_model (pure function) ────────────────────────────────────

// ── interpolate_sql_params (pure function) ────────────────────────────────────

#[test]
fn interpolate_sql_params_no_placeholders() {
    let sql = "SELECT * FROM `db`.`tbl` LIMIT 10";
    let result = interpolate_sql_params(sql, &[]);
    assert_eq!(result, sql);
}

#[test]
fn interpolate_sql_params_string_values() {
    let sql = "UPDATE `db`.`t` SET `name` = ? WHERE `id` = ?";
    let params = vec![serde_json::json!("Alice"), serde_json::json!(1)];
    let result = interpolate_sql_params(sql, &params);
    assert_eq!(
        result,
        "UPDATE `db`.`t` SET `name` = 'Alice' WHERE `id` = 1"
    );
}

#[test]
fn interpolate_sql_params_null_value() {
    let sql = "INSERT INTO `t` (`a`) VALUES (?)";
    let params = vec![serde_json::Value::Null];
    let result = interpolate_sql_params(sql, &params);
    assert_eq!(result, "INSERT INTO `t` (`a`) VALUES (NULL)");
}

#[test]
fn interpolate_sql_params_boolean_values() {
    let sql = "INSERT INTO `t` (`a`, `b`) VALUES (?, ?)";
    let params = vec![serde_json::json!(true), serde_json::json!(false)];
    let result = interpolate_sql_params(sql, &params);
    assert_eq!(result, "INSERT INTO `t` (`a`, `b`) VALUES (1, 0)");
}

#[test]
fn interpolate_sql_params_number_values() {
    let sql = "SELECT * FROM `t` WHERE `price` > ? AND `qty` < ?";
    let params = vec![serde_json::json!(9.99), serde_json::json!(100)];
    let result = interpolate_sql_params(sql, &params);
    assert_eq!(
        result,
        "SELECT * FROM `t` WHERE `price` > 9.99 AND `qty` < 100"
    );
}

#[test]
fn interpolate_sql_params_escapes_single_quotes() {
    let sql = "INSERT INTO `t` (`name`) VALUES (?)";
    let params = vec![serde_json::json!("O'Brien")];
    let result = interpolate_sql_params(sql, &params);
    assert_eq!(result, "INSERT INTO `t` (`name`) VALUES ('O''Brien')");
}

#[test]
fn interpolate_sql_params_mixed_types() {
    let sql = "INSERT INTO `t` (`a`, `b`, `c`, `d`) VALUES (?, ?, ?, ?)";
    let params = vec![
        serde_json::json!("hello"),
        serde_json::json!(42),
        serde_json::Value::Null,
        serde_json::json!(true),
    ];
    let result = interpolate_sql_params(sql, &params);
    assert_eq!(
        result,
        "INSERT INTO `t` (`a`, `b`, `c`, `d`) VALUES ('hello', 42, NULL, 1)"
    );
}

#[test]
fn interpolate_sql_params_extra_placeholders_left_as_is() {
    let sql = "SELECT ? AND ?";
    let params = vec![serde_json::json!("only_one")];
    let result = interpolate_sql_params(sql, &params);
    assert_eq!(result, "SELECT 'only_one' AND ?");
}

#[test]
fn interpolate_sql_params_array_value_formatted() {
    let sql = "SELECT ?";
    let params = vec![serde_json::json!([1, 2, 3])];
    let result = interpolate_sql_params(sql, &params);
    assert_eq!(result, "SELECT '[1,2,3]'");
}

#[test]
fn interpolate_sql_params_object_value_formatted() {
    let sql = "SELECT ?";
    let params = vec![serde_json::json!({"key": "val"})];
    let result = interpolate_sql_params(sql, &params);
    assert!(result.starts_with("SELECT '"));
    assert!(result.contains("key"));
}

// ── translate_filter_model (pure function) ────────────────────────────────────

#[test]
fn translate_filter_model_empty() {
    let conditions: Vec<FilterCondition> = vec![];
    let clause = translate_filter_model(&conditions);
    assert!(clause.sql.is_empty());
    assert!(clause.params.is_empty());
}

#[test]
fn translate_filter_model_like() {
    let conditions = vec![FilterCondition {
        column: "name".to_string(),
        operator: "LIKE".to_string(),
        value: "%alice%".to_string(),
    }];

    let clause = translate_filter_model(&conditions);
    assert!(clause.sql.contains("LIKE ?"));
    assert!(clause.sql.contains("`name`"));
    assert_eq!(clause.params.len(), 1);
    assert_eq!(clause.params[0], serde_json::json!("%alice%"));
}

#[test]
fn translate_filter_model_not_like() {
    let conditions = vec![FilterCondition {
        column: "name".to_string(),
        operator: "NOT LIKE".to_string(),
        value: "%bob%".to_string(),
    }];

    let clause = translate_filter_model(&conditions);
    assert!(clause.sql.contains("NOT LIKE ?"));
    assert_eq!(clause.params[0], serde_json::json!("%bob%"));
}

#[test]
fn translate_filter_model_equals() {
    let conditions = vec![FilterCondition {
        column: "status".to_string(),
        operator: "==".to_string(),
        value: "active".to_string(),
    }];

    let clause = translate_filter_model(&conditions);
    assert!(clause.sql.contains("`status` = ?"));
    assert_eq!(clause.params.len(), 1);
    assert_eq!(clause.params[0], serde_json::json!("active"));
}

#[test]
fn translate_filter_model_not_equals() {
    let conditions = vec![FilterCondition {
        column: "status".to_string(),
        operator: "!=".to_string(),
        value: "inactive".to_string(),
    }];

    let clause = translate_filter_model(&conditions);
    assert!(clause.sql.contains("`status` != ?"));
    assert_eq!(clause.params.len(), 1);
    assert_eq!(clause.params[0], serde_json::json!("inactive"));
}

#[test]
fn translate_filter_model_like_starts_with() {
    let conditions = vec![FilterCondition {
        column: "name".to_string(),
        operator: "LIKE".to_string(),
        value: "Al%".to_string(),
    }];

    let clause = translate_filter_model(&conditions);
    assert!(clause.sql.contains("`name` LIKE ?"));
    assert_eq!(clause.params[0], serde_json::json!("Al%"));
}

#[test]
fn translate_filter_model_like_ends_with() {
    let conditions = vec![FilterCondition {
        column: "email".to_string(),
        operator: "LIKE".to_string(),
        value: "%.com".to_string(),
    }];

    let clause = translate_filter_model(&conditions);
    assert!(clause.sql.contains("`email` LIKE ?"));
    assert_eq!(clause.params[0], serde_json::json!("%.com"));
}

#[test]
fn translate_filter_model_is_null() {
    let conditions = vec![FilterCondition {
        column: "notes".to_string(),
        operator: "IS NULL".to_string(),
        value: "".to_string(),
    }];

    let clause = translate_filter_model(&conditions);
    assert!(clause.sql.contains("`notes` IS NULL OR `notes` = ''"));
    assert!(clause.params.is_empty());
}

#[test]
fn translate_filter_model_is_not_null() {
    let conditions = vec![FilterCondition {
        column: "notes".to_string(),
        operator: "IS NOT NULL".to_string(),
        value: "".to_string(),
    }];

    let clause = translate_filter_model(&conditions);
    assert!(clause.sql.contains("`notes` IS NOT NULL AND `notes` != ''"));
    assert!(clause.params.is_empty());
}

#[test]
fn translate_filter_model_less_than() {
    let conditions = vec![FilterCondition {
        column: "age".to_string(),
        operator: "<".to_string(),
        value: "30".to_string(),
    }];

    let clause = translate_filter_model(&conditions);
    assert!(clause.sql.contains("`age` < ?"));
    assert_eq!(clause.params[0], serde_json::json!("30"));
}

#[test]
fn translate_filter_model_greater_than() {
    let conditions = vec![FilterCondition {
        column: "salary".to_string(),
        operator: ">".to_string(),
        value: "50000".to_string(),
    }];

    let clause = translate_filter_model(&conditions);
    assert!(clause.sql.contains("`salary` > ?"));
    assert_eq!(clause.params[0], serde_json::json!("50000"));
}

#[test]
fn translate_filter_model_less_than_or_equal() {
    let conditions = vec![FilterCondition {
        column: "score".to_string(),
        operator: "<=".to_string(),
        value: "100".to_string(),
    }];

    let clause = translate_filter_model(&conditions);
    assert!(clause.sql.contains("`score` <= ?"));
}

#[test]
fn translate_filter_model_greater_than_or_equal() {
    let conditions = vec![FilterCondition {
        column: "score".to_string(),
        operator: ">=".to_string(),
        value: "0".to_string(),
    }];

    let clause = translate_filter_model(&conditions);
    assert!(clause.sql.contains("`score` >= ?"));
}

#[test]
fn translate_filter_model_in_range_two_conditions() {
    // In the new model, an "in range" filter is expressed as two separate conditions
    let conditions = vec![
        FilterCondition {
            column: "price".to_string(),
            operator: ">=".to_string(),
            value: "10".to_string(),
        },
        FilterCondition {
            column: "price".to_string(),
            operator: "<=".to_string(),
            value: "100".to_string(),
        },
    ];

    let clause = translate_filter_model(&conditions);
    assert!(clause.sql.contains("`price` >= ?"));
    assert!(clause.sql.contains("`price` <= ?"));
    assert_eq!(clause.params.len(), 2);
    assert_eq!(clause.params[0], serde_json::json!("10"));
    assert_eq!(clause.params[1], serde_json::json!("100"));
}

#[test]
fn translate_filter_model_multiple_columns() {
    let conditions = vec![
        FilterCondition {
            column: "name".to_string(),
            operator: "LIKE".to_string(),
            value: "%alice%".to_string(),
        },
        FilterCondition {
            column: "age".to_string(),
            operator: ">".to_string(),
            value: "25".to_string(),
        },
    ];

    let clause = translate_filter_model(&conditions);
    // Both conditions should be present, joined by AND
    assert!(clause.sql.contains(" AND "));
    assert!(clause.sql.contains("`name` LIKE ?"));
    assert!(clause.sql.contains("`age` > ?"));
    assert_eq!(clause.params.len(), 2);

    // Conditions are processed in order (name before age)
    assert_eq!(clause.params[0], serde_json::json!("%alice%"));
    assert_eq!(clause.params[1], serde_json::json!("25"));
}

#[test]
fn translate_filter_model_unknown_operator_skipped() {
    let conditions = vec![FilterCondition {
        column: "name".to_string(),
        operator: "unknownFilter".to_string(),
        value: "test".to_string(),
    }];

    let clause = translate_filter_model(&conditions);
    // Unknown operator is skipped — empty result
    assert!(clause.sql.is_empty());
    assert!(clause.params.is_empty());
}

fn make_column_meta(name: &str, data_type: &str) -> TableDataColumnMeta {
    TableDataColumnMeta {
        name: name.to_string(),
        data_type: data_type.to_string(),
        is_boolean_alias: false,
        enum_values: None,
        set_values: None,
        is_nullable: true,
        is_primary_key: false,
        is_unique_key: false,
        has_default: false,
        column_default: None,
        is_binary: false,
        is_auto_increment: false,
        is_generated: false,
    }
}

#[test]
fn translate_filter_model_with_columns_is_not_null_uses_type_aware_sql() {
    let conditions = vec![
        FilterCondition {
            column: "email_verified_at".to_string(),
            operator: "IS NOT NULL".to_string(),
            value: "".to_string(),
        },
        FilterCondition {
            column: "notes".to_string(),
            operator: "IS NOT NULL".to_string(),
            value: "".to_string(),
        },
        FilterCondition {
            column: "login_count".to_string(),
            operator: "IS NOT NULL".to_string(),
            value: "".to_string(),
        },
    ];

    let columns = vec![
        make_column_meta("email_verified_at", "TIMESTAMP"),
        make_column_meta("notes", "VARCHAR"),
        make_column_meta("login_count", "INT"),
    ];

    let clause = translate_filter_model_with_columns(&conditions, &columns);
    assert!(clause.sql.contains("`email_verified_at` IS NOT NULL"));
    assert!(!clause.sql.contains("`email_verified_at` != ''"));
    assert!(clause.sql.contains("`notes` IS NOT NULL AND `notes` != ''"));
    assert!(clause.sql.contains("`login_count` IS NOT NULL"));
    assert!(!clause.sql.contains("`login_count` != ''"));
    assert!(clause.params.is_empty());
}

#[test]
fn translate_filter_model_with_columns_is_null_uses_type_aware_sql() {
    let conditions = vec![
        FilterCondition {
            column: "published_on".to_string(),
            operator: "IS NULL".to_string(),
            value: "".to_string(),
        },
        FilterCondition {
            column: "title".to_string(),
            operator: "IS NULL".to_string(),
            value: "".to_string(),
        },
        FilterCondition {
            column: "price".to_string(),
            operator: "IS NULL".to_string(),
            value: "".to_string(),
        },
    ];

    let columns = vec![
        make_column_meta("published_on", "DATE"),
        make_column_meta("title", "TEXT"),
        make_column_meta("price", "DECIMAL"),
    ];

    let clause = translate_filter_model_with_columns(&conditions, &columns);
    assert!(clause.sql.contains("`published_on` IS NULL"));
    assert!(!clause.sql.contains("`published_on` = ''"));
    assert!(clause.sql.contains("`title` IS NULL OR `title` = ''"));
    assert!(clause.sql.contains("`price` IS NULL"));
    assert!(!clause.sql.contains("`price` = ''"));
    assert!(clause.params.is_empty());
}

#[test]
fn translate_filter_model_with_columns_json_is_null_only() {
    let conditions = vec![FilterCondition {
        column: "profile".to_string(),
        operator: "IS NULL".to_string(),
        value: "".to_string(),
    }];

    let columns = vec![make_column_meta("profile", "JSON")];

    let clause = translate_filter_model_with_columns(&conditions, &columns);
    assert!(clause.sql.contains("`profile` IS NULL"));
    assert!(!clause.sql.contains("`profile` = ''"));
}

#[test]
fn translate_filter_model_with_columns_json_is_not_null_only() {
    let conditions = vec![FilterCondition {
        column: "profile".to_string(),
        operator: "IS NOT NULL".to_string(),
        value: "".to_string(),
    }];

    let columns = vec![make_column_meta("profile", "JSON")];

    let clause = translate_filter_model_with_columns(&conditions, &columns);
    assert!(clause.sql.contains("`profile` IS NOT NULL"));
    assert!(!clause.sql.contains("`profile` != ''"));
}

#[test]
fn translate_filter_model_with_columns_not_equals() {
    let conditions = vec![FilterCondition {
        column: "name".to_string(),
        operator: "!=".to_string(),
        value: "Alice".to_string(),
    }];

    let columns = vec![make_column_meta("name", "VARCHAR")];

    let clause = translate_filter_model_with_columns(&conditions, &columns);
    assert!(clause.sql.contains("`name` != ?"));
    assert_eq!(clause.params.len(), 1);
    assert_eq!(clause.params[0], serde_json::json!("Alice"));
}

#[test]
fn parse_enum_values_extracts_options_and_escaped_quotes() {
    let values = parse_enum_values("enum('active','it''s ok','disabled')")
        .expect("enum values should parse");

    assert_eq!(values, vec!["active", "it's ok", "disabled"]);
}

#[test]
fn parse_enum_values_returns_none_for_non_enum_types() {
    assert!(parse_enum_values("varchar(255)").is_none());
    assert!(parse_enum_values("set('a','b')").is_none());
}

#[test]
fn parse_set_values_extracts_options_and_escaped_quotes() {
    let values =
        parse_set_values("set('alpha','it''s ok','gamma')").expect("SET values should parse");
    assert_eq!(values, vec!["alpha", "it's ok", "gamma"]);
}

#[test]
fn parse_set_values_returns_none_for_non_set_types() {
    assert!(parse_set_values("varchar(255)").is_none());
    assert!(parse_set_values("enum('a','b')").is_none());
}

#[test]
fn generated_column_extra_matches_mysql_and_mariadb_generated_columns_only() {
    assert!(is_generated_column_extra("VIRTUAL GENERATED"));
    assert!(is_generated_column_extra("STORED GENERATED"));
    assert!(is_generated_column_extra("PERSISTENT GENERATED"));
    assert!(!is_generated_column_extra("DEFAULT_GENERATED"));
    assert!(!is_generated_column_extra(
        "DEFAULT_GENERATED on update CURRENT_TIMESTAMP"
    ));
    assert!(!is_generated_column_extra("auto_increment"));
}

// ── Data structure serialization tests ────────────────────────────────────────

#[test]
fn primary_key_info_serializes() {
    let pk = PrimaryKeyInfo {
        key_columns: vec!["id".to_string()],
        has_auto_increment: true,
        is_unique_key_fallback: false,
    };
    let json = serde_json::to_string(&pk).expect("serialize");
    assert!(json.contains("keyColumns"));
    assert!(json.contains("hasAutoIncrement"));
    assert!(json.contains("isUniqueKeyFallback"));
}

#[test]
fn sort_info_roundtrip() {
    let sort = SortInfo {
        column: "name".to_string(),
        direction: "asc".to_string(),
    };
    let json = serde_json::to_string(&sort).expect("serialize");
    let deserialized: SortInfo = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(deserialized.column, "name");
    assert_eq!(deserialized.direction, "asc");
}

#[test]
fn filter_condition_roundtrip() {
    let entry = FilterCondition {
        column: "name".to_string(),
        operator: "LIKE".to_string(),
        value: "%test%".to_string(),
    };
    let json = serde_json::to_string(&entry).expect("serialize");
    let deserialized: FilterCondition = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(deserialized.column, "name");
    assert_eq!(deserialized.operator, "LIKE");
    assert_eq!(deserialized.value, "%test%");
}

#[test]
fn export_table_options_serializes() {
    let opts = ExportTableOptions {
        database: "test_db".to_string(),
        table: "users".to_string(),
        format: "csv".to_string(),
        file_path: "/tmp/export.csv".to_string(),
        include_headers: true,
        table_name_for_sql: "users".to_string(),
        filter_model: vec![],
        sort: None,
        page: None,
        page_size: None,
    };
    let json = serde_json::to_string(&opts).expect("serialize");
    assert!(!json.contains("connectionId"));
    assert!(json.contains("database"));
    assert!(json.contains("includeHeaders"));
}

// ── Coverage-mode tests for *_impl stubs ──────────────────────────────────────

#[cfg(coverage)]
mod coverage_stubs {
    use super::*;
    use sqllumen_lib::mysql::table_data::{
        delete_table_row_impl, export_table_data_impl, fetch_table_data_impl,
        insert_table_row_impl, update_table_row_impl,
    };
    use std::collections::HashMap;

    fn dummy_lazy_pool() -> sqllumen_lib::mysql::pool::BackgroundPool {
        crate::common::mock_session::unreachable_pool()
    }

    #[tokio::test]
    async fn fetch_table_data_impl_stub_returns_default() {
        let pool = dummy_lazy_pool();
        let metadata_cache = MetadataCache::new();
        let running_queries = tokio::sync::RwLock::new(HashMap::new());
        let result = fetch_table_data_impl(
            &sqllumen_lib::mysql::table_data::TableDataContext {
                pool: &pool,
                connection_id: "test-connection",
                metadata_cache: &metadata_cache,
            },
            &running_queries,
            &sqllumen_lib::mysql::table_data::TableDataPageQuery {
                tab_id: "test-tab".to_string(),
                database: "test_db".to_string(),
                table: "test_table".to_string(),
                page: 1,
                page_size: 100,
                sort: None,
                filter_model: vec![],
            },
        )
        .await;

        assert!(result.is_ok());
        let response = result.unwrap();
        assert_eq!(response.current_page, 1);
        assert_eq!(response.page_size, 100);
        assert!(response.columns.is_empty());
        assert!(response.rows.is_empty());
        assert!(response.primary_key.is_none());
    }

    #[tokio::test]
    async fn fetch_table_data_impl_stub_with_sort_and_filter() {
        let pool = dummy_lazy_pool();
        let metadata_cache = MetadataCache::new();
        let filter = vec![FilterCondition {
            column: "name".to_string(),
            operator: "LIKE".to_string(),
            value: "%test%".to_string(),
        }];

        let sort = Some(SortInfo {
            column: "id".to_string(),
            direction: "asc".to_string(),
        });
        let running_queries = tokio::sync::RwLock::new(HashMap::new());
        let result = fetch_table_data_impl(
            &sqllumen_lib::mysql::table_data::TableDataContext {
                pool: &pool,
                connection_id: "test-connection",
                metadata_cache: &metadata_cache,
            },
            &running_queries,
            &sqllumen_lib::mysql::table_data::TableDataPageQuery {
                tab_id: "test-tab".to_string(),
                database: "db".to_string(),
                table: "tbl".to_string(),
                page: 2,
                page_size: 50,
                sort,
                filter_model: filter,
            },
        )
        .await;

        assert!(result.is_ok());
        let response = result.unwrap();
        assert_eq!(response.current_page, 2);
        assert_eq!(response.page_size, 50);
    }

    #[tokio::test]
    async fn update_table_row_impl_stub_returns_ok() {
        let pool = dummy_lazy_pool();
        let result = update_table_row_impl(
            &pool,
            &sqllumen_lib::mysql::table_data::UpdateTableRowRequest {
                connection_id: String::new(),
                database: "test_db".to_string(),
                table: "test_table".to_string(),
                primary_key_columns: vec!["id".to_string()],
                original_primary_key_values: {
                    let mut m = HashMap::new();
                    m.insert("id".to_string(), serde_json::json!(1));
                    m
                },
                updated_values: {
                    let mut m = HashMap::new();
                    m.insert("name".to_string(), serde_json::json!("updated"));
                    m
                },
            },
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn insert_table_row_impl_stub_returns_empty_vec() {
        let pool = dummy_lazy_pool();
        let pk = PrimaryKeyInfo {
            key_columns: vec!["id".to_string()],
            has_auto_increment: true,
            is_unique_key_fallback: false,
        };
        let metadata_cache = MetadataCache::new();
        let values = {
            let mut m = HashMap::new();
            m.insert("name".to_string(), serde_json::json!("new_user"));
            m
        };

        let result = insert_table_row_impl(
            &pool,
            &metadata_cache,
            &sqllumen_lib::mysql::table_data::InsertTableRowRequest {
                connection_id: "test-connection".to_string(),
                database: "test_db".to_string(),
                table: "test_table".to_string(),
                values: values.clone(),
                primary_key_info: pk.clone(),
            },
        )
        .await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn delete_table_row_impl_stub_returns_ok() {
        let pool = dummy_lazy_pool();
        let result = delete_table_row_impl(
            &pool,
            &sqllumen_lib::mysql::table_data::DeleteTableRowRequest {
                connection_id: String::new(),
                database: "test_db".to_string(),
                table: "test_table".to_string(),
                primary_key_columns: vec!["id".to_string()],
                primary_key_values: {
                    let mut m = HashMap::new();
                    m.insert("id".to_string(), serde_json::json!(1));
                    m
                },
            },
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn export_table_data_impl_stub_returns_ok() {
        let pool = dummy_lazy_pool();
        let options = ExportTableOptions {
            database: "test_db".to_string(),
            table: "users".to_string(),
            format: "csv".to_string(),
            file_path: "/tmp/test_export.csv".to_string(),
            include_headers: true,
            table_name_for_sql: "users".to_string(),
            filter_model: vec![],
            sort: None,
            page: None,
            page_size: None,
        };
        let metadata_cache = MetadataCache::new();

        let result = export_table_data_impl(
            &sqllumen_lib::mysql::table_data::TableDataContext {
                pool: &pool,
                connection_id: "test-connection",
                metadata_cache: &metadata_cache,
            },
            &options,
        )
        .await;
        assert!(result.is_ok());
    }
}
