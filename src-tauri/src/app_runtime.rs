use crate::logging::LoggingInit;
use crate::mysql::registry::ConnectionRegistry;
use crate::mysql::result_cache::{ResultCache, SysinfoMemorySnapshot};
use crate::mysql::table_data_cache::TableDataCache;
use crate::state::AppState;
use crate::{commands, resolved_app_data_dir, window_chrome};
use rusqlite::Connection;
use std::collections::HashMap;
use std::error::Error;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::Manager;

type SharedConnection = Arc<Mutex<Connection>>;

const DEFAULT_CACHE_TTL_SECONDS: u64 = 1800;
const CACHE_MAINTENANCE_INTERVAL: Duration = Duration::from_secs(30);
const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
const SPILL_DIRECTORY_NAME: &str = "sqllumen-spill";
const MAIN_DATABASE_LABEL: &str = "main";
const LOGS_DATABASE_LABEL: &str = "logs";

struct SharedCaches {
    result_cache: Arc<ResultCache>,
    table_data_cache: Arc<TableDataCache>,
}

struct AppStateParts {
    conn: Connection,
    logs_conn: Connection,
    caches: SharedCaches,
}

pub fn run() {
    let builder = register_plugins(tauri::Builder::default());
    builder
        .setup(setup_app)
        .invoke_handler(registered_command_handler!())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn register_plugins(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    #[cfg(feature = "dialog")]
    let builder = builder.plugin(tauri_plugin_dialog::init());
    let builder = builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(prevent_default_plugin());
    // Hypothesi MCP bridge: WebSocket for @hypothesi/tauri-mcp-server (see .cursor/mcp.json, opencode.json).
    #[cfg(debug_assertions)]
    let builder = builder.plugin(
        tauri_plugin_mcp_bridge::Builder::new()
            .bind_address("127.0.0.1")
            .build(),
    );
    builder
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn Error>> {
    if let Some(window) = app.get_webview_window("main") {
        window_chrome::apply_backdrop(&window);
    }
    let base = app.path().app_data_dir()?;
    let dir = resolved_app_data_dir(&base);
    let log_db_path = dir.join(crate::logging::log_store::LOG_DB_FILE_NAME);

    // The logs database must be initialised before the log-writer thread opens its own connection.
    let logs_conn = crate::logging::log_store::initialize_log_database(&log_db_path).map_err(
        |error| -> Box<dyn Error> { format!("failed to initialize log database: {error}").into() },
    )?;
    let logging_init = crate::logging::init_logging(&log_db_path)
        .map_err(|error| -> Box<dyn Error> { error.into() })?;
    let conn =
        crate::initialize_database(&dir).map_err(|error| -> Box<dyn Error> { error.into() })?;

    if !logging_init.rust_log_env_set {
        crate::logging::apply_log_level_from_settings(&conn, &logging_init.filter_reload);
    }

    let caches = create_shared_caches(&conn, dir.join(SPILL_DIRECTORY_NAME));
    spawn_cache_maintenance(&caches);
    tracing::info!(
        target: "sqllumen_lib",
        rust_log_env_set = logging_init.rust_log_env_set,
        log_db_path = %log_db_path.display(),
        "logging initialized"
    );

    let parts = AppStateParts {
        conn,
        logs_conn,
        caches,
    };
    app.manage(build_app_state(app.handle(), parts, logging_init));
    spawn_database_maintenance(app.state::<AppState>().inner());
    Ok(())
}

fn load_cache_ttl_seconds(conn: &Connection) -> u64 {
    crate::db::settings::get_setting(conn, "results.cacheTTL")
        .ok()
        .flatten()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_CACHE_TTL_SECONDS)
}

fn remove_leftover_spill_directory(spill_dir: &Path) {
    if !spill_dir.exists() {
        return;
    }
    if let Err(error) = std::fs::remove_dir_all(spill_dir) {
        tracing::warn!(
            error = %error,
            path = %spill_dir.display(),
            "failed to clean up spill directory on startup"
        );
    }
}

fn create_shared_caches(conn: &Connection, spill_dir: PathBuf) -> SharedCaches {
    remove_leftover_spill_directory(&spill_dir);
    let shared_cache_ttl = Arc::new(AtomicU64::new(load_cache_ttl_seconds(conn)));
    let result_cache = Arc::new(ResultCache::new_with_shared_ttl(
        Arc::clone(&shared_cache_ttl),
        spill_dir.clone(),
    ));
    result_cache.set_row_ceiling(commands::settings::load_results_max_rows(conn));
    let table_data_cache = Arc::new(TableDataCache::new_with_shared_ttl(
        shared_cache_ttl,
        spill_dir,
    ));
    SharedCaches {
        result_cache,
        table_data_cache,
    }
}

fn spawn_cache_maintenance(caches: &SharedCaches) {
    let result_cache = Arc::clone(&caches.result_cache);
    let table_data_cache = Arc::clone(&caches.table_data_cache);
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(CACHE_MAINTENANCE_INTERVAL).await;
            run_cache_maintenance_pass(&result_cache, &table_data_cache).await;
        }
    });
}

