//! Query execution engine: runs SQL against MySQL connections,
//! stores paginated results, and enforces read-only restrictions.

use crate::commands::requests::ConnectionTabRequest;
use crate::mysql::cache_status::cache_status_json;
use crate::mysql::result_cache::{CacheKey, SlotWriteTarget};
use crate::mysql::result_view::ResultViewSpec;
#[cfg(not(coverage))]
use crate::mysql::session::TabRun;
use crate::mysql::sql_chars::{
    is_escape_before_char, is_identifier_char, is_identifier_char_at, is_identifier_or_dollar_char,
    is_quote_char, is_whitespace_at,
};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
#[cfg(not(coverage))]
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Arc;
#[cfg(coverage)]
use uuid::Uuid;

mod edit;
mod execution;
mod schema_metadata;
mod sql_text;

pub use edit::*;
pub use execution::*;
pub use schema_metadata::*;
pub use sql_text::*;
use sql_text::{find_trailing_lock_clause, has_into_outfile};

mod multi_query_types;
mod statement_rules;
mod value_ordering;
pub use multi_query_types::*;
pub use statement_rules::*;
pub use value_ordering::*;

/// One cached result row. Rows are shared by pointer between the cache, IPC
/// payloads, sort output and exports, so editing one row never copies the rest.
pub type SharedRow = Arc<[serde_json::Value]>;

/// A full cached row set (serializes identically to `Vec<Vec<Value>>`).
pub type SharedRows = Arc<Vec<SharedRow>>;

/// Column metadata returned from a query result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
}

/// Why a truncated result cannot be exported in full by re-running its SQL.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FullExportBlockedReason {
    /// A `CALL`: re-running would repeat the procedure's writes.
    Call,
    /// A locking `SELECT` (`FOR UPDATE`, `FOR SHARE`, `LOCK IN SHARE MODE`).
    Locking,
    /// The database the query ran in could not be read back after truncation.
    UnknownDatabase,
}

/// The session database a result's SQL ran in (re-run context).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum RunDatabase {
    /// Not captured: only truncated, re-runnable results read `SELECT DATABASE()`.
    #[default]
    NotCaptured,
    /// `SELECT DATABASE()` returned NULL (no default database).
    NoDatabase,
    /// The session's current database when the query ran.
    Named(String),
}

/// A stored result set in memory, keyed by (connection_id, tab_id).
///
/// `rows` are the base rows in their original order. `view` (when present) is a
/// permutation of base-row indices encoding the current sort, filter and
/// tombstone exclusion; `None` means the identity view (no sort, filter or
/// tombstones). All view fields are written only through
/// `ResultCache::modify_slot_in_place_if_current`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredResult {
    pub query_id: String,
    pub columns: Vec<ColumnMeta>,
    pub rows: SharedRows,
    /// Server-execution-only time (narrow): up to first row / header availability.
    pub execution_time_ms: u64,
    /// Combined time (execution + row transfer + serialization). Equals the
    /// single value reported before the timing split.
    pub total_time_ms: u64,
    pub affected_rows: u64,
    pub auto_limit_applied: bool,
    /// Current view over `rows` (`None` = identity).
    pub view: Option<Arc<Vec<u32>>>,
    /// Sort and filters the current view was built from.
    pub view_spec: crate::mysql::result_view::ResultViewSpec,
    /// Monotonic view version, bumped on every view or tombstone change.
    pub view_version: u64,
    /// Base indices of deleted rows (excluded from every view).
    pub tombstones: Arc<std::collections::BTreeSet<u32>>,
    /// True when at least one row beyond the ceiling was seen.
    pub truncated: bool,
    /// Row ceiling in force when this result ran.
    pub row_ceiling: usize,
    /// The LIMIT injected by auto-LIMIT (after clamping), if any.
    pub applied_row_limit: Option<usize>,
    /// Re-run context: the SQL that produced this result.
    pub source_sql: String,
    /// Re-run context: the session database when the query ran.
    pub run_database: RunDatabase,
    /// Re-run context: why a full re-run export is not allowed, if it is not.
    pub full_export_blocked_reason: Option<FullExportBlockedReason>,
}

pub struct StoredResultParts {
    pub query_id: String,
    pub columns: Vec<ColumnMeta>,
    pub rows: SharedRows,
    pub execution_time_ms: u64,
    pub total_time_ms: u64,
    pub affected_rows: u64,
    pub auto_limit_applied: bool,
}

impl StoredResultParts {
    pub fn empty(query_id: String) -> Self {
        Self {
            query_id,
            columns: vec![],
            rows: Arc::new(vec![]),
            execution_time_ms: 0,
            total_time_ms: 0,
            affected_rows: 0,
            auto_limit_applied: false,
        }
    }
}

