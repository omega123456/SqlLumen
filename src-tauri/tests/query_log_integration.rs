//! Integration coverage for `mysql::query_log` (tracing helpers + row formatting).

mod common;

use chrono::NaiveDate;
use common::mock_mysql_server::{MockCell, MockColumnDef, MockMySqlServer, MockQueryResponse};
use mysql_client_lib::mysql::query_log;
use opensrv_mysql::{ColumnFlags, ColumnType};
use sqlx::mysql::MySqlPoolOptions;
use std::sync::Mutex;
use std::sync::Once;

static TRACING: Once = Once::new();
static LOG_LINES: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[derive(Clone, Default)]
struct CapturedWriter;

impl std::io::Write for CapturedWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let text = String::from_utf8_lossy(buf).into_owned();
        let mut lines = LOG_LINES.lock().expect("log capture mutex poisoned");
        lines.push(text);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn ensure_tracing() {
    TRACING.call_once(|| {
        let _ = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::DEBUG)
            .with_writer(CapturedWriter::default)
            .try_init();
    });
}

fn reset_captured_logs() {
    let mut lines = LOG_LINES.lock().expect("log capture mutex poisoned");
    lines.clear();
}

fn captured_logs() -> String {
    LOG_LINES
        .lock()
        .expect("log capture mutex poisoned")
        .join("")
}

#[tokio::test]
async fn query_log_simple_emitters_run() {
    ensure_tracing();
    reset_captured_logs();
    query_log::log_outgoing_sql("SELECT 1");
    query_log::log_outgoing_sql_bound("SELECT ?", &["x".to_string()]);
    query_log::log_sqlx_describe("DESCRIBE t");
}

#[tokio::test]
async fn query_log_rows_and_execute_hit_formatting_paths() {
    ensure_tracing();
    reset_captured_logs();
    let response = MockQueryResponse {
        query: "SELECT qlog_probe",
        columns: vec![
            MockColumnDef {
                name: "big_i",
                coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "dbl",
                coltype: ColumnType::MYSQL_TYPE_DOUBLE,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "dec_str",
                coltype: ColumnType::MYSQL_TYPE_NEWDECIMAL,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "blob_col",
                coltype: ColumnType::MYSQL_TYPE_BLOB,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "txt",
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "bad_txt",
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            },
        ],
        row: vec![
            MockCell::I64(-42),
            MockCell::F64(std::f64::consts::PI),
            MockCell::Bytes(b"99.10"),
            MockCell::Bytes(b"\xde\xad\xbe\xef"),
            MockCell::Bytes(b"plain"),
            // Invalid UTF-8 for a string column → `format_cell` decode_error branch.
            MockCell::Bytes(b"\xff\xfe"),
        ],
    };

    let server = MockMySqlServer::start(response).await;
    let url = format!(
        "mysql://root@127.0.0.1:{}/?ssl-mode=DISABLED",
        server.port
    );
    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect mock mysql");

    let rows = sqlx::query("SELECT qlog_probe")
        .fetch_all(&pool)
        .await
        .expect("fetch probe row");

    query_log::log_mysql_rows(rows.as_slice());

    let exec = sqlx::query("SELECT 1")
        .execute(&pool)
        .await
        .expect("execute");
    query_log::log_execute_result(&exec);

    pool.close().await;
}

#[tokio::test]
async fn query_log_formats_timestamp_columns_without_decode_errors() {
    ensure_tracing();
    reset_captured_logs();
    let response = MockQueryResponse {
        query: "SELECT temporal_probe",
        columns: vec![
            MockColumnDef {
                name: "created_at",
                coltype: ColumnType::MYSQL_TYPE_TIMESTAMP,
                colflags: ColumnFlags::NOT_NULL_FLAG,
            },
            MockColumnDef {
                name: "updated_at",
                coltype: ColumnType::MYSQL_TYPE_TIMESTAMP,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "is_admin",
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            },
        ],
        row: vec![
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
            MockCell::Bytes(b"false"),
        ],
    };

    let server = MockMySqlServer::start(response).await;
    let url = format!(
        "mysql://root@127.0.0.1:{}/?ssl-mode=DISABLED",
        server.port
    );
    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect mock mysql");

    let row = sqlx::query("SELECT temporal_probe")
        .fetch_one(&pool)
        .await
        .expect("fetch probe row");

    query_log::log_mysql_row(&row);

    let logs = captured_logs();
    assert!(logs.contains("created_at=Some(\"2024-01-01 00:00:00\")"));
    assert!(logs.contains("updated_at=Some(\"2024-01-02 03:04:05\")"));
    assert!(!logs.contains("created_at=<decode_error"));
    assert!(!logs.contains("updated_at=<decode_error"));

    pool.close().await;
}
