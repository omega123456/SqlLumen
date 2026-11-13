//! Tauri commands for SQL dump export — listing exportable objects,
//! starting a dump job, and checking progress.
//! Also includes SQL import commands for executing .sql script files.

use futures::stream::StreamExt;
use futures::TryStreamExt;
use serde::{Deserialize, Serialize};
use sqlx::mysql::MySqlValueRef;
use sqlx::{Column, Row, TypeInfo, Value, ValueRef};
use std::collections::HashMap;
use std::io::{Seek, Write};

use crate::export::job_retention::cleanup_terminal_jobs;
use crate::export::sql_dump::{self, DumpOptions, SqlDumpValue, INSERT_BATCH_SIZE};
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

/// The closed set of supported SQL dump object categories.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DumpObjectType {
    Table,
    View,
}

/// A table or view available for export.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportableTable {
    pub name: String,
    pub object_type: DumpObjectType,
    pub estimated_rows: u64,
}

/// A selected table or view in the dump-start input.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpTableEntry {
    pub name: String,
    pub object_type: DumpObjectType,
}

/// Input for starting a SQL dump export job.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDumpInput {
    pub connection_id: String,
    pub file_path: String,
    pub databases: Vec<String>,
    /// Map of database name → list of selected object entries.
    /// Each entry carries the object name and its type (table or view).
    /// Empty maps are accepted but result in no work (no objects exported).
    pub tables: HashMap<String, Vec<DumpTableEntry>>,
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

    // Consolidated metadata query: retrieve all non-system schemas and their
    // optional table/view metadata in a single round trip.
    let metadata_query = "\
        SELECT s.SCHEMA_NAME, t.TABLE_NAME, t.TABLE_TYPE, t.TABLE_ROWS \
        FROM information_schema.SCHEMATA s \
        LEFT JOIN information_schema.TABLES t \
          ON t.TABLE_SCHEMA = s.SCHEMA_NAME \
        WHERE s.SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
        ORDER BY s.SCHEMA_NAME, t.TABLE_NAME";

    crate::mysql::query_log::log_outgoing_sql(metadata_query);

    let rows = sqlx::query(metadata_query)
        .fetch_all(&pool)
        .await
        .map_err(|error| format!("Failed to list exportable objects: {error}"))?;

    // Group rows by schema name, preserving deterministic ordering.
    let mut result: Vec<ExportableDatabase> = Vec::new();
    let mut current_db: Option<String> = None;

    for row in &rows {
        let schema_name: String =
            decode_mysql_text_cell_named(row, "SCHEMA_NAME").unwrap_or_default();

        let starts_new_database = current_db.as_deref() != Some(&schema_name);
        if starts_new_database {
            current_db = Some(schema_name.clone());
            result.push(ExportableDatabase {
                name: schema_name.clone(),
                tables: Vec::new(),
            });
        }

        // LEFT JOIN produces NULL TABLE_NAME for empty databases
        let table_name: Option<String> = decode_mysql_text_cell_named(row, "TABLE_NAME").ok();
        if let Some(name) = table_name {
            if name.is_empty() {
                continue;
            }
            let table_type: String =
                decode_mysql_text_cell_named(row, "TABLE_TYPE").unwrap_or_default();
            let estimated_rows: i64 = row.try_get("TABLE_ROWS").unwrap_or(0);
            let object_type = dump_object_type(&table_type);
            if let Some(db) = result.last_mut() {
                db.tables.push(ExportableTable {
                    name,
                    object_type,
                    estimated_rows: estimated_rows.max(0) as u64,
                });
            }
        }
    }

    Ok(result)
}

pub type DumpJobMap = std::sync::Arc<std::sync::RwLock<HashMap<String, DumpJobProgress>>>;

#[derive(Clone, Copy)]
pub struct DumpJob<'a> {
    pub jobs: &'a DumpJobMap,
    pub job_id: &'a str,
}

impl DumpJob<'_> {
    fn is_cancel_requested(&self) -> bool {
        is_cancel_requested(self.jobs, self.job_id)
    }

    fn update_progress(&self, update: impl FnOnce(&mut DumpJobProgress)) {
        let mut jobs = self
            .jobs
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(progress) = jobs.get_mut(self.job_id) {
            update(progress);
        }
    }
}

