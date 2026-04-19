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
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use super::graph;
use super::{builder::normalize_table_ddl, embedding_to_bytes};

// Lexical boost constants — normalized to [0, 1] range.
// These are multiplied by λ (lexical_weight) before being added to cosine scores.
const DIRECT_TABLE_MATCH_SCORE: f64 = 1.0;
const IDENTIFIER_EXACT_MATCH_SCORE: f64 = 0.8;
const DIRECT_TABLE_SEGMENT_MATCH_SCORE: f64 = 0.5;
const IDENTIFIER_SEGMENT_MATCH_SCORE: f64 = 0.4;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct QualifiedIdentifier {
    db_name: Option<String>,
    table_name: String,
}

const SQL_STOPWORDS: &[&str] = &[
    "select",
    "from",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "full",
    "cross",
    "on",
    "where",
    "and",
    "or",
    "not",
    "as",
    "into",
    "update",
    "delete",
    "insert",
    "table",
    "references",
    "group",
    "order",
    "by",
    "limit",
    "offset",
    "having",
    "union",
    "all",
    "distinct",
    "with",
    "case",
    "when",
    "then",
    "else",
    "end",
    "null",
    "true",
    "false",
    "like",
    "in",
    "exists",
    "between",
    "is",
    "create",
    "alter",
    "drop",
    "primary",
    "foreign",
    "key",
    "constraint",
    "values",
    "set",
    "call",
    "show",
    "describe",
    "explain",
    "asc",
    "desc",
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "id",
    // NL filler words
    "list",
    "me",
    "get",
    "find",
    "which",
    "how",
    "many",
    "much",
    "total",
    "last",
    "first",
    "recent",
    "old",
    "new",
    "please",
    "want",
    "need",
    "give",
    "tell",
    "what",
    "why",
    "when",
    "where",
    "who",
];

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

/// RRF constant (standard value from the original RRF paper).
const RRF_K: f64 = 60.0;

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
            top_k_per_query: 20,
            top_n_results: 12,
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

fn normalize_result_ddl(
    db_name: &str,
    table_name: &str,
    chunk_type: &str,
    ddl_text: String,
) -> String {
    if chunk_type == "table" {
        normalize_table_ddl(db_name, table_name, &ddl_text)
    } else {
        ddl_text
    }
}

/// Map a row from `schema_index_chunks` (columns: id, chunk_key, db_name,
/// table_name, chunk_type, ddl_text, ref_db_name, ref_table_name) to a
/// `SearchResult`, applying DDL normalization and the given score.
fn row_to_search_result(row: &rusqlite::Row<'_>, score: f64) -> Result<SearchResult> {
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
        ddl_text: normalize_result_ddl(&db_name, &table_name, &chunk_type, ddl_text),
        ref_db_name: row.get(6)?,
        ref_table_name: row.get(7)?,
        score,
    })
}

