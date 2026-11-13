//! Integration tests for `schema_index::graph::bfs_related` — bounded BFS
//! over FK adjacency edges.

use rusqlite::Connection;
use sqllumen_lib::init_sqlite_vec;
use sqllumen_lib::schema_index::graph::bfs_related;
use sqllumen_lib::schema_index::storage::{self, IndexedTableRef};
use sqllumen_lib::schema_index::types::FkEdge;

use crate::common;
use crate::common::schema_index_chunks::{insert_table_chunk, TestTableChunk};

const DIM: usize = 4;

fn setup_db() -> Connection {
    init_sqlite_vec();
    let conn = common::test_db();
    storage::create_vec_table(&conn, "conn-1", DIM).expect("create vec table");
    conn
}

struct SameDatabaseEdge<'a> {
    connection_id: &'a str,
    db_name: &'a str,
    src_tbl: &'a str,
    dst_tbl: &'a str,
}

fn insert_edge(conn: &Connection, link: SameDatabaseEdge<'_>) {
    let SameDatabaseEdge {
        connection_id,
        db_name,
        src_tbl,
        dst_tbl,
    } = link;
    let edge = FkEdge {
        connection_id: connection_id.to_string(),
        src_db: db_name.to_string(),
        src_tbl: src_tbl.to_string(),
        src_col: "id".to_string(),
        dst_db: db_name.to_string(),
        dst_tbl: dst_tbl.to_string(),
        dst_col: "ref_id".to_string(),
        constraint_name: format!("fk_{src_tbl}_{dst_tbl}"),
        on_delete: Some("RESTRICT".to_string()),
        on_update: Some("RESTRICT".to_string()),
    };
    let source_table = IndexedTableRef {
        connection_id,
        db_name,
        table_name: src_tbl,
    };
    storage::replace_fk_edges_for_table(conn, &source_table, &[edge]).expect("insert edge");
}

#[test]
fn bfs_3_table_chain_returns_hop_distances() {
    let conn = setup_db();
    let cid = "conn-1";

    // Chain: A -> B -> C
    for tbl in &["A", "B", "C"] {
        insert_table_chunk(
            &conn,
            TestTableChunk {
                connection_id: cid,
                db_name: "db1",
                table_name: tbl,
                embedding: vec![1.0, 0.0, 0.0, 0.0],
            },
        );
    }
    insert_edge(
        &conn,
        SameDatabaseEdge {
            connection_id: cid,
            db_name: "db1",
            src_tbl: "A",
            dst_tbl: "B",
        },
    );
    insert_edge(
        &conn,
        SameDatabaseEdge {
            connection_id: cid,
            db_name: "db1",
            src_tbl: "B",
            dst_tbl: "C",
        },
    );

    let nodes = bfs_related(
        &conn,
        &[("db1".into(), "A".into())],
        &sqllumen_lib::schema_index::graph::GraphWalk {
            connection_id: cid,
            depth: 2,
            edge_budget: 100,
        },
    )
    .unwrap();

    // Should find B at hop 1, C at hop 2
    assert_eq!(nodes.len(), 2);

    let b = nodes.iter().find(|n| n.table_name == "B").expect("B found");
    assert_eq!(b.hop, 1);

    let c = nodes.iter().find(|n| n.table_name == "C").expect("C found");
    assert_eq!(c.hop, 2);
}

#[test]
fn bfs_respects_depth_limit() {
    let conn = setup_db();
    let cid = "conn-1";

    for tbl in &["A", "B", "C"] {
        insert_table_chunk(
            &conn,
            TestTableChunk {
                connection_id: cid,
                db_name: "db1",
                table_name: tbl,
                embedding: vec![1.0, 0.0, 0.0, 0.0],
            },
        );
    }
    insert_edge(
        &conn,
        SameDatabaseEdge {
            connection_id: cid,
            db_name: "db1",
            src_tbl: "A",
            dst_tbl: "B",
        },
    );
    insert_edge(
        &conn,
        SameDatabaseEdge {
            connection_id: cid,
            db_name: "db1",
            src_tbl: "B",
            dst_tbl: "C",
        },
    );

    // Depth 1 — should only find B
    let nodes = bfs_related(
        &conn,
        &[("db1".into(), "A".into())],
        &sqllumen_lib::schema_index::graph::GraphWalk {
            connection_id: cid,
            depth: 1,
            edge_budget: 100,
        },
    )
    .unwrap();
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].table_name, "B");
    assert_eq!(nodes[0].hop, 1);
}