pub struct DumpTarget<'a, W> {
    pub file: &'a mut W,
    pub table_name: &'a str,
    pub columns: &'a [String],
    pub job: DumpJob<'a>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelDumpRequest {
    pub job_id: String,
    pub connection_id: String,
}

pub async fn start_sql_dump_impl(
    state: &AppState,
    input: StartDumpInput,
    pool: sqlx::MySqlPool,
) -> Result<String, String> {
    let dump_jobs = &state.dump_jobs;
    // Validate all selected object types before creating any job or side effects.
    for (db_name, entries) in &input.tables {
        for entry in entries {
            match entry.object_type {
                DumpObjectType::Table | DumpObjectType::View => {}
            }
            // Serde already rejects unknown variants, but the match ensures
            // compile-time coverage of the closed enum.
            let _ = (db_name, &entry.name);
        }
    }

    let job_id = uuid::Uuid::new_v4().to_string();

    // Count total objects to export
    let total_tables: usize = input
        .databases
        .iter()
        .map(|db| input.tables.get(db).map(|tables| tables.len()).unwrap_or(0))
        .sum();

    // Initialize progress
    let progress = DumpJobProgress {
        job_id: job_id.clone(),
        status: DumpJobStatus::Running,
        tables_total: total_tables,
        tables_done: 0,
        current_table: None,
        bytes_written: 0,
        rows_exported: 0,
        error_message: None,
        cancel_requested: false,
        mysql_thread_id: None,
        completed_at: None,
    };

    {
        let mut jobs = dump_jobs.write().map_err(|error| error.to_string())?;
        // Clean up stale terminal jobs (older than 5 minutes)
        cleanup_terminal_jobs(&mut jobs);
        jobs.insert(job_id.clone(), progress);
    }

    // Clone what we need for the background task
    let job_id_clone = job_id.clone();
    let dump_jobs_arc = std::sync::Arc::clone(dump_jobs);

    tokio::task::spawn_blocking(move || {
        let job = DumpJob {
            jobs: &dump_jobs_arc,
            job_id: &job_id_clone,
        };
        let result = execute_dump(&pool, &input, job);

        let mut jobs = dump_jobs_arc
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(progress) = jobs.get_mut(&job_id_clone) {
            finish_dump_job(progress, result);
        }
    });

    Ok(job_id)
}

fn dump_object_type(table_type: &str) -> DumpObjectType {
    if table_type.contains("VIEW") {
        return DumpObjectType::View;
    }
    DumpObjectType::Table
}

fn finish_dump_job(progress: &mut DumpJobProgress, result: Result<u64, String>) {
    progress.current_table = None;
    progress.completed_at = Some(std::time::SystemTime::now());
    if let Ok(bytes) = result {
        progress.bytes_written = bytes;
    }
    if progress.cancel_requested {
        progress.status = DumpJobStatus::Cancelled;
        return;
    }
    match result {
        Ok(_) => progress.status = DumpJobStatus::Completed,
        Err(error) => {
            progress.status = DumpJobStatus::Failed;
            progress.error_message = Some(error);
        }
    }
}

