//! Multi-query vector search pipeline with deduplication, re-ranking,
//! and FK edge chunk auto-inclusion.
//!
//! The entry point is [`multi_query_search`], which:
//! 1. Runs sqlite-vec KNN for each pre-embedded query vector
//! 2. Deduplicates by chunk ID, keeping the best score
//! 3. Selects the top-N results
//! 4. Fans out to include related FK chunks for tables in the top-N
//! 5. Returns table chunks (sorted by score desc) followed by FK chunks (grouped by table)

use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use super::{builder::normalize_table_ddl, embedding_to_bytes};

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

    // ── Step 1: KNN for each query vector ───────────────────────────────
    let mut best_scores: HashMap<i64, f64> = HashMap::new();
    let mut raw_hit_count = 0usize;

    let vec_table = super::storage::vec_table_name(connection_id);

    for (i, query_vec) in query_vectors.iter().enumerate() {
        let embedding_bytes = embedding_to_bytes(query_vec);

        let mut stmt = conn.prepare(&format!(
            "SELECT id, distance FROM {vec_table} WHERE embedding MATCH ?1 AND k = ?2"
        ))?;

        let knn_rows = stmt.query_map(params![embedding_bytes, top_k_per_query as i64], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?))
        })?;

        for row_result in knn_rows {
            let (chunk_id, distance) = row_result?;
            let score = 1.0 - distance;
            raw_hit_count += 1;
            let entry = best_scores.entry(chunk_id).or_insert(score);
            if score > *entry {
                *entry = score;
            }
        }

        tracing::debug!(
            connection_id = %connection_id,
            query_index = i,
            knn_hits = best_scores.len().min(top_k_per_query),
            "multi_query_search: step 1 — query vector {i} returned {} hit(s)",
            best_scores.len().min(top_k_per_query)
        );
    }

    tracing::debug!(
        connection_id = %connection_id,
        total_raw_results = raw_hit_count,
        "multi_query_search: step 1 complete — total raw KNN results before dedup"
    );

    if best_scores.is_empty() {
        tracing::debug!(connection_id = %connection_id, "multi_query_search: no KNN results — returning empty");
        return Ok(vec![]);
    }

    // ── Step 2: Dedup by chunk_id, keeping best score ───────────────────
    tracing::debug!(
        connection_id = %connection_id,
        unique_chunks = best_scores.len(),
        raw_count = raw_hit_count,
        "multi_query_search: step 2 — dedup complete"
    );

    // ── Step 2b: Lexical table-name boosts from original queries ───────────
    let direct_table_candidates = extract_direct_table_candidates(query_texts);
    let identifier_tokens = extract_identifier_tokens(query_texts);

    if !direct_table_candidates.is_empty() || !identifier_tokens.is_empty() {
        let lexical_matches = collect_lexical_table_matches(
            conn,
            connection_id,
            &direct_table_candidates,
            &identifier_tokens,
        )?;

        for (chunk_id, lexical_score) in lexical_matches {
            let entry = best_scores.entry(chunk_id).or_insert(lexical_score);
            if lexical_score > *entry {
                *entry = lexical_score;
            }
        }

        tracing::debug!(
            connection_id = %connection_id,
            direct_table_candidates = ?direct_table_candidates,
            identifier_tokens = ?identifier_tokens,
            candidate_count = best_scores.len(),
            "multi_query_search: step 2b — lexical boosts applied"
        );
    }

    // ── Step 3: Sort by score desc ──────────────────────────────────────
    let mut deduped: Vec<(i64, f64)> = best_scores.into_iter().collect();
    deduped.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
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
    let mut top_n: Vec<SearchResult> = Vec::new();
    for (chunk_id, score) in &deduped {
        let result: Option<SearchResult> = conn
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

        if let Some(r) = result {
            top_n.push(r);
            if top_n.len() >= top_n_results {
                break;
            }
        }
    }

    tracing::debug!(
        connection_id = %connection_id,
        top_n_count = top_n.len(),
        top_n_results = ?top_n.iter().map(|r| (&r.table_name, &r.chunk_type, r.score)).collect::<Vec<_>>(),
        "multi_query_search: step 4 — top-N selected"
    );

    if top_n.is_empty() {
        tracing::debug!(connection_id = %connection_id, "multi_query_search: top-N empty after metadata fetch — returning empty");
        return Ok(vec![]);
    }

    // ── Step 5: Collect chunk IDs already in top-N (for exclusion) ──────
    let mut seen_chunk_ids: HashSet<i64> = top_n.iter().map(|r| r.chunk_id).collect();

    // Collect distinct (db_name, table_name) pairs from all top-N results
    let mut table_pairs: HashSet<(String, String)> = HashSet::new();
    for r in &top_n {
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
    // Table chunks first (sorted by score desc — already sorted),
    // then FK chunks (grouped by table — order from iteration).
    // Separate top-N into table chunks and FK chunks that were in top-N
    let mut table_results: Vec<SearchResult> = Vec::new();
    let mut top_n_fk_results: Vec<SearchResult> = Vec::new();

    for r in top_n {
        if r.chunk_type == "fk" {
            top_n_fk_results.push(r);
        } else {
            table_results.push(r);
        }
    }

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
