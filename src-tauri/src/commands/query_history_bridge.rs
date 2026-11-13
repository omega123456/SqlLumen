//! Bridge module for logging executed queries to the history table.
//!
//! History logging is now entirely backend-driven. The query command wrappers
//! in `query.rs` call bridge functions here which:
//! 1. Delegate to `execute_*_impl` for the actual MySQL query execution.
//! 2. Fire-and-forget log history entries via `tauri::async_runtime::spawn`.
//!
//! The frontend never writes history; it only reads via `list_history` etc.

use crate::db::history::{self, NewHistoryEntry};
use crate::mysql::ddl_detector::{detect_ddl_tables, DdlDetectionResult};
use crate::mysql::metadata_cache::{
    evict_metadata_cache_for_connection, evict_metadata_cache_for_tables, TableEviction,
};
use crate::mysql::query_executor::{
    execute_call_query_impl, execute_multi_query_impl, execute_query_impl, ExecuteCallQueryRequest,
    ExecuteMultiQueryRequest, ExecuteQueryRequest, ExecuteQueryResult, MultiQueryResult,
};
use crate::state::AppState;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

/// Fire-and-forget: insert a single history entry.
pub(crate) fn single_row_count(succeeded: bool) -> i64 {
    if succeeded {
        return 1;
    }
    0
}

pub(crate) fn log_single_entry(db: &Arc<Mutex<Connection>>, entry: NewHistoryEntry) {
    let db = Arc::clone(db);
    tauri::async_runtime::spawn(async move {
        match db.lock() {
            Ok(conn) => {
                if let Err(error) = history::insert_history(&conn, &entry) {
                    tracing::warn!(
                        error = %error,
                        connection_id = %entry.connection_id,
                        "failed to insert query history entry"
                    );
                }
            }
            Err(error) => {
                tracing::warn!(
                    error = %error,
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
                if let Err(error) = history::insert_history_batch(&conn, &entries) {
                    tracing::warn!(
                        error = %error,
                        count = entries.len(),
                        "failed to batch-insert query history entries"
                    );
                }
            }
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    "failed to acquire db lock for batch query history logging"
                );
            }
        }
    });
}

#[derive(Clone)]
pub(crate) struct ConnectionHistoryContext {
    pub(crate) session_id: String,
    pub(crate) connection_id: Option<String>,
    pub(crate) database_name: Option<String>,
}

impl ConnectionHistoryContext {
    pub(crate) fn log_single_entry_if_resolved(
        self,
        db: &Arc<Mutex<Connection>>,
        build_entry: impl FnOnce(String, Option<String>) -> NewHistoryEntry,
    ) {
        let Some(connection_id) = self.connection_id else {
            tracing::warn!(
                session_id = %self.session_id,
                "skipping query history logging: no saved connection id resolved for session"
            );
            return;
        };
        log_single_entry(db, build_entry(connection_id, self.database_name));
    }
}

pub(crate) fn resolve_connection_context(
    state: &AppState,
    session_id: &str,
) -> ConnectionHistoryContext {
    ConnectionHistoryContext {
        session_id: session_id.to_string(),
        connection_id: state.registry.get_profile_id(session_id),
        database_name: default_database_for_session(state, session_id),
    }
}

fn default_database_for_session(state: &AppState, session_id: &str) -> Option<String> {
    state
        .registry
        .get_connection_params(session_id)
        .and_then(|params| params.default_database)
}

pub fn invalidate_metadata_cache_for_executed_sql(state: &AppState, session_id: &str, sql: &str) {
    let default_database = default_database_for_session(state, session_id);
    match detect_ddl_tables(sql) {
        DdlDetectionResult::NoDdl => {}
        DdlDetectionResult::DdlDetected(affected_tables) => {
            let eviction = TableEviction {
                connection_id: session_id,
                affected_tables: &affected_tables,
                default_database: default_database.as_deref(),
            };
            evict_metadata_cache_for_tables(state, &eviction);
        }
        DdlDetectionResult::ParseFailed => {
            evict_metadata_cache_for_connection(state, session_id);
        }
    }
}

// ── execute_query bridge ──────────────────────────────────────────────────────

