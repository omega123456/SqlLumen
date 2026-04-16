//! Integration tests for `schema_index::storage` — vec0 virtual table + chunk CRUD.

use rusqlite::Connection;
use sqllumen_lib::db::migrations::run_migrations;
use sqllumen_lib::init_sqlite_vec;
use sqllumen_lib::schema_index::storage;
use sqllumen_lib::schema_index::types::{ChunkInsert, ChunkType, IndexMeta, IndexStatus};

/// Helper: register sqlite-vec, open an in-memory DB, run all migrations, and
/// create the vec0 virtual table with a test dimension for the given profile.
fn setup_db_for_profile(profile_id: &str, dimension: usize) -> Connection {
    init_sqlite_vec();
    let conn = Connection::open_in_memory().expect("open in-memory db");
    run_migrations(&conn).expect("run migrations");
    storage::create_vec_table(&conn, profile_id, dimension).expect("create vec table");
    conn
}

/// Helper: register sqlite-vec, open an in-memory DB, run all migrations, and
/// create the vec0 virtual table with a test dimension for "conn-1".
fn setup_db(dimension: usize) -> Connection {
    setup_db_for_profile("conn-1", dimension)
}

/// A simple f32 embedding for testing.
fn test_embedding(dimension: usize, seed: f32) -> Vec<f32> {
    (0..dimension).map(|i| seed + i as f32 * 0.1).collect()
}

fn sample_chunk(connection_id: &str, chunk_key: &str, dimension: usize) -> ChunkInsert {
    ChunkInsert {
        connection_id: connection_id.to_string(),
        chunk_key: chunk_key.to_string(),
        db_name: "testdb".to_string(),
        table_name: "users".to_string(),
        chunk_type: ChunkType::Table,
        ddl_text: "CREATE TABLE users (id INT PRIMARY KEY)".to_string(),
        ddl_hash: "abc123".to_string(),
        model_id: "text-embedding-ada-002".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding: test_embedding(dimension, 1.0),
    }
}

// ── vec_version ──────────────────────────────────────────────────────────

#[test]
fn test_vec_version_returns_non_empty_string() {
    init_sqlite_vec();
    let conn = Connection::open_in_memory().expect("open in-memory db");
    let version: String = conn
        .query_row("SELECT vec_version()", [], |row| row.get(0))
        .expect("vec_version should succeed");
    assert!(
        !version.is_empty(),
        "vec_version should return a non-empty string"
    );
    assert!(
        version.starts_with('v'),
        "vec_version should start with 'v', got: {version}"
    );
}

// ── create_vec_table ─────────────────────────────────────────────────────

#[test]
fn test_create_vec_table() {
    init_sqlite_vec();
    let conn = Connection::open_in_memory().expect("open in-memory db");
    run_migrations(&conn).expect("run migrations");

    storage::create_vec_table(&conn, "test_profile", 384).expect("create vec table");

    // Verify the virtual table exists by querying sqlite_master
    let table_name = storage::vec_table_name("test_profile");
    let count: i64 = conn
        .query_row(
            &format!(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{table_name}'"
            ),
            [],
            |row| row.get(0),
        )
        .expect("query sqlite_master");
    assert_eq!(count, 1, "per-profile vec table should exist");
}

// ── insert and retrieve chunk ────────────────────────────────────────────

#[test]
fn test_insert_chunk_and_retrieve() {
    let dim = 4;
    let conn = setup_db(dim);

    let chunk = sample_chunk("conn-1", "testdb.users.table", dim);
    let id = storage::insert_chunk(&conn, &chunk).expect("insert chunk");
    assert!(id > 0, "chunk ID should be positive");

    let retrieved = storage::get_chunk_by_key(&conn, "conn-1", "testdb.users.table")
        .expect("get chunk")
        .expect("chunk should exist");

    assert_eq!(retrieved.id, id);
    assert_eq!(retrieved.connection_id, "conn-1");
    assert_eq!(retrieved.chunk_key, "testdb.users.table");
    assert_eq!(retrieved.db_name, "testdb");
    assert_eq!(retrieved.table_name, "users");
    assert_eq!(retrieved.chunk_type, ChunkType::Table);
    assert_eq!(
        retrieved.ddl_text,
        "CREATE TABLE users (id INT PRIMARY KEY)"
    );
    assert_eq!(retrieved.ddl_hash, "abc123");
    assert_eq!(retrieved.model_id, "text-embedding-ada-002");
    assert!(!retrieved.embedded_at.is_empty());
    assert!(retrieved.ref_db_name.is_none());
    assert!(retrieved.ref_table_name.is_none());
}

