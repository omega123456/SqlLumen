use crate::db::connection_groups::{self, ConnectionGroupRecord};
use crate::state::AppState;
use tauri::State;

// --- Testable implementations (take &AppState instead of State<AppState>) ---

pub fn create_connection_group_impl(state: &AppState, name: &str) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    connection_groups::insert_group(&conn, name).map_err(|e| e.to_string())
}

pub fn list_connection_groups_impl(state: &AppState) -> Result<Vec<ConnectionGroupRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    connection_groups::list_groups(&conn).map_err(|e| e.to_string())
}

pub fn update_connection_group_impl(state: &AppState, id: &str, name: &str) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    connection_groups::update_group(&conn, id, name).map_err(|e| e.to_string())
}

pub fn delete_connection_group_impl(state: &AppState, id: &str) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    connection_groups::delete_group(&conn, id).map_err(|e| e.to_string())
}

// --- Thin Tauri command wrappers ---

#[tauri::command]
pub fn create_connection_group(name: String, state: State<AppState>) -> Result<String, String> {
    create_connection_group_impl(&state, &name)
}

#[tauri::command]
pub fn list_connection_groups(
    state: State<AppState>,
) -> Result<Vec<ConnectionGroupRecord>, String> {
    list_connection_groups_impl(&state)
}

#[tauri::command]
pub fn update_connection_group(
    id: String,
    name: String,
    state: State<AppState>,
) -> Result<(), String> {
    update_connection_group_impl(&state, &id, &name)
}

#[tauri::command]
pub fn delete_connection_group(id: String, state: State<AppState>) -> Result<(), String> {
    delete_connection_group_impl(&state, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::connections::{save_connection_impl, SaveConnectionInput};
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

    #[test]
    fn test_create_connection_group_impl_returns_uuid() {
        let state = test_state();
        let id = create_connection_group_impl(&state, "Production").expect("should create group");
        assert!(!id.is_empty());
    }

    #[test]
    fn test_list_connection_groups_impl_returns_all() {
        let state = test_state();
        create_connection_group_impl(&state, "Production").expect("should create");
        create_connection_group_impl(&state, "Staging").expect("should create");

        let list = list_connection_groups_impl(&state).expect("should list");
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn test_update_connection_group_impl_modifies_name() {
        let state = test_state();
        let id = create_connection_group_impl(&state, "Old Name").expect("should create");

        update_connection_group_impl(&state, &id, "New Name").expect("should update");

        let list = list_connection_groups_impl(&state).expect("should list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "New Name");
    }

    #[test]
    fn test_delete_connection_group_impl_removes_group() {
        let state = test_state();
        let id = create_connection_group_impl(&state, "To Delete").expect("should create");

        delete_connection_group_impl(&state, &id).expect("should delete");

        let list = list_connection_groups_impl(&state).expect("should list");
        assert!(list.is_empty());
    }

    #[test]
    fn test_delete_connection_group_impl_nullifies_connections() {
        let state = test_state();
        let group_id =
            create_connection_group_impl(&state, "My Group").expect("should create group");

        let input = SaveConnectionInput {
            name: "Test DB".to_string(),
            host: "localhost".to_string(),
            port: 3306,
            username: "root".to_string(),
            password: None,
            default_database: None,
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            color: None,
            group_id: Some(group_id.clone()),
            read_only: false,
            sort_order: 0,
            connect_timeout_secs: None,
            keepalive_interval_secs: None,
        };
        let conn_id = save_connection_impl(&state, input).expect("should save connection");

        delete_connection_group_impl(&state, &group_id).expect("should delete group");

        // Verify connection still exists but group_id is NULL
        let record = crate::commands::connections::get_connection_impl(&state, &conn_id)
            .expect("should not error")
            .expect("connection should still exist");
        assert!(record.group_id.is_none());
    }
}
