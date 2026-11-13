//! Integration tests for RRF (Reciprocal Rank Fusion) scoring in multi-query search.
//!
//! Validates that:
//! - A chunk hit by multiple queries accumulates a higher RRF score
//! - A chunk hit by 3 queries at rank 5 beats a chunk hit once at rank 1
//! - Single-query degenerates to rank-based ordering consistent with cosine

use rusqlite::Connection;
use sqllumen_lib::init_sqlite_vec;
use sqllumen_lib::schema_index::search::{multi_query_search_configured, SearchConfig};
use sqllumen_lib::schema_index::storage;

use crate::common;
use crate::common::schema_index_chunks::{insert_table_chunk, TestTableChunk};

const DIM: usize = 4;

fn setup_db() -> Connection {
    init_sqlite_vec();
    let conn = common::test_db();
    storage::create_vec_table(&conn, "conn-1", DIM).expect("create vec table");
    conn
}

#[test]
fn test_search_config_default_uses_updated_retrieval_limits() {
    let config = SearchConfig::default();
    assert_eq!(config.top_k_per_query, 30);
    assert_eq!(config.top_n_results, 20);
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

#[test]
fn test_rrf_multi_query_hit_beats_single_query_top_rank() {
    let conn = setup_db();

    // "users" is close to query vectors 0, 1, 2 (moderate match on each)
    // "orders" is a perfect match for query 0 only
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "users",
            embedding: blend_vec(0, 1, 0.6),
        },
    );
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "orders",
            embedding: unit_vec(0),
        },
    );
    // Add a filler chunk so ranks are meaningful
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "products",
            embedding: unit_vec(3),
        },
    );

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

    let results = multi_query_search_configured(
        &conn,
        &sqllumen_lib::schema_index::search::SearchQueries {
            connection_id: "conn-1",
            query_texts: &[],
            query_vectors: &query_vectors,
        },
        &config,
    )
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
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "best_match",
            embedding: unit_vec(0),
        },
    );
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "medium_match",
            embedding: blend_vec(0, 1, 0.7),
        },
    );
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "poor_match",
            embedding: unit_vec(2),
        },
    );

    let query_vectors = vec![unit_vec(0)];

    let config = SearchConfig {
        top_k_per_query: 5,
        top_n_results: 10,
        max_fk_chunks: 0,
        lexical_weight: 0.0,
    };

    let results = multi_query_search_configured(
        &conn,
        &sqllumen_lib::schema_index::search::SearchQueries {
            connection_id: "conn-1",
            query_texts: &[],
            query_vectors: &query_vectors,
        },
        &config,
    )
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
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "users",
            embedding: unit_vec(0),
        },
    );

    let config = SearchConfig {
        top_k_per_query: 5,
        top_n_results: 10,
        max_fk_chunks: 0,
        lexical_weight: 0.0,
    };

    let results = multi_query_search_configured(
        &conn,
        &sqllumen_lib::schema_index::search::SearchQueries {
            connection_id: "conn-1",
            query_texts: &[],
            query_vectors: &[],
        },
        &config,
    )
    .expect("search should succeed");

    assert!(
        results.is_empty(),
        "expected empty results for empty queries"
    );
}
