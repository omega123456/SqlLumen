use super::*;

pub fn normalize_host(host: &str) -> String {
    host.trim().to_ascii_lowercase()
}

pub fn is_same_host(source_host: &str, target_host: &str) -> bool {
    normalize_host(source_host) == normalize_host(target_host)
}

pub(super) struct CopyHosts {
    pub(super) source_host: String,
    pub(super) target_host: String,
}

pub(super) fn resolve_hosts(
    state: &AppState,
    params: &CopyToHostParams,
) -> Result<CopyHosts, String> {
    let source_host = state
        .registry
        .get_connection_params(&params.source_connection_id)
        .map(|params| params.host)
        .ok_or_else(|| {
            format!(
                "Source connection '{}' not found",
                params.source_connection_id
            )
        })?;

    let target_host = {
        let conn = state
            .db
            .lock()
            .map_err(|error| format!("Failed to lock database: {error}"))?;
        match crate::db::connections::get_connection(&conn, &params.target_connection_id) {
            Ok(Some(record)) => record.host,
            Ok(None) => {
                return Err(format!(
                    "Target connection '{}' not found",
                    params.target_connection_id
                ));
            }
            Err(error) => return Err(error.to_string()),
        }
    };

    Ok(CopyHosts {
        source_host,
        target_host,
    })
}

pub(super) fn validate_target_connection_is_writable(
    state: &AppState,
    target_connection_id: &str,
) -> Result<(), String> {
    let conn = state
        .db
        .lock()
        .map_err(|error| format!("Failed to lock database: {error}"))?;
    let target = crate::db::connections::get_connection(&conn, target_connection_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("Target connection '{target_connection_id}' not found"))?;

    if target.read_only {
        return Err(format!(
            "Target connection '{}' is read-only and cannot be used for Copy to Another Host",
            target.name
        ));
    }

    Ok(())
}

pub fn start_copy_to_host_impl(
    state: &AppState,
    params: CopyToHostParams,
) -> Result<String, String> {
    if is_system_schema(&params.source_database) {
        return Err(format!(
            "Source database '{}' is a system schema and cannot be copied",
            params.source_database
        ));
    }

    if is_system_schema(&params.target_database) {
        return Err(format!(
            "Target database '{}' is a system schema and cannot be used for copy",
            params.target_database
        ));
    }

    validate_selection_for_options(&params.objects, &params.options)?;
    validate_target_connection_is_writable(state, &params.target_connection_id)?;

    let CopyHosts {
        source_host,
        target_host,
    } = resolve_hosts(state, &params)?;
    if is_same_host(&source_host, &target_host) {
        return Err(format!(
            "Source and target are on the same host ('{source_host}'). \
             Copy to Another Host requires a different target host."
        ));
    }
    let job_id = uuid::Uuid::new_v4().to_string();
    let objects_total = params.objects.total();
    let progress = new_running_progress(job_id.clone(), objects_total);

    {
        let mut jobs = state
            .copy_jobs
            .write()
            .map_err(|error| format!("Failed to lock copy jobs: {error}"))?;
        cleanup_terminal_jobs(&mut jobs);
        jobs.insert(job_id.clone(), progress);
    }

    spawn_copy_job(state, params, job_id.clone());

    Ok(job_id)
}

pub fn get_copy_progress_impl(state: &AppState, job_id: &str) -> Result<CopyJobProgress, String> {
    let mut jobs = state
        .copy_jobs
        .write()
        .map_err(|error| format!("Failed to lock copy jobs: {error}"))?;
    cleanup_terminal_jobs(&mut jobs);
    jobs.get(job_id)
        .cloned()
        .ok_or_else(|| format!("Copy job '{job_id}' not found"))
}

pub fn cancel_copy_impl(state: &AppState, job_id: &str) -> Result<(), String> {
    let mut jobs = state
        .copy_jobs
        .write()
        .map_err(|error| format!("Failed to lock copy jobs: {error}"))?;
    match jobs.get_mut(job_id) {
        Some(progress) => {
            progress.cancel_requested = true;
            Ok(())
        }
        None => Err(format!("Copy job '{job_id}' not found")),
    }
}

#[cfg(not(coverage))]
pub(super) fn spawn_copy_job(state: &AppState, params: CopyToHostParams, job_id: String) {
    use tauri::Manager;

    let Some(app_handle) = state.app_handle.clone() else {
        tracing::warn!(
            job_id = %job_id,
            "copy_to_host: no app handle available; engine task not spawned"
        );
        return;
    };

    let jobs = std::sync::Arc::clone(&state.copy_jobs);

    tauri::async_runtime::spawn(async move {
        let app_state = app_handle.state::<AppState>();
        let job = crate::export::copy_to_host::CopyJob { jobs, job_id };
        crate::export::copy_to_host::run_copy(app_state.inner(), params, job).await;
    });
}

#[cfg(coverage)]
pub(super) fn spawn_copy_job(_state: &AppState, _params: CopyToHostParams, _job_id: String) {}
