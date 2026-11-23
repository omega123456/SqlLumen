use futures::TryStreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Seek, Write};

use crate::export::job_retention::cleanup_terminal_jobs;
use crate::export::sql_dump::{self, DumpOptions, INSERT_BATCH_SIZE, SqlDumpValue};
use crate::export::sql_import;
use crate::mysql::cell_values::DecodedRow;
use crate::mysql::logged_query::{LoggedStatement, fetch_decoded_pooled};
#[cfg(not(coverage))]
use crate::mysql::logged_query::{decoded_row_stream, fetch_decoded, stream};
use crate::mysql::pool::BackgroundPool;
use crate::state::{AppState, DumpJobProgress, DumpJobStatus, ImportJobProgress, ImportJobStatus};

mod dump_control;
mod dump_run;
mod dump_values;
mod exportable_objects;
mod import_job;
mod insert_writer;
pub use dump_control::*;
pub use dump_run::*;
pub use dump_values::*;
pub use exportable_objects::*;
pub use import_job::*;
pub use insert_writer::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportableDatabase {
    pub name: String,
    pub tables: Vec<ExportableTable>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DumpObjectType {
    Table,
    View,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportableTable {
    pub name: String,
    pub object_type: DumpObjectType,
    pub estimated_rows: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpTableEntry {
    pub name: String,
    pub object_type: DumpObjectType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDumpInput {
    pub connection_id: String,
    pub file_path: String,
    pub databases: Vec<String>,
    pub tables: HashMap<String, Vec<DumpTableEntry>>,
    pub options: DumpOptions,
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_exportable_objects(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<ExportableDatabase>, String> {
    list_exportable_objects_impl(&state, &connection_id).await
}

fn open_pool(state: &AppState, connection_id: &str) -> Result<BackgroundPool, String> {
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))
}

pub async fn start_sql_dump_on_connection(
    state: &AppState,
    input: StartDumpInput,
) -> Result<String, String> {
    let pool = open_pool(state, &input.connection_id)?;
    start_sql_dump_impl(state, input, pool).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn start_sql_dump(
    state: tauri::State<'_, AppState>,
    input: StartDumpInput,
) -> Result<String, String> {
    start_sql_dump_on_connection(&state, input).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_dump_progress(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<DumpJobProgress, String> {
    get_dump_progress_impl(&state, &job_id)
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn cancel_dump(
    state: tauri::State<'_, AppState>,
    payload: CancelDumpRequest,
) -> Result<(), String> {
    cancel_dump_impl(&state, &payload).await
}

#[cfg(coverage)]
#[tauri::command]
pub async fn list_exportable_objects(
    _state: tauri::State<'_, AppState>,
    _connection_id: String,
) -> Result<Vec<ExportableDatabase>, String> {
    Ok(vec![])
}

#[cfg(coverage)]
#[tauri::command]
pub async fn start_sql_dump(
    _state: tauri::State<'_, AppState>,
    _input: StartDumpInput,
) -> Result<String, String> {
    Ok(String::new())
}

#[cfg(coverage)]
#[tauri::command]
pub async fn get_dump_progress(
    _state: tauri::State<'_, AppState>,
    _job_id: String,
) -> Result<DumpJobProgress, String> {
    Err("coverage stub".to_string())
}

#[cfg(coverage)]
#[tauri::command]
pub async fn cancel_dump(
    _state: tauri::State<'_, AppState>,
    _payload: CancelDumpRequest,
) -> Result<(), String> {
    Err("coverage stub".to_string())
}

pub async fn start_sql_import_on_connection(
    state: &AppState,
    input: StartImportInput,
) -> Result<String, String> {
    if state.registry.is_read_only(&input.connection_id) {
        return Err("Cannot import SQL on a read-only connection".to_string());
    }
    let pool = open_pool(state, &input.connection_id)?;
    start_sql_import_impl(state, input, pool).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn start_sql_import(
    state: tauri::State<'_, AppState>,
    input: StartImportInput,
) -> Result<String, String> {
    start_sql_import_on_connection(&state, input).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_import_progress(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<ImportJobProgress, String> {
    get_import_progress_impl(&state, &job_id)
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn cancel_import(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<(), String> {
    cancel_import_impl(&state, &job_id)
}

#[cfg(coverage)]
#[tauri::command]
pub async fn start_sql_import(
    _state: tauri::State<'_, AppState>,
    _input: StartImportInput,
) -> Result<String, String> {
    Ok(String::new())
}

#[cfg(coverage)]
#[tauri::command]
pub async fn get_import_progress(
    _state: tauri::State<'_, AppState>,
    _job_id: String,
) -> Result<ImportJobProgress, String> {
    Err("coverage stub".to_string())
}

#[cfg(coverage)]
#[tauri::command]
pub async fn cancel_import(
    _state: tauri::State<'_, AppState>,
    _job_id: String,
) -> Result<(), String> {
    Err("coverage stub".to_string())
}
