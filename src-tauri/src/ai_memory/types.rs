use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMemory {
    pub id: i64,
    pub connection_id: String,
    pub content: String,
    pub created_at: i64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReembedProgress {
    pub connection_id: String,
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub error: Option<String>,
}
