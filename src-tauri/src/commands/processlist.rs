//! Tauri IPC command wrappers for MySQL process list operations.
//!
//! Under `cfg(coverage)`, all Tauri command wrappers are excluded — tests exercise
//! the `*_impl` functions directly.

use crate::commands::query_history_bridge::{
    log_single_entry_if_resolved, resolve_connection_context,
};
use crate::db::history::NewHistoryEntry;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::Row;

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

// ── get_processlist ──────────────────────────────────────────────────────────

pub async fn get_processlist_impl(
    state: &AppState,
    session_id: &str,
) -> Result<Vec<ProcessRow>, String> {
    let pool = state
        .registry
        .get_pool(session_id)
        .ok_or_else(|| format!("Connection '{session_id}' not found"))?;

    let sql = "SHOW FULL PROCESSLIST";
    crate::mysql::query_log::log_outgoing_sql(sql);
    let rows = sqlx::raw_sql(sql)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch process list: {e}"))?;
    crate::mysql::query_log::log_mysql_rows(&rows);

    let mut result = Vec::with_capacity(rows.len());

    // Column-reading helpers to reduce repetitive try_get boilerplate
    let get_string =
        |row: &sqlx::mysql::MySqlRow, col: &str| -> String { row.try_get(col).unwrap_or_default() };
    let get_opt_string = |row: &sqlx::mysql::MySqlRow, col: &str| -> Option<String> {
        row.try_get(col).unwrap_or(None)
    };

    for row in &rows {
        let id: u64 = row
            .try_get::<u64, _>("Id")
            .or_else(|_| row.try_get::<i64, _>("Id").map(|v| v as u64))
            .map_err(|e| format!("Failed to read Id column: {e}"))?;
        let time: i64 = row
            .try_get::<i64, _>("Time")
            .or_else(|_| row.try_get::<i32, _>("Time").map(|v| v as i64))
            .unwrap_or(0);

        result.push(ProcessRow {
            id,
            user: get_string(row, "User"),
            host: get_string(row, "Host"),
            db: get_opt_string(row, "db"),
            command: get_string(row, "Command"),
            time,
            state: get_opt_string(row, "State"),
            info: get_opt_string(row, "Info"),
        });
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

// ── kill_queries ─────────────────────────────────────────────────────────────

pub async fn kill_queries_impl(
    state: &AppState,
    session_id: &str,
    ids: Vec<u64>,
) -> Result<Vec<KillResult>, String> {
    let pool = state
        .registry
        .get_pool(session_id)
        .ok_or_else(|| format!("Connection '{session_id}' not found"))?;
    crate::mysql::query_log::log_outgoing_sql(RDS_KILL_PROCEDURE_CHECK_SQL);
    let has_rds_kill = match sqlx::query(RDS_KILL_PROCEDURE_CHECK_SQL)
        .fetch_optional(&pool)
        .await
    {
        Ok(Some(row)) => {
            crate::mysql::query_log::log_mysql_row(&row);
            true
        }
        Ok(None) => false,
        Err(error) => {
            crate::mysql::query_log::log_execute_error(&error);
            tracing::warn!(%error, "Failed to check for mysql.rds_kill");
            false
        }
    };
    let (connection_id, database_name) = resolve_connection_context(state, session_id);

    let mut results = Vec::with_capacity(ids.len());
    for id in ids {
        let sql = if has_rds_kill {
            format!("CALL mysql.rds_kill({id})")
        } else {
            format!("KILL QUERY {id}")
        };
        crate::mysql::query_log::log_outgoing_sql(&sql);
        let start = std::time::Instant::now();
        let result = match sqlx::query(&sql).execute(&pool).await {
            Ok(result) => {
                crate::mysql::query_log::log_execute_result(&result);
                KillResult {
                    id,
                    success: true,
                    error: None,
                }
            }
            Err(e) => {
                crate::mysql::query_log::log_execute_error(&e);
                tracing::warn!(id, error = %e, "Failed to kill query");
                KillResult {
                    id,
                    success: false,
                    error: Some(e.to_string()),
                }
            }
        };
        log_single_entry_if_resolved(
            &state.db,
            connection_id.clone(),
            database_name.clone(),
            session_id,
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
    session_id: String,
    ids: Vec<u64>,
) -> Result<Vec<KillResult>, String> {
    kill_queries_impl(&state, &session_id, ids).await
}