fn execute_dump(
    pool: &sqlx::MySqlPool,
    input: &StartDumpInput,
    job: DumpJob<'_>,
) -> Result<u64, String> {
    let dump_jobs = job.jobs;
    let job_id = job.job_id;
    let rt = tokio::runtime::Handle::try_current()
        .map_err(|error| format!("No tokio runtime: {error}"))?;

    let mut file = std::fs::File::create(&input.file_path)
        .map_err(|error| format!("Failed to create file '{}': {error}", input.file_path))?;

    // Get server version
    let server_version: String = rt.block_on(async {
        let row = sqlx::query("SELECT VERSION()")
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Failed to get server version: {error}"))?;
        decode_mysql_text_cell(&row, 0)
    })?;

    // Determine a representative database name for the header
    let header_db = input
        .databases
        .first()
        .map(|text| text.as_str())
        .unwrap_or("mysql");

    sql_dump::write_header(&mut file, header_db, &server_version)
        .map_err(|error| format!("Failed to write header: {error}"))?;

    if input.options.use_transaction {
        sql_dump::write_transaction_start(&mut file)
            .map_err(|error| format!("Failed to write transaction start: {error}"))?;
    }

    let mut tables_done: usize = 0;
    let mut cancelled = false;

    let table_loop_result: Result<(), String> = (|| {
        for db_name in &input.databases {
            let entry_list = input.tables.get(db_name).cloned().unwrap_or_default();
            if entry_list.is_empty() {
                continue;
            }

            // USE database
            writeln!(file, "USE `{}`;", sql_dump::escape_identifier(db_name))
                .map_err(|error| format!("Write error: {error}"))?;
            writeln!(file).map_err(|error| format!("Write error: {error}"))?;

            for entry in &entry_list {
                let table_name = &entry.name;
                let is_view = entry.object_type == DumpObjectType::View;

                // Update progress
                {
                    let mut jobs = dump_jobs
                        .write()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    if let Some(progress) = jobs.get_mut(job_id) {
                        progress.current_table = Some(format!("{}.{}", db_name, table_name));
                    }
                }

                // Get CREATE statement
                if input.options.include_structure {
                    let object_keyword = sql_dump::dump_object_keyword(is_view);
                    let create_sql = rt.block_on(async {
                        let query = format!(
                            "SHOW CREATE {object_keyword} `{}`.`{}`",
                            sql_dump::escape_identifier(db_name),
                            sql_dump::escape_identifier(table_name)
                        );
                        let row = sqlx::query(sqlx::AssertSqlSafe(query.as_str()))
                            .fetch_one(pool)
                            .await
                            .map_err(|error| {
                                format!(
                                    "Failed to get CREATE {object_keyword} for '{table_name}': {error}"
                                )
                            })?;
                        decode_mysql_text_cell(&row, 1)
                    })?;

                    let structure = sql_dump::DumpStructure {
                        table_name,
                        create_sql: &create_sql,
                        include_drop: input.options.include_drop,
                        is_view,
                    };
                    sql_dump::write_structure(&mut file, &structure).map_err(|error| {
                        format!("Failed to write structure for '{table_name}': {error}")
                    })?;
                }

                // Check for cancellation before starting data fetch
                if is_cancel_requested(dump_jobs, job_id) {
                    cancelled = true;
                    return Ok(());
                }

                let should_dump_rows = input.options.include_data && !is_view;
                if should_dump_rows {
                    rt.block_on(async {
                        let data_query = format!(
                            "SELECT * FROM `{}`.`{}`",
                            sql_dump::escape_identifier(db_name),
                            sql_dump::escape_identifier(table_name)
                        );

                        // Acquire a dedicated connection so we can track its thread ID for KILL QUERY
                        let mut conn = pool
                            .acquire()
                            .await
                            .map_err(|error| format!("Failed to acquire connection: {error}"))?;

                        let thread_id: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()")
                            .fetch_one(&mut *conn)
                            .await
                            .map_err(|error| format!("Failed to get connection ID: {error}"))?;

                        {
                            let mut jobs = dump_jobs
                                .write()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            if let Some(progress) = jobs.get_mut(job_id) {
                                progress.mysql_thread_id = Some(thread_id);
                            }
                        }

                        // Use fetch() for streaming on the dedicated connection
                        let mut stream =
                            sqlx::query(sqlx::AssertSqlSafe(data_query.as_str())).fetch(&mut *conn);

                        // Extract column names from the first row
                        let first_row = stream.try_next().await.map_err(|error| {
                            format!("Failed to fetch data from '{table_name}': {error}")
                        })?;

                        let first_row = match first_row {
                            Some(row) => row,
                            None => {
                                // Clear thread ID — no longer running a query
                                let mut jobs = dump_jobs
                                    .write()
                                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                                if let Some(progress) = jobs.get_mut(job_id) {
                                    progress.mysql_thread_id = None;
                                }
                                return Ok::<_, String>(()); // Empty table
                            }
                        };

                        let columns: Vec<String> = first_row
                            .columns()
                            .iter()
                            .map(|column| column.name().to_string())
                            .collect();

                        // Chain the first row back with the rest of the stream
                        let first_row_stream = futures::stream::once(async { Ok(first_row) });
                        let full_stream = Box::pin(first_row_stream.chain(stream));

                        let target = DumpTarget {
                            file: &mut file,
                            table_name,
                            columns: &columns,
                            job,
                        };
                        let result =
                            stream_to_dump(full_stream, target, |row: &sqlx::mysql::MySqlRow| {
                                (0..row.columns().len())
                                    .map(|column_index| serialize_dump_value(row, column_index))
                                    .collect()
                            })
                            .await;

                        // Clear thread ID — query is done
                        {
                            let mut jobs = dump_jobs
                                .write()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            if let Some(progress) = jobs.get_mut(job_id) {
                                progress.mysql_thread_id = None;
                            }
                        }

                        result.map_err(|error| {
                            format!("Failed to write data for '{table_name}': {error}")
                        })?;

                        Ok::<_, String>(())
                    })?;
                }

                tables_done += 1;

                // Update progress
                {
                    let mut jobs = dump_jobs
                        .write()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    if let Some(progress) = jobs.get_mut(job_id) {
                        progress.tables_done = tables_done;
                        progress.rows_exported = 0;
                    }
                }

                // Check for cancellation after each table
                if is_cancel_requested(dump_jobs, job_id) {
                    cancelled = true;
                    return Ok(());
                }
            }
        }
        Ok(())
    })();

    // Always write transaction end + footer + flush, even after cancellation.
    // This ensures the dump file is well-formed (COMMIT, FK checks restored).
    // Propagate the first error encountered.
    let mut first_error = table_loop_result.err();

    if input.options.use_transaction {
        if let Err(error) = sql_dump::write_transaction_end(&mut file) {
            first_error.get_or_insert(format!("Failed to write transaction end: {error}"));
        }
    }

    if let Err(error) = sql_dump::write_footer(&mut file) {
        first_error.get_or_insert(format!("Failed to write footer: {error}"));
    }

    if let Err(error) = file.flush() {
        first_error.get_or_insert(format!("Failed to flush file: {error}"));
    }

    if let Some(error) = first_error {
        return Err(error);
    }

    let metadata = std::fs::metadata(&input.file_path)
        .map_err(|error| format!("Failed to read file size: {error}"))?;

    // Store the cancelled flag so the completion handler can check it
    if cancelled {
        let mut jobs = dump_jobs
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(progress) = jobs.get_mut(job_id) {
            progress.cancel_requested = true;
        }
    }

    Ok(metadata.len())
}

