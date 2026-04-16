//! Tauri commands for SQL dump export — listing exportable objects,
//! starting a dump job, and checking progress.
//! Also includes SQL import commands for executing .sql script files.

use serde::{Deserialize, Serialize};
use sqlx::mysql::MySqlValueRef;
use sqlx::{Column, Row, TypeInfo, Value, ValueRef};
use std::collections::HashMap;
use std::io::Write;

use crate::export::sql_dump::{self, DumpOptions, SqlDumpValue};
use crate::export::sql_import;
use crate::mysql::schema_queries::{decode_mysql_text_cell, decode_mysql_text_cell_named};
use crate::state::{AppState, DumpJobProgress, DumpJobStatus, ImportJobProgress, ImportJobStatus};

/// A database with its tables available for export.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportableDatabase {
    pub name: String,
    pub tables: Vec<ExportableTable>,
}

/// A table or view available for export.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportableTable {
    pub name: String,
    pub object_type: String,
    pub estimated_rows: u64,
}

/// Input for starting a SQL dump export job.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDumpInput {
    pub connection_id: String,
    pub file_path: String,
    pub databases: Vec<String>,
    /// Map of database name → list of table/view names. If empty for a database,
    /// all tables/views in that database are exported.
    pub tables: HashMap<String, Vec<String>>,
    pub options: DumpOptions,
}

/// List databases and their tables/views that can be exported.
pub async fn list_exportable_objects_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<ExportableDatabase>, String> {
    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found in registry"))?;

    // Get list of databases
    let db_rows = sqlx::query("SHOW DATABASES")
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to list databases: {e}"))?;

    let mut result = Vec::new();

    for db_row in &db_rows {
        let db_name: String = decode_mysql_text_cell(db_row, 0)?;

        // Skip system databases
        if db_name == "information_schema"
            || db_name == "performance_schema"
            || db_name == "mysql"
            || db_name == "sys"
        {
            continue;
        }

        // Get tables and views for this database
        let table_query = format!(
            "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS \
             FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = '{}' \
             ORDER BY TABLE_NAME",
            sql_dump::escape_string_value(&db_name)
        );

        let table_rows = sqlx::query(&table_query)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("Failed to list tables for '{db_name}': {e}"))?;

        let tables: Vec<ExportableTable> = table_rows
            .iter()
            .map(|row| {
                let name: String =
                    decode_mysql_text_cell_named(row, "TABLE_NAME").unwrap_or_default();
                let table_type: String =
                    decode_mysql_text_cell_named(row, "TABLE_TYPE").unwrap_or_default();
                let estimated_rows: i64 = row.try_get("TABLE_ROWS").unwrap_or(0);
                ExportableTable {
                    name,
                    object_type: if table_type.contains("VIEW") {
                        "view".to_string()
                    } else {
                        "table".to_string()
                    },
                    estimated_rows: estimated_rows.max(0) as u64,
                }
            })
            .collect();

        result.push(ExportableDatabase {
            name: db_name,
            tables,
        });
    }

    Ok(result)
}

/// Start a SQL dump export job. Returns the job ID for progress tracking.
///
/// The actual dump runs on a background task. The caller polls `get_dump_progress_impl`
/// to check status.
pub async fn start_sql_dump_impl(
    _state: &AppState,
    input: StartDumpInput,
    dump_jobs: &std::sync::Arc<std::sync::RwLock<HashMap<String, DumpJobProgress>>>,
    pool: sqlx::MySqlPool,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    // Count total tables to export
    let total_tables: usize = input
        .databases
        .iter()
        .map(|db| input.tables.get(db).map(|t| t.len()).unwrap_or(0))
        .sum();

    // Initialize progress
    let progress = DumpJobProgress {
        job_id: job_id.clone(),
        status: DumpJobStatus::Running,
        tables_total: total_tables,
        tables_done: 0,
        current_table: None,
        bytes_written: 0,
        error_message: None,
        completed_at: None,
    };

    {
        let mut jobs = dump_jobs.write().map_err(|e| e.to_string())?;
        // Clean up stale terminal jobs (older than 5 minutes)
        cleanup_stale_dump_jobs(&mut jobs);
        jobs.insert(job_id.clone(), progress);
    }

    // Clone what we need for the background task
    let job_id_clone = job_id.clone();
    let dump_jobs_arc = std::sync::Arc::clone(dump_jobs);

    tokio::task::spawn_blocking(move || {
        let result = execute_dump(&pool, &input, &job_id_clone, &dump_jobs_arc);

        let mut jobs = dump_jobs_arc.write().unwrap_or_else(|p| p.into_inner());
        if let Some(progress) = jobs.get_mut(&job_id_clone) {
            match result {
                Ok(bytes) => {
                    progress.status = DumpJobStatus::Completed;
                    progress.bytes_written = bytes;
                    progress.current_table = None;
                    progress.completed_at = Some(std::time::SystemTime::now());
                }
                Err(err) => {
                    progress.status = DumpJobStatus::Failed;
                    progress.error_message = Some(err);
                    progress.current_table = None;
                    progress.completed_at = Some(std::time::SystemTime::now());
                }
            }
        }
    });

    Ok(job_id)
}

