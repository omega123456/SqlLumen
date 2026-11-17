pub mod copy_to_host;
pub mod csv_writer;
pub mod job_retention;
pub mod json_writer;
pub mod result_export;
pub mod run_export;
pub mod sql_dump;
pub mod sql_import;
pub mod sql_writer;
pub mod stream_writer;
pub mod xlsx_writer;

use serde::{Deserialize, Serialize};
use std::io::Write;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ExportFormat {
    Csv,
    Json,
    Xlsx,
    SqlInsert,
}

impl ExportFormat {
    pub fn from_format_str(format: &str) -> Result<Self, String> {
        match format {
            "csv" => Ok(Self::Csv),
            "json" => Ok(Self::Json),
            "xlsx" => Ok(Self::Xlsx),
            "sql" | "sql-insert" => Ok(Self::SqlInsert),
            _ => Err(format!("Unknown export format: '{format}'")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub format: ExportFormat,
    pub file_path: String,
    pub include_headers: bool,
    pub table_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub bytes_written: u64,
    pub rows_exported: usize,
}

const DEFAULT_SQL_EXPORT_TABLE_NAME: &str = "exported_results";

fn write_export_file(
    file_path: &str,
    format_label: &str,
    write: impl FnOnce(&mut std::fs::File) -> std::io::Result<()>,
) -> Result<u64, String> {
    let mut file = std::fs::File::create(file_path)
        .map_err(|error| format!("Failed to create file: {error}"))?;
    write(&mut file).map_err(|error| format!("Failed to write {format_label}: {error}"))?;
    file.flush()
        .map_err(|error| format!("Failed to flush file: {error}"))?;
    let metadata = std::fs::metadata(file_path)
        .map_err(|error| format!("Failed to read file size: {error}"))?;
    Ok(metadata.len())
}

pub struct ExportRows<'a, R> {
    pub columns: &'a [String],
    pub rows: &'a [R],
}

pub fn export_with_data<R: AsRef<[serde_json::Value]>>(
    columns: &[String],
    rows: &[R],
    options: ExportOptions,
) -> Result<ExportResult, String> {
    let rows_exported = rows.len();
    let table = ExportRows { columns, rows };

    let bytes_written = match options.format {
        ExportFormat::Csv => write_export_file(&options.file_path, "CSV", |file| {
            csv_writer::write_csv(file, &table, options.include_headers)
        })?,
        ExportFormat::Json => write_export_file(&options.file_path, "JSON", |file| {
            json_writer::write_json(file, &table)
        })?,
        ExportFormat::Xlsx => {
            xlsx_writer::write_xlsx(&options.file_path, &table, options.include_headers)?
        }
        ExportFormat::SqlInsert => {
            let table_name = options
                .table_name
                .as_deref()
                .unwrap_or(DEFAULT_SQL_EXPORT_TABLE_NAME);
            write_export_file(&options.file_path, "SQL", |file| {
                sql_writer::write_sql(file, &table, table_name)
            })?
        }
    };

    Ok(ExportResult {
        bytes_written,
        rows_exported,
    })
}
