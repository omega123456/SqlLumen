use super::*;

pub type DumpJobMap = std::sync::Arc<std::sync::RwLock<HashMap<String, DumpJobProgress>>>;

#[derive(Clone, Copy)]
pub struct DumpJob<'a> {
    pub jobs: &'a DumpJobMap,
    pub job_id: &'a str,
}

impl DumpJob<'_> {
    pub(super) fn is_cancel_requested(&self) -> bool {
        is_cancel_requested(self.jobs, self.job_id)
    }

    pub(super) fn update_progress(&self, update: impl FnOnce(&mut DumpJobProgress)) {
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

pub(super) fn ensure_supported_object_type(object_type: &DumpObjectType) {
    // Serde already rejects unknown variants; the exhaustive match keeps the closed enum checked at compile time.
    match object_type {
        DumpObjectType::Table | DumpObjectType::View => {}
    }
}

pub(super) fn initial_dump_progress(job_id: &str, tables_total: usize) -> DumpJobProgress {
    DumpJobProgress {
        job_id: job_id.to_string(),
        status: DumpJobStatus::Running,
        tables_total,
        tables_done: 0,
        current_table: None,
        bytes_written: 0,
        rows_exported: 0,
        error_message: None,
        cancel_requested: false,
        mysql_thread_id: None,
        completed_at: None,
    }
}

pub(super) fn count_selected_tables(input: &StartDumpInput) -> usize {
    input
        .databases
        .iter()
        .map(|db| input.tables.get(db).map(|tables| tables.len()).unwrap_or(0))
        .sum()
}

pub async fn start_sql_dump_impl(
    state: &AppState,
    input: StartDumpInput,
    pool: sqlx::MySqlPool,
) -> Result<String, String> {
    let dump_jobs = &state.dump_jobs;
    input
        .tables
        .values()
        .flatten()
        .for_each(|entry| ensure_supported_object_type(&entry.object_type));

    let job_id = uuid::Uuid::new_v4().to_string();
    let progress = initial_dump_progress(&job_id, count_selected_tables(&input));
    {
        let mut jobs = dump_jobs.write().map_err(|error| error.to_string())?;
        // Clean up stale terminal jobs (older than 5 minutes)
        cleanup_terminal_jobs(&mut jobs);
        jobs.insert(job_id.clone(), progress);
    }

    let job_id_clone = job_id.clone();
    let dump_jobs_arc = std::sync::Arc::clone(dump_jobs);
    tokio::task::spawn_blocking(move || {
        let job = DumpJob {
            jobs: &dump_jobs_arc,
            job_id: &job_id_clone,
        };
        let result = execute_dump(&pool, &input, job);
        job.update_progress(|progress| progress.finish(result));
    });

    Ok(job_id)
}

pub(super) fn dump_object_type(table_type: &str) -> DumpObjectType {
    if table_type.contains("VIEW") {
        return DumpObjectType::View;
    }
    DumpObjectType::Table
}

#[derive(Clone, Copy)]
pub(super) struct DumpObjectRef<'a> {
    db_name: &'a str,
    entry: &'a DumpTableEntry,
}

impl DumpObjectRef<'_> {
    pub(super) fn is_view(&self) -> bool {
        self.entry.object_type == DumpObjectType::View
    }

    pub(super) fn qualified_name(&self) -> String {
        format!(
            "`{}`.`{}`",
            sql_dump::escape_identifier(self.db_name),
            sql_dump::escape_identifier(&self.entry.name)
        )
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum DumpLoopOutcome {
    Finished,
    Cancelled,
}

pub(super) enum DumpStop {
    Cancelled,
    Failed(String),
}

impl From<String> for DumpStop {
    fn from(error: String) -> Self {
        Self::Failed(error)
    }
}

pub(super) type DumpStep = Result<(), DumpStop>;

pub(super) fn write_error(error: std::io::Error) -> String {
    format!("Write error: {error}")
}

pub(super) struct DumpRun<'a> {
    pool: &'a sqlx::MySqlPool,
    input: &'a StartDumpInput,
    job: DumpJob<'a>,
    runtime: tokio::runtime::Handle,
    tables_done: std::cell::Cell<usize>,
}

