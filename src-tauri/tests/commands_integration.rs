//! Integration tests for command-layer _impl functions.
//!
//! These test the same functions as the inline `#[cfg(test)]` modules in
//! `commands/settings.rs`, `commands/connections.rs`, `commands/connection_groups.rs`,
//! and `lib.rs`. They are placed here as integration tests because the lib test
//! binary on Windows crashes due to a comctl32 v6 manifest issue (the test binary
//! does not get the SxS manifest that Tauri provides to the bin target).

mod common;

use mysql_client_lib::commands::connection_groups::{
    create_connection_group_impl, delete_connection_group_impl, list_connection_groups_impl,
    update_connection_group_impl,
};
use mysql_client_lib::commands::connections::{
    delete_connection_impl, get_connection_impl, list_connections_impl, save_connection_impl,
    update_connection_impl, SaveConnectionInput, UpdateConnectionInput,
};
use mysql_client_lib::commands::settings::{
    get_all_settings_impl, get_setting_impl, set_setting_impl,
};
use mysql_client_lib::mysql::registry::ConnectionRegistry;
use mysql_client_lib::state::AppState;
use rusqlite::Connection;
use std::sync::Mutex;

fn test_state() -> AppState {
    let conn = Connection::open_in_memory().expect("should open in-memory db");
    mysql_client_lib::db::migrations::run_migrations(&conn).expect("should run migrations");
    AppState {
        db: Mutex::new(conn),
        registry: ConnectionRegistry::new(),
        app_handle: None,
    }
}

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
    let store_ok = mysql_client_lib::credentials::store_password(&probe_id, "probe").is_ok();
    if store_ok {
        let retrieve_ok = mysql_client_lib::credentials::retrieve_password(&probe_id).is_ok();
        let _ = mysql_client_lib::credentials::delete_password(&probe_id);
        retrieve_ok
    } else {
        false
    }
}

// ==========================================================================
// initialize_database tests (from lib.rs)
// ==========================================================================

fn unique_temp_dir(prefix: &str) -> (std::path::PathBuf, String) {
    let dir = std::env::temp_dir();
    let unique = format!(
        "{}_{}_{}",
        prefix,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    (dir.join(&unique), unique)
}

#[test]
fn test_initialize_database_succeeds() {
    let (app_data_dir, _) = unique_temp_dir("test_init_db_i");
    let result = mysql_client_lib::initialize_database(&app_data_dir);
    assert!(result.is_ok(), "initialize_database should succeed");
    let conn = result.unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='settings'",
            [],
            |row| row.get(0),
        )
        .expect("should query sqlite_master");
    assert_eq!(count, 1);
    drop(conn);
    let _ = std::fs::remove_dir_all(&app_data_dir);
}

#[test]
fn test_initialize_database_runs_all_migrations() {
    let (app_data_dir, _) = unique_temp_dir("test_init_mig_i");
    let conn = mysql_client_lib::initialize_database(&app_data_dir).expect("should initialize");
    for table in &[
        "settings",
        "connections",
        "connection_groups",
        "_migrations",
    ] {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |row| row.get(0),
            )
            .expect("should query sqlite_master");
        assert_eq!(count, 1, "table '{}' should exist", table);
    }
    drop(conn);
    let _ = std::fs::remove_dir_all(&app_data_dir);
}

#[test]
fn test_initialize_database_enables_wal_mode() {
    let (app_data_dir, _) = unique_temp_dir("test_init_wal_i");
    let conn = mysql_client_lib::initialize_database(&app_data_dir).expect("should initialize");
    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode;", [], |row| row.get(0))
        .expect("should query journal_mode");
    assert_eq!(journal_mode, "wal");
    drop(conn);
    let _ = std::fs::remove_dir_all(&app_data_dir);
}

#[test]
fn test_initialize_database_is_idempotent() {
    let (app_data_dir, _) = unique_temp_dir("test_init_idem_i");
    let conn1 = mysql_client_lib::initialize_database(&app_data_dir).expect("first init");
    conn1
        .execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('test_key', 'test_value')",
            [],
        )
        .expect("should insert");
    drop(conn1);
    let conn2 = mysql_client_lib::initialize_database(&app_data_dir).expect("second init");
    let value: String = conn2
        .query_row(
            "SELECT value FROM settings WHERE key = 'test_key'",
            [],
            |row| row.get(0),
        )
        .expect("should find value");
    assert_eq!(value, "test_value");
    drop(conn2);
    let _ = std::fs::remove_dir_all(&app_data_dir);
}