// ── list_chunks ──────────────────────────────────────────────────────────

#[test]
fn test_list_chunks() {
    let dim = 4;
    let conn = setup_db(dim);
    // Also create vec table for conn-2
    storage::create_vec_table(&conn, "conn-2", dim).expect("create vec table for conn-2");

    let chunk1 = sample_chunk("conn-1", "testdb.users.table", dim);
    storage::insert_chunk(&conn, &chunk1).expect("insert chunk1");

    let mut chunk2 = sample_chunk("conn-1", "testdb.orders.table", dim);
    chunk2.table_name = "orders".to_string();
    storage::insert_chunk(&conn, &chunk2).expect("insert chunk2");

    // Different connection
    let chunk3 = sample_chunk("conn-2", "testdb.users.table", dim);
    storage::insert_chunk(&conn, &chunk3).expect("insert chunk3");

    let chunks = storage::list_chunks(&conn, "conn-1").expect("list chunks");
    assert_eq!(chunks.len(), 2, "should list 2 chunks for conn-1");

    let chunks_conn2 = storage::list_chunks(&conn, "conn-2").expect("list chunks conn-2");
    assert_eq!(chunks_conn2.len(), 1, "should list 1 chunk for conn-2");
}

// ── chunk_key uniqueness constraint ──────────────────────────────────────

#[test]
fn test_chunk_key_uniqueness_prevents_duplicates() {
    let dim = 4;
    let conn = setup_db(dim);

    let chunk = sample_chunk("conn-1", "testdb.users.table", dim);
    storage::insert_chunk(&conn, &chunk).expect("first insert");

    let result = storage::insert_chunk(&conn, &chunk);
    assert!(
        result.is_err(),
        "duplicate chunk_key for same connection should fail"
    );
}

// ── delete_chunks_by_table ───────────────────────────────────────────────

#[test]
fn test_delete_chunks_by_table_removes_source_and_reference() {
    let dim = 4;
    let conn = setup_db(dim);

    // Source chunk for users table
    let chunk_table = sample_chunk("conn-1", "testdb.users.table", dim);
    storage::insert_chunk(&conn, &chunk_table).expect("insert table chunk");

    // FK chunk that references users table
    let fk_chunk = ChunkInsert {
        connection_id: "conn-1".to_string(),
        chunk_key: "testdb.orders.fk_user_id".to_string(),
        db_name: "testdb".to_string(),
        table_name: "orders".to_string(),
        chunk_type: ChunkType::Fk,
        ddl_text: "ALTER TABLE orders ADD CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id)".to_string(),
        ddl_hash: "fk_hash".to_string(),
        model_id: "text-embedding-ada-002".to_string(),
        ref_db_name: Some("testdb".to_string()),
        ref_table_name: Some("users".to_string()),
        embedding: test_embedding(dim, 2.0),
    };
    storage::insert_chunk(&conn, &fk_chunk).expect("insert fk chunk");

    // Another chunk for a different table (should NOT be deleted)
    let other_chunk = ChunkInsert {
        connection_id: "conn-1".to_string(),
        chunk_key: "testdb.products.table".to_string(),
        db_name: "testdb".to_string(),
        table_name: "products".to_string(),
        chunk_type: ChunkType::Table,
        ddl_text: "CREATE TABLE products (id INT)".to_string(),
        ddl_hash: "prod_hash".to_string(),
        model_id: "text-embedding-ada-002".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding: test_embedding(dim, 3.0),
    };
    storage::insert_chunk(&conn, &other_chunk).expect("insert other chunk");

    // Delete chunks for the "users" table — should remove both the source and FK reference
    storage::delete_chunks_by_table(&conn, "conn-1", "testdb", "users").expect("delete by table");

    let remaining = storage::list_chunks(&conn, "conn-1").expect("list remaining");
    assert_eq!(remaining.len(), 1, "only the products chunk should remain");
    assert_eq!(remaining[0].table_name, "products");

    // Verify vector rows were also deleted (only 1 remaining)
    let vec_table = storage::vec_table_name("conn-1");
    let vec_count: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {vec_table}"), [], |row| {
            row.get(0)
        })
        .expect("count vectors");
    assert_eq!(vec_count, 1, "only the products vector should remain");
}

