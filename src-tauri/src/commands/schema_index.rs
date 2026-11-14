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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatusResponse {
    pub status: String,
    pub tables_done: Option<usize>,
    pub tables_total: Option<usize>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedTableInfo {
    pub db_name: String,
    pub table_name: String,
    pub chunk_type: String,
    pub embedded_at: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexErrorPayload {
    pub profile_id: String,
    pub error: String,
}

use super::helpers::resolve_session_profile;

mod index_build;
mod invalidation;
mod search_run;
mod status;
pub use index_build::*;
pub use invalidation::*;
pub use search_run::*;
pub use status::*;

fn read_setting(
    db: &std::sync::Arc<Mutex<rusqlite::Connection>>,
    key: &str,
) -> Result<String, String> {
    let conn = db
        .lock()
        .map_err(|error| format!("DB lock error: {error}"))?;
    settings::get_setting(&conn, key)
        .map_err(|error| format!("Failed to read setting '{key}': {error}"))?
        .ok_or_else(String::new)
        .or(Ok(String::new()))
}

fn read_embedding_endpoint(
    db: &std::sync::Arc<Mutex<rusqlite::Connection>>,
) -> Result<String, String> {
    let conn = db
        .lock()
        .map_err(|error| format!("DB lock error: {error}"))?;
    crate::ai_memory::resolve_embedding_endpoint(&conn)
}

const EMBEDDING_MODEL_SETTING: &str = "ai.embeddingModel";
const STATUS_NOT_CONFIGURED: &str = "not_configured";
const STATUS_BUILDING: &str = "building";
const STATUS_STALE: &str = "stale";

fn lock_error(error: impl std::fmt::Display) -> String {
    format!("Lock error: {error}")
}

fn db_lock_error(error: impl std::fmt::Display) -> String {
    format!("DB lock error: {error}")
}

fn register_session_profile(
    state: &AppState,
    session_id: &str,
    profile_id: &str,
) -> Result<(), String> {
    let already_registered = state
        .session_profile_map
        .lock()
        .map_err(lock_error)?
        .contains_key(session_id);
    if already_registered {
        return Ok(());
    }
    state
        .session_profile_map
        .lock()
        .map_err(lock_error)?
        .insert(session_id.to_string(), profile_id.to_string());
    let mut counts = state.session_ref_counts.lock().map_err(lock_error)?;
    *counts.entry(profile_id.to_string()).or_insert(0) += 1;
    Ok(())
}

fn cancel_in_flight_build(state: &AppState, profile_id: &str) -> Result<bool, String> {
    let mut tokens = state.index_build_tokens.lock().map_err(lock_error)?;
    let Some(token) = tokens.remove(profile_id) else {
        return Ok(false);
    };
    token.cancel();
    Ok(true)
}

fn is_build_in_progress(state: &AppState, profile_id: &str) -> Result<bool, String> {
    let tokens = state.index_build_tokens.lock().map_err(lock_error)?;
    Ok(tokens.contains_key(profile_id))
}

fn wipe_profile_chunks(state: &AppState, profile_id: &str) -> Result<(), String> {
    let conn = state.db.lock().map_err(db_lock_error)?;
    storage::delete_all_chunks(&conn, profile_id)
        .map_err(|error| format!("Failed to delete chunks for profile '{profile_id}': {error}"))
}

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
