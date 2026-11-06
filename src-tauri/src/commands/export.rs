use crate::export::{ExportOptions, ExportResult};
use crate::mysql::query_executor::SharedRow;
use crate::state::AppState;

// Re-export so existing test imports continue to work.
pub use crate::export::export_with_data;

/// Look up stored results by (connection_id, tab_id) and copy the row pointers
/// of the result's **current view** (sort and filter applied, deleted rows
/// excluded). Row data is shared, not cloned.
fn resolve_export_data(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    result_index: Option<usize>,
) -> Result<(Vec<String>, Vec<SharedRow>), String> {
    let cache_result = state.result_cache.get(connection_id, tab_id);
    if cache_result.is_expired() {
        return Err(crate::mysql::result_view::RESULTS_EXPIRED_MESSAGE.to_string());
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
    Ok((cols, crate::mysql::result_view::view_rows(stored)))
}

/// Core export logic — testable without the Tauri runtime.
/// Looks up stored results by (connection_id, tab_id), copies the current
/// view's row pointers, then delegates to format-specific writers.
pub fn export_results_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    options: ExportOptions,
    result_index: Option<usize>,
) -> Result<ExportResult, String> {
    let (columns, rows) = resolve_export_data(state, connection_id, tab_id, result_index)?;
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
    // Copy the view's row pointers from the cache, then release it before writing.
    let (columns, rows) = resolve_export_data(&state, &connection_id, &tab_id, result_index)?;

    // Write file in spawn_blocking to avoid blocking the async runtime
    tokio::task::spawn_blocking(move || export_with_data(&columns, &rows, options))
        .await
        .map_err(|e| e.to_string())?
}

// ── Streaming full export of truncated results ────────────────────────────────

/// Start a streaming full export of a truncated, re-runnable result. Returns
/// the job id at once; the re-run runs in the background on the editor
/// session (queued behind any running editor query).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_result_export(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    tab_id: String,
    result_index: usize,
    query_id: String,
    format: crate::export::ExportFormat,
    file_path: String,
    include_headers: bool,
    table_name: Option<String>,
) -> Result<String, String> {
    use tauri::Manager;

    let prepared = crate::export::result_export::start_result_export_impl(
        &state,
        crate::export::result_export::StartResultExportInput {
            connection_id,
            tab_id,
            result_index,
            query_id,
            format,
            file_path,
            include_headers,
            table_name,
        },
    )?;
    let job_id = prepared.job_id.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        crate::export::result_export::run_result_export_job(&state, prepared).await;
    });
    Ok(job_id)
}

/// Progress of a streaming full export.
#[tauri::command]
pub async fn get_result_export_progress(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<crate::state::ResultExportJobProgress, String> {
    crate::export::result_export::get_result_export_progress_impl(&state, &job_id)
}

/// Cancel a streaming full export (`KILL QUERY` on its re-run).
#[tauri::command]
pub async fn cancel_result_export(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<(), String> {
    crate::export::result_export::cancel_result_export_impl(&state, &job_id).await
}
