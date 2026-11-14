use super::*;

#[cfg(not(coverage))]
pub(super) fn parse_qualified_tables(tables: &[String]) -> Vec<(String, String)> {
    tables
        .iter()
        .filter_map(|qualified_table| {
            let Some((db_name, table_name)) = qualified_table.split_once('.') else {
                tracing::warn!(table = %qualified_table, "Invalid table format, expected 'db_name.table_name'");
                return None;
            };
            Some((db_name.to_string(), table_name.to_string()))
        })
        .collect()
}

#[cfg(not(coverage))]
pub(super) struct PartialRebuildJob {
    app_handle: tauri::AppHandle,
    profile_id: String,
    config: BuildConfig,
    tables: Vec<(String, String)>,
    db: std::sync::Arc<Mutex<rusqlite::Connection>>,
    http_client: reqwest::Client,
    pool: sqlx::MySqlPool,
}

#[cfg(not(coverage))]
pub(super) async fn run_partial_rebuild_job(job: PartialRebuildJob) {
    tracing::info!(
        profile_id = %job.profile_id,
        task_started_at = %Utc::now().to_rfc3339(),
        tables = ?job.tables,
        "schema_index invalidate: background task started"
    );
    let token = CancellationToken::new();
    let resources = builder::IndexBuildResources {
        sqlite_conn: &job.db,
        mysql_pool: &job.pool,
        http_client: &job.http_client,
        cancellation: &token,
    };
    let Err(error) = builder::rebuild_tables(&job.config, &job.tables, &resources).await else {
        tracing::info!(
            profile_id = %job.profile_id,
            completed_at = %Utc::now().to_rfc3339(),
            tables = ?job.tables,
            "schema_index invalidate: partial rebuild and follow-up incremental build completed"
        );
        return;
    };
    tracing::error!(
        profile_id = %job.profile_id,
        error = %error,
        failed_at = %Utc::now().to_rfc3339(),
        "Schema index partial rebuild failed"
    );
    let payload = IndexErrorPayload {
        profile_id: job.profile_id.clone(),
        error,
    };
    let _ = job.app_handle.emit("schema-index-error", &payload);
}

#[cfg(not(coverage))]
pub async fn invalidate_schema_index_impl(
    app_handle: tauri::AppHandle,
    state: &AppState,
    request: InvalidateSchemaIndexRequest,
) -> Result<(), String> {
    let InvalidateSchemaIndexRequest { session_id, tables } = request;
    let profile_id = resolve_session_profile(state, &session_id)?;

    let embedding_model = read_setting(&state.db, EMBEDDING_MODEL_SETTING)?;
    let endpoint = read_embedding_endpoint(&state.db)?;
    if embedding_model.is_empty() {
        return Ok(());
    }

    let parsed_tables = parse_qualified_tables(&tables);
    if parsed_tables.is_empty() {
        return Ok(());
    }

    let pool = state
        .registry
        .get_pool(&session_id)
        .ok_or_else(|| format!("No MySQL pool for session '{session_id}'"))?;

    tracing::info!(
        session_id = %session_id,
        profile_id = %profile_id,
        model_id = %embedding_model,
        table_targets = parsed_tables.len(),
        targets = ?parsed_tables,
        scheduled_at = %Utc::now().to_rfc3339(),
        "schema_index invalidate: scheduling partial embedding index rebuild (background task)"
    );

    let job = PartialRebuildJob {
        app_handle,
        profile_id: profile_id.clone(),
        config: BuildConfig {
            connection_id: profile_id,
            model_id: embedding_model,
            endpoint,
        },
        tables: parsed_tables,
        db: state.db.clone(),
        http_client: state.http_client.clone(),
        pool,
    };
    tokio::task::spawn(run_partial_rebuild_job(job));
    Ok(())
}

#[cfg(coverage)]
pub async fn invalidate_schema_index_impl(
    state: &AppState,
    request: InvalidateSchemaIndexRequest,
) -> Result<(), String> {
    let _profile_id = resolve_session_profile(state, &request.session_id)?;
    Ok(())
}

pub fn list_indexed_tables_impl(
    state: &AppState,
    session_id: String,
) -> Result<Vec<IndexedTableInfo>, String> {
    let profile_id = resolve_session_profile(state, &session_id)?;

    let conn = state
        .db
        .lock()
        .map_err(|error| format!("DB lock error: {error}"))?;

    let chunks = storage::list_chunks(&conn, &profile_id)
        .map_err(|error| format!("Failed to list chunks: {error}"))?;

    let results = chunks
        .into_iter()
        .map(|chunk| IndexedTableInfo {
            db_name: chunk.db_name,
            table_name: chunk.table_name,
            chunk_type: chunk.chunk_type.as_str().to_string(),
            embedded_at: chunk.embedded_at,
            model_id: chunk.model_id,
        })
        .collect();

    Ok(results)
}
