pub mod ai;
pub mod ai_memory;
pub mod commands;
pub mod credentials;
pub mod db;
pub mod export;
pub mod logging;
pub mod mysql;
pub mod schema_index;
pub mod state;

use db::connection::open_database;
use db::migrations::{
    run_migrations, MIGRATION_CONNECTION_CASCADE_CLEANUP, MIGRATION_VACUUM_STATE_MAIN,
};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Once;

/// Register the sqlite-vec extension as a global auto-extension.
///
/// Uses `sqlite3_auto_extension` so that every new `Connection::open*` call
/// automatically loads the vec0 virtual table support. Safe to call multiple
/// times — a `Once` guard ensures the FFI registration happens exactly once.
pub fn init_sqlite_vec() {
    static INIT: Once = Once::new();
    INIT.call_once(|| unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    });
}

/// Directory for SQLite, logs, and other app data.
///
/// In debug builds (`pnpm tauri dev`, `cargo build`), uses a sibling folder `{identifier}-dev`
/// so development does not read or write the same files as release installs.
pub fn resolved_app_data_dir(base: &Path) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        match base.file_name().and_then(|n| n.to_str()) {
            Some(name) => base.with_file_name(format!("{name}-dev")),
            None => base.to_path_buf(),
        }
    }
    #[cfg(not(debug_assertions))]
    {
        base.to_path_buf()
    }
}

/// Initialize the SQLite database for the application.
/// Opens the database at the given app data directory and runs all pending migrations.
/// Returns the raw Connection — caller assembles AppState.
pub fn initialize_database(app_data_dir: &Path) -> Result<Connection, String> {
    // Register sqlite-vec auto-extension before opening any connection.
    init_sqlite_vec();

    let db_path = app_data_dir.join("sqllumen.db");
    let mut conn =
        open_database(db_path).map_err(|e| format!("failed to open SQLite database: {e}"))?;
    let applied =
        run_migrations(&mut conn).map_err(|e| format!("failed to run database migrations: {e}"))?;

    // When the cascade-cleanup migration is first applied it rebuilds several
    // large tables, leaving freed pages behind. Reclaim that disk space with a
    // single VACUUM. VACUUM is illegal inside a transaction and the migration
    // runner wraps each migration in one, so it must run here, after the loop.
    if applied
        .iter()
        .any(|&version| version == MIGRATION_CONNECTION_CASCADE_CLEANUP)
    {
        tracing::info!("migration 013 newly applied; running one-time VACUUM to reclaim space");
        if let Err(e) = conn.execute_batch("VACUUM;") {
            tracing::error!(error = ?e, "one-time VACUUM after migration 013 failed");
        }
    }

    // When the vacuum-state migration is first applied, convert the database to
    // incremental auto-vacuum mode. Enabling incremental auto-vacuum on an
    // existing database requires a full VACUUM to take effect; VACUUM is illegal
    // inside a transaction, so the conversion runs here rather than in migration
    // SQL.
    if applied
        .iter()
        .any(|&version| version == MIGRATION_VACUUM_STATE_MAIN)
    {
        tracing::info!(
            "migration 014 newly applied; converting main database to incremental auto-vacuum"
        );
        crate::db::vacuum::convert_to_incremental_vacuum(&conn, "main database");
    }

    // Enable foreign-key enforcement for production. This is the sole owner of
    // FK enablement (run_migrations leaves it off so default test helpers stay
    // FK-off). PRAGMA foreign_keys is a no-op inside a transaction, so it is set
    // here, outside any transaction.
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("failed to enable foreign key enforcement: {e}"))?;

    Ok(conn)
}

