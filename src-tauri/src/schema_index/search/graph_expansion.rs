use rusqlite::{Connection, Result};
use std::collections::{HashMap, HashSet};

use super::{
    load_table_chunk, multi_query_search_with_hints, GraphExpansion, ScoredTable, SearchConfigExt,
    SearchQueries, SearchResult,
};
use crate::schema_index::graph;

const GRAPH_HOP_SCORE_DECAY: f64 = 0.5;

type TableKey = (String, String);

struct BestSeed {
    db_name: String,
    score: f64,
}

struct GraphSeeds {
    seeds: Vec<TableKey>,
    seed_scores: HashMap<TableKey, f64>,
}

impl GraphSeeds {
    fn decayed_score(&self, node: &graph::GraphNode) -> f64 {
        let originating_seed = &self.seeds[node.seed_index];
        let originating_seed_score = self
            .seed_scores
            .get(originating_seed)
            .copied()
            .unwrap_or(0.0);
        originating_seed_score * GRAPH_HOP_SCORE_DECAY.powi(node.hop as i32)
    }
}

fn record_best_seed(best_seed_by_table: &mut HashMap<String, BestSeed>, result: &SearchResult) {
    let best = best_seed_by_table
        .entry(result.table_name.clone())
        .or_insert_with(|| BestSeed {
            db_name: result.db_name.clone(),
            score: result.score,
        });
    if result.score > best.score {
        *best = BestSeed {
            db_name: result.db_name.clone(),
            score: result.score,
        };
    }
}

fn collect_graph_seeds(results: &[SearchResult]) -> GraphSeeds {
    let mut seed_scores: HashMap<TableKey, f64> = HashMap::new();
    let mut seen_tables: HashSet<TableKey> = HashSet::new();
    let mut best_seed_by_table: HashMap<String, BestSeed> = HashMap::new();
    for result in results {
        let key = (result.db_name.clone(), result.table_name.clone());
        if seen_tables.insert(key.clone()) {
            record_best_seed(&mut best_seed_by_table, result);
        }
        let best_score = seed_scores.entry(key).or_insert(0.0f64);
        *best_score = best_score.max(result.score);
    }
    let seeds = best_seed_by_table
        .into_iter()
        .map(|(table_name, best)| (best.db_name, table_name))
        .collect();
    GraphSeeds { seeds, seed_scores }
}

fn load_graph_results(
    conn: &Connection,
    expansion: &GraphExpansion<'_>,
    expanded: GraphWalkResult<'_>,
) -> Result<Vec<SearchResult>> {
    let mut graph_results: Vec<SearchResult> = Vec::new();
    for node in expanded.nodes {
        let scored_table = ScoredTable {
            db_name: &node.db_name,
            table_name: &node.table_name,
            score: expanded.seeds.decayed_score(node),
        };
        let table_results = load_table_chunk(conn, expansion.connection_id, &scored_table)?;
        let unseen_results = table_results
            .into_iter()
            .filter(|result| !expanded.seen_chunk_ids.contains(&result.chunk_id));
        graph_results.extend(unseen_results);
    }
    Ok(graph_results)
}

struct GraphWalkResult<'a> {
    nodes: &'a [graph::GraphNode],
    seeds: &'a GraphSeeds,
    seen_chunk_ids: &'a HashSet<i64>,
}

/// Apply graph expansion to an existing set of results.
/// This is the graph-walk portion extracted from `multi_query_search_extended`.
pub fn apply_graph_expansion(
    conn: &Connection,
    mut results: Vec<SearchResult>,
    expansion: &GraphExpansion<'_>,
) -> Result<Vec<SearchResult>> {
    let has_nothing_to_expand = expansion.graph_depth == 0 || results.is_empty();
    if has_nothing_to_expand {
        return Ok(results);
    }

    let seeds = collect_graph_seeds(&results);
    let walk = graph::GraphWalk {
        connection_id: expansion.connection_id,
        depth: expansion.graph_depth,
        edge_budget: expansion.max_foreign_key_chunks,
    };
    let graph_nodes = graph::bfs_related(conn, &seeds.seeds, &walk)?;
    if graph_nodes.is_empty() {
        return Ok(results);
    }

    let seen_chunk_ids: HashSet<i64> = results.iter().map(|result| result.chunk_id).collect();
    let expanded = GraphWalkResult {
        nodes: &graph_nodes,
        seeds: &seeds,
        seen_chunk_ids: &seen_chunk_ids,
    };
    results.extend(load_graph_results(conn, expansion, expanded)?);
    Ok(results)
}

/// Extended search pipeline: runs the base pipeline, then applies hint boosts
/// and replaces 1-hop FK fan-out with bounded BFS graph walk.
pub fn multi_query_search_extended(
    conn: &Connection,
    queries: &SearchQueries<'_>,
    config: &SearchConfigExt,
) -> Result<Vec<SearchResult>> {
    let results = multi_query_search_with_hints(conn, queries, config)?;
    if results.is_empty() {
        return Ok(results);
    }

    let expansion = GraphExpansion {
        connection_id: queries.connection_id,
        graph_depth: config.graph_depth,
        max_foreign_key_chunks: config.base.max_fk_chunks as u32,
    };
    apply_graph_expansion(conn, results, &expansion)
}
