//! Integration tests for `schema_index::graph::bfs_related` — bounded BFS
//! over FK adjacency edges.

use rusqlite::Connection;
use sqllumen_lib::db::migrations::run_migrations;
use sqllumen_lib::init_sqlite_vec;
use sqllumen_lib::schema_index::graph::bfs_related;
use sqllumen_lib::schema_index::storage;
use sqllumen_lib::schema_index::types::{ChunkInsert, ChunkType, FkEdge};

const DIM: usize = 4;

fn setup_db() -> Connection {
    init_sqlite_vec();
    let conn = Connection::open_in_memory().expect("open in-memory db");
    run_migrations(&conn).expect("run migrations");
    storage::create_vec_table(&conn, "conn-1", DIM).expect("create vec table");
    conn
}

fn insert_table_chunk(conn: &Connection, connection_id: &str, db: &str, tbl: &str) {
    let chunk = ChunkInsert {
        connection_id: connection_id.to_string(),
        chunk_key: format!("table:{db}.{tbl}"),
        db_name: db.to_string(),
        table_name: tbl.to_string(),
        chunk_type: ChunkType::Table,
        ddl_text: format!("CREATE TABLE `{tbl}` (id INT PRIMARY KEY)"),
        ddl_hash: format!("hash_{tbl}"),
        model_id: "test-model".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding: vec![1.0, 0.0, 0.0, 0.0],
        text_for_embedding: None,
        row_count_approx: None,
    };
    storage::insert_chunk(conn, &chunk).expect("insert chunk");
}

fn insert_edge(
    conn: &Connection,
    cid: &str,
    src_db: &str,
    src_tbl: &str,
    dst_db: &str,
    dst_tbl: &str,
) {
    let edge = FkEdge {
        connection_id: cid.to_string(),
        src_db: src_db.to_string(),
        src_tbl: src_tbl.to_string(),
        src_col: "id".to_string(),
        dst_db: dst_db.to_string(),
        dst_tbl: dst_tbl.to_string(),
        dst_col: "ref_id".to_string(),
        constraint_name: format!("fk_{src_tbl}_{dst_tbl}"),
        on_delete: Some("RESTRICT".to_string()),
        on_update: Some("RESTRICT".to_string()),
    };
    storage::replace_fk_edges_for_table(conn, cid, src_db, src_tbl, &[edge]).expect("insert edge");
}

#[test]
fn bfs_3_table_chain_returns_hop_distances() {
    let conn = setup_db();
    let cid = "conn-1";

    // Chain: A -> B -> C
    for tbl in &["A", "B", "C"] {
        insert_table_chunk(&conn, cid, "db1", tbl);
    }
    insert_edge(&conn, cid, "db1", "A", "db1", "B");
    insert_edge(&conn, cid, "db1", "B", "db1", "C");

    let nodes = bfs_related(&conn, cid, &[("db1".into(), "A".into())], 2, 100).unwrap();

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
        insert_table_chunk(&conn, cid, "db1", tbl);
    }
    insert_edge(&conn, cid, "db1", "A", "db1", "B");
    insert_edge(&conn, cid, "db1", "B", "db1", "C");

    // Depth 1 — should only find B
    let nodes = bfs_related(&conn, cid, &[("db1".into(), "A".into())], 1, 100).unwrap();
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
        insert_table_chunk(&conn, cid, "db1", tbl);
    }
    insert_edge(&conn, cid, "db1", "center", "db1", "A");
    insert_edge(&conn, cid, "db1", "center", "db1", "B");
    insert_edge(&conn, cid, "db1", "center", "db1", "C");

    // Edge budget of 2 — should stop after exploring 2 edges
    let nodes = bfs_related(&conn, cid, &[("db1".into(), "center".into())], 2, 2).unwrap();
    // Should find at most 2 neighbors
    assert!(nodes.len() <= 2);
}

#[test]
fn bfs_handles_cycles() {
    let conn = setup_db();
    let cid = "conn-1";

    // Cycle: A -> B -> C -> A
    for tbl in &["A", "B", "C"] {
        insert_table_chunk(&conn, cid, "db1", tbl);
    }
    insert_edge(&conn, cid, "db1", "A", "db1", "B");
    insert_edge(&conn, cid, "db1", "B", "db1", "C");
    insert_edge(&conn, cid, "db1", "C", "db1", "A");

    // Should not loop forever; visited set prevents revisiting
    let nodes = bfs_related(&conn, cid, &[("db1".into(), "A".into())], 3, 100).unwrap();
    assert_eq!(nodes.len(), 2); // B and C only (A is the seed)
}

#[test]
fn bfs_empty_seeds_returns_empty() {
    let conn = setup_db();
    let nodes = bfs_related(&conn, "conn-1", &[], 2, 100).unwrap();
    assert!(nodes.is_empty());
}

#[test]
fn bfs_no_edges_returns_empty() {
    let conn = setup_db();
    insert_table_chunk(&conn, "conn-1", "db1", "lonely");
    let nodes = bfs_related(&conn, "conn-1", &[("db1".into(), "lonely".into())], 2, 100).unwrap();
    assert!(nodes.is_empty());
}
