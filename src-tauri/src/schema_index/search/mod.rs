//! Multi-query vector search pipeline with deduplication, re-ranking,
//! and graph-based FK expansion.
//!
//! The base search entry point is [`multi_query_search_configured`], which:
//! 1. Runs sqlite-vec KNN for each pre-embedded query vector
//! 2. Deduplicates by chunk ID via RRF fusion
//! 3. Applies blended lexical boosts: `final = rrf_score + λ · lexical_boost`
//! 4. Selects the top-N results (direct semantic + lexical hits only)
//!
//! FK expansion happens separately via [`apply_graph_expansion`] (BFS walk).

use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

use super::builder::normalize_table_ddl;

mod graph_expansion;
mod hints;
mod lexical;
mod pipeline;

pub use graph_expansion::{apply_graph_expansion, multi_query_search_extended};
pub use hints::multi_query_search_with_hints;
pub use pipeline::multi_query_search_configured;

/// A single search result from the semantic search pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub chunk_id: i64,
    pub chunk_key: String,
    pub db_name: String,
    pub table_name: String,
    pub chunk_type: String,
    pub ddl_text: String,
    pub ref_db_name: Option<String>,
    pub ref_table_name: Option<String>,
    pub score: f64,
}

/// Search configuration parameters (read from settings).
#[derive(Debug, Clone)]
pub struct SearchConfig {
    pub top_k_per_query: usize,
    pub top_n_results: usize,
    pub max_fk_chunks: usize,
    pub lexical_weight: f64,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            top_k_per_query: 30,
            top_n_results: 20,
            max_fk_chunks: 30,
            lexical_weight: 0.2,
        }
    }
}

/// A table hint with a weight (boost signal from usage feedback).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableHint {
    pub db_name: String,
    pub table_name: String,
    pub weight: f64,
}

/// A table reference without a weight (e.g. editor context).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRef {
    pub db_name: String,
    pub table_name: String,
}

/// Usage-signal hints passed alongside semantic search to boost relevant tables.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalHints {
    #[serde(default)]
    pub recent_tables: Vec<TableHint>,
    #[serde(default)]
    pub editor_tables: Vec<TableRef>,
    #[serde(default)]
    pub accepted_tables: Vec<TableHint>,
}

/// Extended search configuration including graph walk and hint boost parameters.
#[derive(Debug, Clone)]
pub struct SearchConfigExt {
    pub base: SearchConfig,
    pub graph_depth: u32,
    pub feedback_boost: f64,
    pub hints: RetrievalHints,
}

impl Default for SearchConfigExt {
    fn default() -> Self {
        Self {
            base: SearchConfig::default(),
            graph_depth: 2,
            feedback_boost: 0.15,
            hints: RetrievalHints::default(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SearchQueries<'a> {
    pub connection_id: &'a str,
    pub query_texts: &'a [String],
    pub query_vectors: &'a [Vec<f32>],
}

#[derive(Debug, Clone, Copy)]
pub struct SearchLimits {
    pub top_k_per_query: usize,
    pub top_n_results: usize,
    pub max_foreign_key_chunks: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct GraphExpansion<'a> {
    pub connection_id: &'a str,
    pub graph_depth: u32,
    pub max_foreign_key_chunks: u32,
}

struct ChunkIdentity<'a> {
    db_name: &'a str,
    table_name: &'a str,
    chunk_type: &'a str,
}

pub(super) struct ScoredTable<'a> {
    pub(super) db_name: &'a str,
    pub(super) table_name: &'a str,
    pub(super) score: f64,
}

fn normalize_result_ddl(chunk: &ChunkIdentity<'_>, ddl_text: String) -> String {
    if chunk.chunk_type != "table" {
        return ddl_text;
    }
    normalize_table_ddl(chunk.db_name, chunk.table_name, &ddl_text)
}

/// Map a row from `schema_index_chunks` (columns: id, chunk_key, db_name,
/// table_name, chunk_type, ddl_text, ref_db_name, ref_table_name) to a
/// `SearchResult`, applying DDL normalization and the given score.
pub(super) fn row_to_search_result(row: &rusqlite::Row<'_>, score: f64) -> Result<SearchResult> {
    let db_name: String = row.get(2)?;
    let table_name: String = row.get(3)?;
    let chunk_type: String = row.get(4)?;
    let ddl_text: String = row.get(5)?;
    Ok(SearchResult {
        chunk_id: row.get(0)?,
        chunk_key: row.get(1)?,
        db_name: db_name.clone(),
        table_name: table_name.clone(),
        chunk_type: chunk_type.clone(),
        ddl_text: normalize_result_ddl(
            &ChunkIdentity {
                db_name: &db_name,
                table_name: &table_name,
                chunk_type: &chunk_type,
            },
            ddl_text,
        ),
        ref_db_name: row.get(6)?,
        ref_table_name: row.get(7)?,
        score,
    })
}

/// Load a single table's chunk from `schema_index_chunks`.
pub(super) fn load_table_chunk(
    conn: &Connection,
    connection_id: &str,
    table: &ScoredTable<'_>,
) -> Result<Vec<SearchResult>> {
    let db = table.db_name;
    let score = table.score;
    let table = table.table_name;
    let mut stmt = conn.prepare(
        "SELECT id, chunk_key, db_name, table_name, chunk_type, ddl_text, ref_db_name, ref_table_name
         FROM schema_index_chunks
         WHERE connection_id = ?1 AND chunk_type = 'table' AND db_name = ?2 AND table_name = ?3",
    )?;
    let rows = stmt.query_map(params![connection_id, db, table], |row| {
        row_to_search_result(row, score)
    })?;
    rows.collect()
}

/// Run the full multi-query vector search pipeline.
///
/// # Arguments
/// * `conn` — SQLite connection (with sqlite-vec loaded and tables created)
/// * `connection_id` — the profile ID to scope results to
/// * `query_vectors` — pre-embedded query vectors
/// * `top_k_per_query` — number of KNN results per query vector
/// * `top_n_results` — number of final results after dedup
/// * `max_fk_chunks` — cap on additional FK chunks from fan-out (typically 20)
pub fn multi_query_search(
    conn: &Connection,
    queries: &SearchQueries<'_>,
    limits: SearchLimits,
) -> Result<Vec<SearchResult>> {
    let config = SearchConfig {
        top_k_per_query: limits.top_k_per_query,
        top_n_results: limits.top_n_results,
        max_fk_chunks: limits.max_foreign_key_chunks,
        ..SearchConfig::default()
    };
    multi_query_search_configured(conn, queries, &config)
}
