use super::super::super::types::{BuildConfig, ChunkInsert, ChunkType};
use super::super::{GeneratedTableChunk, compute_hash};

const EMBEDDING_PREVIEW_CHARS: usize = 500;
const PROCEDURE_ROUTINE_TYPE: &str = "PROCEDURE";

pub(super) type ViewDefinition = (String, String, String);
pub(super) type RoutineDefinition = (String, String, String, String);

#[derive(Debug, Clone)]
pub(super) struct PendingChunk {
    pub(super) chunk_key: String,
    pub(super) ddl_text: String,
    pub(super) ddl_hash: String,
    pub(super) chunk_type: ChunkType,
    pub(super) db_name: String,
    pub(super) table_name: String,
    pub(super) ref_db_name: Option<String>,
    pub(super) ref_table_name: Option<String>,
    pub(super) text_for_embedding: Option<String>,
    pub(super) row_count_approx: Option<i64>,
}

fn embedding_preview(ddl: &str) -> &str {
    ddl.char_indices()
        .nth(EMBEDDING_PREVIEW_CHARS)
        .map_or(ddl, |(cut, _)| &ddl[..cut])
}

fn routine_chunk_type(routine_type: &str) -> ChunkType {
    if routine_type == PROCEDURE_ROUTINE_TYPE {
        return ChunkType::Procedure;
    }
    ChunkType::Function
}

impl PendingChunk {
    pub(super) fn from_table_chunk(table_chunk: GeneratedTableChunk) -> Self {
        Self {
            chunk_key: table_chunk.chunk_key,
            ddl_text: table_chunk.ddl_text,
            ddl_hash: table_chunk.ddl_hash,
            chunk_type: ChunkType::Table,
            db_name: table_chunk.db_name,
            table_name: table_chunk.table_name,
            ref_db_name: None,
            ref_table_name: None,
            text_for_embedding: table_chunk.text_for_embedding,
            row_count_approx: table_chunk.row_count_approx,
        }
    }

    pub(super) fn from_view(view: &ViewDefinition) -> Self {
        let (db_name, view_name, create_view_ddl) = view;
        let preview = embedding_preview(create_view_ddl);
        Self {
            chunk_key: format!("view:{db_name}.{view_name}"),
            ddl_text: create_view_ddl.clone(),
            ddl_hash: compute_hash(create_view_ddl),
            chunk_type: ChunkType::View,
            db_name: db_name.clone(),
            table_name: view_name.clone(),
            ref_db_name: None,
            ref_table_name: None,
            text_for_embedding: Some(format!("View `{db_name}`.`{view_name}`: {preview}")),
            row_count_approx: None,
        }
    }

    pub(super) fn from_routine(routine: &RoutineDefinition) -> Self {
        let (db_name, routine_name, routine_type, create_ddl) = routine;
        let chunk_type = routine_chunk_type(routine_type);
        let type_lower = chunk_type.as_str();
        let preview = embedding_preview(create_ddl);
        Self {
            chunk_key: format!("{type_lower}:{db_name}.{routine_name}"),
            ddl_text: create_ddl.clone(),
            ddl_hash: compute_hash(create_ddl),
            chunk_type,
            db_name: db_name.clone(),
            table_name: routine_name.clone(),
            ref_db_name: None,
            ref_table_name: None,
            text_for_embedding: Some(format!(
                "{routine_type} `{db_name}`.`{routine_name}`: {preview}"
            )),
            row_count_approx: None,
        }
    }

    pub(super) fn is_table(&self) -> bool {
        matches!(&self.chunk_type, ChunkType::Table)
    }

    pub(super) fn is_foreign_key(&self) -> bool {
        matches!(&self.chunk_type, ChunkType::Fk)
    }

    pub(super) fn embedding_text(&self) -> String {
        self.text_for_embedding
            .as_ref()
            .unwrap_or(&self.ddl_text)
            .clone()
    }

    pub(super) fn diff_entry(&self) -> (String, String, String) {
        (
            self.chunk_key.clone(),
            self.ddl_text.clone(),
            self.ddl_hash.clone(),
        )
    }

    pub(super) fn to_insert(&self, config: &BuildConfig, embedding: Vec<f32>) -> ChunkInsert {
        ChunkInsert {
            connection_id: config.connection_id.clone(),
            chunk_key: self.chunk_key.clone(),
            db_name: self.db_name.clone(),
            table_name: self.table_name.clone(),
            chunk_type: self.chunk_type.clone(),
            ddl_text: self.ddl_text.clone(),
            ddl_hash: self.ddl_hash.clone(),
            model_id: config.model_id.clone(),
            ref_db_name: self.ref_db_name.clone(),
            ref_table_name: self.ref_table_name.clone(),
            embedding,
            text_for_embedding: self.text_for_embedding.clone(),
            row_count_approx: self.row_count_approx,
        }
    }
}

pub(super) fn count_table_chunks(chunks: &[&PendingChunk]) -> usize {
    chunks.iter().filter(|chunk| chunk.is_table()).count()
}

pub(super) fn count_foreign_key_chunks(chunks: &[&PendingChunk]) -> usize {
    chunks.iter().filter(|chunk| chunk.is_foreign_key()).count()
}

pub(super) fn chunk_keys<'a>(chunks: &[&'a PendingChunk]) -> Vec<&'a str> {
    chunks
        .iter()
        .map(|chunk| chunk.chunk_key.as_str())
        .collect()
}