pub async fn execute_query_bridge(
    state: &AppState,
    request: &ExecuteQueryRequest,
) -> Result<ExecuteQueryResult, String> {
    let session_id = request.connection_id.as_str();
    let sql = request.sql.as_str();
    let result = execute_query_impl(state, request).await;

    let ConnectionHistoryContext {
        connection_id,
        database_name,
        ..
    } = resolve_connection_context(state, session_id);

    // Still invalidate the metadata cache on success regardless of history logging.
    if result.is_ok() {
        invalidate_metadata_cache_for_executed_sql(state, session_id, sql);
    }

    let Some(connection_id) = connection_id else {
        tracing::warn!(
            session_id,
            "skipping query history logging: no saved connection id resolved for session"
        );
        return result;
    };

    match &result {
        Ok(result) => {
            log_single_entry(
                &state.db,
                NewHistoryEntry {
                    connection_id,
                    database_name,
                    sql_text: sql.to_string(),
                    duration_ms: Some(result.total_time_ms as i64),
                    row_count: Some(result.total_rows as i64),
                    affected_rows: Some(result.affected_rows as i64),
                    success: true,
                    error_message: None,
                },
            );
        }
        Err(error) => {
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
                    error_message: Some(error.clone()),
                },
            );
        }
    }

    result
}

// ── execute_multi_query bridge ────────────────────────────────────────────────

pub async fn execute_multi_query_bridge(
    state: &AppState,
    request: &ExecuteMultiQueryRequest,
) -> Result<MultiQueryResult, String> {
    let session_id = request.connection_id.as_str();
    let result = execute_multi_query_impl(state, request).await;

    let ConnectionHistoryContext {
        connection_id,
        database_name,
        ..
    } = resolve_connection_context(state, session_id);

    // Still invalidate the metadata cache for successful statements regardless of history logging.
    if let Ok(multi) = &result {
        for item in &multi.results {
            if item.error.is_none() {
                invalidate_metadata_cache_for_executed_sql(state, session_id, &item.source_sql);
            }
        }
    }

    let Some(connection_id) = connection_id else {
        tracing::warn!(
            session_id,
            "skipping query history logging: no saved connection id resolved for session"
        );
        return result;
    };

    match &result {
        Ok(multi) => {
            let entries: Vec<NewHistoryEntry> = multi
                .results
                .iter()
                .map(|item| NewHistoryEntry {
                    connection_id: connection_id.clone(),
                    database_name: database_name.clone(),
                    sql_text: item.source_sql.clone(),
                    duration_ms: Some(item.total_time_ms as i64),
                    row_count: Some(item.total_rows),
                    affected_rows: Some(item.affected_rows as i64),
                    success: item.error.is_none(),
                    error_message: item.error.clone(),
                })
                .collect();
            log_batch_entries(&state.db, entries);
        }
        Err(error) => {
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
                    error_message: Some(error.clone()),
                },
            );
        }
    }

    result
}

// ── execute_call_query bridge ─────────────────────────────────────────────────

pub async fn execute_call_query_bridge(
    state: &AppState,
    request: &ExecuteCallQueryRequest,
) -> Result<MultiQueryResult, String> {
    let session_id = request.connection_id.as_str();
    let sql = request.sql.as_str();
    let result = execute_call_query_impl(state, request).await;

    let ConnectionHistoryContext {
        connection_id,
        database_name,
        ..
    } = resolve_connection_context(state, session_id);

    let Some(connection_id) = connection_id else {
        tracing::warn!(
            session_id,
            "skipping query history logging: no saved connection id resolved for session"
        );
        return result;
    };

    match &result {
        Ok(multi) => {
            // Aggregate: sum total time, total rows from all result sets.
            let total_time: i64 = multi
                .results
                .iter()
                .map(|result| result.total_time_ms as i64)
                .sum();
            let total_rows: i64 = multi.results.iter().map(|result| result.total_rows).sum();
            let total_affected: i64 = multi
                .results
                .iter()
                .map(|result| result.affected_rows as i64)
                .sum();
            let has_error = multi.results.iter().any(|result| result.error.is_some());
            let error_msg = multi
                .results
                .iter()
                .filter_map(|result| result.error.as_ref())
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
        Err(error) => {
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
                    error_message: Some(error.clone()),
                },
            );
        }
    }

    result
}
