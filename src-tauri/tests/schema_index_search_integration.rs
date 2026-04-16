//! Integration tests for `schema_index::search` — multi-query vector search
//! pipeline with dedup, ranking, and FK fan-out.

use rusqlite::Connection;
use sqllumen_lib::db::migrations::run_migrations;
use sqllumen_lib::init_sqlite_vec;
use sqllumen_lib::schema_index::search::{
    multi_query_search, multi_query_search_with_query_texts, SearchResult,
};
use sqllumen_lib::schema_index::storage;
use sqllumen_lib::schema_index::types::{ChunkInsert, ChunkType};

const DIM: usize = 4;

/// Helper: register sqlite-vec, open an in-memory DB, run all migrations,
/// and create the vec0 virtual table with a test dimension.
fn setup_db() -> Connection {
    init_sqlite_vec();
    let conn = Connection::open_in_memory().expect("open in-memory db");
    run_migrations(&conn).expect("run migrations");
    storage::create_vec_table(&conn, "conn-1", DIM).expect("create vec table");
    conn
}

/// Create a unit vector along a single axis.
/// e.g., `unit_vec(0)` → `[1, 0, 0, 0]`, `unit_vec(1)` → `[0, 1, 0, 0]`
fn unit_vec(axis: usize) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    if axis < DIM {
        v[axis] = 1.0;
    }
    v
}

/// Create a vector that is a blend of two axes (for intermediate similarity).
fn blend_vec(axis_a: usize, axis_b: usize, weight_a: f32) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    if axis_a < DIM {
        v[axis_a] = weight_a;
    }
    if axis_b < DIM {
        v[axis_b] = 1.0 - weight_a;
    }
    // Normalize to unit length for cosine distance
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
    };
    storage::insert_chunk(conn, &chunk).expect("insert table chunk")
}

fn insert_fk_chunk(
    conn: &Connection,
    connection_id: &str,
    db_name: &str,
    table_name: &str,
    constraint_name: &str,
    ref_db_name: &str,
    ref_table_name: &str,
    embedding: Vec<f32>,
) -> i64 {
    let chunk = ChunkInsert {
        connection_id: connection_id.to_string(),
        chunk_key: format!("fk:{db_name}.{table_name}:{constraint_name}"),
        db_name: db_name.to_string(),
        table_name: table_name.to_string(),
        chunk_type: ChunkType::Fk,
        ddl_text: format!(
            "Table {db_name}.{table_name} has a foreign key referencing {ref_db_name}.{ref_table_name}"
        ),
        ddl_hash: format!("fk_hash_{table_name}_{constraint_name}"),
        model_id: "test-model".to_string(),
        ref_db_name: Some(ref_db_name.to_string()),
        ref_table_name: Some(ref_table_name.to_string()),
        embedding,
    };
    storage::insert_chunk(conn, &chunk).expect("insert fk chunk")
}

// ── Empty index ─────────────────────────────────────────────────────────

#[test]
fn test_empty_index_returns_empty() {
    let conn = setup_db();
    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");
    assert!(results.is_empty(), "empty index should return no results");
}

// ── Empty query vectors ─────────────────────────────────────────────────

#[test]
fn test_empty_queries_returns_empty() {
    let conn = setup_db();
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));
    let results: Vec<SearchResult> =
        multi_query_search(&conn, "conn-1", &[], 5, 10, 20).expect("search should succeed");
    assert!(results.is_empty(), "empty queries should return no results");
}

// ── Single query returns top-k results ──────────────────────────────────

#[test]
fn test_single_query_returns_top_k() {
    let conn = setup_db();

    // Insert 3 table chunks with different embeddings
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "testdb", "orders", unit_vec(1));
    insert_table_chunk(&conn, "conn-1", "testdb", "products", unit_vec(2));

    // Query along axis 0 — should match "users" best
    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");

    assert!(!results.is_empty(), "should have results");
    assert!(results.len() <= 5, "should be capped at top_k_per_query");

    // First result should be "users" (perfect match along axis 0)
    assert_eq!(results[0].table_name, "users");
    assert_eq!(results[0].db_name, "testdb");
    assert!(
        results[0]
            .ddl_text
            .starts_with("CREATE TABLE `testdb`.`users`"),
        "table search results should expose database-qualified DDL, got: {}",
        results[0].ddl_text
    );
    assert!(
        results[0].score > results.last().unwrap().score || results.len() == 1,
        "first result should have highest score"
    );
}

