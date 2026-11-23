use crate::commands::query_history_bridge::resolve_connection_context;
use crate::db::history::NewHistoryEntry;
use crate::mysql::cell_values::DecodedRow;
use crate::mysql::logged_query::{
    LoggedStatement, execute_pooled, fetch_decoded_pooled, fetch_first_decoded_pooled,
};
use crate::mysql::pool::BackgroundPool;
use crate::state::AppState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRow {
    pub id: u64,
    pub user: String,
    pub host: String,
    pub db: Option<String>,
    pub command: String,
    pub time: i64,
    pub state: Option<String>,
    pub info: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KillQueriesRequest {
    pub session_id: String,
    pub ids: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KillResult {
    pub id: u64,
    pub success: bool,
    pub error: Option<String>,
}

const RDS_KILL_PROCEDURE_CHECK_SQL: &str = "SELECT ROUTINE_NAME \
    FROM information_schema.ROUTINES \
    WHERE ROUTINE_SCHEMA = 'mysql' \
      AND ROUTINE_NAME = 'rds_kill' \
      AND ROUTINE_TYPE = 'PROCEDURE' \
    LIMIT 1";

fn optional_text_or_none(row: &DecodedRow, column_name: &str) -> Option<String> {
    row.optional_text(column_name).ok().flatten()
}

fn process_row(row: &DecodedRow) -> Result<ProcessRow, String> {
    let id = row
        .unsigned("Id")
        .map_err(|error| format!("Failed to read Id column: {error}"))?;
    Ok(ProcessRow {
        id,
        user: row.text_or_empty("User"),
        host: row.text_or_empty("Host"),
        db: optional_text_or_none(row, "db"),
        command: row.text_or_empty("Command"),
        time: row.signed("Time").unwrap_or(0),
        state: optional_text_or_none(row, "State"),
        info: optional_text_or_none(row, "Info"),
    })
}

pub async fn get_processlist_impl(
    state: &AppState,
    session_id: &str,
) -> Result<Vec<ProcessRow>, String> {
    let pool = state
        .registry
        .get_pool(session_id)
        .ok_or_else(|| format!("Connection '{session_id}' not found"))?;

    let rows = fetch_decoded_pooled(&pool, LoggedStatement::text("SHOW FULL PROCESSLIST"))
        .await
        .map_err(|error| format!("Failed to fetch process list: {error}"))?;

    let mut result = Vec::with_capacity(rows.len());
    for row in &rows {
        result.push(process_row(row)?);
    }

    Ok(result)
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_processlist(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<ProcessRow>, String> {
    get_processlist_impl(&state, &session_id).await
}

fn kill_query_sql(id: u64, has_rds_kill: bool) -> String {
    if has_rds_kill {
        return format!("CALL mysql.rds_kill({id})");
    }
    crate::mysql::pool::kill_query_sql(id)
}

async fn detect_rds_kill(pool: &BackgroundPool) -> bool {
    let statement = LoggedStatement::text(RDS_KILL_PROCEDURE_CHECK_SQL);
    match fetch_first_decoded_pooled(pool, statement).await {
        Ok(first_row) => first_row.is_some(),
        Err(error) => {
            tracing::warn!(%error, "Failed to check for mysql.rds_kill");
            false
        }
    }
}

async fn execute_kill(pool: &BackgroundPool, id: u64, sql: &str) -> KillResult {
    match execute_pooled(pool, LoggedStatement::text(sql)).await {
        Ok(_) => KillResult {
            id,
            success: true,
            error: None,
        },
        Err(error) => {
            tracing::warn!(id, error = %error, "Failed to kill query");
            KillResult {
                id,
                success: false,
                error: Some(error.to_string()),
            }
        }
    }
}

pub async fn kill_queries_impl(
    state: &AppState,
    request: KillQueriesRequest,
) -> Result<Vec<KillResult>, String> {
    let KillQueriesRequest { session_id, ids } = request;
    let session_id = session_id.as_str();
    let pool = state
        .registry
        .get_pool(session_id)
        .ok_or_else(|| format!("Connection '{session_id}' not found"))?;
    let has_rds_kill = detect_rds_kill(&pool).await;
    let history_context = resolve_connection_context(state, session_id);

    let mut results = Vec::with_capacity(ids.len());
    for id in ids {
        let sql = kill_query_sql(id, has_rds_kill);
        let start = std::time::Instant::now();
        let result = execute_kill(&pool, id, &sql).await;
        history_context.clone().log_single_entry_if_resolved(
            &state.db,
            |connection_id, database_name| NewHistoryEntry {
                connection_id,
                database_name,
                sql_text: sql,
                duration_ms: Some(start.elapsed().as_millis() as i64),
                row_count: Some(0),
                affected_rows: Some(0),
                success: result.success,
                error_message: result.error.clone(),
            },
        );
        results.push(result);
    }

    Ok(results)
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn kill_queries(
    state: tauri::State<'_, AppState>,
    payload: KillQueriesRequest,
) -> Result<Vec<KillResult>, String> {
    kill_queries_impl(&state, payload).await
}
