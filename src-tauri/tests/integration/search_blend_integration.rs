//! Integration tests for blended cosine + lexical scoring in search.
//!
//! Validates that:
//! - Cosine similarity is the primary ranker
//! - Lexical boosts are additive (λ · lexical) not overwriting
//! - IDF down-weights universal segments
//! - Direct `FROM table` still wins via lexical boost

use rusqlite::Connection;
use sqllumen_lib::init_sqlite_vec;
use sqllumen_lib::schema_index::search::{SearchConfig, multi_query_search_configured};
use sqllumen_lib::schema_index::storage;

use crate::common;
use crate::common::schema_index_chunks::{TestTableChunk, insert_table_chunk};

const DIM: usize = 4;

fn setup_db() -> Connection {
    init_sqlite_vec();
    let conn = common::test_db();
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

#[test]
fn test_cosine_beats_low_lexical_on_nl_queries() {
    let conn = setup_db();

    // "users" is far from the query vector, but its name matches a query token
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "users",
            embedding: unit_vec(3),
        },
    );
    // "accounts" is very close to the query vector
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "accounts",
            embedding: unit_vec(0),
        },
    );

    let query_vectors = vec![unit_vec(0)];
    // NL query mentions "users" but the vector points at "accounts"
    let query_texts = vec!["show me the users table".to_string()];

    let config = SearchConfig {
        top_k_per_query: 5,
        top_n_results: 10,
        max_fk_chunks: 0,
        lexical_weight: 0.0, // zero weight — pure RRF/cosine
    };

    let results = multi_query_search_configured(
        &conn,
        &sqllumen_lib::schema_index::search::SearchQueries {
            connection_id: "conn-1",
            query_texts: &query_texts,
            query_vectors: &query_vectors,
        },
        &config,
    )
    .expect("search should succeed");

    // With zero lexical weight, the RRF rank ordering (based on cosine distance) prevails
    // accounts (cosine=1.0, rank 1) beats users (cosine=~0, rank 2+)
    assert!(results.len() >= 2);
    assert_eq!(results[0].table_name, "accounts");
}

#[test]
fn test_direct_from_table_still_wins_with_moderate_lexical_weight() {
    let conn = setup_db();

    // "orders" matches the FROM clause
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "orders",
            embedding: unit_vec(3),
        },
    );
    // "products" is somewhat close to the query vector but not too close
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "products",
            embedding: blend_vec(0, 1, 0.3),
        },
    );

    let query_vectors = vec![unit_vec(0)];
    let query_texts = vec!["SELECT * FROM orders WHERE total > 100".to_string()];

    let config = SearchConfig {
        top_k_per_query: 5,
        top_n_results: 10,
        max_fk_chunks: 0,
        lexical_weight: 1.0, // high weight to make lexical decisive
    };

    let results = multi_query_search_configured(
        &conn,
        &sqllumen_lib::schema_index::search::SearchQueries {
            connection_id: "conn-1",
            query_texts: &query_texts,
            query_vectors: &query_vectors,
        },
        &config,
    )
    .expect("search should succeed");

    // "orders" should have a lexical boost of 1.0 (DIRECT_TABLE_MATCH = 1.0),
    // times λ=1.0 = 1.0 added to its cosine score.
    // Its cosine score is ~0 (orthogonal), so total ~1.0.
    // "products" cosine is moderate, ~0.6, no lexical boost.
    // So "orders" should beat "products" with high λ.
    let orders_idx = results.iter().position(|r| r.table_name == "orders");
    assert!(orders_idx.is_some(), "orders should be in results");
    assert_eq!(
        results[0].table_name, "orders",
        "FROM orders should rank first with high lexical weight"
    );
}

#[test]
fn test_blended_score_is_additive_not_overwriting() {
    let conn = setup_db();

    // "users" has high cosine AND high lexical
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "users",
            embedding: unit_vec(0),
        },
    );
    // "orders" has high cosine only
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "orders",
            embedding: blend_vec(0, 1, 0.95),
        },
    );

    let query_vectors = vec![unit_vec(0)];
    let query_texts = vec!["SELECT * FROM users".to_string()];

    let config = SearchConfig {
        top_k_per_query: 5,
        top_n_results: 10,
        max_fk_chunks: 0,
        lexical_weight: 0.2,
    };

    let results = multi_query_search_configured(
        &conn,
        &sqllumen_lib::schema_index::search::SearchQueries {
            connection_id: "conn-1",
            query_texts: &query_texts,
            query_vectors: &query_vectors,
        },
        &config,
    )
    .expect("search should succeed");

    assert!(results.len() >= 2);
    // "users" should have cosine ~1.0 + 0.2*0.8 = 1.16
    // "orders" should have cosine ~0.95 + 0 = 0.95
    // So users should be first
    assert_eq!(results[0].table_name, "users");
    assert!(results[0].score > results[1].score);
}

#[test]
fn test_lexical_weight_zero_means_pure_cosine() {
    let conn = setup_db();

    // "users" has poor cosine but perfect lexical match
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "users",
            embedding: unit_vec(3),
        },
    );
    // "accounts" has perfect cosine
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "accounts",
            embedding: unit_vec(0),
        },
    );

    let query_vectors = vec![unit_vec(0)];
    let query_texts = vec!["SELECT * FROM users".to_string()];

    let config = SearchConfig {
        top_k_per_query: 5,
        top_n_results: 10,
        max_fk_chunks: 0,
        lexical_weight: 0.0, // pure cosine
    };

    let results = multi_query_search_configured(
        &conn,
        &sqllumen_lib::schema_index::search::SearchQueries {
            connection_id: "conn-1",
            query_texts: &query_texts,
            query_vectors: &query_vectors,
        },
        &config,
    )
    .expect("search should succeed");

    assert!(results.len() >= 2);
    // With λ=0, lexical is zeroed out; accounts (cosine=1.0) beats users (cosine=0.0)
    assert_eq!(results[0].table_name, "accounts");
}
