use rusqlite::Connection;
use std::sync::Mutex;

/// Application-wide state accessible from Tauri commands.
pub struct AppState {
    pub db: Mutex<Connection>,
}
