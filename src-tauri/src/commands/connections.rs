use crate::db::connections::{self, ConnectionRecord, NewConnectionData, UpdateConnectionData};
use crate::state::AppState;
use serde::Deserialize;
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

pub fn save_connection_impl(state: &AppState, data: SaveConnectionInput) -> Result<String, String> {
    let password = data.password.clone();
    let conn = state.db.lock().map_err(|e| e.to_string())?;

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
    let id = connections::insert_connection(&conn, &new_data).map_err(|e| e.to_string())?;

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
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    connections::get_connection(&conn, id).map_err(|e| e.to_string())
}

pub fn list_connections_impl(state: &AppState) -> Result<Vec<ConnectionRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    connections::list_connections(&conn).map_err(|e| e.to_string())
}

pub fn update_connection_impl(
    state: &AppState,
    id: &str,
    data: UpdateConnectionInput,
) -> Result<(), String> {
    let password = data.password.clone();
    let conn = state.db.lock().map_err(|e| e.to_string())?;

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

    connections::update_connection(&conn, id, &update_data).map_err(|e| e.to_string())?;

    if let Some(pw) = password {
        // Store/update password in OS keychain
        crate::credentials::store_password(id, &pw)
            .map_err(|e| format!("Failed to update password in keychain: {e}"))?;
        // Ensure keychain_ref is set (may have been NULL if no previous password)
        conn.execute(
            "UPDATE connections SET keychain_ref = ?1 WHERE id = ?2",
            rusqlite::params![id, id],
        )
        .map_err(|e| e.to_string())?;
    }
    // If password is None, leave existing password/keychain_ref unchanged

    Ok(())
}

pub fn delete_connection_impl(state: &AppState, id: &str) -> Result<(), String> {
    // Try to delete keychain entry; ignore failures (orphaned entries acceptable)
    let _ = crate::credentials::delete_password(id);

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    connections::delete_connection(&conn, id).map_err(|e| e.to_string())
}

// --- Thin Tauri command wrappers ---

#[tauri::command]
pub fn save_connection(
    data: SaveConnectionInput,
    state: State<AppState>,
) -> Result<String, String> {
    save_connection_impl(&state, data)
}

#[tauri::command]
pub fn get_connection(
    id: String,
    state: State<AppState>,
) -> Result<Option<ConnectionRecord>, String> {
    get_connection_impl(&state, &id)
}

#[tauri::command]
pub fn list_connections(state: State<AppState>) -> Result<Vec<ConnectionRecord>, String> {
    list_connections_impl(&state)
}

#[tauri::command]
pub fn update_connection(
    id: String,
    data: UpdateConnectionInput,
    state: State<AppState>,
) -> Result<(), String> {
    update_connection_impl(&state, &id, data)
}

