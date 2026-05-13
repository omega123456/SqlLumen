use crate::db::schema_cache;
use crate::state::AppState;
use rusqlite::Connection;
use std::sync::MutexGuard;
#[cfg(not(coverage))]
use tauri::State;
use tracing::{error, warn};

fn lock_db(state: &AppState) -> Result<MutexGuard<'_, Connection>, String> {
    state.db.lock().map_err(|error| {
        let message = error.to_string();
        error!(error = %message, "failed to lock sqlite database for schema cache");
        message
    })
}

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

pub fn save_schema_cache_snapshot_impl(
    state: &AppState,
    connection_id: &str,
    snapshot_json: &str,
) -> Result<(), String> {
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
    connection_id: String,
    snapshot_json: String,
    state: State<AppState>,
) -> Result<(), String> {
    save_schema_cache_snapshot_impl(&state, &connection_id, &snapshot_json)
}
