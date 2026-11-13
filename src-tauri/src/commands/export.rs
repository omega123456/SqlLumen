use crate::export::{ExportOptions, ExportResult};
use crate::mysql::query_executor::SharedRow;
use crate::state::AppState;
use serde::Deserialize;

pub use crate::export::export_with_data;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResultsRequest {
    pub connection_id: String,
    pub tab_id: String,
    pub options: ExportOptions,
    pub result_index: Option<usize>,
}

struct ExportData {
    columns: Vec<String>,
    rows: Vec<SharedRow>,
}

fn resolve_export_data(
    state: &AppState,
    request: &ExportResultsRequest,
) -> Result<ExportData, String> {
    let tab_id = request.tab_id.as_str();
    let result_index = request.result_index;
    let cache_result = state.result_cache.get(&request.connection_id, tab_id);
    if cache_result.is_expired() {
        return Err(crate::mysql::result_view::RESULTS_EXPIRED_MESSAGE.to_string());
    }
    let entry = cache_result
        .into_entry()
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;
    let result_vec = &entry.value;
    let index = result_index.unwrap_or(0);
    let stored = result_vec.get(index).ok_or_else(|| {
        format!(
            "Result index {index} out of range (total: {})",
            result_vec.len()
        )
    })?;
    let cols: Vec<String> = stored
        .columns
        .iter()
        .map(|column| column.name.clone())
        .collect();
    Ok(ExportData {
        columns: cols,
        rows: crate::mysql::result_view::view_rows(stored),
    })
}

pub fn export_results_impl(
    state: &AppState,
    request: ExportResultsRequest,
) -> Result<ExportResult, String> {
    let ExportData { columns, rows } = resolve_export_data(state, &request)?;
    export_with_data(&columns, &rows, request.options)
}

#[tauri::command]
pub async fn export_results(
    state: tauri::State<'_, AppState>,
    payload: ExportResultsRequest,
) -> Result<ExportResult, String> {
    let ExportData { columns, rows } = resolve_export_data(&state, &payload)?;
    let options = payload.options;

    tokio::task::spawn_blocking(move || export_with_data(&columns, &rows, options))
        .await
        .map_err(|error| error.to_string())?
}

// ── Streaming full export of truncated results ────────────────────────────────

#[tauri::command]
pub async fn start_result_export(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    payload: crate::export::result_export::StartResultExportInput,
) -> Result<String, String> {
    use tauri::Manager;

    let prepared = crate::export::result_export::start_result_export_impl(&state, payload)?;
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
