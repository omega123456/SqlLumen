//! Mock query steps for the table-metadata reads behind table-data page fetches.

#![cfg(not(coverage))]

use crate::common::mock_mysql_server::{MockCell, MockColumnDef, MockQueryStep};
use opensrv_mysql::{ColumnFlags, ColumnType};

pub const INFO_SCHEMA_COLUMNS_QUERY: &str = "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION";
pub const PRIMARY_KEY_QUERY: &str = "SELECT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY' ORDER BY kcu.ORDINAL_POSITION";

pub fn info_schema_columns_step(rows: Vec<Vec<MockCell>>) -> MockQueryStep {
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

pub fn nullable_column_row(
    name: &'static [u8],
    data_type: &'static [u8],
    column_type: &'static [u8],
) -> Vec<MockCell> {
    vec![
        MockCell::Bytes(name),
        MockCell::Bytes(data_type),
        MockCell::Bytes(column_type),
        MockCell::Bytes(b"YES"),
        MockCell::Bytes(b""),
        MockCell::Null,
        MockCell::Bytes(b""),
    ]
}

pub fn primary_key_step(pk_column: &'static [u8]) -> MockQueryStep {
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