// ── get_chunk_hashes ─────────────────────────────────────────────────────

#[test]
fn test_get_chunk_hashes() {
    let dim = 4;
    let conn = setup_db(dim);

    let chunk1 = sample_chunk("conn-1", "testdb.users.table", dim);
    storage::insert_chunk(&conn, &chunk1).expect("insert chunk1");

    let mut chunk2 = sample_chunk("conn-1", "testdb.orders.table", dim);
    chunk2.table_name = "orders".to_string();
    chunk2.ddl_hash = "def456".to_string();
    storage::insert_chunk(&conn, &chunk2).expect("insert chunk2");

    let hashes = storage::get_chunk_hashes(&conn, "conn-1").expect("get chunk hashes");
    assert_eq!(hashes.len(), 2);

    let hash_map: std::collections::HashMap<String, String> = hashes.into_iter().collect();
    assert_eq!(hash_map.get("testdb.users.table").unwrap(), "abc123");
    assert_eq!(hash_map.get("testdb.orders.table").unwrap(), "def456");
}

// ── update_chunk_embedding ───────────────────────────────────────────────

#[test]
fn test_update_chunk_embedding() {
    let dim = 4;
    let conn = setup_db(dim);

    let chunk = sample_chunk("conn-1", "testdb.users.table", dim);
    let id = storage::insert_chunk(&conn, &chunk).expect("insert chunk");

    let new_embedding = test_embedding(dim, 99.0);
    storage::update_chunk_embedding(
        &conn,
        id,
        "CREATE TABLE users (id INT, name VARCHAR(255))",
        "new_hash",
        "gpt-4",
        &new_embedding,
        "conn-1",
    )
    .expect("update chunk embedding");

    let updated = storage::get_chunk_by_key(&conn, "conn-1", "testdb.users.table")
        .expect("get updated chunk")
        .expect("chunk should exist");

    assert_eq!(
        updated.ddl_text,
        "CREATE TABLE users (id INT, name VARCHAR(255))"
    );
    assert_eq!(updated.ddl_hash, "new_hash");
    assert_eq!(updated.model_id, "gpt-4");
}

// ── upsert_index_meta & get_index_meta ───────────────────────────────────

#[test]
fn test_upsert_and_get_index_meta() {
    let conn = setup_db(4);

    let meta = IndexMeta {
        connection_id: "conn-1".to_string(),
        model_id: "text-embedding-ada-002".to_string(),
        embedding_dimension: 1536,
        last_build_at: Some("2025-01-15T10:30:00Z".to_string()),
        status: IndexStatus::Ready,
        vec_schema_version: Some(1),
    };
    storage::upsert_index_meta(&conn, &meta).expect("upsert meta");

    let retrieved = storage::get_index_meta(&conn, "conn-1")
        .expect("get meta")
        .expect("meta should exist");

    assert_eq!(retrieved.connection_id, "conn-1");
    assert_eq!(retrieved.model_id, "text-embedding-ada-002");
    assert_eq!(retrieved.embedding_dimension, 1536);
    assert_eq!(
        retrieved.last_build_at.as_deref(),
        Some("2025-01-15T10:30:00Z")
    );
    assert_eq!(retrieved.status, IndexStatus::Ready);

    // Upsert again with different values
    let meta2 = IndexMeta {
        connection_id: "conn-1".to_string(),
        model_id: "gpt-4".to_string(),
        embedding_dimension: 768,
        last_build_at: None,
        status: IndexStatus::Stale,
        vec_schema_version: Some(1),
    };
    storage::upsert_index_meta(&conn, &meta2).expect("upsert meta again");

    let retrieved2 = storage::get_index_meta(&conn, "conn-1")
        .expect("get meta again")
        .expect("meta should exist");

    assert_eq!(retrieved2.model_id, "gpt-4");
    assert_eq!(retrieved2.embedding_dimension, 768);
    assert!(retrieved2.last_build_at.is_none());
    assert_eq!(retrieved2.status, IndexStatus::Stale);
}

