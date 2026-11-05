pub mod ai;
pub mod ai_memory;
pub mod app_info;
pub mod connection_groups;
pub mod connections;
pub mod copy_to_host;
pub mod export;
pub mod favorites;
pub mod frontend_log;
pub mod helpers;
pub mod history;
pub mod logs;
pub mod mysql;
pub mod object_editor;
pub mod processlist;
pub mod query;
pub mod query_history_bridge;
pub mod schema;
pub mod schema_cache;
pub mod schema_index;
pub mod session;
pub mod session_snapshots;
pub mod settings;
pub mod sql_dump;
pub mod table_data;
pub mod table_designer;
pub mod window_chrome;

use crate::state::AppState;
use tauri::Manager;

/// Run a synchronous `*_impl` on the blocking thread pool.
///
/// Tauri runs non-async commands on the main (UI) thread, so commands that copy
/// or scan large cached results use this from an async wrapper to keep the
/// window responsive.
pub async fn run_blocking_with_state<R, T, F>(app: tauri::AppHandle<R>, f: F) -> Result<T, String>
where
    R: tauri::Runtime,
    T: Send + 'static,
    F: FnOnce(&AppState) -> T + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || f(&app.state::<AppState>()))
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "blocking command task failed");
            format!("Blocking command task failed: {e}")
        })
}
