mod commands;
pub mod db;
pub mod state;

use db::connection::open_database;
use db::migrations::run_migrations;
use state::AppState;
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;

/// Initialize the SQLite database for the application.
/// Opens the database at the given app data directory and runs all pending migrations.
pub fn initialize_database(app_data_dir: &Path) -> Result<AppState, String> {
    let db_path = app_data_dir.join("mysql-client.db");
    let conn =
        open_database(db_path).map_err(|e| format!("failed to open SQLite database: {e}"))?;
    run_migrations(&conn).map_err(|e| format!("failed to run database migrations: {e}"))?;
    Ok(AppState {
        db: Mutex::new(conn),
    })
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let state = initialize_database(&dir)
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::get_all_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

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
        let state = result.unwrap();
        let conn = state.db.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='settings'",
                [],
                |row| row.get(0),
            )
            .expect("should query sqlite_master");
        assert_eq!(count, 1);

        drop(conn);
        drop(state);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    #[test]
    fn test_initialize_database_runs_all_migrations() {
        let (app_data_dir, _name) = unique_temp_dir("test_init_mig");

        let state = initialize_database(&app_data_dir).expect("should initialize");
        let conn = state.db.lock().unwrap();

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
        drop(state);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    #[test]
    fn test_initialize_database_enables_wal_mode() {
        let (app_data_dir, _name) = unique_temp_dir("test_init_wal");

        let state = initialize_database(&app_data_dir).expect("should initialize");
        let conn = state.db.lock().unwrap();

        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode;", [], |row| row.get(0))
            .expect("should query journal_mode");
        assert_eq!(journal_mode, "wal");

        drop(conn);
        drop(state);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    #[test]
    fn test_initialize_database_is_idempotent() {
        let (app_data_dir, _name) = unique_temp_dir("test_init_idem");

        // First init
        let state1 = initialize_database(&app_data_dir).expect("first init should succeed");
        {
            let conn = state1.db.lock().unwrap();
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('test_key', 'test_value')",
                [],
            )
            .expect("should insert");
        }
        drop(state1);

        // Second init (re-opening the same database)
        let state2 = initialize_database(&app_data_dir).expect("second init should succeed");
        let conn = state2.db.lock().unwrap();
        let value: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'test_key'",
                [],
                |row| row.get(0),
            )
            .expect("should find previously inserted value");
        assert_eq!(value, "test_value");

        drop(conn);
        drop(state2);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }
}
