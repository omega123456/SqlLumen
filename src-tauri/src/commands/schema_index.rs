//! Tauri commands for schema index operations — build, search, status, invalidation, listing.

use crate::db::settings;
use crate::schema_index::{builder, embeddings, search, storage, types::BuildConfig};
use crate::state::AppState;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[cfg(not(coverage))]
use tauri::{Emitter, State};

// ── Response types ──────────────────────────────────────────────────────────

/// Re-export `SearchResult` from the search module so existing consumers
/// (Tauri commands, tests) can keep using `commands::schema_index::SearchResult`.
pub use crate::schema_index::search::SearchResult;

/// Status response for a schema index.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatusResponse {
    pub status: String,
    pub tables_done: Option<usize>,
    pub tables_total: Option<usize>,
    pub error: Option<String>,
}

/// Info about an indexed table.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedTableInfo {
    pub db_name: String,
    pub table_name: String,
    pub chunk_type: String,
    pub embedded_at: String,
    pub model_id: String,
}

/// Error event payload for schema index builds.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexErrorPayload {
    pub profile_id: String,
    pub error: String,
}

// ── Helper: resolve session_id → profile_id via registry ────────────────────

fn resolve_profile_id(state: &AppState, session_id: &str) -> Result<String, String> {
    state
        .registry
        .get_profile_id(session_id)
        .ok_or_else(|| format!("Session '{session_id}' not found in registry"))
}

/// Read a setting from the SQLite DB, returning empty string if not set.
fn read_setting(
    db: &std::sync::Arc<Mutex<rusqlite::Connection>>,
    key: &str,
) -> Result<String, String> {
    let conn = db.lock().map_err(|e| format!("DB lock error: {e}"))?;
    settings::get_setting(&conn, key)
        .map_err(|e| format!("Failed to read setting '{key}': {e}"))?
        .ok_or_else(|| String::new()) // return empty string error for "not set"
        .or(Ok(String::new()))
}

// ── Testable _impl functions ────────────────────────────────────────────────

