use crate::commands::helpers::lock_db;
use crate::db::history::{self, HistoryPage, HistoryQuery};
use crate::state::AppState;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListHistoryRequest {
    pub connection_id: String,
    pub page: i64,
    pub page_size: i64,
    pub search: Option<String>,
    pub since: Option<String>,
}

pub fn list_history_impl(
    state: &AppState,
    request: &ListHistoryRequest,
) -> Result<HistoryPage, String> {
    let connection_id = request.connection_id.as_str();
    let resolved_id = state
        .registry
        .get_profile_id(connection_id)
        .unwrap_or_else(|| connection_id.to_string());
    let conn = lock_db(state)?;
    let query = HistoryQuery {
        connection_id: &resolved_id,
        page: request.page,
        page_size: request.page_size,
        search: request.search.as_deref(),
        since: request.since.as_deref(),
    };
    history::list_history(&conn, &query).map_err(|error| error.to_string())
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_history(
    payload: ListHistoryRequest,
    app: tauri::AppHandle,
) -> Result<HistoryPage, String> {
    crate::commands::run_blocking_with_state(app, move |state| list_history_impl(state, &payload))
        .await?
}

// ── delete_history_entry ─────────────────────────────────────────────────────

pub fn delete_history_entry_impl(state: &AppState, id: i64) -> Result<bool, String> {
    let conn = lock_db(state)?;
    history::delete_history(&conn, id).map_err(|error| error.to_string())
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn delete_history_entry(id: i64, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    delete_history_entry_impl(&state, id)
}

// ── clear_history ─────────────────────────────────────────────────────────────

pub fn clear_history_impl(state: &AppState, connection_id: &str) -> Result<i64, String> {
    let resolved_id = state
        .registry
        .get_profile_id(connection_id)
        .unwrap_or_else(|| connection_id.to_string());
    let conn = lock_db(state)?;
    history::clear_history(&conn, &resolved_id).map_err(|error| error.to_string())
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn clear_history(
    connection_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<i64, String> {
    clear_history_impl(&state, &connection_id)
}