// ── update_index_status ──────────────────────────────────────────────────

#[test]
fn test_update_index_status() {
    let conn = setup_db(4);

    let meta = IndexMeta {
        connection_id: "conn-1".to_string(),
        model_id: "model-a".to_string(),
        embedding_dimension: 384,
        last_build_at: None,
        status: IndexStatus::Stale,
        vec_schema_version: Some(1),
    };
    storage::upsert_index_meta(&conn, &meta).expect("upsert");

    storage::update_index_status(&conn, "conn-1", &IndexStatus::Building).expect("update status");

    let retrieved = storage::get_index_meta(&conn, "conn-1")
        .expect("get")
        .expect("should exist");
    assert_eq!(retrieved.status, IndexStatus::Building);
}

// ── get_index_meta returns None ──────────────────────────────────────────

#[test]
fn test_get_index_meta_returns_none_when_missing() {
    let conn = setup_db(4);
    let result = storage::get_index_meta(&conn, "nonexistent").expect("get meta");
    assert!(result.is_none());
}

// ── get_chunk_by_key returns None ────────────────────────────────────────

#[test]
fn test_get_chunk_by_key_returns_none_when_missing() {
    let conn = setup_db(4);
    let result = storage::get_chunk_by_key(&conn, "conn-1", "nonexistent").expect("get chunk");
    assert!(result.is_none());
}

// ── drop and recreate vec table (model change scenario) ──────────────────

#[test]
fn test_drop_and_recreate_vec_table() {
    let dim = 4;
    let conn = setup_db(dim);

    let chunk = sample_chunk("conn-1", "testdb.users.table", dim);
    storage::insert_chunk(&conn, &chunk).expect("insert chunk");

    // Drop the virtual table
    storage::drop_vec_table(&conn, "conn-1").expect("drop vec table");

    // Recreate with different dimension (simulating model change)
    let new_dim = 8;
    storage::create_vec_table(&conn, "conn-1", new_dim).expect("recreate vec table");

    // Verify the new table works with the new dimension
    let new_chunk = ChunkInsert {
        connection_id: "conn-1".to_string(),
        chunk_key: "testdb.orders.table".to_string(),
        db_name: "testdb".to_string(),
        table_name: "orders".to_string(),
        chunk_type: ChunkType::Table,
        ddl_text: "CREATE TABLE orders (id INT)".to_string(),
        ddl_hash: "hash".to_string(),
        model_id: "new-model".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding: test_embedding(new_dim, 1.0),
    };

    // Need to clear old chunks from the metadata table since their vectors are gone
    conn.execute("DELETE FROM schema_index_chunks", [])
        .expect("clear chunks");

    let id = storage::insert_chunk(&conn, &new_chunk).expect("insert with new dimension");
    assert!(id > 0);
}

// ── delete_all_chunks ────────────────────────────────────────────────────

#[test]
fn test_delete_all_chunks() {
    let dim = 4;
    let conn = setup_db(dim);
    // Also create vec table for conn-2
    storage::create_vec_table(&conn, "conn-2", dim).expect("create vec table for conn-2");

    // Insert multiple chunks for conn-1
    let chunk1 = sample_chunk("conn-1", "testdb.users.table", dim);
    storage::insert_chunk(&conn, &chunk1).expect("insert chunk1");

    let mut chunk2 = sample_chunk("conn-1", "testdb.orders.table", dim);
    chunk2.table_name = "orders".to_string();
    storage::insert_chunk(&conn, &chunk2).expect("insert chunk2");

    // Insert a chunk for conn-2
    let chunk3 = sample_chunk("conn-2", "testdb.products.table", dim);
    storage::insert_chunk(&conn, &chunk3).expect("insert chunk3");

    // Delete all chunks for conn-1
    storage::delete_all_chunks(&conn, "conn-1").expect("delete all");

    let conn1_chunks = storage::list_chunks(&conn, "conn-1").expect("list conn-1");
    assert!(conn1_chunks.is_empty(), "conn-1 should have no chunks");

    let conn2_chunks = storage::list_chunks(&conn, "conn-2").expect("list conn-2");
    assert_eq!(conn2_chunks.len(), 1, "conn-2 should still have 1 chunk");

    // Verify vectors for conn-1 were also deleted
    let vec_table_1 = storage::vec_table_name("conn-1");
    let vec_count_1: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {vec_table_1}"), [], |row| {
            row.get(0)
        })
        .expect("count vectors conn-1");
    assert_eq!(vec_count_1, 0, "conn-1 vectors should be empty");

    // Verify conn-2 vectors are intact
    let vec_table_2 = storage::vec_table_name("conn-2");
    let vec_count_2: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {vec_table_2}"), [], |row| {
            row.get(0)
        })
        .expect("count vectors conn-2");
    assert_eq!(vec_count_2, 1, "conn-2 vector should remain");
}