// ── Multi-query dedup: same chunk keeps best score ──────────────────────

#[test]
fn test_multi_query_dedup_keeps_best_score() {
    let conn = setup_db();

    // Insert 2 table chunks
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "testdb", "orders", unit_vec(1));

    // Two queries: both should match "users" (axis 0) but second is slightly off-axis
    let query_exact = unit_vec(0); // perfect match to users
    let query_blend = blend_vec(0, 1, 0.9); // also close to users but less so

    let results = multi_query_search(&conn, "conn-1", &[query_exact, query_blend], 5, 10, 20)
        .expect("search should succeed");

    // "users" should only appear once (deduped)
    let users_results: Vec<&SearchResult> =
        results.iter().filter(|r| r.table_name == "users").collect();
    assert_eq!(
        users_results.len(),
        1,
        "users should appear exactly once after dedup"
    );

    // The score should be the better one (from the exact match)
    // Exact match: distance ≈ 0, score ≈ 1.0
    assert!(
        users_results[0].score > 0.9,
        "should keep the best (highest) score: got {}",
        users_results[0].score
    );
}

// ── Top-N selection ─────────────────────────────────────────────────────

#[test]
fn test_top_n_selection() {
    let conn = setup_db();

    // Insert 4 table chunks along different axes
    insert_table_chunk(&conn, "conn-1", "testdb", "t0", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "testdb", "t1", unit_vec(1));
    insert_table_chunk(&conn, "conn-1", "testdb", "t2", unit_vec(2));
    insert_table_chunk(&conn, "conn-1", "testdb", "t3", unit_vec(3));

    // Query along axis 0
    let query = vec![unit_vec(0)];

    // top_n_results = 2 — should return at most 2 table chunks
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 2, 20).expect("search should succeed");

    // Only table chunks in results (no FK chunks inserted)
    let table_chunks: Vec<&SearchResult> =
        results.iter().filter(|r| r.chunk_type == "table").collect();
    assert!(
        table_chunks.len() <= 2,
        "should have at most 2 table chunks in top-N, got {}",
        table_chunks.len()
    );
}

// ── FK fan-out includes FK chunks for tables in top-N ───────────────────

#[test]
fn test_fk_fanout_includes_related_fk_chunks() {
    let conn = setup_db();

    // Insert table chunks
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "testdb", "orders", unit_vec(1));

    // Insert FK chunk: orders → users (embedding along axis 3, so KNN won't pick it up)
    let fk_id = insert_fk_chunk(
        &conn,
        "conn-1",
        "testdb",
        "orders",
        "fk_user_id",
        "testdb",
        "users",
        unit_vec(3),
    );

    // Query along axis 0 — should match "users" (and maybe "orders")
    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");

    // The FK chunk should appear via fan-out (since "users" is in the top-N)
    let has_fk = results.iter().any(|r| r.chunk_id == fk_id);
    assert!(
        has_fk,
        "FK chunk for orders→users should be included via fan-out"
    );

    // The FK chunk should have score 0.0 (fan-out, not from KNN)
    let fk_result = results.iter().find(|r| r.chunk_id == fk_id).unwrap();
    assert_eq!(fk_result.chunk_type, "fk");
}

// ── FK fan-out is capped ────────────────────────────────────────────────

#[test]
fn test_fk_fanout_is_capped() {
    let conn = setup_db();

    // Insert one table chunk (close to query)
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));

    // Insert 3 FK chunks related to users (far from query, along axis 3)
    for i in 0..3 {
        let name = format!("fk_constraint_{i}");
        insert_fk_chunk(
            &conn,
            "conn-1",
            "testdb",
            &format!("related_table_{i}"),
            &name,
            "testdb",
            "users",
            unit_vec(3), // far from query vector
        );
    }

    // Use top_n_results=1 so only the table chunk makes it to top-N.
    // The FK chunks will come from fan-out and should be capped at max_fk_chunks=1.
    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 1, 1).expect("search should succeed");

    // First result should be the table chunk (top-N)
    assert_eq!(results[0].chunk_type, "table");
    assert_eq!(results[0].table_name, "users");

    // Fan-out FK chunks should be capped at 1
    let fk_chunks: Vec<&SearchResult> = results.iter().filter(|r| r.chunk_type == "fk").collect();
    assert_eq!(
        fk_chunks.len(),
        1,
        "FK fan-out should be capped at max_fk_chunks=1, got {}",
        fk_chunks.len()
    );
}

