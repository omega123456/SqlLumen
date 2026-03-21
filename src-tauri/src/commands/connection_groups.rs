use crate::db::connection_groups::{self, ConnectionGroupRecord};
use crate::state::AppState;
use rusqlite::Connection;
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

pub fn create_connection_group_impl(state: &AppState, name: &str) -> Result<String, String> {
    let conn = lock_db(state)?;
    match connection_groups::insert_group(&conn, name) {
        Ok(id) => Ok(id),
        Err(error) => Err(error.to_string()),
    }
}

pub fn list_connection_groups_impl(state: &AppState) -> Result<Vec<ConnectionGroupRecord>, String> {
    let conn = lock_db(state)?;
    match connection_groups::list_groups(&conn) {
        Ok(groups) => Ok(groups),
        Err(error) => Err(error.to_string()),
    }
}

pub fn update_connection_group_impl(state: &AppState, id: &str, name: &str) -> Result<(), String> {
    let conn = lock_db(state)?;
    match connection_groups::update_group(&conn, id, name) {
        Ok(()) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub fn delete_connection_group_impl(state: &AppState, id: &str) -> Result<(), String> {
    let conn = lock_db(state)?;
    match connection_groups::delete_group(&conn, id) {
        Ok(()) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

// --- Thin Tauri command wrappers ---

#[cfg(not(coverage))]
#[tauri::command]
pub fn create_connection_group(name: String, state: State<AppState>) -> Result<String, String> {
    create_connection_group_impl(&state, &name)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn list_connection_groups(
    state: State<AppState>,
) -> Result<Vec<ConnectionGroupRecord>, String> {
    list_connection_groups_impl(&state)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn update_connection_group(
    id: String,
    name: String,
    state: State<AppState>,
) -> Result<(), String> {
    update_connection_group_impl(&state, &id, &name)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn delete_connection_group(id: String, state: State<AppState>) -> Result<(), String> {
    delete_connection_group_impl(&state, &id)
}