/// Force-wipe all existing schema index chunks for a connection profile,
/// then trigger a full fresh rebuild. Cancels any in-flight build first.
#[cfg(not(coverage))]
pub async fn force_rebuild_schema_index_impl(
    app_handle: tauri::AppHandle,
    state: &AppState,
    session_id: String,
) -> Result<(), String> {
    let profile_id = resolve_profile_id(state, &session_id)?;

    // Check if session is already registered (avoid inflating ref count on repeated force rebuilds)
    let already_registered = {
        let map = state
            .session_profile_map
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        map.contains_key(&session_id)
    };

    if !already_registered {
        // Record session → profile mapping (same as build_schema_index_impl)
        {
            let mut map = state
                .session_profile_map
                .lock()
                .map_err(|e| format!("Lock error: {e}"))?;
            map.insert(session_id.clone(), profile_id.clone());
        }

        // Increment ref count if not already tracked
        {
            let mut counts = state
                .session_ref_counts
                .lock()
                .map_err(|e| format!("Lock error: {e}"))?;
            let count = counts.entry(profile_id.clone()).or_insert(0);
            *count += 1;
        }
    }

    // Cancel any in-flight build for this profile
    {
        let mut tokens = state
            .index_build_tokens
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        if let Some(old_token) = tokens.remove(&profile_id) {
            tracing::info!(
                profile_id = %profile_id,
                at = %Utc::now().to_rfc3339(),
                "schema_index force_rebuild: cancelling in-flight build for profile before wipe"
            );
            old_token.cancel();
        }
    }

    // Wipe all existing chunks and vectors for this profile
    {
        let conn = state.db.lock().map_err(|e| format!("DB lock error: {e}"))?;
        storage::delete_all_chunks(&conn, &profile_id)
            .map_err(|e| format!("Failed to delete chunks for profile '{profile_id}': {e}"))?;
    }
    tracing::info!(
        profile_id = %profile_id,
        at = %Utc::now().to_rfc3339(),
        "schema_index force_rebuild: wiped all stored chunks and vectors for profile"
    );

    // Read AI settings
    let embedding_model = read_setting(&state.db, "ai.embeddingModel")?;
    let endpoint = read_setting(&state.db, "ai.endpoint")?;

    if embedding_model.is_empty() {
        tracing::info!(profile_id = %profile_id, "Force rebuild skipped: no embedding model configured");
        return Ok(());
    }

    if endpoint.is_empty() {
        tracing::warn!(profile_id = %profile_id, "Force rebuild skipped: no endpoint configured");
        return Ok(());
    }

    // Create cancellation token and store it
    let token = CancellationToken::new();
    {
        let mut tokens = state
            .index_build_tokens
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        tokens.insert(profile_id.clone(), token.clone());
    }

    // Get MySQL pool for this session
    let pool = state
        .registry
        .get_pool(&session_id)
        .ok_or_else(|| format!("No MySQL pool for session '{session_id}'"))?;

    let config = BuildConfig {
        connection_id: profile_id.clone(),
        model_id: embedding_model.clone(),
        endpoint: endpoint.clone(),
    };

    let db = state.db.clone();
    let http_client = state.http_client.clone();
    let build_tokens = state.index_build_tokens.clone();
    let profile_id_clone = profile_id.clone();

    tracing::info!(
        session_id = %session_id,
        profile_id = %profile_id,
        model_id = %embedding_model,
        scheduled_at = %Utc::now().to_rfc3339(),
        "schema_index force_rebuild: scheduling full embedding index rebuild (background task)"
    );

    tokio::task::spawn(async move {
        tracing::info!(
            profile_id = %profile_id_clone,
            task_started_at = %Utc::now().to_rfc3339(),
            "schema_index force_rebuild: background task started"
        );

        let app_handle_progress = app_handle.clone();

        let on_progress: crate::schema_index::types::ProgressCallback =
            Box::new(move |progress: crate::schema_index::types::BuildProgress| {
                let _ = app_handle_progress.emit("schema-index-progress", &progress);
            });

        let result = builder::build_index(
            &config,
            &db,
            &pool,
            &http_client,
            Some(&on_progress),
            &token,
        )
        .await;

        match result {
            Ok(build_result) => {
                tracing::info!(
                    profile_id = %profile_id_clone,
                    completed_at = %Utc::now().to_rfc3339(),
                    tables_indexed = build_result.tables_indexed,
                    duration_ms = build_result.duration_ms,
                    "schema_index force_rebuild: background task completed successfully"
                );
                let _ = app_handle.emit("schema-index-complete", &build_result);
            }
            Err(err) => {
                tracing::error!(
                    profile_id = %profile_id_clone,
                    error = %err,
                    failed_at = %Utc::now().to_rfc3339(),
                    "Schema index force rebuild failed"
                );

                if let Ok(conn) = db.lock() {
                    let _ = storage::update_index_status(
                        &conn,
                        &profile_id_clone,
                        &crate::schema_index::types::IndexStatus::Error,
                    );
                }

                let _ = app_handle.emit(
                    "schema-index-error",
                    &IndexErrorPayload {
                        profile_id: profile_id_clone.clone(),
                        error: err,
                    },
                );
            }
        }

        // Clean up the token
        if let Ok(mut tokens) = build_tokens.lock() {
            tokens.remove(&profile_id_clone);
        }
    });

    Ok(())
}

#[cfg(coverage)]
pub async fn force_rebuild_schema_index_impl(
    state: &AppState,
    session_id: String,
) -> Result<(), String> {
    let profile_id = resolve_profile_id(state, &session_id)?;

    // Cancel any in-flight build for this profile
    {
        let mut tokens = state
            .index_build_tokens
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        if let Some(old_token) = tokens.remove(&profile_id) {
            old_token.cancel();
        }
    }

    // Wipe all existing chunks and vectors for this profile
    {
        let conn = state.db.lock().map_err(|e| format!("DB lock error: {e}"))?;
        storage::delete_all_chunks(&conn, &profile_id)
            .map_err(|e| format!("Failed to delete chunks for profile '{profile_id}': {e}"))?;
    }

    let embedding_model = read_setting(&state.db, "ai.embeddingModel")?;
    if embedding_model.is_empty() {
        return Ok(());
    }

    let endpoint = read_setting(&state.db, "ai.endpoint")?;
    if endpoint.is_empty() {
        tracing::warn!(profile_id = %profile_id, "Force rebuild skipped: no endpoint configured");
        return Ok(());
    }

    Ok(())
}

