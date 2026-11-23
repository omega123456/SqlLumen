#[cfg(not(coverage))]
use crate::commands::query_history_bridge::{
    execute_call_query_bridge, execute_multi_query_bridge, execute_query_bridge,
    resolve_connection_context,
};
#[cfg(not(coverage))]
use crate::commands::requests::{ConnectionTabRequest, FileContentRequest};
#[cfg(not(coverage))]
use crate::commands::run_blocking_with_state;
#[cfg(not(coverage))]
use crate::db::history::NewHistoryEntry;
#[cfg(not(coverage))]
use crate::mysql::query_executor::{
    AnalyzeQueryForEditRequest, ExecuteCallQueryRequest, ExecuteMultiQueryRequest,
    ExecuteQueryRequest, ExecuteQueryResult, MultiQueryResult, MultiQueryResultItem,
    QueryTableEditInfo, ReexecuteSingleResultRequest, SchemaMetadata, SchemaMetadataFull,
    UpdateResultCellRequest, analyze_query_for_edit_impl, cancel_query_impl, evict_results_impl,
    fetch_schema_metadata_full_impl, fetch_schema_metadata_impl, read_file_impl,
    reexecute_single_result_impl, touch_results_impl, update_result_cell_impl, write_file_impl,
};
#[cfg(not(coverage))]
use crate::mysql::result_view::{
    AppendResultRowRequest, AppendResultRowResult, FetchResultWindowRequest,
    FetchResultWindowResult, RemoveResultRowsRequest, RemoveResultRowsResult, SetResultViewRequest,
    SetResultViewResult, append_result_row_impl, fetch_result_window_impl, remove_result_rows_impl,
    set_result_view_impl,
};
#[cfg(not(coverage))]
use crate::state::AppState;

#[cfg(not(coverage))]
#[tauri::command]
pub async fn execute_query(
    payload: ExecuteQueryRequest,
    state: tauri::State<'_, AppState>,
) -> Result<ExecuteQueryResult, String> {
    execute_query_bridge(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn set_result_view(
    payload: SetResultViewRequest,
    app: tauri::AppHandle,
) -> Result<SetResultViewResult, String> {
    run_blocking_with_state(app, move |state| set_result_view_impl(state, &payload)).await?
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn fetch_result_window(
    payload: FetchResultWindowRequest,
    app: tauri::AppHandle,
) -> Result<FetchResultWindowResult, String> {
    run_blocking_with_state(app, move |state| fetch_result_window_impl(state, &payload)).await?
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn remove_result_rows(
    payload: RemoveResultRowsRequest,
    app: tauri::AppHandle,
) -> Result<RemoveResultRowsResult, String> {
    run_blocking_with_state(app, move |state| remove_result_rows_impl(state, &payload)).await?
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn append_result_row(
    payload: AppendResultRowRequest,
    app: tauri::AppHandle,
) -> Result<AppendResultRowResult, String> {
    run_blocking_with_state(app, move |state| append_result_row_impl(state, &payload)).await?
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn evict_results(payload: ConnectionTabRequest, state: tauri::State<'_, AppState>) {
    evict_results_impl(&state, &payload);
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn fetch_schema_metadata(
    connection_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<SchemaMetadata, String> {
    fetch_schema_metadata_impl(&state, &connection_id).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn fetch_schema_metadata_full(
    connection_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<SchemaMetadataFull, String> {
    fetch_schema_metadata_full_impl(&state, &connection_id).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    read_file_impl(&path)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn write_file(payload: FileContentRequest) -> Result<(), String> {
    write_file_impl(&payload.path, &payload.content)
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn analyze_query_for_edit(
    payload: AnalyzeQueryForEditRequest,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<QueryTableEditInfo>, String> {
    analyze_query_for_edit_impl(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn update_result_cell(
    payload: UpdateResultCellRequest,
    app: tauri::AppHandle,
) -> Result<(), String> {
    run_blocking_with_state(app, move |state| update_result_cell_impl(state, payload)).await?
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn cancel_query(
    payload: ConnectionTabRequest,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    cancel_query_impl(&state, &payload).await
}

#[cfg(not(coverage))]
fn reexecuted_history_entry(
    item_result: &Result<MultiQueryResultItem, String>,
    sql_text: String,
) -> impl FnOnce(String, Option<String>) -> NewHistoryEntry + '_ {
    move |connection_id, database_name| match item_result {
        Ok(item) => NewHistoryEntry {
            connection_id,
            database_name,
            sql_text,
            duration_ms: Some(item.total_time_ms as i64),
            row_count: Some(item.total_rows),
            affected_rows: Some(item.affected_rows as i64),
            success: item.error.is_none(),
            error_message: item.error.clone(),
        },
        Err(error) => NewHistoryEntry {
            connection_id,
            database_name,
            sql_text,
            duration_ms: Some(0),
            row_count: Some(0),
            affected_rows: Some(0),
            success: false,
            error_message: Some(error.clone()),
        },
    }
}

#[cfg(not(coverage))]
async fn reexecute_single_result_with_history(
    state: &AppState,
    request: &ReexecuteSingleResultRequest,
) -> Result<MultiQueryResultItem, String> {
    let result = reexecute_single_result_impl(state, request).await;
    let build_entry = reexecuted_history_entry(&result, request.sql.clone());
    resolve_connection_context(state, &request.connection_id)
        .log_single_entry_if_resolved(&state.db, build_entry);
    result
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn reexecute_single_result(
    payload: ReexecuteSingleResultRequest,
    state: tauri::State<'_, AppState>,
) -> Result<MultiQueryResultItem, String> {
    reexecute_single_result_with_history(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn execute_multi_query(
    payload: ExecuteMultiQueryRequest,
    state: tauri::State<'_, AppState>,
) -> Result<MultiQueryResult, String> {
    execute_multi_query_bridge(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn execute_call_query(
    payload: ExecuteCallQueryRequest,
    state: tauri::State<'_, AppState>,
) -> Result<MultiQueryResult, String> {
    execute_call_query_bridge(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn touch_results(
    payload: ConnectionTabRequest,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    run_blocking_with_state(app, move |state| touch_results_impl(state, &payload)).await
}
