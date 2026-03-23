use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Mutex, RwLock};
use tauri::AppHandle;

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
    pub results: RwLock<HashMap<(String, String), StoredResult>>,
    /// Reload handle for `EnvFilter` when `log.level` changes (None in tests).
    pub log_filter_reload: Mutex<Option<LogFilterReloadHandle>>,
}
