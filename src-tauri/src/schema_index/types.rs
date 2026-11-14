use serde::{Deserialize, Serialize};

pub type ProgressCallback = Box<dyn Fn(BuildProgress) + Send + Sync>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BuildPhase {
    LoadingSchema,
    Embedding,
    Finalizing,
}

impl BuildPhase {
    pub fn as_str(&self) -> &'static str {
        match self {
            BuildPhase::LoadingSchema => "loading_schema",
            BuildPhase::Embedding => "embedding",
            BuildPhase::Finalizing => "finalizing",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildProgress {
    pub profile_id: String,
    pub phase: BuildPhase,
    pub tables_done: usize,
    pub tables_total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub profile_id: String,
    pub tables_indexed: usize,
    pub duration_ms: u64,
}

#[derive(Debug, Clone)]
pub struct BuildConfig {
    pub connection_id: String,
    pub model_id: String,
    pub endpoint: String,
}

#[derive(Debug, Clone)]
pub struct TableDdlInput {
    pub db_name: String,
    pub table_name: String,
    pub create_table_sql: String,
}

#[derive(Debug, Clone)]
pub struct FkInput {
    pub db_name: String,
    pub table_name: String,
    pub constraint_name: String,
    pub columns: Vec<String>,
    pub ref_db_name: String,
    pub ref_table_name: String,
    pub ref_columns: Vec<String>,
    pub on_delete: String,
    pub on_update: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ChunkType {
    Table,
    Fk,
    View,
    Procedure,
    Function,
}

impl ChunkType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ChunkType::Table => "table",
            ChunkType::Fk => "fk",
            ChunkType::View => "view",
            ChunkType::Procedure => "procedure",
            ChunkType::Function => "function",
        }
    }

    pub fn from_storage_str(text: &str) -> Option<Self> {
        match text {
            "table" => Some(ChunkType::Table),
            "fk" => Some(ChunkType::Fk),
            "view" => Some(ChunkType::View),
            "procedure" => Some(ChunkType::Procedure),
            "function" => Some(ChunkType::Function),
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
    pub fn as_str(&self) -> &'static str {
        match self {
            IndexStatus::NotConfigured => "not_configured",
            IndexStatus::Building => "building",
            IndexStatus::Ready => "ready",
            IndexStatus::Stale => "stale",
            IndexStatus::Error => "error",
        }
    }

    pub fn from_storage_str(text: &str) -> Option<Self> {
        match text {
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
    pub text_for_embedding: Option<String>,
    pub row_count_approx: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexMeta {
    pub connection_id: String,
    pub model_id: String,
    pub embedding_dimension: i64,
    pub last_build_at: Option<String>,
    pub status: IndexStatus,
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
    pub text_for_embedding: Option<String>,
    pub row_count_approx: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ChunkEmbeddingUpdate<'a> {
    pub chunk_id: i64,
    pub ddl_text: &'a str,
    pub ddl_hash: &'a str,
    pub model_id: &'a str,
    pub embedding: &'a [f32],
    pub text_for_embedding: Option<&'a str>,
    pub row_count_approx: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FkEdge {
    pub connection_id: String,
    pub src_db: String,
    pub src_tbl: String,
    pub src_col: String,
    pub dst_db: String,
    pub dst_tbl: String,
    pub dst_col: String,
    pub constraint_name: String,
    pub on_delete: Option<String>,
    pub on_update: Option<String>,
}
