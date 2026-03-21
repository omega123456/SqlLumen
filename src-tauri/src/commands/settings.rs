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

    #[test]
    fn test_get_setting_impl_returns_none_for_missing() {
        let state = test_state();
        let result = get_setting_impl(&state, "nonexistent").expect("should not error");
        assert_eq!(result, None);
    }

    #[test]
    fn test_set_and_get_setting_impl() {
        let state = test_state();
        set_setting_impl(&state, "theme", "dark").expect("should set setting");
        let result = get_setting_impl(&state, "theme").expect("should get setting");
        assert_eq!(result, Some("dark".to_string()));
    }

    #[test]
    fn test_set_setting_impl_upserts() {
        let state = test_state();
        set_setting_impl(&state, "theme", "light").expect("should set");
        set_setting_impl(&state, "theme", "dark").expect("should upsert");
        let result = get_setting_impl(&state, "theme").expect("should get");
        assert_eq!(result, Some("dark".to_string()));
    }

    #[test]
    fn test_get_all_settings_impl_empty() {
        let state = test_state();
        let all = get_all_settings_impl(&state).expect("should get all");
        assert!(all.is_empty());
    }

    #[test]
    fn test_get_all_settings_impl_with_values() {
        let state = test_state();
        set_setting_impl(&state, "theme", "dark").expect("should set theme");
        set_setting_impl(&state, "font", "mono").expect("should set font");
        let all = get_all_settings_impl(&state).expect("should get all");
        assert_eq!(all.len(), 2);
        assert_eq!(all.get("theme"), Some(&"dark".to_string()));
        assert_eq!(all.get("font"), Some(&"mono".to_string()));
    }
}
