use rusqlite::{params, Connection, Result};
use std::collections::{HashMap, HashSet};

use super::lexical::{
    collect_lexical_table_matches, extract_direct_table_candidates, extract_identifier_tokens,
    load_segment_df, LexicalSignals,
};
use super::{row_to_search_result, SearchConfig, SearchQueries, SearchResult};
use crate::schema_index::embedding_to_bytes;

const RRF_K: f64 = 60.0;
const CROSS_DATABASE_DUPLICATE_SCORE_RATIO: f64 = 0.05;
const MIN_SCORE_DIVISOR: f64 = 1e-9;
const DB_AFFINITY_BOOST: f64 = 0.02;
const AFFINITY_TOP_CANDIDATES: usize = 3;
const LOGGED_TOP_CANDIDATES: usize = 5;

#[derive(Debug, Clone, Copy)]
struct ScoredChunk {
    chunk_id: i64,
    score: f64,
}

#[derive(Default)]
struct KnnScores {
    best_cosine: HashMap<i64, f64>,
    rrf: HashMap<i64, f64>,
    raw_hit_count: usize,
}

impl KnnScores {
    fn record_query_hits(&mut self, hits: &[ScoredChunk]) {
        self.raw_hit_count += hits.len();
        for hit in hits {
            let best = self.best_cosine.entry(hit.chunk_id).or_insert(hit.score);
            *best = best.max(hit.score);
        }
        for (rank_index, hit) in hits.iter().enumerate() {
            let rank = (rank_index + 1) as f64;
            *self.rrf.entry(hit.chunk_id).or_insert(0.0) += 1.0 / (RRF_K + rank);
        }
    }
}

struct SearchPipeline<'a> {
    conn: &'a Connection,
    connection_id: &'a str,
    query_texts: &'a [String],
    config: &'a SearchConfig,
}

fn sort_by_score_descending(chunks: &mut [ScoredChunk]) {
    chunks.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}

impl SearchPipeline<'_> {
    fn query_knn_hits(&self, query_vec: &[f32]) -> Result<Vec<ScoredChunk>> {
        let vec_table = crate::schema_index::storage::vec_table_name(self.connection_id);
        let embedding_bytes = embedding_to_bytes(query_vec);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT id, distance FROM {vec_table} WHERE embedding MATCH ?1 AND k = ?2"
        ))?;
        let knn_rows = stmt.query_map(
            params![embedding_bytes, self.config.top_k_per_query as i64],
            |row| {
                Ok(ScoredChunk {
                    chunk_id: row.get::<_, i64>(0)?,
                    score: 1.0 - row.get::<_, f64>(1)?,
                })
            },
        )?;
        let mut hits = knn_rows.collect::<Result<Vec<_>>>()?;
        sort_by_score_descending(&mut hits);
        Ok(hits)
    }

    fn collect_knn_scores(&self, query_vectors: &[Vec<f32>]) -> Result<KnnScores> {
        let mut scores = KnnScores::default();
        for (query_index, query_vec) in query_vectors.iter().enumerate() {
            let hits = self.query_knn_hits(query_vec)?;
            scores.record_query_hits(&hits);
            tracing::debug!(
                connection_id = %self.connection_id,
                query_index = query_index,
                knn_hits = hits.len(),
                "multi_query_search: step 1 — query vector {query_index} returned {} hit(s)",
                hits.len()
            );
        }
        Ok(scores)
    }

    fn blend_lexical_scores(
        &self,
        mut best_scores: HashMap<i64, f64>,
    ) -> Result<HashMap<i64, f64>> {
        let direct_table_candidates = extract_direct_table_candidates(self.query_texts);
        let identifier_tokens = extract_identifier_tokens(self.query_texts);
        let has_lexical_signals =
            !direct_table_candidates.is_empty() || !identifier_tokens.is_empty();
        if !has_lexical_signals {
            return Ok(best_scores);
        }

        let segment_df = load_segment_df(self.conn, self.connection_id);
        let total_tables =
            crate::schema_index::storage::count_table_chunks(self.conn, self.connection_id)
                .unwrap_or(1)
                .max(1);
        let signals = LexicalSignals {
            direct_table_candidates: &direct_table_candidates,
            identifier_tokens: &identifier_tokens,
            segment_df: &segment_df,
            total_tables,
        };
        let lexical_matches =
            collect_lexical_table_matches(self.conn, self.connection_id, &signals)?;
        add_lexical_matches(
            &mut best_scores,
            &lexical_matches,
            self.config.lexical_weight,
        );

        tracing::debug!(
            connection_id = %self.connection_id,
            direct_table_candidates = ?direct_table_candidates,
            identifier_tokens = ?identifier_tokens,
            candidate_count = best_scores.len(),
            "multi_query_search: step 2b — blended lexical boosts applied"
        );
        Ok(best_scores)
    }

    fn chunk_database(&self, chunk_id: i64) -> Option<String> {
        self.conn
            .query_row(
                "SELECT db_name FROM schema_index_chunks WHERE id = ?1 AND connection_id = ?2",
                params![chunk_id, self.connection_id],
                |row| row.get::<_, String>(0),
            )
            .ok()
    }

    fn apply_database_affinity(&self, best_scores: &mut HashMap<i64, f64>) {
        let chunk_db: HashMap<i64, String> = best_scores
            .keys()
            .filter_map(|chunk_id| {
                self.chunk_database(*chunk_id)
                    .map(|db_name| (*chunk_id, db_name))
            })
            .collect();
        let db_freq = count_databases(&chunk_db);
        let affinity_dbs = top_scoring_databases(best_scores, &chunk_db);

        let spans_multiple_databases = db_freq.len() > 1;
        if spans_multiple_databases {
            let affinity = DatabaseAffinity {
                chunk_db: &chunk_db,
                affinity_dbs: &affinity_dbs,
            };
            boost_affinity_databases(best_scores, &affinity);
        }

        tracing::debug!(
            connection_id = %self.connection_id,
            db_freq = ?db_freq,
            affinity_dbs = ?affinity_dbs,
            "multi_query_search: step 2c — database-affinity boost applied"
        );
    }

    fn load_chunk_result(&self, chunk: &ScoredChunk) -> Option<SearchResult> {
        self.conn
            .query_row(
                "SELECT id, chunk_key, db_name, table_name, chunk_type, ddl_text, ref_db_name, ref_table_name
                 FROM schema_index_chunks
                 WHERE id = ?1 AND connection_id = ?2",
                params![chunk.chunk_id, self.connection_id],
                |row| row_to_search_result(row, chunk.score),
            )
            .ok()
    }
}

