//! Query IPC against the in-process mock MySQL server. Omitted from `cargo mysql-client-llvm-cov`:
//! instrumented builds hit sqlx pool acquire timeouts against the mock; `pnpm test:rust` runs this suite.

#![cfg(not(coverage))]

mod common;

use chrono::NaiveDate;
use common::mock_mysql_server::{
    MockCell, MockColumnDef, MockMySqlServer, MockQueryResponse, MockTimeValue,
};
use opensrv_mysql::{ColumnFlags, ColumnType};
use mysql_client_lib::commands::connections::{save_connection_impl, SaveConnectionInput};
use mysql_client_lib::commands::mysql::{open_connection_impl, OpenConnectionResult};
use mysql_client_lib::mysql::query_executor::{execute_query_impl, ExecuteQueryResult};
use mysql_client_lib::mysql::registry::ConnectionRegistry;
use mysql_client_lib::state::AppState;
use rusqlite::Connection;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;
use std::sync::Mutex;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;

fn test_state() -> AppState {
    common::ensure_fake_backend_once();
    let conn = Connection::open_in_memory().expect("should open in-memory db");
    mysql_client_lib::db::migrations::run_migrations(&conn).expect("should run migrations");
    AppState {
        db: Mutex::new(conn),
        registry: ConnectionRegistry::new(),
        app_handle: None,
        results: std::sync::RwLock::new(std::collections::HashMap::new()),
        log_filter_reload: Mutex::new(None),
    }
}

