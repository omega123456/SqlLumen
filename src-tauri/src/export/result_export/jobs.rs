use super::*;

pub(super) fn write_jobs(
    jobs: &ResultExportJobs,
) -> std::sync::RwLockWriteGuard<'_, HashMap<String, ResultExportJobProgress>> {
    jobs.write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(super) fn update_job(
    jobs: &ResultExportJobs,
    job_id: &str,
    update: impl FnOnce(&mut ResultExportJobProgress),
) {
    if let Some(job) = write_jobs(jobs).get_mut(job_id) {
        update(job);
    }
}

pub fn register_job(
    jobs: &ResultExportJobs,
    job_id: &str,
    connection_id: &str,
) -> Arc<ResultExportCancel> {
    let mut map = write_jobs(jobs);
    cleanup_terminal_jobs(&mut map);
    let cancel = Arc::new(ResultExportCancel::default());
    map.insert(
        job_id.to_string(),
        ResultExportJobProgress {
            status: ResultExportStatus::Running,
            rows_written: 0,
            bytes_written: 0,
            elapsed_ms: 0,
            stopped_at_sheet_limit: false,
            error: None,
            job_id: job_id.to_string(),
            cancel_requested: false,
            mysql_thread_id: None,
            connection_id: connection_id.to_string(),
            started_at: Instant::now(),
            completed_at: None,
            cancel: Arc::clone(&cancel),
        },
    );
    cancel
}

pub fn set_job_thread(jobs: &ResultExportJobs, job_id: &str, thread_id: Option<u64>) {
    update_job(jobs, job_id, |job| job.mysql_thread_id = thread_id);
}

pub fn is_cancel_requested(jobs: &ResultExportJobs, job_id: &str) -> bool {
    jobs.read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(job_id)
        .is_none_or(|job| job.cancel_requested)
}

#[derive(Debug)]
pub struct CancelKill {
    pub thread_id: u64,
    pub connection_id: String,
    pub(super) cancel: Arc<ResultExportCancel>,
}

impl CancelKill {
    pub fn mark_sent(&self) {
        self.cancel.kill_sent.store(true, Ordering::SeqCst);
    }
}

impl Drop for CancelKill {
    fn drop(&mut self) {
        self.cancel.kills_in_flight.fetch_sub(1, Ordering::SeqCst);
        self.cancel.kill_done.notify_waiters();
    }
}

pub fn request_cancel(jobs: &ResultExportJobs, job_id: &str) -> Result<Option<CancelKill>, String> {
    let mut map = write_jobs(jobs);
    let job = map
        .get_mut(job_id)
        .ok_or_else(|| format!("Export job '{job_id}' not found"))?;
    if job.status != ResultExportStatus::Running {
        return Ok(None);
    }
    job.cancel_requested = true;
    job.cancel.requested.store(true, Ordering::SeqCst);
    Ok(job.mysql_thread_id.map(|thread_id| {
        job.cancel.kills_in_flight.fetch_add(1, Ordering::SeqCst);
        CancelKill {
            thread_id,
            connection_id: job.connection_id.clone(),
            cancel: Arc::clone(&job.cancel),
        }
    }))
}

pub async fn wait_for_cancel_kills(
    cancel: &ResultExportCancel,
    job_id: &str,
    timeout: Duration,
) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let notified = cancel.kill_done.notified();
        let kills_in_flight = cancel.kills_in_flight.load(Ordering::SeqCst);
        if kills_in_flight == 0 {
            return true;
        }
        if tokio::time::timeout_at(deadline, notified).await.is_err() {
            tracing::warn!(
                job_id,
                "result export: a cancel KILL QUERY is still in flight; releasing the session anyway"
            );
            return false;
        }
    }
}

pub(super) fn is_running_on_connection(job: &ResultExportJobProgress, connection_id: &str) -> bool {
    job.status == ResultExportStatus::Running && job.connection_id == connection_id
}

pub fn running_job_ids_for_connection(jobs: &ResultExportJobs, connection_id: &str) -> Vec<String> {
    let map = jobs.read().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut ids: Vec<String> = map
        .values()
        .filter(|job| is_running_on_connection(job, connection_id))
        .map(|job| job.job_id.clone())
        .collect();
    ids.sort();
    ids
}

pub fn get_result_export_progress_impl(
    state: &AppState,
    job_id: &str,
) -> Result<ResultExportJobProgress, String> {
    let mut map = write_jobs(&state.result_export_jobs);
    cleanup_terminal_jobs(&mut map);
    let job = map
        .get(job_id)
        .ok_or_else(|| format!("Export job '{job_id}' not found"))?;
    let mut progress = job.clone();
    if progress.status == ResultExportStatus::Running {
        progress.elapsed_ms = progress.started_at.elapsed().as_millis() as u64;
    }
    Ok(progress)
}

pub async fn cancel_result_export_impl(state: &AppState, job_id: &str) -> Result<(), String> {
    if let Some(kill) = request_cancel(&state.result_export_jobs, job_id)? {
        tracing::info!(
            job_id,
            connection_id = kill.connection_id,
            thread_id = kill.thread_id,
            "result export: cancel requested"
        );
        let export_kill = ExportKill {
            connection_id: &kill.connection_id,
            thread_id: kill.thread_id,
            purpose: "cancel",
        };
        if kill_export_query(state, &export_kill).await {
            kill.mark_sent();
        }
    }
    Ok(())
}

pub async fn cancel_result_exports_for_connection(state: &AppState, connection_id: &str) {
    for job_id in running_job_ids_for_connection(&state.result_export_jobs, connection_id) {
        if let Err(error) = cancel_result_export_impl(state, &job_id).await {
            tracing::warn!(
                job_id,
                connection_id,
                error,
                "result export: cancel on close failed"
            );
        }
    }
}