// ── FK chunk type ────────────────────────────────────────────────────────

#[test]
fn test_insert_fk_chunk() {
    let dim = 4;
    let conn = setup_db(dim);

    let fk_chunk = ChunkInsert {
        connection_id: "conn-1".to_string(),
        chunk_key: "testdb.orders.fk_user_id".to_string(),
        db_name: "testdb".to_string(),
        table_name: "orders".to_string(),
        chunk_type: ChunkType::Fk,
        ddl_text: "ALTER TABLE orders ADD CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id)".to_string(),
        ddl_hash: "fk_hash".to_string(),
        model_id: "text-embedding-ada-002".to_string(),
        ref_db_name: Some("testdb".to_string()),
        ref_table_name: Some("users".to_string()),
        embedding: test_embedding(dim, 1.0),
    };

    let id = storage::insert_chunk(&conn, &fk_chunk).expect("insert fk chunk");

    let retrieved = storage::get_chunk_by_key(&conn, "conn-1", "testdb.orders.fk_user_id")
        .expect("get fk chunk")
        .expect("should exist");

    assert_eq!(retrieved.id, id);
    assert_eq!(retrieved.chunk_type, ChunkType::Fk);
    assert_eq!(retrieved.ref_db_name.as_deref(), Some("testdb"));
    assert_eq!(retrieved.ref_table_name.as_deref(), Some("users"));
}

// ── Serde coverage for types ─────────────────────────────────────────────

#[test]
fn test_chunk_type_serde() {
    let json = serde_json::to_string(&ChunkType::Table).expect("serialize");
    assert_eq!(json, "\"table\"");

    let json_fk = serde_json::to_string(&ChunkType::Fk).expect("serialize");
    assert_eq!(json_fk, "\"fk\"");

    let deserialized: ChunkType = serde_json::from_str("\"table\"").expect("deserialize");
    assert_eq!(deserialized, ChunkType::Table);

    let deserialized_fk: ChunkType = serde_json::from_str("\"fk\"").expect("deserialize");
    assert_eq!(deserialized_fk, ChunkType::Fk);
}

#[test]
fn test_index_status_serde() {
    let statuses = vec![
        (IndexStatus::NotConfigured, "\"notConfigured\""),
        (IndexStatus::Building, "\"building\""),
        (IndexStatus::Ready, "\"ready\""),
        (IndexStatus::Stale, "\"stale\""),
        (IndexStatus::Error, "\"error\""),
    ];

    for (status, expected_json) in &statuses {
        let json = serde_json::to_string(status).expect("serialize");
        assert_eq!(
            &json, expected_json,
            "serialization mismatch for {:?}",
            status
        );

        let deserialized: IndexStatus = serde_json::from_str(expected_json).expect("deserialize");
        assert_eq!(
            &deserialized, status,
            "deserialization mismatch for {expected_json}"
        );
    }
}

#[test]
fn test_chunk_metadata_serde() {
    let meta = ChunkMetadata {
        id: 1,
        connection_id: "conn-1".to_string(),
        chunk_key: "testdb.users.table".to_string(),
        db_name: "testdb".to_string(),
        table_name: "users".to_string(),
        chunk_type: ChunkType::Table,
        ddl_text: "CREATE TABLE users (id INT)".to_string(),
        ddl_hash: "abc".to_string(),
        model_id: "model-a".to_string(),
        embedded_at: "2025-01-15".to_string(),
        ref_db_name: None,
        ref_table_name: None,
    };

    let json = serde_json::to_value(&meta).expect("serialize");
    assert_eq!(json["connectionId"], "conn-1");
    assert_eq!(json["chunkKey"], "testdb.users.table");
    assert_eq!(json["chunkType"], "table");
}

