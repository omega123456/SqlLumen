//! Multi-query vector search pipeline with deduplication, re-ranking,
//! and FK edge chunk auto-inclusion.
//!
//! The entry point is [`multi_query_search`], which:
//! 1. Runs sqlite-vec KNN for each pre-embedded query vector (one ranked list per query)
//! 2. Runs a lexical (table-name heuristic) ranker → one ranked list (plan C2)
//! 3. Runs FTS5 BM25 over `ddl_text` → one ranked list per query (plan C3)
//! 4. Fuses every ranked list with Reciprocal Rank Fusion (plan C1) — the
//!    "agreed by many signals" intuition — producing a single score per chunk
//! 5. Selects the top-N results
//! 6. Fans out to include related FK chunks for tables in the top-N
//! 7. Returns table chunks (sorted by fused score desc), then FK chunks

use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use super::{builder::normalize_table_ddl, embedding_to_bytes};

/// Reciprocal Rank Fusion constant (the standard value in the literature; see
/// Cormack, Clarke & Buettcher 2009). Larger values flatten the contribution
/// of high-ranked items, 60 is the widely-adopted default.
const RRF_K: f64 = 60.0;

/// Weights applied to each ranked list before RRF combination. Vector search
/// and BM25 are weighted equally. Lexical table-name matches get a slightly
/// higher weight because an exact `FROM db.table` or qualified identifier is
/// a very high-precision signal (the user literally named the table), whereas
/// a single query expansion may be approximate. The previous pipeline gave
/// lexical matches an absolute score of 2.5 which dwarfed any cosine hit
/// bounded by 1.0 — too strong. RRF makes this tunable: the lexical lane
/// participates in ranking but cannot single-handedly override multi-signal
/// agreement from vector + BM25 (plan C2).
const WEIGHT_VECTOR: f64 = 1.0;
const WEIGHT_BM25: f64 = 1.0;
const WEIGHT_LEXICAL: f64 = 1.5;

/// Ranks from the lexical heuristic ranker below this value are ignored when
/// fusing — a segment-match ranked 500th shouldn't add appreciable signal.
const LEXICAL_RANK_CUTOFF: usize = 50;

// ── Legacy lexical-score constants (kept for the lexical ranker's internal
// ordering within its own ranked list; the absolute magnitudes no longer
// leak into the final fused score since we use RRF — plan C2).
const DIRECT_TABLE_MATCH_SCORE: f64 = 2.5;
const IDENTIFIER_EXACT_MATCH_SCORE: f64 = 2.0;
const DIRECT_TABLE_SEGMENT_MATCH_SCORE: f64 = 1.5;
const IDENTIFIER_SEGMENT_MATCH_SCORE: f64 = 1.25;

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

fn enrich_with_related_table_chunks(
    conn: &Connection,
    connection_id: &str,
    results: Vec<SearchResult>,
) -> Result<Vec<SearchResult>> {
    let mut final_results = Vec::new();
    let mut seen_chunk_ids: HashSet<i64> = HashSet::new();

    let mut stmt = conn.prepare(
        "SELECT id, chunk_key, db_name, table_name, chunk_type, ddl_text, ref_db_name, ref_table_name
         FROM schema_index_chunks
         WHERE connection_id = ?1 AND chunk_type = 'table' AND db_name = ?2 AND table_name = ?3",
    )?;

    for result in results {
        if result.chunk_type == "fk" {
            let mut related_tables = vec![(result.db_name.clone(), result.table_name.clone())];
            if let (Some(ref_db_name), Some(ref_table_name)) =
                (result.ref_db_name.clone(), result.ref_table_name.clone())
            {
                if !related_tables.iter().any(|(db_name, table_name)| {
                    db_name == &ref_db_name && table_name == &ref_table_name
                }) {
                    related_tables.push((ref_db_name, ref_table_name));
                }
            }

            for (db_name_filter, table_name_filter) in related_tables {
                let rows = stmt.query_map(
                    params![connection_id, db_name_filter, table_name_filter],
                    |row| {
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
                                &db_name,
                                &table_name,
                                &chunk_type,
                                ddl_text,
                            ),
                            ref_db_name: row.get(6)?,
                            ref_table_name: row.get(7)?,
                            score: result.score,
                        })
                    },
                )?;

                for row in rows {
                    let table_result = row?;
                    if seen_chunk_ids.insert(table_result.chunk_id) {
                        final_results.push(table_result);
                    }
                }
            }
        }

        if seen_chunk_ids.insert(result.chunk_id) {
            final_results.push(result);
        }
    }

    Ok(final_results)
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