/// Execute the actual SQL dump (blocking). Returns total bytes written.
fn execute_dump(
    pool: &sqlx::MySqlPool,
    input: &StartDumpInput,
    job_id: &str,
    dump_jobs: &std::sync::Arc<std::sync::RwLock<HashMap<String, DumpJobProgress>>>,
) -> Result<u64, String> {
    let rt = tokio::runtime::Handle::try_current().map_err(|e| format!("No tokio runtime: {e}"))?;

    let mut file = std::fs::File::create(&input.file_path)
        .map_err(|e| format!("Failed to create file '{}': {e}", input.file_path))?;

    // Get server version
    let server_version: String = rt.block_on(async {
        let row = sqlx::query("SELECT VERSION()")
            .fetch_one(pool)
            .await
            .map_err(|e| format!("Failed to get server version: {e}"))?;
        decode_mysql_text_cell(&row, 0)
    })?;

    // Determine a representative database name for the header
    let header_db = input
        .databases
        .first()
        .map(|s| s.as_str())
        .unwrap_or("mysql");

    sql_dump::write_header(&mut file, header_db, &server_version)
        .map_err(|e| format!("Failed to write header: {e}"))?;

    if input.options.use_transaction {
        sql_dump::write_transaction_start(&mut file)
            .map_err(|e| format!("Failed to write transaction start: {e}"))?;
    }

    let mut tables_done: usize = 0;

    for db_name in &input.databases {
        let table_list = input.tables.get(db_name).cloned().unwrap_or_default();
        if table_list.is_empty() {
            continue;
        }

        // USE database
        writeln!(file, "USE `{}`;", sql_dump::escape_identifier(db_name))
            .map_err(|e| format!("Write error: {e}"))?;
        writeln!(file).map_err(|e| format!("Write error: {e}"))?;

        for table_name in &table_list {
            // Update progress
            {
                let mut jobs = dump_jobs.write().unwrap_or_else(|p| p.into_inner());
                if let Some(progress) = jobs.get_mut(job_id) {
                    progress.current_table = Some(format!("{}.{}", db_name, table_name));
                }
            }

            // Determine if this is a view
            let is_view = rt.block_on(async {
                let query = format!(
                    "SELECT TABLE_TYPE FROM information_schema.TABLES \
                     WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}'",
                    sql_dump::escape_string_value(db_name),
                    sql_dump::escape_string_value(table_name)
                );
                let row = sqlx::query(&query)
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| format!("Failed to check table type: {e}"))?;
                match row {
                    Some(r) => {
                        let tt: String =
                            decode_mysql_text_cell_named(&r, "TABLE_TYPE").unwrap_or_default();
                        Ok::<bool, String>(tt.contains("VIEW"))
                    }
                    None => Ok::<bool, String>(false),
                }
            })?;

            // Get CREATE statement
            if input.options.include_structure {
                let create_sql = if is_view {
                    rt.block_on(async {
                        let q = format!(
                            "SHOW CREATE VIEW `{}`.`{}`",
                            sql_dump::escape_identifier(db_name),
                            sql_dump::escape_identifier(table_name)
                        );
                        let row = sqlx::query(&q).fetch_one(pool).await.map_err(|e| {
                            format!("Failed to get CREATE VIEW for '{table_name}': {e}")
                        })?;
                        decode_mysql_text_cell(&row, 1)
                    })?
                } else {
                    rt.block_on(async {
                        let q = format!(
                            "SHOW CREATE TABLE `{}`.`{}`",
                            sql_dump::escape_identifier(db_name),
                            sql_dump::escape_identifier(table_name)
                        );
                        let row = sqlx::query(&q).fetch_one(pool).await.map_err(|e| {
                            format!("Failed to get CREATE TABLE for '{table_name}': {e}")
                        })?;
                        decode_mysql_text_cell(&row, 1)
                    })?
                };

                sql_dump::write_structure(
                    &mut file,
                    table_name,
                    &create_sql,
                    input.options.include_drop,
                    is_view,
                )
                .map_err(|e| format!("Failed to write structure for '{table_name}': {e}"))?;
            }

            // Get data (only for tables, not views)
            if input.options.include_data && !is_view {
                let (columns, rows) = rt.block_on(async {
                    // Fetch all data — column names come from the result set metadata
                    let data_query = format!(
                        "SELECT * FROM `{}`.`{}`",
                        sql_dump::escape_identifier(db_name),
                        sql_dump::escape_identifier(table_name)
                    );
                    let data_rows: Vec<sqlx::mysql::MySqlRow> = sqlx::query(&data_query)
                        .fetch_all(pool)
                        .await
                        .map_err(|e| format!("Failed to fetch data from '{table_name}': {e}"))?;

                    // Extract column names from the first row's metadata (or return empty)
                    let columns: Vec<String> = if let Some(first) = data_rows.first() {
                        first
                            .columns()
                            .iter()
                            .map(|c| c.name().to_string())
                            .collect()
                    } else {
                        Vec::new()
                    };

                    // Serialize every cell using the raw MySQL value + type metadata
                    let rows: Vec<Vec<SqlDumpValue>> = data_rows
                        .iter()
                        .map(|row| {
                            (0..row.columns().len())
                                .map(|i| serialize_dump_value(row, i))
                                .collect()
                        })
                        .collect();

                    Ok::<_, String>((columns, rows))
                })?;

                sql_dump::write_data_inserts(&mut file, table_name, &columns, &rows)
                    .map_err(|e| format!("Failed to write data for '{table_name}': {e}"))?;
            }

            tables_done += 1;

            // Update progress
            {
                let mut jobs = dump_jobs.write().unwrap_or_else(|p| p.into_inner());
                if let Some(progress) = jobs.get_mut(job_id) {
                    progress.tables_done = tables_done;
                }
            }
        }
    }

    if input.options.use_transaction {
        sql_dump::write_transaction_end(&mut file)
            .map_err(|e| format!("Failed to write transaction end: {e}"))?;
    }

    sql_dump::write_footer(&mut file).map_err(|e| format!("Failed to write footer: {e}"))?;

    file.flush()
        .map_err(|e| format!("Failed to flush file: {e}"))?;

    let metadata = std::fs::metadata(&input.file_path)
        .map_err(|e| format!("Failed to read file size: {e}"))?;

    Ok(metadata.len())
}

