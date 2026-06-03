pub mod reembed;
pub mod search;
pub mod storage;
pub mod types;

use crate::db::settings;
use rusqlite::Connection;

/// Convert a slice of f32 values to little-endian bytes for sqlite-vec storage/queries.
pub fn embedding_to_bytes(embedding: &[f32]) -> Vec<u8> {
    embedding.iter().flat_map(|f| f.to_le_bytes()).collect()
}

/// Resolves the *effective* embedding endpoint from SQLite settings.
///
/// Returns the trimmed value of `ai.embeddingEndpoint` when it is non-empty;
/// otherwise falls back to the trimmed value of `ai.endpoint` (the chat URL).
///
/// Both a missing row (`None`) and a stored-but-blank/whitespace-only value are
/// treated as "blank → fall back to the chat URL". This is the single source of
/// truth for the embedding-endpoint fallback rule; call sites must not inline it.
pub fn resolve_embedding_endpoint(db: &Connection) -> Result<String, String> {
    let embedding = settings::get_setting(db, "ai.embeddingEndpoint").map_err(|e| e.to_string())?;
    if let Some(value) = embedding {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    let chat = settings::get_setting(db, "ai.endpoint")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    Ok(chat.trim().to_string())
}

/// Reads embedding configuration (endpoint, model) from SQLite settings.
/// Returns `(endpoint, model)` or an error if not configured.
///
/// The endpoint is resolved via [`resolve_embedding_endpoint`] so the dedicated
/// embedding URL is honoured with a fallback to the chat URL. The function still
/// errors when the *resolved* (effective) endpoint is empty.
pub fn read_embedding_config(db: &Connection) -> Result<(String, String), String> {
    let endpoint = resolve_embedding_endpoint(db)?;
    if endpoint.is_empty() {
        return Err("Embedding endpoint is empty".to_string());
    }
    let model = settings::get_setting(db, "ai.embeddingModel")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Embedding model not configured".to_string())?;
    if model.trim().is_empty() {
        return Err("Embedding model is empty".to_string());
    }
    Ok((endpoint, model))
}