// ── Result ordering: table chunks by score desc, then FK chunks ─────────

#[test]
fn test_result_ordering() {
    let conn = setup_db();

    // Insert table chunks
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "testdb", "orders", blend_vec(0, 1, 0.7));

    // Insert FK chunk
    insert_fk_chunk(
        &conn,
        "conn-1",
        "testdb",
        "orders",
        "fk_user_id",
        "testdb",
        "users",
        unit_vec(3), // far from query
    );

    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");

    // Find the boundary between table and FK chunks
    let mut saw_fk = false;
    for r in &results {
        if r.chunk_type == "fk" {
            saw_fk = true;
        } else if saw_fk {
            panic!("Table chunk found after FK chunk — ordering violated");
        }
    }

    // Table chunks should be sorted by score descending
    let table_chunks: Vec<&SearchResult> =
        results.iter().filter(|r| r.chunk_type == "table").collect();
    for window in table_chunks.windows(2) {
        assert!(
            window[0].score >= window[1].score,
            "Table chunks should be sorted by score desc: {} >= {}",
            window[0].score,
            window[1].score
        );
    }
}

// ── Connection isolation: chunks from other connections are not returned ─

#[test]
fn test_connection_isolation() {
    let conn = setup_db();
    // Also create vec table for conn-2
    storage::create_vec_table(&conn, "conn-2", DIM).expect("create vec table for conn-2");

    // Insert chunks for two different connections with similar embeddings
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));
    insert_table_chunk(&conn, "conn-2", "testdb", "secret_table", unit_vec(0));

    // Search for conn-1 only
    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");

    // Should NOT contain conn-2's table
    let has_secret = results.iter().any(|r| r.table_name == "secret_table");
    assert!(
        !has_secret,
        "should not return chunks from other connections"
    );

    // Should contain conn-1's table
    let has_users = results.iter().any(|r| r.table_name == "users");
    assert!(has_users, "should return chunks for the queried connection");
}

// ── FK chunk already in top-N is not duplicated via fan-out ─────────────

#[test]
fn test_fk_in_top_n_not_duplicated_by_fanout() {
    let conn = setup_db();

    // Insert a table chunk
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));

    // Insert FK chunk with embedding close to query (so it appears in KNN top-N)
    let fk_id = insert_fk_chunk(
        &conn,
        "conn-1",
        "testdb",
        "orders",
        "fk_user_id",
        "testdb",
        "users",
        unit_vec(0), // same direction as query — will be in KNN results
    );

    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");

    // The FK chunk should appear exactly once
    let fk_count = results.iter().filter(|r| r.chunk_id == fk_id).count();
    assert_eq!(
        fk_count, 1,
        "FK chunk in top-N should not be duplicated by fan-out"
    );
}

// ── FK fan-out for referenced table side ────────────────────────────────

#[test]
fn test_fk_fanout_includes_fk_for_referenced_table() {
    let conn = setup_db();

    // "orders" table is in top-N
    insert_table_chunk(&conn, "conn-1", "testdb", "orders", unit_vec(0));

    // FK chunk: orders → users (orders is the source table)
    // This FK should be picked up because "orders" is in the top-N
    let fk_id = insert_fk_chunk(
        &conn,
        "conn-1",
        "testdb",
        "orders",
        "fk_user_id",
        "testdb",
        "users",
        unit_vec(3), // far from query
    );

    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");

    let has_fk = results.iter().any(|r| r.chunk_id == fk_id);
    assert!(
        has_fk,
        "FK chunk should be included when its source table is in top-N"
    );
}

// ── Score calculation: distance → similarity ────────────────────────────

#[test]
fn test_score_is_distance_based_similarity() {
    let conn = setup_db();

    // Insert a chunk with a known unit vector
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));

    // Query with the exact same vector — L2 distance should be 0, score should be 1.0
    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");

    assert_eq!(results.len(), 1);
    // Score should be very close to 1.0 (exact match)
    assert!(
        (results[0].score - 1.0).abs() < 0.001,
        "exact match score should be ~1.0, got {}",
        results[0].score
    );

    // Query with an orthogonal vector — cosine distance = 1.0
    // so score = 1.0 - 1.0 = 0.0 (orthogonal vectors have zero similarity)
    let query_ortho = vec![unit_vec(1)];
    let results_ortho = multi_query_search(&conn, "conn-1", &query_ortho, 5, 10, 20)
        .expect("search should succeed");

    assert_eq!(results_ortho.len(), 1);
    // For cosine distance on orthogonal unit vectors: distance = 1.0, score = 1.0 - 1.0 = 0.0
    let expected_ortho_score = 0.0;
    assert!(
        (results_ortho[0].score - expected_ortho_score).abs() < 0.01,
        "orthogonal match score should be ~{:.3}, got {}",
        expected_ortho_score,
        results_ortho[0].score
    );

    // The exact match should have a strictly higher score than the orthogonal match
    assert!(
        results[0].score > results_ortho[0].score,
        "exact match score ({}) should be > orthogonal score ({})",
        results[0].score,
        results_ortho[0].score
    );
}

