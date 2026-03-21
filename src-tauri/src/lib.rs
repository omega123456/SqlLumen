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

    builder = builder.plugin(tauri_plugin_clipboard_manager::init());

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
            commands::schema::list_databases,
            commands::schema::list_schema_objects,
            commands::schema::list_columns,
            commands::schema::get_schema_info,
            commands::schema::get_database_details,
            commands::schema::list_charsets,
            commands::schema::list_collations,
            commands::schema::create_database,
            commands::schema::drop_database,
            commands::schema::alter_database,
            commands::schema::rename_database,
            commands::schema::drop_table,
            commands::schema::truncate_table,
            commands::schema::rename_table,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Coverage builds still compile the bin target (`main.rs`), which calls `run()`.
/// Provide a no-op stub so coverage can focus on the testable library surface
/// without linking or executing the full Tauri runtime on Windows.
#[cfg(coverage)]
pub fn run() {}
