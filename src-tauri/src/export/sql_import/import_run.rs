use super::*;

pub struct SqlImportJob<'a> {
    pub file_path: &'a str,
    pub stop_on_error: bool,
    pub job_id: &'a str,
    pub import_jobs: &'a Arc<RwLock<HashMap<String, ImportJobProgress>>>,
    pub history_db: &'a Arc<Mutex<rusqlite::Connection>>,
    pub connection_id: &'a str,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ImportEnd {
    Completed,
    Cancelled,
    StoppedOnError,
}

pub(super) struct ExecutedStatement<'a> {
    pub(super) index: usize,
    pub(super) sql: &'a str,
    pub(super) elapsed_ms: i64,
    pub(super) result: Result<ExecuteOutcome, mysql_async::Error>,
}

pub(super) struct StatementFailure<'a> {
    pub(super) statement: &'a ExecutedStatement<'a>,
    pub(super) error_text: String,
}

pub(super) struct SqlImportRun<'a> {
    pub(super) conn: &'a mut mysql_async::Conn,
    pub(super) job: &'a SqlImportJob<'a>,
    pub(super) runtime: tokio::runtime::Handle,
    pub(super) start_time: std::time::Instant,
    pub(super) filename: &'a str,
    pub(super) tally: ImportTally,
    pub(super) history_entries: Vec<NewHistoryEntry>,
}

impl SqlImportRun<'_> {
    pub(super) fn update_progress(&self, update: impl FnOnce(&mut ImportJobProgress)) {
        let mut jobs = self
            .job
            .import_jobs
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(progress) = jobs.get_mut(self.job.job_id) {
            update(progress);
        }
    }

    pub(super) fn is_cancel_requested(&self) -> bool {
        let jobs = self
            .job
            .import_jobs
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        jobs.get(self.job.job_id)
            .is_some_and(|progress| progress.cancel_requested)
    }

    pub(super) fn execute_all(&mut self, statements: &[String]) -> ImportEnd {
        statements
            .iter()
            .enumerate()
            .find_map(|(index, sql)| self.execute_next(index, sql))
            .unwrap_or(ImportEnd::Completed)
    }

    pub(super) fn execute_next(&mut self, index: usize, sql: &str) -> Option<ImportEnd> {
        if self.is_cancel_requested() {
            return Some(ImportEnd::Cancelled);
        }
        tracing::debug!(
            job_id = %self.job.job_id,
            statement_index = index,
            sql_preview = %statement_preview(sql, LOG_PREVIEW_CHARS, "…"),
            "Executing import statement"
        );
        let statement_start = std::time::Instant::now();
        let runtime = self.runtime.clone();
        let result = runtime.block_on(execute(self.conn, LoggedStatement::text(sql)));
        let statement = ExecutedStatement {
            index,
            sql,
            elapsed_ms: statement_start.elapsed().as_millis() as i64,
            result,
        };
        self.record_statement(statement)
    }

    pub(super) fn record_statement(
        &mut self,
        statement: ExecutedStatement<'_>,
    ) -> Option<ImportEnd> {
        let import_jobs = self.job.import_jobs;
        let mut jobs = import_jobs
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let progress = jobs.get_mut(self.job.job_id)?;
        progress.statements_done = statement.index + 1;
        self.tally.statements_executed += 1;
        match &statement.result {
            Ok(query_result) => {
                self.record_success(&statement, query_result.affected_rows);
                None
            }
            Err(error) => {
                let failure = StatementFailure {
                    statement: &statement,
                    error_text: error.to_string(),
                };
                self.record_failure(progress, failure)
            }
        }
    }

    pub(super) fn record_success(&mut self, statement: &ExecutedStatement<'_>, rows_affected: u64) {
        self.tally.total_rows_affected += rows_affected;
        self.history_entries.push(NewHistoryEntry {
            connection_id: self.job.connection_id.to_string(),
            database_name: None,
            sql_text: statement.sql.to_string(),
            duration_ms: Some(statement.elapsed_ms),
            row_count: Some(0),
            affected_rows: Some(rows_affected as i64),
            success: true,
            error_message: None,
        });
    }

    pub(super) fn record_failure(
        &mut self,
        progress: &mut ImportJobProgress,
        failure: StatementFailure<'_>,
    ) -> Option<ImportEnd> {
        let StatementFailure {
            statement,
            error_text,
        } = failure;
        tracing::warn!(
            job_id = %self.job.job_id,
            statement_index = statement.index,
            error = %error_text,
            sql_preview = %statement_preview(statement.sql, LOG_PREVIEW_CHARS, "…"),
            "Import statement failed"
        );
        self.tally.error_count += 1;
        self.tally.last_error_message = Some(error_text.clone());
        progress.errors.push(ImportError {
            statement_index: statement.index,
            sql_preview: statement_preview(statement.sql, ERROR_PREVIEW_CHARS, "..."),
            error_message: error_text,
        });
        if !self.job.stop_on_error {
            return None;
        }
        progress.mark_failed();
        Some(ImportEnd::StoppedOnError)
    }

    pub(super) fn log_end(&self, end: ImportEnd, elapsed_ms: i64) {
        let job_id = self.job.job_id;
        let connection_id = self.job.connection_id;
        let tally = &self.tally;
        match end {
            ImportEnd::Completed => tracing::info!(
                job_id = %job_id,
                connection_id = %connection_id,
                statements_executed = tally.statements_executed,
                error_count = tally.error_count,
                total_rows_affected = tally.total_rows_affected,
                elapsed_ms = elapsed_ms,
                "SQL import completed"
            ),
            ImportEnd::Cancelled => tracing::info!(
                job_id = %job_id,
                connection_id = %connection_id,
                statements_executed = tally.statements_executed,
                error_count = tally.error_count,
                elapsed_ms = elapsed_ms,
                "SQL import cancelled"
            ),
            ImportEnd::StoppedOnError => tracing::info!(
                job_id = %job_id,
                connection_id = %connection_id,
                statements_executed = tally.statements_executed,
                error_count = tally.error_count,
                elapsed_ms = elapsed_ms,
                "SQL import stopped on error"
            ),
        }
    }

    pub(super) fn finish(mut self, end: ImportEnd) {
        match end {
            ImportEnd::Cancelled => self.update_progress(|progress| progress.mark_cancelled()),
            ImportEnd::Completed => self.update_progress(|progress| progress.complete_if_running()),
            ImportEnd::StoppedOnError => {}
        }
        let elapsed_ms = self.start_time.elapsed().as_millis() as i64;
        self.log_end(end, elapsed_ms);

        let db = self.job.history_db;
        query_history_bridge::log_batch_entries(db, std::mem::take(&mut self.history_entries));
        log_import_history(
            db,
            ImportHistorySummary {
                connection_id: self.job.connection_id,
                filename: self.filename,
                tally: self.tally,
                elapsed_ms,
                cancelled: end == ImportEnd::Cancelled,
            },
        );
    }
}

