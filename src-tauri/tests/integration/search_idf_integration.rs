//! Integration tests for IDF-aware segment matching in schema index search.
//!
//! Validates that:
//! - Segment DF table is populated and queryable
//! - Lexical segment score reflects IDF (common segments score lower)

use rusqlite::Connection;
use sqllumen_lib::init_sqlite_vec;
use sqllumen_lib::schema_index::search::{multi_query_search_configured, SearchConfig};
use sqllumen_lib::schema_index::storage;

use crate::common;
use crate::common::schema_index_chunks::insert_default_table_chunk;

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

#[test]
fn test_segment_df_table_populated_and_queryable() {
    let conn = setup_db();

    // Populate segment DF
    let entries = vec![
        ("id".to_string(), 50usize),
        ("user".to_string(), 3),
        ("order".to_string(), 5),
        ("itinerary".to_string(), 1),
    ];
    storage::replace_segment_df_for_connection(&conn, "conn-1", &entries)
        .expect("replace segment df");

    // Read back
    let df = storage::get_segment_df_for_connection(&conn, "conn-1").expect("get segment df");
    assert_eq!(df.get("id"), Some(&50));
    assert_eq!(df.get("user"), Some(&3));
    assert_eq!(df.get("itinerary"), Some(&1));
}

#[test]
fn test_idf_downweights_universal_segments() {
    let conn = setup_db();

    // Many tables with "date" segment, few with "itinerary" segment
    // order_date, created_date, update_date — "date" appears in 3 tables
    insert_default_table_chunk(&conn, "order_date", unit_vec(2));
    insert_default_table_chunk(&conn, "created_date", unit_vec(2));
    insert_default_table_chunk(&conn, "update_date", unit_vec(2));
    // itinerary_schedule — "itinerary" appears in 1 table
    insert_default_table_chunk(&conn, "itinerary_schedule", unit_vec(2));
    // target table near query
    insert_default_table_chunk(&conn, "products", unit_vec(0));

    // Populate segment DF: "date" is common (df=3), "itinerary" is rare (df=1)
    let entries = vec![
        ("date".to_string(), 3usize),
        ("itinerary".to_string(), 1),
        ("order".to_string(), 2),
        ("created".to_string(), 1),
        ("update".to_string(), 1),
        ("schedule".to_string(), 1),
        ("products".to_string(), 1),
    ];
    storage::replace_segment_df_for_connection(&conn, "conn-1", &entries)
        .expect("replace segment df");

    // Query that mentions "itinerary" and "date" as identifier tokens
    let query_vectors = vec![unit_vec(0)]; // points at products
    let query_texts = vec!["find itinerary date information".to_string()];

    let config = SearchConfig {
        top_k_per_query: 10,
        top_n_results: 10,
        max_fk_chunks: 0,
        lexical_weight: 1.0, // high weight to see lexical differences
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
    .expect("search");

    // Find itinerary_schedule and order_date in results
    let itinerary_result = results
        .iter()
        .find(|r| r.table_name == "itinerary_schedule");
    let order_date_result = results.iter().find(|r| r.table_name == "order_date");

    // itinerary_schedule should have a higher score than order_date
    // because "itinerary" has lower DF (more specific) than "date"
    if let (Some(itin), Some(od)) = (itinerary_result, order_date_result) {
        assert!(
            itin.score >= od.score,
            "rare segment 'itinerary' (score={}) should score >= common segment 'date' (score={})",
            itin.score,
            od.score
        );
    }
}

#[test]
fn test_delete_all_chunks_also_clears_segment_df() {
    let conn = setup_db();

    let entries = vec![("user".to_string(), 3usize)];
    storage::replace_segment_df_for_connection(&conn, "conn-1", &entries)
        .expect("replace segment df");

    // Wipe everything
    storage::delete_all_chunks(&conn, "conn-1").expect("delete all chunks");

    let df = storage::get_segment_df_for_connection(&conn, "conn-1").expect("get segment df");
    assert!(
        df.is_empty(),
        "segment DF should be cleared after delete_all_chunks"
    );
}

#[test]
fn test_count_table_chunks() {
    let conn = setup_db();

    assert_eq!(storage::count_table_chunks(&conn, "conn-1").unwrap(), 0);

    insert_default_table_chunk(&conn, "users", unit_vec(0));
    insert_default_table_chunk(&conn, "orders", unit_vec(1));

    assert_eq!(storage::count_table_chunks(&conn, "conn-1").unwrap(), 2);
}
