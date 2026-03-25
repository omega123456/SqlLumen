use crate::export::{ExportFormat, ExportOptions, ExportResult};
use crate::state::AppState;
use std::io::Write;

/// Core export logic — testable without the Tauri runtime.
/// Looks up stored results by (connection_id, tab_id), clones the data
/// under a brief read lock, then delegates to format-specific writers.
pub fn export_results_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    options: ExportOptions,
) -> Result<ExportResult, String> {
    let (columns, rows) = {
        let results = state.results.read().map_err(|e| e.to_string())?;
        let stored = results
            .get(&(connection_id.to_string(), tab_id.to_string()))
            .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;
        let cols: Vec<String> = stored.columns.iter().map(|c| c.name.clone()).collect();
        let rows = stored.rows.clone();
        (cols, rows)
    };

    export_with_data(&columns, &rows, options)
}

/// Write export data to disk. Separated from `export_results_impl` so that
/// the `#[tauri::command]` wrapper can clone data under a brief lock and
/// then run this in `spawn_blocking` without holding the lock.
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
            crate::export::csv_writer::write_csv(
                &mut file,
                columns,
                rows,
                options.include_headers,
            )
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
            crate::export::json_writer::write_json(
                &mut file,
                columns,
                rows,
                options.include_headers,
            )
            .map_err(|e| format!("Failed to write JSON: {e}"))?;
            file.flush()
                .map_err(|e| format!("Failed to flush file: {e}"))?;
            std::fs::metadata(&options.file_path)
                .map_err(|e| format!("Failed to read file size: {e}"))?
                .len()
        }
        ExportFormat::Xlsx => crate::export::xlsx_writer::write_xlsx(
            &options.file_path,
            columns,
            rows,
            options.include_headers,
        )?,
        ExportFormat::SqlInsert => {
            let table_name = options.table_name.as_deref().unwrap_or("exported_results");
            let mut file = std::fs::File::create(&options.file_path)
                .map_err(|e| format!("Failed to create file: {e}"))?;
            crate::export::sql_writer::write_sql(
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

#[tauri::command]
pub async fn export_results(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    tab_id: String,
    options: ExportOptions,
) -> Result<ExportResult, String> {
    // Clone data under brief lock, then release the lock before writing
    let (columns, rows) = {
        let results = state.results.read().map_err(|e| e.to_string())?;
        let stored = results
            .get(&(connection_id.clone(), tab_id.clone()))
            .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;
        let cols: Vec<String> = stored.columns.iter().map(|c| c.name.clone()).collect();
        let rows = stored.rows.clone();
        (cols, rows)
    };

    // Write file in spawn_blocking to avoid blocking the async runtime
    tokio::task::spawn_blocking(move || export_with_data(&columns, &rows, options))
        .await
        .map_err(|e| e.to_string())?
}
