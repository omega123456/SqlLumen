use crate::db::settings;
use crate::state::AppState;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::MutexGuard;
#[cfg(not(coverage))]
use tauri::State;

// --- Testable implementations (take &AppState instead of State<AppState>) ---

fn lock_db(state: &AppState) -> Result<MutexGuard<'_, Connection>, String> {
    match state.db.lock() {
        Ok(conn) => Ok(conn),
        Err(error) => Err(error.to_string()),
    }
}

pub fn get_setting_impl(state: &AppState, key: &str) -> Result<Option<String>, String> {
    let conn = lock_db(state)?;
    match settings::get_setting(&conn, key) {
        Ok(value) => Ok(value),
        Err(error) => Err(error.to_string()),
    }
}

pub fn set_setting_impl(state: &AppState, key: &str, value: &str) -> Result<(), String> {
    let conn = lock_db(state)?;
    match settings::set_setting(&conn, key, value) {
        Ok(()) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub fn get_all_settings_impl(state: &AppState) -> Result<HashMap<String, String>, String> {
    let conn = lock_db(state)?;
    match settings::get_all_settings(&conn) {
        Ok(values) => Ok(values),
        Err(error) => Err(error.to_string()),
    }
}

// --- Thin Tauri command wrappers ---

#[cfg(not(coverage))]
#[tauri::command]
pub fn get_setting(key: String, state: State<AppState>) -> Result<Option<String>, String> {
    get_setting_impl(&state, &key)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn set_setting(key: String, value: String, state: State<AppState>) -> Result<(), String> {
    set_setting_impl(&state, &key, &value)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn get_all_settings(state: State<AppState>) -> Result<HashMap<String, String>, String> {
    get_all_settings_impl(&state)
}
