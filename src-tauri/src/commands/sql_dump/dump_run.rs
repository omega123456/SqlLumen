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
    pool: BackgroundPool,
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
        let result = run_dump_job(&pool, &input, job);
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

#[cfg(not(coverage))]
#[derive(Clone, Copy)]
pub(super) struct DumpObjectRef<'a> {
    db_name: &'a str,
    entry: &'a DumpTableEntry,
}

#[cfg(not(coverage))]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DumpLoopOutcome {
    Finished,
    Cancelled,
}

#[derive(Debug)]
pub enum DumpStop {
    Cancelled,
    Failed(String),
}

impl From<String> for DumpStop {
    fn from(error: String) -> Self {
        Self::Failed(error)
    }
}

pub type DumpStep = Result<(), DumpStop>;

pub(super) fn write_error(error: std::io::Error) -> String {
    format!("Write error: {error}")
}

#[cfg(not(coverage))]
pub(super) struct DumpRun<'a> {
    conn: &'a mut mysql_async::Conn,
    input: &'a StartDumpInput,
    job: DumpJob<'a>,
    runtime: tokio::runtime::Handle,
    tables_done: usize,
}

#[cfg(not(coverage))]
impl DumpRun<'_> {
    pub(super) fn server_version(&mut self) -> Result<String, String> {
        let runtime = self.runtime.clone();
        runtime.block_on(async {
            let statement = LoggedStatement::text("SELECT VERSION()");
            let row = fetch_decoded(self.conn, statement)
                .await
                .map_err(|error| format!("Failed to get server version: {error}"))?;
            let first_row = row
                .first()
                .ok_or_else(|| "Failed to get server version: no row returned".to_string())?;
            first_row.required_text(0)
        })
    }

    pub(super) fn write_preamble(&mut self, file: &mut std::fs::File) -> Result<(), String> {
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

    pub(super) fn write_all_databases(&mut self, file: &mut std::fs::File) -> DumpStep {
        let input = self.input;
        for db_name in &input.databases {
            self.write_database(file, db_name)?;
        }
        Ok(())
    }

    pub(super) fn write_database(&mut self, file: &mut std::fs::File, db_name: &str) -> DumpStep {
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

    pub(super) fn record_table_done(&mut self) {
        self.tables_done += 1;
        let finished_tables = self.tables_done;
        self.job.update_progress(|progress| {
            progress.tables_done = finished_tables;
            progress.rows_exported = 0;
        });
    }

    pub(super) fn write_object(
        &mut self,
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
            let runtime = self.runtime.clone();
            runtime.block_on(self.dump_table_rows(file, object))?;
        }
        self.record_table_done();
        self.stop_if_cancelled()
    }

    pub(super) fn fetch_create_sql(&mut self, object: DumpObjectRef<'_>) -> Result<String, String> {
        let runtime = self.runtime.clone();
        runtime.block_on(self.fetch_create_sql_async(object))
    }

    pub(super) async fn fetch_create_sql_async(
        &mut self,
        object: DumpObjectRef<'_>,
    ) -> Result<String, String> {
        let object_keyword = sql_dump::dump_object_keyword(object.is_view());
        let table_name = &object.entry.name;
        let query = format!("SHOW CREATE {object_keyword} {}", object.qualified_name());
        let failed = |error: String| {
            format!("Failed to get CREATE {object_keyword} for '{table_name}': {error}")
        };
        let rows = fetch_decoded(self.conn, LoggedStatement::text(&query))
            .await
            .map_err(|error| failed(error.to_string()))?;
        let first_row = rows
            .first()
            .ok_or_else(|| failed("no row returned".to_string()))?;
        first_row.required_text(1)
    }

    pub(super) fn write_object_structure(
        &mut self,
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
        &mut self,
        file: &mut std::fs::File,
        object: DumpObjectRef<'_>,
    ) -> Result<(), String> {
        let table_name = &object.entry.name;
        let data_query = format!("SELECT * FROM {}", object.qualified_name());

        let thread_id = crate::mysql::pool::connection_thread_id(self.conn);
        self.set_running_thread(Some(thread_id));

        let job = self.job;
        let streamed = stream(self.conn, LoggedStatement::text(&data_query)).await;
        let rows = match streamed {
            Ok(rows) => rows,
            Err(error) => {
                job.update_progress(|progress| progress.mysql_thread_id = None);
                return Err(format!("Failed to fetch data from '{table_name}': {error}"));
            }
        };
        let columns: Vec<String> = rows
            .columns()
            .iter()
            .map(|column| column.name_str().into_owned())
            .collect();
        let target = DumpTarget {
            file,
            table_name,
            columns: &columns,
            job,
        };
        let row_stream = Box::pin(decoded_row_stream(rows));
        let result = stream_to_dump(row_stream, target, serialize_dump_row).await;
        job.update_progress(|progress| progress.mysql_thread_id = None);
        result.map_err(|error| format!("Failed to write data for '{table_name}': {error}"))
    }
}

pub fn finish_dump_file(
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

#[cfg(not(coverage))]
pub(super) fn run_dump_job(
    pool: &BackgroundPool,
    input: &StartDumpInput,
    job: DumpJob<'_>,
) -> Result<u64, String> {
    let runtime = tokio::runtime::Handle::try_current()
        .map_err(|error| format!("No tokio runtime: {error}"))?;
    let mut conn = runtime.block_on(pool.checkout_for_transfer())?;
    let run = DumpRun {
        conn: &mut conn,
        input,
        job,
        runtime,
        tables_done: 0,
    };
    execute_dump(run)
}

#[cfg(coverage)]
pub(super) fn run_dump_job(
    pool: &BackgroundPool,
    input: &StartDumpInput,
    job: DumpJob<'_>,
) -> Result<u64, String> {
    let _ = (pool, input, job);
    Err(crate::mysql::logged_query::UNAVAILABLE_IN_COVERAGE_MESSAGE.to_string())
}

#[cfg(not(coverage))]
pub(super) fn execute_dump(mut run: DumpRun<'_>) -> Result<u64, String> {
    let input = run.input;
    let job = run.job;
    let mut file = std::fs::File::create(&input.file_path)
        .map_err(|error| format!("Failed to create file '{}': {error}", input.file_path))?;
    run.write_preamble(&mut file)?;

    let loop_result = run.write_all_databases(&mut file);
    let outcome = finish_dump_file(&mut file, input.options.use_transaction, loop_result)?;

    let metadata = std::fs::metadata(&input.file_path)
        .map_err(|error| format!("Failed to read file size: {error}"))?;
    if outcome == DumpLoopOutcome::Cancelled {
        job.update_progress(|progress| progress.cancel_requested = true);
    }
    Ok(metadata.len())
}
