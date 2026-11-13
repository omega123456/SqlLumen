use super::*;

/// The export's output side: the sink on the temp file, progress reporting,
/// and the final rename or cleanup. Coverage-visible, so tests drive it with
/// synthetic rows.
pub struct ExportPipeline {
    pub(super) jobs: ResultExportJobs,
    pub(super) job_id: String,
    pub(super) format: ExportFormat,
    pub(super) temp_path: PathBuf,
    pub(super) target_path: PathBuf,
    pub(super) include_headers: bool,
    pub(super) table_name: Option<String>,
    pub(super) sheet_row_limit: u32,
    pub(super) sink: Option<RowSink>,
}

impl ExportPipeline {
    pub fn new(prepared: &PreparedResultExport) -> Self {
        Self {
            jobs: prepared.jobs.clone(),
            job_id: prepared.job_id.clone(),
            format: prepared.format.clone(),
            temp_path: prepared.temp_path.clone(),
            target_path: prepared.target_path.clone(),
            include_headers: prepared.include_headers,
            table_name: prepared.table_name.clone(),
            sheet_row_limit: XLSX_SHEET_ROW_LIMIT,
            sink: None,
        }
    }

    /// Override the XLSX sheet row limit (test seam).
    pub fn with_sheet_row_limit(mut self, sheet_row_limit: u32) -> Self {
        self.sheet_row_limit = sheet_row_limit;
        self
    }

    /// Create the temp file and write the header for the re-run's columns.
    pub fn open(&mut self, columns: &[String]) -> Result<(), String> {
        let spec = RowSinkSpec {
            format: &self.format,
            path: &self.temp_path,
            columns,
            include_headers: self.include_headers,
            table_name: self.table_name.as_deref(),
        };
        let sink = RowSink::create_with_sheet_row_limit(&spec, self.sheet_row_limit)?;
        self.sink = Some(sink);
        Ok(())
    }

    /// Write one row and publish progress on the first row and every
    /// [`PROGRESS_REPORT_EVERY_ROWS`] rows.
    pub fn accept_row(&mut self, row: &[serde_json::Value]) -> Result<RowWrite, String> {
        let sink = self
            .sink
            .as_mut()
            .ok_or_else(|| "The export file is not open.".to_string())?;
        let outcome = sink.write_row(row)?;
        let rows = sink.rows_written();
        let is_progress_checkpoint = rows == 1 || rows % PROGRESS_REPORT_EVERY_ROWS == 0;
        let should_report_progress = outcome == RowWrite::Written && is_progress_checkpoint;
        if should_report_progress {
            let bytes = sink.bytes_written();
            self.report_progress(rows, bytes);
        }
        Ok(outcome)
    }

    pub(super) fn report_progress(&self, rows: u64, bytes: u64) {
        update_job(&self.jobs, &self.job_id, |job| {
            job.rows_written = rows;
            job.bytes_written = bytes;
        });
    }

    /// Finish the job: on success, finish the file and rename it onto the
    /// target; otherwise delete the temp file and leave the target untouched.
    /// A cancel request turns a completed re-run into a cancelled export.
    /// `restore_error` (a failed database restore) is reported in the job's
    /// error without failing a completed export. Returns the final status.
    pub fn complete(
        mut self,
        outcome: ExportOutcome,
        restore_error: Option<String>,
    ) -> ResultExportStatus {
        let outcome = match outcome {
            ExportOutcome::Completed if is_cancel_requested(&self.jobs, &self.job_id) => {
                ExportOutcome::Cancelled
            }
            other => other,
        };
        let mut rows_written = self.sink.as_ref().map_or(0, RowSink::rows_written);
        let mut bytes_written = self.sink.as_ref().map_or(0, RowSink::bytes_written);
        let mut stopped_at_sheet_limit = false;

        let (status, mut error) = match outcome {
            ExportOutcome::Completed => match self.finish_file() {
                Ok(summary) => {
                    rows_written = summary.rows_written;
                    bytes_written = summary.bytes_written;
                    stopped_at_sheet_limit = summary.stopped_at_sheet_limit;
                    (ResultExportStatus::Completed, None)
                }
                Err(message) => (ResultExportStatus::Failed, Some(message)),
            },
            ExportOutcome::Cancelled => (ResultExportStatus::Cancelled, None),
            ExportOutcome::Failed(message) => (ResultExportStatus::Failed, Some(message)),
        };
        if status != ResultExportStatus::Completed {
            self.sink = None;
            self.remove_temp_file();
        }
        if let Some(restore) = restore_error {
            error = Some(match error {
                Some(message) => format!("{message} {restore}"),
                None => restore,
            });
        }

        match status {
            ResultExportStatus::Completed => tracing::info!(
                job_id = self.job_id,
                rows_written,
                bytes_written,
                stopped_at_sheet_limit,
                "result export: completed"
            ),
            ResultExportStatus::Cancelled => {
                tracing::info!(job_id = self.job_id, "result export: cancelled")
            }
            _ => tracing::warn!(job_id = self.job_id, ?error, "result export: failed"),
        }

        update_job(&self.jobs, &self.job_id, |job| {
            job.status = status;
            job.rows_written = rows_written;
            job.bytes_written = bytes_written;
            job.stopped_at_sheet_limit = stopped_at_sheet_limit;
            job.error = error;
            job.mysql_thread_id = None;
            job.elapsed_ms = job.started_at.elapsed().as_millis() as u64;
            job.completed_at = Some(SystemTime::now());
        });
        status
    }

    pub(super) fn finish_file(
        &mut self,
    ) -> Result<crate::export::stream_writer::StreamSummary, String> {
        let sink = self
            .sink
            .take()
            .ok_or_else(|| "The query returned no result set to export.".to_string())?;
        let summary = sink.finish()?;
        std::fs::rename(&self.temp_path, &self.target_path)
            .map_err(|error| format!("Failed to save the export file: {error}"))?;
        Ok(summary)
    }

    pub(super) fn remove_temp_file(&self) {
        match std::fs::remove_file(&self.temp_path) {
            Ok(()) => {}
            Err(error) if crate::is_not_found_error(&error) => {}
            Err(error) => tracing::warn!(
                job_id = self.job_id,
                path = %self.temp_path.display(),
                %error,
                "result export: couldn't delete the temp file"
            ),
        }
    }
}
