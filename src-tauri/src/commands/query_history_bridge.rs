use crate::db::history::{self, NewHistoryEntry};
use crate::mysql::ddl_detector::{detect_ddl_tables, DdlDetectionResult};
use crate::mysql::metadata_cache::{
    evict_metadata_cache_for_connection, evict_metadata_cache_for_tables, TableEviction,
};
use crate::mysql::query_executor::{
    execute_call_query_impl, execute_multi_query_impl, execute_query_impl, ExecuteCallQueryRequest,
    ExecuteMultiQueryRequest, ExecuteQueryRequest, ExecuteQueryResult, MultiQueryResult,
    MultiQueryResultItem,
};
use crate::state::AppState;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use std::time::Instant;

const MULTI_QUERY_BATCH_LABEL: &str = "(multi-query batch)";

pub(crate) fn single_row_count(succeeded: bool) -> i64 {
    if succeeded {
        return 1;
    }
    0
}

fn insert_history_entry_now(db: &Mutex<Connection>, entry: &NewHistoryEntry) {
    let conn = match db.lock() {
        Ok(conn) => conn,
        Err(error) => {
            tracing::warn!(error = %error, "failed to acquire db lock for query history logging");
            return;
        }
    };
    if let Err(error) = history::insert_history(&conn, entry) {
        tracing::warn!(
            error = %error,
            connection_id = %entry.connection_id,
            "failed to insert query history entry"
        );
    }
}

fn insert_history_batch_now(db: &Mutex<Connection>, entries: &[NewHistoryEntry]) {
    let conn = match db.lock() {
        Ok(conn) => conn,
        Err(error) => {
            tracing::warn!(
                error = %error,
                "failed to acquire db lock for batch query history logging"
            );
            return;
        }
    };
    if let Err(error) = history::insert_history_batch(&conn, entries) {
        tracing::warn!(
            error = %error,
            count = entries.len(),
            "failed to batch-insert query history entries"
        );
    }
}

pub(crate) fn log_single_entry(db: &Arc<Mutex<Connection>>, entry: NewHistoryEntry) {
    let db = Arc::clone(db);
    tauri::async_runtime::spawn(async move {
        insert_history_entry_now(&db, &entry);
    });
}

pub(crate) fn log_batch_entries(db: &Arc<Mutex<Connection>>, entries: Vec<NewHistoryEntry>) {
    if entries.is_empty() {
        return;
    }
    let db = Arc::clone(db);
    tauri::async_runtime::spawn(async move {
        insert_history_batch_now(&db, &entries);
    });
}

#[derive(Clone)]
pub(crate) struct ConnectionHistoryContext {
    pub(crate) session_id: String,
    pub(crate) connection_id: Option<String>,
    pub(crate) database_name: Option<String>,
}

impl ConnectionHistoryContext {
    fn resolved_connection_id(&self) -> Option<String> {
        if self.connection_id.is_none() {
            tracing::warn!(
                session_id = %self.session_id,
                "skipping query history logging: no saved connection id resolved for session"
            );
        }
        self.connection_id.clone()
    }

    pub(crate) fn log_single_entry_if_resolved(
        self,
        db: &Arc<Mutex<Connection>>,
        build_entry: impl FnOnce(String, Option<String>) -> NewHistoryEntry,
    ) {
        let Some(connection_id) = self.resolved_connection_id() else {
            return;
        };
        log_single_entry(db, build_entry(connection_id, self.database_name));
    }

    fn log_batch_if_resolved(self, db: &Arc<Mutex<Connection>>, records: Vec<HistoryRecord>) {
        let Some(connection_id) = self.resolved_connection_id() else {
            return;
        };
        let entries = records
            .into_iter()
            .map(|record| record.into_entry(connection_id.clone(), self.database_name.clone()))
            .collect();
        log_batch_entries(db, entries);
    }
}

#[derive(Clone)]
pub(crate) struct HistoryRecord {
    sql_text: String,
    duration_ms: i64,
    row_count: i64,
    affected_rows: i64,
    error_message: Option<String>,
}

impl HistoryRecord {
    pub(crate) fn for_outcome<T>(
        sql_text: String,
        started_at: Instant,
        result: &Result<T, String>,
    ) -> Self {
        Self {
            sql_text,
            duration_ms: started_at.elapsed().as_millis() as i64,
            row_count: 0,
            affected_rows: 0,
            error_message: result.as_ref().err().cloned(),
        }
    }

    fn failed(sql_text: String, error: &str) -> Self {
        Self {
            sql_text,
            duration_ms: 0,
            row_count: 0,
            affected_rows: 0,
            error_message: Some(error.to_string()),
        }
    }

    fn for_query_result(sql_text: String, result: &ExecuteQueryResult) -> Self {
        Self {
            sql_text,
            duration_ms: result.total_time_ms as i64,
            row_count: result.total_rows as i64,
            affected_rows: result.affected_rows as i64,
            error_message: None,
        }
    }