struct TableInsertWriter<'a> {
    table_name: &'a str,
    escaped_table: String,
    col_list: String,
    job: DumpJob<'a>,
    header_written: bool,
    total_rows: u64,
}

impl<'a> TableInsertWriter<'a> {
    fn new(table_name: &'a str, columns: &[String], job: DumpJob<'a>) -> Self {
        let col_list = columns
            .iter()
            .map(|column| format!("`{}`", sql_dump::escape_identifier(column)))
            .collect::<Vec<_>>()
            .join(", ");
        Self {
            table_name,
            escaped_table: sql_dump::escape_identifier(table_name),
            col_list,
            job,
            header_written: false,
            total_rows: 0,
        }
    }

    fn flush_batch<W: Write + Seek>(
        &mut self,
        file: &mut W,
        batch: &[Vec<SqlDumpValue>],
    ) -> Result<(), String> {
        self.total_rows += batch.len() as u64;
        if !self.header_written {
            self.write_header(file)?;
        }

        let insert_target = sql_dump::InsertTarget {
            escaped_table: &self.escaped_table,
            col_list: &self.col_list,
        };
        sql_dump::write_insert_batch(file, &insert_target, batch)
            .map_err(|error| format!("Write error: {error}"))?;

        let pos = file
            .stream_position()
            .map_err(|error| format!("Seek error: {error}"))?;
        let total_rows = self.total_rows;
        self.job.update_progress(|progress| {
            progress.bytes_written = pos;
            progress.rows_exported = total_rows;
        });
        Ok(())
    }

