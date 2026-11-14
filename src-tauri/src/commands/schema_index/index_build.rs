use super::*;

#[cfg(not(coverage))]
#[derive(Clone, Copy)]
pub(super) enum IndexBuildKind {
    Build,
    ForceRebuild,
}

#[cfg(not(coverage))]
impl IndexBuildKind {
    pub(super) fn log_prefix(self) -> &'static str {
        match self {
            Self::Build => "schema_index build",
            Self::ForceRebuild => "schema_index force_rebuild",
        }
    }

    pub(super) fn skip_label(self) -> &'static str {
        match self {
            Self::Build => "Schema index build",
            Self::ForceRebuild => "Force rebuild",
        }
    }

    pub(super) fn failure_message(self) -> &'static str {
        match self {
            Self::Build => "Schema index build failed",
            Self::ForceRebuild => "Schema index force rebuild failed",
        }
    }

    pub(super) fn scheduling_description(self) -> &'static str {
        match self {
            Self::Build => "scheduling embedding index build (background task)",
            Self::ForceRebuild => "scheduling full embedding index rebuild (background task)",
        }
    }
}

#[cfg(not(coverage))]
pub(super) struct EmbeddingSettings {
    model: String,
    endpoint: String,
}

#[cfg(not(coverage))]
pub(super) fn read_build_settings(
    state: &AppState,
    profile_id: &str,
    kind: IndexBuildKind,
) -> Result<Option<EmbeddingSettings>, String> {
    let model = read_setting(&state.db, EMBEDDING_MODEL_SETTING)?;
    let endpoint = read_embedding_endpoint(&state.db)?;
    if model.is_empty() {
        tracing::info!(profile_id = %profile_id, "{} skipped: no embedding model configured", kind.skip_label());
        return Ok(None);
    }
    if endpoint.is_empty() {
        tracing::warn!(profile_id = %profile_id, "{} skipped: no embedding endpoint configured", kind.skip_label());
        return Ok(None);
    }
    Ok(Some(EmbeddingSettings { model, endpoint }))
}

#[cfg(not(coverage))]
pub(super) struct ScheduledBuild {
    kind: IndexBuildKind,
    session_id: String,
    profile_id: String,
    settings: EmbeddingSettings,
}

#[cfg(not(coverage))]
pub(super) struct IndexBuildJob {
    kind: IndexBuildKind,
    app_handle: tauri::AppHandle,
    profile_id: String,
    config: BuildConfig,
    db: std::sync::Arc<Mutex<rusqlite::Connection>>,
    http_client: reqwest::Client,
    build_tokens: std::sync::Arc<Mutex<std::collections::HashMap<String, CancellationToken>>>,
    pool: sqlx::MySqlPool,
    token: CancellationToken,
}

#[cfg(not(coverage))]
pub(super) fn schedule_index_build(
    app_handle: tauri::AppHandle,
    state: &AppState,
    scheduled: ScheduledBuild,
) -> Result<(), String> {
    let ScheduledBuild {
        kind,
        session_id,
        profile_id,
        settings,
    } = scheduled;
    let token = CancellationToken::new();
    state
        .index_build_tokens
        .lock()
        .map_err(lock_error)?
        .insert(profile_id.clone(), token.clone());

    let pool = state
        .registry
        .get_pool(&session_id)
        .ok_or_else(|| format!("No MySQL pool for session '{session_id}'"))?;

    tracing::info!(
        session_id = %session_id,
        profile_id = %profile_id,
        model_id = %settings.model,
        scheduled_at = %Utc::now().to_rfc3339(),
        "{}: {}",
        kind.log_prefix(),
        kind.scheduling_description()
    );

    let job = IndexBuildJob {
        kind,
        app_handle,
        profile_id: profile_id.clone(),
        config: BuildConfig {
            connection_id: profile_id,
            model_id: settings.model,
            endpoint: settings.endpoint,
        },
        db: state.db.clone(),
        http_client: state.http_client.clone(),
        build_tokens: state.index_build_tokens.clone(),
        pool,
        token,
    };
    tokio::task::spawn(run_index_build_job(job));
    Ok(())
}

#[cfg(not(coverage))]
pub(super) async fn run_index_build_job(job: IndexBuildJob) {
    tracing::info!(
        profile_id = %job.profile_id,
        task_started_at = %Utc::now().to_rfc3339(),
        "{}: background task started",
        job.kind.log_prefix()
    );

    let app_handle_progress = job.app_handle.clone();
    let on_progress: crate::schema_index::types::ProgressCallback =
        Box::new(move |progress: crate::schema_index::types::BuildProgress| {
            let _ = app_handle_progress.emit("schema-index-progress", &progress);
        });
    let resources = builder::IndexBuildResources {
        sqlite_conn: &job.db,
        mysql_pool: &job.pool,
        http_client: &job.http_client,
        cancellation: &job.token,
    };
    match builder::build_index(&job.config, &resources, Some(&on_progress)).await {
        Ok(build_result) => report_index_build_success(&job, &build_result),
        Err(error) => report_index_build_failure(&job, error),
    }

    if let Ok(mut tokens) = job.build_tokens.lock() {
        tokens.remove(&job.profile_id);
    }
}

