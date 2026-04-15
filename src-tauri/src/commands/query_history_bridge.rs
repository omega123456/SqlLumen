//! Bridge module for logging executed queries to the history table.
//!
//! History logging is now entirely backend-driven. The query command wrappers
//! in `query.rs` call bridge functions here which:
//! 1. Delegate to `execute_*_impl` for the actual MySQL query execution.
//! 2. Fire-and-forget log history entries via `tauri::async_runtime::spawn`.
//!
//! The frontend never writes history; it only reads via `list_history` etc.

use crate::db::history::{self, NewHistoryEntry};
use crate::mysql::query_executor::{
    execute_call_query_impl, execute_multi_query_impl, execute_query_impl, ExecuteQueryResult,
    MultiQueryResult,
};
use crate::state::AppState;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

/// Fire-and-forget: insert a single history entry.
pub(crate) fn log_single_entry(db: &Arc<Mutex<Connection>>, entry: NewHistoryEntry) {
    let db = Arc::clone(db);
    tauri::async_runtime::spawn(async move {
        match db.lock() {
            Ok(conn) => {
                if let Err(e) = history::insert_history(&conn, &entry) {
                    tracing::warn!(
                        error = %e,
                        connection_id = %entry.connection_id,
                        "failed to insert query history entry"
                    );
                }
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "failed to acquire db lock for query history logging"
                );
            }
        }
    });
}

/// Fire-and-forget: insert a batch of history entries.
pub(crate) fn log_batch_entries(db: &Arc<Mutex<Connection>>, entries: Vec<NewHistoryEntry>) {
    if entries.is_empty() {
        return;
    }
    let db = Arc::clone(db);
    tauri::async_runtime::spawn(async move {
        match db.lock() {
            Ok(conn) => {
                if let Err(e) = history::insert_history_batch(&conn, &entries) {
                    tracing::warn!(
                        error = %e,
                        count = entries.len(),
                        "failed to batch-insert query history entries"
                    );
                }
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "failed to acquire db lock for batch query history logging"
                );
            }
        }
    });
}

/// Resolve the connection_id (profile_id) and active database name from the registry.
pub(crate) fn resolve_connection_context(
    state: &AppState,
    session_id: &str,
) -> (String, Option<String>) {
    let connection_id = state
        .registry
        .get_profile_id(session_id)
        .unwrap_or_else(|| session_id.to_string());
    let database_name = state
        .registry
        .get_connection_params(session_id)
        .and_then(|p| p.default_database);
    (connection_id, database_name)
}

// ── execute_query bridge ──────────────────────────────────────────────────────

/// Execute a single query and log history.
pub async fn execute_query_bridge(
    state: &AppState,
    session_id: &str,
    tab_id: &str,
    sql: &str,
    page_size: usize,
) -> Result<ExecuteQueryResult, String> {
    let result = execute_query_impl(state, session_id, tab_id, sql, page_size).await;

    let (connection_id, database_name) = resolve_connection_context(state, session_id);

    match &result {
        Ok(r) => {
            log_single_entry(
                &state.db,
                NewHistoryEntry {
                    connection_id,
                    database_name,
                    sql_text: sql.to_string(),
                    duration_ms: Some(r.execution_time_ms as i64),
                    row_count: Some(r.total_rows as i64),
                    affected_rows: Some(r.affected_rows as i64),
                    success: true,
                    error_message: None,
                },
            );
        }
        Err(e) => {
            log_single_entry(
                &state.db,
                NewHistoryEntry {
                    connection_id,
                    database_name,
                    sql_text: sql.to_string(),
                    duration_ms: Some(0),
                    row_count: Some(0),
                    affected_rows: Some(0),
                    success: false,
                    error_message: Some(e.clone()),
                },
            );
        }
    }

    result
}

// ── execute_multi_query bridge ────────────────────────────────────────────────

/// Execute multiple statements and log history (one entry per statement).
pub async fn execute_multi_query_bridge(
    state: &AppState,
    session_id: &str,
    tab_id: &str,
    statements: Vec<String>,
    page_size: usize,
) -> Result<MultiQueryResult, String> {
    let result = execute_multi_query_impl(state, session_id, tab_id, statements, page_size).await;

    let (connection_id, database_name) = resolve_connection_context(state, session_id);

    match &result {
        Ok(multi) => {
            let entries: Vec<NewHistoryEntry> = multi
                .results
                .iter()
                .map(|item| NewHistoryEntry {
                    connection_id: connection_id.clone(),
                    database_name: database_name.clone(),
                    sql_text: item.source_sql.clone(),
                    duration_ms: Some(item.execution_time_ms),
                    row_count: Some(item.total_rows),
                    affected_rows: Some(item.affected_rows as i64),
                    success: item.error.is_none(),
                    error_message: item.error.clone(),
                })
                .collect();
            log_batch_entries(&state.db, entries);
        }
        Err(e) => {
            // Top-level error — we don't have per-statement results.
            // Log a single error entry with no SQL (we don't know which statement failed).
            log_single_entry(
                &state.db,
                NewHistoryEntry {
                    connection_id,
                    database_name,
                    sql_text: "(multi-query batch)".to_string(),
                    duration_ms: Some(0),
                    row_count: Some(0),
                    affected_rows: Some(0),
                    success: false,
                    error_message: Some(e.clone()),
                },
            );
        }
    }

    result
}

// ── execute_call_query bridge ─────────────────────────────────────────────────

/// Execute a CALL statement and log a single history entry.
pub async fn execute_call_query_bridge(
    state: &AppState,
    session_id: &str,
    tab_id: &str,
    sql: &str,
    page_size: usize,
) -> Result<MultiQueryResult, String> {
    let result = execute_call_query_impl(state, session_id, tab_id, sql, page_size).await;

    let (connection_id, database_name) = resolve_connection_context(state, session_id);

    match &result {
        Ok(multi) => {
            // Aggregate: sum execution time, total rows from all result sets.
            let total_time: i64 = multi.results.iter().map(|r| r.execution_time_ms).sum();
            let total_rows: i64 = multi.results.iter().map(|r| r.total_rows).sum();
            let total_affected: i64 = multi.results.iter().map(|r| r.affected_rows as i64).sum();
            let has_error = multi.results.iter().any(|r| r.error.is_some());
            let error_msg = multi
                .results
                .iter()
                .filter_map(|r| r.error.as_ref())
                .next()
                .cloned();

            log_single_entry(
                &state.db,
                NewHistoryEntry {
                    connection_id,
                    database_name,
                    sql_text: sql.to_string(),
                    duration_ms: Some(total_time),
                    row_count: Some(total_rows),
                    affected_rows: Some(total_affected),
                    success: !has_error,
                    error_message: error_msg,
                },
            );
        }
        Err(e) => {
            log_single_entry(
                &state.db,
                NewHistoryEntry {
                    connection_id,
                    database_name,
                    sql_text: sql.to_string(),
                    duration_ms: Some(0),
                    row_count: Some(0),
                    affected_rows: Some(0),
                    success: false,
                    error_message: Some(e.clone()),
                },
            );
        }
    }

    result
}