/// Load a single table's chunk from `schema_index_chunks`.
fn load_table_chunk(
    conn: &Connection,
    connection_id: &str,
    db: &str,
    table: &str,
    score: f64,
) -> Result<Vec<SearchResult>> {
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
/// * `top_k_per_query` — number of KNN results per query vector (typically 5)
/// * `top_n_results` — number of final results after dedup (typically 10)
/// * `max_fk_chunks` — cap on additional FK chunks from fan-out (typically 20)
pub fn multi_query_search(
    conn: &Connection,
    connection_id: &str,
    query_vectors: &[Vec<f32>],
    top_k_per_query: usize,
    top_n_results: usize,
    max_fk_chunks: usize,
) -> Result<Vec<SearchResult>> {
    multi_query_search_with_query_texts(
        conn,
        connection_id,
        &[],
        query_vectors,
        top_k_per_query,
        top_n_results,
        max_fk_chunks,
    )
}

/// Run the full multi-query vector search pipeline with optional lexical boosts
/// derived from the original query text.
pub fn multi_query_search_with_query_texts(
    conn: &Connection,
    connection_id: &str,
    query_texts: &[String],
    query_vectors: &[Vec<f32>],
    top_k_per_query: usize,
    top_n_results: usize,
    max_fk_chunks: usize,
) -> Result<Vec<SearchResult>> {
    multi_query_search_configured(
        conn,
        connection_id,
        query_texts,
        query_vectors,
        &SearchConfig {
            top_k_per_query,
            top_n_results,
            max_fk_chunks,
            lexical_weight: 0.2,
        },
    )
}

/// Run the full multi-query vector search pipeline with full configuration.
pub fn multi_query_search_configured(
    conn: &Connection,
    connection_id: &str,
    query_texts: &[String],
    query_vectors: &[Vec<f32>],
    config: &SearchConfig,
) -> Result<Vec<SearchResult>> {
    tracing::debug!(
        connection_id = %connection_id,
        query_vector_count = query_vectors.len(),
        query_text_count = query_texts.len(),
        top_k_per_query = config.top_k_per_query,
        top_n_results = config.top_n_results,
        max_fk_chunks = config.max_fk_chunks,
        lexical_weight = config.lexical_weight,
        "multi_query_search: pipeline start"
    );

    if query_vectors.is_empty() {
        tracing::debug!(connection_id = %connection_id, "multi_query_search: no query vectors — returning empty");
        return Ok(vec![]);
    }

    // ── Step 1: KNN for each query vector ───────────────────────────────
    // Collect per-query ranked lists for RRF fusion, plus best cosine for tiebreaking.
    let mut best_cosine: HashMap<i64, f64> = HashMap::new();
    let mut rrf_accum: HashMap<i64, f64> = HashMap::new();
    let mut raw_hit_count = 0usize;

    let vec_table = super::storage::vec_table_name(connection_id);

    for (i, query_vec) in query_vectors.iter().enumerate() {
        let embedding_bytes = embedding_to_bytes(query_vec);

        let mut stmt = conn.prepare(&format!(
            "SELECT id, distance FROM {vec_table} WHERE embedding MATCH ?1 AND k = ?2"
        ))?;

        // Collect hits for this query, sorted by distance (ascending = best first).
        let mut query_hits: Vec<(i64, f64)> = Vec::new();
        let knn_rows = stmt.query_map(
            params![embedding_bytes, config.top_k_per_query as i64],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?)),
        )?;

        for row_result in knn_rows {
            let (chunk_id, distance) = row_result?;
            let score = 1.0 - distance;
            raw_hit_count += 1;
            query_hits.push((chunk_id, score));

            let entry = best_cosine.entry(chunk_id).or_insert(score);
            if score > *entry {
                *entry = score;
            }
        }

        // Sort by cosine score descending for rank assignment.
        query_hits.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // Accumulate RRF scores: rrf_score(chunk) += 1 / (k + rank)
        for (rank_0, (chunk_id, _score)) in query_hits.iter().enumerate() {
            let rank = (rank_0 + 1) as f64; // 1-based rank
            *rrf_accum.entry(*chunk_id).or_insert(0.0) += 1.0 / (RRF_K + rank);
        }

        tracing::debug!(
            connection_id = %connection_id,
            query_index = i,
            knn_hits = query_hits.len(),
            "multi_query_search: step 1 — query vector {i} returned {} hit(s)",
            query_hits.len()
        );
    }

    tracing::debug!(
        connection_id = %connection_id,
        total_raw_results = raw_hit_count,
        "multi_query_search: step 1 complete — total raw KNN results before dedup"
    );

    if rrf_accum.is_empty() {
        tracing::debug!(connection_id = %connection_id, "multi_query_search: no KNN results — returning empty");
        return Ok(vec![]);
    }

    // ── Step 2: Dedup by chunk_id — RRF already accumulated ─────────────
    tracing::debug!(
        connection_id = %connection_id,
        unique_chunks = rrf_accum.len(),
        raw_count = raw_hit_count,
        "multi_query_search: step 2 — dedup complete (RRF fusion)"
    );

    // ── Step 2b: Blended lexical boosts from original queries ───────────
    // final = rrf_score + λ · lexical_boost
    let direct_table_candidates = extract_direct_table_candidates(query_texts);
    let identifier_tokens = extract_identifier_tokens(query_texts);

    // Load segment DF for IDF weighting
    let segment_df = load_segment_df(conn, connection_id);
    let total_tables = super::storage::count_table_chunks(conn, connection_id)
        .unwrap_or(1)
        .max(1);

    // Compute lexical scores for all table chunks, then blend
    let mut best_scores: HashMap<i64, f64> = HashMap::new();

    if !direct_table_candidates.is_empty() || !identifier_tokens.is_empty() {
        let lexical_matches = collect_lexical_table_matches(
            conn,
            connection_id,
            &direct_table_candidates,
            &identifier_tokens,
            &segment_df,
            total_tables,
        )?;

        // Blend: for chunks with RRF, add λ·lexical; for lexical-only, use λ·lexical
        for (chunk_id, rrf_score) in &rrf_accum {
            let lexical = lexical_matches.get(chunk_id).copied().unwrap_or(0.0);
            best_scores.insert(*chunk_id, rrf_score + config.lexical_weight * lexical);
        }
        // Lexical-only entries (not in KNN)
        for (chunk_id, lexical_score) in &lexical_matches {
            best_scores
                .entry(*chunk_id)
                .or_insert(config.lexical_weight * lexical_score);
        }

        tracing::debug!(
            connection_id = %connection_id,
            direct_table_candidates = ?direct_table_candidates,
            identifier_tokens = ?identifier_tokens,
            candidate_count = best_scores.len(),
            "multi_query_search: step 2b — blended lexical boosts applied"
        );
    } else {
        // No lexical signals — just use RRF scores directly
        best_scores = rrf_accum;
    }

    // ── Step 2c: Database-affinity boost ───────────────────────────────
    // Count how often each database appears across all candidates to detect
    // the "active" database, then boost tables from high-frequency databases.
    {
        // Load db_name for every candidate chunk
        let chunk_ids: Vec<i64> = best_scores.keys().copied().collect();
        let mut chunk_db: HashMap<i64, String> = HashMap::new();
        for chunk_id in &chunk_ids {
            if let Ok(db_name) = conn.query_row(
                "SELECT db_name FROM schema_index_chunks WHERE id = ?1 AND connection_id = ?2",
                params![chunk_id, connection_id],
                |row| row.get::<_, String>(0),
            ) {
                chunk_db.insert(*chunk_id, db_name);
            }
        }

        // Count database frequency across all candidates
        let mut db_freq: HashMap<String, usize> = HashMap::new();
        for db_name in chunk_db.values() {
            *db_freq.entry(db_name.clone()).or_insert(0) += 1;
        }

        // Find the top-3 scoring chunks to determine affinity databases
        let mut score_vec: Vec<(i64, f64)> = best_scores.iter().map(|(&id, &s)| (id, s)).collect();
        score_vec.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let affinity_dbs: HashSet<String> = score_vec
            .iter()
            .take(3)
            .filter_map(|(id, _)| chunk_db.get(id).cloned())
            .collect();

        // Apply database-affinity boost only when multiple databases are present
        if db_freq.len() > 1 {
            const DB_AFFINITY_BOOST: f64 = 0.02;
            for (chunk_id, score) in best_scores.iter_mut() {
                if let Some(db_name) = chunk_db.get(chunk_id) {
                    if affinity_dbs.contains(db_name) {
                        *score += DB_AFFINITY_BOOST;
                    }
                }
            }
        }

        tracing::debug!(
            connection_id = %connection_id,
            db_freq = ?db_freq,
            affinity_dbs = ?affinity_dbs,
            "multi_query_search: step 2c — database-affinity boost applied"
        );
    }

    // ── Step 3: Sort by score desc (cosine as tiebreaker) ─────────────
    let mut deduped: Vec<(i64, f64)> = best_scores.into_iter().collect();
    deduped.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                // Tiebreaker: higher cosine score wins
                let cos_b = best_cosine.get(&b.0).copied().unwrap_or(0.0);
                let cos_a = best_cosine.get(&a.0).copied().unwrap_or(0.0);
                cos_b
                    .partial_cmp(&cos_a)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| a.0.cmp(&b.0))
    });

    let score_range = deduped
        .first()
        .zip(deduped.last())
        .map(|((_, hi), (_, lo))| (*lo, *hi));

    tracing::debug!(
        connection_id = %connection_id,
        sorted_count = deduped.len(),
        score_range = ?score_range,
        top5 = ?deduped.iter().take(5).map(|(id, s)| (*id, *s)).collect::<Vec<_>>(),
        "multi_query_search: step 3 — sorted by score desc"
    );

    // ── Step 4: Fetch chunk metadata, filter by connection_id, take top-N ──
    // Cross-database dedup: when the same table_name appears from multiple
    // databases with similar scores (within 5%), keep only the one from the
    // database that appears most frequently across all candidates.
    let mut top_n: Vec<SearchResult> = Vec::new();
    // Track (table_name → (best_score, db_name)) already selected, for cross-db dedup
    let mut selected_table_info: HashMap<String, (f64, String)> = HashMap::new();
    // Count db frequency across all deduped candidates for tiebreaking
    let mut db_freq_for_dedup: HashMap<String, usize> = HashMap::new();
    for (chunk_id, _) in &deduped {
        if let Ok(db_name) = conn.query_row(
            "SELECT db_name FROM schema_index_chunks WHERE id = ?1 AND connection_id = ?2",
            params![chunk_id, connection_id],
            |row| row.get::<_, String>(0),
        ) {
            *db_freq_for_dedup.entry(db_name).or_insert(0) += 1;
        }
    }

    for (chunk_id, score) in &deduped {
        let result: Option<SearchResult> = conn
            .query_row(
                "SELECT id, chunk_key, db_name, table_name, chunk_type, ddl_text, ref_db_name, ref_table_name
                 FROM schema_index_chunks
                 WHERE id = ?1 AND connection_id = ?2",
                params![chunk_id, connection_id],
                |row| row_to_search_result(row, *score),
            )
            .ok();

        if let Some(r) = result {
            // Cross-database dedup: if same table_name already selected from a
            // DIFFERENT database with a similar score (within 5%), skip this duplicate
            if let Some(&(existing_score, ref existing_db)) = selected_table_info.get(&r.table_name)
            {
                if existing_db != &r.db_name {
                    let diff_ratio = (existing_score - r.score).abs() / existing_score.max(1e-9);
                    if diff_ratio < 0.05 {
                        // Similar score from different db — skip this cross-db duplicate
                        tracing::debug!(
                            table_name = %r.table_name,
                            db_name = %r.db_name,
                            score = r.score,
                            existing_score = existing_score,
                            existing_db = %existing_db,
                            "multi_query_search: step 4 — skipping cross-db duplicate"
                        );
                        continue;
                    }
                }
            }
            selected_table_info
                .entry(r.table_name.clone())
                .or_insert((r.score, r.db_name.clone()));
            top_n.push(r);
            if top_n.len() >= config.top_n_results {
                break;
            }
        }
    }

    tracing::debug!(
        connection_id = %connection_id,
        top_n_count = top_n.len(),
        top_n_results = ?top_n.iter().map(|r| (format!("{}.{}", r.db_name, r.table_name), &r.chunk_type, r.score)).collect::<Vec<_>>(),
        "multi_query_search: step 4 — top-N selected"
    );

    Ok(top_n)
}

