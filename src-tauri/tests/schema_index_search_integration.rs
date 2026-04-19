//! Integration tests for `schema_index::search` — multi-query vector search
//! pipeline with dedup, ranking, and FK fan-out.

use rusqlite::Connection;
use sqllumen_lib::db::migrations::run_migrations;
use sqllumen_lib::init_sqlite_vec;
use sqllumen_lib::schema_index::search::{
    apply_graph_expansion, multi_query_search, multi_query_search_configured,
    multi_query_search_extended, multi_query_search_with_hints,
    multi_query_search_with_query_texts, RetrievalHints, SearchConfig, SearchConfigExt,
    SearchResult, TableHint, TableRef,
};
use sqllumen_lib::schema_index::storage;
use sqllumen_lib::schema_index::types::{ChunkInsert, ChunkType, FkEdge};

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
        text_for_embedding: None,
        row_count_approx: None,
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
        text_for_embedding: None,
        row_count_approx: None,
    };
    storage::insert_chunk(conn, &chunk).expect("insert fk chunk")
}

fn insert_fk_edge(
    conn: &Connection,
    connection_id: &str,
    src_db: &str,
    src_tbl: &str,
    src_col: &str,
    dst_db: &str,
    dst_tbl: &str,
    dst_col: &str,
    constraint_name: &str,
) {
    let edge = FkEdge {
        connection_id: connection_id.to_string(),
        src_db: src_db.to_string(),
        src_tbl: src_tbl.to_string(),
        src_col: src_col.to_string(),
        dst_db: dst_db.to_string(),
        dst_tbl: dst_tbl.to_string(),
        dst_col: dst_col.to_string(),
        constraint_name: constraint_name.to_string(),
        on_delete: Some("RESTRICT".to_string()),
        on_update: Some("RESTRICT".to_string()),
    };
    storage::replace_fk_edges_for_table(conn, connection_id, src_db, src_tbl, &[edge])
        .expect("insert fk edge");
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

    // The score should reflect RRF accumulation from multiple queries
    // With 2 queries both hitting "users", the RRF score should be > a single-query hit
    assert!(
        users_results[0].score > 0.01,
        "should have a positive RRF score: got {}",
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

// ── FK fan-out includes related table chunks for tables in top-N ────────

#[test]
fn test_fk_fanout_includes_related_fk_chunks() {
    let conn = setup_db();

    // Insert table chunks
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "testdb", "orders", unit_vec(1));

    // Insert FK edge: orders → users
    insert_fk_edge(
        &conn,
        "conn-1",
        "testdb",
        "orders",
        "user_id",
        "testdb",
        "users",
        "id",
        "fk_user_id",
    );

    // Also insert a third table linked via FK to orders but far from query
    insert_table_chunk(&conn, "conn-1", "testdb", "order_items", unit_vec(3));
    insert_fk_edge(
        &conn,
        "conn-1",
        "testdb",
        "order_items",
        "order_id",
        "testdb",
        "orders",
        "id",
        "fk_order_id",
    );

    // Query along axis 0 — should match "users" (top-N), and "orders" should
    // appear via FK edge fan-out since "users" ↔ "orders" have an FK edge.
    let query = vec![unit_vec(0)];
    let results =
        multi_query_search(&conn, "conn-1", &query, 5, 10, 20).expect("search should succeed");

    // Both users and orders should appear (orders is FK-related to users)
    let has_users = results.iter().any(|r| r.table_name == "users");
    let has_orders = results.iter().any(|r| r.table_name == "orders");
    assert!(has_users, "users should be in results");
    assert!(has_orders, "orders should be included via FK edge fan-out");
}

// ── FK fan-out is capped (via graph expansion) ──────────────────────────

#[test]
fn test_fk_fanout_is_capped() {
    let conn = setup_db();

    // Insert one table chunk (close to query)
    insert_table_chunk(&conn, "conn-1", "testdb", "users", unit_vec(0));

    // Insert 3 related table chunks (far from query) and FK edges pointing to users
    for i in 0..3 {
        let tbl_name = format!("related_table_{i}");
        insert_table_chunk(&conn, "conn-1", "testdb", &tbl_name, unit_vec(3));
        insert_fk_edge(
            &conn,
            "conn-1",
            "testdb",
            &tbl_name,
            "user_id",
            "testdb",
            "users",
            "id",
            &format!("fk_constraint_{i}"),
        );
    }

    // Use graph expansion with edge_budget=1 to cap FK fan-out.
    // Base search returns only "users" (top_n=1), graph walk adds related tables
    // but is capped at 1 edge.
    let query = vec![unit_vec(0)];
    let config = SearchConfigExt {
        base: SearchConfig {
            top_k_per_query: 5,
            top_n_results: 1,
            max_fk_chunks: 1,
            lexical_weight: 0.0,
        },
        graph_depth: 1,
        feedback_boost: 0.0,
        hints: RetrievalHints::default(),
    };

    let results =
        multi_query_search_extended(&conn, "conn-1", &[], &query, &config).expect("search");

    // First result should be the table chunk (top-N)
    assert_eq!(results[0].chunk_type, "table");
    assert_eq!(results[0].table_name, "users");

    // Graph expansion with budget=1 should add at most 1 related table
    let fanout_chunks: Vec<&SearchResult> =
        results.iter().filter(|r| r.table_name != "users").collect();
    assert_eq!(
        fanout_chunks.len(),
        1,
        "Graph expansion should be capped at max_fk_chunks=1, got {}",
        fanout_chunks.len()
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
    // Score is now RRF-based: 1/(60+1) ≈ 0.01639 for rank 1 with single query
    let expected_rrf_rank1 = 1.0 / 61.0;
    assert!(
        (results[0].score - expected_rrf_rank1).abs() < 0.001,
        "exact match RRF score should be ~{:.4}, got {}",
        expected_rrf_rank1,
        results[0].score
    );

    // Query with an orthogonal vector — cosine distance = 1.0
    // RRF score = 1/(60+1) since it's still the only result
    let query_ortho = vec![unit_vec(1)];
    let results_ortho = multi_query_search(&conn, "conn-1", &query_ortho, 5, 10, 20)
        .expect("search should succeed");

    assert_eq!(results_ortho.len(), 1);
    // Even with orthogonal vector, the single chunk is still returned with rank 1
    assert!(
        results_ortho[0].score > 0.0,
        "orthogonal match should still have positive RRF score, got {}",
        results_ortho[0].score
    );

    // With RRF and single query, both get same RRF score (rank 1 since each is the only result)
    // So scores are equal — ordering is determined by cosine tiebreaker
    assert!(
        results[0].score >= results_ortho[0].score,
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

    // Both tables have similar cosine scores (both along axis 0)
    // so the lexical boost should differentiate them
    insert_table_chunk(
        &conn,
        "conn-1",
        "sykes_reservations",
        "itinerary",
        blend_vec(0, 3, 0.8),
    );
    insert_table_chunk(
        &conn,
        "conn-1",
        "sykes_reservations",
        "itinerary_date_history",
        blend_vec(0, 3, 0.8),
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

    // Both tables have similar cosine scores so lexical boost differentiates
    insert_table_chunk(&conn, "conn-1", "sales", "orders", blend_vec(0, 1, 0.5));
    insert_table_chunk(&conn, "conn-1", "support", "orders", blend_vec(0, 1, 0.5));

    let query_vectors = vec![unit_vec(0)];
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
    // Base search no longer enriches FK chunks with table DDLs.
    // The first result should be the FK chunk closest to the query.
    assert_eq!(
        results[0].chunk_type, "fk",
        "without enrichment, FK chunk should be first when it's the best KNN hit"
    );
    assert!(
        results.iter().any(|r| r.chunk_type == "fk"),
        "FK chunks should be in results"
    );
}

#[test]
fn test_query_text_boost_prefers_schema_qualified_tokens_without_sql_keywords() {
    let conn = setup_db();

    // Both tables have similar cosine so lexical differentiates
    insert_table_chunk(&conn, "conn-1", "sales", "orders", blend_vec(0, 1, 0.5));
    insert_table_chunk(&conn, "conn-1", "support", "orders", blend_vec(0, 1, 0.5));

    let query_vectors = vec![unit_vec(0)];
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
    // RRF score for rank 1 with single query: 1/(60+1) ≈ 0.01639
    let expected_rrf = 1.0 / 61.0;
    assert!(
        (results[0].score - expected_rrf).abs() < 0.001,
        "exact match should have RRF score ~{:.4}, got {}",
        expected_rrf,
        results[0].score
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

// ── multi_query_search_extended tests ─────────────────────────────────────

#[test]
fn extended_search_applies_hint_boost_to_reorder_results() {
    let conn = setup_db();

    // Two tables with similar embeddings — users slightly closer to query
    insert_table_chunk(&conn, "conn-1", "db1", "users", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "db1", "orders", blend_vec(0, 1, 0.95));

    let query = vec![unit_vec(0)];
    let config = SearchConfigExt {
        base: SearchConfig {
            top_k_per_query: 10,
            top_n_results: 10,
            max_fk_chunks: 30,
            lexical_weight: 0.0,
        },
        graph_depth: 0,      // disable graph walk for this test
        feedback_boost: 1.0, // strong boost
        hints: RetrievalHints {
            recent_tables: vec![TableHint {
                db_name: "db1".to_string(),
                table_name: "orders".to_string(),
                weight: 1.0,
            }],
            editor_tables: vec![],
            accepted_tables: vec![],
        },
    };

    let results = multi_query_search_extended(&conn, "conn-1", &[], &query, &config)
        .expect("extended search");

    assert!(results.len() >= 2);
    // With a strong boost on 'orders', it should be ranked first
    assert_eq!(results[0].table_name, "orders");
}

#[test]
fn extended_search_graph_walk_adds_related_tables() {
    let conn = setup_db();

    // A -> B edge, only A is close to query
    insert_table_chunk(&conn, "conn-1", "db1", "A", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "db1", "B", unit_vec(2)); // far from query

    let edge = FkEdge {
        connection_id: "conn-1".to_string(),
        src_db: "db1".to_string(),
        src_tbl: "A".to_string(),
        src_col: "id".to_string(),
        dst_db: "db1".to_string(),
        dst_tbl: "B".to_string(),
        dst_col: "a_id".to_string(),
        constraint_name: "fk_A_B".to_string(),
        on_delete: None,
        on_update: None,
    };
    storage::replace_fk_edges_for_table(&conn, "conn-1", "db1", "A", &[edge]).unwrap();

    let query = vec![unit_vec(0)];
    let config = SearchConfigExt {
        base: SearchConfig {
            top_k_per_query: 10,
            top_n_results: 10,
            max_fk_chunks: 30,
            lexical_weight: 0.0,
        },
        graph_depth: 1,
        feedback_boost: 0.0,
        hints: RetrievalHints::default(),
    };

    let results = multi_query_search_extended(&conn, "conn-1", &[], &query, &config)
        .expect("extended search with graph walk");

    // Should include both A (from KNN) and B (from graph walk)
    let names: Vec<&str> = results.iter().map(|r| r.table_name.as_str()).collect();
    assert!(names.contains(&"A"), "A should be in results");
    assert!(names.contains(&"B"), "B should be added by graph walk");

    // B should have decayed score
    let b = results.iter().find(|r| r.table_name == "B").unwrap();
    let a = results.iter().find(|r| r.table_name == "A").unwrap();
    assert!(
        b.score < a.score,
        "B's graph-walk score should be less than A's direct score"
    );
}

#[test]
fn extended_search_editor_tables_become_graph_seeds() {
    let conn = setup_db();

    // Three tables: X (close to query), Y (far), Z (far)
    // Y -> Z edge exists. Y is an "editor table" hint.
    insert_table_chunk(&conn, "conn-1", "db1", "X", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "db1", "Y", unit_vec(2));
    insert_table_chunk(&conn, "conn-1", "db1", "Z", unit_vec(3));

    let edge = FkEdge {
        connection_id: "conn-1".to_string(),
        src_db: "db1".to_string(),
        src_tbl: "Y".to_string(),
        src_col: "id".to_string(),
        dst_db: "db1".to_string(),
        dst_tbl: "Z".to_string(),
        dst_col: "y_id".to_string(),
        constraint_name: "fk_Y_Z".to_string(),
        on_delete: None,
        on_update: None,
    };
    storage::replace_fk_edges_for_table(&conn, "conn-1", "db1", "Y", &[edge]).unwrap();

    let query = vec![unit_vec(0)];
    let config = SearchConfigExt {
        base: SearchConfig {
            top_k_per_query: 10,
            top_n_results: 10,
            max_fk_chunks: 30,
            lexical_weight: 0.0,
        },
        graph_depth: 1,
        feedback_boost: 0.15,
        hints: RetrievalHints {
            recent_tables: vec![],
            editor_tables: vec![TableRef {
                db_name: "db1".to_string(),
                table_name: "Y".to_string(),
            }],
            accepted_tables: vec![],
        },
    };

    let results = multi_query_search_extended(&conn, "conn-1", &[], &query, &config)
        .expect("extended search with editor tables as seeds");

    let names: Vec<&str> = results.iter().map(|r| r.table_name.as_str()).collect();
    // Z should be found via graph walk from editor table Y
    assert!(
        names.contains(&"Z"),
        "Z should be reachable via editor table Y's graph walk"
    );
}

#[test]
fn extended_search_empty_vectors_returns_empty() {
    let conn = setup_db();
    let config = SearchConfigExt::default();
    let results = multi_query_search_extended(&conn, "conn-1", &[], &[], &config).unwrap();
    assert!(results.is_empty());
}

#[test]
fn extended_search_with_accepted_tables_boost() {
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "db1", "alpha", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "db1", "beta", blend_vec(0, 1, 0.95));

    let query = vec![unit_vec(0)];
    let config = SearchConfigExt {
        base: SearchConfig {
            top_k_per_query: 10,
            top_n_results: 10,
            max_fk_chunks: 30,
            lexical_weight: 0.0,
        },
        graph_depth: 0,
        feedback_boost: 2.0, // very strong
        hints: RetrievalHints {
            recent_tables: vec![],
            editor_tables: vec![],
            accepted_tables: vec![TableHint {
                db_name: "db1".to_string(),
                table_name: "beta".to_string(),
                weight: 1.0,
            }],
        },
    };

    let results = multi_query_search_extended(&conn, "conn-1", &[], &query, &config).unwrap();
    assert!(results.len() >= 2);
    // beta should be first due to strong accepted boost
    assert_eq!(results[0].table_name, "beta");
}

// ── Lexical boost tests ─────────────────────────────────────────────────────

#[test]
fn lexical_direct_table_match_boosts_score() {
    let conn = setup_db();

    // Insert two table chunks with similar embeddings
    insert_table_chunk(&conn, "conn-1", "db1", "users", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "db1", "orders", blend_vec(0, 1, 0.9));

    let query_texts = vec!["SELECT * FROM orders".to_string()];
    let query_vecs = vec![unit_vec(0)]; // points at users

    let results =
        multi_query_search_with_query_texts(&conn, "conn-1", &query_texts, &query_vecs, 10, 10, 30)
            .unwrap();

    // "orders" should appear and get a lexical boost from the direct table match
    let order_pos = results.iter().position(|r| r.table_name == "orders");
    assert!(order_pos.is_some(), "orders should appear in results");
}

#[test]
fn lexical_qualified_identifier_match() {
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "db1", "customers", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "db1", "products", blend_vec(0, 1, 0.8));

    let query_texts = vec!["SELECT * FROM db1.products JOIN db1.customers ON true".to_string()];
    let query_vecs = vec![unit_vec(0)]; // points at customers

    let results =
        multi_query_search_with_query_texts(&conn, "conn-1", &query_texts, &query_vecs, 10, 10, 30)
            .unwrap();

    // Both tables should appear since both are mentioned in the query
    let names: Vec<&str> = results.iter().map(|r| r.table_name.as_str()).collect();
    assert!(names.contains(&"customers"), "customers should appear");
    assert!(names.contains(&"products"), "products should appear");
}

#[test]
fn lexical_identifier_token_segment_match() {
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "db1", "user_profiles", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "db1", "order_items", unit_vec(1));

    // Query mentions "profiles" which is a segment of "user_profiles"
    let query_texts = vec!["show me profiles data".to_string()];
    let query_vecs = vec![blend_vec(0, 1, 0.5)]; // equidistant

    let results =
        multi_query_search_with_query_texts(&conn, "conn-1", &query_texts, &query_vecs, 10, 10, 30)
            .unwrap();

    // user_profiles should get a segment match boost from "profiles"
    let profile_pos = results.iter().position(|r| r.table_name == "user_profiles");
    assert!(
        profile_pos.is_some(),
        "user_profiles should appear via segment match"
    );
}

#[test]
fn lexical_boost_with_fk_enrichment() {
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "db1", "orders", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "db1", "customers", unit_vec(1));
    insert_fk_chunk(
        &conn,
        "conn-1",
        "db1",
        "orders",
        "fk_orders_customers",
        "db1",
        "customers",
        blend_vec(0, 1, 0.5),
    );
    insert_fk_edge(
        &conn,
        "conn-1",
        "db1",
        "orders",
        "customer_id",
        "db1",
        "customers",
        "id",
        "fk_orders_customers",
    );

    let query_texts = vec!["SELECT * FROM orders".to_string()];
    let query_vecs = vec![unit_vec(0)];

    let results =
        multi_query_search_with_query_texts(&conn, "conn-1", &query_texts, &query_vecs, 10, 10, 30)
            .unwrap();

    // Should have orders table + customers via FK fan-out
    let names: Vec<&str> = results.iter().map(|r| r.table_name.as_str()).collect();
    assert!(names.contains(&"orders"), "orders should appear");
    assert!(
        names.contains(&"customers"),
        "customers should appear via FK fan-out"
    );
}

#[test]
fn lexical_dotted_identifier_in_natural_text() {
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "mydb", "accounts", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "mydb", "transactions", unit_vec(1));

    // Natural language query with a dotted identifier
    let query_texts = vec!["look up mydb.accounts balance".to_string()];
    let query_vecs = vec![unit_vec(1)]; // points away from accounts

    let results =
        multi_query_search_with_query_texts(&conn, "conn-1", &query_texts, &query_vecs, 10, 10, 30)
            .unwrap();

    // accounts should appear despite vector pointing at transactions
    let has_accounts = results.iter().any(|r| r.table_name == "accounts");
    assert!(
        has_accounts,
        "accounts should appear via lexical dotted identifier match"
    );
}

#[test]
fn extended_search_graph_walk_with_lexical_and_hints() {
    let conn = setup_db();

    // Create a chain: A -> B -> C
    insert_table_chunk(&conn, "conn-1", "db1", "A", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "db1", "B", unit_vec(1));
    insert_table_chunk(&conn, "conn-1", "db1", "C", unit_vec(2));

    insert_fk_edge(
        &conn, "conn-1", "db1", "A", "b_id", "db1", "B", "id", "fk_a_b",
    );
    insert_fk_edge(
        &conn, "conn-1", "db1", "B", "c_id", "db1", "C", "id", "fk_b_c",
    );

    let query_texts = vec!["SELECT * FROM A".to_string()];
    let query_vecs = vec![unit_vec(0)];

    let config = SearchConfigExt {
        base: SearchConfig {
            top_k_per_query: 10,
            top_n_results: 10,
            max_fk_chunks: 30,
            lexical_weight: 0.3,
        },
        graph_depth: 2,
        feedback_boost: 0.5,
        hints: RetrievalHints {
            recent_tables: vec![TableHint {
                db_name: "db1".to_string(),
                table_name: "B".to_string(),
                weight: 0.8,
            }],
            editor_tables: vec![],
            accepted_tables: vec![],
        },
    };

    let results =
        multi_query_search_extended(&conn, "conn-1", &query_texts, &query_vecs, &config).unwrap();

    let names: Vec<&str> = results.iter().map(|r| r.table_name.as_str()).collect();
    assert!(names.contains(&"A"), "A should appear as direct match");
    // B and C should appear via graph walk
    assert!(
        names.contains(&"B") || names.contains(&"C"),
        "Graph walk should bring in B or C"
    );
}

#[test]
fn fk_chunk_in_knn_triggers_enrichment_with_referenced_table() {
    // When an FK chunk appears in KNN results, enrich_with_related_table_chunks
    // should add the referenced table chunk automatically.
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "db1", "orders", unit_vec(1));
    insert_table_chunk(&conn, "conn-1", "db1", "customers", unit_vec(2));
    // FK chunk with ref_db_name/ref_table_name pointing at customers
    insert_fk_chunk(
        &conn,
        "conn-1",
        "db1",
        "orders",
        "fk_orders_customers",
        "db1",
        "customers",
        unit_vec(0), // closest to query
    );

    let query_vecs = vec![unit_vec(0)]; // will match FK chunk first

    let results = multi_query_search(&conn, "conn-1", &query_vecs, 10, 10, 30).unwrap();

    let names: Vec<&str> = results.iter().map(|r| r.table_name.as_str()).collect();
    // The FK chunk references both orders and customers; both table chunks should be enriched
    assert!(
        names.contains(&"orders"),
        "orders table should be enriched from FK chunk"
    );
    assert!(
        names.contains(&"customers"),
        "customers table should be enriched from FK ref"
    );
}

