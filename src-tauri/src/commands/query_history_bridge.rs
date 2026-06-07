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
    evict_metadata_cache_for_connection, evict_metadata_cache_for_tables,
};
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

/// Fire-and-forget: log a single history entry only when a saved connection id
/// was resolved. When `conn_id` is `None`, the session has no saved profile, so
/// we skip logging (writing the ephemeral session id would violate the
/// `connections` foreign key on `query_history`) and emit a warn instead.
///
/// `build_entry` receives the resolved saved-connection id and the optional
/// database name and returns the entry to insert. `session_id` is used only for
/// the skip warning context.
pub(crate) fn log_single_entry_if_resolved(
    db: &Arc<Mutex<Connection>>,
    conn_id: Option<String>,
    database_name: Option<String>,
    session_id: &str,
    build_entry: impl FnOnce(String, Option<String>) -> NewHistoryEntry,
) {
    match conn_id {
        Some(conn_id) => log_single_entry(db, build_entry(conn_id, database_name)),
        None => tracing::warn!(
            session_id = %session_id,
            "skipping query history logging: no saved connection id resolved for session"
        ),
    }
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

/// Resolve the saved-connection id (profile_id) and active database name from the registry.
///
/// Returns `None` for the connection id when the registry does not resolve a saved
/// profile for the session. Callers must skip history logging in that case rather than
/// fall back to the (ephemeral) session id — writing a non-existent id would violate the
/// `connections` foreign key on `query_history`.
pub(crate) fn resolve_connection_context(
    state: &AppState,
    session_id: &str,
) -> (Option<String>, Option<String>) {
    let connection_id = state.registry.get_profile_id(session_id);
    let database_name = state
        .registry
        .get_connection_params(session_id)
        .and_then(|p| p.default_database);
    (connection_id, database_name)
}

fn handle_metadata_cache_invalidation(
    state: &AppState,
    session_id: &str,
    sql: &str,
    default_database: Option<&str>,
) {
    match detect_ddl_tables(sql) {
        DdlDetectionResult::NoDdl => {}
        DdlDetectionResult::DdlDetected(affected_tables) => {
            evict_metadata_cache_for_tables(state, session_id, &affected_tables, default_database);
        }
        DdlDetectionResult::ParseFailed => {
            evict_metadata_cache_for_connection(state, session_id);
        }
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
    handle_metadata_cache_invalidation(state, session_id, sql, default_database.as_deref());
}

// ── execute_query bridge ──────────────────────────────────────────────────────

/// Execute a single query and log history.
pub async fn execute_query_bridge(
    state: &AppState,
    session_id: &str,
    tab_id: &str,
    sql: &str,
    row_limit: usize,
) -> Result<ExecuteQueryResult, String> {
    let result = execute_query_impl(state, session_id, tab_id, sql, row_limit).await;

    let (connection_id, database_name) = resolve_connection_context(state, session_id);

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
        Ok(r) => {
            log_single_entry(
                &state.db,
                NewHistoryEntry {
                    connection_id,
                    database_name,
                    sql_text: sql.to_string(),
                    duration_ms: Some(r.total_time_ms as i64),
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
    row_limit: usize,
) -> Result<MultiQueryResult, String> {
    let result = execute_multi_query_impl(state, session_id, tab_id, statements, row_limit).await;

    let (connection_id, database_name) = resolve_connection_context(state, session_id);

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
    row_limit: usize,
) -> Result<MultiQueryResult, String> {
    let result = execute_call_query_impl(state, session_id, tab_id, sql, row_limit).await;

    let (connection_id, database_name) = resolve_connection_context(state, session_id);

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
            let total_time: i64 = multi.results.iter().map(|r| r.total_time_ms as i64).sum();
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