    fn write_header<W: Write>(&mut self, file: &mut W) -> Result<(), String> {
        writeln!(file, "--").map_err(|error| format!("Write error: {error}"))?;
        writeln!(
            file,
            "-- Data for `{}`",
            sql_dump::escape_identifier(self.table_name)
        )
        .map_err(|error| format!("Write error: {error}"))?;
        writeln!(file, "--").map_err(|error| format!("Write error: {error}"))?;
        writeln!(file).map_err(|error| format!("Write error: {error}"))?;
        writeln!(file, "LOCK TABLES `{}` WRITE;", self.escaped_table)
            .map_err(|error| format!("Write error: {error}"))?;
        self.header_written = true;
        Ok(())
    }
}

/// Stream rows from a `TryStream`, batch them, and write INSERT statements to the dump file.
///
/// This is the core streaming helper that replaces the old `fetch_all` + `write_data_inserts`
/// approach. It writes LOCK TABLE once before the first batch, calls
/// [`write_insert_batch`](sql_dump::write_insert_batch) per batch, and writes UNLOCK TABLE
/// once after the last batch. Progress is updated after each batch flush.
///
/// Generic over the row type `R` so that tests can use `Vec<SqlDumpValue>` directly
/// without constructing `MySqlRow`.
pub async fn stream_to_dump<R, S, F, W>(
    mut stream: S,
    target: DumpTarget<'_, W>,
    serialize: F,
) -> Result<(), String>
where
    S: futures::TryStream<Ok = R, Error = sqlx::Error> + Unpin,
    F: Fn(&R) -> Vec<SqlDumpValue>,
    W: Write + Seek,
{
    let DumpTarget {
        file,
        table_name,
        columns,
        job,
    } = target;
    if columns.is_empty() {
        return Ok(());
    }

    let mut batch: Vec<Vec<SqlDumpValue>> = Vec::with_capacity(INSERT_BATCH_SIZE);
    let mut insert_writer = TableInsertWriter::new(table_name, columns, job);

    let loop_result: Result<(), String> = async {
        loop {
            let row = stream
                .try_next()
                .await
                .map_err(|error| format!("Stream error for '{table_name}': {error}"))?;

            match row {
                Some(row) => {
                    batch.push(serialize(&row));

                    let is_batch_full = batch.len() >= INSERT_BATCH_SIZE;
                    if is_batch_full {
                        insert_writer.flush_batch(file, &batch)?;
                        batch.clear();

                        if job.is_cancel_requested() {
                            break;
                        }
                    }
                }
                None => {
                    // Stream exhausted — flush remainder
                    if !batch.is_empty() {
                        insert_writer.flush_batch(file, &batch)?;
                        batch.clear();
                    }

                    break;
                }
            }
        }
        Ok(())
    }
    .await;

    // Always write UNLOCK if LOCK was written, regardless of success or error
    if insert_writer.header_written {
        writeln!(file, "UNLOCK TABLES;").map_err(|error| format!("Write error: {error}"))?;
        writeln!(file).map_err(|error| format!("Write error: {error}"))?;
    }

    loop_result
}

/// Get progress of a dump job.
pub fn get_dump_progress_impl(state: &AppState, job_id: &str) -> Result<DumpJobProgress, String> {
    let mut jobs = state.dump_jobs.write().map_err(|error| error.to_string())?;
    // Lazy cleanup: remove terminal jobs older than 5 minutes
    cleanup_terminal_jobs(&mut jobs);
    jobs.get(job_id)
        .cloned()
        .ok_or_else(|| format!("Dump job '{job_id}' not found"))
}

