use rusqlite::{Connection, Result, params};
use std::collections::{HashSet, VecDeque};

#[derive(Debug, Clone, PartialEq)]
pub struct GraphNode {
    pub db_name: String,
    pub table_name: String,
    pub hop: u32,
    pub seed_index: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct GraphWalk<'a> {
    pub connection_id: &'a str,
    pub depth: u32,
    pub edge_budget: u32,
}

struct QueuedTable {
    db: String,
    table: String,
    hop: u32,
    seed_index: usize,
}

struct Traversal<'a> {
    conn: &'a Connection,
    connection_id: &'a str,
    edge_budget: u32,
    visited: HashSet<(String, String)>,
    queue: VecDeque<QueuedTable>,
    results: Vec<GraphNode>,
    edges_used: u32,
}

impl Traversal<'_> {
    fn mark_visited(&mut self, db: &str, table: &str) -> bool {
        self.visited.insert((db.to_string(), table.to_string()))
    }

    fn enqueue_seed(&mut self, seed: QueuedTable) {
        if self.mark_visited(&seed.db, &seed.table) {
            self.queue.push_back(seed);
        }
    }

    fn discover(&mut self, table: QueuedTable) {
        if !self.mark_visited(&table.db, &table.table) {
            return;
        }
        self.results.push(GraphNode {
            db_name: table.db.clone(),
            table_name: table.table.clone(),
            hop: table.hop,
            seed_index: table.seed_index,
        });
        self.queue.push_back(table);
    }

    fn fetch_neighbors(&self, table: &QueuedTable) -> Result<Vec<(String, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT dst_db, dst_tbl FROM schema_index_fk_edges
             WHERE connection_id = ?1 AND src_db = ?2 AND src_tbl = ?3
             UNION
             SELECT DISTINCT src_db, src_tbl FROM schema_index_fk_edges
             WHERE connection_id = ?1 AND dst_db = ?2 AND dst_tbl = ?3",
        )?;
        let neighbors = stmt
            .query_map(params![self.connection_id, table.db, table.table], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(|row| row.ok())
            .collect();
        Ok(neighbors)
    }

    fn is_budget_exhausted(&self) -> bool {
        self.edges_used >= self.edge_budget
    }
}

fn enqueue_neighbors(
    traversal: &mut Traversal<'_>,
    from: &QueuedTable,
    neighbors: Vec<(String, String)>,
) {
    for (db, table) in neighbors {
        traversal.edges_used += 1;
        if traversal.edges_used > traversal.edge_budget {
            return;
        }
        traversal.discover(QueuedTable {
            db,
            table,
            hop: from.hop + 1,
            seed_index: from.seed_index,
        });
    }
}

fn has_fk_edges_table(conn: &Connection) -> bool {
    conn.prepare("SELECT 1 FROM schema_index_fk_edges LIMIT 0")
        .is_ok()
}

pub fn bfs_related(
    conn: &Connection,
    seeds: &[(String, String)],
    walk: &GraphWalk<'_>,
) -> Result<Vec<GraphNode>> {
    if !has_fk_edges_table(conn) {
        return Ok(vec![]);
    }

    let mut traversal = Traversal {
        conn,
        connection_id: walk.connection_id,
        edge_budget: walk.edge_budget,
        visited: HashSet::new(),
        queue: VecDeque::new(),
        results: Vec::new(),
        edges_used: 0,
    };
    for (seed_index, (db, table)) in seeds.iter().enumerate() {
        traversal.enqueue_seed(QueuedTable {
            db: db.clone(),
            table: table.clone(),
            hop: 0,
            seed_index,
        });
    }

    while let Some(current) = traversal.queue.pop_front() {
        if current.hop >= walk.depth {
            continue;
        }
        if traversal.is_budget_exhausted() {
            break;
        }
        let neighbors = traversal.fetch_neighbors(&current)?;
        enqueue_neighbors(&mut traversal, &current, neighbors);
    }

    Ok(traversal.results)
}
