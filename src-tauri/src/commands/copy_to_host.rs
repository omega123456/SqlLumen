//! Tauri commands for the "Copy to Another Host" feature.
//!
//! Phase 1 implements only object enumeration (`list_copyable_objects`): given a
//! source connection and database, it returns the copyable schema objects grouped
//! into the five supported categories — Tables, Procedures, Functions, Triggers,
//! and Events. Views and system schemas are always excluded.
//!
//! The thin `#[tauri::command]` wrapper cannot be unit-tested (it requires the
//! Tauri runtime), so it is guarded by the same `#[cfg(not(coverage))]` real
//! wrapper + `#[cfg(coverage)]` stub idiom used in `commands/sql_dump.rs`.

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

/// A table available to copy, with its estimated row count.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyableTable {
    pub name: String,
    pub estimated_rows: u64,
}

/// The grouped set of copyable objects for a source database.
///
/// Views are intentionally excluded everywhere; this feature copies only base
/// tables, stored procedures, functions, triggers, and events.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyableObjects {
    pub tables: Vec<CopyableTable>,
    pub procedures: Vec<String>,
    pub functions: Vec<String>,
    pub triggers: Vec<String>,
    pub events: Vec<String>,
}

/// System schemas that are never offered for copy.
pub const SYSTEM_SCHEMAS: [&str; 4] = ["information_schema", "performance_schema", "mysql", "sys"];

/// `true` if the given schema name is a MySQL system schema (case-insensitive).
pub fn is_system_schema(schema: &str) -> bool {
    let lower = schema.to_ascii_lowercase();
    SYSTEM_SCHEMAS.contains(&lower.as_str())
}

/// `true` if the given `information_schema.TABLES.TABLE_TYPE` denotes a base table.
///
/// Views report `TABLE_TYPE = 'VIEW'` (and other non-base types contain `VIEW`);
/// base tables report `'BASE TABLE'`. Anything containing `VIEW` is excluded.
pub fn is_base_table(table_type: &str) -> bool {
    !table_type.to_ascii_uppercase().contains("VIEW")
}

fn is_named_base_table(name: &str, table_type: &str) -> bool {
    !name.is_empty() && is_base_table(table_type)
}

/// Build a [`CopyableTable`] list from decoded `(table_name, table_type, estimated_rows)`
/// triples, excluding views and clamping negative row estimates to zero.
///
/// Pure shaping helper so the grouping/filtering logic is testable without a live
/// MySQL pool (the `_impl` only decodes rows and delegates here).
pub fn build_copyable_tables(rows: &[(String, String, i64)]) -> Vec<CopyableTable> {
    rows.iter()
        .filter(|(name, table_type, _)| is_named_base_table(name, table_type))
        .map(|(name, _, estimated_rows)| CopyableTable {
            name: name.clone(),
            estimated_rows: (*estimated_rows).max(0) as u64,
        })
        .collect()
}

/// Split decoded `(routine_name, routine_type)` pairs into procedures and functions.
///
/// `ROUTINE_TYPE` is `PROCEDURE` or `FUNCTION` (case-insensitive); unknown types are
/// ignored. Pure shaping helper.
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

/// Collect non-empty names from decoded single-column rows (triggers / events).
/// Pure shaping helper.
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

// Coverage stubs — the real wrappers require the Tauri runtime and are excluded
// from coverage; the tested logic lives in the matching `*_impl` functions.
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
