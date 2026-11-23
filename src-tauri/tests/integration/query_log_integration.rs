//! Integration coverage for `mysql::query_log` (tracing helpers + row formatting).

use crate::common::log_capture::LogCaptureGuard;
#[cfg(not(coverage))]
use crate::common::mock_mysql_server::{
    MockCell, MockColumnDef, MockDateTimeValue, MockMySqlServer, MockQueryResponse,
};
#[cfg(not(coverage))]
use jiff::civil;
#[cfg(not(coverage))]
use opensrv_mysql::{ColumnFlags, ColumnType};
#[cfg(not(coverage))]
use sqllumen_lib::mysql::logged_query::{LoggedStatement, fetch_all_pooled};
use sqllumen_lib::mysql::query_log;

#[tokio::test]
async fn query_log_simple_emitters_run() {
    let _capture = LogCaptureGuard::start();
    query_log::log_outgoing_sql("SELECT 1");
    query_log::log_outgoing_sql_bound("SELECT ?", &["x".to_string()]);
    query_log::log_mysql_async_result(1, Some(7));
}

#[cfg(not(coverage))]
fn plain_column(name: &'static str, coltype: ColumnType) -> MockColumnDef {
    MockColumnDef {
        name,
        coltype,
        colflags: ColumnFlags::empty(),
    }
}

#[cfg(not(coverage))]
#[tokio::test]
async fn query_log_rows_and_execute_hit_formatting_paths() {
    let capture = LogCaptureGuard::start();
    let response = MockQueryResponse {
        query: "SELECT qlog_probe",
        columns: vec![
            plain_column("big_i", ColumnType::MYSQL_TYPE_LONGLONG),
            plain_column("dbl", ColumnType::MYSQL_TYPE_DOUBLE),
            plain_column("dec_str", ColumnType::MYSQL_TYPE_NEWDECIMAL),
            plain_column("blob_col", ColumnType::MYSQL_TYPE_BLOB),
            plain_column("txt", ColumnType::MYSQL_TYPE_VAR_STRING),
            plain_column("bad_txt", ColumnType::MYSQL_TYPE_VAR_STRING),
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
    let pool = crate::common::mock_session::mock_pool(server.port);

    let rows = fetch_all_pooled(&pool, LoggedStatement::text("SELECT qlog_probe"))
        .await
        .expect("fetch probe row");

    query_log::log_mysql_async_rows(rows.as_slice());
    let logs = capture.contents();
    assert!(logs.contains("big_i=Some(-42)"), "{logs}");
    assert!(logs.contains("dec_str=Some(\"99.10\")"), "{logs}");
    assert!(
        logs.contains("bad_txt=Some(\"\u{fffd}\u{fffd}\")"),
        "{logs}"
    );

    pool.disconnect().await.expect("pool disconnects");
}

#[cfg(not(coverage))]
#[tokio::test]
async fn query_log_formats_timestamp_columns_without_decode_errors() {
    let capture = LogCaptureGuard::start();
    let response = MockQueryResponse {
        query: "SELECT temporal_probe",
        columns: vec![
            MockColumnDef {
                name: "created_at",
                coltype: ColumnType::MYSQL_TYPE_TIMESTAMP,
                colflags: ColumnFlags::NOT_NULL_FLAG,
            },
            plain_column("updated_at", ColumnType::MYSQL_TYPE_TIMESTAMP),
            plain_column("is_admin", ColumnType::MYSQL_TYPE_VAR_STRING),
        ],
        row: vec![
            MockCell::DateTime(MockDateTimeValue(civil::date(2024, 1, 1).at(0, 0, 0, 0))),
            MockCell::DateTime(MockDateTimeValue(civil::date(2024, 1, 2).at(3, 4, 5, 0))),
            MockCell::Bytes(b"false"),
        ],
    };

    let server = MockMySqlServer::start(response).await;
    let pool = crate::common::mock_session::mock_pool(server.port);

    let rows = fetch_all_pooled(&pool, LoggedStatement::text("SELECT temporal_probe"))
        .await
        .expect("fetch probe row");

    query_log::log_mysql_async_rows(&rows);

    let logs = capture.contents();
    assert!(logs.contains("created_at=Some(\"2024-01-01 00:00:00\")"));
    assert!(logs.contains("updated_at=Some(\"2024-01-02 03:04:05\")"));
    assert!(!logs.contains("created_at=<decode_error"));
    assert!(!logs.contains("updated_at=<decode_error"));

    pool.disconnect().await.expect("pool disconnects");
}

#[cfg(not(coverage))]
#[tokio::test]
async fn query_log_formats_decimal_columns_without_decode_errors() {
    let capture = LogCaptureGuard::start();
    let response = MockQueryResponse {
        query: "SELECT decimal_probe",
        columns: vec![
            MockColumnDef {
                name: "id",
                coltype: ColumnType::MYSQL_TYPE_LONG,
                colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::UNSIGNED_FLAG,
            },
            MockColumnDef {
                name: "type",
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::NOT_NULL_FLAG,
            },
            plain_column("consumption", ColumnType::MYSQL_TYPE_NEWDECIMAL),
            plain_column("cost", ColumnType::MYSQL_TYPE_NEWDECIMAL),
            plain_column("created_at", ColumnType::MYSQL_TYPE_TIMESTAMP),
        ],
        row: vec![
            MockCell::U32(128),
            MockCell::Bytes(b"gas"),
            MockCell::Bytes(b"123.45"),
            MockCell::Bytes(b"67.89"),
            MockCell::DateTime(MockDateTimeValue(civil::date(2023, 12, 3).at(0, 0, 0, 0))),
        ],
    };

    let server = MockMySqlServer::start(response).await;
    let pool = crate::common::mock_session::mock_pool(server.port);

    let rows = fetch_all_pooled(&pool, LoggedStatement::text("SELECT decimal_probe"))
        .await
        .expect("fetch probe row");

    query_log::log_mysql_async_rows(&rows);

    let logs = capture.contents();
    assert!(logs.contains("consumption=Some(\"123.45\")"));
    assert!(logs.contains("cost=Some(\"67.89\")"));
    assert!(!logs.contains("consumption=<decode_error"));
    assert!(!logs.contains("cost=<decode_error"));

    pool.disconnect().await.expect("pool disconnects");
}
