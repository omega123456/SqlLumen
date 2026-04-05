use crate::export::{ExportOptions, ExportResult};
use crate::state::AppState;

// Re-export so existing test imports continue to work.
pub use crate::export::export_with_data;

/// Core export logic — testable without the Tauri runtime.
/// Looks up stored results by (connection_id, tab_id), clones the data
/// under a brief read lock, then delegates to format-specific writers.
pub fn export_results_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    options: ExportOptions,
    result_index: Option<usize>,
) -> Result<ExportResult, String> {
    let (columns, rows) = {
        let results = state.results.read().map_err(|e| e.to_string())?;
        let result_vec = results
            .get(&(connection_id.to_string(), tab_id.to_string()))
            .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;
        let idx = result_index.unwrap_or(0);
        let stored = result_vec
            .get(idx)
            .ok_or_else(|| format!("Result index {idx} out of range (total: {})", result_vec.len()))?;
        let cols: Vec<String> = stored.columns.iter().map(|c| c.name.clone()).collect();
        let rows = stored.rows.clone();
        (cols, rows)
    };

    export_with_data(&columns, &rows, options)
}

#[tauri::command]
pub async fn export_results(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    tab_id: String,
    options: ExportOptions,
    result_index: Option<usize>,
) -> Result<ExportResult, String> {
    // Clone data under brief lock, then release the lock before writing
    let (columns, rows) = {
        let results = state.results.read().map_err(|e| e.to_string())?;
        let result_vec = results
            .get(&(connection_id.clone(), tab_id.clone()))
            .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;
        let idx = result_index.unwrap_or(0);
        let stored = result_vec
            .get(idx)
            .ok_or_else(|| format!("Result index {idx} out of range (total: {})", result_vec.len()))?;
        let cols: Vec<String> = stored.columns.iter().map(|c| c.name.clone()).collect();
        let rows = stored.rows.clone();
        (cols, rows)
    };

    // Write file in spawn_blocking to avoid blocking the async runtime
    tokio::task::spawn_blocking(move || export_with_data(&columns, &rows, options))
        .await
        .map_err(|e| e.to_string())?
}