fn add_lexical_matches(
    best_scores: &mut HashMap<i64, f64>,
    lexical_matches: &HashMap<i64, f64>,
    lexical_weight: f64,
) {
    for (chunk_id, blended_score) in best_scores.iter_mut() {
        let lexical = lexical_matches.get(chunk_id).copied().unwrap_or(0.0);
        *blended_score += lexical_weight * lexical;
    }
    for (chunk_id, lexical_score) in lexical_matches {
        best_scores
            .entry(*chunk_id)
            .or_insert(lexical_weight * lexical_score);
    }
}

fn count_databases(chunk_db: &HashMap<i64, String>) -> HashMap<String, usize> {
    let mut db_freq: HashMap<String, usize> = HashMap::new();
    for db_name in chunk_db.values() {
        *db_freq.entry(db_name.clone()).or_insert(0) += 1;
    }
    db_freq
}

fn top_scoring_databases(
    best_scores: &HashMap<i64, f64>,
    chunk_db: &HashMap<i64, String>,
) -> HashSet<String> {
    let mut ranked: Vec<ScoredChunk> = best_scores
        .iter()
        .map(|(&chunk_id, &score)| ScoredChunk { chunk_id, score })
        .collect();
    sort_by_score_descending(&mut ranked);
    ranked
        .iter()
        .take(AFFINITY_TOP_CANDIDATES)
        .filter_map(|chunk| chunk_db.get(&chunk.chunk_id).cloned())
        .collect()
}

struct DatabaseAffinity<'a> {
    chunk_db: &'a HashMap<i64, String>,
    affinity_dbs: &'a HashSet<String>,
}

impl DatabaseAffinity<'_> {
    fn is_affinity_chunk(&self, chunk_id: &i64) -> bool {
        self.chunk_db
            .get(chunk_id)
            .is_some_and(|db_name| self.affinity_dbs.contains(db_name))
    }
}

fn boost_affinity_databases(best_scores: &mut HashMap<i64, f64>, affinity: &DatabaseAffinity<'_>) {
    let boosted_scores = best_scores
        .iter_mut()
        .filter(|(chunk_id, _)| affinity.is_affinity_chunk(chunk_id));
    for (_, score) in boosted_scores {
        *score += DB_AFFINITY_BOOST;
    }
}

fn rank_candidates(
    best_scores: HashMap<i64, f64>,
    best_cosine: &HashMap<i64, f64>,
) -> Vec<ScoredChunk> {
    let cosine_of = |chunk: &ScoredChunk| best_cosine.get(&chunk.chunk_id).copied().unwrap_or(0.0);
    let mut ranked: Vec<ScoredChunk> = best_scores
        .into_iter()
        .map(|(chunk_id, score)| ScoredChunk { chunk_id, score })
        .collect();
    ranked.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                cosine_of(right)
                    .partial_cmp(&cosine_of(left))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| left.chunk_id.cmp(&right.chunk_id))
    });
    ranked
}