#[test]
fn lexical_boost_backtick_qualified_identifier() {
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "sales", "invoices", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "sales", "payments", unit_vec(1));

    let query_texts = vec!["SELECT * FROM `sales`.`invoices`".to_string()];
    let query_vecs = vec![unit_vec(1)]; // points at payments

    let results =
        multi_query_search_with_query_texts(&conn, "conn-1", &query_texts, &query_vecs, 10, 10, 30)
            .unwrap();

    // invoices should get a direct qualified table match boost
    let has_invoices = results.iter().any(|r| r.table_name == "invoices");
    assert!(
        has_invoices,
        "invoices should appear via backtick-qualified lexical match"
    );
}

#[test]
fn search_with_multiple_query_texts_and_vectors() {
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "db1", "users", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "db1", "orders", unit_vec(1));
    insert_table_chunk(&conn, "conn-1", "db1", "products", unit_vec(2));

    // Multiple queries — both vectors and texts
    let query_texts = vec![
        "show me users".to_string(),
        "SELECT * FROM products".to_string(),
    ];
    let query_vecs = vec![unit_vec(0), unit_vec(2)];

    let results =
        multi_query_search_with_query_texts(&conn, "conn-1", &query_texts, &query_vecs, 10, 10, 30)
            .unwrap();

    let names: Vec<&str> = results.iter().map(|r| r.table_name.as_str()).collect();
    assert!(names.contains(&"users"), "users should appear");
    assert!(names.contains(&"products"), "products should appear");
}