/// Run the full multi-query retrieval pipeline with vector + BM25 + lexical
/// fusion (plan C1–C3).
///
/// Stages (see module-level docs):
///
/// 1. Run sqlite-vec KNN once per query vector → one ranked list per query.
/// 2. Run FTS5 BM25 once per query text → one ranked list per query.
/// 3. Run the lexical table-name heuristic once → one ranked list.
/// 4. Fuse all ranked lists via weighted Reciprocal Rank Fusion (RRF). The
///    previous implementation took `max(vector_score, lexical_score)` per
///    chunk, which let one lexical constant `2.5` outrank any cosine hit
///    (bounded by 1.0) — that's fixed here.
/// 5. Fetch metadata, take top-N by fused score, run FK fan-out, and assemble
///    the final list.
pub fn multi_query_search_with_query_texts(
    conn: &Connection,
    connection_id: &str,
    query_texts: &[String],
    query_vectors: &[Vec<f32>],
    top_k_per_query: usize,
    top_n_results: usize,
    max_fk_chunks: usize,
) -> Result<Vec<SearchResult>> {
    tracing::debug!(
        connection_id = %connection_id,
        query_vector_count = query_vectors.len(),
        query_text_count = query_texts.len(),
        top_k_per_query,
        top_n_results,
        max_fk_chunks,
        "multi_query_search: pipeline start"
    );

    if query_vectors.is_empty() {
        tracing::debug!(connection_id = %connection_id, "multi_query_search: no query vectors — returning empty");
        return Ok(vec![]);
    }

    // ── Ranked lists feed RRF ────────────────────────────────────────────
    let mut ranked_lists: Vec<(f64, Vec<i64>)> = Vec::new();

    // ── Step 1: KNN — one ranked list per query vector ──────────────────
    let knn_k = top_k_per_query;

    let vec_table = super::storage::vec_table_name(connection_id);
    // Track best raw cosine score per chunk (useful for debugging / legacy
    // callers). The returned `SearchResult.score` is set from this map when
    // available; otherwise we fall back to the fused RRF score so callers can
    // still show "relevance" to the user.
    let mut best_cosine: HashMap<i64, f64> = HashMap::new();
    let mut raw_hit_count = 0usize;

    for (i, query_vec) in query_vectors.iter().enumerate() {
        let embedding_bytes = embedding_to_bytes(query_vec);

        let mut stmt = conn.prepare(&format!(
            "SELECT id, distance FROM {vec_table} WHERE embedding MATCH ?1 AND k = ?2"
        ))?;

        let rows: Vec<(i64, f64)> = stmt
            .query_map(params![embedding_bytes, knn_k as i64], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?))
            })?
            .collect::<Result<Vec<_>>>()?;

        raw_hit_count += rows.len();
        let mut ranked_ids: Vec<i64> = Vec::with_capacity(rows.len());
        for (chunk_id, distance) in rows {
            let score = 1.0 - distance;
            ranked_ids.push(chunk_id);
            best_cosine
                .entry(chunk_id)
                .and_modify(|e| {
                    if score > *e {
                        *e = score;
                    }
                })
                .or_insert(score);
        }

        tracing::debug!(
            connection_id = %connection_id,
            query_index = i,
            knn_hits = ranked_ids.len(),
            ranking = ?ranked_ids,
            "multi_query_search: step 1 — query vector {i} returned {} hit(s)",
            ranked_ids.len()
        );

        if !ranked_ids.is_empty() {
            ranked_lists.push((WEIGHT_VECTOR, ranked_ids));
        }
    }

    tracing::debug!(
        connection_id = %connection_id,
        total_raw_knn_results = raw_hit_count,
        "multi_query_search: step 1 complete — KNN ranked lists collected"
    );

    // ── Step 2: FTS5 BM25 — one ranked list per query text (plan C3) ────
    let fts_available = is_fts_populated(conn, connection_id).unwrap_or(false);
    if fts_available {
        for (i, qt) in query_texts.iter().enumerate() {
            let match_query = sanitize_fts_query(qt);
            if match_query.is_empty() {
                continue;
            }
            let rows = bm25_search(conn, connection_id, &match_query, knn_k)?;
            if rows.is_empty() {
                continue;
            }
            tracing::debug!(
                connection_id = %connection_id,
                query_index = i,
                bm25_hits = rows.len(),
                "multi_query_search: step 2 — BM25 ranked list for query {i}"
            );
            ranked_lists.push((WEIGHT_BM25, rows));
        }
    } else {
        tracing::debug!(
            connection_id = %connection_id,
            "multi_query_search: step 2 — FTS5 index unavailable; BM25 lane skipped"
        );
    }

    // ── Step 3: Lexical table-name heuristic — one ranked list (plan C2) ──
    let direct_table_candidates = extract_direct_table_candidates(query_texts);
    let identifier_tokens = extract_identifier_tokens(query_texts);
    if !direct_table_candidates.is_empty() || !identifier_tokens.is_empty() {
        let lexical_matches = collect_lexical_table_matches(
            conn,
            connection_id,
            &direct_table_candidates,
            &identifier_tokens,
        )?;
        if !lexical_matches.is_empty() {
            let mut pairs: Vec<(i64, f64)> = lexical_matches.into_iter().collect();
            pairs.sort_by(|a, b| {
                b.1.partial_cmp(&a.1)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.0.cmp(&b.0))
            });
            let ranked: Vec<i64> = pairs.into_iter().map(|(id, _)| id).collect();
            tracing::debug!(
                connection_id = %connection_id,
                direct_table_candidates = ?direct_table_candidates,
                identifier_tokens = ?identifier_tokens,
                lexical_hits = ranked.len(),
                "multi_query_search: step 3 — lexical heuristic ranked list"
            );
            ranked_lists.push((WEIGHT_LEXICAL, ranked));
        }
    }

    if ranked_lists.is_empty() {
        tracing::debug!(connection_id = %connection_id, "multi_query_search: no ranked lists — returning empty");
        return Ok(vec![]);
    }

    // ── Step 4: Reciprocal Rank Fusion (plan C1) ────────────────────────
    let fused = reciprocal_rank_fuse(&ranked_lists);

    let deduped: Vec<(i64, f64)> = fused;

    let score_range = deduped
        .first()
        .zip(deduped.last())
        .map(|((_, hi), (_, lo))| (*lo, *hi));

    tracing::debug!(
        connection_id = %connection_id,
        fused_count = deduped.len(),
        score_range = ?score_range,
        top5 = ?deduped.iter().take(5).map(|(id, s)| (*id, *s)).collect::<Vec<_>>(),
        "multi_query_search: step 4 — RRF fusion complete"
    );

    // ── Step 5: Fetch chunk metadata, collapse summary chunks, take top-N ─
    //
    // `summary` chunks only exist to boost retrieval; we don't want to return
    // them as separate blocks. When a summary chunk wins, surface the sibling
    // `table` chunk instead (or skip if absent). That way multiple lanes can
    // vote the same table up, and the final output still carries DDL.
    //
    // `top_n_rank` is the 0-indexed position in the fused ranking, captured
    // before we overwrite `SearchResult.score` with the user-facing cosine
    // value. We use it later to preserve the fused order when sorting — see
    // plan C1 (RRF ordering must not be undone by the display score).
    let mut top_n: Vec<(SearchResult, usize)> = Vec::new();
    let mut absorbed_table_keys: HashSet<String> = HashSet::new();
    for (rank, (chunk_id, score)) in deduped.iter().enumerate() {
        let raw: Option<SearchResult> = conn
            .query_row(
                "SELECT id, chunk_key, db_name, table_name, chunk_type, ddl_text, ref_db_name, ref_table_name
                 FROM schema_index_chunks
                 WHERE id = ?1 AND connection_id = ?2",
                params![chunk_id, connection_id],
                |row| {
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
                            &db_name,
                            &table_name,
                            &chunk_type,
                            ddl_text,
                        ),
                        ref_db_name: row.get(6)?,
                        ref_table_name: row.get(7)?,
                        score: *score,
                    })
                },
            )
            .ok();

        let Some(mut result) = raw else {
            continue;
        };

        if result.chunk_type == "summary" {
            let table_key = super::builder::table_chunk_key(&result.db_name, &result.table_name);
            if absorbed_table_keys.contains(&table_key) {
                continue;
            }
            match fetch_chunk_by_key(conn, connection_id, &table_key)? {
                Some(mut tbl) => {
                    tbl.score = *score;
                    absorbed_table_keys.insert(table_key);
                    result = tbl;
                }
                None => {
                    continue;
                }
            }
        } else if result.chunk_type == "table" {
            let table_key = super::builder::table_chunk_key(&result.db_name, &result.table_name);
            if absorbed_table_keys.contains(&table_key) {
                continue;
            }
            absorbed_table_keys.insert(table_key);
        }

        // Prefer raw cosine similarity as the user-facing `score` when
        // available; fall back to the fused RRF score otherwise. RRF values
        // are in [0, small] — not comparable to cosine — so we avoid surfacing
        // them directly where a cosine-like score is expected. The fused rank
        // is captured separately so ordering stays RRF-consistent.
        if let Some(cos) = best_cosine.get(&result.chunk_id) {
            result.score = *cos;
        }

        top_n.push((result, rank));
        if top_n.len() >= top_n_results {
            break;
        }
    }

    tracing::debug!(
        connection_id = %connection_id,
        top_n_count = top_n.len(),
        top_n_results = ?top_n.iter().map(|(r, rank)| (&r.table_name, &r.chunk_type, r.score, *rank)).collect::<Vec<_>>(),
        "multi_query_search: step 5 — top-N selected"
    );

    if top_n.is_empty() {
        tracing::debug!(connection_id = %connection_id, "multi_query_search: top-N empty after metadata fetch — returning empty");
        return Ok(vec![]);
    }

    // ── Step 6a: Collect chunk IDs already in top-N (for exclusion) ──────
    let mut seen_chunk_ids: HashSet<i64> = top_n.iter().map(|(r, _)| r.chunk_id).collect();

    // Collect distinct (db_name, table_name) pairs from all top-N results
    let mut table_pairs: HashSet<(String, String)> = HashSet::new();
    for (r, _) in &top_n {
        table_pairs.insert((r.db_name.clone(), r.table_name.clone()));
    }

    tracing::debug!(
        connection_id = %connection_id,
        table_pair_count = table_pairs.len(),
        tables = ?table_pairs.iter().map(|(db, tbl)| format!("{db}.{tbl}")).collect::<Vec<_>>(),
        "multi_query_search: step 5 — tables queued for FK fan-out"
    );

    // ── Step 6: FK fan-out ──────────────────────────────────────────────
    // For each table in the top-N, find FK chunks where the table is either
    // the source or the referenced table.
    let mut fk_results: Vec<SearchResult> = Vec::new();

    for (db_name, table_name) in &table_pairs {
        let mut stmt = conn.prepare(
            "SELECT id, chunk_key, db_name, table_name, chunk_type, ddl_text, ref_db_name, ref_table_name
             FROM schema_index_chunks
             WHERE connection_id = ?1
               AND chunk_type = 'fk'
               AND (
                   (db_name = ?2 AND table_name = ?3)
                   OR (ref_db_name = ?2 AND ref_table_name = ?3)
               )",
        )?;

        let before_fk = fk_results.len();

        let rows = stmt.query_map(params![connection_id, db_name, table_name], |row| {
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
                score: 0.0, // FK fan-out chunks get score 0
            })
        })?;

        for row_result in rows {
            let fk_chunk = row_result?;
            // Exclude chunks already in top-N
            if seen_chunk_ids.insert(fk_chunk.chunk_id) {
                fk_results.push(fk_chunk);
            }
        }

        let added = fk_results.len() - before_fk;
        tracing::debug!(
            connection_id = %connection_id,
            table = %format!("{db_name}.{table_name}"),
            fk_chunks_added = added,
            "multi_query_search: step 6 — FK fan-out for table"
        );
    }

    tracing::debug!(
        connection_id = %connection_id,
        fk_before_cap = fk_results.len(),
        max_fk_chunks,
        "multi_query_search: step 6 complete — FK fan-out total before cap"
    );

    // Cap FK fan-out
    fk_results.truncate(max_fk_chunks);

    tracing::debug!(
        connection_id = %connection_id,
        fk_after_cap = fk_results.len(),
        "multi_query_search: step 6 — FK fan-out after cap"
    );

    // ── Step 7: Assemble final results ──────────────────────────────────
    // Table chunks first, ordered by the fused RRF rank captured when the
    // chunk was picked — NOT by the user-facing cosine score we overwrote
    // earlier. This keeps the RRF ordering intact even when the cosine
    // "display" score inverts it (e.g. a lexical match chunk may have cosine
    // 0 but RRF rank 0). Tiebreak by chunk_id ascending for deterministic
    // output when sqlite-vec returns tied KNN distances.
    let mut table_results: Vec<(SearchResult, usize)> = Vec::new();
    let mut top_n_fk_results: Vec<(SearchResult, usize)> = Vec::new();

    for entry in top_n {
        if entry.0.chunk_type == "fk" {
            top_n_fk_results.push(entry);
        } else {
            table_results.push(entry);
        }
    }

    table_results.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.chunk_id.cmp(&b.0.chunk_id)));
    top_n_fk_results
        .sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.chunk_id.cmp(&b.0.chunk_id)));

    let table_results: Vec<SearchResult> = table_results.into_iter().map(|(r, _)| r).collect();
    let top_n_fk_results: Vec<SearchResult> =
        top_n_fk_results.into_iter().map(|(r, _)| r).collect();

    let mut final_results = Vec::new();
    // Table chunks by score desc (already sorted)
    final_results.extend(table_results);
    // FK chunks from top-N (keep their score-based order)
    final_results.extend(top_n_fk_results);
    // FK chunks from fan-out
    final_results.extend(fk_results);

    let final_results = enrich_with_related_table_chunks(conn, connection_id, final_results)?;

    tracing::debug!(
        connection_id = %connection_id,
        final_count = final_results.len(),
        table_chunks = final_results.iter().filter(|r| r.chunk_type != "fk").count(),
        fk_chunks = final_results.iter().filter(|r| r.chunk_type == "fk").count(),
        ranking = ?final_results.iter().enumerate().map(|(i, r)| (i, r.table_name.as_str(), r.chunk_type.as_str(), r.score)).collect::<Vec<_>>(),
        "multi_query_search: step 7 — final results assembled"
    );

    Ok(final_results)
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

