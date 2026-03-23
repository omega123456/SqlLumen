//! Integration coverage for `mysql::query_log` (tracing helpers + row formatting).

mod common;

use common::mock_mysql_server::{MockCell, MockColumnDef, MockMySqlServer, MockQueryResponse};
use mysql_client_lib::mysql::query_log;
use opensrv_mysql::{ColumnFlags, ColumnType};
use sqlx::mysql::MySqlPoolOptions;
use std::sync::Once;

static TRACING: Once = Once::new();

fn ensure_tracing() {
    TRACING.call_once(|| {
        let _ = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::DEBUG)
            .with_test_writer()
            .try_init();
    });
}

#[tokio::test]
async fn query_log_simple_emitters_run() {
    ensure_tracing();
    query_log::log_outgoing_sql("SELECT 1");
    query_log::log_outgoing_sql_bound("SELECT ?", &["x".to_string()]);
    query_log::log_sqlx_describe("DESCRIBE t");
}

#[tokio::test]
async fn query_log_rows_and_execute_hit_formatting_paths() {
    ensure_tracing();
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