/// Cancel a running dump job. Sets `cancel_requested` and issues `KILL QUERY`
/// if a MySQL thread is actively fetching data.
pub async fn cancel_dump_impl(state: &AppState, request: &CancelDumpRequest) -> Result<(), String> {
    let job_id = request.job_id.as_str();
    let connection_id = request.connection_id.as_str();
    let thread_id = {
        let mut jobs = state.dump_jobs.write().map_err(|error| error.to_string())?;
        match jobs.get_mut(job_id) {
            Some(progress) => {
                progress.cancel_requested = true;
                progress.mysql_thread_id
            }
            None => return Err(format!("Dump job '{job_id}' not found")),
        }
    };

    if let Some(tid) = thread_id {
        let pool = state
            .registry
            .get_pool(connection_id)
            .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

        // Re-check that the thread ID is still active before issuing KILL QUERY
        // to avoid killing an unrelated query that reused the connection.
        let still_active = {
            let jobs = state.dump_jobs.read().map_err(|error| error.to_string())?;
            jobs.get(job_id)
                .and_then(|job| job.mysql_thread_id)
                .map(|current_tid| current_tid == tid)
                .unwrap_or(false)
        };

        if still_active {
            let kill_sql = format!("KILL QUERY {}", tid);
            tracing::debug!(job_id, thread_id = tid, "cancel_dump: issuing KILL QUERY");
            crate::mysql::query_log::log_outgoing_sql(&kill_sql);
            if let Err(error) = sqlx::query(sqlx::AssertSqlSafe(kill_sql.as_str()))
                .execute(&pool)
                .await
            {
                tracing::warn!(job_id, error = %error, "KILL QUERY failed during dump cancel");
            }
        }
    }

    Ok(())
}

