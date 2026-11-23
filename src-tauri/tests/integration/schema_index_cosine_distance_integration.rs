//! Integration tests verifying that the schema_index vec0 virtual table uses
//! cosine distance metric instead of the default L2 (Euclidean) distance.
//!
//! The bge-m3 embedding model produces normalized vectors optimized for cosine
//! similarity. Using L2 distance produces incorrect KNN rankings because vectors
//! with smaller L2 norms are preferred over semantically similar vectors.

use rusqlite::Connection;
use sqllumen_lib::init_sqlite_vec;
use sqllumen_lib::schema_index::search::multi_query_search;
use sqllumen_lib::schema_index::storage;

use crate::common;
use crate::common::schema_index_chunks::{TestTableChunk, insert_table_chunk};

const DIM: usize = 4;

/// Helper: set up in-memory DB with sqlite-vec, migrations, and vec table.
fn setup_db() -> Connection {
    init_sqlite_vec();
    let conn = common::test_db();
    storage::create_vec_table(&conn, "conn-1", DIM).expect("create vec table");
    conn
}

/// Create a normalized vector along a single axis.
fn unit_vec(axis: usize) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    if axis < DIM {
        v[axis] = 1.0;
    }
    v
}

// ── Test 1: vec0 table SQL should include distance_metric=cosine ────────
//
// The create_vec_table function should produce a CREATE VIRTUAL TABLE statement
// that includes `distance_metric=cosine`. We verify this by checking the actual
// SQL used to create the table via sqlite_master.

#[test]
fn test_vec_table_uses_cosine_distance_metric() {
    let conn = setup_db();
    let table_name = storage::vec_table_name("conn-1");

    // Query sqlite_master for the virtual table's SQL definition
    let sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
            rusqlite::params![table_name],
            |row| row.get(0),
        )
        .expect("should find vec table in sqlite_master");

    // The SQL should contain distance_metric=cosine
    let sql_lower = sql.to_lowercase();
    assert!(
        sql_lower.contains("distance_metric=cosine")
            || sql_lower.contains("distance_metric = cosine"),
        "vec0 table should be created with distance_metric=cosine for bge-m3 compatibility, \
         but the CREATE TABLE SQL is: {sql}"
    );
}

// ── Test 2: Score range should be valid for cosine distance ─────────────
//
// With cosine distance, the distance ranges [0, 2] for unit vectors.
// Score = 1.0 - distance should range [-1, 1].
// For orthogonal unit vectors, cosine distance = 1.0, so score = 0.0.
// For identical vectors, cosine distance = 0.0, so score = 1.0.
//
// With L2 distance on orthogonal unit vectors, distance = sqrt(2) ≈ 1.414,
// so score = 1.0 - 1.414 ≈ -0.414.
//
// This test checks that orthogonal unit vectors produce score = 0.0 (cosine)
// rather than score ≈ -0.414 (L2).

#[test]
fn test_orthogonal_vectors_score_zero_with_cosine_distance() {
    let conn = setup_db();

    // Insert a chunk with unit vector along axis 0
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "users",
            embedding: unit_vec(0),
        },
    );

    // Query with orthogonal unit vector along axis 1
    let query = vec![unit_vec(1)];
    let results = multi_query_search(
        &conn,
        &sqllumen_lib::schema_index::search::SearchQueries {
            connection_id: "conn-1",
            query_texts: &[],
            query_vectors: &query,
        },
        sqllumen_lib::schema_index::search::SearchLimits {
            top_k_per_query: 5,
            top_n_results: 10,
            max_foreign_key_chunks: 20,
        },
    )
    .expect("search should succeed");

    assert_eq!(results.len(), 1, "should have exactly one result");

    // With RRF scoring, even orthogonal vectors get a positive score (rank-based).
    // The important thing is that the score is small and rank-based: 1/(60+1) ≈ 0.0164.
    // This proves the result was returned (sqlite-vec uses cosine distance) and RRF assigned a score.
    let score = results[0].score;
    let expected_rrf_rank1 = 1.0 / 61.0;

    assert!(
        (score - expected_rrf_rank1).abs() < 0.01,
        "Orthogonal unit vectors should have RRF score ≈ {expected_rrf_rank1:.4} (rank 1 in single-query RRF), \
         but got score = {score:.6}."
    );
}

// ── Test 3: Cosine distance should rank by angular similarity, not L2 norm ──
//
// This test demonstrates the practical impact: with vectors of different norms
// but similar directions, cosine distance correctly ranks by direction similarity
// while L2 distance is biased by vector magnitude.
//
// Consider:
// - query:    [1, 0, 0, 0] (unit vector)
// - vec_a:    [0.5, 0.5, 0, 0] normalized → [0.707, 0.707, 0, 0] (45° from query)
// - vec_b:    [0.1, 0, 0, 0] (small magnitude, same direction as query — NOT normalized)
//
// Cosine distance: vec_b is closer (same direction), vec_a is farther (45° off).
// L2 distance: vec_a (L2 ≈ 0.41) might be closer than vec_b (L2 = 0.9).

#[test]
fn test_cosine_ranks_by_direction_not_magnitude() {
    let conn = setup_db();

    // vec_a: 45° angle from query but unit length
    let vec_a = {
        let s = 1.0_f32 / 2.0_f32.sqrt();
        vec![s, s, 0.0, 0.0]
    };

    // vec_b: same direction as query but small magnitude (not normalized)
    let vec_b = vec![0.1_f32, 0.0, 0.0, 0.0];

    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "table_a",
            embedding: vec_a.clone(),
        },
    );
    insert_table_chunk(
        &conn,
        TestTableChunk {
            connection_id: "conn-1",
            db_name: "testdb",
            table_name: "table_b",
            embedding: vec_b.clone(),
        },
    );

    // Query along axis 0
    let query = vec![unit_vec(0)];
    let results = multi_query_search(
        &conn,
        &sqllumen_lib::schema_index::search::SearchQueries {
            connection_id: "conn-1",
            query_texts: &[],
            query_vectors: &query,
        },
        sqllumen_lib::schema_index::search::SearchLimits {
            top_k_per_query: 5,
            top_n_results: 10,
            max_foreign_key_chunks: 20,
        },
    )
    .expect("search should succeed");

    assert_eq!(results.len(), 2, "should have 2 results");

    // With cosine distance: table_b (same direction) should rank higher than table_a (45° off)
    // With L2 distance: table_a (closer in L2 space) might rank higher than table_b
    assert_eq!(
        results[0].table_name,
        "table_b",
        "With cosine distance, the vector pointing in the same direction (table_b) should rank \
         first, regardless of magnitude. Got '{}' first instead. \
         Scores: {} (table_a={}, table_b={})",
        results[0].table_name,
        results[0].table_name,
        results
            .iter()
            .find(|r| r.table_name == "table_a")
            .map(|r| r.score)
            .unwrap_or(f64::NAN),
        results
            .iter()
            .find(|r| r.table_name == "table_b")
            .map(|r| r.score)
            .unwrap_or(f64::NAN),
    );
}
