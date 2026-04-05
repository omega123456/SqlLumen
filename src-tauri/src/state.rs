use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Mutex, RwLock};
use tauri::AppHandle;
use tokio::sync::RwLock as TokioRwLock;

use crate::logging::LogFilterReloadHandle;
use crate::mysql::query_executor::StoredResult;
use crate::mysql::registry::ConnectionRegistry;

/// Application-wide state accessible from Tauri commands.
pub struct AppState {
    /// SQLite database connection for local persistence.
    pub db: Mutex<Connection>,
    /// Registry of active MySQL connection pools.
    pub registry: ConnectionRegistry,
    /// Tauri app handle (None only in unit tests where AppHandle is unavailable).
    pub app_handle: Option<AppHandle>,
    /// In-memory query results keyed by (connection_id, tab_id).
    /// Each entry is a vector of results to support multi-query execution.
    pub results: RwLock<HashMap<(String, String), Vec<StoredResult>>>,
    /// Reload handle for `EnvFilter` when `log.level` changes (None in tests).
    pub log_filter_reload: Mutex<Option<LogFilterReloadHandle>>,
    /// MySQL thread IDs for currently running queries, keyed by (connection_id, tab_id).
    /// Used to issue `KILL QUERY` for cancellation.
    pub running_queries: TokioRwLock<HashMap<(String, String), u64>>,
}
