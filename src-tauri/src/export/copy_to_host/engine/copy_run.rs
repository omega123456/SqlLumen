use super::*;

/// Run a full copy job to completion, writing terminal status into `jobs`.
pub async fn run_copy(state: &AppState, params: CopyToHostParams, job: CopyJob) {
    let result = run_copy_inner(state, &params, &job).await;
    let CopyJob { jobs, job_id } = job;
    // Terminal-status write must never be silently dropped on a poisoned
    // lock — recover the guard so the job does not stay `Running` forever.
    let mut map = jobs
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(progress) = map.get_mut(&job_id) else {
        tracing::error!(
            job_id = %job_id,
            "Copy job entry missing when writing terminal status"
        );
        return;
    };
    // Only set a terminal state if still running (cancel may have
    // already set Cancelled inside the inner loop).
    if progress.status != CopyJobStatus::Running {
        return;
    }
    match result {
        Ok(true) => progress.mark_completed(),
        Ok(false) => progress.mark_cancelled(),
        Err(error) => progress.mark_failed(error),
    }
}

/// Inner copy orchestration. Returns `Ok(true)` on completion, `Ok(false)` if
/// cancelled, `Err` on first error (stop-on-first-error).
pub(super) async fn run_copy_inner(
    state: &AppState,
    params: &CopyToHostParams,
    job: &CopyJob,
) -> Result<bool, String> {
    let source = state
        .registry
        .get_pool(&params.source_connection_id)
        .ok_or_else(|| {
            format!(
                "Source connection '{}' not found",
                params.source_connection_id
            )
        })?;

    let resolved = resolve_target_pool(state, &params.target_connection_id).await?;
    let pools = CopyPools {
        source: &source,
        target: &resolved.pool,
    };
    let outcome = run_copy_with_pools(params, job, &pools).await;
    resolved.dispose().await;
    outcome
}

/// Copy body once both pools are resolved. FK checks are always restored.
///
/// A single target connection is pinned for the entire job so that all
/// session-scoped statements (`USE`, `SET FOREIGN_KEY_CHECKS`) and every
/// DDL/TRUNCATE/INSERT run on the *same* backend handle. Without pinning, a
/// pool with `max_connections > 1` could apply `USE`/`SET` to one connection
/// while the writes land on another, defeating both the default-database
/// switch and the FK-check guarantee.
pub(super) async fn run_copy_with_pools(
    params: &CopyToHostParams,
    job: &CopyJob,
    pools: &CopyPools<'_>,
) -> Result<bool, String> {
    let source = pools.source;
    validate_cross_database_non_table_copy(
        &params.objects,
        &params.source_database,
        &params.target_database,
    )?;

    // Pin one target connection for the whole job (mirrors sql_dump's
    // `pool.acquire()` + `&mut *conn` streaming pattern).
    let mut conn = pools
        .target
        .acquire()
        .await
        .map_err(|error| format!("Failed to acquire target connection: {error}"))?;

    ensure_target_database(source, &mut conn, params).await?;

    let run = CopyRun {
        params,
        job,
        source,
        byte_budget: batch_byte_budget(read_max_allowed_packet(&mut conn).await),
    };

    // Disable FK checks for the duration; always restore.
    run_target_statement(&mut conn, FK_CHECKS_DISABLE).await?;
    let body = copy_objects(&run, &mut conn).await;
    // Finally: restore FK checks regardless of the body outcome.
    let restore = run_target_statement(&mut conn, FK_CHECKS_ENABLE).await;

    match body {
        Ok(outcome) => restore.map(|()| outcome),
        Err(error) => {
            // Surface the original error even if restore also failed.
            log_restore_failure(restore);
            Err(error)
        }
    }
}

pub(super) fn log_restore_failure(restore: Result<(), String>) {
    if let Err(restore_error) = restore {
        tracing::error!(error = %restore_error, "Failed to restore FOREIGN_KEY_CHECKS after copy error");
    }
}

pub(super) fn begin_object_unless_cancelled(
    job: &CopyJob,
    object: CopyObject<'_>,
    rows_total: Option<u64>,
) -> Result<bool, String> {
    let mut map = job
        .jobs
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let progress = map.get_mut(&job.job_id).ok_or("Job entry missing")?;
    if should_cancel(progress) {
        progress.mark_cancelled();
        return Ok(false);
    }
    begin_object(progress, object, rows_total);
    Ok(true)
}

pub(super) async fn copy_one_object(
    run: &CopyRun<'_>,
    target: &mut MySqlConnection,
    object: CopyObject<'_>,
) -> Result<bool, String> {
    let params = run.params;
    let opts = &params.options;
    let is_table = object.object_type == CopyObjectType::Table;
    let copies_table_data = is_table && opts.copy_data;
    let mut rows_total = None;
    if copies_table_data {
        rows_total =
            Some(count_source_rows(run.source, &params.source_database, object.name).await?);
    }

    // Cancel checkpoint at object boundary.
    if !begin_object_unless_cancelled(run.job, object, rows_total)? {
        return Ok(false);
    }

    // Routines/triggers/events are always structure-only.
    let do_structure = opts.copy_structure || !is_table;
    if do_structure {
        copy_object_structure(run, &mut *target, object).await?;
    }

    let completed_data =
        !copies_table_data || copy_table_data(run, &mut *target, object.name).await?;
    if !completed_data {
        run.job
            .update_progress(|progress| progress.mark_cancelled());
        return Ok(false);
    }
    run.job.update_progress(complete_object);
    Ok(true)
}

/// Iterate the work list, copying each object and updating progress. All
/// target writes go through the pinned connection `target`.
pub(super) async fn copy_objects(
    run: &CopyRun<'_>,
    target: &mut MySqlConnection,
) -> Result<bool, String> {
    for (object_type, name) in run.params.objects.work_list() {
        let object = CopyObject {
            object_type,
            name: &name,
        };
        if !copy_one_object(run, &mut *target, object).await? {
            return Ok(false);
        }
    }
    Ok(true)
}