/// Build the schema index for a connection session. Returns immediately;
/// the actual build runs in a background task.
#[cfg(not(coverage))]
pub async fn build_schema_index_impl(
    app_handle: tauri::AppHandle,
    state: &AppState,
    session_id: String,
) -> Result<(), String> {
    let profile_id = resolve_profile_id(state, &session_id)?;

    // Check if session is already registered (avoid inflating ref count on repeated builds)
    let already_registered = {
        let map = state
            .session_profile_map
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        map.contains_key(&session_id)
    };

    if !already_registered {
        // Record session → profile mapping
        {
            let mut map = state
                .session_profile_map
                .lock()
                .map_err(|e| format!("Lock error: {e}"))?;
            map.insert(session_id.clone(), profile_id.clone());
        }

        // Increment ref count
        {
            let mut counts = state
                .session_ref_counts
                .lock()
                .map_err(|e| format!("Lock error: {e}"))?;
            let count = counts.entry(profile_id.clone()).or_insert(0);
            *count += 1;
        }
    }

    // Check if build already in progress for this profile
    {
        let tokens = state
            .index_build_tokens
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        if tokens.contains_key(&profile_id) {
            tracing::info!(
                session_id = %session_id,
                profile_id = %profile_id,
                at = %Utc::now().to_rfc3339(),
                "schema_index build: request ignored — embedding index build already in progress for profile"
            );
            return Ok(()); // no-op — build already running
        }
    }

    // Read AI settings
    let embedding_model = read_setting(&state.db, "ai.embeddingModel")?;
    let endpoint = read_setting(&state.db, "ai.endpoint")?;

    if embedding_model.is_empty() {
        // Not configured — update status and return
        tracing::info!(profile_id = %profile_id, "Schema index build skipped: no embedding model configured");
        return Ok(());
    }

    if endpoint.is_empty() {
        tracing::warn!(profile_id = %profile_id, "Schema index build skipped: no endpoint configured");
        return Ok(());
    }

    // Create cancellation token and store it
    let token = CancellationToken::new();
    {
        let mut tokens = state
            .index_build_tokens
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        tokens.insert(profile_id.clone(), token.clone());
    }

    // Get MySQL pool for this session
    let pool = state
        .registry
        .get_pool(&session_id)
        .ok_or_else(|| format!("No MySQL pool for session '{session_id}'"))?;

    let config = BuildConfig {
        connection_id: profile_id.clone(),
        model_id: embedding_model.clone(),
        endpoint: endpoint.clone(),
    };

    let db = state.db.clone();
    let http_client = state.http_client.clone();
    let build_tokens = state.index_build_tokens.clone();
    let profile_id_clone = profile_id.clone();

    tracing::info!(
        session_id = %session_id,
        profile_id = %profile_id,
        model_id = %embedding_model,
        scheduled_at = %Utc::now().to_rfc3339(),
        "schema_index build: scheduling embedding index build (background task)"
    );

    tokio::task::spawn(async move {
        tracing::info!(
            profile_id = %profile_id_clone,
            task_started_at = %Utc::now().to_rfc3339(),
            "schema_index build: background task started"
        );

        let app_handle_progress = app_handle.clone();

        let on_progress: crate::schema_index::types::ProgressCallback =
            Box::new(move |progress: crate::schema_index::types::BuildProgress| {
                let _ = app_handle_progress.emit("schema-index-progress", &progress);
            });

        let result = builder::build_index(
            &config,
            &db,
            &pool,
            &http_client,
            Some(&on_progress),
            &token,
        )
        .await;

        match result {
            Ok(build_result) => {
                tracing::info!(
                    profile_id = %profile_id_clone,
                    completed_at = %Utc::now().to_rfc3339(),
                    tables_indexed = build_result.tables_indexed,
                    duration_ms = build_result.duration_ms,
                    "schema_index build: background task completed successfully"
                );
                let _ = app_handle.emit("schema-index-complete", &build_result);
            }
            Err(err) => {
                tracing::error!(
                    profile_id = %profile_id_clone,
                    error = %err,
                    failed_at = %Utc::now().to_rfc3339(),
                    "Schema index build failed"
                );

                // Update status to error
                if let Ok(conn) = db.lock() {
                    let _ = storage::update_index_status(
                        &conn,
                        &profile_id_clone,
                        &crate::schema_index::types::IndexStatus::Error,
                    );
                }

                let _ = app_handle.emit(
                    "schema-index-error",
                    &IndexErrorPayload {
                        profile_id: profile_id_clone.clone(),
                        error: err,
                    },
                );
            }
        }

        // Clean up the token
        if let Ok(mut tokens) = build_tokens.lock() {
            tokens.remove(&profile_id_clone);
        }
    });

    Ok(())
}

