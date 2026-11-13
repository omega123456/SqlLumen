use crate::commands::helpers::lock_db;
use crate::db::schema_cache;
use crate::state::AppState;
use serde::Deserialize;
#[cfg(not(coverage))]
use tauri::State;
use tracing::{error, warn};

pub fn load_schema_cache_snapshot_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<Option<String>, String> {
    let conn = lock_db(state)?;
    schema_cache::load_schema_cache_snapshot(&conn, connection_id).map_err(|error| {
        let message = error.to_string();
        warn!(connection_id, error = %message, "failed to load schema cache snapshot");
        message
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSchemaCacheSnapshotRequest {
    pub connection_id: String,
    pub snapshot_json: String,
}

pub fn save_schema_cache_snapshot_impl(
    state: &AppState,
    request: &SaveSchemaCacheSnapshotRequest,
) -> Result<(), String> {
    let connection_id = request.connection_id.as_str();
    let snapshot_json = request.snapshot_json.as_str();
    let conn = lock_db(state)?;
    schema_cache::save_schema_cache_snapshot(&conn, connection_id, snapshot_json).map_err(|error| {
        let message = error.to_string();
        error!(connection_id, error = %message, "failed to save schema cache snapshot");
        message
    })
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn load_schema_cache_snapshot(
    connection_id: String,
    state: State<AppState>,
) -> Result<Option<String>, String> {
    load_schema_cache_snapshot_impl(&state, &connection_id)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn save_schema_cache_snapshot(
    payload: SaveSchemaCacheSnapshotRequest,
    state: State<AppState>,
) -> Result<(), String> {
    save_schema_cache_snapshot_impl(&state, &payload)
}