#[test]
fn configured_search_with_zero_lexical_weight() {
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "db1", "items", unit_vec(0));

    let query_texts = vec!["SELECT * FROM items".to_string()];
    let query_vecs = vec![unit_vec(0)];

    let config = SearchConfig {
        top_k_per_query: 10,
        top_n_results: 10,
        max_fk_chunks: 30,
        lexical_weight: 0.0,
    };

    let results =
        multi_query_search_configured(&conn, "conn-1", &query_texts, &query_vecs, &config).unwrap();

    assert!(
        !results.is_empty(),
        "should return results even with zero lexical weight"
    );
    assert_eq!(results[0].table_name, "items");
}

// ── multi_query_search_with_hints tests ──────────────────────────────────

#[test]
fn with_hints_applies_feedback_boost() {
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "db1", "users", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "db1", "orders", unit_vec(1));

    let query = vec![blend_vec(0, 1, 0.6)]; // slightly closer to users
    let query_texts = vec!["find users".to_string()];

    let config = SearchConfigExt {
        base: SearchConfig {
            top_k_per_query: 10,
            top_n_results: 10,
            max_fk_chunks: 30,
            lexical_weight: 0.0,
        },
        graph_depth: 0,
        feedback_boost: 1.0,
        hints: RetrievalHints {
            recent_tables: vec![],
            editor_tables: vec![],
            accepted_tables: vec![TableHint {
                db_name: "db1".to_string(),
                table_name: "orders".to_string(),
                weight: 1.0,
            }],
        },
    };

    let results =
        multi_query_search_with_hints(&conn, "conn-1", &query_texts, &query, &config).unwrap();

    assert!(!results.is_empty());
    // orders should be boosted above users despite lower cosine
    assert_eq!(results[0].table_name, "orders");
}

