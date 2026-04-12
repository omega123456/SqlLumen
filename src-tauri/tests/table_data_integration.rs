//! Integration tests for table data operations — filter translation and coverage stubs.

use sqllumen_lib::mysql::table_data::{
    translate_filter_model, translate_filter_model_with_columns, ExportTableOptions,
    FilterCondition, PrimaryKeyInfo, SortInfo, TableDataColumnMeta,
};
use sqllumen_lib::commands::table_data::interpolate_sql_params;
#[cfg(not(coverage))]
use sqllumen_lib::mysql::table_data::parse_enum_values;

mod common;

#[cfg(not(coverage))]
mod type_aware_filter_integration {
    use super::*;
    use chrono::NaiveDate;
    use common::mock_mysql_server::{MockCell, MockColumnDef, MockMySqlServer, MockQueryStep};
    use sqllumen_lib::commands::connections::{save_connection_impl, SaveConnectionInput};
    use sqllumen_lib::commands::mysql::{open_connection_impl, OpenConnectionResult};
    use sqllumen_lib::commands::table_data as table_data_commands;
    use sqllumen_lib::mysql::pool::set_test_pool_factory;
    use sqllumen_lib::mysql::registry::ConnectionRegistry;
    use sqllumen_lib::state::AppState;
    use opensrv_mysql::{ColumnFlags, ColumnType, ErrorKind};
    use rusqlite::Connection;
    use serde::de::DeserializeOwned;
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;

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

