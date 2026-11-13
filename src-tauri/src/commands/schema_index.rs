//! Tauri commands for schema index operations — build, search, status, invalidation, listing.

use crate::db::settings;
use crate::schema_index::search::RetrievalHints;
use crate::schema_index::storage;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[cfg(not(coverage))]
use crate::schema_index::embeddings_cache::EmbeddingCacheKey;
#[cfg(not(coverage))]
use crate::schema_index::search;
#[cfg(not(coverage))]
use crate::schema_index::search::SearchConfigExt;
#[cfg(not(coverage))]
use crate::schema_index::{builder, embeddings, rerank, types::BuildConfig};
#[cfg(not(coverage))]
use chrono::Utc;
#[cfg(not(coverage))]
use tokio_util::sync::CancellationToken;

#[cfg(not(coverage))]
use tauri::{Emitter, State};

// ── Response types ──────────────────────────────────────────────────────────

/// Re-export `SearchResult` from the search module so existing consumers
/// (Tauri commands, tests) can keep using `commands::schema_index::SearchResult`.
pub use crate::schema_index::search::SearchResult;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchRequest {
    pub session_id: String,
    pub queries: Vec<String>,
    pub hints: Option<RetrievalHints>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvalidateSchemaIndexRequest {
    pub session_id: String,
    pub tables: Vec<String>,
}

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

use super::helpers::resolve_session_profile;

// ── Helper: read settings ───────────────────────────────────────────────────
fn read_setting(
    db: &std::sync::Arc<Mutex<rusqlite::Connection>>,
    key: &str,
) -> Result<String, String> {
    let conn = db
        .lock()
        .map_err(|error| format!("DB lock error: {error}"))?;
    settings::get_setting(&conn, key)
        .map_err(|error| format!("Failed to read setting '{key}': {error}"))?
        .ok_or_else(String::new) // return empty string error for "not set"
        .or(Ok(String::new()))
}

/// Resolve the *effective* embedding endpoint (the dedicated `ai.embeddingEndpoint`
/// when set, otherwise the chat URL `ai.endpoint`). Locks the shared settings DB
/// mutex and delegates to the single source of truth in `ai_memory`.
fn read_embedding_endpoint(
    db: &std::sync::Arc<Mutex<rusqlite::Connection>>,
) -> Result<String, String> {
    let conn = db
        .lock()
        .map_err(|error| format!("DB lock error: {error}"))?;
    crate::ai_memory::resolve_embedding_endpoint(&conn)
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
    let profile_id = resolve_session_profile(state, &session_id)?;

    // Check if session is already registered (avoid inflating ref count on repeated force rebuilds)
    let already_registered = {
        let map = state
            .session_profile_map
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?;
        map.contains_key(&session_id)
    };

    if !already_registered {
        // Record session → profile mapping (same as build_schema_index_impl)
        {
            let mut map = state
                .session_profile_map
                .lock()
                .map_err(|error| format!("Lock error: {error}"))?;
            map.insert(session_id.clone(), profile_id.clone());
        }

        // Increment ref count if not already tracked
        {
            let mut counts = state
                .session_ref_counts
                .lock()
                .map_err(|error| format!("Lock error: {error}"))?;
            let count = counts.entry(profile_id.clone()).or_insert(0);
            *count += 1;
        }
    }

    // Cancel any in-flight build for this profile
    {
        let mut tokens = state
            .index_build_tokens
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?;
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
        let conn = state
            .db
            .lock()
            .map_err(|error| format!("DB lock error: {error}"))?;
        storage::delete_all_chunks(&conn, &profile_id).map_err(|error| {
            format!("Failed to delete chunks for profile '{profile_id}': {error}")
        })?;
    }
    tracing::info!(
        profile_id = %profile_id,
        at = %Utc::now().to_rfc3339(),
        "schema_index force_rebuild: wiped all stored chunks and vectors for profile"
    );

    // Read AI settings (embedding endpoint resolves with chat-URL fallback)
    let embedding_model = read_setting(&state.db, "ai.embeddingModel")?;
    let endpoint = read_embedding_endpoint(&state.db)?;

    if embedding_model.is_empty() {
        tracing::info!(profile_id = %profile_id, "Force rebuild skipped: no embedding model configured");
        return Ok(());
    }

    if endpoint.is_empty() {
        tracing::warn!(profile_id = %profile_id, "Force rebuild skipped: no embedding endpoint configured");
        return Ok(());
    }

    // Create cancellation token and store it
    let token = CancellationToken::new();
    {
        let mut tokens = state
            .index_build_tokens
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?;
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

        let resources = builder::IndexBuildResources {
            sqlite_conn: &db,
            mysql_pool: &pool,
            http_client: &http_client,
            cancellation: &token,
        };
        let result = builder::build_index(&config, &resources, Some(&on_progress)).await;

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
            Err(error) => {
                tracing::error!(
                    profile_id = %profile_id_clone,
                    error = %error,
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
                        error,
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
    let profile_id = resolve_session_profile(state, &session_id)?;

    // Cancel any in-flight build for this profile
    {
        let mut tokens = state
            .index_build_tokens
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?;
        if let Some(old_token) = tokens.remove(&profile_id) {
            old_token.cancel();
        }
    }

    // Wipe all existing chunks and vectors for this profile
    {
        let conn = state
            .db
            .lock()
            .map_err(|error| format!("DB lock error: {error}"))?;
        storage::delete_all_chunks(&conn, &profile_id).map_err(|error| {
            format!("Failed to delete chunks for profile '{profile_id}': {error}")
        })?;
    }

    let embedding_model = read_setting(&state.db, "ai.embeddingModel")?;
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

/// Build the schema index for a connection session. Returns immediately;
/// the actual build runs in a background task.
#[cfg(not(coverage))]
pub async fn build_schema_index_impl(
    app_handle: tauri::AppHandle,
    state: &AppState,
    session_id: String,
) -> Result<(), String> {
    let profile_id = resolve_session_profile(state, &session_id)?;

    // Check if session is already registered (avoid inflating ref count on repeated builds)
    let already_registered = {
        let map = state
            .session_profile_map
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?;
        map.contains_key(&session_id)
    };

    if !already_registered {
        // Record session → profile mapping
        {
            let mut map = state
                .session_profile_map
                .lock()
                .map_err(|error| format!("Lock error: {error}"))?;
            map.insert(session_id.clone(), profile_id.clone());
        }

        // Increment ref count
        {
            let mut counts = state
                .session_ref_counts
                .lock()
                .map_err(|error| format!("Lock error: {error}"))?;
            let count = counts.entry(profile_id.clone()).or_insert(0);
            *count += 1;
        }
    }

    // Check if build already in progress for this profile
    {
        let tokens = state
            .index_build_tokens
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?;
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

    // Read AI settings (embedding endpoint resolves with chat-URL fallback)
    let embedding_model = read_setting(&state.db, "ai.embeddingModel")?;
    let endpoint = read_embedding_endpoint(&state.db)?;

    if embedding_model.is_empty() {
        // Not configured — update status and return
        tracing::info!(profile_id = %profile_id, "Schema index build skipped: no embedding model configured");
        return Ok(());
    }

    if endpoint.is_empty() {
        tracing::warn!(profile_id = %profile_id, "Schema index build skipped: no embedding endpoint configured");
        return Ok(());
    }

    // Create cancellation token and store it
    let token = CancellationToken::new();
    {
        let mut tokens = state
            .index_build_tokens
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?;
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

        let resources = builder::IndexBuildResources {
            sqlite_conn: &db,
            mysql_pool: &pool,
            http_client: &http_client,
            cancellation: &token,
        };
        let result = builder::build_index(&config, &resources, Some(&on_progress)).await;

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
            Err(error) => {
                tracing::error!(
                    profile_id = %profile_id_clone,
                    error = %error,
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
                        error,
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
    let profile_id = resolve_session_profile(state, &session_id)?;

    // Check if session is already registered (avoid inflating ref count on repeated builds)
    let already_registered = {
        let map = state
            .session_profile_map
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?;
        map.contains_key(&session_id)
    };

    if !already_registered {
        // Record session → profile mapping
        {
            let mut map = state
                .session_profile_map
                .lock()
                .map_err(|error| format!("Lock error: {error}"))?;
            map.insert(session_id.clone(), profile_id.clone());
        }

        // Increment ref count
        {
            let mut counts = state
                .session_ref_counts
                .lock()
                .map_err(|error| format!("Lock error: {error}"))?;
            let count = counts.entry(profile_id.clone()).or_insert(0);
            *count += 1;
        }
    }

    // Check if build already in progress for this profile
    {
        let tokens = state
            .index_build_tokens
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?;
        if tokens.contains_key(&profile_id) {
            return Ok(());
        }
    }

    let embedding_model = read_setting(&state.db, "ai.embeddingModel")?;
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

/// Semantic search against the schema index — full multi-query pipeline
/// with dedup, re-ranking, graph walk, and usage-signal boosts.
#[cfg(not(coverage))]
pub async fn semantic_search_impl(
    state: &AppState,
    request: SemanticSearchRequest,
) -> Result<Vec<SearchResult>, String> {
    let SemanticSearchRequest {
        session_id,
        queries,
        hints,
    } = request;
    let profile_id = resolve_session_profile(state, &session_id)?;

    tracing::debug!(
        session_id = %session_id,
        profile_id = %profile_id,
        query_count = queries.len(),
        queries = ?queries,
        "semantic_search: incoming request"
    );

    let embedding_model = read_setting(&state.db, "ai.embeddingModel")?;
    // Embedding endpoint (dedicated URL with chat-URL fallback) — used for query embedding.
    let embedding_endpoint = read_embedding_endpoint(&state.db)?;
    // Chat endpoint (always the chat URL) — used for the LLM re-ranker (a chat model).
    let chat_endpoint = read_setting(&state.db, "ai.endpoint")?;

    tracing::debug!(
        profile_id = %profile_id,
        embedding_model = %embedding_model,
        embedding_endpoint_set = !embedding_endpoint.is_empty(),
        chat_endpoint_set = !chat_endpoint.is_empty(),
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

    // Read retrieval settings
    let top_k: usize = read_setting(&state.db, "ai.retrieval.topKPerQuery")
        .ok()
        .and_then(|text| text.parse().ok())
        .unwrap_or(30);
    let top_n: usize = read_setting(&state.db, "ai.retrieval.topN")
        .ok()
        .and_then(|text| text.parse().ok())
        .unwrap_or(20);
    let foreign_key_fanout_cap: usize = read_setting(&state.db, "ai.retrieval.fkFanoutCap")
        .ok()
        .and_then(|text| text.parse().ok())
        .unwrap_or(30);
    let lexical_weight: f64 = read_setting(&state.db, "ai.retrieval.lexicalWeight")
        .ok()
        .and_then(|text| text.parse().ok())
        .unwrap_or(0.2);
    let rerank_enabled: bool = read_setting(&state.db, "ai.retrieval.rerankEnabled")
        .ok()
        .map(|text| text == "true")
        .unwrap_or(false);
    let graph_depth: u32 = read_setting(&state.db, "ai.retrieval.graphDepth")
        .ok()
        .and_then(|text| text.parse().ok())
        .unwrap_or(2)
        .clamp(1, 3);
    let feedback_boost: f64 = read_setting(&state.db, "ai.retrieval.feedbackBoost")
        .ok()
        .and_then(|text| text.parse().ok())
        .unwrap_or(0.15);

    tracing::debug!(
        profile_id = %profile_id,
        query_count = queries.len(),
        model = %embedding_model,
        "semantic_search: embedding queries"
    );

    // Embed all query strings in one batch (with cache)
    let mut query_vectors: Vec<Vec<f32>> = Vec::with_capacity(queries.len());
    let mut uncached_indices: Vec<usize> = Vec::new();
    let mut uncached_texts: Vec<String> = Vec::new();

    // Check cache for each query
    for (index, query) in queries.iter().enumerate() {
        let cached_vec = state.embedding_cache.get(&embedding_model, query);
        if cached_vec.is_none() {
            uncached_indices.push(index);
            uncached_texts.push(query.clone());
        }
        query_vectors.push(cached_vec.unwrap_or_default());
    }

    // Embed only cache misses
    if !uncached_texts.is_empty() {
        let embedding_target = embeddings::EmbeddingModel {
            base_url: &embedding_endpoint,
            model: &embedding_model,
        };
        let input = embeddings::EmbeddingInput::texts(uncached_texts.clone());
        let new_embeddings = embeddings::embed_texts(&state.http_client, embedding_target, input)
            .await
            .map_err(|error| format!("Embedding failed: {error}"))?;

        for (uncached_position, index) in uncached_indices.iter().enumerate() {
            query_vectors[*index] = new_embeddings[uncached_position].clone();
            let cache_key = EmbeddingCacheKey::new(&embedding_model, &queries[*index]);
            state
                .embedding_cache
                .insert(cache_key, new_embeddings[uncached_position].clone());
        }
    }

    tracing::debug!(
        profile_id = %profile_id,
        vector_count = query_vectors.len(),
        vector_dims = query_vectors.first().map(|vector| vector.len()).unwrap_or(0),
        "semantic_search: embedding complete"
    );

    let mut results = {
        let conn = state
            .db
            .lock()
            .map_err(|error| format!("DB lock error: {error}"))?;

        let search_config = SearchConfigExt {
            base: search::SearchConfig {
                top_k_per_query: top_k,
                top_n_results: top_n,
                max_fk_chunks: foreign_key_fanout_cap,
                lexical_weight,
            },
            graph_depth,
            feedback_boost,
            hints: hints.unwrap_or_default(),
        };

        tracing::debug!(
            profile_id = %profile_id,
            graph_depth = search_config.graph_depth,
            feedback_boost = search_config.feedback_boost,
            "semantic_search: running pipeline (rerank before graph={})",
            rerank_enabled
        );

        // Run base search + hint boosts (no graph yet)
        let search_queries = search::SearchQueries {
            connection_id: &profile_id,
            query_texts: &queries,
            query_vectors: &query_vectors,
        };
        search::multi_query_search_with_hints(&conn, &search_queries, &search_config)
            .map_err(|error| format!("Search failed: {error}"))?
    };

    // Re-rank BEFORE graph expansion (if enabled)
    let should_rerank = rerank_enabled && !results.is_empty();
    if should_rerank {
        let chat_model = read_setting(&state.db, "ai.model").unwrap_or_default();
        let has_chat_backend = !chat_model.is_empty() && !chat_endpoint.is_empty();
        if has_chat_backend {
            let original_query = queries.first().cloned().unwrap_or_default();
            tracing::debug!(
                profile_id = %profile_id,
                candidate_count = results.len(),
                "semantic_search: invoking LLM re-rank (before graph expansion)"
            );
            let backend = rerank::RerankBackend {
                endpoint: &chat_endpoint,
                model: &chat_model,
            };
            let input = rerank::RerankInput {
                candidates: results,
                question: &original_query,
            };
            results = rerank::rerank_with_llm(&state.http_client, backend, input).await;
        }
    }

    // Graph expansion AFTER re-rank
    let should_expand_graph = graph_depth > 0 && !results.is_empty();
    if should_expand_graph {
        let conn = state
            .db
            .lock()
            .map_err(|error| format!("DB lock error: {error}"))?;
        let expansion = search::GraphExpansion {
            connection_id: &profile_id,
            graph_depth,
            max_foreign_key_chunks: foreign_key_fanout_cap as u32,
        };
        results = search::apply_graph_expansion(&conn, results, &expansion)
            .map_err(|error| format!("Graph expansion failed: {error}"))?;
    }

    tracing::debug!(
        profile_id = %profile_id,
        result_count = results.len(),
        top_results = ?results.iter().take(5).map(|result| (format!("{}.{}", result.db_name, result.table_name), &result.chunk_type, result.score)).collect::<Vec<_>>(),
        "semantic_search: complete"
    );

    Ok(results)
}

#[cfg(coverage)]
pub async fn semantic_search_impl(
    state: &AppState,
    request: SemanticSearchRequest,
) -> Result<Vec<SearchResult>, String> {
    let SemanticSearchRequest {
        session_id,
        queries,
        ..
    } = request;
    let _profile_id = resolve_session_profile(state, &session_id)?;

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
        Err(error) => return Err(format!("Lock error: {error}")),
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

    let endpoint = read_embedding_endpoint(&state.db)?;
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
            .map_err(|error| format!("Lock error: {error}"))?;
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
    let conn = state
        .db
        .lock()
        .map_err(|error| format!("DB lock error: {error}"))?;

    let meta = storage::get_index_meta(&conn, &profile_id)
        .map_err(|error| format!("Failed to get index meta: {error}"))?;

    match meta {
        None => Ok(IndexStatusResponse {
            status: "stale".to_string(),
            tables_done: None,
            tables_total: None,
            error: None,
        }),
        Some(meta) => {
            // 5. If model changed, it's stale
            if meta.model_id != embedding_model {
                return Ok(IndexStatusResponse {
                    status: "stale".to_string(),
                    tables_done: None,
                    tables_total: None,
                    error: None,
                });
            }

            // 6. Return the stored status
            Ok(IndexStatusResponse {
                status: meta.status.as_str().to_string(),
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
    request: InvalidateSchemaIndexRequest,
) -> Result<(), String> {
    let InvalidateSchemaIndexRequest { session_id, tables } = request;
    let profile_id = resolve_session_profile(state, &session_id)?;

    let embedding_model = read_setting(&state.db, "ai.embeddingModel")?;
    let endpoint = read_embedding_endpoint(&state.db)?;

    if embedding_model.is_empty() {
        return Ok(());
    }

    // Parse "db_name.table_name" strings
    let parsed_tables: Vec<(String, String)> = tables
        .iter()
        .filter_map(|qualified_table| {
            let Some((db_name, table_name)) = qualified_table.split_once('.') else {
                tracing::warn!(table = %qualified_table, "Invalid table format, expected 'db_name.table_name'");
                return None;
            };
            Some((db_name.to_string(), table_name.to_string()))
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

        let resources = builder::IndexBuildResources {
            sqlite_conn: &db,
            mysql_pool: &pool,
            http_client: &http_client,
            cancellation: &token,
        };
        match builder::rebuild_tables(&config, &parsed_tables, &resources).await {
            Ok(()) => {
                tracing::info!(
                    profile_id = %profile_id,
                    completed_at = %Utc::now().to_rfc3339(),
                    tables = ?parsed_tables,
                    "schema_index invalidate: partial rebuild and follow-up incremental build completed"
                );
            }
            Err(error) => {
                tracing::error!(
                    profile_id = %profile_id,
                    error = %error,
                    failed_at = %Utc::now().to_rfc3339(),
                    "Schema index partial rebuild failed"
                );
                let _ = app_handle.emit(
                    "schema-index-error",
                    &IndexErrorPayload {
                        profile_id: profile_id.clone(),
                        error,
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
    request: InvalidateSchemaIndexRequest,
) -> Result<(), String> {
    let _profile_id = resolve_session_profile(state, &request.session_id)?;
    Ok(())
}

/// List all indexed table chunks for a session's connection profile.
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
    payload: SemanticSearchRequest,
) -> Result<Vec<SearchResult>, String> {
    semantic_search_impl(&state, payload).await
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
    payload: InvalidateSchemaIndexRequest,
) -> Result<(), String> {
    invalidate_schema_index_impl(app_handle, &state, payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn list_indexed_tables(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<IndexedTableInfo>, String> {
    list_indexed_tables_impl(&state, session_id)
}