    fn for_multi_query_item(item: &MultiQueryResultItem) -> Self {
        Self {
            sql_text: item.source_sql.clone(),
            duration_ms: item.total_time_ms as i64,
            row_count: history_row_count(item),
            affected_rows: item.affected_rows as i64,
            error_message: item.error.clone(),
        }
    }

    fn for_call_query(sql_text: String, multi: &MultiQueryResult) -> Self {
        let results = &multi.results;
        Self {
            sql_text,
            duration_ms: results.iter().map(|item| item.total_time_ms as i64).sum(),
            row_count: results.iter().map(|item| item.total_rows).sum(),
            affected_rows: results.iter().map(|item| item.affected_rows as i64).sum(),
            error_message: results.iter().find_map(|item| item.error.clone()),
        }
    }

    pub(crate) fn with_row_count(self, row_count: i64) -> Self {
        Self { row_count, ..self }
    }

    pub(crate) fn with_affected_rows(self, affected_rows: i64) -> Self {
        Self {
            affected_rows,
            ..self
        }
    }

    pub(crate) fn with_error_message(self, error_message: Option<String>) -> Self {
        Self {
            error_message,
            ..self
        }
    }

    pub(crate) fn for_statement(&self, sql_text: String) -> Self {
        Self {
            sql_text,
            ..self.clone()
        }
    }

    fn into_entry(self, connection_id: String, database_name: Option<String>) -> NewHistoryEntry {
        NewHistoryEntry {
            connection_id,
            database_name,
            sql_text: self.sql_text,
            duration_ms: Some(self.duration_ms),
            row_count: Some(self.row_count),
            affected_rows: Some(self.affected_rows),
            success: self.error_message.is_none(),
            error_message: self.error_message,
        }
    }
}

pub(crate) fn log_history_record(state: &AppState, session_id: &str, record: HistoryRecord) {
    resolve_connection_context(state, session_id)
        .log_single_entry_if_resolved(&state.db, |connection_id, database_name| {
            record.into_entry(connection_id, database_name)
        });
}

pub(crate) fn log_history_batch(state: &AppState, session_id: &str, records: Vec<HistoryRecord>) {
    resolve_connection_context(state, session_id).log_batch_if_resolved(&state.db, records);
}

pub(crate) struct HistoryStatement<'a> {
    pub(crate) session_id: &'a str,
    pub(crate) sql_text: String,
}

pub(crate) async fn run_with_history<T>(
    state: &AppState,
    statement: HistoryStatement<'_>,
    operation: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let started_at = Instant::now();
    let result = operation.await;
    let record = HistoryRecord::for_outcome(statement.sql_text, started_at, &result);
    log_history_record(state, statement.session_id, record);
    result
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

pub async fn execute_query_bridge(
    state: &AppState,
    request: &ExecuteQueryRequest,
) -> Result<ExecuteQueryResult, String> {
    let session_id = request.connection_id.as_str();
    let sql = request.sql.as_str();
    let result = execute_query_impl(state, request).await;

    if result.is_ok() {
        invalidate_metadata_cache_for_executed_sql(state, session_id, sql);
    }

    let record = match &result {
        Ok(query_result) => HistoryRecord::for_query_result(sql.to_string(), query_result),
        Err(error) => HistoryRecord::failed(sql.to_string(), error),
    };
    log_history_record(state, session_id, record);
    result
}

fn invalidate_metadata_cache_for_successful_statements(
    state: &AppState,
    session_id: &str,
    multi: &MultiQueryResult,
) {
    let successful_statements = multi.results.iter().filter(|item| item.error.is_none());
    for item in successful_statements {
        invalidate_metadata_cache_for_executed_sql(state, session_id, &item.source_sql);
    }
}

pub async fn execute_multi_query_bridge(
    state: &AppState,
    request: &ExecuteMultiQueryRequest,
) -> Result<MultiQueryResult, String> {
    let session_id = request.connection_id.as_str();
    let result = execute_multi_query_impl(state, request).await;

    match &result {
        Ok(multi) => {
            invalidate_metadata_cache_for_successful_statements(state, session_id, multi);
            let records = multi
                .results
                .iter()
                .map(HistoryRecord::for_multi_query_item)
                .collect();
            log_history_batch(state, session_id, records);
        }
        Err(error) => {
            let record = HistoryRecord::failed(MULTI_QUERY_BATCH_LABEL.to_string(), error);
            log_history_record(state, session_id, record);
        }
    }
    result
}

pub async fn execute_call_query_bridge(
    state: &AppState,
    request: &ExecuteCallQueryRequest,
) -> Result<MultiQueryResult, String> {
    let session_id = request.connection_id.as_str();
    let sql = request.sql.to_string();
    let result = execute_call_query_impl(state, request).await;

    let record = match &result {
        Ok(multi) => HistoryRecord::for_call_query(sql, multi),
        Err(error) => HistoryRecord::failed(sql, error),
    };
    log_history_record(state, session_id, record);
    result
}

fn history_row_count(item: &MultiQueryResultItem) -> i64 {
    item.exported_row_count
        .and_then(|exported_rows| i64::try_from(exported_rows).ok())
        .unwrap_or(item.total_rows)
}