fn lexical_score_for_table(
    db_name: &str,
    table_name: &str,
    direct_table_candidates: &HashSet<QualifiedIdentifier>,
    identifier_tokens: &HashSet<String>,
) -> f64 {
    if direct_table_candidates.contains(&QualifiedIdentifier {
        db_name: Some(db_name.to_string()),
        table_name: table_name.to_string(),
    }) {
        DIRECT_TABLE_MATCH_SCORE
    } else if direct_table_candidates.contains(&QualifiedIdentifier {
        db_name: None,
        table_name: table_name.to_string(),
    }) {
        IDENTIFIER_EXACT_MATCH_SCORE
    } else if identifier_tokens.contains(table_name) {
        IDENTIFIER_EXACT_MATCH_SCORE
    } else if direct_table_candidates
        .iter()
        .any(|candidate| table_name_segment_matches(table_name, &candidate.table_name))
    {
        DIRECT_TABLE_SEGMENT_MATCH_SCORE
    } else if identifier_tokens
        .iter()
        .any(|token| table_name_segment_matches(table_name, token))
    {
        IDENTIFIER_SEGMENT_MATCH_SCORE
    } else {
        0.0
    }
}

// ── Reciprocal Rank Fusion (plan C1) ────────────────────────────────────

/// Fuse multiple ranked lists of chunk IDs via weighted Reciprocal Rank Fusion.
///
/// For each list `l` with weight `w_l`, a chunk at rank `r` (0-indexed)
/// contributes `w_l / (RRF_K + r + 1)` to its fused score. The resulting
/// chunk ids are returned sorted by fused score descending (ties broken by
/// chunk id ascending for determinism).
fn reciprocal_rank_fuse(ranked_lists: &[(f64, Vec<i64>)]) -> Vec<(i64, f64)> {
    let mut scores: HashMap<i64, f64> = HashMap::new();
    for (weight, list) in ranked_lists {
        let effective = if *weight == WEIGHT_LEXICAL {
            // Truncate the lexical list so deep matches don't rack up noise.
            let end = list.len().min(LEXICAL_RANK_CUTOFF);
            &list[..end]
        } else {
            list.as_slice()
        };
        for (rank, id) in effective.iter().enumerate() {
            let contribution = weight / (RRF_K + (rank as f64) + 1.0);
            *scores.entry(*id).or_insert(0.0) += contribution;
        }
    }

    let mut out: Vec<(i64, f64)> = scores.into_iter().collect();
    out.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.cmp(&b.0))
    });
    out
}

