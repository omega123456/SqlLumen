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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DumpJobStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

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
    #[serde(skip)]
    pub completed_at: Option<std::time::SystemTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CopyJobStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyJobProgress {
    pub job_id: String,
    pub status: CopyJobStatus,
    pub objects_total: usize,
    pub objects_done: usize,
    pub current_object: Option<String>,
    pub current_object_type: Option<String>,
    pub rows_total: Option<u64>,
    pub rows_done: Option<u64>,
    pub error_message: Option<String>,
    pub cancel_requested: bool,
    #[serde(skip)]
    pub completed_at: Option<std::time::SystemTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ImportJobStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportError {
    pub statement_index: usize,
    pub sql_preview: String,
    pub error_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJobProgress {
    pub job_id: String,
    pub status: ImportJobStatus,
    pub statements_total: usize,
    pub statements_done: usize,
    pub errors: Vec<ImportError>,
    pub stop_on_error: bool,
    pub cancel_requested: bool,
    #[serde(skip)]
    pub completed_at: Option<std::time::SystemTime>,
}

impl DumpJobProgress {
    pub fn finish(&mut self, result: Result<u64, String>) {
        self.current_table = None;
        self.completed_at = Some(std::time::SystemTime::now());
        if let Ok(bytes) = result {
            self.bytes_written = bytes;
        }
        if self.cancel_requested {
            self.status = DumpJobStatus::Cancelled;
            return;
        }
        let Err(error) = result else {
            self.status = DumpJobStatus::Completed;
            return;
        };
        self.status = DumpJobStatus::Failed;
        self.error_message = Some(error);
    }
}

impl CopyJobProgress {
    pub fn mark_completed(&mut self) {
        self.status = CopyJobStatus::Completed;
        self.current_object = None;
        self.current_object_type = None;
        self.rows_total = None;
        self.rows_done = None;
        self.completed_at = Some(std::time::SystemTime::now());
    }

    pub fn mark_failed(&mut self, message: impl Into<String>) {
        self.status = CopyJobStatus::Failed;
        self.error_message = Some(message.into());
        self.completed_at = Some(std::time::SystemTime::now());
    }

    pub fn mark_cancelled(&mut self) {
        self.status = CopyJobStatus::Cancelled;
        self.completed_at = Some(std::time::SystemTime::now());
    }
}

impl ImportJobProgress {
    fn finish_as(&mut self, status: ImportJobStatus) {
        self.status = status;
        self.completed_at = Some(std::time::SystemTime::now());
    }

    pub fn mark_cancelled(&mut self) {
        self.finish_as(ImportJobStatus::Cancelled);
    }

    pub fn mark_failed(&mut self) {
        self.finish_as(ImportJobStatus::Failed);
    }

    pub fn complete_if_running(&mut self) {
        if self.status != ImportJobStatus::Running {
            return;
        }
        self.finish_as(ImportJobStatus::Completed);
    }

    pub fn fail_if_running(&mut self, error_message: String) {
        if self.status != ImportJobStatus::Running {
            return;
        }
        self.errors.push(ImportError {
            statement_index: 0,
            sql_preview: String::new(),
            error_message,
        });
        self.mark_failed();
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResultExportStatus {
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultExportJobProgress {
    pub status: ResultExportStatus,
    pub rows_written: u64,
    pub bytes_written: u64,
    pub elapsed_ms: u64,
    pub stopped_at_sheet_limit: bool,
    pub error: Option<String>,
    #[serde(skip)]
    pub job_id: String,
    #[serde(skip)]
    pub cancel_requested: bool,
    #[serde(skip)]
    pub mysql_thread_id: Option<u64>,
    #[serde(skip)]
    pub connection_id: String,
    #[serde(skip)]
    pub started_at: std::time::Instant,
    #[serde(skip)]
    pub completed_at: Option<std::time::SystemTime>,
    #[serde(skip)]
    pub cancel: Arc<ResultExportCancel>,
}

#[derive(Debug, Default)]
pub struct ResultExportCancel {
    pub requested: std::sync::atomic::AtomicBool,
    pub kills_in_flight: std::sync::atomic::AtomicUsize,
    pub kill_sent: std::sync::atomic::AtomicBool,
    pub kill_done: tokio::sync::Notify,
}

pub type ResultExportJobs = Arc<RwLock<HashMap<String, ResultExportJobProgress>>>;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub logs_db: Arc<Mutex<Connection>>,
    pub registry: ConnectionRegistry,
    pub app_handle: Option<AppHandle>,
    pub result_cache: Arc<ResultCache>,
    pub table_data_cache: Arc<TableDataCache>,
    pub metadata_cache: MetadataCache,
    pub log_filter_reload: Mutex<Option<LogFilterReloadHandle>>,
    pub running_queries: TokioRwLock<HashMap<(String, String), u64>>,
    pub editor_sessions: crate::mysql::session::EditorSessions,
    pub dump_jobs: Arc<RwLock<HashMap<String, DumpJobProgress>>>,
    pub import_jobs: Arc<RwLock<HashMap<String, ImportJobProgress>>>,
    pub result_export_jobs: ResultExportJobs,
    pub copy_jobs: Arc<RwLock<HashMap<String, CopyJobProgress>>>,
    pub ai_requests: Arc<Mutex<HashMap<String, CancellationToken>>>,
    pub index_build_tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
    pub session_profile_map: Arc<Mutex<HashMap<String, String>>>,
    pub session_ref_counts: Arc<Mutex<HashMap<String, usize>>>,
    pub http_client: reqwest::Client,
    pub embedding_cache: crate::schema_index::embeddings_cache::EmbeddingCache,
}

impl AppState {
    pub fn has_open_connection(&self, connection_id: &str) -> bool {
        self.registry.contains(connection_id)
    }
}
