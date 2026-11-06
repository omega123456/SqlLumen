//! Tauri IPC command wrappers for SQL query execution, cached result retrieval,
//! file I/O, and schema metadata.
//!
//! Under `cfg(coverage)`, all Tauri command wrappers are excluded — tests exercise
//! the `*_impl` functions in `query_executor` directly.

#[cfg(not(coverage))]
use crate::commands::query_history_bridge::{
    execute_call_query_bridge, execute_multi_query_bridge, execute_query_bridge, log_single_entry,
    resolve_connection_context,
};
#[cfg(not(coverage))]
use crate::commands::run_blocking_with_state;
#[cfg(not(coverage))]
use crate::db::history::NewHistoryEntry;
#[cfg(not(coverage))]
use crate::mysql::query_executor::{
    analyze_query_for_edit_impl, cancel_query_impl, evict_results_impl,
    fetch_schema_metadata_full_impl, fetch_schema_metadata_impl, read_file_impl,
    reexecute_single_result_impl, touch_results_impl, update_result_cell_impl, write_file_impl,
    ExecuteQueryResult, MultiQueryResult, MultiQueryResultItem, QueryTableEditInfo, SchemaMetadata,
    SchemaMetadataFull,
};
#[cfg(not(coverage))]
use crate::mysql::result_view::{
    fetch_result_window_impl, remove_result_rows_impl, set_result_view_impl,
    FetchResultWindowResult, RemoveResultRowsResult, ResultViewSpec, SetResultViewResult,
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
    row_limit: Option<usize>,
    view_spec: Option<ResultViewSpec>,
    state: tauri::State<'_, AppState>,
) -> Result<ExecuteQueryResult, String> {
    execute_query_bridge(
        &state,
        &connection_id,
        &tab_id,
        &sql,
        row_limit.unwrap_or(1000),
        view_spec,
    )
    .await
}

// ── Result views and windows ──────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn set_result_view(
    connection_id: String,
    tab_id: String,
    result_index: usize,
    query_id: String,
    base_view_version: u64,
    view_spec: ResultViewSpec,
    app: tauri::AppHandle,
) -> Result<SetResultViewResult, String> {
    run_blocking_with_state(app, move |state| {
        set_result_view_impl(
            state,
            &connection_id,
            &tab_id,
            result_index,
            &query_id,
            base_view_version,
            &view_spec,
        )
    })
    .await?
}

#[cfg(not(coverage))]
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn fetch_result_window(
    connection_id: String,
    tab_id: String,
    result_index: usize,
    query_id: String,
    view_version: u64,
    offset: usize,
    limit: usize,
    app: tauri::AppHandle,
) -> Result<FetchResultWindowResult, String> {
    run_blocking_with_state(app, move |state| {
        fetch_result_window_impl(
            state,
            &connection_id,
            &tab_id,
            result_index,
            &query_id,
            view_version,
            offset,
            limit,
        )
    })
    .await?
}

#[cfg(not(coverage))]
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn remove_result_rows(
    connection_id: String,
    tab_id: String,
    result_index: usize,
    query_id: String,
    base_view_version: u64,
    base_indices: Vec<u32>,
    app: tauri::AppHandle,
) -> Result<RemoveResultRowsResult, String> {
    run_blocking_with_state(app, move |state| {
        remove_result_rows_impl(
            state,
            &connection_id,
            &tab_id,
            result_index,
            &query_id,
            base_view_version,
            &base_indices,
        )
    })
    .await?
}

// ── evict_results ─────────────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub fn evict_results(connection_id: String, tab_id: String, state: tauri::State<'_, AppState>) {
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

/// `row_index` is a base row index (see `update_result_cell_impl`).
#[cfg(not(coverage))]
#[tauri::command]
pub async fn update_result_cell(
    connection_id: String,
    tab_id: String,
    row_index: usize,
    updates: HashMap<usize, serde_json::Value>,
    result_index: Option<usize>,
    query_id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    run_blocking_with_state(app, move |state| {
        update_result_cell_impl(
            state,
            &connection_id,
            &tab_id,
            row_index,
            updates,
            result_index,
            &query_id,
        )
    })
    .await?
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
    row_limit: Option<usize>,
    view_spec: Option<ResultViewSpec>,
    state: tauri::State<'_, AppState>,
) -> Result<MultiQueryResultItem, String> {
    let result = reexecute_single_result_impl(
        &state,
        &connection_id,
        &tab_id,
        result_index,
        &sql,
        row_limit.unwrap_or(1000),
        view_spec,
    )
    .await;

    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);

    let Some(conn_id) = conn_id else {
        tracing::warn!(
            session_id = %connection_id,
            "skipping query history logging: no saved connection id resolved for session"
        );
        return result;
    };

    match &result {
        Ok(item) => {
            log_single_entry(
                &state.db,
                NewHistoryEntry {
                    connection_id: conn_id,
                    database_name,
                    sql_text: sql,
                    duration_ms: Some(item.total_time_ms as i64),
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
    row_limit: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<MultiQueryResult, String> {
    execute_multi_query_bridge(
        &state,
        &connection_id,
        &tab_id,
        statements,
        row_limit.unwrap_or(1000),
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
    row_limit: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<MultiQueryResult, String> {
    execute_call_query_bridge(
        &state,
        &connection_id,
        &tab_id,
        &sql,
        row_limit.unwrap_or(1000),
    )
    .await
}

// ── touch_results ────────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub async fn touch_results(
    connection_id: String,
    tab_id: String,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    run_blocking_with_state(app, move |state| {
        touch_results_impl(state, &connection_id, &tab_id)
    })
    .await
}
