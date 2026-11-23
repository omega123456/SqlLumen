use crate::commands::run_blocking_with_state;
use crate::export::result_export::{self, StartResultExportInput};
use crate::export::run_export::{
    RunExportProgress, RunExportStart, StartRunExportRequest, get_run_export_progress_impl,
    start_run_export_impl,
};
use crate::export::{ExportOptions, ExportResult};
use crate::mysql::query_executor::SharedRow;
use crate::state::AppState;
use serde::Deserialize;
use tauri::Manager;

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
    crate::mysql::result_view::ensure_query_result(stored)?;
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
    app: tauri::AppHandle,
    payload: ExportResultsRequest,
) -> Result<ExportResult, String> {
    run_blocking_with_state(app, move |state| export_results_impl(state, payload)).await?
}

#[tauri::command]
pub async fn start_run_export(
    app: tauri::AppHandle,
    payload: StartRunExportRequest,
) -> Result<RunExportStart, String> {
    run_blocking_with_state(app, move |state| {
        start_run_export_impl(state, &payload, &std::env::temp_dir())
    })
    .await?
}

#[tauri::command]
pub fn get_run_export_progress(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Option<RunExportProgress> {
    get_run_export_progress_impl(&state, &run_id)
}

pub fn start_result_export_in_background<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    payload: StartResultExportInput,
) -> Result<String, String> {
    let prepared = result_export::start_result_export_impl(&app.state::<AppState>(), payload)?;
    let job_id = prepared.job_id.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        result_export::run_result_export_job(&state, prepared).await;
    });
    Ok(job_id)
}

#[tauri::command]
pub async fn start_result_export(
    app: tauri::AppHandle,
    payload: StartResultExportInput,
) -> Result<String, String> {
    start_result_export_in_background(app, payload)
}

#[tauri::command]
pub async fn get_result_export_progress(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<crate::state::ResultExportJobProgress, String> {
    crate::export::result_export::get_result_export_progress_impl(&state, &job_id)
}

#[tauri::command]
pub async fn cancel_result_export(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<(), String> {
    crate::export::result_export::cancel_result_export_impl(&state, &job_id).await
}
