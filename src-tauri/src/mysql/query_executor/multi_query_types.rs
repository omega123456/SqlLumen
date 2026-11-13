use super::*;

/// A single result item from a multi-query or CALL execution.
///
/// Carries metadata plus the **first window** of the result's view; the full
/// result stays in the Rust cache and is read with `fetch_result_window`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiQueryResultItem {
    pub query_id: String,
    pub source_sql: String,
    pub columns: Vec<ColumnMeta>,
    /// Live base rows (tombstones excluded).
    pub total_rows: i64,
    /// Server-execution-only time (narrow).
    pub execution_time_ms: u64,
    /// Combined time (execution + transfer + serialization).
    pub total_time_ms: u64,
    pub affected_rows: u64,
    pub auto_limit_applied: bool,
    pub error: Option<String>,
    pub re_executable: bool,
    pub view_row_count: usize,
    pub view_version: u64,
    pub truncated: bool,
    pub row_ceiling: usize,
    pub applied_row_limit: Option<usize>,
    pub full_export_blocked_reason: Option<FullExportBlockedReason>,
    pub first_window: crate::mysql::result_view::ResultWindow,
}

impl MultiQueryResultItem {
    /// Build the IPC item for a stored result: metadata plus its first window.
    pub fn from_stored(stored: &StoredResult, error: Option<String>, re_executable: bool) -> Self {
        Self {
            query_id: stored.query_id.clone(),
            source_sql: stored.source_sql.clone(),
            columns: stored.columns.clone(),
            total_rows: stored.live_row_count() as i64,
            execution_time_ms: stored.execution_time_ms,
            total_time_ms: stored.total_time_ms,
            affected_rows: stored.affected_rows,
            auto_limit_applied: stored.auto_limit_applied,
            error,
            re_executable,
            view_row_count: crate::mysql::result_view::view_len(stored),
            view_version: stored.view_version,
            truncated: stored.truncated,
            row_ceiling: stored.row_ceiling,
            applied_row_limit: stored.applied_row_limit,
            full_export_blocked_reason: stored.full_export_blocked_reason,
            first_window: crate::mysql::result_view::first_window(stored),
        }
    }
}

/// Wrapper for multiple result items returned from batch execution.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiQueryResult {
    pub results: Vec<MultiQueryResultItem>,
}
