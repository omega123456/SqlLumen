use super::*;
use crate::mysql::pool::{BackgroundPool, KillQuery};

pub fn get_dump_progress_impl(state: &AppState, job_id: &str) -> Result<DumpJobProgress, String> {
    let mut jobs = state.dump_jobs.write().map_err(|error| error.to_string())?;
    cleanup_terminal_jobs(&mut jobs);
    jobs.get(job_id)
        .cloned()
        .ok_or_else(|| format!("Dump job '{job_id}' not found"))
}

pub(super) fn is_dump_thread_still_active(
    state: &AppState,
    job: &DumpThread<'_>,
) -> Result<bool, String> {
    let jobs = state.dump_jobs.read().map_err(|error| error.to_string())?;
    Ok(jobs
        .get(job.job_id)
        .and_then(|progress| progress.mysql_thread_id)
        == Some(job.thread_id))
}

pub(super) struct DumpThread<'a> {
    job_id: &'a str,
    thread_id: u64,
}

pub(super) async fn kill_dump_query_if_active(
    state: &AppState,
    pool: &BackgroundPool,
    job: DumpThread<'_>,
) -> Result<(), String> {
    if !is_dump_thread_still_active(state, &job)? {
        return Ok(());
    }
    let DumpThread { job_id, thread_id } = job;
    tracing::debug!(job_id, thread_id, "cancel_dump: issuing KILL QUERY");
    let kill = KillQuery {
        thread_id,
        checkout_timeout: pool.connect_timeout(),
    };
    if let Err(failure) = pool.kill_query(kill).await {
        tracing::warn!(job_id, %failure, "KILL QUERY failed during dump cancel");
    }
    Ok(())
}

pub async fn cancel_dump_impl(state: &AppState, request: &CancelDumpRequest) -> Result<(), String> {
    let job_id = request.job_id.as_str();
    let connection_id = request.connection_id.as_str();
    let running_thread = {
        let mut jobs = state.dump_jobs.write().map_err(|error| error.to_string())?;
        let progress = jobs
            .get_mut(job_id)
            .ok_or_else(|| format!("Dump job '{job_id}' not found"))?;
        progress.cancel_requested = true;
        progress.mysql_thread_id
    };
    let Some(thread_id) = running_thread else {
        return Ok(());
    };
    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;
    kill_dump_query_if_active(state, &pool, DumpThread { job_id, thread_id }).await
}

pub(super) fn is_cancel_requested(
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