// ── FTS5 BM25 lane (plan C3) ────────────────────────────────────────────

/// Name of the per-profile FTS5 virtual table backing BM25 retrieval.
pub(super) fn fts_table_name(profile_id: &str) -> String {
    format!(
        "schema_index_fts_{}",
        super::storage::sanitize_table_name(profile_id)
    )
}

/// Create the per-profile FTS5 virtual table if it doesn't exist and backfill
/// it from `schema_index_chunks`.
///
/// The FTS5 index is a contentless index keyed by `rowid = chunk_id`. The text
/// content is `ddl_text` (which for summary/FK chunks is already prose). We
/// rebuild it lazily on first BM25 use so existing profiles start receiving
/// BM25 signal without a migration. A live build is cheap (SQLite-local, no
/// embedding calls) — a few ms for thousands of chunks.
pub fn ensure_fts_populated(conn: &Connection, connection_id: &str) -> Result<()> {
    let table = fts_table_name(connection_id);
    conn.execute_batch(&format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS {table} USING fts5(
            content,
            tokenize='unicode61 remove_diacritics 2 tokenchars ''_.''',
            prefix='2 3'
        )"
    ))?;

    let row_count: i64 =
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))?;
    let chunk_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_index_chunks WHERE connection_id = ?1",
        params![connection_id],
        |row| row.get(0),
    )?;

    if row_count == chunk_count && row_count > 0 {
        return Ok(());
    }

    conn.execute(&format!("DELETE FROM {table}"), [])?;
    let mut stmt = conn.prepare(
        "SELECT id, ddl_text FROM schema_index_chunks WHERE connection_id = ?1",
    )?;
    let rows = stmt.query_map(params![connection_id], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;

    conn.execute_batch("BEGIN")?;
    for row in rows {
        let (id, text) = row?;
        conn.execute(
            &format!("INSERT INTO {table} (rowid, content) VALUES (?1, ?2)"),
            params![id, text],
        )?;
    }
    conn.execute_batch("COMMIT")?;
    Ok(())
}