    fn build_app(
    ) -> (
        tauri::App<tauri::test::MockRuntime>,
        tauri::WebviewWindow<tauri::test::MockRuntime>,
    ) {
        let app = mock_builder()
            .manage(test_state())
            .invoke_handler(tauri::generate_handler![save_connection, open_connection, fetch_table_data])
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
        database: String,
        table: String,
        page: u32,
        page_size: u32,
        sort_column: Option<String>,
        sort_direction: Option<String>,
        filter_model: Option<Vec<sqllumen_lib::mysql::table_data::FilterCondition>>,
    ) -> Result<sqllumen_lib::mysql::table_data::TableDataResponse, String> {
        table_data_commands::fetch_table_data(
            state,
            connection_id,
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
        get_ipc_response(
            webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost".parse().expect("test URL should parse"),
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

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_avoids_empty_string_comparison_for_timestamp_not_blank_filter() {
        let server = MockMySqlServer::start_script(vec![
            MockQueryStep {
                query: "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
                columns: vec![
                    MockColumnDef { name: "COLUMN_NAME", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "DATA_TYPE", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "COLUMN_TYPE", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "IS_NULLABLE", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "COLUMN_KEY", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::empty() },
                    MockColumnDef { name: "COLUMN_DEFAULT", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::empty() },
                    MockColumnDef { name: "EXTRA", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                ],
                rows: vec![
                    vec![
                        MockCell::Bytes(b"id"),
                        MockCell::Bytes(b"int"),
                        MockCell::Bytes(b"int(11)"),
                        MockCell::Bytes(b"NO"),
                        MockCell::Bytes(b"PRI"),
                        MockCell::Bytes(b""),
                        MockCell::Bytes(b"auto_increment"),
                    ],
                    vec![
                        MockCell::Bytes(b"email_verified_at"),
                        MockCell::Bytes(b"timestamp"),
                        MockCell::Bytes(b"timestamp"),
                        MockCell::Bytes(b"YES"),
                        MockCell::Bytes(b""),
                        MockCell::Null,
                        MockCell::Bytes(b""),
                    ],
                ],
                error: None,
            },
            MockQueryStep {
                query: "SELECT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY' ORDER BY kcu.ORDINAL_POSITION",
                columns: vec![MockColumnDef { name: "COLUMN_NAME", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG }],
                rows: vec![vec![MockCell::Bytes(b"id")]],
                error: None,
            },
            MockQueryStep {
                query: "SELECT COUNT(*) FROM `pi_management`.`users` WHERE `email_verified_at` IS NOT NULL",
                columns: vec![MockColumnDef { name: "COUNT(*)", coltype: ColumnType::MYSQL_TYPE_LONGLONG, colflags: ColumnFlags::NOT_NULL_FLAG }],
                rows: vec![vec![MockCell::I64(1)]],
                error: None,
            },
            MockQueryStep {
                query: "SELECT * FROM `pi_management`.`users` WHERE `email_verified_at` IS NOT NULL LIMIT 50 OFFSET 0",
                columns: vec![
                    MockColumnDef { name: "id", coltype: ColumnType::MYSQL_TYPE_LONG, colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG },
                    MockColumnDef { name: "email_verified_at", coltype: ColumnType::MYSQL_TYPE_TIMESTAMP, colflags: ColumnFlags::empty() },
                ],
                rows: vec![vec![
                    MockCell::U32(1),
                    MockCell::DateTime(
                        NaiveDate::from_ymd_opt(2024, 1, 1)
                            .expect("date should be valid")
                            .and_hms_opt(0, 0, 0)
                            .expect("time should be valid"),
                    ),
                ]],
                error: None,
            },
            MockQueryStep {
                query: "SELECT COUNT(*) FROM `pi_management`.`users` WHERE (`email_verified_at` IS NOT NULL AND `email_verified_at` != '')",
                columns: vec![],
                rows: vec![],
                error: Some((ErrorKind::ER_WRONG_VALUE, b"Incorrect TIMESTAMP value: ''")),
            },
        ])
        .await;

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

        let response = invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
            &webview,
            "fetch_table_data",
            json!({
                "connectionId": open_result.session_id,
                "database": "pi_management",
                "table": "users",
                "page": 1,
                "pageSize": 50,
                "sortColumn": null,
                "sortDirection": null,
                "filterModel": [
                    {
                        "column": "email_verified_at",
                        "operator": "IS NOT NULL",
                        "value": ""
                    }
                ]
            }),
        )
        .expect("type-aware timestamp notBlank filter should succeed");

        assert_eq!(response.total_rows, 1);
        assert_eq!(response.rows.len(), 1);

        set_test_pool_factory(None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_serializes_timestamp_columns_as_strings() {
        let server = MockMySqlServer::start_script(vec![
            MockQueryStep {
                query: "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
                columns: vec![
                    MockColumnDef { name: "COLUMN_NAME", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "DATA_TYPE", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "COLUMN_TYPE", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "IS_NULLABLE", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "COLUMN_KEY", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::empty() },
                    MockColumnDef { name: "COLUMN_DEFAULT", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::empty() },
                    MockColumnDef { name: "EXTRA", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
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
                        MockCell::Bytes(b"created_at"),
                        MockCell::Bytes(b"timestamp"),
                        MockCell::Bytes(b"timestamp"),
                        MockCell::Bytes(b"NO"),
                        MockCell::Bytes(b""),
                        MockCell::Null,
                        MockCell::Bytes(b""),
                    ],
                    vec![
                        MockCell::Bytes(b"updated_at"),
                        MockCell::Bytes(b"timestamp"),
                        MockCell::Bytes(b"timestamp"),
                        MockCell::Bytes(b"YES"),
                        MockCell::Bytes(b""),
                        MockCell::Null,
                        MockCell::Bytes(b""),
                    ],
                ],
                error: None,
            },
            MockQueryStep {
                query: "SELECT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY' ORDER BY kcu.ORDINAL_POSITION",
                columns: vec![MockColumnDef { name: "COLUMN_NAME", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG }],
                rows: vec![vec![MockCell::Bytes(b"id")]],
                error: None,
            },
            MockQueryStep {
                query: "SELECT COUNT(*) FROM `pi_management`.`users`",
                columns: vec![MockColumnDef { name: "COUNT(*)", coltype: ColumnType::MYSQL_TYPE_LONGLONG, colflags: ColumnFlags::NOT_NULL_FLAG }],
                rows: vec![vec![MockCell::I64(1)]],
                error: None,
            },
            MockQueryStep {
                query: "SELECT * FROM `pi_management`.`users` LIMIT 50 OFFSET 0",
                columns: vec![
                    MockColumnDef { name: "id", coltype: ColumnType::MYSQL_TYPE_LONG, colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG },
                    MockColumnDef { name: "created_at", coltype: ColumnType::MYSQL_TYPE_TIMESTAMP, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "updated_at", coltype: ColumnType::MYSQL_TYPE_TIMESTAMP, colflags: ColumnFlags::empty() },
                ],
                rows: vec![vec![
                    MockCell::U32(1),
                    MockCell::DateTime(
                        NaiveDate::from_ymd_opt(2024, 1, 1)
                            .expect("date should be valid")
                            .and_hms_opt(0, 0, 0)
                            .expect("time should be valid"),
                    ),
                    MockCell::DateTime(
                        NaiveDate::from_ymd_opt(2024, 1, 2)
                            .expect("date should be valid")
                            .and_hms_opt(3, 4, 5)
                            .expect("time should be valid"),
                    ),
                ]],
                error: None,
            },
        ])
        .await;

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

        let response = invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
            &webview,
            "fetch_table_data",
            json!({
                "connectionId": open_result.session_id,
                "database": "pi_management",
                "table": "users",
                "page": 1,
                "pageSize": 50,
                "sortColumn": null,
                "sortDirection": null,
                "filterModel": null
            }),
        )
        .expect("fetch_table_data IPC should succeed");

        assert_eq!(response.total_rows, 1);
        assert_eq!(response.rows.len(), 1);
        assert_eq!(response.rows[0][1], serde_json::json!("2024-01-01 00:00:00"));
        assert_eq!(response.rows[0][2], serde_json::json!("2024-01-02 03:04:05"));

        set_test_pool_factory(None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_returns_enum_values_for_enum_columns() {
        let server = MockMySqlServer::start_script(vec![
            MockQueryStep {
                query: "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
                columns: vec![
                    MockColumnDef { name: "COLUMN_NAME", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "DATA_TYPE", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "COLUMN_TYPE", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "IS_NULLABLE", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "COLUMN_KEY", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::empty() },
                    MockColumnDef { name: "COLUMN_DEFAULT", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::empty() },
                    MockColumnDef { name: "EXTRA", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
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
                        MockCell::Bytes(b"status"),
                        MockCell::Bytes(b"enum"),
                        MockCell::Bytes(b"enum('active','disabled')"),
                        MockCell::Bytes(b"YES"),
                        MockCell::Bytes(b""),
                        MockCell::Bytes(b"active"),
                        MockCell::Bytes(b""),
                    ],
                ],
                error: None,
            },
            MockQueryStep {
                query: "SELECT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY' ORDER BY kcu.ORDINAL_POSITION",
                columns: vec![MockColumnDef { name: "COLUMN_NAME", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG }],
                rows: vec![vec![MockCell::Bytes(b"id")]],
                error: None,
            },
            MockQueryStep {
                query: "SELECT COUNT(*) FROM `pi_management`.`users`",
                columns: vec![MockColumnDef { name: "COUNT(*)", coltype: ColumnType::MYSQL_TYPE_LONGLONG, colflags: ColumnFlags::NOT_NULL_FLAG }],
                rows: vec![vec![MockCell::I64(1)]],
                error: None,
            },
            MockQueryStep {
                query: "SELECT * FROM `pi_management`.`users` LIMIT 50 OFFSET 0",
                columns: vec![
                    MockColumnDef { name: "id", coltype: ColumnType::MYSQL_TYPE_LONG, colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG },
                    MockColumnDef { name: "status", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::empty() },
                ],
                rows: vec![vec![MockCell::U32(1), MockCell::Bytes(b"active")]],
                error: None,
            },
        ])
        .await;

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

        let response = invoke_tauri_command::<serde_json::Value>(
            &webview,
            "fetch_table_data",
            json!({
                "connectionId": open_result.session_id,
                "database": "pi_management",
                "table": "users",
                "page": 1,
                "pageSize": 50,
                "sortColumn": null,
                "sortDirection": null,
                "filterModel": null
            }),
        )
        .expect("fetch_table_data IPC should succeed");

        assert_eq!(
            response["columns"][1]["enumValues"],
            serde_json::json!(["active", "disabled"])
        );

        set_test_pool_factory(None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_data_serializes_boolean_alias_columns_as_integers() {
        let server = MockMySqlServer::start_script(vec![
            MockQueryStep {
                query: "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
                columns: vec![
                    MockColumnDef { name: "COLUMN_NAME", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "DATA_TYPE", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "COLUMN_TYPE", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "IS_NULLABLE", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
                    MockColumnDef { name: "COLUMN_KEY", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::empty() },
                    MockColumnDef { name: "COLUMN_DEFAULT", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::empty() },
                    MockColumnDef { name: "EXTRA", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG },
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
                        MockCell::Bytes(b"is_admin"),
                        MockCell::Bytes(b"tinyint"),
                        MockCell::Bytes(b"tinyint(1)"),
                        MockCell::Bytes(b"YES"),
                        MockCell::Bytes(b""),
                        MockCell::Null,
                        MockCell::Bytes(b""),
                    ],
                ],
                error: None,
            },
            MockQueryStep {
                query: "SELECT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY' ORDER BY kcu.ORDINAL_POSITION",
                columns: vec![MockColumnDef { name: "COLUMN_NAME", coltype: ColumnType::MYSQL_TYPE_VAR_STRING, colflags: ColumnFlags::NOT_NULL_FLAG }],
                rows: vec![vec![MockCell::Bytes(b"id")]],
                error: None,
            },
            MockQueryStep {
                query: "SELECT COUNT(*) FROM `pi_management`.`users`",
                columns: vec![MockColumnDef { name: "COUNT(*)", coltype: ColumnType::MYSQL_TYPE_LONGLONG, colflags: ColumnFlags::NOT_NULL_FLAG }],
                rows: vec![vec![MockCell::I64(1)]],
                error: None,
            },
            MockQueryStep {
                query: "SELECT * FROM `pi_management`.`users` LIMIT 50 OFFSET 0",
                columns: vec![
                    MockColumnDef { name: "id", coltype: ColumnType::MYSQL_TYPE_LONG, colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG },
                    MockColumnDef { name: "is_admin", coltype: ColumnType::MYSQL_TYPE_TINY, colflags: ColumnFlags::empty() },
                ],
                rows: vec![vec![MockCell::U32(1), MockCell::I8(1)]],
                error: None,
            },
        ])
        .await;

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

        let response = invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
            &webview,
            "fetch_table_data",
            json!({
                "connectionId": open_result.session_id,
                "database": "pi_management",
                "table": "users",
                "page": 1,
                "pageSize": 50,
                "sortColumn": null,
                "sortDirection": null,
                "filterModel": null
            }),
        )
        .expect("fetch_table_data IPC should succeed");

        assert_eq!(response.total_rows, 1);
        assert_eq!(response.rows.len(), 1);
        assert_eq!(response.rows[0][1], serde_json::json!(1));

        set_test_pool_factory(None);
    }
}

#[cfg(coverage)]
mod command_wrapper_coverage {
    use super::*;
    use sqllumen_lib::commands::table_data as table_data_commands;
    use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
    use sqllumen_lib::state::AppState;
    use serde::de::DeserializeOwned;
    use serde_json::json;
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
    use std::collections::HashMap;
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tokio_util::sync::CancellationToken;

    fn dummy_pool() -> sqlx::MySqlPool {
        let opts = MySqlConnectOptions::new()
            .host("127.0.0.1")
            .port(13306)
            .username("dummy")
            .password("dummy");
        MySqlPoolOptions::new().connect_lazy_with(opts)
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
                    ssl_enabled: false,
                    ssl_ca_path: None,
                    ssl_cert_path: None,
                    ssl_key_path: None,
                    connect_timeout_secs: 10,
                    keepalive_interval_secs: 0,
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
        get_ipc_response(
            webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost".parse().expect("test URL should parse"),
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
        connection_id: String,
        database: String,
        table: String,
        page: u32,
        page_size: u32,
        sort_column: Option<String>,
        sort_direction: Option<String>,
        filter_model: Option<Vec<sqllumen_lib::mysql::table_data::FilterCondition>>,
    ) -> Result<sqllumen_lib::mysql::table_data::TableDataResponse, String> {
        table_data_commands::fetch_table_data(
            state,
            connection_id,
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

    #[tauri::command]
    async fn update_table_row(
        state: tauri::State<'_, AppState>,
        connection_id: String,
        database: String,
        table: String,
        primary_key_columns: Vec<String>,
        original_pk_values: HashMap<String, serde_json::Value>,
        updated_values: HashMap<String, serde_json::Value>,
    ) -> Result<(), String> {
        table_data_commands::update_table_row(
            state,
            connection_id,
            database,
            table,
            primary_key_columns,
            original_pk_values,
            updated_values,
        )
        .await
    }

    #[tauri::command]
    async fn insert_table_row(
        state: tauri::State<'_, AppState>,
        connection_id: String,
        database: String,
        table: String,
        values: HashMap<String, serde_json::Value>,
        pk_info: sqllumen_lib::mysql::table_data::PrimaryKeyInfo,
    ) -> Result<Vec<(String, serde_json::Value)>, String> {
        table_data_commands::insert_table_row(state, connection_id, database, table, values, pk_info)
            .await
    }

    #[tauri::command]
    async fn delete_table_row(
        state: tauri::State<'_, AppState>,
        connection_id: String,
        database: String,
        table: String,
        pk_columns: Vec<String>,
        pk_values: HashMap<String, serde_json::Value>,
    ) -> Result<(), String> {
        table_data_commands::delete_table_row(
            state,
            connection_id,
            database,
            table,
            pk_columns,
            pk_values,
        )
        .await
    }

    #[tauri::command]
    async fn export_table_data(
        state: tauri::State<'_, AppState>,
        connection_id: String,
        database: String,
        table: String,
        format: String,
        file_path: String,
        include_headers: bool,
        table_name_for_sql: String,
        filter_model: Option<Vec<sqllumen_lib::mysql::table_data::FilterCondition>>,
        sort_column: Option<String>,
        sort_direction: Option<String>,
    ) -> Result<(), String> {
        table_data_commands::export_table_data(
            state,
            connection_id,
            database,
            table,
            format,
            file_path,
            include_headers,
            table_name_for_sql,
            filter_model,
            sort_column,
            sort_direction,
        )
        .await
    }

    #[tokio::test]
    async fn fetch_table_data_wrapper_validates_inputs_and_uses_stubbed_impl() {
        let state = common::test_app_state();
        register_connection(&state, "conn-1", false);
        let webview = build_app(state);

        let zero_page_size_err = invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
            &webview,
            "fetch_table_data",
            json!({
                "connectionId": "conn-1",
                "database": "test_db",
                "table": "users",
                "page": 1,
                "pageSize": 0,
                "sortColumn": null,
                "sortDirection": null,
                "filterModel": null
            }),
        )
        .expect_err("page size zero should error");
        assert!(zero_page_size_err.to_string().contains("page_size must be at least 1"));

        let missing_connection_err = invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
            &webview,
            "fetch_table_data",
            json!({
                "connectionId": "missing",
                "database": "test_db",
                "table": "users",
                "page": 1,
                "pageSize": 50,
                "sortColumn": null,
                "sortDirection": null,
                "filterModel": null
            }),
        )
        .expect_err("missing connection should error");
        assert!(missing_connection_err.to_string().contains("not found"));

        let response = invoke_tauri_command::<sqllumen_lib::mysql::table_data::TableDataResponse>(
            &webview,
            "fetch_table_data",
            json!({
                "connectionId": "conn-1",
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
            }),
        )
        .expect("fetch should succeed");

        assert_eq!(response.current_page, 2);
        assert_eq!(response.page_size, 25);
        assert_eq!(response.total_rows, 0);
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
            json!({
                "connectionId": "conn-ro",
                "database": "test_db",
                "table": "users",
                "primaryKeyColumns": ["id"],
                "originalPkValues": { "id": 1 },
                "updatedValues": { "name": "Alice" }
            }),
        )
        .expect_err("read-only connection should error");
        assert!(read_only_err.to_string().contains("read-only"));

        let state = common::test_app_state();
        let webview = build_app(state);
        let missing_err = invoke_tauri_command::<()>(
            &webview,
            "update_table_row",
            json!({
                "connectionId": "missing",
                "database": "test_db",
                "table": "users",
                "primaryKeyColumns": ["id"],
                "originalPkValues": { "id": 1 },
                "updatedValues": { "name": "Alice" }
            }),
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
            json!({
                "connectionId": "conn-1",
                "database": "test_db",
                "table": "users",
                "primaryKeyColumns": ["id"],
                "originalPkValues": { "id": 1 },
                "updatedValues": { "name": "Updated" }
            }),
        )
        .expect("update should succeed");

        let inserted = invoke_tauri_command::<Vec<(String, serde_json::Value)>>(
            &webview,
            "insert_table_row",
            json!({
                "connectionId": "conn-1",
                "database": "test_db",
                "table": "users",
                "values": { "name": "New User" },
                "pkInfo": {
                    "keyColumns": ["id"],
                    "hasAutoIncrement": true,
                    "isUniqueKeyFallback": false
                }
            }),
        )
        .expect("insert should succeed");
        assert!(inserted.is_empty());

        invoke_tauri_command::<()>(
            &webview,
            "delete_table_row",
            json!({
                "connectionId": "conn-1",
                "database": "test_db",
                "table": "users",
                "pkColumns": ["id"],
                "pkValues": { "id": 1 }
            }),
        )
        .expect("delete should succeed");

        invoke_tauri_command::<()>(
            &webview,
            "export_table_data",
            json!({
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
            }),
        )
        .expect("export should succeed");
    }

    // ── History logging verification tests ──────────────────────────────────

    /// Helper: wait for fire-and-forget history logging spawned tasks to complete.
    async fn wait_for_history_logging() {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
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
                "connectionId": "hist-conn",
                "database": "test_db",
                "table": "users",
                "page": 1,
                "pageSize": 50,
                "sortColumn": null,
                "sortDirection": null,
                "filterModel": null
            }),
        )
        .expect("fetch should succeed");

        wait_for_history_logging().await;

        // Verify history was logged
        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(&conn, "hist-conn", 1, 50, None)
            .expect("list history");
        assert_eq!(page.total, 1, "one history entry should be logged");
        let entry = &page.entries[0];
        assert!(entry.success);
        assert!(entry.sql_text.contains("SELECT * FROM"));
        assert!(entry.sql_text.contains("test_db"));
        assert!(entry.sql_text.contains("users"));
        assert!(entry.sql_text.contains("LIMIT 50 OFFSET 0"));
        assert_eq!(entry.database_name.as_deref(), Some("test_db"));
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
                "connectionId": "hist-sf",
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
            }),
        )
        .expect("fetch should succeed");

        wait_for_history_logging().await;

        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(&conn, "hist-sf", 1, 50, None)
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
        assert!(!entry.sql_text.contains(" ? "), "History SQL should not contain raw ? placeholders, got: {}", entry.sql_text);
        assert!(entry.sql_text.contains("'%widget%'"), "History SQL should contain interpolated filter value, got: {}", entry.sql_text);
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
                "connectionId": "missing-conn",
                "database": "test_db",
                "table": "users",
                "page": 1,
                "pageSize": 50,
                "sortColumn": null,
                "sortDirection": null,
                "filterModel": null
            }),
        )
        .expect_err("should fail for missing connection");

        wait_for_history_logging().await;

        // fetch_table_data returns early before logging when connection is not found
        // (the pool lookup fails before the impl call), so we expect NO history entry
        // since the error path logs with the session_id fallback
        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(&conn, "missing-conn", 1, 50, None)
            .expect("list history");
        // No history logged because the error happens before the impl call
        // and the wrapper returns Err before reaching the history logging code
        assert_eq!(page.total, 0, "no history entry when connection not found (early return)");
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
            }),
        )
        .expect("export should succeed");

        wait_for_history_logging().await;

        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(&conn, "hist-export", 1, 50, None)
            .expect("list history");
        assert_eq!(page.total, 1, "one history entry should be logged for export");
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
            }),
        )
        .expect("export should succeed");

        wait_for_history_logging().await;

        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(&conn, "hist-export-sf", 1, 50, None)
            .expect("list history");
        assert_eq!(page.total, 1);
        let entry = &page.entries[0];
        assert!(entry.success);
        assert!(entry.sql_text.contains("WHERE"));
        assert!(entry.sql_text.contains("ORDER BY"));
        assert!(entry.sql_text.contains("ASC"));
        // Verify filter value is interpolated
        assert!(entry.sql_text.contains("'100'"), "Export history SQL should contain interpolated filter value, got: {}", entry.sql_text);
        assert!(!entry.sql_text.contains("?"), "Export history SQL should not contain raw ? placeholders, got: {}", entry.sql_text);
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
            json!({
                "connectionId": "hist-update",
                "database": "test_db",
                "table": "users",
                "primaryKeyColumns": ["id"],
                "originalPkValues": { "id": 1 },
                "updatedValues": { "name": "Alice" }
            }),
        )
        .expect("update should succeed");

        wait_for_history_logging().await;

        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(&conn, "hist-update", 1, 50, None)
            .expect("list history");
        assert_eq!(page.total, 1);
        let entry = &page.entries[0];
        assert!(entry.success);
        assert!(entry.sql_text.contains("UPDATE"));
        assert!(entry.sql_text.contains("'Alice'"), "Update history SQL should contain interpolated value 'Alice', got: {}", entry.sql_text);
        assert!(entry.sql_text.contains("1"), "Update history SQL should contain PK value 1, got: {}", entry.sql_text);
        assert!(!entry.sql_text.contains("?"), "Update history SQL should not contain raw ? placeholders, got: {}", entry.sql_text);
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
            json!({
                "connectionId": "hist-insert",
                "database": "test_db",
                "table": "users",
                "values": { "name": "Bob", "age": 30 },
                "pkInfo": {
                    "keyColumns": ["id"],
                    "hasAutoIncrement": true,
                    "isUniqueKeyFallback": false
                }
            }),
        )
        .expect("insert should succeed");

        wait_for_history_logging().await;

        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(&conn, "hist-insert", 1, 50, None)
            .expect("list history");
        assert_eq!(page.total, 1);
        let entry = &page.entries[0];
        assert!(entry.success);
        assert!(entry.sql_text.contains("INSERT INTO"));
        assert!(entry.sql_text.contains("30"), "Insert history SQL should contain interpolated value 30, got: {}", entry.sql_text);
        assert!(entry.sql_text.contains("'Bob'"), "Insert history SQL should contain interpolated value 'Bob', got: {}", entry.sql_text);
        assert!(!entry.sql_text.contains("?"), "Insert history SQL should not contain raw ? placeholders, got: {}", entry.sql_text);
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
            json!({
                "connectionId": "hist-delete",
                "database": "test_db",
                "table": "users",
                "pkColumns": ["id"],
                "pkValues": { "id": 42 }
            }),
        )
        .expect("delete should succeed");

        wait_for_history_logging().await;

        let conn = db.lock().expect("db lock");
        let page = sqllumen_lib::db::history::list_history(&conn, "hist-delete", 1, 50, None)
            .expect("list history");
        assert_eq!(page.total, 1);
        let entry = &page.entries[0];
        assert!(entry.success);
        assert!(entry.sql_text.contains("DELETE FROM"));
        assert!(entry.sql_text.contains("42"), "Delete history SQL should contain interpolated PK value 42, got: {}", entry.sql_text);
        assert!(!entry.sql_text.contains("?"), "Delete history SQL should not contain raw ? placeholders, got: {}", entry.sql_text);
    }

    #[tokio::test]
    async fn insert_delete_and_export_wrappers_surface_expected_errors() {
        let read_only_state = common::test_app_state();
        register_connection(&read_only_state, "conn-ro", true);
        let read_only_webview = build_app(read_only_state);

        let insert_read_only = invoke_tauri_command::<Vec<(String, serde_json::Value)>>(
            &read_only_webview,
            "insert_table_row",
            json!({
                "connectionId": "conn-ro",
                "database": "test_db",
                "table": "users",
                "values": { "name": "Blocked" },
                "pkInfo": {
                    "keyColumns": ["id"],
                    "hasAutoIncrement": true,
                    "isUniqueKeyFallback": false
                }
            }),
        )
        .expect_err("read-only insert should error");
        assert!(insert_read_only.to_string().contains("read-only"));

        let delete_read_only = invoke_tauri_command::<()>(
            &read_only_webview,
            "delete_table_row",
            json!({
                "connectionId": "conn-ro",
                "database": "test_db",
                "table": "users",
                "pkColumns": ["id"],
                "pkValues": { "id": 1 }
            }),
        )
        .expect_err("read-only delete should error");
        assert!(delete_read_only.to_string().contains("read-only"));

        let state = common::test_app_state();
        let webview = build_app(state);

        let insert_missing = invoke_tauri_command::<Vec<(String, serde_json::Value)>>(
            &webview,
            "insert_table_row",
            json!({
                "connectionId": "missing",
                "database": "test_db",
                "table": "users",
                "values": { "name": "Missing" },
                "pkInfo": {
                    "keyColumns": ["id"],
                    "hasAutoIncrement": true,
                    "isUniqueKeyFallback": false
                }
            }),
        )
        .expect_err("missing insert connection should error");
        assert!(insert_missing.to_string().contains("not found"));

        let delete_missing = invoke_tauri_command::<()>(
            &webview,
            "delete_table_row",
            json!({
                "connectionId": "missing",
                "database": "test_db",
                "table": "users",
                "pkColumns": ["id"],
                "pkValues": { "id": 1 }
            }),
        )
        .expect_err("missing delete connection should error");
        assert!(delete_missing.to_string().contains("not found"));

        let export_missing = invoke_tauri_command::<()>(
            &webview,
            "export_table_data",
            json!({
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
        let sql = build_select_sql("mydb", "users", &[], &None, Some((50, 0)));
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
        let sql = build_select_sql("mydb", "users", &[], &sort, Some((25, 50))).unwrap();
        assert!(sql.contains("ORDER BY `name` ASC"));
        assert!(sql.contains("LIMIT 25 OFFSET 50"));
    }

    #[test]
    fn build_select_sql_with_desc_sort() {
        let sort = Some(SortInfo {
            column: "id".to_string(),
            direction: "desc".to_string(),
        });
        let sql = build_select_sql("db", "tbl", &[], &sort, Some((10, 0))).unwrap();
        assert!(sql.contains("ORDER BY `id` DESC"));
    }

    #[test]
    fn build_select_sql_with_filter() {
        let filter = vec![FilterCondition {
            column: "status".to_string(),
            operator: "==".to_string(),
            value: "active".to_string(),
        }];
        let sql = build_select_sql("db", "tbl", &filter, &None, Some((50, 0))).unwrap();
        assert!(sql.contains("WHERE"));
        assert!(sql.contains("`status` = ?"));
    }

    #[test]
    fn build_select_sql_no_limit_for_export() {
        let sql = build_select_sql("mydb", "orders", &[], &None, None).unwrap();
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
        let sql = build_select_sql("shop", "products", &filter, &sort, Some((100, 200))).unwrap();
        assert!(sql.starts_with("SELECT * FROM `shop`.`products`"));
        assert!(sql.contains("WHERE"));
        assert!(sql.contains("ORDER BY `name` ASC"));
        assert!(sql.contains("LIMIT 100 OFFSET 200"));
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
    let params = vec![
        serde_json::json!("Alice"),
        serde_json::json!(1),
    ];
    let result = interpolate_sql_params(sql, &params);
    assert_eq!(result, "UPDATE `db`.`t` SET `name` = 'Alice' WHERE `id` = 1");
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
    assert_eq!(result, "SELECT * FROM `t` WHERE `price` > 9.99 AND `qty` < 100");
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
    assert_eq!(result, "INSERT INTO `t` (`a`, `b`, `c`, `d`) VALUES ('hello', 42, NULL, 1)");
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
    assert!(
        clause
            .sql
            .contains("`notes` IS NOT NULL AND `notes` != ''")
    );
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
        is_nullable: true,
        is_primary_key: false,
        is_unique_key: false,
        has_default: false,
        column_default: None,
        is_binary: false,
        is_auto_increment: false,
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

#[cfg(not(coverage))]
#[test]
fn parse_enum_values_extracts_options_and_escaped_quotes() {
    let values = parse_enum_values("enum('active','it''s ok','disabled')")
        .expect("enum values should parse");

    assert_eq!(values, vec!["active", "it's ok", "disabled"]);
}

#[cfg(not(coverage))]
#[test]
fn parse_enum_values_returns_none_for_non_enum_types() {
    assert!(parse_enum_values("varchar(255)").is_none());
    assert!(parse_enum_values("set('a','b')").is_none());
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
        connection_id: "conn-1".to_string(),
        database: "test_db".to_string(),
        table: "users".to_string(),
        format: "csv".to_string(),
        file_path: "/tmp/export.csv".to_string(),
        include_headers: true,
        table_name_for_sql: "users".to_string(),
        filter_model: vec![],
        sort: None,
    };
    let json = serde_json::to_string(&opts).expect("serialize");
    assert!(json.contains("connectionId"));
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
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
    use std::collections::HashMap;

    fn dummy_lazy_pool() -> sqlx::MySqlPool {
        let opts = MySqlConnectOptions::new()
            .host("127.0.0.1")
            .port(13306)
            .username("dummy")
            .password("dummy");
        MySqlPoolOptions::new().connect_lazy_with(opts)
    }

    #[tokio::test]
    async fn fetch_table_data_impl_stub_returns_default() {
        let pool = dummy_lazy_pool();
        let result = fetch_table_data_impl(
            &pool,
            "test_db",
            "test_table",
            1,
            100,
            None,
            vec![],
            "conn-1",
        )
        .await;

        assert!(result.is_ok());
        let response = result.unwrap();
        assert_eq!(response.total_rows, 0);
        assert_eq!(response.current_page, 1);
        assert_eq!(response.total_pages, 1);
        assert_eq!(response.page_size, 100);
        assert!(response.columns.is_empty());
        assert!(response.rows.is_empty());
        assert!(response.primary_key.is_none());
    }

    #[tokio::test]
    async fn fetch_table_data_impl_stub_with_sort_and_filter() {
        let pool = dummy_lazy_pool();
        let filter = vec![FilterCondition {
            column: "name".to_string(),
            operator: "LIKE".to_string(),
            value: "%test%".to_string(),
        }];

        let sort = Some(SortInfo {
            column: "id".to_string(),
            direction: "asc".to_string(),
        });

        let result =
            fetch_table_data_impl(&pool, "db", "tbl", 2, 50, sort, filter, "conn-1").await;

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
            "test_db",
            "test_table",
            &["id".to_string()],
            &{
                let mut m = HashMap::new();
                m.insert("id".to_string(), serde_json::json!(1));
                m
            },
            &{
                let mut m = HashMap::new();
                m.insert("name".to_string(), serde_json::json!("updated"));
                m
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
        let values = {
            let mut m = HashMap::new();
            m.insert("name".to_string(), serde_json::json!("new_user"));
            m
        };

        let result =
            insert_table_row_impl(&pool, "test_db", "test_table", &values, &pk).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn delete_table_row_impl_stub_returns_ok() {
        let pool = dummy_lazy_pool();
        let result = delete_table_row_impl(
            &pool,
            "test_db",
            "test_table",
            &["id".to_string()],
            &{
                let mut m = HashMap::new();
                m.insert("id".to_string(), serde_json::json!(1));
                m
            },
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn export_table_data_impl_stub_returns_ok() {
        let pool = dummy_lazy_pool();
        let options = ExportTableOptions {
            connection_id: "conn-1".to_string(),
            database: "test_db".to_string(),
            table: "users".to_string(),
            format: "csv".to_string(),
            file_path: "/tmp/test_export.csv".to_string(),
            include_headers: true,
            table_name_for_sql: "users".to_string(),
            filter_model: vec![],
            sort: None,
        };

        let result = export_table_data_impl(&pool, &options).await;
        assert!(result.is_ok());
    }
}