#[test]
fn test_index_meta_serde() {
    let meta = IndexMeta {
        connection_id: "conn-1".to_string(),
        model_id: "model-a".to_string(),
        embedding_dimension: 384,
        last_build_at: Some("2025-01-15".to_string()),
        status: IndexStatus::Ready,
        vec_schema_version: Some(1),
    };

    let json = serde_json::to_value(&meta).expect("serialize");
    assert_eq!(json["connectionId"], "conn-1");
    assert_eq!(json["embeddingDimension"], 384);
    assert_eq!(json["status"], "ready");
}

// ── ChunkType/IndexStatus from_str edge cases ───────────────────────────

#[test]
fn test_chunk_type_from_str_unknown() {
    assert!(ChunkType::from_str("unknown").is_none());
}

#[test]
fn test_index_status_from_str_unknown() {
    assert!(IndexStatus::from_str("unknown").is_none());
}

use sqllumen_lib::schema_index::types::ChunkMetadata;

// ── delete_chunk_by_key ──────────────────────────────────────────────────

#[test]
fn test_delete_chunk_by_key_removes_only_target_chunk() {
    let dim = 4;
    let conn = setup_db(dim);

    // Insert a table chunk and an FK chunk for the same table
    let table_chunk = sample_chunk("conn-1", "table:testdb.users", dim);
    storage::insert_chunk(&conn, &table_chunk).expect("insert table chunk");

    let fk_chunk = ChunkInsert {
        connection_id: "conn-1".to_string(),
        chunk_key: "fk:testdb.orders:fk_user_id".to_string(),
        db_name: "testdb".to_string(),
        table_name: "orders".to_string(),
        chunk_type: ChunkType::Fk,
        ddl_text:
            "Table testdb.orders has a foreign key (user_id) that references testdb.users(id)"
                .to_string(),
        ddl_hash: "fk_hash".to_string(),
        model_id: "text-embedding-ada-002".to_string(),
        ref_db_name: Some("testdb".to_string()),
        ref_table_name: Some("users".to_string()),
        embedding: test_embedding(dim, 2.0),
    };
    storage::insert_chunk(&conn, &fk_chunk).expect("insert fk chunk");

    // Delete only the FK chunk by key
    storage::delete_chunk_by_key(&conn, "conn-1", "fk:testdb.orders:fk_user_id")
        .expect("delete by key");

    // Table chunk should still exist
    let remaining = storage::list_chunks(&conn, "conn-1").expect("list remaining");
    assert_eq!(remaining.len(), 1, "only the table chunk should remain");
    assert_eq!(remaining[0].chunk_key, "table:testdb.users");

    // Only 1 vector row should remain
    let vec_table = storage::vec_table_name("conn-1");
    let vec_count: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {vec_table}"), [], |row| {
            row.get(0)
        })
        .expect("count vectors");
    assert_eq!(vec_count, 1, "only the table vector should remain");
}

#[test]
fn test_delete_chunk_by_key_noop_for_missing_key() {
    let dim = 4;
    let conn = setup_db(dim);

    let chunk = sample_chunk("conn-1", "table:testdb.users", dim);
    storage::insert_chunk(&conn, &chunk).expect("insert chunk");

    // Delete a non-existent key — should succeed without error
    storage::delete_chunk_by_key(&conn, "conn-1", "table:testdb.nonexistent")
        .expect("delete missing key should succeed");

    // Original chunk should still exist
    let remaining = storage::list_chunks(&conn, "conn-1").expect("list remaining");
    assert_eq!(remaining.len(), 1);
}

// ── vec_schema_version in IndexMeta ──────────────────────────────────────