#[tauri::command]
pub fn delete_connection(id: String, state: State<AppState>) -> Result<(), String> {
    delete_connection_impl(&state, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::run_migrations;
    use rusqlite::Connection;
    use std::sync::Mutex;

    fn test_state() -> AppState {
        let conn = Connection::open_in_memory().expect("should open in-memory db");
        run_migrations(&conn).expect("should run migrations");
        AppState {
            db: Mutex::new(conn),
            registry: crate::mysql::registry::ConnectionRegistry::new(),
            app_handle: None,
        }
    }

    /// Sample input WITHOUT a password — used for basic CRUD tests that don't
    /// require the OS keychain (which may be unavailable in CI/headless).
    fn sample_save_input() -> SaveConnectionInput {
        SaveConnectionInput {
            name: "Test DB".to_string(),
            host: "localhost".to_string(),
            port: 3306,
            username: "root".to_string(),
            password: None,
            default_database: Some("mydb".to_string()),
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            color: None,
            group_id: None,
            read_only: false,
            sort_order: 0,
            connect_timeout_secs: Some(10),
            keepalive_interval_secs: Some(60),
        }
    }

    /// Check if the OS keychain is usable in this environment.
    fn keychain_available() -> bool {
        let probe_id = format!("__keyring_probe_{}", uuid::Uuid::new_v4());
        let store_ok = crate::credentials::store_password(&probe_id, "probe").is_ok();
        if store_ok {
            let retrieve_ok = crate::credentials::retrieve_password(&probe_id).is_ok();
            let _ = crate::credentials::delete_password(&probe_id);
            retrieve_ok
        } else {
            false
        }
    }

    #[test]
    fn test_save_connection_impl_returns_uuid() {
        let state = test_state();
        let id = save_connection_impl(&state, sample_save_input()).expect("should save");
        assert!(!id.is_empty());
    }

    #[test]
    fn test_get_connection_impl_returns_record() {
        let state = test_state();
        let id = save_connection_impl(&state, sample_save_input()).expect("should save");

        let record = get_connection_impl(&state, &id)
            .expect("should not error")
            .expect("should find connection");

        assert_eq!(record.id, id);
        assert_eq!(record.name, "Test DB");
        // No password provided → has_password is false
        assert!(!record.has_password);
    }

    #[test]
    fn test_list_connections_impl_returns_all() {
        let state = test_state();
        save_connection_impl(&state, sample_save_input()).expect("should save 1");

        let mut input2 = sample_save_input();
        input2.name = "Second DB".to_string();
        save_connection_impl(&state, input2).expect("should save 2");

        let list = list_connections_impl(&state).expect("should list");
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn test_update_connection_impl_modifies_fields() {
        let state = test_state();
        let id = save_connection_impl(&state, sample_save_input()).expect("should save");

        let update = UpdateConnectionInput {
            name: "Updated DB".to_string(),
            host: "192.168.1.1".to_string(),
            port: 3307,
            username: "admin".to_string(),
            password: None,
            default_database: None,
            ssl_enabled: true,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            color: Some("#00ff00".to_string()),
            group_id: None,
            read_only: false,
            sort_order: 0,
            connect_timeout_secs: Some(30),
            keepalive_interval_secs: Some(120),
        };

        update_connection_impl(&state, &id, update).expect("should update");

        let record = get_connection_impl(&state, &id)
            .expect("should not error")
            .expect("should find");
        assert_eq!(record.name, "Updated DB");
        assert_eq!(record.host, "192.168.1.1");
    }

    #[test]
    fn test_delete_connection_impl_removes_record() {
        let state = test_state();
        let id = save_connection_impl(&state, sample_save_input()).expect("should save");

        delete_connection_impl(&state, &id).expect("should delete");

        let result = get_connection_impl(&state, &id).expect("should not error");
        assert!(result.is_none());
    }

    #[test]
    fn test_save_without_password_sets_has_password_false() {
        let state = test_state();
        let mut input = sample_save_input();
        input.password = None;

        let id = save_connection_impl(&state, input).expect("should save");

        let record = get_connection_impl(&state, &id)
            .expect("should not error")
            .expect("should find connection");

        assert!(
            !record.has_password,
            "has_password should be false when no password provided"
        );
    }

    #[test]
    fn test_password_is_not_stored_in_sqlite() {
        if !keychain_available() {
            eprintln!("Skipping: OS keychain not available");
            return;
        }

        let state = test_state();
        let mut input = sample_save_input();
        input.password = Some("secret".to_string());

        let id = save_connection_impl(&state, input).expect("should save");

        // Verify password is not stored anywhere in the connections row
        let conn = state.db.lock().unwrap();
        let row_data: String = conn
            .query_row(
                "SELECT name || host || username || COALESCE(keychain_ref, '') || \
                 COALESCE(default_database, '') || COALESCE(ssl_ca_path, '') || \
                 COALESCE(ssl_cert_path, '') || COALESCE(ssl_key_path, '') || \
                 COALESCE(color, '') FROM connections WHERE id = ?1",
                [&id],
                |row| row.get::<_, String>(0),
            )
            .expect("should find connection");

        assert!(
            !row_data.contains("secret"),
            "password 'secret' should not appear in any SQLite column"
        );

        drop(conn);
        // Cleanup
        let _ = crate::credentials::delete_password(&id);
    }

    #[test]
    fn test_save_with_password_sets_has_password_true() {
        if !keychain_available() {
            eprintln!("Skipping: OS keychain not available");
            return;
        }

        let state = test_state();
        let mut input = sample_save_input();
        input.password = Some("secret".to_string());

        let id = save_connection_impl(&state, input).expect("should save");

        let record = get_connection_impl(&state, &id)
            .expect("should not error")
            .expect("should find connection");

        assert!(
            record.has_password,
            "has_password should be true when password is provided"
        );

        // Cleanup
        let _ = crate::credentials::delete_password(&id);
    }

    #[test]
    fn test_update_with_password_sets_has_password_true() {
        if !keychain_available() {
            eprintln!("Skipping: OS keychain not available");
            return;
        }

        let state = test_state();
        let mut input = sample_save_input();
        input.password = None;
        let id = save_connection_impl(&state, input).expect("should save");

        // Verify initially has_password is false
        let record = get_connection_impl(&state, &id)
            .expect("should not error")
            .expect("should find");
        assert!(!record.has_password);

        // Update with a password
        let update = UpdateConnectionInput {
            name: "Test DB".to_string(),
            host: "localhost".to_string(),
            port: 3306,
            username: "root".to_string(),
            password: Some("new_secret".to_string()),
            default_database: None,
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            color: None,
            group_id: None,
            read_only: false,
            sort_order: 0,
            connect_timeout_secs: None,
            keepalive_interval_secs: None,
        };
        update_connection_impl(&state, &id, update).expect("should update");

        // Now has_password should be true
        let record = get_connection_impl(&state, &id)
            .expect("should not error")
            .expect("should find");
        assert!(
            record.has_password,
            "has_password should be true after update with password"
        );

        // Cleanup
        let _ = crate::credentials::delete_password(&id);
    }

    #[test]
    fn test_delete_connection_tolerates_missing_keychain_entry() {
        let state = test_state();
        let id = save_connection_impl(&state, sample_save_input()).expect("should save");

        // delete_connection_impl should succeed even if keychain entry doesn't exist
        delete_connection_impl(&state, &id).expect("should delete even without keychain entry");

        let result = get_connection_impl(&state, &id).expect("should not error");
        assert!(result.is_none());
    }
}