fn build_query_commands_app(
) -> (
    tauri::App<tauri::test::MockRuntime>,
    tauri::WebviewWindow<tauri::test::MockRuntime>,
) {
    let app = mock_builder()
        .manage(test_state())
        .invoke_handler(tauri::generate_handler![save_connection, open_connection, execute_query])
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

#[tauri::command]
async fn open_connection(
    payload: OpenConnectionPayloadDto,
    state: tauri::State<'_, AppState>,
) -> Result<OpenConnectionResult, String> {
    open_connection_impl(&state, &payload.profile_id).await
}

#[tauri::command]
async fn execute_query(
    connection_id: String,
    tab_id: String,
    sql: String,
    page_size: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<ExecuteQueryResult, String> {
    execute_query_impl(&state, &connection_id, &tab_id, &sql, page_size.unwrap_or(1000)).await
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
        name: "Mock Query DB".to_string(),
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenConnectionPayloadDto {
    profile_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenConnectionResultDto {
    session_id: String,
    server_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ColumnMetaDto {
    name: String,
    data_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteQueryResultDto {
    query_id: String,
    columns: Vec<ColumnMetaDto>,
    total_rows: usize,
    execution_time_ms: u64,
    affected_rows: u64,
    first_page: Vec<Vec<serde_json::Value>>,
    total_pages: usize,
    auto_limit_applied: bool,
}

async fn execute_query_via_mock(response: MockQueryResponse) -> ExecuteQueryResultDto {
    let sql = response.query;
    let server = MockMySqlServer::start(response).await;
    let (_app, webview) = build_query_commands_app();

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

    assert!(!open_result.session_id.is_empty());

    invoke_tauri_command(
        &webview,
        "execute_query",
        json!({
            "connectionId": open_result.session_id,
            "tabId": "tab-1",
            "sql": sql,
            "pageSize": 1000,
        }),
    )
    .expect("execute_query IPC should succeed")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_query_ipc_serializes_mysql_result_values_instead_of_nulls() {
    let result = execute_query_via_mock(MockQueryResponse {
        query: "SELECT id, type, consumption, created_at FROM meter_readings_hourly LIMIT 1",
        columns: vec![
            MockColumnDef {
                name: "id",
                coltype: ColumnType::MYSQL_TYPE_LONG,
                colflags: ColumnFlags::UNSIGNED_FLAG,
            },
            MockColumnDef {
                name: "type",
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "consumption",
                coltype: ColumnType::MYSQL_TYPE_NEWDECIMAL,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "created_at",
                coltype: ColumnType::MYSQL_TYPE_DATETIME,
                colflags: ColumnFlags::empty(),
            },
        ],
        row: vec![
            MockCell::U32(1),
            MockCell::Bytes(b"electric"),
            MockCell::Bytes(b"0.38"),
            MockCell::DateTime(
                NaiveDate::from_ymd_opt(2023, 10, 1)
                    .expect("date should be valid")
                    .and_hms_opt(0, 0, 0)
                .expect("time should be valid"),
            ),
        ],
    })
    .await;

    assert_eq!(
        result.columns.iter().map(|column| column.name.as_str()).collect::<Vec<_>>(),
        vec!["id", "type", "consumption", "created_at"]
    );
    assert_eq!(result.total_rows, 1);
    assert_eq!(result.first_page.len(), 1);
    assert_eq!(
        result.first_page[0],
        vec![
            serde_json::json!(1),
            serde_json::json!("electric"),
            serde_json::json!("0.38"),
            serde_json::json!("2023-10-01 00:00:00"),
        ]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_query_ipc_serializes_unsafe_integers_as_strings() {
    let result = execute_query_via_mock(MockQueryResponse {
        query: "SELECT safe_signed, unsafe_signed, safe_unsigned, unsafe_unsigned FROM numeric_edges LIMIT 1",
        columns: vec![
            MockColumnDef {
                name: "safe_signed",
                coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "unsafe_signed",
                coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "safe_unsigned",
                coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                colflags: ColumnFlags::UNSIGNED_FLAG,
            },
            MockColumnDef {
                name: "unsafe_unsigned",
                coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                colflags: ColumnFlags::UNSIGNED_FLAG,
            },
        ],
        row: vec![
            MockCell::I64(9_007_199_254_740_991),
            MockCell::I64(-9_007_199_254_740_992),
            MockCell::U64(9_007_199_254_740_991),
            MockCell::U64(9_007_199_254_740_992),
        ],
    })
    .await;

    assert_eq!(result.total_rows, 1);
    assert_eq!(
        result.first_page[0],
        vec![
            serde_json::json!(9_007_199_254_740_991i64),
            serde_json::json!("-9007199254740992"),
            serde_json::json!(9_007_199_254_740_991u64),
            serde_json::json!("9007199254740992"),
        ]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_query_ipc_preserves_fractional_datetime_and_mysql_time_strings() {
    let result = execute_query_via_mock(MockQueryResponse {
        query: "SELECT created_at, elapsed FROM temporal_edges LIMIT 1",
        columns: vec![
            MockColumnDef {
                name: "created_at",
                coltype: ColumnType::MYSQL_TYPE_DATETIME,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "elapsed",
                coltype: ColumnType::MYSQL_TYPE_TIME,
                colflags: ColumnFlags::empty(),
            },
        ],
        row: vec![
            MockCell::DateTime(
                NaiveDate::from_ymd_opt(2023, 10, 1)
                    .expect("date should be valid")
                    .and_hms_micro_opt(12, 34, 56, 123_456)
                    .expect("time should be valid"),
            ),
            MockCell::Time(MockTimeValue {
                negative: false,
                hours: 7,
                minutes: 15,
                seconds: 0,
                microseconds: 123_456,
            }),
        ],
    })
    .await;

    assert_eq!(result.total_rows, 1);
    assert_eq!(
        result.first_page[0],
        vec![
            serde_json::json!("2023-10-01 12:34:56.123456"),
            serde_json::json!("07:15:00.123456"),
        ]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_query_ipc_serializes_timestamp_and_negative_mysql_time_strings() {
    let result = execute_query_via_mock(MockQueryResponse {
        query: "SELECT created_at, elapsed FROM temporal_edges_negative LIMIT 1",
        columns: vec![
            MockColumnDef {
                name: "created_at",
                coltype: ColumnType::MYSQL_TYPE_TIMESTAMP,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "elapsed",
                coltype: ColumnType::MYSQL_TYPE_TIME,
                colflags: ColumnFlags::empty(),
            },
        ],
        row: vec![
            MockCell::DateTime(
                NaiveDate::from_ymd_opt(2023, 10, 2)
                    .expect("date should be valid")
                    .and_hms_micro_opt(1, 2, 3, 654_321)
                    .expect("time should be valid"),
            ),
            MockCell::Time(MockTimeValue {
                negative: true,
                hours: 27,
                minutes: 15,
                seconds: 0,
                microseconds: 123_456,
            }),
        ],
    })
    .await;

    assert_eq!(result.total_rows, 1);
    assert_eq!(
        result.first_page[0],
        vec![
            serde_json::json!("2023-10-02 01:02:03.654321"),
            serde_json::json!("-27:15:00.123456"),
        ]
    );
}