// ── SearchResult fields are populated correctly ─────────────────────────

#[test]
fn test_search_result_fields() {
    let conn = setup_db();

    let chunk_id = insert_table_chunk(&conn, "conn-1", "mydb", "accounts", unit_vec(0));

    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");

    assert_eq!(results.len(), 1);
    let r = &results[0];
    assert_eq!(r.chunk_id, chunk_id);
    assert_eq!(r.chunk_key, "table:mydb.accounts");
    assert_eq!(r.db_name, "mydb");
    assert_eq!(r.table_name, "accounts");
    assert_eq!(r.chunk_type, "table");
    assert_eq!(
        r.ddl_text,
        "CREATE TABLE `mydb`.`accounts` (id INT PRIMARY KEY)"
    );
    assert_eq!(r.ref_db_name, None);
    assert_eq!(r.ref_table_name, None);
    assert!(r.score > 0.0);
}

// ── SearchResult serde round-trip ───────────────────────────────────────

#[test]
fn test_search_result_serde_round_trip() {
    let result = SearchResult {
        chunk_id: 42,
        chunk_key: "table:mydb.users".to_string(),
        db_name: "mydb".to_string(),
        table_name: "users".to_string(),
        chunk_type: "table".to_string(),
        ddl_text: "CREATE TABLE users (id INT)".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        score: 0.95,
    };

    let json = serde_json::to_string(&result).expect("serialize");
    let deserialized: SearchResult = serde_json::from_str(&json).expect("deserialize");

    assert_eq!(deserialized.chunk_id, 42);
    assert_eq!(deserialized.chunk_key, "table:mydb.users");
    assert_eq!(deserialized.db_name, "mydb");
    assert_eq!(deserialized.table_name, "users");
    assert_eq!(deserialized.chunk_type, "table");
    assert_eq!(deserialized.score, 0.95);
}

#[test]
fn test_search_result_camel_case_serialization() {
    let result = SearchResult {
        chunk_id: 1,
        chunk_key: "table:db.t".to_string(),
        db_name: "db".to_string(),
        table_name: "t".to_string(),
        chunk_type: "table".to_string(),
        ddl_text: "DDL".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        score: 0.5,
    };

    let json = serde_json::to_string(&result).expect("serialize");
    assert!(json.contains("chunkId"));
    assert!(json.contains("chunkKey"));
    assert!(json.contains("dbName"));
    assert!(json.contains("tableName"));
    assert!(json.contains("chunkType"));
    assert!(json.contains("ddlText"));
    assert!(!json.contains("chunk_id"));
}

#[test]
fn test_search_result_debug_and_clone() {
    let result = SearchResult {
        chunk_id: 1,
        chunk_key: "key".to_string(),
        db_name: "db".to_string(),
        table_name: "t".to_string(),
        chunk_type: "table".to_string(),
        ddl_text: "DDL".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        score: 0.9,
    };

    let cloned = result.clone();
    assert_eq!(cloned.chunk_id, result.chunk_id);
    assert_eq!(cloned.score, result.score);

    let debug = format!("{:?}", result);
    assert!(debug.contains("SearchResult"));
}

// ── FK fan-out dedup: same FK chunk found via two different tables ───────

#[test]
fn test_fk_fanout_dedup_within_fanout() {
    let conn = setup_db();

    // Insert two table chunks that will both be in top-N
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "testdb", "orders", blend_vec(0, 1, 0.8));

    // Insert FK chunk: orders → users (should be found via BOTH "orders" and "users" fan-out)
    let fk_id = insert_fk_chunk(
        &conn,
        "conn-1",
        "testdb",
        "orders",
        "fk_user_id",
        "testdb",
        "users",
        unit_vec(3), // far from query, won't be in KNN
    );

    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");

    // The FK chunk should appear exactly once even though both tables trigger fan-out
    let fk_count = results.iter().filter(|r| r.chunk_id == fk_id).count();
    assert_eq!(
        fk_count, 1,
        "FK chunk should appear exactly once despite being reachable from two tables in top-N"
    );
}