/// Get progress of a dump job.
pub fn get_dump_progress_impl(state: &AppState, job_id: &str) -> Result<DumpJobProgress, String> {
    let mut jobs = state.dump_jobs.write().map_err(|e| e.to_string())?;
    // Lazy cleanup: remove terminal jobs older than 5 minutes
    cleanup_stale_dump_jobs(&mut jobs);
    jobs.get(job_id)
        .cloned()
        .ok_or_else(|| format!("Dump job '{job_id}' not found"))
}

/// Duration after which terminal dump jobs are cleaned up.
const DUMP_JOB_STALE_DURATION: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// Remove terminal dump jobs whose `completed_at` is older than 5 minutes.
fn cleanup_stale_dump_jobs(jobs: &mut HashMap<String, DumpJobProgress>) {
    jobs.retain(|_, progress| {
        if let Some(completed_at) = progress.completed_at {
            match std::time::SystemTime::now().duration_since(completed_at) {
                Ok(age) => {
                    age < DUMP_JOB_STALE_DURATION
                }
                Err(_) => {
                    true
                }
            }
        } else {
            true // Running jobs are always kept
        }
    });
}

// ---------------------------------------------------------------------------
// Type-aware value serialization for SQL dumps
// ---------------------------------------------------------------------------

/// Serialize a single cell from a MySQL result row into a [`SqlDumpValue`],
/// using the column's type metadata to choose the correct representation.
///
/// This avoids the old bug where every cell was read as `Option<String>` and
/// then parsed back into a number (destroying leading zeros, failing on BLOBs, etc.).
fn serialize_dump_value(row: &sqlx::mysql::MySqlRow, i: usize) -> SqlDumpValue {
    let raw_value = match row.try_get_raw(i) {
        Ok(value) => value,
        Err(_) => return SqlDumpValue::Null,
    };

    if raw_value.is_null() {
        return SqlDumpValue::Null;
    }

    let type_name = raw_value.type_info().name().to_uppercase();

    // Integer types → emit as unquoted numbers
    if matches!(
        type_name.as_str(),
        "TINYINT" | "SHORT" | "LONG" | "INT24" | "LONGLONG"
    ) || type_name.contains("INT")
        || type_name == "YEAR"
    {
        if let Ok(Some(v)) = row.try_get::<Option<i64>, _>(i) {
            return SqlDumpValue::Int(v);
        }
        if let Ok(Some(v)) = row.try_get::<Option<u64>, _>(i) {
            return SqlDumpValue::UInt(v);
        }
        // Fallback: read as string
        if let Some(s) = decode_dump_string(row, i, &raw_value) {
            return SqlDumpValue::Decimal(s);
        }
    }

    // Float/Double → emit as unquoted numbers
    if type_name.contains("FLOAT") || type_name.contains("DOUBLE") {
        if let Ok(Some(v)) = row.try_get::<Option<f64>, _>(i) {
            return SqlDumpValue::Float(v);
        }
    }

    // DECIMAL/NUMERIC → emit as unquoted numeric string (preserves precision)
    if type_name.contains("DECIMAL") || type_name.contains("NUMERIC") {
        if let Ok(Some(s)) = row.try_get::<Option<String>, _>(i) {
            return SqlDumpValue::Decimal(s);
        }
        if let Some(s) = decode_dump_string(row, i, &raw_value) {
            return SqlDumpValue::Decimal(s);
        }
    }

    // BIT type → emit as integer
    if type_name == "BIT" {
        if let Ok(Some(v)) = row.try_get::<Option<u64>, _>(i) {
            return SqlDumpValue::UInt(v);
        }
        // Fallback: try as bytes and interpret
        if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(i) {
            let mut val: u64 = 0;
            for b in &bytes {
                val = (val << 8) | (*b as u64);
            }
            return SqlDumpValue::UInt(val);
        }
    }

    // Binary types → emit as hex literal
    if type_name.contains("BLOB")
        || type_name == "BINARY"
        || type_name == "VARBINARY"
        || type_name == "GEOMETRY"
    {
        if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(i) {
            return SqlDumpValue::HexBytes(bytes);
        }
        tracing::warn!(
            column_index = i,
            column_type = %type_name,
            "Unrepresentable binary value in SQL dump, emitting NULL"
        );
        return SqlDumpValue::Null;
    }

    // Date/time types → emit as quoted string, preserving the original format
    if matches!(
        type_name.as_str(),
        "DATE" | "DATETIME" | "TIMESTAMP" | "TIME" | "NEWDATE"
    ) {
        if let Some(s) = serialize_dump_temporal(raw_value.clone()) {
            return SqlDumpValue::QuotedString(s);
        }
    }

    // Default: everything else (VARCHAR, TEXT, ENUM, SET, JSON, etc.) → quoted string
    match row.try_get::<Option<String>, _>(i) {
        Ok(Some(s)) => SqlDumpValue::QuotedString(s),
        Ok(None) => SqlDumpValue::Null,
        Err(_) => {
            // Last resort: try to decode raw bytes as UTF-8
            if let Some(s) = decode_dump_string(row, i, &raw_value) {
                SqlDumpValue::QuotedString(s)
            } else {
                tracing::warn!(
                    column_index = i,
                    column_type = %type_name,
                    "Undecodable value in SQL dump, emitting NULL"
                );
                SqlDumpValue::Null
            }
        }
    }
}

