use rusqlite::Connection;
use std::sync::Mutex;
use tauri::AppHandle;

use crate::mysql::registry::ConnectionRegistry;

/// Application-wide state accessible from Tauri commands.
pub struct AppState {
    /// SQLite database connection for local persistence.
    pub db: Mutex<Connection>,
    /// Registry of active MySQL connection pools.
    pub registry: ConnectionRegistry,
    /// Tauri app handle (None only in unit tests where AppHandle is unavailable).
    pub app_handle: Option<AppHandle>,
}