// ── FK chunks in KNN top-N are separated into the FK section ────────────

#[test]
fn test_fk_chunks_in_top_n_sorted_after_table_chunks() {
    let conn = setup_db();

    // Insert a table chunk
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));

    // Insert FK chunk with embedding close to query (so it enters KNN top-N)
    insert_fk_chunk(
        &conn,
        "conn-1",
        "testdb",
        "orders",
        "fk_user_id",
        "testdb",
        "users",
        blend_vec(0, 1, 0.9), // close to query → in KNN top-N
    );

    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");

    assert!(results.len() >= 2, "should have at least 2 results");

    // Table chunks should come before FK chunks (even if FK scored higher)
    let first_fk_idx = results.iter().position(|r| r.chunk_type == "fk");
    let last_table_idx = results.iter().rposition(|r| r.chunk_type == "table");

    if let (Some(fk_idx), Some(tbl_idx)) = (first_fk_idx, last_table_idx) {
        assert!(
            tbl_idx < fk_idx,
            "All table chunks should come before FK chunks in final results"
        );
    }
}

// ── Multiple queries across different axes ──────────────────────────────

#[test]
fn test_multi_query_multiple_axes() {
    let conn = setup_db();

    // Insert chunks along different axes
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "testdb", "orders", unit_vec(1));
    insert_table_chunk(&conn, "conn-1", "testdb", "products", unit_vec(2));
    insert_table_chunk(&conn, "conn-1", "testdb", "reviews", unit_vec(3));

    // Two queries along different axes — should find chunks near both
    let queries = vec![unit_vec(0), unit_vec(2)];
    let results =
        multi_query_search(&conn, "conn-1", &queries, 5, 10, 20).expect("search should succeed");

    // Should have results from both query vectors
    let has_users = results.iter().any(|r| r.table_name == "users");
    let has_products = results.iter().any(|r| r.table_name == "products");
    assert!(has_users, "should find 'users' near query axis 0");
    assert!(has_products, "should find 'products' near query axis 2");
}

#[test]
fn test_query_text_boosts_exact_table_name_matches() {
    let conn = setup_db();

    insert_table_chunk(
        &conn,
        "conn-1",
        "sykes_reservations",
        "itinerary",
        unit_vec(3),
    );
    insert_table_chunk(
        &conn,
        "conn-1",
        "sykes_reservations",
        "itinerary_date_history",
        unit_vec(0),
    );
    insert_table_chunk(&conn, "conn-1", "sykes_portal", "session_rfx", unit_vec(1));

    let query_vectors = vec![unit_vec(0), unit_vec(1)];
    let query_texts = vec![
        "SELECT * FROM itinerary i JOIN session s ON i.itinerary_id = s.itinerary_id".to_string(),
        "SELECT brand_id FROM rfx WHERE brand_id = 331".to_string(),
    ];

    let results = multi_query_search_with_query_texts(
        &conn,
        "conn-1",
        &query_texts,
        &query_vectors,
        5,
        10,
        20,
    )
    .expect("search should succeed");

    let itinerary_index = results
        .iter()
        .position(|r| r.table_name == "itinerary" && r.chunk_type == "table")
        .expect("itinerary should be present via lexical boost");

    let history_index = results
        .iter()
        .position(|r| r.table_name == "itinerary_date_history" && r.chunk_type == "table")
        .expect("itinerary_date_history should be present");

    assert!(
        itinerary_index < history_index,
        "exact table match should outrank partial itinerary match"
    );
}

#[test]
fn test_query_text_boost_prefers_schema_qualified_exact_match() {
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "sales", "orders", unit_vec(2));
    insert_table_chunk(&conn, "conn-1", "support", "orders", unit_vec(1));

    let query_vectors = vec![unit_vec(1)];
    let query_texts = vec!["SELECT * FROM sales.orders".to_string()];

    let results = multi_query_search_with_query_texts(
        &conn,
        "conn-1",
        &query_texts,
        &query_vectors,
        5,
        10,
        20,
    )
    .expect("search should succeed");

    let sales_index = results
        .iter()
        .position(|r| r.db_name == "sales" && r.table_name == "orders")
        .expect("sales.orders should be present");
    let support_index = results
        .iter()
        .position(|r| r.db_name == "support" && r.table_name == "orders")
        .expect("support.orders should be present");

    assert!(
        sales_index < support_index,
        "schema-qualified match should outrank same-named tables in other databases"
    );
}