/// Try multiple ways to decode a cell as a string (unchecked, then raw bytes).
fn decode_dump_string(
    row: &sqlx::mysql::MySqlRow,
    i: usize,
    raw: &MySqlValueRef<'_>,
) -> Option<String> {
    // Try unchecked string (bypasses type checking)
    if let Ok(Some(s)) = row.try_get_unchecked::<Option<String>, _>(i) {
        return Some(s);
    }
    // Try unchecked bytes → lossy UTF-8
    if let Ok(Some(bytes)) = row.try_get_unchecked::<Option<Vec<u8>>, _>(i) {
        return Some(String::from_utf8_lossy(&bytes).into_owned());
    }
    // Try decoding via Value trait
    let owned = sqlx::ValueRef::to_owned(raw);
    if let Ok(text) = owned.try_decode::<String>() {
        return Some(text);
    }
    let owned = sqlx::ValueRef::to_owned(raw);
    owned
        .try_decode::<Vec<u8>>()
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

/// Serialize a temporal (date/time) column value to its string representation.
fn serialize_dump_temporal(value: MySqlValueRef<'_>) -> Option<String> {
    use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
    use sqlx::mysql::types::MySqlTime;

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(v) = owned.try_decode::<NaiveDateTime>() {
        return Some(v.to_string());
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(v) = owned.try_decode::<DateTime<Utc>>() {
        return Some(v.naive_utc().to_string());
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(v) = owned.try_decode::<NaiveDate>() {
        return Some(v.to_string());
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(v) = owned.try_decode::<MySqlTime>() {
        let sign = if v.sign().is_negative() { "-" } else { "" };
        let hours = v.hours();
        return Some(if v.microseconds() == 0 {
            format!("{sign}{hours:02}:{:02}:{:02}", v.minutes(), v.seconds())
        } else {
            format!(
                "{sign}{hours:02}:{:02}:{:02}.{:06}",
                v.minutes(),
                v.seconds(),
                v.microseconds()
            )
        });
    }

    // Last resort: raw string decode
    sqlx::ValueRef::to_owned(&value).try_decode::<String>().ok()
}

// ---------------------------------------------------------------------------
// Thin Tauri command wrappers
// ---------------------------------------------------------------------------

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_exportable_objects(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<ExportableDatabase>, String> {
    list_exportable_objects_impl(&state, &connection_id).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn start_sql_dump(
    state: tauri::State<'_, AppState>,
    input: StartDumpInput,
) -> Result<String, String> {
    let pool = state
        .registry
        .get_pool(&input.connection_id)
        .ok_or_else(|| format!("Connection '{}' not found", input.connection_id))?;

    start_sql_dump_impl(&state, input, &state.dump_jobs, pool).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_dump_progress(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<DumpJobProgress, String> {
    get_dump_progress_impl(&state, &job_id)
}

// Coverage stubs
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

// ---------------------------------------------------------------------------
// SQL Import commands
// ---------------------------------------------------------------------------

/// Input for starting a SQL import job.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartImportInput {
    pub connection_id: String,
    pub file_path: String,
    pub stop_on_error: bool,
}

/// Start a SQL import job. Returns the job ID for progress tracking.
///
/// The actual import runs on a background task. The caller polls `get_import_progress_impl`
/// to check status.
pub async fn start_sql_import_impl(
    state: &AppState,
    input: StartImportInput,
    import_jobs: &std::sync::Arc<std::sync::RwLock<HashMap<String, ImportJobProgress>>>,
    pool: sqlx::MySqlPool,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    // Resolve the profile/connection id for history logging
    let connection_id = state
        .registry
        .get_profile_id(&input.connection_id)
        .unwrap_or_else(|| input.connection_id.clone());
    let db = std::sync::Arc::clone(&state.db);

    // Initialize progress
    let progress = ImportJobProgress {
        job_id: job_id.clone(),
        status: ImportJobStatus::Running,
        statements_total: 0, // Will be updated once file is parsed
        statements_done: 0,
        errors: Vec::new(),
        stop_on_error: input.stop_on_error,
        cancel_requested: false,
        completed_at: None,
    };

    {
        let mut jobs = import_jobs.write().map_err(|e| e.to_string())?;
        // Clean up stale terminal jobs (older than 5 minutes)
        cleanup_stale_import_jobs(&mut jobs);
        jobs.insert(job_id.clone(), progress);
    }

    let job_id_clone = job_id.clone();
    let file_path = input.file_path.clone();
    let stop_on_error = input.stop_on_error;

    let import_jobs_arc = std::sync::Arc::clone(import_jobs);

    tokio::task::spawn_blocking(move || {
        let result = sql_import::execute_sql_import(
            &pool,
            &file_path,
            stop_on_error,
            &job_id_clone,
            &import_jobs_arc,
            &db,
            &connection_id,
        );

        // If the execution function itself returned an error (e.g. file read failure),
        // mark the job as failed.
        if let Err(err) = result {
            let mut jobs = import_jobs_arc.write().unwrap_or_else(|p| p.into_inner());
            if let Some(progress) = jobs.get_mut(&job_id_clone) {
                if progress.status == ImportJobStatus::Running {
                    progress.status = ImportJobStatus::Failed;
                    progress.errors.push(crate::state::ImportError {
                        statement_index: 0,
                        sql_preview: String::new(),
                        error_message: err,
                    });
                    progress.completed_at = Some(std::time::SystemTime::now());
                }
            }
        }
    });

    Ok(job_id)
}

/// Get progress of an import job.
pub fn get_import_progress_impl(
    state: &AppState,
    job_id: &str,
) -> Result<ImportJobProgress, String> {
    let mut jobs = state.import_jobs.write().map_err(|e| e.to_string())?;
    // Lazy cleanup: remove terminal jobs older than 5 minutes
    cleanup_stale_import_jobs(&mut jobs);
    jobs.get(job_id)
        .cloned()
        .ok_or_else(|| format!("Import job '{job_id}' not found"))
}

/// Duration after which terminal import jobs are cleaned up.
const IMPORT_JOB_STALE_DURATION: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// Remove terminal import jobs whose `completed_at` is older than 5 minutes.
fn cleanup_stale_import_jobs(jobs: &mut HashMap<String, ImportJobProgress>) {
    jobs.retain(|_, progress| {
        if let Some(completed_at) = progress.completed_at {
            match std::time::SystemTime::now().duration_since(completed_at) {
                Ok(age) => {
                    age < IMPORT_JOB_STALE_DURATION
                }
                Err(_) => {
                    true
                }
            }
        } else {
            true // Running jobs are always kept
        }
    });
}

/// Cancel an import job.
pub fn cancel_import_impl(state: &AppState, job_id: &str) -> Result<(), String> {
    let mut jobs = state.import_jobs.write().map_err(|e| e.to_string())?;
    match jobs.get_mut(job_id) {
        Some(progress) => {
            progress.cancel_requested = true;
            Ok(())
        }
        None => Err(format!("Import job '{job_id}' not found")),
    }
}

// ---------------------------------------------------------------------------
// Thin Tauri command wrappers — SQL Import
// ---------------------------------------------------------------------------

#[cfg(not(coverage))]
#[tauri::command]
pub async fn start_sql_import(
    state: tauri::State<'_, AppState>,
    input: StartImportInput,
) -> Result<String, String> {
    // Guard against read-only connections
    if state.registry.is_read_only(&input.connection_id) {
        return Err("Cannot import SQL on a read-only connection".to_string());
    }

    let pool = state
        .registry
        .get_pool(&input.connection_id)
        .ok_or_else(|| format!("Connection '{}' not found", input.connection_id))?;

    start_sql_import_impl(&state, input, &state.import_jobs, pool).await
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

// Coverage stubs — SQL Import
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
