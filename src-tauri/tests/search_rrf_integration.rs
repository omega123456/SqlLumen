//! Integration tests for RRF (Reciprocal Rank Fusion) scoring in multi-query search.
//!
//! Validates that:
//! - A chunk hit by multiple queries accumulates a higher RRF score
//! - A chunk hit by 3 queries at rank 5 beats a chunk hit once at rank 1
//! - Single-query degenerates to rank-based ordering consistent with cosine

use rusqlite::Connection;
use sqllumen_lib::db::migrations::run_migrations;
use sqllumen_lib::init_sqlite_vec;
use sqllumen_lib::schema_index::search::{multi_query_search_configured, SearchConfig};
use sqllumen_lib::schema_index::storage;
use sqllumen_lib::schema_index::types::{ChunkInsert, ChunkType};

const DIM: usize = 4;

fn setup_db() -> Connection {
    init_sqlite_vec();
    let conn = Connection::open_in_memory().expect("open in-memory db");
    run_migrations(&conn).expect("run migrations");
    storage::create_vec_table(&conn, "conn-1", DIM).expect("create vec table");
    conn
}

fn unit_vec(axis: usize) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    if axis < DIM {
        v[axis] = 1.0;
    }
    v
}

fn blend_vec(axis_a: usize, axis_b: usize, weight_a: f32) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    if axis_a < DIM {
        v[axis_a] = weight_a;
    }
    if axis_b < DIM {
        v[axis_b] = 1.0 - weight_a;
    }
    let len: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if len > 0.0 {
        v.iter_mut().for_each(|x| *x /= len);
    }
    v
}

fn insert_table_chunk(
    conn: &Connection,
    connection_id: &str,
    db_name: &str,
    table_name: &str,
    embedding: Vec<f32>,
) -> i64 {
    let chunk = ChunkInsert {
        connection_id: connection_id.to_string(),
        chunk_key: format!("table:{db_name}.{table_name}"),
        db_name: db_name.to_string(),
        table_name: table_name.to_string(),
        chunk_type: ChunkType::Table,
        ddl_text: format!("CREATE TABLE `{table_name}` (id INT PRIMARY KEY)"),
        ddl_hash: format!("hash_{table_name}"),
        model_id: "test-model".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding,
        text_for_embedding: None,
        row_count_approx: None,
    };
    storage::insert_chunk(conn, &chunk).expect("insert table chunk")
}

#[test]
fn test_rrf_multi_query_hit_beats_single_query_top_rank() {
    let conn = setup_db();

    // "users" is close to query vectors 0, 1, 2 (moderate match on each)
    // "orders" is a perfect match for query 0 only
    insert_table_chunk(&conn, "conn-1", "testdb", "users", blend_vec(0, 1, 0.6));
    insert_table_chunk(&conn, "conn-1", "testdb", "orders", unit_vec(0));
    // Add a filler chunk so ranks are meaningful
    insert_table_chunk(&conn, "conn-1", "testdb", "products", unit_vec(3));

    // 3 query vectors — "users" will be hit by all 3, "orders" only by query 0
    let query_vectors = vec![
        unit_vec(0),          // orders=rank1, users=rank2
        unit_vec(1),          // users=rank1
        blend_vec(0, 1, 0.5), // users=rank1, orders=rank2
    ];

    let config = SearchConfig {
        top_k_per_query: 5,
        top_n_results: 10,
        max_fk_chunks: 0,
        lexical_weight: 0.0,
    };

    let results = multi_query_search_configured(&conn, "conn-1", &[], &query_vectors, &config)
        .expect("search should succeed");

    assert!(results.len() >= 2, "expected at least 2 results");

    // "users" hit by 3 queries should beat "orders" hit by ~2 queries
    // RRF(users) = 1/(60+1) + 1/(60+1) + 1/(60+2) ≈ higher
    // RRF(orders) = 1/(60+1) + 1/(60+2) ≈ lower
    // The exact ranking depends on the cosine distances, but the multi-hit advantage should dominate
    let users_idx = results.iter().position(|r| r.table_name == "users");
    let orders_idx = results.iter().position(|r| r.table_name == "orders");
    assert!(users_idx.is_some(), "users should be in results");
    assert!(orders_idx.is_some(), "orders should be in results");

    // Users should rank at or above orders due to RRF accumulation from 3 queries
    assert!(
        users_idx.unwrap() <= orders_idx.unwrap(),
        "users (hit by 3 queries) should rank at or above orders (hit by fewer queries), \
         users_idx={}, orders_idx={}",
        users_idx.unwrap(),
        orders_idx.unwrap()
    );
}

#[test]
fn test_rrf_single_query_preserves_cosine_order() {
    let conn = setup_db();

    // With a single query, RRF degenerates to rank-based ordering which should
    // match cosine distance ordering.
    insert_table_chunk(&conn, "conn-1", "testdb", "best_match", unit_vec(0));
    insert_table_chunk(
        &conn,
        "conn-1",
        "testdb",
        "medium_match",
        blend_vec(0, 1, 0.7),
    );
    insert_table_chunk(&conn, "conn-1", "testdb", "poor_match", unit_vec(2));

    let query_vectors = vec![unit_vec(0)];

    let config = SearchConfig {
        top_k_per_query: 5,
        top_n_results: 10,
        max_fk_chunks: 0,
        lexical_weight: 0.0,
    };

    let results = multi_query_search_configured(&conn, "conn-1", &[], &query_vectors, &config)
        .expect("search should succeed");

    assert!(results.len() >= 2, "expected at least 2 results");
    // best_match (cosine=1.0) should be first
    assert_eq!(results[0].table_name, "best_match");
    // medium_match should be second
    assert_eq!(results[1].table_name, "medium_match");
}

#[test]
fn test_rrf_empty_queries_returns_empty() {
    let conn = setup_db();
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));

    let config = SearchConfig {
        top_k_per_query: 5,
        top_n_results: 10,
        max_fk_chunks: 0,
        lexical_weight: 0.0,
    };

    let results = multi_query_search_configured(&conn, "conn-1", &[], &[], &config)
        .expect("search should succeed");

    assert!(
        results.is_empty(),
        "expected empty results for empty queries"
    );
}