#[test]
fn test_index_meta_lacks_vec_schema_version_field() {
    // Verify that IndexMeta serializes with a "vecSchemaVersion" field.
    let meta = IndexMeta {
        connection_id: "conn-1".to_string(),
        model_id: "model-a".to_string(),
        embedding_dimension: 384,
        last_build_at: None,
        status: IndexStatus::Ready,
        vec_schema_version: Some(1),
    };

    let json = serde_json::to_value(&meta).expect("serialize");
    assert!(
        json.get("vecSchemaVersion").is_some(),
        "IndexMeta JSON should contain 'vecSchemaVersion', got: {json}"
    );
    assert_eq!(json["vecSchemaVersion"], 1);
}

#[test]
fn test_old_l2_table_survives_when_same_model_id_used() {
    // Simulates the scenario: a vec0 table was created WITHOUT cosine distance
    // (L2 default), and IndexMeta has the same model_id as the config.
    // After the fix, `handle_model_change` should detect the stale
    // vec_schema_version and trigger a rebuild.
    //
    // We verify this by checking the storage layer: when vec_schema_version is
    // None/NULL (legacy row), upsert_index_meta writes the current version,
    // and get_index_meta returns it so the builder can compare.
    let conn = setup_db(4);

    // Simulate a legacy IndexMeta row without vec_schema_version (NULL).
    // We write directly to SQLite to mimic an old-format row.
    conn.execute(
        "INSERT OR REPLACE INTO schema_index_meta (connection_id, model_id, embedding_dimension, status)
         VALUES ('conn-1', 'nomic-embed-text', 384, 'ready')",
        [],
    )
    .expect("insert legacy meta row");

    // Read it back — vec_schema_version should be None (NULL)
    let meta = storage::get_index_meta(&conn, "conn-1")
        .expect("get meta")
        .expect("meta should exist");
    assert_eq!(meta.model_id, "nomic-embed-text");
    assert!(
        meta.vec_schema_version.is_none(),
        "Legacy row should have vec_schema_version = None, got: {:?}",
        meta.vec_schema_version
    );

    // The builder's check is:
    //   meta.vec_schema_version != Some(VEC_SCHEMA_VERSION as i64)
    // With None != Some(1), this triggers the rebuild branch.
    assert_ne!(
        meta.vec_schema_version,
        Some(storage::VEC_SCHEMA_VERSION as i64),
        "Legacy meta should NOT match current VEC_SCHEMA_VERSION — this triggers rebuild"
    );

    // After upsert, vec_schema_version should be written as the current version
    storage::upsert_index_meta(&conn, &meta).expect("upsert meta");
    let updated = storage::get_index_meta(&conn, "conn-1")
        .expect("get updated meta")
        .expect("should exist");
    assert_eq!(
        updated.vec_schema_version,
        Some(storage::VEC_SCHEMA_VERSION as i64),
        "After upsert, vec_schema_version should be set to current VEC_SCHEMA_VERSION"
    );
}

// ── schema_index_table_signatures CRUD ──────────────────────────────────

#[test]
fn test_signatures_roundtrip_and_partition_by_connection() {
    let conn = setup_db(4);

    let entries_a = vec![
        ("db1".to_string(), "users".to_string(), "sig-a-users".to_string()),
        ("db1".to_string(), "orders".to_string(), "sig-a-orders".to_string()),
    ];
    storage::upsert_signatures(&conn, "conn-A", &entries_a).expect("upsert A");

    let entries_b = vec![(
        "db1".to_string(),
        "users".to_string(),
        "sig-b-users".to_string(),
    )];
    storage::upsert_signatures(&conn, "conn-B", &entries_b).expect("upsert B");

    let got_a = storage::get_signatures_for_connection(&conn, "conn-A").expect("read A");
    assert_eq!(got_a.len(), 2);
    assert_eq!(
        got_a.get(&("db1".to_string(), "users".to_string())),
        Some(&"sig-a-users".to_string())
    );
    assert_eq!(
        got_a.get(&("db1".to_string(), "orders".to_string())),
        Some(&"sig-a-orders".to_string())
    );

    let got_b = storage::get_signatures_for_connection(&conn, "conn-B").expect("read B");
    assert_eq!(got_b.len(), 1);
    assert_eq!(
        got_b.get(&("db1".to_string(), "users".to_string())),
        Some(&"sig-b-users".to_string())
    );
}