#[cfg(not(coverage))]
pub(super) fn report_index_build_success(
    job: &IndexBuildJob,
    build_result: &crate::schema_index::types::BuildResult,
) {
    tracing::info!(
        profile_id = %job.profile_id,
        completed_at = %Utc::now().to_rfc3339(),
        tables_indexed = build_result.tables_indexed,
        duration_ms = build_result.duration_ms,
        "{}: background task completed successfully",
        job.kind.log_prefix()
    );
    let _ = job.app_handle.emit("schema-index-complete", build_result);
}

#[cfg(not(coverage))]
pub(super) fn report_index_build_failure(job: &IndexBuildJob, error: String) {
    tracing::error!(
        profile_id = %job.profile_id,
        error = %error,
        failed_at = %Utc::now().to_rfc3339(),
        "{}",
        job.kind.failure_message()
    );
    if let Ok(conn) = job.db.lock() {
        let _ = storage::update_index_status(
            &conn,
            &job.profile_id,
            &crate::schema_index::types::IndexStatus::Error,
        );
    }
    let payload = IndexErrorPayload {
        profile_id: job.profile_id.clone(),
        error,
    };
    let _ = job.app_handle.emit("schema-index-error", &payload);
}

#[cfg(not(coverage))]
pub async fn force_rebuild_schema_index_impl(
    app_handle: tauri::AppHandle,
    state: &AppState,
    session_id: String,
) -> Result<(), String> {
    let profile_id = resolve_session_profile(state, &session_id)?;
    register_session_profile(state, &session_id, &profile_id)?;

    if let Some(old_token) = take_in_flight_build(state, &profile_id)? {
        tracing::info!(
            profile_id = %profile_id,
            at = %Utc::now().to_rfc3339(),
            "schema_index force_rebuild: cancelling in-flight build for profile before wipe"
        );
        old_token.cancel();
    }

    wipe_profile_chunks(state, &profile_id)?;
    tracing::info!(
        profile_id = %profile_id,
        at = %Utc::now().to_rfc3339(),
        "schema_index force_rebuild: wiped all stored chunks and vectors for profile"
    );

    let kind = IndexBuildKind::ForceRebuild;
    let Some(settings) = read_build_settings(state, &profile_id, kind)? else {
        return Ok(());
    };
    let scheduled = ScheduledBuild {
        kind,
        session_id,
        profile_id,
        settings,
    };
    schedule_index_build(app_handle, state, scheduled)
}

#[cfg(coverage)]
pub async fn force_rebuild_schema_index_impl(
    state: &AppState,
    session_id: String,
) -> Result<(), String> {
    let profile_id = resolve_session_profile(state, &session_id)?;

    if let Some(old_token) = take_in_flight_build(state, &profile_id)? {
        old_token.cancel();
    }
    wipe_profile_chunks(state, &profile_id)?;

    let embedding_model = read_setting(&state.db, EMBEDDING_MODEL_SETTING)?;
    if embedding_model.is_empty() {
        return Ok(());
    }

    let endpoint = read_embedding_endpoint(&state.db)?;
    if endpoint.is_empty() {
        tracing::warn!(profile_id = %profile_id, "Force rebuild skipped: no embedding endpoint configured");
        return Ok(());
    }

    Ok(())
}

#[cfg(not(coverage))]
pub async fn build_schema_index_impl(
    app_handle: tauri::AppHandle,
    state: &AppState,
    session_id: String,
) -> Result<(), String> {
    let profile_id = resolve_session_profile(state, &session_id)?;
    register_session_profile(state, &session_id, &profile_id)?;

    if is_build_in_progress(state, &profile_id)? {
        tracing::info!(
            session_id = %session_id,
            profile_id = %profile_id,
            at = %Utc::now().to_rfc3339(),
            "schema_index build: request ignored — embedding index build already in progress for profile"
        );
        return Ok(());
    }

    let kind = IndexBuildKind::Build;
    let Some(settings) = read_build_settings(state, &profile_id, kind)? else {
        return Ok(());
    };
    let scheduled = ScheduledBuild {
        kind,
        session_id,
        profile_id,
        settings,
    };
    schedule_index_build(app_handle, state, scheduled)
}

#[cfg(coverage)]
pub async fn build_schema_index_impl(state: &AppState, session_id: String) -> Result<(), String> {
    let profile_id = resolve_session_profile(state, &session_id)?;
    register_session_profile(state, &session_id, &profile_id)?;

    if is_build_in_progress(state, &profile_id)? {
        return Ok(());
    }

    let embedding_model = read_setting(&state.db, EMBEDDING_MODEL_SETTING)?;
    if embedding_model.is_empty() {
        return Ok(());
    }

    let endpoint = read_embedding_endpoint(&state.db)?;
    if endpoint.is_empty() {
        tracing::warn!(profile_id = %profile_id, "Schema index build skipped: no embedding endpoint configured");
        return Ok(());
    }

    Ok(())
}