#[test]
fn test_initialize_database_surfaces_open_database_errors() {
    let (app_data_dir, _) = unique_temp_dir("test_init_open_err_i");
    std::fs::create_dir_all(&app_data_dir).expect("should create parent dir");
    let blocker = app_data_dir.join("blocked");
    std::fs::write(&blocker, "not a directory").expect("should create blocker file");

    let error = mysql_client_lib::initialize_database(&blocker)
        .expect_err("initialize_database should surface open_database failures");

    assert!(error.starts_with("failed to open SQLite database:"));
    let _ = std::fs::remove_dir_all(&app_data_dir);
}

#[test]
fn test_initialize_database_surfaces_migration_errors() {
    let (app_data_dir, _) = unique_temp_dir("test_init_migration_err_i");
    std::fs::create_dir_all(&app_data_dir).expect("should create app data dir");
    let db_path = app_data_dir.join("mysql-client.db");
    let conn = Connection::open(&db_path).expect("should create database file");
    conn.execute("CREATE TABLE _migrations (bad INTEGER)", [])
        .expect("should create incompatible migrations table");
    drop(conn);

    let error = mysql_client_lib::initialize_database(&app_data_dir)
        .expect_err("initialize_database should surface migration failures");

    assert!(error.starts_with("failed to run database migrations:"));
    let _ = std::fs::remove_dir_all(&app_data_dir);
}

// ==========================================================================
// Settings command tests (from commands/settings.rs)
// ==========================================================================

#[test]
fn test_get_setting_impl_returns_none_for_missing() {
    let state = test_state();
    let result = get_setting_impl(&state, "nonexistent").expect("should not error");
    assert_eq!(result, None);
}

#[test]
fn test_set_and_get_setting_impl() {
    let state = test_state();
    set_setting_impl(&state, "theme", "dark").expect("should set");
    let result = get_setting_impl(&state, "theme").expect("should get");
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
    set_setting_impl(&state, "theme", "dark").expect("set theme");
    set_setting_impl(&state, "font", "mono").expect("set font");
    let all = get_all_settings_impl(&state).expect("should get all");
    assert_eq!(all.len(), 2);
    assert_eq!(all.get("theme"), Some(&"dark".to_string()));
    assert_eq!(all.get("font"), Some(&"mono".to_string()));
}

// ==========================================================================
// Connection command tests (from commands/connections.rs)
// ==========================================================================

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
        .expect("should find");
    assert_eq!(record.id, id);
    assert_eq!(record.name, "Test DB");
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
        .expect("should find");
    assert!(!record.has_password);
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
    assert!(!row_data.contains("secret"));
    drop(conn);
    let _ = mysql_client_lib::credentials::delete_password(&id);
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
        .expect("should find");
    assert!(record.has_password);
    let _ = mysql_client_lib::credentials::delete_password(&id);
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
    let record = get_connection_impl(&state, &id)
        .expect("should not error")
        .expect("should find");
    assert!(!record.has_password);

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
    let record = get_connection_impl(&state, &id)
        .expect("should not error")
        .expect("should find");
    assert!(record.has_password);
    let _ = mysql_client_lib::credentials::delete_password(&id);
}

#[test]
fn test_delete_connection_tolerates_missing_keychain_entry() {
    let state = test_state();
    let id = save_connection_impl(&state, sample_save_input()).expect("should save");
    delete_connection_impl(&state, &id).expect("should delete even without keychain");
    let result = get_connection_impl(&state, &id).expect("should not error");
    assert!(result.is_none());
}

// ==========================================================================
// Connection group command tests (from commands/connection_groups.rs)
// ==========================================================================

#[test]
fn test_create_connection_group_impl_returns_uuid() {
    let state = test_state();
    let id = create_connection_group_impl(&state, "Production").expect("should create");
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
    let group_id = create_connection_group_impl(&state, "My Group").expect("should create");
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
    let conn_id = save_connection_impl(&state, input).expect("should save");
    delete_connection_group_impl(&state, &group_id).expect("should delete group");
    let record = get_connection_impl(&state, &conn_id)
        .expect("should not error")
        .expect("should exist");
    assert!(record.group_id.is_none());
}
