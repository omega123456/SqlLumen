pub mod commands;
pub mod credentials;
pub mod db;
pub mod mysql;
pub mod state;

use db::connection::open_database;
use db::migrations::run_migrations;
use rusqlite::Connection;
use std::path::Path;

/// Initialize the SQLite database for the application.
/// Opens the database at the given app data directory and runs all pending migrations.
/// Returns the raw Connection — caller assembles AppState.
pub fn initialize_database(app_data_dir: &Path) -> Result<Connection, String> {
    let db_path = app_data_dir.join("mysql-client.db");
    let conn =
        open_database(db_path).map_err(|e| format!("failed to open SQLite database: {e}"))?;
    run_migrations(&conn).map_err(|e| format!("failed to run database migrations: {e}"))?;
    Ok(conn)
}

/// The `run()` function is excluded from test builds to avoid linking GUI
/// dependencies (tao/wry/comctl32) that require a Windows SxS manifest
/// not present in test binaries.
#[cfg(not(any(test, coverage)))]
pub fn run() {
    use mysql::registry::ConnectionRegistry;
    use state::AppState;
    use std::sync::Mutex;
    use tauri::Manager;

    let mut builder = tauri::Builder::default();

    #[cfg(feature = "dialog")]
    {
        builder = builder.plugin(tauri_plugin_dialog::init());
    }

    builder
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let conn = initialize_database(&dir)
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            let state = AppState {
                db: Mutex::new(conn),
                registry: ConnectionRegistry::new(),
                app_handle: Some(app.handle().clone()),
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::get_all_settings,
            commands::connections::save_connection,
            commands::connections::get_connection,
            commands::connections::list_connections,
            commands::connections::update_connection,
            commands::connections::delete_connection,
            commands::connection_groups::create_connection_group,
            commands::connection_groups::list_connection_groups,
            commands::connection_groups::update_connection_group,
            commands::connection_groups::delete_connection_group,
            commands::mysql::test_connection,
            commands::mysql::open_connection,
            commands::mysql::close_connection,
            commands::mysql::get_connection_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Coverage builds still compile the bin target (`main.rs`), which calls `run()`.
/// Provide a no-op stub so coverage can focus on the testable library surface
/// without linking or executing the full Tauri runtime on Windows.
#[cfg(coverage)]
pub fn run() {}

#[cfg(test)]
mod tests {
    use super::*;

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
        let (app_data_dir, _name) = unique_temp_dir("test_init_db");

        let result = initialize_database(&app_data_dir);
        assert!(result.is_ok(), "initialize_database should succeed");

        // Verify settings table is usable
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
        let (app_data_dir, _name) = unique_temp_dir("test_init_mig");

        let conn = initialize_database(&app_data_dir).expect("should initialize");

        for table in &["settings", "connections", "connection_groups", "_migrations"] {
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
        let (app_data_dir, _name) = unique_temp_dir("test_init_wal");

        let conn = initialize_database(&app_data_dir).expect("should initialize");

        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode;", [], |row| row.get(0))
            .expect("should query journal_mode");
        assert_eq!(journal_mode, "wal");

        drop(conn);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    #[test]
    fn test_initialize_database_is_idempotent() {
        let (app_data_dir, _name) = unique_temp_dir("test_init_idem");

        // First init
        let conn1 = initialize_database(&app_data_dir).expect("first init should succeed");
        conn1
            .execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('test_key', 'test_value')",
                [],
            )
            .expect("should insert");
        drop(conn1);

        // Second init (re-opening the same database)
        let conn2 = initialize_database(&app_data_dir).expect("second init should succeed");
        let value: String = conn2
            .query_row(
                "SELECT value FROM settings WHERE key = 'test_key'",
                [],
                |row| row.get(0),
            )
            .expect("should find previously inserted value");
        assert_eq!(value, "test_value");

        drop(conn2);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }
}