#[cfg(coverage)]
pub async fn build_schema_index_impl(state: &AppState, session_id: String) -> Result<(), String> {
    let profile_id = resolve_profile_id(state, &session_id)?;

    // Check if session is already registered (avoid inflating ref count on repeated builds)
    let already_registered = {
        let map = state
            .session_profile_map
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        map.contains_key(&session_id)
    };

    if !already_registered {
        // Record session → profile mapping
        {
            let mut map = state
                .session_profile_map
                .lock()
                .map_err(|e| format!("Lock error: {e}"))?;
            map.insert(session_id.clone(), profile_id.clone());
        }

        // Increment ref count
        {
            let mut counts = state
                .session_ref_counts
                .lock()
                .map_err(|e| format!("Lock error: {e}"))?;
            let count = counts.entry(profile_id.clone()).or_insert(0);
            *count += 1;
        }
    }

    // Check if build already in progress for this profile
    {
        let tokens = state
            .index_build_tokens
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        if tokens.contains_key(&profile_id) {
            return Ok(());
        }
    }

    let embedding_model = read_setting(&state.db, "ai.embeddingModel")?;
    if embedding_model.is_empty() {
        return Ok(());
    }

    let endpoint = read_setting(&state.db, "ai.endpoint")?;
    if endpoint.is_empty() {
        tracing::warn!(profile_id = %profile_id, "Schema index build skipped: no endpoint configured");
        return Ok(());
    }

    Ok(())
}

/// Semantic search against the schema index — full multi-query pipeline
/// with dedup, re-ranking, and FK edge chunk auto-inclusion.
#[cfg(not(coverage))]
pub async fn semantic_search_impl(
    state: &AppState,
    session_id: String,
    queries: Vec<String>,
) -> Result<Vec<SearchResult>, String> {
    let profile_id = resolve_profile_id(state, &session_id)?;

    tracing::debug!(
        session_id = %session_id,
        profile_id = %profile_id,
        query_count = queries.len(),
        queries = ?queries,
        "semantic_search: incoming request"
    );

    let embedding_model = read_setting(&state.db, "ai.embeddingModel")?;
    let endpoint = read_setting(&state.db, "ai.endpoint")?;

    tracing::debug!(
        profile_id = %profile_id,
        embedding_model = %embedding_model,
        endpoint_set = !endpoint.is_empty(),
        "semantic_search: resolved embedding configuration"
    );

    if embedding_model.is_empty() {
        tracing::warn!(profile_id = %profile_id, "semantic_search: aborted — no embedding model configured");
        return Err("No embedding model configured".to_string());
    }

    if queries.is_empty() {
        tracing::debug!(profile_id = %profile_id, "semantic_search: empty query list — returning early");
        return Ok(vec![]);
    }

    tracing::debug!(
        profile_id = %profile_id,
        query_count = queries.len(),
        model = %embedding_model,
        "semantic_search: embedding queries"
    );

    // Embed all query strings in one batch
    let query_vectors = embeddings::embed_texts(
        &state.http_client,
        &endpoint,
        &embedding_model,
        queries.clone(),
    )
    .await
    .map_err(|e| format!("Embedding failed: {e}"))?;

    tracing::debug!(
        profile_id = %profile_id,
        vector_count = query_vectors.len(),
        vector_dims = query_vectors.first().map(|v| v.len()).unwrap_or(0),
        "semantic_search: embedding complete"
    );

    let conn = state.db.lock().map_err(|e| format!("DB lock error: {e}"))?;

    tracing::debug!(
        profile_id = %profile_id,
        "semantic_search: running multi_query_search (top_k_per_query=5, top_n_results=10, max_fk_chunks=20)"
    );

    let results = search::multi_query_search_with_query_texts(
        &conn,
        &profile_id,
        &queries,
        &query_vectors,
        5,
        10,
        20,
    )
    .map_err(|e| format!("Search failed: {e}"))?;

    tracing::debug!(
        profile_id = %profile_id,
        result_count = results.len(),
        top_results = ?results.iter().take(5).map(|r| (&r.table_name, &r.chunk_type, r.score)).collect::<Vec<_>>(),
        "semantic_search: complete"
    );

    Ok(results)
}