/// Run base search + hint boosts, but WITHOUT graph expansion.
/// Used when re-ranking needs to happen between base search and graph walk.
pub fn multi_query_search_with_hints(
    conn: &Connection,
    connection_id: &str,
    query_texts: &[String],
    query_vectors: &[Vec<f32>],
    config: &SearchConfigExt,
) -> Result<Vec<SearchResult>> {
    // Run the base pipeline
    let mut results = multi_query_search_configured(
        conn,
        connection_id,
        query_texts,
        query_vectors,
        &config.base,
    )?;

    if results.is_empty() {
        return Ok(results);
    }

    // ── Hint boosts ─────────────────────────────────────────────────────
    let mut hint_weights: HashMap<(String, String), f64> = HashMap::new();

    for hint in &config.hints.recent_tables {
        let key = (
            hint.db_name.to_ascii_lowercase(),
            hint.table_name.to_ascii_lowercase(),
        );
        let e = hint_weights.entry(key).or_insert(0.0);
        if hint.weight > *e {
            *e = hint.weight;
        }
    }
    for hint in &config.hints.accepted_tables {
        let key = (
            hint.db_name.to_ascii_lowercase(),
            hint.table_name.to_ascii_lowercase(),
        );
        let e = hint_weights.entry(key).or_insert(0.0);
        if hint.weight > *e {
            *e = hint.weight;
        }
    }
    for tref in &config.hints.editor_tables {
        let key = (
            tref.db_name.to_ascii_lowercase(),
            tref.table_name.to_ascii_lowercase(),
        );
        hint_weights.entry(key).or_insert(0.5);
    }

    if !hint_weights.is_empty() && config.feedback_boost > 0.0 {
        for result in &mut results {
            let key = (
                result.db_name.to_ascii_lowercase(),
                result.table_name.to_ascii_lowercase(),
            );
            if let Some(&w) = hint_weights.get(&key) {
                result.score += config.feedback_boost * w;
            }
        }
        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    Ok(results)
}

/// Apply graph expansion to an existing set of results.
/// This is the graph-walk portion extracted from `multi_query_search_extended`.
pub fn apply_graph_expansion(
    conn: &Connection,
    connection_id: &str,
    mut results: Vec<SearchResult>,
    graph_depth: u32,
    max_fk_chunks: u32,
) -> Result<Vec<SearchResult>> {
    if graph_depth == 0 || results.is_empty() {
        return Ok(results);
    }

    let mut seeds: Vec<(String, String)> = Vec::new();
    let mut seed_scores: HashMap<(String, String), f64> = HashMap::new();
    let mut seen_tables: HashSet<(String, String)> = HashSet::new();
    // Track best-scoring db for each table_name to deduplicate cross-db seeds
    let mut best_seed_by_table: HashMap<String, (String, f64)> = HashMap::new();

    for r in &results {
        let key = (r.db_name.clone(), r.table_name.clone());
        if seen_tables.insert(key.clone()) {
            // Check if we already have a seed for this table_name from another db
            let entry = best_seed_by_table
                .entry(r.table_name.clone())
                .or_insert_with(|| (r.db_name.clone(), r.score));
            if r.score > entry.1 {
                *entry = (r.db_name.clone(), r.score);
            }
        }
        let entry = seed_scores.entry(key).or_insert(0.0f64);
        if r.score > *entry {
            *entry = r.score;
        }
    }

    // Only use the highest-scoring db instance of each table_name as a BFS seed
    for (table_name, (best_db, _)) in &best_seed_by_table {
        let key = (best_db.clone(), table_name.clone());
        seeds.push(key);
    }

    let graph_nodes = graph::bfs_related(conn, connection_id, &seeds, graph_depth, max_fk_chunks)?;

    if !graph_nodes.is_empty() {
        let seen_chunk_ids: HashSet<i64> = results.iter().map(|r| r.chunk_id).collect();

        let mut graph_results: Vec<SearchResult> = Vec::new();
        for node in &graph_nodes {
            // Use seed_index to look up the originating seed's score
            let originating_seed = &seeds[node.seed_index];
            let originating_seed_score = seed_scores.get(originating_seed).copied().unwrap_or(0.0);
            let decayed_score = originating_seed_score * 0.5f64.powi(node.hop as i32);

            let tbl_results = load_table_chunk(
                conn,
                connection_id,
                &node.db_name,
                &node.table_name,
                decayed_score,
            )?;
            for result in tbl_results {
                if !seen_chunk_ids.contains(&result.chunk_id) {
                    graph_results.push(result);
                }
            }
        }

        results.extend(graph_results);
    }

    Ok(results)
}

/// Extended search pipeline: runs the base pipeline, then applies hint boosts
/// and replaces 1-hop FK fan-out with bounded BFS graph walk.
pub fn multi_query_search_extended(
    conn: &Connection,
    connection_id: &str,
    query_texts: &[String],
    query_vectors: &[Vec<f32>],
    config: &SearchConfigExt,
) -> Result<Vec<SearchResult>> {
    // Delegate to split functions: base search + hints, then graph expansion
    let results =
        multi_query_search_with_hints(conn, connection_id, query_texts, query_vectors, config)?;

    if results.is_empty() {
        return Ok(results);
    }

    // Add editor tables as additional seeds for graph walk
    let mut editor_seeds: Vec<(String, String)> = Vec::new();
    let seen_tables: HashSet<(String, String)> = results
        .iter()
        .map(|r| (r.db_name.clone(), r.table_name.clone()))
        .collect();
    for tref in &config.hints.editor_tables {
        let key = (tref.db_name.clone(), tref.table_name.clone());
        if !seen_tables.contains(&key) {
            editor_seeds.push(key);
        }
    }

    // Apply graph expansion
    let results = apply_graph_expansion(
        conn,
        connection_id,
        results,
        config.graph_depth,
        config.base.max_fk_chunks as u32,
    )?;

    // If there were editor seeds not already in results, add them to graph expansion
    // (They were already handled in apply_graph_expansion via the results' seed set)
    let _ = editor_seeds; // editor tables added as seeds via results already

    Ok(results)
}

// ── Lexical helpers ─────────────────────────────────────────────────────

fn load_segment_df(conn: &Connection, connection_id: &str) -> HashMap<String, usize> {
    super::storage::get_segment_df_for_connection(conn, connection_id).unwrap_or_default()
}

fn extract_direct_table_candidates(query_texts: &[String]) -> HashSet<QualifiedIdentifier> {
    static TABLE_REGEX: OnceLock<regex::Regex> = OnceLock::new();
    let regex = TABLE_REGEX.get_or_init(|| {
        regex::Regex::new(
            r"(?i)\b(?:from|join|into|update|table|references)\s+((?:`[^`]+`|[a-z_][a-z0-9_]*)(?:\.(?:`[^`]+`|[a-z_][a-z0-9_]*))?)",
        )
        .expect("valid direct table regex")
    });

    let mut candidates = HashSet::new();
    for query_text in query_texts {
        for capture in regex.captures_iter(query_text) {
            if let Some(identifier) = capture.get(1) {
                let normalized = parse_qualified_identifier(identifier.as_str());
                if !normalized.table_name.is_empty() {
                    candidates.insert(normalized);
                }
            }
        }

        for token in query_text.split_whitespace() {
            if !token.contains('.') {
                continue;
            }

            let normalized = parse_qualified_identifier(
                token.trim_matches(|c: char| c.is_ascii_punctuation() && c != '.' && c != '`'),
            );
            if !normalized.table_name.is_empty() {
                candidates.insert(normalized);
            }
        }
    }

    candidates
}

fn extract_identifier_tokens(query_texts: &[String]) -> HashSet<String> {
    static IDENTIFIER_REGEX: OnceLock<regex::Regex> = OnceLock::new();
    let regex = IDENTIFIER_REGEX.get_or_init(|| {
        regex::Regex::new(r"(?i)\b[a-z_][a-z0-9_]*\b").expect("valid identifier regex")
    });

    let mut tokens = HashSet::new();
    for query_text in query_texts {
        for matched in regex.find_iter(query_text) {
            let token = matched.as_str().to_ascii_lowercase();
            if token.len() < 3 || SQL_STOPWORDS.contains(&token.as_str()) {
                continue;
            }
            tokens.insert(token);
        }
    }

    tokens
}

fn parse_qualified_identifier(identifier: &str) -> QualifiedIdentifier {
    let parts: Vec<String> = identifier
        .split('.')
        .map(|part| part.trim_matches('`').trim().to_ascii_lowercase())
        .filter(|part| !part.is_empty())
        .collect();

    match parts.as_slice() {
        [table_name] => QualifiedIdentifier {
            db_name: None,
            table_name: table_name.clone(),
        },
        [db_name, table_name] => QualifiedIdentifier {
            db_name: Some(db_name.clone()),
            table_name: table_name.clone(),
        },
        _ => QualifiedIdentifier {
            db_name: None,
            table_name: String::new(),
        },
    }
}

fn collect_lexical_table_matches(
    conn: &Connection,
    connection_id: &str,
    direct_table_candidates: &HashSet<QualifiedIdentifier>,
    identifier_tokens: &HashSet<String>,
    segment_df: &HashMap<String, usize>,
    total_tables: usize,
) -> Result<HashMap<i64, f64>> {
    let mut stmt = conn.prepare(
        "SELECT id, db_name, table_name
         FROM schema_index_chunks
         WHERE connection_id = ?1 AND chunk_type = 'table'",
    )?;

    let rows = stmt.query_map(params![connection_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let mut matches = HashMap::new();
    for row_result in rows {
        let (chunk_id, db_name, table_name) = row_result?;
        let normalized_db_name = db_name.to_ascii_lowercase();
        let normalized_table_name = table_name.to_ascii_lowercase();

        let lexical_score = lexical_score_for_table(
            &normalized_db_name,
            &normalized_table_name,
            direct_table_candidates,
            identifier_tokens,
            segment_df,
            total_tables,
        );

        if lexical_score > 0.0 {
            matches.insert(chunk_id, lexical_score);
        }
    }

    Ok(matches)
}

fn table_name_segment_matches(table_name: &str, token: &str) -> bool {
    table_name.split('_').any(|segment| segment == token)
}

/// Check if a token is a prefix of the table name or any of its segments,
/// or if the table name matches after basic plural normalization.
/// Returns a match quality: 1.0 for exact, 0.7 for prefix, 0.5 for
/// substring, 0.0 for no match.
fn fuzzy_name_match(table_name: &str, token: &str) -> f64 {
    // Exact match
    if table_name == token {
        return 1.0;
    }
    // Simple plural normalization: "brand" matches "brands" and vice versa
    if normalize_plural(table_name) == normalize_plural(token) {
        return 0.95;
    }
    // Token is a prefix of the table name (e.g. "rfx" → "rfxtracking")
    // Require at least 3 chars for prefix matching to avoid noise
    if token.len() >= 3 && table_name.starts_with(token) {
        // Score proportional to how much of the table name is covered
        let coverage = token.len() as f64 / table_name.len() as f64;
        return 0.6 + 0.3 * coverage; // range [0.6, 0.9]
    }
    // Token is a prefix of a segment
    for segment in table_name.split('_') {
        if segment == token {
            return 1.0; // exact segment match (handled by table_name_segment_matches too)
        }
        if normalize_plural(segment) == normalize_plural(token) {
            return 0.9;
        }
        if token.len() >= 3 && segment.starts_with(token) {
            let coverage = token.len() as f64 / segment.len() as f64;
            return 0.5 + 0.3 * coverage;
        }
    }
    0.0
}

/// Naive plural normalization: strip trailing 's' if the word is long enough.
fn normalize_plural(word: &str) -> &str {
    if word.len() > 3 && word.ends_with('s') {
        &word[..word.len() - 1]
    } else {
        word
    }
}

/// Compute IDF weight for a segment: log(N / df).
/// Returns a value in roughly [0, log(N)] range, capped at 1.0 for normalization.
fn idf_weight(segment: &str, segment_df: &HashMap<String, usize>, total_tables: usize) -> f64 {
    let df = segment_df.get(segment).copied().unwrap_or(1).max(1);
    let raw_idf = (total_tables as f64 / df as f64).ln();
    // Normalize: cap at a reasonable max so IDF doesn't blow up scores
    raw_idf.max(0.0).min(5.0) / 5.0
}

fn lexical_score_for_table(
    db_name: &str,
    table_name: &str,
    direct_table_candidates: &HashSet<QualifiedIdentifier>,
    identifier_tokens: &HashSet<String>,
    segment_df: &HashMap<String, usize>,
    total_tables: usize,
) -> f64 {
    // Direct table match (FROM users, schema.users) — full score, no IDF needed
    if direct_table_candidates.contains(&QualifiedIdentifier {
        db_name: Some(db_name.to_string()),
        table_name: table_name.to_string(),
    }) {
        return DIRECT_TABLE_MATCH_SCORE;
    }
    if direct_table_candidates.contains(&QualifiedIdentifier {
        db_name: None,
        table_name: table_name.to_string(),
    }) {
        return IDENTIFIER_EXACT_MATCH_SCORE;
    }
    if identifier_tokens.contains(table_name) {
        return IDENTIFIER_EXACT_MATCH_SCORE;
    }

    // Fuzzy exact match: token "brand" matches table "brands" (plural normalization)
    // or token "rfx" matches table "rfxtracking" (prefix)
    let mut best_fuzzy_score = 0.0f64;

    for token in identifier_tokens {
        let quality = fuzzy_name_match(table_name, token);
        if quality > 0.0 {
            let idf = if segment_df.is_empty() {
                1.0
            } else {
                idf_weight(token, segment_df, total_tables)
            };
            let len_factor = (token.len() as f64 / 4.0).min(1.0);
            let score = IDENTIFIER_EXACT_MATCH_SCORE * quality * idf * len_factor;
            if score > best_fuzzy_score {
                best_fuzzy_score = score;
            }
        }
    }

    for candidate in direct_table_candidates {
        let quality = fuzzy_name_match(table_name, &candidate.table_name);
        if quality > 0.0 {
            let idf = if segment_df.is_empty() {
                1.0
            } else {
                idf_weight(&candidate.table_name, segment_df, total_tables)
            };
            let len_factor = (candidate.table_name.len() as f64 / 4.0).min(1.0);
            let score = DIRECT_TABLE_SEGMENT_MATCH_SCORE * quality * idf * len_factor;
            if score > best_fuzzy_score {
                best_fuzzy_score = score;
            }
        }
    }

    // Fall back to old segment matching for cases fuzzy didn't cover
    if best_fuzzy_score == 0.0 {
        for candidate in direct_table_candidates {
            if table_name_segment_matches(table_name, &candidate.table_name) {
                let idf = if segment_df.is_empty() {
                    1.0
                } else {
                    idf_weight(&candidate.table_name, segment_df, total_tables)
                };
                let len_factor = (candidate.table_name.len() as f64 / 4.0).min(1.0);
                return DIRECT_TABLE_SEGMENT_MATCH_SCORE * idf * len_factor;
            }
        }

        for token in identifier_tokens {
            if table_name_segment_matches(table_name, token) {
                let idf = if segment_df.is_empty() {
                    1.0
                } else {
                    idf_weight(token, segment_df, total_tables)
                };
                let len_factor = (token.len() as f64 / 4.0).min(1.0);
                return IDENTIFIER_SEGMENT_MATCH_SCORE * idf * len_factor;
            }
        }
    }

    best_fuzzy_score
}
