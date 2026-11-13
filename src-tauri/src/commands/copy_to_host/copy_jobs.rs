use super::*;

/// Normalize a host string for same-host comparison: trim surrounding
/// whitespace and lower-case it (host names are case-insensitive). Pure helper
/// so the comparison rule is unit-testable.
pub fn normalize_host(host: &str) -> String {
    host.trim().to_ascii_lowercase()
}

/// `true` when the two hosts refer to the same server for the purpose of the
/// same-host copy guard.
pub fn is_same_host(source_host: &str, target_host: &str) -> bool {
    normalize_host(source_host) == normalize_host(target_host)
}

/// Resolve the source and target host strings for the same-host validation.
///
/// The source is a runtime **session id** (its host lives in the registry's
/// stored connection params); the target is a saved **profile id** (its host is
/// read from the SQLite connection store).
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
                ))
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

/// Validate params, register a new job in `copy_jobs`, spawn the engine task,
/// and return the new job id.
///
/// Same-host copy is rejected eagerly here based on a literal host-string
/// comparison; aliased addresses (e.g. `localhost` vs `127.0.0.1`) bypass it.
/// The target must live on a *different* host than the source.
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

/// Return the stored progress for `job_id`. Errors if the job is unknown.
pub fn get_copy_progress_impl(state: &AppState, job_id: &str) -> Result<CopyJobProgress, String> {
    let mut jobs = state
        .copy_jobs
        .write()
        .map_err(|error| format!("Failed to lock copy jobs: {error}"))?;
    // Lazy cleanup of stale terminal entries, mirroring the dump job model.
    cleanup_terminal_jobs(&mut jobs);
    jobs.get(job_id)
        .cloned()
        .ok_or_else(|| format!("Copy job '{job_id}' not found"))
}

/// Request cancellation of `job_id` by setting its `cancel_requested` flag. The
/// engine observes the flag at the next safe checkpoint. Errors if unknown.
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

/// Spawn the background copy engine task for an already-registered job.
///
/// The engine entry point [`run_copy`](crate::export::copy_to_host::run_copy)
/// borrows `&AppState`, which is not `'static`. The spawned task therefore
/// reacquires the managed `AppState` from the app handle (Tauri keeps it alive
/// for the whole app lifetime) and calls the engine with that reference.
///
/// When no app handle is available (e.g. in unit tests) the engine is *not*
/// spawned — the job entry is still registered so `start_copy_to_host_impl`
/// remains fully testable; only the live engine execution is skipped.
///
/// Excluded from coverage: it requires the Tauri async runtime and a real MySQL
/// pool. The registration/validation logic in `start_copy_to_host_impl` carries
/// the tested behavior.
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

/// No-op stub for coverage builds (the engine needs a real pool).
#[cfg(coverage)]
pub(super) fn spawn_copy_job(_state: &AppState, _params: CopyToHostParams, _job_id: String) {}
