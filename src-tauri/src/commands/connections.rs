use crate::db::connections::{self, ConnectionRecord, NewConnectionData, UpdateConnectionData};
use crate::state::AppState;
use rusqlite::Connection;
use serde::Deserialize;
use std::sync::MutexGuard;
#[cfg(not(coverage))]
use tauri::State;

/// Input for saving a new connection. Includes password field for keychain storage.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConnectionInput {
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub password: Option<String>,
    pub default_database: Option<String>,
    pub ssl_enabled: bool,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub color: Option<String>,
    pub group_id: Option<String>,
    pub read_only: bool,
    pub sort_order: i64,
    pub connect_timeout_secs: Option<i64>,
    pub keepalive_interval_secs: Option<i64>,
}

/// Input for updating an existing connection. Includes password field for keychain storage.
/// When password is None, the existing password is left unchanged.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConnectionInput {
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub password: Option<String>,
    #[serde(default)]
    pub clear_password: bool,
    pub default_database: Option<String>,
    pub ssl_enabled: bool,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub color: Option<String>,
    pub group_id: Option<String>,
    pub read_only: bool,
    pub sort_order: i64,
    pub connect_timeout_secs: Option<i64>,
    pub keepalive_interval_secs: Option<i64>,
}

// --- Testable implementations (take &AppState instead of State<AppState>) ---

fn lock_db(state: &AppState) -> Result<MutexGuard<'_, Connection>, String> {
    match state.db.lock() {
        Ok(conn) => Ok(conn),
        Err(error) => Err(error.to_string()),
    }
}

pub fn save_connection_impl(state: &AppState, data: SaveConnectionInput) -> Result<String, String> {
    let password = data.password.clone();
    let conn = lock_db(state)?;

    let new_data = NewConnectionData {
        name: data.name,
        host: data.host,
        port: data.port,
        username: data.username,
        default_database: data.default_database,
        ssl_enabled: data.ssl_enabled,
        ssl_ca_path: data.ssl_ca_path,
        ssl_cert_path: data.ssl_cert_path,
        ssl_key_path: data.ssl_key_path,
        color: data.color,
        group_id: data.group_id,
        read_only: data.read_only,
        sort_order: data.sort_order,
        connect_timeout_secs: data.connect_timeout_secs,
        keepalive_interval_secs: data.keepalive_interval_secs,
    };

    // insert_connection always sets keychain_ref = id
    let id = match connections::insert_connection(&conn, &new_data) {
        Ok(id) => id,
        Err(error) => return Err(error.to_string()),
    };

    if let Some(pw) = password {
        // Store password in OS keychain
        if let Err(e) = crate::credentials::store_password(&id, &pw) {
            // Rollback: delete the connection we just inserted
            let _ = connections::delete_connection(&conn, &id);
            return Err(format!("Failed to store password in keychain: {e}"));
        }
    } else {
        // No password provided — clear keychain_ref so has_password is false
        conn.execute(
            "UPDATE connections SET keychain_ref = NULL WHERE id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(id)
}

pub fn get_connection_impl(state: &AppState, id: &str) -> Result<Option<ConnectionRecord>, String> {
    let conn = lock_db(state)?;
    match connections::get_connection(&conn, id) {
        Ok(record) => Ok(record),
        Err(error) => Err(error.to_string()),
    }
}

pub fn list_connections_impl(state: &AppState) -> Result<Vec<ConnectionRecord>, String> {
    let conn = lock_db(state)?;
    match connections::list_connections(&conn) {
        Ok(records) => Ok(records),
        Err(error) => Err(error.to_string()),
    }
}

pub fn update_connection_impl(
    state: &AppState,
    id: &str,
    data: UpdateConnectionInput,
) -> Result<(), String> {
    let password = data.password.clone();
    let clear_password = data.clear_password;

    if clear_password && password.is_some() {
        return Err("Cannot set and clear password at the same time".to_string());
    }

    let conn = lock_db(state)?;

    let update_data = UpdateConnectionData {
        name: data.name,
        host: data.host,
        port: data.port,
        username: data.username,
        default_database: data.default_database,
        ssl_enabled: data.ssl_enabled,
        ssl_ca_path: data.ssl_ca_path,
        ssl_cert_path: data.ssl_cert_path,
        ssl_key_path: data.ssl_key_path,
        color: data.color,
        group_id: data.group_id,
        read_only: data.read_only,
        sort_order: data.sort_order,
        connect_timeout_secs: data.connect_timeout_secs,
        keepalive_interval_secs: data.keepalive_interval_secs,
    };

    match connections::update_connection(&conn, id, &update_data) {
        Ok(()) => {}
        Err(error) => return Err(error.to_string()),
    }

    if clear_password {
        let previous_keychain_ref = connections::get_keychain_ref(&conn, id)
            .map_err(|e| e.to_string())?
            .filter(|reference| !reference.is_empty());
        if let Err(error) = connections::set_keychain_ref(&conn, id, None) {
            return Err(error.to_string());
        }
        if let Some(previous_ref) = previous_keychain_ref.as_deref() {
            let _ = crate::credentials::delete_password(previous_ref);
            if previous_ref != id {
                let _ = crate::credentials::delete_password(id);
            }
        }
    } else if let Some(pw) = password {
        let previous_keychain_ref = connections::get_keychain_ref(&conn, id)
            .map_err(|e| e.to_string())?
            .filter(|reference| !reference.is_empty());
        // Store/update password in OS keychain
        crate::credentials::store_password(id, &pw)
            .map_err(|e| format!("Failed to update password in keychain: {e}"))?;
        // Ensure keychain_ref is set (may have been NULL if no previous password)
        if let Err(error) = connections::set_keychain_ref(&conn, id, Some(id)) {
            let _ = crate::credentials::delete_password(id);
            return Err(error.to_string());
        }
        if let Some(previous_ref) = previous_keychain_ref
            .as_deref()
            .filter(|reference| *reference != id)
        {
            let _ = crate::credentials::delete_password(previous_ref);
        }
    }
    // If password is None, leave existing password/keychain_ref unchanged

    Ok(())
}

pub fn delete_connection_impl(state: &AppState, id: &str) -> Result<(), String> {
    let conn = lock_db(state)?;
    let keychain_ref = connections::get_keychain_ref(&conn, id)
        .map_err(|e| e.to_string())?
        .filter(|reference| !reference.is_empty());
    // Try to delete keychain entry; ignore failures (orphaned entries acceptable)
    let _ = crate::credentials::delete_password(crate::credentials::effective_keychain_ref(
        id,
        keychain_ref.as_deref(),
    ));
    match connections::delete_connection(&conn, id) {
        Ok(()) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

// --- Thin Tauri command wrappers ---

#[cfg(not(coverage))]
#[tauri::command]
pub fn save_connection(
    data: SaveConnectionInput,
    state: State<AppState>,
) -> Result<String, String> {
    save_connection_impl(&state, data)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn get_connection(
    id: String,
    state: State<AppState>,
) -> Result<Option<ConnectionRecord>, String> {
    get_connection_impl(&state, &id)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn list_connections(state: State<AppState>) -> Result<Vec<ConnectionRecord>, String> {
    list_connections_impl(&state)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn update_connection(
    id: String,
    data: UpdateConnectionInput,
    state: State<AppState>,
) -> Result<(), String> {
    update_connection_impl(&state, &id, data)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn delete_connection(id: String, state: State<AppState>) -> Result<(), String> {
    delete_connection_impl(&state, &id)
}
