#![cfg(not(coverage))]

mod common;

use async_trait::async_trait;
use chrono::NaiveDate;
use mysql_client_lib::commands::connections::{save_connection_impl, SaveConnectionInput};
use mysql_client_lib::commands::mysql::{open_connection_impl, OpenConnectionResult};
use mysql_client_lib::mysql::query_executor::{execute_query_impl, ExecuteQueryResult};
use mysql_client_lib::mysql::registry::ConnectionRegistry;
use mysql_client_lib::state::AppState;
use opensrv_mysql::{
    AsyncMysqlIntermediary, AsyncMysqlShim, Column, ColumnFlags, ColumnType, OkResponse,
    ParamParser, QueryResultWriter, StatementMetaWriter, ToMysqlValue,
};
use rusqlite::Connection;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;
use std::io;
use std::io::Write;
use std::sync::{Arc, Mutex};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tokio::io::BufWriter;
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::TcpListener;

fn test_state() -> AppState {
    common::ensure_fake_backend_once();
    let conn = Connection::open_in_memory().expect("should open in-memory db");
    mysql_client_lib::db::migrations::run_migrations(&conn).expect("should run migrations");
    AppState {
        db: Mutex::new(conn),
        registry: ConnectionRegistry::new(),
        app_handle: None,
        results: std::sync::RwLock::new(std::collections::HashMap::new()),
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

#[derive(Debug, Clone)]
struct MockColumnDef {
    name: &'static str,
    coltype: ColumnType,
    colflags: ColumnFlags,
}

#[derive(Debug, Clone)]
enum MockCell {
    U32(u32),
    I64(i64),
    U64(u64),
    DateTime(chrono::NaiveDateTime),
    Time(MockTimeValue),
    Bytes(&'static [u8]),
}

#[derive(Debug, Clone, Copy)]
struct MockTimeValue {
    negative: bool,
    hours: u32,
    minutes: u8,
    seconds: u8,
    microseconds: u32,
}

impl MockTimeValue {
    fn format_text(self) -> String {
        let sign = if self.negative { "-" } else { "" };
        if self.microseconds == 0 {
            format!(
                "{sign}{:02}:{:02}:{:02}",
                self.hours, self.minutes, self.seconds
            )
        } else {
            format!(
                "{sign}{:02}:{:02}:{:02}.{:06}",
                self.hours, self.minutes, self.seconds, self.microseconds
            )
        }
    }

    fn day_hour_parts(self) -> (u32, u8) {
        ((self.hours / 24), (self.hours % 24) as u8)
    }
}

impl ToMysqlValue for MockTimeValue {
    fn to_mysql_text<W: Write>(&self, w: &mut W) -> io::Result<()> {
        write_lenenc_str(w, self.format_text().as_bytes())
    }

    fn to_mysql_bin<W: Write>(&self, w: &mut W, c: &Column) -> io::Result<()> {
        if c.coltype != ColumnType::MYSQL_TYPE_TIME {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("tried to use {:?} as {:?}", self, c.coltype),
            ));
        }

        let (days, hours) = self.day_hour_parts();
        let has_fraction = self.microseconds != 0;

        w.write_all(&[if has_fraction { 12 } else { 8 }])?;
        w.write_all(&[u8::from(self.negative)])?;
        w.write_all(&days.to_le_bytes())?;
        w.write_all(&[hours, self.minutes, self.seconds])?;

        if has_fraction {
            w.write_all(&self.microseconds.to_le_bytes())?;
        }

        Ok(())
    }
}

fn write_lenenc_str<W: Write>(w: &mut W, bytes: &[u8]) -> io::Result<()> {
    write_lenenc_int(w, bytes.len() as u64)?;
    w.write_all(bytes)
}

fn write_lenenc_int<W: Write>(w: &mut W, value: u64) -> io::Result<()> {
    match value {
        0..=250 => w.write_all(&[value as u8]),
        251..=65_535 => {
            w.write_all(&[0xFC])?;
            w.write_all(&(value as u16).to_le_bytes())
        }
        65_536..=16_777_215 => {
            w.write_all(&[0xFD])?;
            let bytes = value.to_le_bytes();
            w.write_all(&bytes[..3])
        }
        _ => {
            w.write_all(&[0xFE])?;
            w.write_all(&value.to_le_bytes())
        }
    }
}

#[derive(Debug, Clone)]
struct MockQueryResponse {
    query: &'static str,
    columns: Vec<MockColumnDef>,
    row: Vec<MockCell>,
}

#[derive(Clone)]
struct MockMySqlBackend {
    response: Arc<MockQueryResponse>,
}

const VERSION_STATEMENT_ID: u32 = 1;
const QUERY_STATEMENT_ID: u32 = 2;
const EMPTY_STATEMENT_ID: u32 = 3;

impl MockMySqlBackend {
    fn new(response: MockQueryResponse) -> Self {
        Self {
            response: Arc::new(response),
        }
    }

    fn response_columns(&self) -> Vec<Column> {
        self.response
            .columns
            .iter()
            .map(|col| Column {
                table: String::new(),
                column: col.name.to_string(),
                coltype: col.coltype,
                colflags: col.colflags,
            })
            .collect()
    }

    async fn write_response(
        &self,
        results: QueryResultWriter<'_, BufWriter<OwnedWriteHalf>>,
    ) -> io::Result<()> {
        let columns = self.response_columns();

        let mut writer = results.start(&columns).await?;
        for cell in &self.response.row {
            match cell {
                MockCell::U32(value) => writer.write_col(*value)?,
                MockCell::I64(value) => writer.write_col(*value)?,
                MockCell::U64(value) => writer.write_col(*value)?,
                MockCell::DateTime(value) => writer.write_col(*value)?,
                MockCell::Time(value) => writer.write_col(*value)?,
                MockCell::Bytes(value) => writer.write_col(*value)?,
            }
        }
        writer.finish().await
    }
}

#[async_trait]
impl AsyncMysqlShim<BufWriter<OwnedWriteHalf>> for MockMySqlBackend {
    type Error = io::Error;

    async fn on_prepare<'a>(
        &'a mut self,
        query: &'a str,
        info: StatementMetaWriter<'a, BufWriter<OwnedWriteHalf>>,
    ) -> Result<(), Self::Error> {
        let normalized = query.trim().trim_end_matches(';');

        if normalized.eq_ignore_ascii_case("SELECT VERSION()") {
            let columns = vec![Column {
                table: String::new(),
                column: "VERSION()".to_string(),
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            }];
            return info.reply(VERSION_STATEMENT_ID, &[], &columns).await;
        }

        if normalized.eq_ignore_ascii_case(self.response.query) {
            let columns = self.response_columns();
            return info.reply(QUERY_STATEMENT_ID, &[], &columns).await;
        }

        info.reply(EMPTY_STATEMENT_ID, &[], &[]).await
    }

    async fn on_execute<'a>(
        &'a mut self,
        id: u32,
        _params: ParamParser<'a>,
        results: QueryResultWriter<'a, BufWriter<OwnedWriteHalf>>,
    ) -> Result<(), Self::Error> {
        if id == VERSION_STATEMENT_ID {
            let cols = [Column {
                table: String::new(),
                column: "VERSION()".to_string(),
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            }];
            let mut writer = results.start(&cols).await?;
            writer.write_col(b"8.0.36-mock".as_slice())?;
            return writer.finish().await;
        }

        if id == QUERY_STATEMENT_ID {
            return self.write_response(results).await;
        }

        results.completed(OkResponse::default()).await
    }

    async fn on_close<'a>(&'a mut self, _stmt: u32) {}

    async fn on_query<'a>(
        &'a mut self,
        query: &'a str,
        results: QueryResultWriter<'a, BufWriter<OwnedWriteHalf>>,
    ) -> Result<(), Self::Error> {
        let normalized = query.trim().trim_end_matches(';');

        if normalized.eq_ignore_ascii_case("SELECT VERSION()") {
            let cols = [Column {
                table: String::new(),
                column: "VERSION()".to_string(),
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            }];
            let mut writer = results.start(&cols).await?;
            writer.write_col("8.0.36-mock")?;
            return writer.finish().await;
        }

        if normalized.eq_ignore_ascii_case(self.response.query) {
            return self.write_response(results).await;
        }

        results.completed(OkResponse::default()).await
    }
}

struct MockMySqlServer {
    port: u16,
    accept_task: tokio::task::JoinHandle<()>,
}

impl MockMySqlServer {
    async fn start(response: MockQueryResponse) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("should bind mock mysql server");
        let port = listener
            .local_addr()
            .expect("should read local addr")
            .port();
        let backend = MockMySqlBackend::new(response);

        let accept_task = tokio::spawn(async move {
            loop {
                let (stream, _) = match listener.accept().await {
                    Ok(parts) => parts,
                    Err(_) => break,
                };
                let backend = backend.clone();
                tokio::spawn(async move {
                    let (reader, writer) = stream.into_split();
                    let writer = BufWriter::new(writer);
                    if let Err(error) = AsyncMysqlIntermediary::run_on(backend, reader, writer).await {
                        eprintln!("mock mysql server error: {error}");
                    }
                });
            }
        });

        Self { port, accept_task }
    }
}

impl Drop for MockMySqlServer {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
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
