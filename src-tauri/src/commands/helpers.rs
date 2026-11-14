use crate::state::AppState;
use rusqlite::Connection;
use std::sync::{Mutex, MutexGuard};

pub fn lock_connection(
    connection: &Mutex<Connection>,
) -> Result<MutexGuard<'_, Connection>, String> {
    connection.lock().map_err(|error| {
        let message = error.to_string();
        tracing::error!(error = %message, "failed to lock sqlite database");
        message
    })
}

pub fn lock_db(state: &AppState) -> Result<MutexGuard<'_, Connection>, String> {
    lock_connection(&state.db)
}

pub fn resolve_session_profile(state: &AppState, session_id: &str) -> Result<String, String> {
    if let Ok(map) = state.session_profile_map.lock() {
        if let Some(pid) = map.get(session_id) {
            return Ok(pid.clone());
        }
    }

    state
        .registry
        .get_profile_id(session_id)
        .ok_or_else(|| format!("Session '{session_id}' not found"))
}
