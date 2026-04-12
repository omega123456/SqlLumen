//! Tauri IPC command wrappers for SQL query execution, result pagination,
//! file I/O, and schema metadata.
//!
//! Under `cfg(coverage)`, all Tauri command wrappers are excluded — tests exercise
//! the `*_impl` functions in `query_executor` directly.

#[cfg(not(coverage))]
use crate::commands::query_history_bridge::{
    execute_call_query_bridge, execute_multi_query_bridge, execute_query_bridge,
    log_single_entry, resolve_connection_context,
};
#[cfg(not(coverage))]
use crate::db::history::NewHistoryEntry;
#[cfg(not(coverage))]
use crate::mysql::query_executor::{
    analyze_query_for_edit_impl, cancel_query_impl, evict_results_impl,
    fetch_result_page_impl, fetch_schema_metadata_impl, fetch_schema_metadata_full_impl,
    read_file_impl,
    reexecute_single_result_impl, sort_results_impl, update_result_cell_impl, write_file_impl,
    ExecuteQueryResult, FetchPageResult, MultiQueryResult, MultiQueryResultItem,
    QueryTableEditInfo, SchemaMetadata, SchemaMetadataFull,
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
    execute_query_bridge(&state, &connection_id, &tab_id, &sql, page_size.unwrap_or(1000)).await
}

// ── fetch_result_page ─────────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub fn fetch_result_page(
    connection_id: String,
    tab_id: String,
    query_id: String,
    page: usize,
    result_index: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<FetchPageResult, String> {
    fetch_result_page_impl(&state, &connection_id, &tab_id, &query_id, page, result_index)
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

// ── fetch_schema_metadata_full ────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub async fn fetch_schema_metadata_full(
    connection_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<SchemaMetadataFull, String> {
    fetch_schema_metadata_full_impl(&state, &connection_id).await
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
    result_index: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<FetchPageResult, String> {
    sort_results_impl(&state, &connection_id, &tab_id, &column_name, &direction, result_index)
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
    result_index: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    update_result_cell_impl(&state, &connection_id, &tab_id, row_index, updates, result_index)
}

// ── cancel_query ──────────────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub async fn cancel_query(
    connection_id: String,
    tab_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    cancel_query_impl(&state, &connection_id, &tab_id).await
}

// ── reexecute_single_result ──────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub async fn reexecute_single_result(
    connection_id: String,
    tab_id: String,
    result_index: usize,
    sql: String,
    page_size: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<MultiQueryResultItem, String> {
    let result = reexecute_single_result_impl(
        &state,
        &connection_id,
        &tab_id,
        result_index,
        &sql,
        page_size.unwrap_or(1000),
    )
    .await;

    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);

    match &result {
        Ok(item) => {
            log_single_entry(
                &state.db,
                NewHistoryEntry {
                    connection_id: conn_id,
                    database_name,
                    sql_text: sql,
                    duration_ms: Some(item.execution_time_ms),
                    row_count: Some(item.total_rows),
                    affected_rows: Some(item.affected_rows as i64),
                    success: item.error.is_none(),
                    error_message: item.error.clone(),
                },
            );
        }
        Err(e) => {
            log_single_entry(
                &state.db,
                NewHistoryEntry {
                    connection_id: conn_id,
                    database_name,
                    sql_text: sql,
                    duration_ms: Some(0),
                    row_count: Some(0),
                    affected_rows: Some(0),
                    success: false,
                    error_message: Some(e.clone()),
                },
            );
        }
    }

    result
}

// ── execute_multi_query ──────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub async fn execute_multi_query(
    connection_id: String,
    tab_id: String,
    statements: Vec<String>,
    page_size: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<MultiQueryResult, String> {
    execute_multi_query_bridge(
        &state,
        &connection_id,
        &tab_id,
        statements,
        page_size.unwrap_or(1000),
    )
    .await
}

// ── execute_call_query ───────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub async fn execute_call_query(
    connection_id: String,
    tab_id: String,
    sql: String,
    page_size: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<MultiQueryResult, String> {
    execute_call_query_bridge(
        &state,
        &connection_id,
        &tab_id,
        &sql,
        page_size.unwrap_or(1000),
    )
    .await
}
