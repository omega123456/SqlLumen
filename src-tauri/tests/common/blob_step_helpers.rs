//! Shared helpers for the binary/BLOB integration test suites.
//!
//! These build mock MySQL query steps for the `len`/`val` blob-fetch shape and
//! connect a `sqlx` pool to an in-process [`MockMySqlServer`]. They are gated on
//! `#[cfg(not(coverage))]` to match the suites that consume them, which exercise
//! the in-process mock server only outside coverage instrumentation.

#![cfg(not(coverage))]

use crate::common::mock_mysql_server::{MockCell, MockColumnDef, MockMySqlServer, MockQueryStep};
use opensrv_mysql::{ColumnFlags, ColumnType};
use sqllumen_lib::mysql::pool::set_test_pool_factory;
use sqlx::mysql::MySqlPoolOptions;

/// Connect a single-connection `sqlx` pool to the mock server, clearing any
/// installed test pool factory first so the real connector is used.
pub async fn connect_mock_pool(server: &MockMySqlServer) -> sqlx::MySqlPool {
    set_test_pool_factory(None);
    MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&format!("mysql://root@127.0.0.1:{}/app_db", server.port))
        .await
        .expect("should connect to mock mysql server")
}

/// Build the `OCTET_LENGTH(...) AS len` query step returning a single cell.
pub fn len_step(query: &'static str, cell: MockCell) -> MockQueryStep {
    MockQueryStep {
        query,
        columns: vec![MockColumnDef {
            name: "len",
            coltype: ColumnType::MYSQL_TYPE_LONGLONG,
            colflags: ColumnFlags::empty(),
        }],
        rows: vec![vec![cell]],
        error: None,
        affected_rows: None,
    }
}

/// Build the `<col> AS val` blob value query step returning a single cell.
pub fn val_step(query: &'static str, cell: MockCell) -> MockQueryStep {
    MockQueryStep {
        query,
        columns: vec![MockColumnDef {
            name: "val",
            coltype: ColumnType::MYSQL_TYPE_BLOB,
            colflags: ColumnFlags::BINARY_FLAG,
        }],
        rows: vec![vec![cell]],
        error: None,
        affected_rows: None,
    }
}