#[test]
fn test_signatures_upsert_updates_existing_row() {
    let conn = setup_db(4);

    storage::upsert_signatures(
        &conn,
        "conn-1",
        &[("db".to_string(), "t".to_string(), "v1".to_string())],
    )
    .expect("insert");

    storage::upsert_signatures(
        &conn,
        "conn-1",
        &[("db".to_string(), "t".to_string(), "v2".to_string())],
    )
    .expect("update");

    let got = storage::get_signatures_for_connection(&conn, "conn-1").expect("read");
    assert_eq!(got.len(), 1);
    assert_eq!(
        got.get(&("db".to_string(), "t".to_string())),
        Some(&"v2".to_string()),
        "upsert must replace the existing signature"
    );
}

#[test]
fn test_delete_signature_targets_single_row() {
    let conn = setup_db(4);

    storage::upsert_signatures(
        &conn,
        "conn-1",
        &[
            ("db".to_string(), "a".to_string(), "sig-a".to_string()),
            ("db".to_string(), "b".to_string(), "sig-b".to_string()),
        ],
    )
    .expect("upsert");

    storage::delete_signature(&conn, "conn-1", "db", "a").expect("delete a");

    let remaining = storage::get_signatures_for_connection(&conn, "conn-1").expect("read");
    assert_eq!(remaining.len(), 1);
    assert!(remaining.contains_key(&("db".to_string(), "b".to_string())));
}

#[test]
fn test_delete_signature_is_noop_when_missing() {
    let conn = setup_db(4);

    storage::upsert_signatures(
        &conn,
        "conn-1",
        &[("db".to_string(), "a".to_string(), "sig-a".to_string())],
    )
    .expect("upsert");

    storage::delete_signature(&conn, "conn-1", "db", "nonexistent")
        .expect("delete missing row should succeed");

    let remaining = storage::get_signatures_for_connection(&conn, "conn-1").expect("read");
    assert_eq!(remaining.len(), 1);
}

#[test]
fn test_delete_all_chunks_also_wipes_signatures() {
    let dim = 4;
    let conn = setup_db(dim);

    // Seed both a chunk and a signature for the same connection.
    let chunk = sample_chunk("conn-1", "table:testdb.users", dim);
    storage::insert_chunk(&conn, &chunk).expect("insert chunk");
    storage::upsert_signatures(
        &conn,
        "conn-1",
        &[(
            "testdb".to_string(),
            "users".to_string(),
            "initial-sig".to_string(),
        )],
    )
    .expect("upsert sig");

    // Sanity: both are present.
    assert_eq!(
        storage::get_signatures_for_connection(&conn, "conn-1")
            .expect("read")
            .len(),
        1
    );

    storage::delete_all_chunks(&conn, "conn-1").expect("wipe");

    assert!(
        storage::list_chunks(&conn, "conn-1")
            .expect("list")
            .is_empty(),
        "chunks should be wiped"
    );
    assert!(
        storage::get_signatures_for_connection(&conn, "conn-1")
            .expect("read sigs")
            .is_empty(),
        "signatures should also be wiped by delete_all_chunks"
    );
}

#[test]
fn test_delete_all_signatures_scoped_to_connection() {
    let conn = setup_db(4);

    storage::upsert_signatures(
        &conn,
        "conn-A",
        &[("db".to_string(), "a".to_string(), "a1".to_string())],
    )
    .expect("seed A");
    storage::upsert_signatures(
        &conn,
        "conn-B",
        &[("db".to_string(), "b".to_string(), "b1".to_string())],
    )
    .expect("seed B");

    storage::delete_all_signatures(&conn, "conn-A").expect("wipe A");

    assert!(
        storage::get_signatures_for_connection(&conn, "conn-A")
            .expect("read A")
            .is_empty()
    );
    assert_eq!(
        storage::get_signatures_for_connection(&conn, "conn-B")
            .expect("read B")
            .len(),
        1,
        "other connections must be untouched"
    );
}

#[test]
fn test_upsert_signatures_empty_batch_is_noop() {
    let conn = setup_db(4);
    storage::upsert_signatures(&conn, "conn-1", &[]).expect("empty upsert should succeed");
    assert!(
        storage::get_signatures_for_connection(&conn, "conn-1")
            .expect("read")
            .is_empty()
    );
}
