pub mod builder;
pub mod embeddings;
pub mod embeddings_cache;
pub mod graph;
pub mod rerank;
pub mod search;
pub mod storage;
pub mod types;

/// Convert a slice of f32 values to little-endian bytes for sqlite-vec storage/queries.
pub(crate) fn embedding_to_bytes(embedding: &[f32]) -> Vec<u8> {
    embedding.iter().flat_map(|f| f.to_le_bytes()).collect()
}