/// Check if cancellation has been requested for a dump job.
fn is_cancel_requested(
    dump_jobs: &std::sync::Arc<std::sync::RwLock<HashMap<String, DumpJobProgress>>>,
    job_id: &str,
) -> bool {
    let jobs = dump_jobs
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    jobs.get(job_id)
        .map(|job| job.cancel_requested)
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Type-aware value serialization for SQL dumps
// ---------------------------------------------------------------------------

/// Serialize a single cell from a MySQL result row into a [`SqlDumpValue`],
/// using the column's type metadata to choose the correct representation.
///
/// This avoids the old bug where every cell was read as `Option<String>` and
/// then parsed back into a number (destroying leading zeros, failing on BLOBs, etc.).
pub fn serialize_dump_value(row: &sqlx::mysql::MySqlRow, column_index: usize) -> SqlDumpValue {
    let raw_value = match row.try_get_raw(column_index) {
        Ok(value) => value,
        Err(_) => return SqlDumpValue::Null,
    };

    if raw_value.is_null() {
        return SqlDumpValue::Null;
    }

    let type_name = raw_value.type_info().name().to_uppercase();

    if crate::mysql::sqlx_type_names::is_sqlx_integer_type_name(&type_name) {
        if let Ok(Some(value)) = row.try_get::<Option<i64>, _>(column_index) {
            return SqlDumpValue::Int(value);
        }
        if let Ok(Some(value)) = row.try_get::<Option<u64>, _>(column_index) {
            return SqlDumpValue::UInt(value);
        }
        // Fallback: read as string
        if let Some(text) = decode_dump_string(row, column_index, &raw_value) {
            return SqlDumpValue::Decimal(text);
        }
    }

    // Float/Double → emit as unquoted numbers
    if crate::mysql::sqlx_type_names::is_sqlx_float_type_name(&type_name) {
        if let Ok(Some(value)) = row.try_get::<Option<f64>, _>(column_index) {
            return SqlDumpValue::Float(value);
        }
    }

    // DECIMAL/NUMERIC → emit as unquoted numeric string (preserves precision)
    if crate::mysql::sqlx_type_names::is_sqlx_decimal_type_name(&type_name) {
        if let Ok(Some(text)) = row.try_get::<Option<String>, _>(column_index) {
            return SqlDumpValue::Decimal(text);
        }
        if let Some(text) = decode_dump_string(row, column_index, &raw_value) {
            return SqlDumpValue::Decimal(text);
        }
    }

    // BIT type → emit as integer
    if type_name == "BIT" {
        if let Ok(Some(value)) = row.try_get::<Option<u64>, _>(column_index) {
            return SqlDumpValue::UInt(value);
        }
        // Fallback: try as bytes and interpret
        if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(column_index) {
            let mut value: u64 = 0;
            for byte in &bytes {
                value = (value << 8) | (*byte as u64);
            }
            return SqlDumpValue::UInt(value);
        }
    }

    // Binary types → emit as hex literal
    let is_hex_dumped_type = crate::mysql::sqlx_type_names::is_sqlx_binary_type_name(&type_name)
        || type_name == "GEOMETRY";
    if is_hex_dumped_type {
        if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(column_index) {
            return SqlDumpValue::HexBytes(bytes);
        }
        tracing::warn!(
            column_index = column_index,
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
        if let Some(text) = serialize_dump_temporal(raw_value.clone()) {
            return SqlDumpValue::QuotedString(text);
        }
    }

    // Default: everything else (VARCHAR, TEXT, ENUM, SET, JSON, etc.) → quoted string
    match row.try_get::<Option<String>, _>(column_index) {
        Ok(Some(text)) => SqlDumpValue::QuotedString(text),
        Ok(None) => SqlDumpValue::Null,
        Err(_) => match decode_dump_string(row, column_index, &raw_value) {
            Some(text) => SqlDumpValue::QuotedString(text),
            None => {
                tracing::warn!(
                    column_index = column_index,
                    column_type = %type_name,
                    "Undecodable value in SQL dump, emitting NULL"
                );
                SqlDumpValue::Null
            }
        },
    }
}

/// Try multiple ways to decode a cell as a string (unchecked, then raw bytes).
fn decode_dump_string(
    row: &sqlx::mysql::MySqlRow,
    column_index: usize,
    raw: &MySqlValueRef<'_>,
) -> Option<String> {
    // Try unchecked string (bypasses type checking)
    if let Ok(Some(text)) = row.try_get_unchecked::<Option<String>, _>(column_index) {
        return Some(text);
    }
    // Try unchecked bytes → lossy UTF-8
    if let Ok(Some(bytes)) = row.try_get_unchecked::<Option<Vec<u8>>, _>(column_index) {
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
    if let Ok(value) = owned.try_decode::<NaiveDateTime>() {
        return Some(value.to_string());
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(value) = owned.try_decode::<DateTime<Utc>>() {
        return Some(value.naive_utc().to_string());
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(value) = owned.try_decode::<NaiveDate>() {
        return Some(value.to_string());
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(value) = owned.try_decode::<MySqlTime>() {
        return Some(crate::mysql::query_log::format_mysql_time(value));
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

    start_sql_dump_impl(&state, input, pool).await
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

#[cfg(coverage)]
#[tauri::command]
pub async fn cancel_dump(
    _state: tauri::State<'_, AppState>,
    _payload: CancelDumpRequest,
) -> Result<(), String> {
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
    pool: sqlx::MySqlPool,
) -> Result<String, String> {
    let import_jobs = &state.import_jobs;
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
        let mut jobs = import_jobs.write().map_err(|error| error.to_string())?;
        // Clean up stale terminal jobs (older than 5 minutes)
        cleanup_terminal_jobs(&mut jobs);
        jobs.insert(job_id.clone(), progress);
    }

    let job_id_clone = job_id.clone();
    let file_path = input.file_path.clone();
    let stop_on_error = input.stop_on_error;

    let import_jobs_arc = std::sync::Arc::clone(import_jobs);

    tokio::task::spawn_blocking(move || {
        let import_job = sql_import::SqlImportJob {
            file_path: &file_path,
            stop_on_error,
            job_id: &job_id_clone,
            import_jobs: &import_jobs_arc,
            history_db: &db,
            connection_id: &connection_id,
        };
        let result = sql_import::execute_sql_import(&pool, &import_job);

        // If the execution function itself returned an error (e.g. file read failure),
        // mark the job as failed.
        if let Err(error) = result {
            let mut jobs = import_jobs_arc
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(progress) = jobs.get_mut(&job_id_clone) {
                if progress.status == ImportJobStatus::Running {
                    progress.status = ImportJobStatus::Failed;
                    progress.errors.push(crate::state::ImportError {
                        statement_index: 0,
                        sql_preview: String::new(),
                        error_message: error,
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
    let mut jobs = state
        .import_jobs
        .write()
        .map_err(|error| error.to_string())?;
    // Lazy cleanup: remove terminal jobs older than 5 minutes
    cleanup_terminal_jobs(&mut jobs);
    jobs.get(job_id)
        .cloned()
        .ok_or_else(|| format!("Import job '{job_id}' not found"))
}

/// Cancel an import job.
pub fn cancel_import_impl(state: &AppState, job_id: &str) -> Result<(), String> {
    let mut jobs = state
        .import_jobs
        .write()
        .map_err(|error| error.to_string())?;
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

    start_sql_import_impl(&state, input, pool).await
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
