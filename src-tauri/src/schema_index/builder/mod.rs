mod chunk_diff;
mod chunk_generation;
mod ddl_parsing;
mod ddl_text;

#[cfg(not(coverage))]
mod build;
#[cfg(not(coverage))]
mod mysql_fetch;
#[cfg(not(coverage))]
mod table_signatures;

pub use chunk_diff::{
    decide_signature_action, diff_chunks, is_signature_unchanged, ChunkDiff, SignatureDecision,
};
pub use chunk_generation::{
    compute_hash, fk_chunk_key, generate_all_chunks, generate_all_chunks_with_row_counts,
    generate_fk_chunk_text, generate_text_for_embedding, split_identifier_segments,
    table_chunk_key, GeneratedChunks, GeneratedFkChunk, GeneratedTableChunk,
    TableEmbeddingDescription,
};
pub use ddl_parsing::{
    extract_column_comments, extract_table_comment, parse_columns_from_ddl, parse_fks_from_ddl,
    parse_pk_from_ddl, parse_unique_indexes_from_ddl,
};
pub use ddl_text::{
    compact_ddl, compact_ddl_for_llm, normalize_table_ddl, qualify_references_in_ddl,
    qualify_table_ddl,
};

#[cfg(not(coverage))]
pub use build::{build_index, rebuild_tables, IndexBuildResources};

pub const SHOW_CREATE_TABLE_CONCURRENCY: usize = 8;
