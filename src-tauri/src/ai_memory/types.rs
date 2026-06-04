use serde::{Deserialize, Serialize};

/// The scope (level) a memory belongs to.
///
/// Serializes over IPC as `"connection" | "group" | "global"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MemoryScope {
    Connection,
    Group,
    Global,
}

impl MemoryScope {
    /// Stable string representation, also used as a serde value and in owner keys.
    pub fn as_str(&self) -> &'static str {
        match self {
            MemoryScope::Connection => "connection",
            MemoryScope::Group => "group",
            MemoryScope::Global => "global",
        }
    }
}

/// Unified row representation across all three levels for IPC.
///
/// Connection rows set `connection_id`; group rows set `group_id`; global rows
/// set neither. `scope` is the discriminator.
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

/// Progress event payload for re-embedding.
///
/// `owner_key` is a generic owner identifier — `"global"`, `"group_{id}"`, or a
/// connection id — so the same event shape covers every scope.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReembedProgress {
    pub owner_key: String,
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub error: Option<String>,
}