#[cfg(coverage)]
pub async fn semantic_search_impl(
    state: &AppState,
    session_id: String,
    queries: Vec<String>,
) -> Result<Vec<SearchResult>, String> {
    let _profile_id = resolve_profile_id(state, &session_id)?;

    tracing::debug!(
        session_id = %session_id,
        query_count = queries.len(),
        "semantic_search (coverage stub): incoming request"
    );

    let embedding_model = read_setting(&state.db, "ai.embeddingModel")?;
    if embedding_model.is_empty() {
        tracing::warn!(session_id = %session_id, "semantic_search (coverage stub): aborted — no embedding model configured");
        return Err("No embedding model configured".to_string());
    }

    if queries.is_empty() {
        tracing::debug!(session_id = %session_id, "semantic_search (coverage stub): empty query list — returning early");
        return Ok(vec![]);
    }

    // Coverage stub — cannot embed without a real endpoint
    tracing::debug!(session_id = %session_id, "semantic_search (coverage stub): returning stub error");
    Err("Coverage stub: semantic search not available".to_string())
}

/// Get the current status of the schema index for a session.
pub fn get_index_status_impl(
    state: &AppState,
    session_id: String,
) -> Result<IndexStatusResponse, String> {
    // 1. Resolve session → profile
    let profile_id = match state.session_profile_map.lock() {
        Ok(map) => map.get(&session_id).cloned(),
        Err(e) => return Err(format!("Lock error: {e}")),
    };

    // Also try the registry if session_profile_map doesn't have it
    let profile_id = match profile_id {
        Some(pid) => pid,
        None => match state.registry.get_profile_id(&session_id) {
            Some(pid) => pid,
            None => {
                return Ok(IndexStatusResponse {
                    status: "not_configured".to_string(),
                    tables_done: None,
                    tables_total: None,
                    error: None,
                });
            }
        },
    };

    // 2. Check if embedding model and endpoint are configured
    let embedding_model = read_setting(&state.db, "ai.embeddingModel")?;
    if embedding_model.is_empty() {
        return Ok(IndexStatusResponse {
            status: "not_configured".to_string(),
            tables_done: None,
            tables_total: None,
            error: None,
        });
    }

    let endpoint = read_setting(&state.db, "ai.endpoint")?;
    if endpoint.is_empty() {
        return Ok(IndexStatusResponse {
            status: "not_configured".to_string(),
            tables_done: None,
            tables_total: None,
            error: None,
        });
    }

    // 3. Check if build is in progress
    {
        let tokens = state
            .index_build_tokens
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        if tokens.contains_key(&profile_id) {
            return Ok(IndexStatusResponse {
                status: "building".to_string(),
                tables_done: None,
                tables_total: None,
                error: None,
            });
        }
    }

    // 4. Check schema_index_meta for this profile
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {e}"))?;

    let meta = storage::get_index_meta(&conn, &profile_id)
        .map_err(|e| format!("Failed to get index meta: {e}"))?;

    match meta {
        None => Ok(IndexStatusResponse {
            status: "stale".to_string(),
            tables_done: None,
            tables_total: None,
            error: None,
        }),
        Some(m) => {
            // 5. If model changed, it's stale
            if m.model_id != embedding_model {
                return Ok(IndexStatusResponse {
                    status: "stale".to_string(),
                    tables_done: None,
                    tables_total: None,
                    error: None,
                });
            }

            // 6. Return the stored status
            Ok(IndexStatusResponse {
                status: m.status.as_str().to_string(),
                tables_done: None,
                tables_total: None,
                error: None,
            })
        }
    }
}

