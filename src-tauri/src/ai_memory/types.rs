use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy)]
pub struct MemoryOwner<'a> {
    pub scope: MemoryScope,
    pub owner_id: Option<&'a str>,
}

#[derive(Debug, Clone, Copy)]
pub struct MemoryVector<'a> {
    pub memory_id: i64,
    pub embedding: &'a [f32],
}

#[derive(Debug, Clone, Copy)]
pub struct MemoryMove<'a> {
    pub memory_id: i64,
    pub from: MemoryOwner<'a>,
    pub to: MemoryOwner<'a>,
    pub embedding: &'a [f32],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MemoryScope {
    Connection,
    Group,
    Global,
}

impl MemoryScope {
    pub fn as_str(&self) -> &'static str {
        match self {
            MemoryScope::Connection => "connection",
            MemoryScope::Group => "group",
            MemoryScope::Global => "global",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMemory {
    pub id: i64,
    pub scope: MemoryScope,
    pub connection_id: Option<String>,
    pub group_id: Option<String>,
    pub content: String,
    pub created_at: i64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReembedProgress {
    pub owner_key: String,
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub error: Option<String>,
}