impl StoredResult {
    pub fn new(parts: StoredResultParts) -> Self {
        Self {
            query_id: parts.query_id,
            columns: parts.columns,
            rows: parts.rows,
            execution_time_ms: parts.execution_time_ms,
            total_time_ms: parts.total_time_ms,
            affected_rows: parts.affected_rows,
            auto_limit_applied: parts.auto_limit_applied,
            view: None,
            view_spec: crate::mysql::result_view::ResultViewSpec::default(),
            view_version: crate::mysql::result_view::INITIAL_VIEW_VERSION,
            tombstones: Arc::new(std::collections::BTreeSet::new()),
            truncated: false,
            row_ceiling: crate::mysql::result_cache::DEFAULT_ROW_CEILING,
            applied_row_limit: None,
            source_sql: String::new(),
            run_database: RunDatabase::NotCaptured,
            full_export_blocked_reason: None,
        }
    }

    pub fn empty(query_id: String) -> Self {
        Self::new(StoredResultParts::empty(query_id))
    }

    /// Live base rows: all rows minus tombstones.
    pub fn live_row_count(&self) -> usize {
        self.rows.len().saturating_sub(self.tombstones.len())
    }
}

/// Response for `execute_query`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryResult {
    pub query_id: String,
    pub columns: Vec<ColumnMeta>,
    /// Live base rows (tombstones excluded).
    pub total_rows: usize,
    /// Server-execution-only time (narrow).
    pub execution_time_ms: u64,
    /// Combined time (execution + transfer + serialization).
    pub total_time_ms: u64,
    pub affected_rows: u64,
    pub auto_limit_applied: bool,
    pub view_row_count: usize,
    pub view_version: u64,
    pub truncated: bool,
    pub row_ceiling: usize,
    pub applied_row_limit: Option<usize>,
    pub full_export_blocked_reason: Option<FullExportBlockedReason>,
    pub first_window: crate::mysql::result_view::ResultWindow,
}

impl From<MultiQueryResultItem> for ExecuteQueryResult {
    fn from(item: MultiQueryResultItem) -> Self {
        Self {
            query_id: item.query_id,
            columns: item.columns,
            total_rows: item.total_rows.max(0) as usize,
            execution_time_ms: item.execution_time_ms,
            total_time_ms: item.total_time_ms,
            affected_rows: item.affected_rows,
            auto_limit_applied: item.auto_limit_applied,
            view_row_count: item.view_row_count,
            view_version: item.view_version,
            truncated: item.truncated,
            row_ceiling: item.row_ceiling,
            applied_row_limit: item.applied_row_limit,
            full_export_blocked_reason: item.full_export_blocked_reason,
            first_window: item.first_window,
        }
    }
}

/// Table metadata for the autocomplete schema cache.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub engine: String,
    pub charset: String,
    pub row_count: u64,
    pub data_size: u64,
}

/// Routine metadata for the autocomplete schema cache.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineMeta {
    pub name: String,
    pub routine_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewMeta {
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerMeta {
    pub name: String,
}

/// Full schema metadata response for autocomplete cache.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMetadata {
    pub databases: Vec<String>,
    pub tables: std::collections::HashMap<String, Vec<TableInfo>>,
    pub columns: std::collections::HashMap<String, Vec<ColumnMeta>>,
    pub routines: std::collections::HashMap<String, Vec<RoutineMeta>>,
}

/// Full schema metadata response including foreign keys and indexes (for AI assistant context).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMetadataFull {
    pub databases: Vec<String>,
    pub tables: std::collections::HashMap<String, Vec<TableInfo>>,
    pub columns: std::collections::HashMap<String, Vec<ColumnMeta>>,
    pub routines: std::collections::HashMap<String, Vec<RoutineMeta>>,
    pub views: std::collections::HashMap<String, Vec<ViewMeta>>,
    pub triggers: std::collections::HashMap<String, Vec<TriggerMeta>>,
    pub foreign_keys:
        std::collections::HashMap<String, Vec<crate::mysql::schema_queries::ForeignKeyInfo>>,
    pub indexes: std::collections::HashMap<String, Vec<crate::mysql::schema_queries::IndexInfo>>,
}

/// Metadata for a table detected in a SQL query, used for inline editing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryTableEditInfo {
    pub database: String,
    pub table: String,
    pub columns: Vec<crate::mysql::table_data::TableDataColumnMeta>,
    pub primary_key: Option<crate::mysql::table_data::PrimaryKeyInfo>,
    pub foreign_keys: Vec<crate::mysql::schema_queries::ForeignKeyInfo>,
}

pub const DEFAULT_ROW_LIMIT: usize = 1000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryRequest {
    pub connection_id: String,
    pub tab_id: String,
    pub sql: String,
    pub row_limit: Option<usize>,
    pub view_spec: Option<ResultViewSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteMultiQueryRequest {
    pub connection_id: String,
    pub tab_id: String,
    pub statements: Vec<String>,
    pub row_limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteCallQueryRequest {
    pub connection_id: String,
    pub tab_id: String,
    pub sql: String,
    pub row_limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReexecuteSingleResultRequest {
    pub connection_id: String,
    pub tab_id: String,
    pub result_index: usize,
    pub sql: String,
    pub row_limit: Option<usize>,
    pub view_spec: Option<ResultViewSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResultCellRequest {
    pub connection_id: String,
    pub tab_id: String,
    pub row_index: usize,
    pub updates: HashMap<usize, serde_json::Value>,
    pub result_index: Option<usize>,
    pub query_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeQueryForEditRequest {
    pub connection_id: String,
    pub sql: String,
}
