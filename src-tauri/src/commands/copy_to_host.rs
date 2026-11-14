use serde::{Deserialize, Serialize};

use crate::export::copy_to_host::{
    new_running_progress, validate_selection_for_options, CopyToHostParams,
};
use crate::export::job_retention::cleanup_terminal_jobs;
use crate::mysql::query_log;
use crate::mysql::schema_queries::decode_mysql_text_cell_named;
use crate::state::{AppState, CopyJobProgress};

mod copy_jobs;
mod object_listing;
pub use copy_jobs::*;
pub use object_listing::*;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyableTable {
    pub name: String,
    pub estimated_rows: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyableObjects {
    pub tables: Vec<CopyableTable>,
    pub procedures: Vec<String>,
    pub functions: Vec<String>,
    pub triggers: Vec<String>,
    pub events: Vec<String>,
}

pub const SYSTEM_SCHEMAS: [&str; 4] = ["information_schema", "performance_schema", "mysql", "sys"];

pub fn is_system_schema(schema: &str) -> bool {
    let lower = schema.to_ascii_lowercase();
    SYSTEM_SCHEMAS.contains(&lower.as_str())
}

pub fn is_base_table(table_type: &str) -> bool {
    !table_type.to_ascii_uppercase().contains("VIEW")
}

fn is_named_base_table(name: &str, table_type: &str) -> bool {
    !name.is_empty() && is_base_table(table_type)
}

pub fn build_copyable_tables(rows: &[(String, String, i64)]) -> Vec<CopyableTable> {
    rows.iter()
        .filter(|(name, table_type, _)| is_named_base_table(name, table_type))
        .map(|(name, _, estimated_rows)| CopyableTable {
            name: name.clone(),
            estimated_rows: (*estimated_rows).max(0) as u64,
        })
        .collect()
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RoutineNames {
    pub procedures: Vec<String>,
    pub functions: Vec<String>,
}

pub fn split_routines(rows: &[(String, String)]) -> RoutineNames {
    let mut procedures = Vec::new();
    let mut functions = Vec::new();
    for (name, routine_type) in rows {
        if name.is_empty() {
            continue;
        }
        match routine_type.to_ascii_uppercase().as_str() {
            "PROCEDURE" => procedures.push(name.clone()),
            "FUNCTION" => functions.push(name.clone()),
            _ => {}
        }
    }
    RoutineNames {
        procedures,
        functions,
    }
}

pub fn collect_names(rows: &[String]) -> Vec<String> {
    rows.iter()
        .filter(|name| !name.is_empty())
        .cloned()
        .collect()
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_copyable_objects(
    state: tauri::State<'_, AppState>,
    payload: crate::commands::requests::DatabaseRequest,
) -> Result<CopyableObjects, String> {
    list_copyable_objects_impl(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn start_copy_to_host(
    state: tauri::State<'_, AppState>,
    params: CopyToHostParams,
) -> Result<String, String> {
    start_copy_to_host_impl(&state, params)
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_copy_progress(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<CopyJobProgress, String> {
    get_copy_progress_impl(&state, &job_id)
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn cancel_copy(state: tauri::State<'_, AppState>, job_id: String) -> Result<(), String> {
    cancel_copy_impl(&state, &job_id)
}

#[cfg(coverage)]
#[tauri::command]
pub async fn list_copyable_objects(
    _state: tauri::State<'_, AppState>,
    _payload: crate::commands::requests::DatabaseRequest,
) -> Result<CopyableObjects, String> {
    Ok(CopyableObjects::default())
}

#[cfg(coverage)]
#[tauri::command]
pub async fn start_copy_to_host(
    _state: tauri::State<'_, AppState>,
    _params: CopyToHostParams,
) -> Result<String, String> {
    Ok(String::new())
}

#[cfg(coverage)]
#[tauri::command]
pub async fn get_copy_progress(
    _state: tauri::State<'_, AppState>,
    _job_id: String,
) -> Result<CopyJobProgress, String> {
    Err("coverage stub".to_string())
}

#[cfg(coverage)]
#[tauri::command]
pub async fn cancel_copy(
    _state: tauri::State<'_, AppState>,
    _job_id: String,
) -> Result<(), String> {
    Err("coverage stub".to_string())
}