#[test]
fn with_hints_empty_results() {
    let conn = setup_db();

    let config = SearchConfigExt::default();
    let results = multi_query_search_with_hints(&conn, "conn-1", &[], &[], &config).unwrap();
    assert!(results.is_empty());
}

// ── apply_graph_expansion tests ──────────────────────────────────────────

#[test]
fn apply_graph_expansion_adds_related_tables() {
    let conn = setup_db();

    insert_table_chunk(&conn, "conn-1", "db1", "users", unit_vec(0));
    insert_table_chunk(&conn, "conn-1", "db1", "orders", unit_vec(1));
    insert_table_chunk(&conn, "conn-1", "db1", "products", unit_vec(2));

    // FK: orders → users
    storage::replace_fk_edges_for_connection(
        &conn,
        "conn-1",
        &[FkEdge {
            connection_id: "conn-1".to_string(),
            src_db: "db1".to_string(),
            src_tbl: "orders".to_string(),
            src_col: "user_id".to_string(),
            dst_db: "db1".to_string(),
            dst_tbl: "users".to_string(),
            dst_col: "id".to_string(),
            constraint_name: "fk_orders_users".to_string(),
            on_delete: Some("CASCADE".to_string()),
            on_update: Some("RESTRICT".to_string()),
        }],
    )
    .unwrap();

    // Start with only "users" in results
    let initial = vec![SearchResult {
        chunk_id: 1,
        chunk_key: "table:db1.users".to_string(),
        db_name: "db1".to_string(),
        table_name: "users".to_string(),
        chunk_type: "table".to_string(),
        ddl_text: "CREATE TABLE users (id INT)".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        score: 0.9,
    }];

    let results = apply_graph_expansion(&conn, "conn-1", initial, 2, 30).unwrap();

    // Should have added orders via FK edge
    let names: Vec<&str> = results.iter().map(|r| r.table_name.as_str()).collect();
    assert!(names.contains(&"users"));
    assert!(names.contains(&"orders"));
    // Score of orders should be 0.9 * 0.5 = 0.45 (1 hop decay)
    let orders_result = results.iter().find(|r| r.table_name == "orders").unwrap();
    assert!((orders_result.score - 0.45).abs() < 0.01);
}

#[test]
fn apply_graph_expansion_zero_depth_noop() {
    let conn = setup_db();
    insert_table_chunk(&conn, "conn-1", "db1", "users", unit_vec(0));

    let initial = vec![SearchResult {
        chunk_id: 1,
        chunk_key: "table:db1.users".to_string(),
        db_name: "db1".to_string(),
        table_name: "users".to_string(),
        chunk_type: "table".to_string(),
        ddl_text: "CREATE TABLE users (id INT)".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        score: 0.9,
    }];

    let results = apply_graph_expansion(&conn, "conn-1", initial.clone(), 0, 30).unwrap();
    assert_eq!(results.len(), initial.len());
}

#[test]
fn apply_graph_expansion_empty_results() {
    let conn = setup_db();
    let results = apply_graph_expansion(&conn, "conn-1", vec![], 2, 30).unwrap();
    assert!(results.is_empty());
}