/// Check whether the FTS5 index for this profile is populated. If it doesn't
/// exist yet, attempt to create and backfill it; callers gracefully fall back
/// to the vector + lexical lanes when anything fails (FTS5 is an enhancement,
/// not a requirement).
fn is_fts_populated(conn: &Connection, connection_id: &str) -> Result<bool> {
    match ensure_fts_populated(conn, connection_id) {
        Ok(()) => {
            let table = fts_table_name(connection_id);
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
                .unwrap_or(0);
            Ok(count > 0)
        }
        Err(e) => {
            tracing::warn!(
                connection_id = %connection_id,
                error = %e,
                "multi_query_search: FTS5 index setup failed; BM25 lane will be skipped"
            );
            Ok(false)
        }
    }
}

/// Sanitize a free-form user query for the FTS5 MATCH operator.
///
/// FTS5 MATCH is strict: unbalanced quotes, punctuation and SQL keywords like
/// `FROM` all mean something to it. We keep only alphanumerics, underscores
/// and dots, split on whitespace, drop short noise tokens, and OR the rest.
fn sanitize_fts_query(query: &str) -> String {
    let mut cleaned = String::with_capacity(query.len());
    for ch in query.chars() {
        if ch.is_alphanumeric() || ch == '_' || ch == '.' || ch.is_whitespace() {
            cleaned.push(ch);
        } else {
            cleaned.push(' ');
        }
    }

    let tokens: Vec<String> = cleaned
        .split_whitespace()
        .filter(|t| t.len() >= 2)
        .map(|t| {
            // Quote each token so FTS5 treats it as a phrase and dots don't
            // mean anything special.
            format!("\"{}\"", t.replace('"', ""))
        })
        .collect();

    tokens.join(" OR ")
}