#[test]
fn test_query_text_boosts_segment_matches_for_related_table_names() {
    let conn = setup_db();

    insert_table_chunk(
        &conn,
        "conn-1",
        "sykes_reservations",
        "itinerary_date_history",
        unit_vec(2),
    );
    insert_table_chunk(
        &conn,
        "conn-1",
        "sykes_reservations",
        "booking_history",
        unit_vec(0),
    );

    let query_vectors = vec![unit_vec(0)];
    let query_texts = vec!["find rows from itinerary linked to session".to_string()];

    let results = multi_query_search_with_query_texts(
        &conn,
        "conn-1",
        &query_texts,
        &query_vectors,
        5,
        10,
        20,
    )
    .expect("search should succeed");

    assert!(
        results
            .iter()
            .any(|r| r.table_name == "itinerary_date_history" && r.chunk_type == "table"),
        "segment match should surface related itinerary table names"
    );
}

// ── Top-N with only FK chunks in KNN results ────────────────────────────

#[test]
fn test_top_n_with_fk_only_knn_results() {
    let conn = setup_db();

    // Insert related table chunks but make FK chunks the only KNN winners.
    insert_table_chunk(&conn, "conn-1", "testdb", "orders", unit_vec(3));
    insert_table_chunk(&conn, "conn-1", "testdb", "items", unit_vec(3));

    insert_fk_chunk(
        &conn,
        "conn-1",
        "testdb",
        "orders",
        "fk_user_id",
        "testdb",
        "users",
        unit_vec(0),
    );
    insert_fk_chunk(
        &conn,
        "conn-1",
        "testdb",
        "items",
        "fk_order_id",
        "testdb",
        "orders",
        unit_vec(1),
    );

    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");

    assert!(!results.is_empty(), "should have some results");
    assert_eq!(
        results[0].chunk_type, "table",
        "related table DDL should be backfilled first"
    );
    // After the RRF fusion redesign (plan C1) the deterministic tiebreak that
    // used to surface 'orders' first is gone — whichever table the KNN lane
    // ranked higher wins. The invariant that matters is that BOTH related
    // tables are surfaced as table chunks and that FK chunks still appear
    // after the table backfill.
    let table_names: std::collections::HashSet<&str> = results
        .iter()
        .filter(|r| r.chunk_type == "table")
        .map(|r| r.table_name.as_str())
        .collect();
    assert!(
        table_names.contains("orders") && table_names.contains("items"),
        "both FK-endpoint tables should be present, got: {:?}",
        table_names
    );
    assert!(
        results.iter().any(|r| r.chunk_type == "fk"),
        "FK chunks should still be included after table backfill"
    );
}

#[test]
fn test_query_text_boost_prefers_schema_qualified_tokens_without_sql_keywords() {
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "sales", "orders", unit_vec(2));
    insert_table_chunk(&conn, "conn-1", "support", "orders", unit_vec(1));

    let query_vectors = vec![unit_vec(1)];
    let query_texts = vec!["sales.orders revenue total".to_string()];

    let results = multi_query_search_with_query_texts(
        &conn,
        "conn-1",
        &query_texts,
        &query_vectors,
        5,
        10,
        20,
    )
    .expect("search should succeed");

    let sales_index = results
        .iter()
        .position(|r| r.db_name == "sales" && r.table_name == "orders")
        .expect("sales.orders should be present");
    let support_index = results
        .iter()
        .position(|r| r.db_name == "support" && r.table_name == "orders")
        .expect("support.orders should be present");

    assert!(
        sales_index < support_index,
        "database-qualified token should outrank same-named tables in other databases"
    );
}

// ── Single result — score range logging edge case ───────────────────────

#[test]
fn test_single_chunk_single_query() {
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "testdb", "solo", unit_vec(0));

    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 1, 1, 0).expect("search should succeed");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].table_name, "solo");
    assert!(
        (results[0].score - 1.0).abs() < 0.001,
        "exact match should have score ~1.0"
    );
}

// ── FK fan-out cap of zero prevents additional FK fan-out ────────────────

