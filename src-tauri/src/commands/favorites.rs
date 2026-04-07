//! Tauri IPC command wrappers for query favorites.
//!
//! Under `cfg(coverage)`, all Tauri command wrappers are excluded — tests exercise
//! the `*_impl` functions directly.

use crate::db::favorites::{self, CreateFavoriteInput, FavoriteEntry, UpdateFavoriteInput};
use crate::state::AppState;
use rusqlite::Connection;
use std::sync::MutexGuard;

fn lock_db(state: &AppState) -> Result<MutexGuard<'_, Connection>, String> {
    match state.db.lock() {
        Ok(conn) => Ok(conn),
        Err(error) => Err(error.to_string()),
    }
}

// ── create_favorite ──────────────────────────────────────────────────────────

pub fn create_favorite_impl(
    state: &AppState,
    mut input: CreateFavoriteInput,
) -> Result<i64, String> {
    if let Some(ref id) = input.connection_id {
        let resolved = state
            .registry
            .get_profile_id(id)
            .unwrap_or_else(|| id.clone());
        input.connection_id = Some(resolved);
    }
    let conn = lock_db(state)?;
    favorites::insert_favorite(&conn, &input).map_err(|e| e.to_string())
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn create_favorite(
    input: CreateFavoriteInput,
    state: tauri::State<'_, AppState>,
) -> Result<i64, String> {
    create_favorite_impl(&state, input)
}

// ── list_favorites ───────────────────────────────────────────────────────────

pub fn list_favorites_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<FavoriteEntry>, String> {
    let resolved_id = state
        .registry
        .get_profile_id(connection_id)
        .unwrap_or_else(|| connection_id.to_string());
    let conn = lock_db(state)?;
    favorites::list_favorites(&conn, &resolved_id).map_err(|e| e.to_string())
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn list_favorites(
    connection_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<FavoriteEntry>, String> {
    list_favorites_impl(&state, &connection_id)
}

// ── update_favorite ──────────────────────────────────────────────────────────

pub fn update_favorite_impl(
    state: &AppState,
    id: i64,
    mut input: UpdateFavoriteInput,
) -> Result<bool, String> {
    if let Some(ref cid) = input.connection_id {
        let resolved = state
            .registry
            .get_profile_id(cid)
            .unwrap_or_else(|| cid.clone());
        input.connection_id = Some(resolved);
    }
    let conn = lock_db(state)?;
    favorites::update_favorite(&conn, id, &input).map_err(|e| e.to_string())
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn update_favorite(
    id: i64,
    input: UpdateFavoriteInput,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    update_favorite_impl(&state, id, input)
}

// ── delete_favorite ──────────────────────────────────────────────────────────

pub fn delete_favorite_impl(state: &AppState, id: i64) -> Result<bool, String> {
    let conn = lock_db(state)?;
    favorites::delete_favorite(&conn, id).map_err(|e| e.to_string())
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn delete_favorite(id: i64, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    delete_favorite_impl(&state, id)
}
