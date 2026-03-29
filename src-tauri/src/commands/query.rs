//! Tauri IPC command wrappers for SQL query execution, result pagination,
//! file I/O, and schema metadata.
//!
//! Under `cfg(coverage)`, all Tauri command wrappers are excluded — tests exercise
//! the `*_impl` functions in `query_executor` directly.

#[cfg(not(coverage))]
use crate::mysql::query_executor::{
    analyze_query_for_edit_impl, evict_results_impl, execute_query_impl, fetch_result_page_impl,
    fetch_schema_metadata_impl, read_file_impl, sort_results_impl, update_result_cell_impl,
    write_file_impl, ExecuteQueryResult, FetchPageResult, QueryTableEditInfo, SchemaMetadata,
};
#[cfg(not(coverage))]
use crate::state::AppState;
#[cfg(not(coverage))]
use std::collections::HashMap;

// ── execute_query ─────────────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub async fn execute_query(
    connection_id: String,
    tab_id: String,
    sql: String,
    page_size: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<ExecuteQueryResult, String> {
    execute_query_impl(&state, &connection_id, &tab_id, &sql, page_size.unwrap_or(1000)).await
}

// ── fetch_result_page ─────────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub fn fetch_result_page(
    connection_id: String,
    tab_id: String,
    query_id: String,
    page: usize,
    state: tauri::State<'_, AppState>,
) -> Result<FetchPageResult, String> {
    fetch_result_page_impl(&state, &connection_id, &tab_id, &query_id, page)
}

// ── evict_results ─────────────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub fn evict_results(
    connection_id: String,
    tab_id: String,
    state: tauri::State<'_, AppState>,
) {
    evict_results_impl(&state, &connection_id, &tab_id);
}

// ── fetch_schema_metadata ─────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub async fn fetch_schema_metadata(
    connection_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<SchemaMetadata, String> {
    fetch_schema_metadata_impl(&state, &connection_id).await
}

// ── read_file ─────────────────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub fn read_file(path: String, state: tauri::State<'_, AppState>) -> Result<String, String> {
    let _ = state; // AppState not needed but keep for future use
    read_file_impl(&path)
}

// ── write_file ────────────────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub fn write_file(
    path: String,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let _ = state;
    write_file_impl(&path, &content)
}

// ── sort_results ──────────────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub fn sort_results(
    connection_id: String,
    tab_id: String,
    column_name: String,
    direction: String,
    state: tauri::State<'_, AppState>,
) -> Result<FetchPageResult, String> {
    sort_results_impl(&state, &connection_id, &tab_id, &column_name, &direction)
}

// ── analyze_query_for_edit ────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub async fn analyze_query_for_edit(
    connection_id: String,
    sql: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<QueryTableEditInfo>, String> {
    analyze_query_for_edit_impl(&state, &connection_id, &sql).await
}

// ── update_result_cell ────────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub fn update_result_cell(
    connection_id: String,
    tab_id: String,
    row_index: usize,
    updates: HashMap<usize, serde_json::Value>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    update_result_cell_impl(&state, &connection_id, &tab_id, row_index, updates)
}