struct SelectedTable {
    score: f64,
    db_name: String,
}

#[derive(Default)]
struct TopResultSelection {
    results: Vec<SearchResult>,
    selected_tables: HashMap<String, SelectedTable>,
}

impl TopResultSelection {
    fn is_cross_database_duplicate(&self, candidate: &SearchResult) -> bool {
        let Some(existing) = self.selected_tables.get(&candidate.table_name) else {
            return false;
        };
        if existing.db_name == candidate.db_name {
            return false;
        }
        let diff_ratio =
            (existing.score - candidate.score).abs() / existing.score.max(MIN_SCORE_DIVISOR);
        if diff_ratio >= CROSS_DATABASE_DUPLICATE_SCORE_RATIO {
            return false;
        }
        tracing::debug!(
            table_name = %candidate.table_name,
            db_name = %candidate.db_name,
            score = candidate.score,
            existing_score = existing.score,
            existing_db = %existing.db_name,
            "multi_query_search: step 4 — skipping cross-db duplicate"
        );
        true
    }

    fn accept(&mut self, candidate: SearchResult) {
        self.selected_tables
            .entry(candidate.table_name.clone())
            .or_insert(SelectedTable {
                score: candidate.score,
                db_name: candidate.db_name.clone(),
            });
        self.results.push(candidate);
    }
}

fn select_top_results(pipeline: &SearchPipeline<'_>, ranked: &[ScoredChunk]) -> Vec<SearchResult> {
    let mut selection = TopResultSelection::default();
    for chunk in ranked {
        let Some(candidate) = pipeline.load_chunk_result(chunk) else {
            continue;
        };
        if selection.is_cross_database_duplicate(&candidate) {
            continue;
        }
        selection.accept(candidate);
        if selection.results.len() >= pipeline.config.top_n_results {
            break;
        }
    }
    selection.results
}

fn log_ranked_candidates(connection_id: &str, ranked: &[ScoredChunk]) {
    let score_range = ranked
        .first()
        .zip(ranked.last())
        .map(|(highest, lowest)| (lowest.score, highest.score));
    tracing::debug!(
        connection_id = %connection_id,
        sorted_count = ranked.len(),
        score_range = ?score_range,
        top5 = ?ranked.iter().take(LOGGED_TOP_CANDIDATES).collect::<Vec<_>>(),
        "multi_query_search: step 3 — sorted by score desc"
    );
}

fn log_top_results(connection_id: &str, top_n: &[SearchResult]) {
    let summaries: Vec<String> = top_n
        .iter()
        .map(|result| {
            format!(
                "{}.{} ({}, {})",
                result.db_name, result.table_name, result.chunk_type, result.score
            )
        })
        .collect();
    tracing::debug!(
        connection_id = %connection_id,
        top_n_count = top_n.len(),
        top_n_results = ?summaries,
        "multi_query_search: step 4 — top-N selected"
    );
}

pub fn multi_query_search_configured(
    conn: &Connection,
    queries: &SearchQueries<'_>,
    config: &SearchConfig,
) -> Result<Vec<SearchResult>> {
    let SearchQueries {
        connection_id,
        query_texts,
        query_vectors,
    } = *queries;
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

    let pipeline = SearchPipeline {
        conn,
        connection_id,
        query_texts,
        config,
    };
    let knn = pipeline.collect_knn_scores(query_vectors)?;
    tracing::debug!(
        connection_id = %connection_id,
        total_raw_results = knn.raw_hit_count,
        "multi_query_search: step 1 complete — total raw KNN results before dedup"
    );

    if knn.rrf.is_empty() {
        tracing::debug!(connection_id = %connection_id, "multi_query_search: no KNN results — returning empty");
        return Ok(vec![]);
    }
    tracing::debug!(
        connection_id = %connection_id,
        unique_chunks = knn.rrf.len(),
        raw_count = knn.raw_hit_count,
        "multi_query_search: step 2 — dedup complete (RRF fusion)"
    );

    let mut best_scores = pipeline.blend_lexical_scores(knn.rrf)?;
    pipeline.apply_database_affinity(&mut best_scores);
    let ranked = rank_candidates(best_scores, &knn.best_cosine);
    log_ranked_candidates(connection_id, &ranked);

    let top_n = select_top_results(&pipeline, &ranked);
    log_top_results(connection_id, &top_n);
    Ok(top_n)
}
