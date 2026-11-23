use std::collections::HashMap;

use rusqlite::{Connection, Result, params};

use super::embedding_to_bytes;
use super::types::{
    ChunkEmbeddingUpdate, ChunkInsert, ChunkMetadata, ChunkType, FkEdge, IndexMeta, IndexStatus,
};

mod chunk_queries;
mod foreign_key_edges;
mod index_meta;
mod segment_frequencies;
mod signatures;
pub use chunk_queries::*;
pub use foreign_key_edges::*;
pub use index_meta::*;
pub use segment_frequencies::*;
pub use signatures::*;

pub const VEC_SCHEMA_VERSION: u32 = 2;

pub fn sanitize_table_name(id: &str) -> String {
    id.chars().map(table_name_safe_char).collect()
}

fn table_name_safe_char(character: char) -> char {
    if character.is_alphanumeric() {
        return character;
    }
    '_'
}

pub fn vec_table_name(profile_id: &str) -> String {
    format!("schema_index_vectors_{}", sanitize_table_name(profile_id))
}

pub fn create_vec_table(conn: &Connection, profile_id: &str, dimension: usize) -> Result<()> {
    let table = vec_table_name(profile_id);
    conn.execute_batch(&format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS {table} USING vec0(id INTEGER PRIMARY KEY, embedding FLOAT[{dimension}] distance_metric=cosine)"
    ))?;
    Ok(())
}

pub fn drop_vec_table(conn: &Connection, profile_id: &str) -> Result<()> {
    let table = vec_table_name(profile_id);
    conn.execute_batch(&format!("DROP TABLE IF EXISTS {table}"))?;
    Ok(())
}

pub fn insert_chunk(conn: &Connection, chunk: &ChunkInsert) -> Result<i64> {
    conn.execute(
        "INSERT INTO schema_index_chunks (connection_id, chunk_key, db_name, table_name, chunk_type, ddl_text, ddl_hash, model_id, ref_db_name, ref_table_name, text_for_embedding, row_count_approx)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            chunk.connection_id,
            chunk.chunk_key,
            chunk.db_name,
            chunk.table_name,
            chunk.chunk_type.as_str(),
            chunk.ddl_text,
            chunk.ddl_hash,
            chunk.model_id,
            chunk.ref_db_name,
            chunk.ref_table_name,
            chunk.text_for_embedding,
            chunk.row_count_approx,
        ],
    )?;
    let chunk_id = conn.last_insert_rowid();

    let table = vec_table_name(&chunk.connection_id);
    let bytes = embedding_to_bytes(&chunk.embedding);
    conn.execute(
        &format!("INSERT INTO {table} (id, embedding) VALUES (?1, ?2)"),
        params![chunk_id, bytes],
    )?;

    Ok(chunk_id)
}

pub fn update_chunk_embedding(
    conn: &Connection,
    profile_id: &str,
    update: &ChunkEmbeddingUpdate<'_>,
) -> Result<()> {
    conn.execute(
        "UPDATE schema_index_chunks SET ddl_text = ?1, ddl_hash = ?2, model_id = ?3, embedded_at = datetime('now'), text_for_embedding = ?5, row_count_approx = ?6 WHERE id = ?4",
        params![
            update.ddl_text,
            update.ddl_hash,
            update.model_id,
            update.chunk_id,
            update.text_for_embedding,
            update.row_count_approx
        ],
    )?;

    let table = vec_table_name(profile_id);
    let bytes = embedding_to_bytes(update.embedding);
    conn.execute(
        &format!("UPDATE {table} SET embedding = ?1 WHERE id = ?2"),
        params![bytes, update.chunk_id],
    )?;

    Ok(())
}
