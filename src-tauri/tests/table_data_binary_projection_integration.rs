//! Integration tests for binary column projection in table-data browsing.

mod common;

#[cfg(not(coverage))]
mod binary_projection_integration {
    use crate::common;
    use common::blob_step_helpers::connect_mock_pool;
    use common::mock_mysql_server::{MockCell, MockColumnDef, MockMySqlServer, MockQueryStep};
    use opensrv_mysql::{ColumnFlags, ColumnType};
    use rusqlite::Connection;
    use serde::de::DeserializeOwned;
    use serde_json::json;
    use sqllumen_lib::commands::connections::{save_connection_impl, SaveConnectionInput};
    use sqllumen_lib::commands::mysql::{open_connection_impl, OpenConnectionResult};
    use sqllumen_lib::commands::table_data as table_data_commands;
    use sqllumen_lib::mysql::metadata_cache::MetadataCache;
    use sqllumen_lib::mysql::pool::set_test_pool_factory;
    use sqllumen_lib::mysql::registry::ConnectionRegistry;
    use sqllumen_lib::mysql::table_data::{
        insert_table_row_impl, FilterCondition, PrimaryKeyInfo, TableDataResponse,
    };
    use sqllumen_lib::mysql::table_data_cache::TableDataCache;
    use sqllumen_lib::state::AppState;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;

    const INFO_SCHEMA_COLUMNS_QUERY: &str = "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION";
    const PRIMARY_KEY_QUERY: &str = "SELECT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY' ORDER BY kcu.ORDINAL_POSITION";