/// Run a single incremental-vacuum evaluation for one database, off the async
/// runtime. The `Arc<Mutex<Connection>>` is locked inside `spawn_blocking`, so
/// the std mutex guard never crosses an `.await`. Every failure (lock poison,
/// join error, or a `vacuum_if_stale` error) is logged via `tracing::warn!` and
/// swallowed so the caller's loop keeps running.
#[cfg(not(any(test, coverage)))]
async fn run_vacuum_pass(
    handle: &std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    db_label: &'static str,
) {
    let handle = std::sync::Arc::clone(handle);
    let join_result = tauri::async_runtime::spawn_blocking(move || {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        match handle.lock() {
            Ok(conn) => {
                if let Err(e) = crate::db::vacuum::vacuum_if_stale(&conn, now) {
                    tracing::warn!(error = ?e, db = db_label, "incremental vacuum failed");
                }
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    db = db_label,
                    "failed to acquire db lock for incremental vacuum"
                );
            }
        }
    })
    .await;

    if let Err(e) = join_result {
        tracing::warn!(error = %e, db = db_label, "vacuum maintenance task failed");
    }
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
                    .browser_accelerator_keys(cfg!(debug_assertions))
                    // Always enable at the WebView2 level to prevent a black screen
                    // in production builds.  WRY sets `AreDevToolsEnabled(false)` when
                    // the Tauri `devtools` feature is off, and some WebView2 runtime
                    // versions fail to render the page in that state.  Re-enabling it
                    // here is safe because all shortcuts that open DevTools are already
                    // blocked: `Flags::DEV_TOOLS` prevents Ctrl+Shift+I via the
                    // injected JS, `browser_accelerator_keys(false)` disables F12 and
                    // other browser shortcuts, and `Flags::CONTEXT_MENU` removes the
                    // right-click menu.
                    .dev_tools(true),
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
    use mysql::result_cache::{ResultCache, SysinfoMemorySnapshot};
    use mysql::table_data_cache::TableDataCache;
    use state::AppState;
    use std::sync::atomic::AtomicU64;
    use std::sync::{Arc, Mutex};
    use tauri::Manager;

    let mut builder = tauri::Builder::default();

    builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    builder = builder.plugin(tauri_plugin_process::init());

    #[cfg(feature = "dialog")]
    {
        builder = builder.plugin(tauri_plugin_dialog::init());
    }

    builder = builder.plugin(tauri_plugin_os::init());
    builder = builder.plugin(tauri_plugin_clipboard_manager::init());
    builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

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
            let base = app.path().app_data_dir()?;
            let dir = resolved_app_data_dir(&base);
            let log_db_path = dir.join(crate::logging::log_store::LOG_DB_FILE_NAME);

            // Initialize the logs database (run migrations + one-time
            // incremental auto-vacuum conversion) on a single connection BEFORE
            // the log-writer thread opens its own connection, so migrations and
            // the conversion happen exactly once with no cross-connection race.
            let logs_conn = crate::logging::log_store::initialize_log_database(&log_db_path)
                .map_err(|e| -> Box<dyn std::error::Error> {
                    format!("failed to initialize log database: {e}").into()
                })?;

            let logging_init = crate::logging::init_logging(&log_db_path)
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

            let conn = initialize_database(&dir)
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

            if !logging_init.rust_log_env_set {
                crate::logging::apply_log_level_from_settings(&conn, &logging_init.filter_reload);
            }

            // Read cached TTL from settings (default 30 minutes = 1800 seconds)
            let cache_ttl_secs: u64 = crate::db::settings::get_setting(&conn, "results.cacheTTL")
                .ok()
                .flatten()
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(1800);

            let spill_dir = resolved_app_data_dir(&base).join("sqllumen-spill");

            // Startup cleanup: wipe leftover spill files from previous sessions
            if spill_dir.exists() {
                if let Err(e) = std::fs::remove_dir_all(&spill_dir) {
                    tracing::warn!(
                        error = %e,
                        path = %spill_dir.display(),
                        "failed to clean up spill directory on startup"
                    );
                }
            }

            let shared_cache_ttl = Arc::new(AtomicU64::new(cache_ttl_secs));
            let result_cache = Arc::new(ResultCache::new_with_shared_ttl(
                Arc::clone(&shared_cache_ttl),
                spill_dir.clone(),
            ));
            let table_data_cache = Arc::new(TableDataCache::new_with_shared_ttl(
                Arc::clone(&shared_cache_ttl),
                spill_dir.clone(),
            ));

            // Spawn background maintenance task for cache eviction and RAM pressure.
            {
                let result_cache_for_task = Arc::clone(&result_cache);
                let table_data_cache_for_task = Arc::clone(&table_data_cache);
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                        let result_cache_for_blocking = Arc::clone(&result_cache_for_task);
                        let table_data_cache_for_blocking = Arc::clone(&table_data_cache_for_task);
                        let join_result = tauri::async_runtime::spawn_blocking(move || {
                            let mut snapshot = SysinfoMemorySnapshot::new();
                            result_cache_for_blocking.run_maintenance(&mut snapshot);
                            table_data_cache_for_blocking.run_maintenance(&mut snapshot);
                        })
                        .await;

                        if let Err(e) = join_result {
                            tracing::warn!(
                                error = %e,
                                "cache maintenance task failed"
                            );
                        }
                    }
                });
            }

            tracing::info!(
                target: "sqllumen_lib",
                rust_log_env_set = logging_init.rust_log_env_set,
                log_db_path = %log_db_path.display(),
                "logging initialized"
            );

            let state = AppState {
                db: Arc::new(Mutex::new(conn)),
                logs_db: Arc::new(Mutex::new(logs_conn)),
                registry: ConnectionRegistry::new(),
                app_handle: Some(app.handle().clone()),
                result_cache,
                table_data_cache,
                metadata_cache: crate::mysql::metadata_cache::MetadataCache::new(),
                log_filter_reload: Mutex::new(Some(logging_init.filter_reload)),
                running_queries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
                dump_jobs: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
                import_jobs: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
                copy_jobs: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
                ai_requests: Arc::new(Mutex::new(std::collections::HashMap::new())),
                index_build_tokens: Arc::new(Mutex::new(std::collections::HashMap::new())),
                session_profile_map: Arc::new(Mutex::new(std::collections::HashMap::new())),
                session_ref_counts: Arc::new(Mutex::new(std::collections::HashMap::new())),
                http_client: reqwest::Client::builder()
                    // Give Ollama (and other local LLM servers) up to 30 s to
                    // finish loading a model before refusing the connection.
                    .connect_timeout(std::time::Duration::from_secs(30))
                    .timeout(std::time::Duration::from_secs(300))
                    .build()
                    .expect("failed to build shared HTTP client"),
                embedding_cache: crate::schema_index::embeddings_cache::EmbeddingCache::new(),
            };
            app.manage(state);

            // Prune old history entries on startup (fire-and-forget).
            let db_handle = {
                let managed_state = app.state::<AppState>();
                Arc::clone(&managed_state.db)
            };
            tauri::async_runtime::spawn(async move {
                match db_handle.lock() {
                    Ok(conn) => {
                        match crate::db::history::prune_all_history(&conn) {
                            Ok(pruned) if pruned > 0 => {
                                tracing::info!(
                                    target: "sqllumen_lib",
                                    pruned,
                                    "pruned old history entries on startup"
                                );
                            }
                            Ok(_) => {} // nothing to prune
                            Err(e) => {
                                tracing::warn!(
                                    error = %e,
                                    "failed to prune history on startup"
                                );
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            error = %e,
                            "failed to acquire db lock for history pruning"
                        );
                    }
                }
            });

            // Periodic SQLite maintenance: keep both embedded databases tidy by
            // draining their free lists via incremental vacuum. A startup pass
            // handles frequently-restarted sessions; a recurring 6-hour timer
            // handles long-running sessions. All Connection access happens inside
            // spawn_blocking so the std::sync::Mutex guard never crosses an
            // `.await`, and every failure is logged-and-skipped so the loop is
            // eternal.
            let managed_state = app.state::<AppState>();

            // Startup pass for both databases.
            {
                let startup_main = Arc::clone(&managed_state.db);
                let startup_logs = Arc::clone(&managed_state.logs_db);
                tauri::async_runtime::spawn(async move {
                    run_vacuum_pass(&startup_main, "main").await;
                    run_vacuum_pass(&startup_logs, "logs").await;
                });
            }

            // Recurring 6-hour pass for both databases. This loop never
            // terminates due to a vacuum error.
            {
                let interval_main = Arc::clone(&managed_state.db);
                let interval_logs = Arc::clone(&managed_state.logs_db);
                tauri::async_runtime::spawn(async move {
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(
                        crate::db::vacuum::VACUUM_STALENESS_SECS,
                    ));
                    // The first tick fires immediately; consume it so the startup
                    // pass above is not duplicated right away.
                    interval.tick().await;
                    loop {
                        interval.tick().await;
                        run_vacuum_pass(&interval_main, "main").await;
                        run_vacuum_pass(&interval_logs, "logs").await;
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::get_all_settings,
            commands::app_info::get_app_info,
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
            commands::mysql::list_open_connection_sessions,
            commands::schema::list_databases,
            commands::schema::list_schema_objects,
            commands::schema::list_columns,
            commands::schema::get_table_foreign_keys,
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
            commands::schema::invalidate_metadata_cache,
            commands::schema_cache::load_schema_cache_snapshot,
            commands::schema_cache::save_schema_cache_snapshot,
            commands::table_designer::load_table_for_designer,
            commands::table_designer::generate_table_ddl,
            commands::table_designer::apply_table_ddl,
            commands::session::select_database,
            commands::query::execute_query,
            commands::query::fetch_cached_rows,
            commands::query::evict_results,
            commands::query::fetch_schema_metadata,
            commands::query::fetch_schema_metadata_full,
            commands::query::read_file,
            commands::query::write_file,
            commands::query::sort_results,
            commands::query::analyze_query_for_edit,
            commands::query::update_result_cell,
            commands::query::cancel_query,
            commands::query::reexecute_single_result,
            commands::query::execute_multi_query,
            commands::query::execute_call_query,
            commands::query::touch_results,
            commands::export::export_results,
            commands::table_data::fetch_table_data,
            commands::table_data::touch_table_data,
            commands::table_data::evict_table_data,
            commands::table_data::restore_table_data_cache,
            commands::table_data::sync_table_data_cache_after_insert,
            commands::table_data::sync_table_data_cache_after_update,
            commands::table_data::sync_table_data_cache_after_delete,
            commands::table_data::update_table_row,
            commands::table_data::insert_table_row,
            commands::table_data::delete_table_row,
            commands::table_data::export_table_data,
            commands::table_data::fetch_blob_value,
            commands::table_data::read_file_bytes,
            commands::table_data::write_file_bytes,
            commands::frontend_log::log_frontend,
            commands::object_editor::get_object_body,
            commands::object_editor::save_object,
            commands::object_editor::drop_object,
            commands::object_editor::get_routine_parameters,
            commands::object_editor::get_routine_parameters_with_return_type,
            commands::history::list_history,
            commands::history::delete_history_entry,
            commands::history::clear_history,
            commands::logs::list_logs,
            commands::logs::export_logs,
            commands::session_snapshots::create_session_snapshot,
            commands::session_snapshots::list_session_snapshots,
            commands::session_snapshots::get_session_snapshot,
            commands::session_snapshots::delete_session_snapshot,
            commands::favorites::create_favorite,
            commands::favorites::list_favorites,
            commands::favorites::update_favorite,
            commands::favorites::delete_favorite,
            commands::sql_dump::list_exportable_objects,
            commands::sql_dump::start_sql_dump,
            commands::sql_dump::get_dump_progress,
            commands::sql_dump::cancel_dump,
            commands::sql_dump::start_sql_import,
            commands::sql_dump::get_import_progress,
            commands::sql_dump::cancel_import,
            commands::copy_to_host::list_copyable_objects,
            commands::copy_to_host::start_copy_to_host,
            commands::copy_to_host::get_copy_progress,
            commands::copy_to_host::cancel_copy,
            commands::ai::ai_chat,
            commands::ai::ai_cancel,
            commands::ai::list_ai_models,
            commands::ai::ai_query_expand,
            commands::schema_index::build_schema_index,
            commands::schema_index::force_rebuild_schema_index,
            commands::schema_index::semantic_search,
            commands::schema_index::get_index_status,
            commands::schema_index::invalidate_schema_index,
            commands::schema_index::list_indexed_tables,
            commands::processlist::get_processlist,
            commands::processlist::kill_queries,
            commands::ai_memory::save_memory,
            commands::ai_memory::list_global_memories,
            commands::ai_memory::list_group_memories,
            commands::ai_memory::list_connection_memories,
            commands::ai_memory::delete_memory,
            commands::ai_memory::move_memory,
            commands::ai_memory::search_memories,
            commands::ai_memory::reembed_all_memories,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Coverage builds still compile the bin target (`main.rs`), which calls `run()`.
/// Provide a no-op stub so coverage can focus on the testable library surface
/// without linking or executing the full Tauri runtime on Windows.
#[cfg(coverage)]
pub fn run() {}