#[test]
fn test_fk_fanout_cap_zero() {
    let conn = setup_db();

    // Insert enough table chunks to fill the top-N entirely with table results
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "testdb", "orders", blend_vec(0, 1, 0.8));
    insert_table_chunk(&conn, "conn-1", "testdb", "products", blend_vec(0, 2, 0.7));

    // Insert many FK chunks far from query, so they don't appear in KNN
    for i in 0..5 {
        insert_fk_chunk(
            &conn,
            "conn-1",
            "testdb",
            &format!("related_{i}"),
            &format!("fk_{i}"),
            "testdb",
            "users",
            unit_vec(3), // orthogonal to query
        );
    }

    // top_n_results=3 to fill with table chunks, max_fk_chunks=0 to block fan-out
    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 3, 0).expect("search should succeed");

    // FK chunks from fan-out have score 0.0 — with cap=0, none should appear from fan-out
    let fk_fanout: Vec<&SearchResult> = results
        .iter()
        .filter(|r| r.chunk_type == "fk" && r.score == 0.0)
        .collect();
    assert!(
        fk_fanout.is_empty(),
        "With max_fk_chunks=0, no FK fan-out chunks should appear, got {}",
        fk_fanout.len()
    );
}

// ── Multiple FK chunks for the same table pair ──────────────────────────

#[test]
fn test_multiple_fk_chunks_same_table_pair() {
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));

    // Two FK constraints from orders → users
    insert_fk_chunk(
        &conn,
        "conn-1",
        "testdb",
        "orders",
        "fk_user_id",
        "testdb",
        "users",
        unit_vec(3),
    );
    insert_fk_chunk(
        &conn,
        "conn-1",
        "testdb",
        "orders",
        "fk_manager_id",
        "testdb",
        "users",
        unit_vec(3),
    );

    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");

    // Both FK chunks should be included
    let fk_chunks: Vec<&SearchResult> = results.iter().filter(|r| r.chunk_type == "fk").collect();
    assert_eq!(
        fk_chunks.len(),
        2,
        "Both FK constraints should be in results via fan-out"
    );
}

// ── Empty KNN results from non-matching vector ──────────────────────────

#[test]
fn test_knn_returns_results_but_connection_filter_removes_them() {
    let conn = setup_db();
    // Create vec table for conn-2
    storage::create_vec_table(&conn, "conn-2", DIM).expect("create vec table for conn-2");

    // Only insert data for conn-2 (not conn-1)
    insert_table_chunk(&conn, "conn-2", "testdb", "users", unit_vec(0));

    // Query for conn-1 — KNN may return conn-2's vectors since vec table is per-profile,
    // but conn-1's vec table is empty. So KNN returns nothing.
    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");

    assert!(results.is_empty(), "conn-1 should have no results");
}

// ── RRF fusion: consensus across queries beats a single top-1 hit ────────

#[test]
fn test_rrf_consensus_beats_single_best() {
    let conn = setup_db();

    // "alpha" is the single best vector for query_a (rank 0 exactly).
    // "gamma" is middling for both query_a and query_b but consistently
    // ranked in both — RRF should prefer gamma over alpha once the fusion
    // penalty for not appearing in query_b kicks in (plan C1: "agreed by
    // many queries" beats "top-1 in one query").
    insert_table_chunk(&conn, "conn-1", "db", "alpha", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "db", "beta", unit_vec(1));
    insert_table_chunk(&conn, "conn-1", "db", "gamma", blend_vec(0, 1, 0.6));

    // top_k_per_query=2 → each query yields its top-2 only, so alpha appears
    // only in query_a's list and beta only in query_b's, while gamma appears
    // in BOTH lists. RRF rewards cross-query consensus (plan C1).
    let queries = vec![unit_vec(0), unit_vec(1)];
    let results = multi_query_search(&conn, "conn-1", &queries, 2, 10, 0)
        .expect("search should succeed");

    let gamma_pos = results
        .iter()
        .position(|r| r.table_name == "gamma")
        .expect("gamma should appear");
    let alpha_pos = results
        .iter()
        .position(|r| r.table_name == "alpha")
        .expect("alpha should appear");

    assert!(
        gamma_pos < alpha_pos,
        "gamma (appears in both queries, RRF consensus) should outrank alpha (single top-1 hit). gamma={}, alpha={}",
        gamma_pos,
        alpha_pos
    );
}

// ── BM25 (FTS5) surfaces a chunk when the vector lane misses entirely ───