/// Invalidate (partial rebuild) the schema index for specific tables.
/// Returns immediately; the rebuild runs in a background task.
#[cfg(not(coverage))]
pub async fn invalidate_schema_index_impl(
    app_handle: tauri::AppHandle,
    state: &AppState,
    session_id: String,
    tables: Vec<String>,
) -> Result<(), String> {
    let profile_id = resolve_profile_id(state, &session_id)?;

    let embedding_model = read_setting(&state.db, "ai.embeddingModel")?;
    let endpoint = read_setting(&state.db, "ai.endpoint")?;

    if embedding_model.is_empty() {
        return Ok(());
    }

    // Parse "db_name.table_name" strings
    let parsed_tables: Vec<(String, String)> = tables
        .iter()
        .filter_map(|t| {
            let parts: Vec<&str> = t.splitn(2, '.').collect();
            if parts.len() == 2 {
                Some((parts[0].to_string(), parts[1].to_string()))
            } else {
                tracing::warn!(table = %t, "Invalid table format, expected 'db_name.table_name'");
                None
            }
        })
        .collect();

    if parsed_tables.is_empty() {
        return Ok(());
    }

    // Get MySQL pool
    let pool = state
        .registry
        .get_pool(&session_id)
        .ok_or_else(|| format!("No MySQL pool for session '{session_id}'"))?;

    let config = BuildConfig {
        connection_id: profile_id.clone(),
        model_id: embedding_model.clone(),
        endpoint: endpoint.clone(),
    };

    let db = state.db.clone();
    let http_client = state.http_client.clone();
    let token = CancellationToken::new();

    tracing::info!(
        session_id = %session_id,
        profile_id = %profile_id,
        model_id = %embedding_model,
        table_targets = parsed_tables.len(),
        targets = ?parsed_tables,
        scheduled_at = %Utc::now().to_rfc3339(),
        "schema_index invalidate: scheduling partial embedding index rebuild (background task)"
    );

    tokio::task::spawn(async move {
        tracing::info!(
            profile_id = %profile_id,
            task_started_at = %Utc::now().to_rfc3339(),
            tables = ?parsed_tables,
            "schema_index invalidate: background task started"
        );

        match builder::rebuild_tables(&config, &parsed_tables, &db, &pool, &http_client, &token)
            .await
        {
            Ok(()) => {
                tracing::info!(
                    profile_id = %profile_id,
                    completed_at = %Utc::now().to_rfc3339(),
                    tables = ?parsed_tables,
                    "schema_index invalidate: partial rebuild and follow-up incremental build completed"
                );
            }
            Err(err) => {
                tracing::error!(
                    profile_id = %profile_id,
                    error = %err,
                    failed_at = %Utc::now().to_rfc3339(),
                    "Schema index partial rebuild failed"
                );
                let _ = app_handle.emit(
                    "schema-index-error",
                    &IndexErrorPayload {
                        profile_id: profile_id.clone(),
                        error: err,
                    },
                );
            }
        }
    });

    Ok(())
}

#[cfg(coverage)]
pub async fn invalidate_schema_index_impl(
    state: &AppState,
    session_id: String,
    tables: Vec<String>,
) -> Result<(), String> {
    let _profile_id = resolve_profile_id(state, &session_id)?;
    let _ = tables;
    Ok(())
}

/// List all indexed table chunks for a session's connection profile.
pub fn list_indexed_tables_impl(
    state: &AppState,
    session_id: String,
) -> Result<Vec<IndexedTableInfo>, String> {
    let profile_id = resolve_profile_id(state, &session_id)?;

    let conn = state.db.lock().map_err(|e| format!("DB lock error: {e}"))?;

    let chunks = storage::list_chunks(&conn, &profile_id)
        .map_err(|e| format!("Failed to list chunks: {e}"))?;

    let results = chunks
        .into_iter()
        .map(|c| IndexedTableInfo {
            db_name: c.db_name,
            table_name: c.table_name,
            chunk_type: c.chunk_type.as_str().to_string(),
            embedded_at: c.embedded_at,
            model_id: c.model_id,
        })
        .collect();

    Ok(results)
}

// ── Thin Tauri command wrappers ─────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub async fn build_schema_index(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    build_schema_index_impl(app_handle, &state, session_id).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn force_rebuild_schema_index(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    force_rebuild_schema_index_impl(app_handle, &state, session_id).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn semantic_search(
    state: State<'_, AppState>,
    session_id: String,
    queries: Vec<String>,
) -> Result<Vec<SearchResult>, String> {
    semantic_search_impl(&state, session_id, queries).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn get_index_status(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<IndexStatusResponse, String> {
    get_index_status_impl(&state, session_id)
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn invalidate_schema_index(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    tables: Vec<String>,
) -> Result<(), String> {
    invalidate_schema_index_impl(app_handle, &state, session_id, tables).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn list_indexed_tables(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<IndexedTableInfo>, String> {
    list_indexed_tables_impl(&state, session_id)
}
