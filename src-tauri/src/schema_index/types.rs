use serde::{Deserialize, Serialize};

// ── Build progress callback type ─────────────────────────────────────────

/// Callback invoked during index builds to report progress.
pub type ProgressCallback = Box<dyn Fn(BuildProgress) + Send + Sync>;

// ── Build progress / result / config ─────────────────────────────────────

/// Current phase of an in-flight index build.
///
/// `LoadingSchema` covers MySQL enumeration + `SHOW CREATE TABLE` fetches
/// (can take minutes for large instances). `Embedding` covers the embedding
/// API calls and SQLite writes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BuildPhase {
    LoadingSchema,
    Embedding,
}

impl BuildPhase {
    pub fn as_str(&self) -> &'static str {
        match self {
            BuildPhase::LoadingSchema => "loading_schema",
            BuildPhase::Embedding => "embedding",
        }
    }
}

/// Incremental progress reported during an index build.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildProgress {
    pub profile_id: String,
    pub phase: BuildPhase,
    pub tables_done: usize,
    pub tables_total: usize,
}

/// Summary returned when an index build completes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub profile_id: String,
    pub tables_indexed: usize,
    pub duration_ms: u64,
}

/// Configuration for an index build (explicit deps, no AppState).
#[derive(Debug, Clone)]
pub struct BuildConfig {
    /// The saved connection profile id.
    pub connection_id: String,
    /// The embedding model to use (e.g. "nomic-embed-text").
    pub model_id: String,
    /// Base URL for the embedding endpoint (e.g. "http://localhost:11434/v1/embeddings").
    pub endpoint: String,
}

/// Raw DDL input for chunk generation (used in builder + tests).
#[derive(Debug, Clone)]
pub struct TableDdlInput {
    pub db_name: String,
    pub table_name: String,
    /// Output of `SHOW CREATE TABLE`.
    pub create_table_sql: String,
}

/// A foreign key relationship extracted from DDL or INFORMATION_SCHEMA.
#[derive(Debug, Clone)]
pub struct FkInput {
    pub db_name: String,
    pub table_name: String,
    pub constraint_name: String,
    /// Source columns.
    pub columns: Vec<String>,
    pub ref_db_name: String,
    pub ref_table_name: String,
    /// Referenced columns.
    pub ref_columns: Vec<String>,
    pub on_delete: String,
    pub on_update: String,
}

// ── Existing types ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ChunkType {
    Table,
    Fk,
    /// Natural-language prose summary chunk for a table (see plan A2). Supplements
    /// the raw DDL `Table` chunk so embedding models can match on English-ish text.
    Summary,
}

impl ChunkType {
    /// Convert to the SQLite storage string.
    pub fn as_str(&self) -> &'static str {
        match self {
            ChunkType::Table => "table",
            ChunkType::Fk => "fk",
            ChunkType::Summary => "summary",
        }
    }

    /// Parse from the SQLite storage string.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "table" => Some(ChunkType::Table),
            "fk" => Some(ChunkType::Fk),
            "summary" => Some(ChunkType::Summary),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum IndexStatus {
    NotConfigured,
    Building,
    Ready,
    Stale,
    Error,
}

impl IndexStatus {
    /// Convert to the SQLite storage string.
    pub fn as_str(&self) -> &'static str {
        match self {
            IndexStatus::NotConfigured => "not_configured",
            IndexStatus::Building => "building",
            IndexStatus::Ready => "ready",
            IndexStatus::Stale => "stale",
            IndexStatus::Error => "error",
        }
    }

    /// Parse from the SQLite storage string.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "not_configured" => Some(IndexStatus::NotConfigured),
            "building" => Some(IndexStatus::Building),
            "ready" => Some(IndexStatus::Ready),
            "stale" => Some(IndexStatus::Stale),
            "error" => Some(IndexStatus::Error),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkMetadata {
    pub id: i64,
    pub connection_id: String,
    pub chunk_key: String,
    pub db_name: String,
    pub table_name: String,
    pub chunk_type: ChunkType,
    pub ddl_text: String,
    pub ddl_hash: String,
    pub model_id: String,
    pub embedded_at: String,
    pub ref_db_name: Option<String>,
    pub ref_table_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexMeta {
    pub connection_id: String,
    pub model_id: String,
    pub embedding_dimension: i64,
    pub last_build_at: Option<String>,
    pub status: IndexStatus,
    /// Schema version of the vec0 virtual table layout.
    /// `None` (NULL in SQLite) means the row was written before versioning was
    /// introduced and should be treated as version 0 (L2 distance).
    pub vec_schema_version: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ChunkInsert {
    pub connection_id: String,
    pub chunk_key: String,
    pub db_name: String,
    pub table_name: String,
    pub chunk_type: ChunkType,
    pub ddl_text: String,
    pub ddl_hash: String,
    pub model_id: String,
    pub ref_db_name: Option<String>,
    pub ref_table_name: Option<String>,
    pub embedding: Vec<f32>,
}