pub fn run_sql_import_job(
    pool: &BackgroundPool,
    import_job: &SqlImportJob<'_>,
) -> Result<(), String> {
    let runtime = tokio::runtime::Handle::try_current()
        .map_err(|error| format!("No tokio runtime: {error}"))?;
    let mut conn = runtime.block_on(pool.checkout_for_transfer())?;
    execute_sql_import(&mut conn, import_job)
}

pub fn execute_sql_import(
    conn: &mut mysql_async::Conn,
    import_job: &SqlImportJob<'_>,
) -> Result<(), String> {
    let file_path = import_job.file_path;
    let runtime = tokio::runtime::Handle::try_current()
        .map_err(|error| format!("No tokio runtime: {error}"))?;
    let start_time = std::time::Instant::now();
    let filename = std::path::Path::new(file_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(file_path);
    let content = std::fs::read_to_string(file_path)
        .map_err(|error| format!("Failed to read file '{}': {error}", file_path))?;
    let statements = parse_sql_statements(&content);

    tracing::info!(
        job_id = %import_job.job_id,
        connection_id = %import_job.connection_id,
        filename = %filename,
        total_statements = statements.len(),
        "SQL import started"
    );

    let mut run = SqlImportRun {
        conn,
        job: import_job,
        runtime,
        start_time,
        filename,
        tally: ImportTally::default(),
        history_entries: Vec::new(),
    };
    run.update_progress(|progress| progress.statements_total = statements.len());
    let end = run.execute_all(&statements);
    run.finish(end);
    Ok(())
}

#[derive(Default)]
pub(super) struct ImportTally {
    pub(super) statements_executed: usize,
    pub(super) error_count: usize,
    pub(super) total_rows_affected: u64,
    pub(super) last_error_message: Option<String>,
}

pub(super) struct ImportHistorySummary<'a> {
    pub(super) connection_id: &'a str,
    pub(super) filename: &'a str,
    pub(super) tally: ImportTally,
    pub(super) elapsed_ms: i64,
    pub(super) cancelled: bool,
}

pub(super) fn import_status_label(cancelled: bool, error_count: usize) -> &'static str {
    if cancelled {
        return "cancelled";
    }
    if error_count > 0 {
        return "with errors";
    }
    "OK"
}

pub(super) fn log_import_history(
    db: &Arc<Mutex<rusqlite::Connection>>,
    summary: ImportHistorySummary<'_>,
) {
    let tally = summary.tally;
    let success = tally.error_count == 0 && !summary.cancelled;
    let status_label = import_status_label(summary.cancelled, tally.error_count);
    let sql_text = format!(
        "/* SQL Import: {} — {} statements, {} errors, {} */",
        summary.filename, tally.statements_executed, tally.error_count, status_label
    );

    query_history_bridge::log_single_entry(
        db,
        NewHistoryEntry {
            connection_id: summary.connection_id.to_string(),
            database_name: None,
            sql_text,
            duration_ms: Some(summary.elapsed_ms),
            row_count: Some(0),
            affected_rows: Some(tally.total_rows_affected as i64),
            success,
            error_message: tally.last_error_message,
        },
    );
}

pub(super) const LOG_PREVIEW_CHARS: usize = 80;
pub(super) const ERROR_PREVIEW_CHARS: usize = 120;

pub(super) fn statement_preview(sql: &str, max_len: usize, ellipsis: &str) -> String {
    let fits_preview = sql.len() <= max_len;
    if fits_preview {
        return sql.to_string();
    }
    format!("{}{ellipsis}", &sql[..max_len])
}
