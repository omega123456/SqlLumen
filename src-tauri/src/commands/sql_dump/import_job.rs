use super::*;

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
            fail_import_job(&import_jobs_arc, &job_id_clone, error);
        }
    });

    Ok(job_id)
}

pub(super) fn fail_import_job(
    import_jobs: &std::sync::RwLock<HashMap<String, ImportJobProgress>>,
    job_id: &str,
    error: String,
) {
    let mut jobs = import_jobs
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(progress) = jobs.get_mut(job_id) {
        progress.fail_if_running(error);
    }
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
