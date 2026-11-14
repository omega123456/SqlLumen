use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::commands::query_history_bridge::{
    log_history_batch, log_history_record, run_with_history, single_row_count, HistoryRecord,
    HistoryStatement,
};
use crate::commands::requests::{RoutineRequest, SchemaObjectRequest};
#[cfg(not(coverage))]
use crate::mysql::query_log;
use crate::mysql::schema_queries;
use crate::state::AppState;
#[cfg(not(coverage))]
use sqlx::Executor;
use std::time::Instant;
#[cfg(not(coverage))]
use tauri::State;

mod object_body;
mod object_drop;
mod object_save;
mod routine_parameters;
mod with_history;
pub use object_body::*;
pub use object_drop::*;
pub use object_save::*;
pub use routine_parameters::*;
pub use with_history::*;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineParameter {
    pub name: String,
    pub data_type: String,
    pub mode: String,
    pub ordinal_position: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineParametersWithFoundResponse {
    pub parameters: Vec<RoutineParameter>,
    pub found: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveObjectRequest {
    pub connection_id: String,
    pub database: String,
    pub object_name: String,
    pub object_type: String,
    pub body: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveObjectResponse {
    pub success: bool,
    pub error_message: Option<String>,
    pub drop_succeeded: bool,
    pub saved_object_name: Option<String>,
}

#[cfg(not(coverage))]
fn get_pool(state: &AppState, connection_id: &str) -> Result<sqlx::MySqlPool, String> {
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' is not open"))
}

#[cfg(not(coverage))]
async fn execute_simple_sql(
    conn: &mut sqlx::MySqlConnection,
    sql: &str,
) -> Result<sqlx::mysql::MySqlQueryResult, sqlx::Error> {
    query_log::log_outgoing_sql(sql);
    match conn.execute(sqlx::AssertSqlSafe(sql)).await {
        Ok(result) => {
            query_log::log_execute_result(&result);
            Ok(result)
        }
        Err(error) => {
            query_log::log_execute_error(&error);
            Err(error)
        }
    }
}

fn check_not_read_only(state: &AppState, connection_id: &str) -> Result<(), String> {
    if state.registry.is_read_only(connection_id) {
        return Err("Operation not permitted: connection is read-only".to_string());
    }
    Ok(())
}

fn object_type_keyword(object_type: &str) -> Result<&'static str, String> {
    match object_type {
        "view" => Ok("VIEW"),
        "procedure" => Ok("PROCEDURE"),
        "function" => Ok("FUNCTION"),
        "trigger" => Ok("TRIGGER"),
        "event" => Ok("EVENT"),
        _ => Err(format!("Unknown object type: '{object_type}'")),
    }
}

fn unescape_backtick_identifier(identifier: &str) -> String {
    identifier.replace("``", "`")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDdlName {
    pub database: Option<String>,
    pub name: String,
    pub type_keyword: String,
}

pub fn parse_ddl_name(body: &str) -> Result<ParsedDdlName, String> {
    let re = Regex::new(
        r"(?i)CREATE\s+(?:OR\s+REPLACE\s+)?(?:ALGORITHM\s*=\s*\w+\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?(\w+)\s+(?:(?:`((?:``|[^`])+)`|(\w+))\.)?(?:`((?:``|[^`])+)`|(\w+))",
    )
    .map_err(|error| format!("Internal regex error: {error}"))?;

    let caps = re.captures(body.trim()).ok_or_else(|| {
        "Could not parse object name from DDL. Expected CREATE ... `name` or CREATE ... name syntax.".to_string()
    })?;

    let type_keyword = caps
        .get(1)
        .ok_or("Could not extract object type from DDL")?
        .as_str()
        .to_uppercase();

    let db = caps
        .get(2)
        .map(|matched| unescape_backtick_identifier(matched.as_str()))
        .or_else(|| caps.get(3).map(|matched| matched.as_str().to_string()));
    let name = caps
        .get(4)
        .map(|matched| unescape_backtick_identifier(matched.as_str()))
        .or_else(|| caps.get(5).map(|matched| matched.as_str().to_string()))
        .ok_or("Could not extract object name from DDL")?;

    Ok(ParsedDdlName {
        database: db,
        name,
        type_keyword,
    })
}

fn object_name_label(is_view: bool) -> &'static str {
    if is_view {
        return "View";
    }
    "Object"
}

pub fn validate_view_ddl_prefix(body: &str, mode: &str) -> Result<(), String> {
    let trimmed = body.trim();

    match mode {
        "alter" => {
            let re = Regex::new(r"(?i)^\s*CREATE\s+OR\s+REPLACE\s+(?:ALGORITHM\s*=\s*\w+\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?VIEW\s+")
                .map_err(|error| format!("Internal regex error: {error}"))?;
            if !re.is_match(trimmed) {
                return Err(
                    "View DDL in alter mode must start with 'CREATE OR REPLACE VIEW'".to_string(),
                );
            }
        }
        "create" => {
            let re_or_replace = Regex::new(r"(?i)^\s*CREATE\s+OR\s+REPLACE\s+")
                .map_err(|error| format!("Internal regex error: {error}"))?;
            if re_or_replace.is_match(trimmed) {
                return Err(
                    "View DDL in create mode must not use 'CREATE OR REPLACE VIEW' — use 'CREATE VIEW' instead"
                        .to_string(),
                );
            }
            let re_create_view = Regex::new(r"(?i)^\s*CREATE\s+(?:ALGORITHM\s*=\s*\w+\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?VIEW\s+")
                .map_err(|error| format!("Internal regex error: {error}"))?;
            if !re_create_view.is_match(trimmed) {
                return Err("View DDL in create mode must start with 'CREATE VIEW'".to_string());
            }
        }
        _ => return Err(format!("Invalid mode: '{mode}'")),
    }

    Ok(())
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_object_body(
    payload: SchemaObjectRequest,
    state: State<'_, AppState>,
) -> Result<String, String> {
    get_object_body_with_history(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn save_object(
    request: SaveObjectRequest,
    state: State<'_, AppState>,
) -> Result<SaveObjectResponse, String> {
    save_object_with_history(&state, request).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn drop_object(
    payload: SchemaObjectRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    drop_object_with_history(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_routine_parameters(
    payload: RoutineRequest,
    state: State<'_, AppState>,
) -> Result<Vec<RoutineParameter>, String> {
    get_routine_parameters_impl(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_routine_parameters_with_return_type(
    payload: RoutineRequest,
    state: State<'_, AppState>,
) -> Result<RoutineParametersWithFoundResponse, String> {
    get_routine_parameters_with_return_type_impl(&state, &payload).await
}