async fn run_cache_maintenance_pass(
    result_cache: &Arc<ResultCache>,
    table_data_cache: &Arc<TableDataCache>,
) {
    let result_cache = Arc::clone(result_cache);
    let table_data_cache = Arc::clone(table_data_cache);
    let join_result = tauri::async_runtime::spawn_blocking(move || {
        let mut snapshot = SysinfoMemorySnapshot::new();
        result_cache.run_maintenance(&mut snapshot);
        table_data_cache.run_maintenance(&mut snapshot);
    })
    .await;
    if let Err(error) = join_result {
        tracing::warn!(error = %error, "cache maintenance task failed");
    }
}

fn build_http_client() -> reqwest::Client {
    crate::http_client_builder()
        // Ollama and other local LLM servers may need this long to load a model before accepting connections.
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .timeout(HTTP_REQUEST_TIMEOUT)
        .build()
        .expect("failed to build shared HTTP client")
}

fn build_app_state(
    app_handle: &tauri::AppHandle,
    parts: AppStateParts,
    logging_init: LoggingInit,
) -> AppState {
    AppState {
        db: Arc::new(Mutex::new(parts.conn)),
        logs_db: Arc::new(Mutex::new(parts.logs_conn)),
        registry: ConnectionRegistry::new(),
        app_handle: Some(app_handle.clone()),
        result_cache: parts.caches.result_cache,
        table_data_cache: parts.caches.table_data_cache,
        metadata_cache: crate::mysql::metadata_cache::MetadataCache::new(),
        log_filter_reload: Mutex::new(Some(logging_init.filter_reload)),
        running_queries: tokio::sync::RwLock::new(HashMap::new()),
        editor_sessions: Default::default(),
        dump_jobs: Arc::new(RwLock::new(HashMap::new())),
        import_jobs: Arc::new(RwLock::new(HashMap::new())),
        result_export_jobs: Arc::new(RwLock::new(HashMap::new())),
        copy_jobs: Arc::new(RwLock::new(HashMap::new())),
        ai_requests: Arc::new(Mutex::new(HashMap::new())),
        index_build_tokens: Arc::new(Mutex::new(HashMap::new())),
        session_profile_map: Arc::new(Mutex::new(HashMap::new())),
        session_ref_counts: Arc::new(Mutex::new(HashMap::new())),
        http_client: build_http_client(),
        embedding_cache: crate::schema_index::embeddings_cache::EmbeddingCache::new(),
    }
}

fn spawn_database_maintenance(state: &AppState) {
    let history_db = Arc::clone(&state.db);
    tauri::async_runtime::spawn(async move {
        prune_history_on_startup(&history_db);
    });

    let startup_main = Arc::clone(&state.db);
    let startup_logs = Arc::clone(&state.logs_db);
    tauri::async_runtime::spawn(async move {
        run_vacuum_pass(&startup_main, MAIN_DATABASE_LABEL).await;
        run_vacuum_pass(&startup_logs, LOGS_DATABASE_LABEL).await;
    });

    let interval_main = Arc::clone(&state.db);
    let interval_logs = Arc::clone(&state.logs_db);
    tauri::async_runtime::spawn(async move {
        run_recurring_vacuum(&interval_main, &interval_logs).await;
    });
}

fn prune_history_on_startup(db_handle: &SharedConnection) {
    let conn = match db_handle.lock() {
        Ok(conn) => conn,
        Err(error) => {
            tracing::warn!(error = %error, "failed to acquire db lock for history pruning");
            return;
        }
    };
    match crate::db::history::prune_all_history(&conn) {
        Ok(pruned) if pruned > 0 => {
            tracing::info!(target: "sqllumen_lib", pruned, "pruned old history entries on startup");
        }
        Ok(_) => {}
        Err(error) => {
            tracing::warn!(error = %error, "failed to prune history on startup");
        }
    }
}

async fn run_recurring_vacuum(main_db: &SharedConnection, logs_db: &SharedConnection) {
    let mut interval = tokio::time::interval(Duration::from_secs(
        crate::db::vacuum::VACUUM_STALENESS_SECS,
    ));
    // The first tick fires immediately and would duplicate the startup pass.
    interval.tick().await;
    loop {
        interval.tick().await;
        run_vacuum_pass(main_db, MAIN_DATABASE_LABEL).await;
        run_vacuum_pass(logs_db, LOGS_DATABASE_LABEL).await;
    }
}

fn vacuum_locked_database(handle: &SharedConnection, db_label: &'static str) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let conn = match handle.lock() {
        Ok(conn) => conn,
        Err(error) => {
            tracing::warn!(
                error = %error,
                db = db_label,
                "failed to acquire db lock for incremental vacuum"
            );
            return;
        }
    };
    if let Err(error) = crate::db::vacuum::vacuum_if_stale(&conn, now) {
        tracing::warn!(error = ?error, db = db_label, "incremental vacuum failed");
    }
}

async fn run_vacuum_pass(handle: &SharedConnection, db_label: &'static str) {
    let handle = Arc::clone(handle);
    let join_result =
        tauri::async_runtime::spawn_blocking(move || vacuum_locked_database(&handle, db_label))
            .await;
    if let Err(error) = join_result {
        tracing::warn!(error = %error, db = db_label, "vacuum maintenance task failed");
    }
}

fn prevent_default_flags() -> tauri_plugin_prevent_default::Flags {
    use tauri_plugin_prevent_default::Flags;

    if cfg!(debug_assertions) {
        return Flags::all().difference(Flags::DEV_TOOLS);
    }
    Flags::all()
}

fn prevent_default_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let flags = prevent_default_flags();

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
