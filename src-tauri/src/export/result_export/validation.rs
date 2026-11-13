use super::*;

#[derive(Debug, Clone, PartialEq)]
pub struct FullExportSource {
    pub source_sql: String,
    pub run_database: RunDatabase,
}

pub fn validate_full_export(
    state: &AppState,
    slot: &ResultSlotKey,
) -> Result<FullExportSource, String> {
    let ResultSlotKey {
        connection_id,
        tab_id,
        result_index,
        query_id,
    } = slot;
    let result_index = *result_index;
    let cached = state.result_cache.get(connection_id, tab_id);
    if cached.is_expired() {
        return Err(crate::mysql::result_view::RESULTS_EXPIRED_MESSAGE.to_string());
    }
    let entry = cached
        .into_entry()
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;
    let stored = entry.value.get(result_index).ok_or_else(|| {
        format!(
            "Result index {result_index} out of range (total: {})",
            entry.value.len()
        )
    })?;
    if stored.query_id != *query_id {
        return Err(crate::mysql::result_view::STALE_QUERY_MESSAGE.to_string());
    }
    let rerunnable = stored.truncated
        && stored.full_export_blocked_reason.is_none()
        && stored.run_database != RunDatabase::NotCaptured
        && !stored.source_sql.trim().is_empty();
    if !rerunnable {
        return Err(FULL_EXPORT_UNAVAILABLE_MESSAGE.to_string());
    }
    Ok(FullExportSource {
        source_sql: stored.source_sql.clone(),
        run_database: stored.run_database.clone(),
    })
}

/// Validate the request and register a running job. The caller then runs
/// [`run_result_export_job`] in the background and returns the job id.
pub fn start_result_export_impl(
    state: &AppState,
    input: StartResultExportInput,
) -> Result<PreparedResultExport, String> {
    if input.file_path.trim().is_empty() {
        return Err("Choose a file to export to.".to_string());
    }
    let FullExportSource {
        source_sql,
        run_database,
    } = validate_full_export(state, &input.slot)?;
    let job_id = uuid::Uuid::new_v4().to_string();
    let cancel = register_job(
        &state.result_export_jobs,
        &job_id,
        &input.slot.connection_id,
    );
    let target_path = PathBuf::from(&input.file_path);
    tracing::info!(
        job_id,
        connection_id = input.slot.connection_id,
        tab_id = input.slot.tab_id,
        result_index = input.slot.result_index,
        format = ?input.format,
        "result export: job started"
    );
    Ok(PreparedResultExport {
        job_id,
        connection_id: input.slot.connection_id,
        source_sql,
        run_database,
        format: input.format,
        temp_path: temp_path_for(&target_path),
        target_path,
        include_headers: input.include_headers,
        table_name: input.table_name,
        jobs: state.result_export_jobs.clone(),
        cancel,
    })
}
