//! Tauri IPC command wrappers for MySQL process list operations.
//!
//! Under `cfg(coverage)`, all Tauri command wrappers are excluded — tests exercise
//! the `*_impl` functions directly.

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

// ── get_processlist ──────────────────────────────────────────────────────────

pub async fn get_processlist_impl(
    state: &AppState,
    session_id: &str,
) -> Result<Vec<ProcessRow>, String> {
    let pool = state
        .registry
        .get_pool(session_id)
        .ok_or_else(|| format!("Connection '{session_id}' not found"))?;

    let rows = sqlx::raw_sql("SHOW FULL PROCESSLIST")
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch process list: {e}"))?;

    let mut result = Vec::with_capacity(rows.len());

    // Column-reading helpers to reduce repetitive try_get boilerplate
    let get_string = |row: &sqlx::mysql::MySqlRow, col: &str| -> String {
        row.try_get(col).unwrap_or_default()
    };
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
    if state.registry.is_read_only(session_id) {
        return Err("Cannot kill queries on a read-only connection".to_string());
    }

    let pool = state
        .registry
        .get_pool(session_id)
        .ok_or_else(|| format!("Connection '{session_id}' not found"))?;

    let mut results = Vec::with_capacity(ids.len());
    for id in ids {
        let sql = format!("KILL QUERY {id}");
        match sqlx::query(&sql).execute(&pool).await {
            Ok(_) => results.push(KillResult {
                id,
                success: true,
                error: None,
            }),
            Err(e) => {
                tracing::warn!(id, error = %e, "Failed to kill query");
                results.push(KillResult {
                    id,
                    success: false,
                    error: Some(e.to_string()),
                });
            }
        }
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
