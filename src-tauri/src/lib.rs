pub mod commands;
pub mod credentials;
pub mod db;
pub mod export;
pub mod logging;
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

#[cfg(not(any(test, coverage)))]
fn prevent_default_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_prevent_default::Flags;

    let flags = if cfg!(debug_assertions) {
        Flags::all().difference(Flags::DEV_TOOLS)
    } else {
        Flags::all()
    };

    #[cfg(target_os = "windows")]
    {
        use tauri_plugin_prevent_default::PlatformOptions;

        tauri_plugin_prevent_default::Builder::new()
            .with_flags(flags)
            .platform(
                PlatformOptions::new()
                    .general_autofill(false)
                    .password_autosave(false)
                    // WebView2 disables F12/Ctrl+Shift+I when false; keep true in debug so DevTools work with `tauri dev`.
                    .browser_accelerator_keys(cfg!(debug_assertions)),
            )
            .build()
    }

    #[cfg(not(target_os = "windows"))]
    {
        tauri_plugin_prevent_default::Builder::new()
            .with_flags(flags)
            .build()
    }
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

    builder = builder.plugin(prevent_default_plugin());

    // Hypothesi MCP bridge: WebSocket for @hypothesi/tauri-mcp-server (see .cursor/mcp.json, opencode.json).
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(
            tauri_plugin_mcp_bridge::Builder::new()
                .bind_address("127.0.0.1")
                .build(),
        );
    }

    builder
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let log_dir = dir.join("logs");
            let logging_init = crate::logging::init_logging(&log_dir)
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

            let conn = initialize_database(&dir)
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

            if !logging_init.rust_log_env_set {
                crate::logging::apply_log_level_from_settings(&conn, &logging_init.filter_reload);
            }

            tracing::info!(
                target: "mysql_client_lib",
                rust_log_env_set = logging_init.rust_log_env_set,
                log_dir = %log_dir.display(),
                "logging initialized"
            );

            let state = AppState {
                db: Mutex::new(conn),
                registry: ConnectionRegistry::new(),
                app_handle: Some(app.handle().clone()),
                results: std::sync::RwLock::new(std::collections::HashMap::new()),
                log_filter_reload: Mutex::new(Some(logging_init.filter_reload)),
                running_queries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
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
            commands::table_designer::load_table_for_designer,
            commands::table_designer::generate_table_ddl,
            commands::table_designer::apply_table_ddl,
            commands::session::select_database,
            commands::query::execute_query,
            commands::query::fetch_result_page,
            commands::query::evict_results,
            commands::query::fetch_schema_metadata,
            commands::query::read_file,
            commands::query::write_file,
            commands::query::sort_results,
            commands::query::analyze_query_for_edit,
            commands::query::update_result_cell,
            commands::query::cancel_query,
            commands::export::export_results,
            commands::table_data::fetch_table_data,
            commands::table_data::update_table_row,
            commands::table_data::insert_table_row,
            commands::table_data::delete_table_row,
            commands::table_data::export_table_data,
            commands::frontend_log::log_frontend,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Coverage builds still compile the bin target (`main.rs`), which calls `run()`.
/// Provide a no-op stub so coverage can focus on the testable library surface
/// without linking or executing the full Tauri runtime on Windows.
#[cfg(coverage)]
pub fn run() {}
