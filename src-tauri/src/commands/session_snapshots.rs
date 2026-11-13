use crate::commands::helpers::lock_db;
use crate::db::session_snapshots::{self, NewSnapshot, SnapshotSummary};
use crate::state::AppState;
use serde::Deserialize;
use tracing::error;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionSnapshotRequest {
    pub trigger_type: String,
    pub connection_count: i64,
    pub tab_count: i64,
    pub summary_json: String,
    pub state_json: String,
    pub keep: i64,
}

pub fn create_session_snapshot_impl(
    state: &AppState,
    request: CreateSessionSnapshotRequest,
) -> Result<i64, String> {
    let conn = lock_db(state)?;
    let CreateSessionSnapshotRequest {
        trigger_type,
        connection_count,
        tab_count,
        summary_json,
        state_json,
        keep,
    } = request;
    let snapshot = NewSnapshot {
        trigger_type,
        connection_count,
        tab_count,
        summary_json,
        state_json,
    };
    session_snapshots::insert_and_prune(&conn, &snapshot, keep).map_err(|error| {
        error!(error = %error, trigger_type = %snapshot.trigger_type, "failed to create session snapshot");
        error.to_string()
    })
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn create_session_snapshot(
    payload: CreateSessionSnapshotRequest,
    state: tauri::State<'_, AppState>,
) -> Result<i64, String> {
    create_session_snapshot_impl(&state, payload)
}

// ── list_session_snapshots ──────────────────────────────────────────────────

pub fn list_session_snapshots_impl(state: &AppState) -> Result<Vec<SnapshotSummary>, String> {
    let conn = lock_db(state)?;
    session_snapshots::list_summaries(&conn).map_err(|error| {
        error!(error = %error, "failed to list session snapshots");
        error.to_string()
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
    session_snapshots::get_state_json(&conn, id).map_err(|error| {
        error!(error = %error, id, "failed to get session snapshot");
        error.to_string()
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
    session_snapshots::delete_snapshot(&conn, id).map_err(|error| {
        error!(error = %error, id, "failed to delete session snapshot");
        error.to_string()
    })
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn delete_session_snapshot(id: i64, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    delete_session_snapshot_impl(&state, id)
}