#[test]
fn bfs_respects_edge_budget() {
    let conn = setup_db();
    let cid = "conn-1";

    // Star: center -> A, center -> B, center -> C
    for tbl in &["center", "A", "B", "C"] {
        insert_table_chunk(
            &conn,
            TestTableChunk {
                connection_id: cid,
                db_name: "db1",
                table_name: tbl,
                embedding: vec![1.0, 0.0, 0.0, 0.0],
            },
        );
    }
    insert_edge(
        &conn,
        SameDatabaseEdge {
            connection_id: cid,
            db_name: "db1",
            src_tbl: "center",
            dst_tbl: "A",
        },
    );
    insert_edge(
        &conn,
        SameDatabaseEdge {
            connection_id: cid,
            db_name: "db1",
            src_tbl: "center",
            dst_tbl: "B",
        },
    );
    insert_edge(
        &conn,
        SameDatabaseEdge {
            connection_id: cid,
            db_name: "db1",
            src_tbl: "center",
            dst_tbl: "C",
        },
    );

    // Edge budget of 2 — should stop after exploring 2 edges
    let nodes = bfs_related(
        &conn,
        &[("db1".into(), "center".into())],
        &sqllumen_lib::schema_index::graph::GraphWalk {
            connection_id: cid,
            depth: 2,
            edge_budget: 2,
        },
    )
    .unwrap();
    // Should find at most 2 neighbors
    assert!(nodes.len() <= 2);
}

#[test]
fn bfs_handles_cycles() {
    let conn = setup_db();
    let cid = "conn-1";

    // Cycle: A -> B -> C -> A
    for tbl in &["A", "B", "C"] {
        insert_table_chunk(
            &conn,
            TestTableChunk {
                connection_id: cid,
                db_name: "db1",
                table_name: tbl,
                embedding: vec![1.0, 0.0, 0.0, 0.0],
            },
        );
    }
    insert_edge(
        &conn,
        SameDatabaseEdge {
            connection_id: cid,
            db_name: "db1",
            src_tbl: "A",
            dst_tbl: "B",
        },
    );
    insert_edge(
        &conn,
        SameDatabaseEdge {
            connection_id: cid,
            db_name: "db1",
            src_tbl: "B",
            dst_tbl: "C",
        },
    );
    insert_edge(
        &conn,
        SameDatabaseEdge {
            connection_id: cid,
            db_name: "db1",
            src_tbl: "C",
            dst_tbl: "A",
        },
    );

    // Should not loop forever; visited set prevents revisiting
    let nodes = bfs_related(
        &conn,
        &[("db1".into(), "A".into())],
        &sqllumen_lib::schema_index::graph::GraphWalk {
            connection_id: cid,
            depth: 3,
            edge_budget: 100,
        },
    )
    .unwrap();
    assert_eq!(nodes.len(), 2); // B and C only (A is the seed)
}

#[test]
fn bfs_empty_seeds_returns_empty() {
    let conn = setup_db();
    let nodes = bfs_related(
        &conn,
        &[],
        &sqllumen_lib::schema_index::graph::GraphWalk {
            connection_id: "conn-1",
            depth: 2,
            edge_budget: 100,
        },
    )
    .unwrap();
    assert!(nodes.is_empty());
}

#[test]
fn bfs_no_edges_returns_empty() {
    let conn = setup_db();
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "db1",
            table_name: "lonely",
            embedding: vec![1.0, 0.0, 0.0, 0.0],
        },
    );
    let nodes = bfs_related(
        &conn,
        &[("db1".into(), "lonely".into())],
        &sqllumen_lib::schema_index::graph::GraphWalk {
            connection_id: "conn-1",
            depth: 2,
            edge_budget: 100,
        },
    )
    .unwrap();
    assert!(nodes.is_empty());
}