impl DumpRun<'_> {
    pub(super) fn server_version(&self) -> Result<String, String> {
        self.runtime.block_on(async {
            let row = sqlx::query("SELECT VERSION()")
                .fetch_one(self.pool)
                .await
                .map_err(|error| format!("Failed to get server version: {error}"))?;
            decode_mysql_text_cell(&row, 0)
        })
    }

    pub(super) fn write_preamble(&self, file: &mut std::fs::File) -> Result<(), String> {
        let server_version = self.server_version()?;
        let header_db = self
            .input
            .databases
            .first()
            .map(|text| text.as_str())
            .unwrap_or("mysql");
        sql_dump::write_header(file, header_db, &server_version)
            .map_err(|error| format!("Failed to write header: {error}"))?;
        if self.input.options.use_transaction {
            sql_dump::write_transaction_start(file)
                .map_err(|error| format!("Failed to write transaction start: {error}"))?;
        }
        Ok(())
    }

    pub(super) fn stop_if_cancelled(&self) -> DumpStep {
        if self.job.is_cancel_requested() {
            return Err(DumpStop::Cancelled);
        }
        Ok(())
    }

    pub(super) fn write_all_databases(&self, file: &mut std::fs::File) -> DumpStep {
        for db_name in &self.input.databases {
            self.write_database(file, db_name)?;
        }
        Ok(())
    }

    pub(super) fn write_database(&self, file: &mut std::fs::File, db_name: &str) -> DumpStep {
        let entry_list = self.input.tables.get(db_name).cloned().unwrap_or_default();
        if entry_list.is_empty() {
            return Ok(());
        }
        writeln!(file, "USE `{}`;", sql_dump::escape_identifier(db_name)).map_err(write_error)?;
        writeln!(file).map_err(write_error)?;
        for entry in &entry_list {
            self.write_object(file, DumpObjectRef { db_name, entry })?;
        }
        Ok(())
    }

    pub(super) fn record_table_done(&self) {
        let finished_tables = self.tables_done.get() + 1;
        self.tables_done.set(finished_tables);
        self.job.update_progress(|progress| {
            progress.tables_done = finished_tables;
            progress.rows_exported = 0;
        });
    }

    pub(super) fn write_object(
        &self,
        file: &mut std::fs::File,
        object: DumpObjectRef<'_>,
    ) -> DumpStep {
        let current_table = format!("{}.{}", object.db_name, object.entry.name);
        self.job
            .update_progress(|progress| progress.current_table = Some(current_table));

        if self.input.options.include_structure {
            self.write_object_structure(file, object)?;
        }
        self.stop_if_cancelled()?;
        let should_dump_rows = self.input.options.include_data && !object.is_view();
        if should_dump_rows {
            self.runtime.block_on(self.dump_table_rows(file, object))?;
        }
        self.record_table_done();
        self.stop_if_cancelled()
    }

    pub(super) fn fetch_create_sql(&self, object: DumpObjectRef<'_>) -> Result<String, String> {
        self.runtime.block_on(self.fetch_create_sql_async(object))
    }

    pub(super) async fn fetch_create_sql_async(
        &self,
        object: DumpObjectRef<'_>,
    ) -> Result<String, String> {
        let object_keyword = sql_dump::dump_object_keyword(object.is_view());
        let table_name = &object.entry.name;
        let query = format!("SHOW CREATE {object_keyword} {}", object.qualified_name());
        let failed = |error: sqlx::Error| {
            format!("Failed to get CREATE {object_keyword} for '{table_name}': {error}")
        };
        let row = sqlx::query(sqlx::AssertSqlSafe(query.as_str()))
            .fetch_one(self.pool)
            .await
            .map_err(failed)?;
        decode_mysql_text_cell(&row, 1)
    }

    pub(super) fn write_object_structure(
        &self,
        file: &mut std::fs::File,
        object: DumpObjectRef<'_>,
    ) -> Result<(), String> {
        let create_sql = self.fetch_create_sql(object)?;
        let table_name = &object.entry.name;
        let structure = sql_dump::DumpStructure {
            table_name,
            create_sql: &create_sql,
            include_drop: self.input.options.include_drop,
            is_view: object.is_view(),
        };
        sql_dump::write_structure(file, &structure)
            .map_err(|error| format!("Failed to write structure for '{table_name}': {error}"))
    }

    pub(super) fn set_running_thread(&self, thread_id: Option<u64>) {
        self.job
            .update_progress(|progress| progress.mysql_thread_id = thread_id);
    }

    pub(super) async fn dump_table_rows(
        &self,
        file: &mut std::fs::File,
        object: DumpObjectRef<'_>,
    ) -> Result<(), String> {
        let table_name = &object.entry.name;
        let data_query = format!("SELECT * FROM {}", object.qualified_name());

        // Acquire a dedicated connection so we can track its thread ID for KILL QUERY
        let mut conn = self
            .pool
            .acquire()
            .await
            .map_err(|error| format!("Failed to acquire connection: {error}"))?;
        let thread_id: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()")
            .fetch_one(&mut *conn)
            .await
            .map_err(|error| format!("Failed to get connection ID: {error}"))?;
        self.set_running_thread(Some(thread_id));

        let mut stream = sqlx::query(sqlx::AssertSqlSafe(data_query.as_str())).fetch(&mut *conn);
        let first_row = stream
            .try_next()
            .await
            .map_err(|error| format!("Failed to fetch data from '{table_name}': {error}"))?;
        let Some(first_row) = first_row else {
            self.set_running_thread(None);
            return Ok(());
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
            file,
            table_name,
            columns: &columns,
            job: self.job,
        };
        let result = stream_to_dump(full_stream, target, serialize_dump_row).await;
        self.set_running_thread(None);
        result.map_err(|error| format!("Failed to write data for '{table_name}': {error}"))
    }
}

