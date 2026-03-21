//! Shared helpers for integration tests under `tests/`.
#![allow(dead_code)]
// Each integration test binary only uses a subset of helpers; unused items are expected.

use mysql_client_lib::commands::connections::SaveConnectionInput;
use mysql_client_lib::db::migrations;
use mysql_client_lib::mysql::registry::ConnectionRegistry;
use mysql_client_lib::state::AppState;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

/// Creates a fresh in-memory SQLite database with all migrations applied.
pub fn test_db() -> Connection {
    let conn = Connection::open_in_memory().expect("should open in-memory database");
    migrations::run_migrations(&conn).expect("should run migrations");
    conn
}

/// `AppState` backed by an in-memory migrated DB (for command `_impl` tests).
pub fn test_app_state() -> AppState {
    let conn = test_db();
    AppState {
        db: Mutex::new(conn),
        registry: ConnectionRegistry::new(),
        app_handle: None,
    }
}

/// Unique directory under the system temp dir (for filesystem-backed DB tests).
pub fn unique_temp_dir(prefix: &str) -> (PathBuf, String) {
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

/// Sample `SaveConnectionInput` without a password (no keychain required).
pub fn sample_save_input() -> SaveConnectionInput {
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

/// Whether the OS credential store is usable in this environment.
pub fn keychain_available() -> bool {
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