    fn test_state() -> AppState {
        common::ensure_fake_backend_once();
        let conn = Connection::open_in_memory().expect("should open in-memory db");
        sqllumen_lib::db::migrations::run_migrations(&conn).expect("should run migrations");
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
                    std::env::temp_dir().join("sqllumen-test-binary-projection-results"),
                ),
            ),
            table_data_cache: std::sync::Arc::new(TableDataCache::new_for_test(
                1800,
                std::env::temp_dir().join("sqllumen-test-binary-projection-table-data"),
            )),
            metadata_cache: sqllumen_lib::mysql::metadata_cache::MetadataCache::new(),
            log_filter_reload: Mutex::new(None),
            running_queries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
            dump_jobs: std::sync::Arc::new(
                std::sync::RwLock::new(std::collections::HashMap::new()),
            ),
            import_jobs: std::sync::Arc::new(std::sync::RwLock::new(
                std::collections::HashMap::new(),
            )),
            copy_jobs: std::sync::Arc::new(
                std::sync::RwLock::new(std::collections::HashMap::new()),
            ),
            ai_requests: Arc::new(Mutex::new(std::collections::HashMap::new())),
            index_build_tokens: Arc::new(Mutex::new(std::collections::HashMap::new())),
            session_profile_map: Arc::new(Mutex::new(std::collections::HashMap::new())),
            session_ref_counts: Arc::new(Mutex::new(std::collections::HashMap::new())),
            http_client: reqwest::Client::new(),
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
        open_connection_impl(&state, &payload.profile_id).await
    }

    #[tauri::command]
    async fn fetch_table_data(
        state: tauri::State<'_, AppState>,
        connection_id: String,
        tab_id: String,
        database: String,
        table: String,
        page: u32,
        page_size: u32,
        sort_column: Option<String>,
        sort_direction: Option<String>,
        filter_model: Option<Vec<FilterCondition>>,
    ) -> Result<TableDataResponse, String> {
        table_data_commands::fetch_table_data(
            state,
            connection_id,
            tab_id,
            database,
            table,
            page,
            page_size,
            sort_column,
            sort_direction,
            filter_model,
        )
        .await
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
            name: "Mock Binary Projection DB".to_string(),
            host: "127.0.0.1".to_string(),
            port: i64::from(port),
            username: "root".to_string(),
            password: None,
            default_database: None,
            ssl_enabled: false,
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
            "sslEnabled": input.ssl_enabled,
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

    fn info_schema_columns_step(rows: Vec<Vec<MockCell>>) -> MockQueryStep {
        MockQueryStep {
            query: INFO_SCHEMA_COLUMNS_QUERY,
            columns: vec![
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
            error: None,
            affected_rows: None,
        }
    }

    fn primary_key_step(pk_column: &'static [u8]) -> MockQueryStep {
        MockQueryStep {
            query: PRIMARY_KEY_QUERY,
            columns: vec![MockColumnDef {
                name: "COLUMN_NAME",
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::NOT_NULL_FLAG,
            }],
            rows: vec![vec![MockCell::Bytes(pk_column)]],
            error: None,
            affected_rows: None,
        }
    }

    async fn fetch_table_data_response(steps: Vec<MockQueryStep>) -> TableDataResponse {
        let server = MockMySqlServer::start_script(steps).await;
        set_test_pool_factory(None);

        let (_app, webview) = build_app();

        let profile_id: String = invoke_tauri_command(
            &webview,
            "save_connection",
            json!({ "data": save_input_json(server.port) }),
        )
        .expect("save_connection IPC should succeed");

        let open_result: OpenConnectionResultDto = invoke_tauri_command(
            &webview,
            "open_connection",
            json!({
                "payload": {
                    "profileId": profile_id,
                }
            }),
        )
        .expect("open_connection IPC should succeed");

        let response = invoke_tauri_command::<TableDataResponse>(
            &webview,
            "fetch_table_data",
            json!({
                "connectionId": open_result.session_id,
                "tabId": "binary-projection-tab",
                "database": "app_db",
                "table": "assets",
                "page": 1,
                "pageSize": 50,
                "sortColumn": null,
                "sortDirection": null,
                "filterModel": null
            }),
        )
        .expect("fetch_table_data IPC should succeed");

        set_test_pool_factory(None);
        response
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_projects_non_pk_blob_columns_with_octet_length() {
        let response = fetch_table_data_response(vec![
            info_schema_columns_step(vec![
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
                    MockCell::Bytes(b"data"),
                    MockCell::Bytes(b"blob"),
                    MockCell::Bytes(b"blob"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
            ]),
            primary_key_step(b"id"),
            MockQueryStep {
                query: "SELECT `id`, OCTET_LENGTH(`data`) AS `data` FROM `app_db`.`assets` LIMIT 50 OFFSET 0",
                columns: vec![
                    MockColumnDef {
                        name: "id",
                        coltype: ColumnType::MYSQL_TYPE_LONG,
                        colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "data",
                        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                        colflags: ColumnFlags::UNSIGNED_FLAG,
                    },
                ],
                rows: vec![vec![MockCell::U32(7), MockCell::U64(4096)]],
                error: None,
                affected_rows: None,
            },
        ])
        .await;

        assert_eq!(response.rows, vec![vec![json!(7), json!("[BLOB - 4 KB]")]]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_preserves_binary_primary_keys_as_hex() {
        let response = fetch_table_data_response(vec![
            info_schema_columns_step(vec![
                vec![
                    MockCell::Bytes(b"uuid"),
                    MockCell::Bytes(b"binary"),
                    MockCell::Bytes(b"binary(16)"),
                    MockCell::Bytes(b"NO"),
                    MockCell::Bytes(b"PRI"),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
                vec![
                    MockCell::Bytes(b"name"),
                    MockCell::Bytes(b"varchar"),
                    MockCell::Bytes(b"varchar(255)"),
                    MockCell::Bytes(b"NO"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
            ]),
            primary_key_step(b"uuid"),
            MockQueryStep {
                query: "SELECT `uuid`, `name` FROM `app_db`.`assets` LIMIT 50 OFFSET 0",
                columns: vec![
                    MockColumnDef {
                        name: "uuid",
                        coltype: ColumnType::MYSQL_TYPE_BLOB,
                        colflags: ColumnFlags::BINARY_FLAG | ColumnFlags::PRI_KEY_FLAG,
                    },
                    MockColumnDef {
                        name: "name",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                ],
                rows: vec![vec![
                    MockCell::Bytes(&[
                        0x12, 0x34, 0x56, 0x78, 0x90, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0xba, 0x09,
                        0x87, 0x65, 0x43, 0x21,
                    ]),
                    MockCell::Bytes(b"binary key row"),
                ]],
                error: None,
                affected_rows: None,
            },
        ])
        .await;

        assert_eq!(
            response.rows,
            vec![vec![
                json!("0x1234567890ABCDEFFEDCBA0987654321"),
                json!("binary key row")
            ]]
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_keeps_null_binary_columns_as_json_null() {
        let response = fetch_table_data_response(vec![
            info_schema_columns_step(vec![
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
                    MockCell::Bytes(b"data"),
                    MockCell::Bytes(b"blob"),
                    MockCell::Bytes(b"blob"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
            ]),
            primary_key_step(b"id"),
            MockQueryStep {
                query: "SELECT `id`, OCTET_LENGTH(`data`) AS `data` FROM `app_db`.`assets` LIMIT 50 OFFSET 0",
                columns: vec![
                    MockColumnDef {
                        name: "id",
                        coltype: ColumnType::MYSQL_TYPE_LONG,
                        colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "data",
                        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                        colflags: ColumnFlags::UNSIGNED_FLAG,
                    },
                ],
                rows: vec![vec![MockCell::U32(8), MockCell::Null]],
                error: None,
                affected_rows: None,
            },
        ])
        .await;

        assert_eq!(response.rows, vec![vec![json!(8), serde_json::Value::Null]]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_accepts_signed_octet_length_results_for_non_pk_blobs() {
        let response = fetch_table_data_response(vec![
            info_schema_columns_step(vec![
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
                    MockCell::Bytes(b"data"),
                    MockCell::Bytes(b"blob"),
                    MockCell::Bytes(b"blob"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
            ]),
            primary_key_step(b"id"),
            MockQueryStep {
                query: "SELECT `id`, OCTET_LENGTH(`data`) AS `data` FROM `app_db`.`assets` LIMIT 50 OFFSET 0",
                columns: vec![
                    MockColumnDef {
                        name: "id",
                        coltype: ColumnType::MYSQL_TYPE_LONG,
                        colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "data",
                        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                        colflags: ColumnFlags::empty(),
                    },
                ],
                rows: vec![vec![MockCell::U32(9), MockCell::I64(14)]],
                error: None,
                affected_rows: None,
            },
        ])
        .await;

        assert_eq!(response.rows, vec![vec![json!(9), json!("[BLOB - 14 B]")]]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_projects_only_binary_columns_in_mixed_tables() {
        let response = fetch_table_data_response(vec![
            info_schema_columns_step(vec![
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
                    MockCell::Bytes(b"NO"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
                vec![
                    MockCell::Bytes(b"avatar"),
                    MockCell::Bytes(b"blob"),
                    MockCell::Bytes(b"blob"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
                vec![
                    MockCell::Bytes(b"bio"),
                    MockCell::Bytes(b"text"),
                    MockCell::Bytes(b"text"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
            ]),
            primary_key_step(b"id"),
            MockQueryStep {
                query: "SELECT `id`, `name`, OCTET_LENGTH(`avatar`) AS `avatar`, `bio` FROM `app_db`.`assets` LIMIT 50 OFFSET 0",
                columns: vec![
                    MockColumnDef {
                        name: "id",
                        coltype: ColumnType::MYSQL_TYPE_LONG,
                        colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "name",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "avatar",
                        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                        colflags: ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "bio",
                        coltype: ColumnType::MYSQL_TYPE_BLOB,
                        colflags: ColumnFlags::empty(),
                    },
                ],
                rows: vec![vec![
                    MockCell::U32(3),
                    MockCell::Bytes(b"Ada"),
                    MockCell::U64(512),
                    MockCell::Bytes(b"Engineer and writer"),
                ]],
                error: None,
                affected_rows: None,
            },
        ])
        .await;

        assert_eq!(
            response.rows,
            vec![vec![
                json!(3),
                json!("Ada"),
                json!("[BLOB - 512 B]"),
                json!("Engineer and writer"),
            ]]
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_projects_all_supported_non_pk_binary_types() {
        let response = fetch_table_data_response(vec![
            info_schema_columns_step(vec![
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
                    MockCell::Bytes(b"blob_col"),
                    MockCell::Bytes(b"blob"),
                    MockCell::Bytes(b"blob"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
                vec![
                    MockCell::Bytes(b"tinyblob_col"),
                    MockCell::Bytes(b"tinyblob"),
                    MockCell::Bytes(b"tinyblob"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
                vec![
                    MockCell::Bytes(b"mediumblob_col"),
                    MockCell::Bytes(b"mediumblob"),
                    MockCell::Bytes(b"mediumblob"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
                vec![
                    MockCell::Bytes(b"longblob_col"),
                    MockCell::Bytes(b"longblob"),
                    MockCell::Bytes(b"longblob"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
                vec![
                    MockCell::Bytes(b"binary_col"),
                    MockCell::Bytes(b"binary"),
                    MockCell::Bytes(b"binary(8)"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
                vec![
                    MockCell::Bytes(b"varbinary_col"),
                    MockCell::Bytes(b"varbinary"),
                    MockCell::Bytes(b"varbinary(64)"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
            ]),
            primary_key_step(b"id"),
            MockQueryStep {
                query: "SELECT `id`, OCTET_LENGTH(`blob_col`) AS `blob_col`, OCTET_LENGTH(`tinyblob_col`) AS `tinyblob_col`, OCTET_LENGTH(`mediumblob_col`) AS `mediumblob_col`, OCTET_LENGTH(`longblob_col`) AS `longblob_col`, OCTET_LENGTH(`binary_col`) AS `binary_col`, OCTET_LENGTH(`varbinary_col`) AS `varbinary_col` FROM `app_db`.`assets` LIMIT 50 OFFSET 0",
                columns: vec![
                    MockColumnDef {
                        name: "id",
                        coltype: ColumnType::MYSQL_TYPE_LONG,
                        colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "blob_col",
                        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                        colflags: ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "tinyblob_col",
                        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                        colflags: ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "mediumblob_col",
                        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                        colflags: ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "longblob_col",
                        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                        colflags: ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "binary_col",
                        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                        colflags: ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "varbinary_col",
                        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                        colflags: ColumnFlags::UNSIGNED_FLAG,
                    },
                ],
                rows: vec![vec![
                    MockCell::U32(5),
                    MockCell::U64(1),
                    MockCell::U64(2),
                    MockCell::U64(3),
                    MockCell::U64(4),
                    MockCell::U64(8),
                    MockCell::U64(64),
                ]],
                error: None,
                affected_rows: None,
            },
        ])
        .await;

        assert_eq!(
            response.rows,
            vec![vec![
                json!(5),
                json!("[BLOB - 1 B]"),
                json!("[BLOB - 2 B]"),
                json!("[BLOB - 3 B]"),
                json!("[BLOB - 4 B]"),
                json!("[BLOB - 8 B]"),
                json!("[BLOB - 64 B]"),
            ]]
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn insert_table_row_refetch_preserves_binary_primary_key_as_hex() {
        let server = MockMySqlServer::start_script(vec![
            info_schema_columns_step(vec![
                vec![
                    MockCell::Bytes(b"uuid"),
                    MockCell::Bytes(b"binary"),
                    MockCell::Bytes(b"binary(16)"),
                    MockCell::Bytes(b"NO"),
                    MockCell::Bytes(b"PRI"),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
                vec![
                    MockCell::Bytes(b"name"),
                    MockCell::Bytes(b"varchar"),
                    MockCell::Bytes(b"varchar(255)"),
                    MockCell::Bytes(b"NO"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
            ]),
            primary_key_step(b"uuid"),
            MockQueryStep {
                query: "SELECT `uuid`, `name` FROM `app_db`.`assets` WHERE `uuid` = ?",
                columns: vec![
                    MockColumnDef {
                        name: "uuid",
                        coltype: ColumnType::MYSQL_TYPE_BLOB,
                        colflags: ColumnFlags::BINARY_FLAG | ColumnFlags::PRI_KEY_FLAG,
                    },
                    MockColumnDef {
                        name: "name",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                ],
                rows: vec![vec![
                    MockCell::Bytes(&[
                        0xde, 0xad, 0xbe, 0xef, 0xaa, 0xbb, 0xcc, 0xdd, 0x10, 0x20, 0x30, 0x40,
                        0x50, 0x60, 0x70, 0x80,
                    ]),
                    MockCell::Bytes(b"inserted binary pk"),
                ]],
                error: None,
                affected_rows: None,
            },
        ])
        .await;

        let pool = connect_mock_pool(&server).await;
        let metadata_cache = MetadataCache::new();
        let mut values = HashMap::new();
        values.insert(
            "uuid".to_string(),
            json!("0xDEADBEEFAABBCCDD1020304050607080"),
        );
        values.insert("name".to_string(), json!("inserted binary pk"));

        let inserted = insert_table_row_impl(
            &pool,
            "binary-projection-connection",
            &metadata_cache,
            "app_db",
            "assets",
            &values,
            &PrimaryKeyInfo {
                key_columns: vec!["uuid".to_string()],
                has_auto_increment: false,
                is_unique_key_fallback: false,
            },
        )
        .await
        .expect("insert with binary primary key should succeed");

        pool.close().await;

        assert_eq!(
            inserted,
            vec![
                (
                    "uuid".to_string(),
                    json!("0xDEADBEEFAABBCCDD1020304050607080")
                ),
                ("name".to_string(), json!("inserted binary pk")),
            ]
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn insert_table_row_refetch_projects_non_pk_binary_columns_with_placeholders() {
        let server = MockMySqlServer::start_script(vec![
            info_schema_columns_step(vec![
                vec![
                    MockCell::Bytes(b"id"),
                    MockCell::Bytes(b"int"),
                    MockCell::Bytes(b"int(11)"),
                    MockCell::Bytes(b"NO"),
                    MockCell::Bytes(b"PRI"),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
                vec![
                    MockCell::Bytes(b"payload"),
                    MockCell::Bytes(b"blob"),
                    MockCell::Bytes(b"blob"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
                vec![
                    MockCell::Bytes(b"name"),
                    MockCell::Bytes(b"varchar"),
                    MockCell::Bytes(b"varchar(255)"),
                    MockCell::Bytes(b"NO"),
                    MockCell::Bytes(b""),
                    MockCell::Null,
                    MockCell::Bytes(b""),
                ],
            ]),
            primary_key_step(b"id"),
            MockQueryStep {
                query: "SELECT `id`, OCTET_LENGTH(`payload`) AS `payload`, `name` FROM `app_db`.`assets` WHERE `id` = ?",
                columns: vec![
                    MockColumnDef {
                        name: "id",
                        coltype: ColumnType::MYSQL_TYPE_LONG,
                        colflags: ColumnFlags::NOT_NULL_FLAG
                            | ColumnFlags::PRI_KEY_FLAG
                            | ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "payload",
                        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                        colflags: ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "name",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                ],
                rows: vec![vec![
                    MockCell::U32(42),
                    MockCell::U64(6),
                    MockCell::Bytes(b"payload row"),
                ]],
                error: None,
                affected_rows: None,
            },
        ])
        .await;

        let pool = connect_mock_pool(&server).await;
        let metadata_cache = MetadataCache::new();
        let mut values = HashMap::new();
        values.insert("id".to_string(), json!(42));
        values.insert("payload".to_string(), json!("AQIDBAUG"));
        values.insert("name".to_string(), json!("payload row"));

        let inserted = insert_table_row_impl(
            &pool,
            "binary-projection-connection",
            &metadata_cache,
            "app_db",
            "assets",
            &values,
            &PrimaryKeyInfo {
                key_columns: vec!["id".to_string()],
                has_auto_increment: false,
                is_unique_key_fallback: false,
            },
        )
        .await
        .expect("insert with projected binary payload should succeed");

        pool.close().await;

        assert_eq!(
            inserted,
            vec![
                ("id".to_string(), json!(42)),
                ("payload".to_string(), json!("[BLOB - 6 B]")),
                ("name".to_string(), json!("payload row")),
            ]
        );
    }
}
