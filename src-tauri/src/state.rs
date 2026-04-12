use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use tauri::AppHandle;
use tokio::sync::RwLock as TokioRwLock;

use crate::logging::LogFilterReloadHandle;
use crate::mysql::query_executor::StoredResult;
use crate::mysql::registry::ConnectionRegistry;
use tokio_util::sync::CancellationToken;

/// Status of a SQL dump export job.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DumpJobStatus {
    Running,
    Completed,
    Failed,
}

/// Progress info for an active or completed SQL dump export job.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpJobProgress {
    pub job_id: String,
    pub status: DumpJobStatus,
    pub tables_total: usize,
    pub tables_done: usize,
    pub current_table: Option<String>,
    pub bytes_written: u64,
    pub error_message: Option<String>,
    /// When the job reached a terminal state (Completed/Failed).
    /// Used for lazy cleanup of stale entries.
    #[serde(skip)]
    pub completed_at: Option<std::time::Instant>,
}

/// Status of a SQL import job.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ImportJobStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// An error encountered during SQL import execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportError {
    pub statement_index: usize,
    pub sql_preview: String,
    pub error_message: String,
}

/// Progress info for an active or completed SQL import job.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJobProgress {
    pub job_id: String,
    pub status: ImportJobStatus,
    pub statements_total: usize,
    pub statements_done: usize,
    pub errors: Vec<ImportError>,
    /// When true, the import was requested to stop on first error.
    pub stop_on_error: bool,
    /// Set to true to request cancellation from outside.
    pub cancel_requested: bool,
    /// When the job reached a terminal state (Completed/Failed/Cancelled).
    /// Used for lazy cleanup of stale entries.
    #[serde(skip)]
    pub completed_at: Option<std::time::Instant>,
}

/// Application-wide state accessible from Tauri commands.
pub struct AppState {
    /// SQLite database connection for local persistence.
    /// Wrapped in Arc so the bridge module can clone a handle for background logging.
    pub db: Arc<Mutex<Connection>>,
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
    /// Progress tracking for SQL dump export jobs.
    pub dump_jobs: Arc<RwLock<HashMap<String, DumpJobProgress>>>,
    /// Progress tracking for SQL import jobs.
    pub import_jobs: Arc<RwLock<HashMap<String, ImportJobProgress>>>,
    /// Cancellation tokens for in-progress AI chat streams, keyed by stream_id.
    pub ai_requests: Arc<Mutex<HashMap<String, CancellationToken>>>,
}
