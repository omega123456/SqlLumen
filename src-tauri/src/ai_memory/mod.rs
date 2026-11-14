pub mod reembed;
pub mod search;
pub mod storage;
pub mod types;

use crate::db::settings;
use rusqlite::Connection;

pub use types::{AiMemory, MemoryReembedProgress, MemoryScope};

pub fn embedding_to_bytes(embedding: &[f32]) -> Vec<u8> {
    embedding
        .iter()
        .flat_map(|component| component.to_le_bytes())
        .collect()
}

pub fn resolve_embedding_endpoint(db: &Connection) -> Result<String, String> {
    let embedding =
        settings::get_setting(db, "ai.embeddingEndpoint").map_err(|error| error.to_string())?;
    if let Some(value) = embedding {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    let chat = settings::get_setting(db, "ai.endpoint")
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    Ok(chat.trim().to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddingConfig {
    pub endpoint: String,
    pub model: String,
}

impl EmbeddingConfig {
    pub fn embedding_model(&self) -> crate::schema_index::embeddings::EmbeddingModel<'_> {
        crate::schema_index::embeddings::EmbeddingModel {
            base_url: &self.endpoint,
            model: &self.model,
        }
    }
}

pub fn read_embedding_config(db: &Connection) -> Result<EmbeddingConfig, String> {
    let endpoint = resolve_embedding_endpoint(db)?;
    if endpoint.is_empty() {
        return Err("Embedding endpoint is empty".to_string());
    }
    let model = settings::get_setting(db, "ai.embeddingModel")
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Embedding model not configured".to_string())?;
    if model.trim().is_empty() {
        return Err("Embedding model is empty".to_string());
    }
    Ok(EmbeddingConfig { endpoint, model })
}
