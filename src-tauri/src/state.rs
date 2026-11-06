use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use tauri::AppHandle;
use tokio::sync::RwLock as TokioRwLock;

use crate::logging::LogFilterReloadHandle;
use crate::mysql::metadata_cache::MetadataCache;
use crate::mysql::registry::ConnectionRegistry;
use crate::mysql::result_cache::ResultCache;
use crate::mysql::table_data_cache::TableDataCache;
use tokio_util::sync::CancellationToken;

/// Status of a SQL dump export job.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DumpJobStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
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
    pub rows_exported: u64,
    pub error_message: Option<String>,
    pub cancel_requested: bool,
    #[serde(skip)]
    pub mysql_thread_id: Option<u64>,
    /// When the job reached a terminal state (Completed/Failed/Cancelled).
    /// Used for lazy cleanup of stale entries.
    #[serde(skip)]
    pub completed_at: Option<std::time::SystemTime>,
}

/// Status of a copy-to-host job.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CopyJobStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// Progress info for an active or completed copy-to-host job.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyJobProgress {
    pub job_id: String,
    pub status: CopyJobStatus,
    pub objects_total: usize,
    pub objects_done: usize,
    /// Name of the object currently being copied (None before/after work).
    pub current_object: Option<String>,
    /// Type of the object currently being copied (e.g. "table", "procedure").
    pub current_object_type: Option<String>,
    /// Total rows for the current table (None for non-table objects).
    pub rows_total: Option<u64>,
    /// Rows copied so far for the current table (None for non-table objects).
    pub rows_done: Option<u64>,
    pub error_message: Option<String>,
    pub cancel_requested: bool,
    /// When the job reached a terminal state (Completed/Failed/Cancelled).
    /// Used for lazy cleanup of stale entries.
    #[serde(skip)]
    pub completed_at: Option<std::time::SystemTime>,
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
    pub completed_at: Option<std::time::SystemTime>,
}

/// Status of a streaming full export of a truncated query result.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResultExportStatus {
    Running,
    Completed,
    Cancelled,
    Failed,
}

/// Progress of a streaming full export (`start_result_export`). Serialized
/// fields are the `get_result_export_progress` IPC contract; the rest is
/// bookkeeping for cancel, connection-scoped cancel and lazy cleanup.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultExportJobProgress {
    pub status: ResultExportStatus,
    pub rows_written: u64,
    pub bytes_written: u64,
    /// Milliseconds since the job started (frozen once it ends).
    pub elapsed_ms: u64,
    /// True when an XLSX export stopped at Excel's sheet row limit.
    pub stopped_at_sheet_limit: bool,
    pub error: Option<String>,
    #[serde(skip)]
    pub job_id: String,
    #[serde(skip)]
    pub cancel_requested: bool,
    /// Editor-session thread running the re-run (the `KILL QUERY` target),
    /// set only while the re-run streams.
    #[serde(skip)]
    pub mysql_thread_id: Option<u64>,
    /// Registry connection the job runs on (`close_connection` cancels it).
    #[serde(skip)]
    pub connection_id: String,
    #[serde(skip)]
    pub started_at: std::time::Instant,
    /// When the job reached a terminal state. Used for lazy cleanup.
    #[serde(skip)]
    pub completed_at: Option<std::time::SystemTime>,
    /// Cancel state shared with the running job without the map lock.
    #[serde(skip)]
    pub cancel: Arc<ResultExportCancel>,
}

/// Cancel state of one export job, shared by the job and `cancel_result_export`.
///
/// The job reads `requested` on every streamed row without taking the job-map
/// lock. A cancel `KILL QUERY` is counted in `kills_in_flight` from the moment
/// it is registered (under the job-map write lock, while the job still has a
/// thread id) until it was sent or given up, so the job can wait for it before
/// releasing the shared editor session: a late KILL must never reach the next
/// query that runs on that session.
#[derive(Debug, Default)]
pub struct ResultExportCancel {
    pub requested: std::sync::atomic::AtomicBool,
    pub kills_in_flight: std::sync::atomic::AtomicUsize,
    /// True once a cancel `KILL QUERY` reached the server.
    pub kill_sent: std::sync::atomic::AtomicBool,
    /// Notified whenever an in-flight cancel KILL finishes.
    pub kill_done: tokio::sync::Notify,
}

/// Shared map of streaming full-export jobs, keyed by job id.
pub type ResultExportJobs = Arc<RwLock<HashMap<String, ResultExportJobProgress>>>;

/// Application-wide state accessible from Tauri commands.
pub struct AppState {
    /// SQLite database connection for local persistence.
    /// Wrapped in Arc so the bridge module can clone a handle for background logging.
    pub db: Arc<Mutex<Connection>>,
    /// Dedicated SQLite reader connection for structured application logs.
    pub logs_db: Arc<Mutex<Connection>>,
    /// Registry of active MySQL connection pools.
    pub registry: ConnectionRegistry,
    /// Tauri app handle (None only in unit tests where AppHandle is unavailable).
    pub app_handle: Option<AppHandle>,
    /// In-memory query results with time-to-idle eviction, backed by moka.
    pub result_cache: Arc<ResultCache>,
    /// In-memory table-data responses with the same eviction/spill behavior as result cache.
    pub table_data_cache: Arc<TableDataCache>,
    /// In-memory cache for table primary-key and column metadata.
    pub metadata_cache: MetadataCache,
    /// Reload handle for `EnvFilter` when `log.level` changes (None in tests).
    pub log_filter_reload: Mutex<Option<LogFilterReloadHandle>>,
    /// MySQL thread IDs for currently running queries, keyed by (connection_id, tab_id).
    /// Used to issue `KILL QUERY` for cancellation.
    pub running_queries: TokioRwLock<HashMap<(String, String), u64>>,
    /// Shared query-editor MySQL session per connection_id (see `mysql::session`).
    pub editor_sessions: Mutex<HashMap<String, crate::mysql::session::SessionSlot>>,
    /// Progress tracking for SQL dump export jobs.
    pub dump_jobs: Arc<RwLock<HashMap<String, DumpJobProgress>>>,
    /// Progress tracking for SQL import jobs.
    pub import_jobs: Arc<RwLock<HashMap<String, ImportJobProgress>>>,
    /// Progress tracking for streaming full exports of truncated query results.
    pub result_export_jobs: ResultExportJobs,
    /// Progress tracking for copy-to-host jobs.
    pub copy_jobs: Arc<RwLock<HashMap<String, CopyJobProgress>>>,
    /// Cancellation tokens for in-progress AI chat streams, keyed by stream_id.
    pub ai_requests: Arc<Mutex<HashMap<String, CancellationToken>>>,
    /// Cancellation tokens for in-progress schema index builds, keyed by profile_id.
    pub index_build_tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
    /// Maps session_id → profile_id for schema index tracking.
    pub session_profile_map: Arc<Mutex<HashMap<String, String>>>,
    /// Reference count of active sessions per profile_id.
    pub session_ref_counts: Arc<Mutex<HashMap<String, usize>>>,
    /// Shared HTTP client for embedding API calls.
    pub http_client: reqwest::Client,
    /// Cache for query embedding vectors (avoids re-embedding identical queries).
    pub embedding_cache: crate::schema_index::embeddings_cache::EmbeddingCache,
}
