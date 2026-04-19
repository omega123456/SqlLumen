//! Bounded BFS traversal over the `schema_index_fk_edges` adjacency table.
//!
//! Given a set of seed `(db, table)` pairs, expand outward along FK edges
//! up to `depth` hops, respecting a total `edge_budget`.

use rusqlite::{params, Connection, Result};
use std::collections::{HashSet, VecDeque};

/// A table discovered by graph walk, with its hop distance from the nearest seed
/// and the index of the originating seed in the `seeds` slice.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphNode {
    pub db_name: String,
    pub table_name: String,
    pub hop: u32,
    /// Index into the `seeds` slice that first discovered this node.
    pub seed_index: usize,
}

/// BFS over `schema_index_fk_edges` starting from `seeds`.
///
/// Returns tables reachable within `depth` hops (excluding seeds themselves),
/// capped at `edge_budget` total edges traversed.
pub fn bfs_related(
    conn: &Connection,
    connection_id: &str,
    seeds: &[(String, String)],
    depth: u32,
    edge_budget: u32,
) -> Result<Vec<GraphNode>> {
    // Check table exists
    if conn
        .prepare("SELECT 1 FROM schema_index_fk_edges LIMIT 0")
        .is_err()
    {
        return Ok(vec![]);
    }

    let mut visited: HashSet<(String, String)> = HashSet::new();
    let mut queue: VecDeque<(String, String, u32, usize)> = VecDeque::new(); // (db, tbl, hop, seed_index)
    let mut results: Vec<GraphNode> = Vec::new();
    let mut edges_used: u32 = 0;

    // Seed the BFS
    for (i, (db, tbl)) in seeds.iter().enumerate() {
        let key = (db.clone(), tbl.clone());
        if visited.insert(key) {
            queue.push_back((db.clone(), tbl.clone(), 0, i));
        }
    }

    while let Some((db, tbl, current_hop, seed_idx)) = queue.pop_front() {
        if current_hop >= depth {
            continue;
        }
        if edges_used >= edge_budget {
            break;
        }

        // Find neighbors (both directions)
        let mut stmt = conn.prepare(
            "SELECT DISTINCT dst_db, dst_tbl FROM schema_index_fk_edges
             WHERE connection_id = ?1 AND src_db = ?2 AND src_tbl = ?3
             UNION
             SELECT DISTINCT src_db, src_tbl FROM schema_index_fk_edges
             WHERE connection_id = ?1 AND dst_db = ?2 AND dst_tbl = ?3",
        )?;

        let neighbors: Vec<(String, String)> = stmt
            .query_map(params![connection_id, db, tbl], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect();

        for (n_db, n_tbl) in neighbors {
            edges_used += 1;
            if edges_used > edge_budget {
                break;
            }
            let key = (n_db.clone(), n_tbl.clone());
            if visited.insert(key) {
                let next_hop = current_hop + 1;
                results.push(GraphNode {
                    db_name: n_db.clone(),
                    table_name: n_tbl.clone(),
                    hop: next_hop,
                    seed_index: seed_idx,
                });
                queue.push_back((n_db, n_tbl, next_hop, seed_idx));
            }
        }
    }

    Ok(results)
}