#[test]
fn test_bm25_rescues_chunks_with_token_match_but_poor_vector_match() {
    let conn = setup_db();

    // "invoice_lines" DDL contains the word "invoice"; its embedding is far
    // from the query direction. Without BM25 the vector lane wouldn't rank
    // it meaningfully. With BM25 (plan C3) the token match should surface it.
    let mut chunk = ChunkInsert {
        connection_id: "conn-1".to_string(),
        chunk_key: "table:billing.invoice_lines".to_string(),
        db_name: "billing".to_string(),
        table_name: "invoice_lines".to_string(),
        chunk_type: ChunkType::Table,
        ddl_text: "CREATE TABLE `billing`.`invoice_lines` (invoice_id INT, amount DECIMAL(10,2))"
            .to_string(),
        ddl_hash: "hash_invoice".to_string(),
        model_id: "test-model".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding: unit_vec(3),
    };
    sqllumen_lib::schema_index::storage::insert_chunk(&conn, &chunk).expect("insert invoice");

    // A decoy with a vector right on the query direction but no matching token.
    chunk = ChunkInsert {
        connection_id: "conn-1".to_string(),
        chunk_key: "table:billing.decoy".to_string(),
        db_name: "billing".to_string(),
        table_name: "decoy".to_string(),
        chunk_type: ChunkType::Table,
        ddl_text: "CREATE TABLE `billing`.`decoy` (id INT)".to_string(),
        ddl_hash: "hash_decoy".to_string(),
        model_id: "test-model".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding: unit_vec(0),
    };
    sqllumen_lib::schema_index::storage::insert_chunk(&conn, &chunk).expect("insert decoy");

    let query_vectors = vec![unit_vec(0)];
    let query_texts = vec!["find invoice rows by amount".to_string()];

    let results = multi_query_search_with_query_texts(
        &conn,
        "conn-1",
        &query_texts,
        &query_vectors,
        5,
        10,
        0,
    )
    .expect("search should succeed");

    assert!(
        results
            .iter()
            .any(|r| r.table_name == "invoice_lines" && r.chunk_type == "table"),
        "BM25 should surface invoice_lines via token match, got: {:?}",
        results.iter().map(|r| &r.table_name).collect::<Vec<_>>()
    );
}

// ── Lexical match cannot single-handedly override vector agreement ──────

#[test]
fn test_lexical_boost_does_not_dominate_cosine() {
    let conn = setup_db();

    // "matching_table" has a far-away vector but its name matches the query
    // text lexically. "other_table" has a good vector match but no lexical
    // hint. After plan C2, lexical boost should *participate* in ranking,
    // not override a clear vector winner when the vector hit is strong.
    insert_table_chunk(&conn, "conn-1", "db", "matching_table", unit_vec(3));
    insert_table_chunk(&conn, "conn-1", "db", "other_table", unit_vec(0));

    let query_vectors = vec![unit_vec(0)];
    let query_texts = vec!["matching_table content".to_string()];

    let results = multi_query_search_with_query_texts(
        &conn,
        "conn-1",
        &query_texts,
        &query_vectors,
        5,
        10,
        0,
    )
    .expect("search should succeed");

    // Both surface as table chunks; the lexical-only match no longer sits
    // alone at the top when a far-better cosine hit exists — but it must
    // still be *included* so the user's explicit mention is respected.
    let table_names: Vec<&str> = results
        .iter()
        .filter(|r| r.chunk_type == "table")
        .map(|r| r.table_name.as_str())
        .collect();
    assert!(
        table_names.contains(&"matching_table"),
        "lexical match should still be included, got: {:?}",
        table_names
    );
    assert!(
        table_names.contains(&"other_table"),
        "strong cosine match should still be included, got: {:?}",
        table_names
    );
}

// ── top_k_per_query limits KNN hits per query ───────────────────────────

#[test]
fn test_top_k_per_query_limit() {
    let conn = setup_db();

    // Insert many chunks
    insert_table_chunk(&conn, "conn-1", "testdb", "t0", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "testdb", "t1", blend_vec(0, 1, 0.9));
    insert_table_chunk(&conn, "conn-1", "testdb", "t2", blend_vec(0, 1, 0.8));
    insert_table_chunk(&conn, "conn-1", "testdb", "t3", blend_vec(0, 1, 0.7));

    // With top_k_per_query=2, only 2 KNN hits per query vector
    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 2, 10, 20).expect("search should succeed");

    // Should have at most 2 results (top_k_per_query=2)
    assert!(
        results.len() <= 2,
        "top_k_per_query=2 should limit results to at most 2, got {}",
        results.len()
    );
}
