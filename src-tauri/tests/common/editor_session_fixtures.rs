//! Mock-server steps and editor requests shared by the editor-session suites.

use opensrv_mysql::{ColumnFlags, ColumnType};
use sqllumen_lib::mysql::query_executor::{ExecuteCallQueryRequest, ExecuteQueryRequest};

use crate::common::mock_mysql_server::{
    MockCell, MockColumnDef, MockQueryStep, MockStreamRows, MockStreamStep,
};

pub const EDITOR_TAB: &str = "tab-1";
pub const EDITOR_ROW_LIMIT: usize = 500;

pub fn n_column() -> Vec<MockColumnDef> {
    vec![MockColumnDef {
        name: "n",
        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
        colflags: ColumnFlags::empty(),
    }]
}

pub fn n_row(index: usize) -> Vec<MockCell> {
    vec![MockCell::I64(index as i64)]
}

pub fn n_stream(query: &'static str, count: usize) -> MockStreamStep {
    MockStreamStep::new(
        query,
        n_column(),
        MockStreamRows {
            count,
            make_row: n_row,
        },
    )
}

pub fn connection_id_step() -> MockQueryStep {
    MockQueryStep::with_rows(
        "SELECT CONNECTION_ID()",
        vec![MockColumnDef {
            name: "CONNECTION_ID()",
            coltype: ColumnType::MYSQL_TYPE_LONGLONG,
            colflags: ColumnFlags::UNSIGNED_FLAG,
        }],
        vec![vec![MockCell::U64(42)]],
    )
}

pub fn database_step(database: Option<&'static [u8]>) -> MockQueryStep {
    MockQueryStep::with_rows(
        "SELECT DATABASE()",
        vec![MockColumnDef {
            name: "DATABASE()",
            coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
            colflags: ColumnFlags::empty(),
        }],
        vec![vec![database.map_or(MockCell::Null, MockCell::Bytes)]],
    )
}

pub fn single_row_step(query: &'static str) -> MockQueryStep {
    MockQueryStep::with_rows(query, n_column(), vec![vec![MockCell::I64(1)]])
}

pub fn editor_query(connection_id: &str, sql: &str) -> ExecuteQueryRequest {
    ExecuteQueryRequest {
        connection_id: connection_id.to_string(),
        tab_id: EDITOR_TAB.to_string(),
        sql: sql.to_string(),
        row_limit: Some(EDITOR_ROW_LIMIT),
        view_spec: None,
    }
}

pub fn call_query(connection_id: &str, sql: &str) -> ExecuteCallQueryRequest {
    ExecuteCallQueryRequest {
        connection_id: connection_id.to_string(),
        tab_id: EDITOR_TAB.to_string(),
        sql: sql.to_string(),
        row_limit: Some(EDITOR_ROW_LIMIT),
    }
}