pub(super) fn serialize_dump_row(row: &sqlx::mysql::MySqlRow) -> Vec<SqlDumpValue> {
    (0..row.columns().len())
        .map(|column_index| serialize_dump_value(row, column_index))
        .collect()
}

/// Always write transaction end + footer + flush, even after cancellation, so the
/// dump file stays well-formed (COMMIT, FK checks restored). The first error wins.
pub(super) fn finish_dump_file(
    file: &mut std::fs::File,
    use_transaction: bool,
    loop_result: DumpStep,
) -> Result<DumpLoopOutcome, String> {
    let (mut first_error, outcome) = match loop_result {
        Ok(()) => (None, DumpLoopOutcome::Finished),
        Err(DumpStop::Cancelled) => (None, DumpLoopOutcome::Cancelled),
        Err(DumpStop::Failed(error)) => (Some(error), DumpLoopOutcome::Finished),
    };
    if use_transaction {
        if let Err(error) = sql_dump::write_transaction_end(file) {
            first_error.get_or_insert(format!("Failed to write transaction end: {error}"));
        }
    }
    if let Err(error) = sql_dump::write_footer(file) {
        first_error.get_or_insert(format!("Failed to write footer: {error}"));
    }
    if let Err(error) = file.flush() {
        first_error.get_or_insert(format!("Failed to flush file: {error}"));
    }
    match first_error {
        Some(error) => Err(error),
        None => Ok(outcome),
    }
}

pub(super) fn execute_dump(
    pool: &sqlx::MySqlPool,
    input: &StartDumpInput,
    job: DumpJob<'_>,
) -> Result<u64, String> {
    let runtime = tokio::runtime::Handle::try_current()
        .map_err(|error| format!("No tokio runtime: {error}"))?;
    let mut file = std::fs::File::create(&input.file_path)
        .map_err(|error| format!("Failed to create file '{}': {error}", input.file_path))?;
    let run = DumpRun {
        pool,
        input,
        job,
        runtime,
        tables_done: std::cell::Cell::new(0),
    };
    run.write_preamble(&mut file)?;

    let loop_result = run.write_all_databases(&mut file);
    let outcome = finish_dump_file(&mut file, input.options.use_transaction, loop_result)?;

    let metadata = std::fs::metadata(&input.file_path)
        .map_err(|error| format!("Failed to read file size: {error}"))?;
    // Store the cancelled flag so the completion handler can check it
    if outcome == DumpLoopOutcome::Cancelled {
        job.update_progress(|progress| progress.cancel_requested = true);
    }
    Ok(metadata.len())
}
