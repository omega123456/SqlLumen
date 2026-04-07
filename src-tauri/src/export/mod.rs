pub mod csv_writer;
pub mod json_writer;
pub mod sql_dump;
pub mod sql_import;
pub mod sql_writer;
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
    /// Parse a format string into an `ExportFormat`.
    ///
    /// Accepts both the kebab-case serde names (`"sql-insert"`) and the
    /// short names used by the table-data export path (`"sql"`).
    pub fn from_format_str(s: &str) -> Result<Self, String> {
        match s {
            "csv" => Ok(Self::Csv),
            "json" => Ok(Self::Json),
            "xlsx" => Ok(Self::Xlsx),
            "sql" | "sql-insert" => Ok(Self::SqlInsert),
            _ => Err(format!("Unknown export format: '{s}'")),
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

/// Write columns/rows to disk using the specified format.
///
/// This is the shared export dispatcher used by both the query-result export
/// path (`commands::export`) and the table-data export path
/// (`mysql::table_data::export_table_data_impl`).
pub fn export_with_data(
    columns: &[String],
    rows: &[Vec<serde_json::Value>],
    options: ExportOptions,
) -> Result<ExportResult, String> {
    let rows_exported = rows.len();

    let bytes_written = match options.format {
        ExportFormat::Csv => {
            let mut file = std::fs::File::create(&options.file_path)
                .map_err(|e| format!("Failed to create file: {e}"))?;
            csv_writer::write_csv(&mut file, columns, rows, options.include_headers)
                .map_err(|e| format!("Failed to write CSV: {e}"))?;
            file.flush()
                .map_err(|e| format!("Failed to flush file: {e}"))?;
            std::fs::metadata(&options.file_path)
                .map_err(|e| format!("Failed to read file size: {e}"))?
                .len()
        }
        ExportFormat::Json => {
            let mut file = std::fs::File::create(&options.file_path)
                .map_err(|e| format!("Failed to create file: {e}"))?;
            json_writer::write_json(&mut file, columns, rows, options.include_headers)
                .map_err(|e| format!("Failed to write JSON: {e}"))?;
            file.flush()
                .map_err(|e| format!("Failed to flush file: {e}"))?;
            std::fs::metadata(&options.file_path)
                .map_err(|e| format!("Failed to read file size: {e}"))?
                .len()
        }
        ExportFormat::Xlsx => {
            xlsx_writer::write_xlsx(&options.file_path, columns, rows, options.include_headers)?
        }
        ExportFormat::SqlInsert => {
            let table_name = options.table_name.as_deref().unwrap_or("exported_results");
            let mut file = std::fs::File::create(&options.file_path)
                .map_err(|e| format!("Failed to create file: {e}"))?;
            sql_writer::write_sql(
                &mut file,
                columns,
                rows,
                options.include_headers,
                table_name,
            )
            .map_err(|e| format!("Failed to write SQL: {e}"))?;
            file.flush()
                .map_err(|e| format!("Failed to flush file: {e}"))?;
            std::fs::metadata(&options.file_path)
                .map_err(|e| format!("Failed to read file size: {e}"))?
                .len()
        }
    };

    Ok(ExportResult {
        bytes_written,
        rows_exported,
    })
}
