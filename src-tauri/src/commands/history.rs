//! Tauri IPC command wrappers for query history.
//!
//! Under `cfg(coverage)`, all Tauri command wrappers are excluded — tests exercise
//! the `*_impl` functions directly.

use crate::db::history::{self, HistoryPage};
use crate::state::AppState;
use rusqlite::Connection;
use std::sync::MutexGuard;

fn lock_db(state: &AppState) -> Result<MutexGuard<'_, Connection>, String> {
    match state.db.lock() {
        Ok(conn) => Ok(conn),
        Err(error) => Err(error.to_string()),
    }
}

// ── list_history ──────────────────────────────────────────────────────────────

pub fn list_history_impl(
    state: &AppState,
    connection_id: &str,
    page: i64,
    page_size: i64,
    search: Option<&str>,
) -> Result<HistoryPage, String> {
    let resolved_id = state
        .registry
        .get_profile_id(connection_id)
        .unwrap_or_else(|| connection_id.to_string());
    let conn = lock_db(state)?;
    history::list_history(&conn, &resolved_id, page, page_size, search).map_err(|e| e.to_string())
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn list_history(
    connection_id: String,
    page: i64,
    page_size: i64,
    search: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<HistoryPage, String> {
    list_history_impl(&state, &connection_id, page, page_size, search.as_deref())
}

// ── delete_history_entry ─────────────────────────────────────────────────────

pub fn delete_history_entry_impl(state: &AppState, id: i64) -> Result<bool, String> {
    let conn = lock_db(state)?;
    history::delete_history(&conn, id).map_err(|e| e.to_string())
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
    history::clear_history(&conn, &resolved_id).map_err(|e| e.to_string())
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn clear_history(
    connection_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<i64, String> {
    clear_history_impl(&state, &connection_id)
}
