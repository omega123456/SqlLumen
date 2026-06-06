//! Tauri IPC command wrappers for session snapshots.
//!
//! Under `cfg(coverage)`, all Tauri command wrappers are excluded — tests exercise
//! the `*_impl` functions / repository directly.

use crate::db::session_snapshots::{self, NewSnapshot, SnapshotSummary};
use crate::state::AppState;
use rusqlite::Connection;
use std::sync::MutexGuard;
use tracing::error;

fn lock_db(state: &AppState) -> Result<MutexGuard<'_, Connection>, String> {
    match state.db.lock() {
        Ok(conn) => Ok(conn),
        Err(error) => {
            error!(?error, "failed to acquire db lock for session snapshots");
            Err(error.to_string())
        }
    }
}

// ── create_session_snapshot ─────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub fn create_session_snapshot_impl(
    state: &AppState,
    trigger_type: &str,
    connection_count: i64,
    tab_count: i64,
    summary_json: &str,
    state_json: &str,
    keep: i64,
) -> Result<i64, String> {
    let conn = lock_db(state)?;
    let snapshot = NewSnapshot {
        trigger_type: trigger_type.to_string(),
        connection_count,
        tab_count,
        summary_json: summary_json.to_string(),
        state_json: state_json.to_string(),
    };
    session_snapshots::insert_and_prune(&conn, &snapshot, keep).map_err(|e| {
        error!(error = %e, trigger_type, "failed to create session snapshot");
        e.to_string()
    })
}

#[cfg(not(coverage))]
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_session_snapshot(
    trigger_type: String,
    connection_count: i64,
    tab_count: i64,
    summary_json: String,
    state_json: String,
    keep: i64,
    state: tauri::State<'_, AppState>,
) -> Result<i64, String> {
    create_session_snapshot_impl(
        &state,
        &trigger_type,
        connection_count,
        tab_count,
        &summary_json,
        &state_json,
        keep,
    )
}

// ── list_session_snapshots ──────────────────────────────────────────────────

pub fn list_session_snapshots_impl(state: &AppState) -> Result<Vec<SnapshotSummary>, String> {
    let conn = lock_db(state)?;
    session_snapshots::list_summaries(&conn).map_err(|e| {
        error!(error = %e, "failed to list session snapshots");
        e.to_string()
    })
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn list_session_snapshots(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SnapshotSummary>, String> {
    list_session_snapshots_impl(&state)
}

// ── get_session_snapshot ────────────────────────────────────────────────────

pub fn get_session_snapshot_impl(state: &AppState, id: i64) -> Result<Option<String>, String> {
    let conn = lock_db(state)?;
    session_snapshots::get_state_json(&conn, id).map_err(|e| {
        error!(error = %e, id, "failed to get session snapshot");
        e.to_string()
    })
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn get_session_snapshot(
    id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    get_session_snapshot_impl(&state, id)
}

// ── delete_session_snapshot ─────────────────────────────────────────────────

pub fn delete_session_snapshot_impl(state: &AppState, id: i64) -> Result<bool, String> {
    let conn = lock_db(state)?;
    session_snapshots::delete_snapshot(&conn, id).map_err(|e| {
        error!(error = %e, id, "failed to delete session snapshot");
        e.to_string()
    })
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn delete_session_snapshot(
    id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    delete_session_snapshot_impl(&state, id)
}
