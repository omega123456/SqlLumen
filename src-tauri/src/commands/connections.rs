use crate::commands::helpers::lock_db;
use crate::db::connections::{self, ConnectionRecord, NewConnectionData, UpdateConnectionData};
use crate::state::AppState;
use serde::Deserialize;
#[cfg(not(coverage))]
use tauri::State;

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

    let id = match connections::insert_connection(&conn, &new_data) {
        Ok(id) => id,
        Err(error) => return Err(error.to_string()),
    };

    let Some(pw) = password else {
        conn.execute(
            "UPDATE connections SET keychain_ref = NULL WHERE id = ?1",
            rusqlite::params![id],
        )
        .map_err(|error| error.to_string())?;
        return Ok(id);
    };

    if let Err(error) = crate::credentials::store_password(&id, &pw) {
        let _ = connections::delete_connection(&conn, &id);
        return Err(error);
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

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConnectionRequest {
    pub id: String,
    pub data: UpdateConnectionInput,
}

pub fn update_connection_impl(
    state: &AppState,
    request: UpdateConnectionRequest,
) -> Result<(), String> {
    let UpdateConnectionRequest { id, data } = request;
    let id = id.as_str();
    let password = data.password.clone();
    let clear_password = data.clear_password;

    let sets_and_clears_password = clear_password && password.is_some();
    if sets_and_clears_password {
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
        crate::credentials::delete_password(id)?;
        return connections::set_keychain_ref(&conn, id, None).map_err(|error| error.to_string());
    }
    let Some(pw) = password else {
        return Ok(());
    };
    crate::credentials::store_password(id, &pw)?;
    if let Err(error) = connections::set_keychain_ref(&conn, id, Some(id)) {
        let _ = crate::credentials::delete_password(id);
        return Err(error.to_string());
    }

    Ok(())
}

pub fn delete_connection_impl(state: &AppState, id: &str) -> Result<(), String> {
    let conn = lock_db(state)?;
    let has_password_marker = connections::get_keychain_ref(&conn, id)
        .map_err(|error| error.to_string())?
        .is_some();

    if has_password_marker {
        crate::credentials::delete_password(id)?;
    }

    let tx = conn.unchecked_transaction().map_err(|error| {
        tracing::error!(
            connection_id = id,
            error = %error,
            "failed to begin transaction for connection deletion"
        );
        error.to_string()
    })?;

    if let Err(error) = crate::ai_memory::storage::delete_memories_for_connection(&tx, id) {
        tracing::error!(
            connection_id = id,
            error = %error,
            "failed to delete AI memories for connection during deletion; rolling back"
        );
        return Err(error.to_string());
    }

    if let Err(error) = crate::schema_index::storage::drop_vec_table(&tx, id) {
        tracing::error!(
            connection_id = id,
            error = %error,
            "failed to drop schema-index vector table during deletion; rolling back"
        );
        return Err(error.to_string());
    }

    if let Err(error) = connections::delete_connection(&tx, id) {
        tracing::error!(
            connection_id = id,
            error = %error,
            "failed to delete connection row during deletion; rolling back"
        );
        return Err(error.to_string());
    }

    tx.commit().map_err(|error| {
        tracing::error!(
            connection_id = id,
            error = %error,
            "failed to commit connection deletion transaction"
        );
        error.to_string()
    })
}

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
    payload: UpdateConnectionRequest,
    state: State<AppState>,
) -> Result<(), String> {
    update_connection_impl(&state, payload)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn delete_connection(id: String, state: State<AppState>) -> Result<(), String> {
    delete_connection_impl(&state, &id)
}
