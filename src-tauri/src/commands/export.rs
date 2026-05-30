use crate::export::{ExportOptions, ExportResult};
use crate::state::AppState;

// Re-export so existing test imports continue to work.
pub use crate::export::export_with_data;

/// Look up stored results by (connection_id, tab_id) and clone the export data
/// under a brief read lock.
///
/// Returns the resolved `(columns, rows)` to be written. When `row_indices` is
/// provided, only those rows (by position) are included. This supports exporting
/// only the visible/filtered rows from the frontend.
fn resolve_export_data(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    result_index: Option<usize>,
    row_indices: Option<&[usize]>,
) -> Result<(Vec<String>, Vec<Vec<serde_json::Value>>), String> {
    let cache_result = state.result_cache.get(connection_id, tab_id);
    if cache_result.is_expired() {
        return Err(
            "results_expired: Results for this tab have expired. Re-run the query to see results."
                .to_string(),
        );
    }
    let entry = cache_result
        .into_entry()
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;
    let result_vec = &entry.value;
    let idx = result_index.unwrap_or(0);
    let stored = result_vec.get(idx).ok_or_else(|| {
        format!(
            "Result index {idx} out of range (total: {})",
            result_vec.len()
        )
    })?;
    let cols: Vec<String> = stored.columns.iter().map(|c| c.name.clone()).collect();
    let rows = match row_indices {
        Some(indices) => indices
            .iter()
            .filter_map(|&i| stored.rows.get(i).cloned())
            .collect(),
        None => (*stored.rows).clone(),
    };
    Ok((cols, rows))
}

/// Core export logic — testable without the Tauri runtime.
/// Looks up stored results by (connection_id, tab_id), clones the data
/// under a brief read lock, then delegates to format-specific writers.
///
/// When `row_indices` is provided, only those rows (by position) are exported.
/// This supports exporting only the visible/filtered rows from the frontend.
pub fn export_results_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    options: ExportOptions,
    result_index: Option<usize>,
    row_indices: Option<&[usize]>,
) -> Result<ExportResult, String> {
    let (columns, rows) =
        resolve_export_data(state, connection_id, tab_id, result_index, row_indices)?;
    export_with_data(&columns, &rows, options)
}

#[tauri::command]
pub async fn export_results(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    tab_id: String,
    options: ExportOptions,
    result_index: Option<usize>,
    row_indices: Option<Vec<usize>>,
) -> Result<ExportResult, String> {
    // Clone data from cache, then release the read lock before writing.
    let (columns, rows) = resolve_export_data(
        &state,
        &connection_id,
        &tab_id,
        result_index,
        row_indices.as_deref(),
    )?;

    // Write file in spawn_blocking to avoid blocking the async runtime
    tokio::task::spawn_blocking(move || export_with_data(&columns, &rows, options))
        .await
        .map_err(|e| e.to_string())?
}
