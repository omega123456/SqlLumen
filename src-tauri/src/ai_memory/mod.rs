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

/// Reads embedding configuration (endpoint, model) from SQLite settings.
/// Returns `(endpoint, model)` or an error if not configured.
pub fn read_embedding_config(db: &Connection) -> Result<(String, String), String> {
    let endpoint = settings::get_setting(db, "ai.endpoint")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Embedding endpoint not configured".to_string())?;
    let model = settings::get_setting(db, "ai.embeddingModel")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Embedding model not configured".to_string())?;
    if endpoint.trim().is_empty() {
        return Err("Embedding endpoint is empty".to_string());
    }
    if model.trim().is_empty() {
        return Err("Embedding model is empty".to_string());
    }
    Ok((endpoint, model))
}