/// Run a BM25 query against the per-profile FTS5 index and return chunk IDs
/// sorted by BM25 score (best first).
fn bm25_search(
    conn: &Connection,
    connection_id: &str,
    match_query: &str,
    limit: usize,
) -> Result<Vec<i64>> {
    let fts = fts_table_name(connection_id);
    let sql = format!(
        "SELECT rowid FROM {fts} WHERE {fts} MATCH ?1 ORDER BY bm25({fts}) LIMIT ?2"
    );
    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(
                connection_id = %connection_id,
                error = %e,
                "multi_query_search: bm25 prepare failed; treating lane as empty"
            );
            return Ok(Vec::new());
        }
    };

    let rows = match stmt.query_map(params![match_query, limit as i64], |row| row.get::<_, i64>(0))
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(
                connection_id = %connection_id,
                error = %e,
                query = %match_query,
                "multi_query_search: bm25 query_map failed; treating lane as empty"
            );
            return Ok(Vec::new());
        }
    };

    let mut out = Vec::new();
    for row in rows {
        match row {
            Ok(id) => out.push(id),
            Err(e) => {
                tracing::warn!(
                    connection_id = %connection_id,
                    error = %e,
                    "multi_query_search: bm25 row decode failed; skipping"
                );
            }
        }
    }
    Ok(out)
}

/// Fetch a single chunk by (connection_id, chunk_key) and return a
/// fully-populated [`SearchResult`] with `score = 0.0` (callers set it).
fn fetch_chunk_by_key(
    conn: &Connection,
    connection_id: &str,
    chunk_key: &str,
) -> Result<Option<SearchResult>> {
    let result = conn
        .query_row(
            "SELECT id, chunk_key, db_name, table_name, chunk_type, ddl_text, ref_db_name, ref_table_name
             FROM schema_index_chunks
             WHERE connection_id = ?1 AND chunk_key = ?2",
            params![connection_id, chunk_key],
            |row| {
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
                    score: 0.0,
                })
            },
        )
        .ok();
    Ok(result)
}
