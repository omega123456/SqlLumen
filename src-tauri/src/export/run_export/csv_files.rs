use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::export::stream_writer::{RowSink, RowSinkSpec};
use crate::export::ExportFormat;
use crate::mysql::cell_values::{cached_binary_cell_as_hex, is_binary_data_type};
use crate::mysql::query_executor::ColumnMeta;

const CSV_NULL_MARKER: &str = "\\N";
const RESULT_FILE_PREFIX: &str = "result";
const CSV_EXTENSION: &str = "csv";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResultFileKey {
    pub statement_index: usize,
    pub set_number: Option<usize>,
}

impl ResultFileKey {
    pub fn file_name(&self) -> String {
        let statement_number = self.statement_index + 1;
        let Some(set_number) = self.set_number else {
            return format!("{RESULT_FILE_PREFIX}-{statement_number}.{CSV_EXTENSION}");
        };
        format!("{RESULT_FILE_PREFIX}-{statement_number}-{set_number}.{CSV_EXTENSION}")
    }
}

#[derive(Debug, Clone)]
pub struct ResultFileRecord {
    pub key: ResultFileKey,
    pub path: PathBuf,
    pub rows_written: usize,
    pub bytes_written: u64,
    pub is_complete: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteFailure {
    pub key: ResultFileKey,
    pub message: String,
}

struct OpenResultFile {
    key: ResultFileKey,
    path: PathBuf,
    sink: RowSink,
    binary_columns: Vec<bool>,
    rows_written: usize,
}

pub struct RunFiles {
    folder: PathBuf,
    open: Option<OpenResultFile>,
    records: Vec<ResultFileRecord>,
    write_failure: Option<WriteFailure>,
}

impl RunFiles {
    pub fn new(folder: &Path) -> Self {
        Self {
            folder: folder.to_path_buf(),
            open: None,
            records: Vec::new(),
            write_failure: None,
        }
    }

    pub fn open_result(
        &mut self,
        key: ResultFileKey,
        columns: &[ColumnMeta],
    ) -> Result<(), String> {
        self.close_result(false);
        let path = self.folder.join(key.file_name());
        let column_names: Vec<String> = columns.iter().map(|column| column.name.clone()).collect();
        let created = RowSink::create(&RowSinkSpec {
            format: &ExportFormat::Csv,
            path: &path,
            columns: &column_names,
            include_headers: true,
            table_name: None,
        });
        let sink = created.map_err(|error| self.fail(key, &error))?;
        let binary_columns = binary_column_flags(columns);
        let rows_written = 0;
        self.open = Some(OpenResultFile {
            key,
            path,
            sink,
            binary_columns,
            rows_written,
        });
        Ok(())
    }

    pub fn write_row(&mut self, row: &[Value]) -> Result<(), String> {
        let Some(open) = self.open.as_mut() else {
            return Ok(());
        };
        let cells = agent_cells(row, &open.binary_columns);
        let written = open.sink.write_row(&cells);
        let Err(error) = written else {
            open.rows_written += 1;
            return Ok(());
        };
        let key = open.key;
        Err(self.fail(key, &error))
    }

    pub fn close_result(&mut self, is_complete: bool) {
        let Some(open) = self.open.take() else {
            return;
        };
        let OpenResultFile {
            key,
            path,
            sink,
            rows_written,
            ..
        } = open;
        let finished = sink.finish();
        let bytes_written = finished
            .as_ref()
            .map(|summary| summary.bytes_written)
            .unwrap_or_default();
        let is_flushed = finished.is_ok();
        if let Err(error) = finished {
            self.fail(key, &error);
        }
        let is_complete = is_complete && is_flushed;
        self.records.push(ResultFileRecord {
            key,
            path,
            rows_written,
            bytes_written,
            is_complete,
        });
    }

    pub fn rows_written(&self) -> usize {
        let closed_rows: usize = self.records.iter().map(|record| record.rows_written).sum();
        let open_rows = self.open.as_ref().map_or(0, |open| open.rows_written);
        closed_rows + open_rows
    }

    pub fn bytes_written(&self) -> u64 {
        let closed_bytes: u64 = self.records.iter().map(|record| record.bytes_written).sum();
        let open_bytes = self
            .open
            .as_ref()
            .map_or(0, |open| open.sink.bytes_written());
        closed_bytes + open_bytes
    }

    pub fn records(&self) -> &[ResultFileRecord] {
        &self.records
    }

    pub fn write_failure(&self) -> Option<&WriteFailure> {
        self.write_failure.as_ref()
    }

    fn fail(&mut self, key: ResultFileKey, error: &str) -> String {
        let message = format!("Couldn't write {}: {error}", key.file_name());
        let returned_message = message.clone();
        let is_first_failure = self.write_failure.is_none();
        if is_first_failure {
            self.write_failure = Some(WriteFailure { key, message });
        }
        returned_message
    }
}

fn binary_column_flags(columns: &[ColumnMeta]) -> Vec<bool> {
    columns
        .iter()
        .map(|column| is_binary_data_type(&column.data_type))
        .collect()
}

fn agent_cells(row: &[Value], binary_columns: &[bool]) -> Vec<Value> {
    row.iter()
        .zip(binary_columns)
        .map(|(cell, is_binary)| agent_cell(cell, *is_binary))
        .collect()
}

fn agent_cell(cell: &Value, is_binary: bool) -> Value {
    if cell.is_null() {
        return Value::String(CSV_NULL_MARKER.to_string());
    }
    if !is_binary {
        return cell.clone();
    }
    cached_binary_cell_as_hex(cell)
        .map(Value::String)
        .unwrap_or_else(|| cell.clone())
}
