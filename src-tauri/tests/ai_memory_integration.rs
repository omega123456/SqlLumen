//! Integration tests for `ai_memory` — storage CRUD + vec0 operations.

use rusqlite::{params, Connection};
use sqllumen_lib::ai_memory::storage;
use sqllumen_lib::ai_memory::types::AiMemory;
use sqllumen_lib::db::migrations::run_migrations;
use sqllumen_lib::init_sqlite_vec;

/// Helper: register sqlite-vec, open an in-memory DB, run all migrations.
fn setup_db() -> Connection {
    init_sqlite_vec();
    let conn = Connection::open_in_memory().expect("open in-memory db");
    run_migrations(&conn).expect("run migrations");
    conn
}

fn test_embedding(dim: usize, seed: f32) -> Vec<f32> {
    (0..dim).map(|i| seed + i as f32 * 0.1).collect()
}

// ── Migration ────────────────────────────────────────────────────────────

#[test]
fn migration_creates_ai_memories_table() {
    let conn = setup_db();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ai_memories'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn migration_creates_index_on_connection_id() {
    let conn = setup_db();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_ai_memories_connection_id'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

// ── insert_memory ────────────────────────────────────────────────────────

#[test]
fn insert_memory_returns_id() {
    let conn = setup_db();
    let id = storage::insert_memory(&conn, "conn-1", "Remember this").unwrap();
    assert!(id > 0);
}

#[test]
fn insert_memory_stores_correct_data() {
    let conn = setup_db();
    let id = storage::insert_memory(&conn, "conn-1", "Test content").unwrap();
    let mem = storage::get_memory_by_id(&conn, id).unwrap().unwrap();
    assert_eq!(mem.connection_id, "conn-1");
    assert_eq!(mem.content, "Test content");
    assert_eq!(mem.source, "manual");
    assert!(mem.created_at > 0);
}

// ── list_memories ────────────────────────────────────────────────────────

#[test]
fn list_memories_returns_all_for_connection() {
    let conn = setup_db();
    storage::insert_memory(&conn, "conn-1", "First").unwrap();
    storage::insert_memory(&conn, "conn-1", "Second").unwrap();
    storage::insert_memory(&conn, "conn-2", "Other").unwrap();

    let memories = storage::list_memories(&conn, "conn-1").unwrap();
    assert_eq!(memories.len(), 2);
}

#[test]
fn list_memories_empty_when_none() {
    let conn = setup_db();
    let memories = storage::list_memories(&conn, "nonexistent").unwrap();
    assert!(memories.is_empty());
}

// ── delete_memory ────────────────────────────────────────────────────────

#[test]
fn delete_memory_removes_row() {
    let conn = setup_db();
    let id = storage::insert_memory(&conn, "conn-1", "To delete").unwrap();
    storage::delete_memory(&conn, id).unwrap();
    let mem = storage::get_memory_by_id(&conn, id).unwrap();
    assert!(mem.is_none());
}

// ── delete_memories_for_connection ───────────────────────────────────────

#[test]
fn delete_memories_for_connection_removes_all_and_drops_vec_table() {
    let conn = setup_db();
    storage::insert_memory(&conn, "conn-1", "A").unwrap();
    storage::insert_memory(&conn, "conn-1", "B").unwrap();
    storage::ensure_vec_table(&conn, "conn-1", 4).unwrap();

    storage::delete_memories_for_connection(&conn, "conn-1").unwrap();

    let memories = storage::list_memories(&conn, "conn-1").unwrap();
    assert!(memories.is_empty());

    // Vec table should be dropped
    let table = storage::vec_table_name("conn-1");
    let count: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{table}'"),
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

// ── ensure_vec_table ─────────────────────────────────────────────────────

#[test]
fn ensure_vec_table_creates_table() {
    let conn = setup_db();
    let table_name = storage::ensure_vec_table(&conn, "conn-1", 4).unwrap();
    assert_eq!(table_name, storage::vec_table_name("conn-1"));

    let count: i64 = conn
        .query_row(
            &format!(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{table_name}'"
            ),
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn ensure_vec_table_idempotent() {
    let conn = setup_db();
    storage::ensure_vec_table(&conn, "conn-1", 4).unwrap();
    storage::ensure_vec_table(&conn, "conn-1", 4).unwrap(); // should not error
}

// ── insert_memory_vector ─────────────────────────────────────────────────

#[test]
fn insert_memory_vector_works() {
    let conn = setup_db();
    let id = storage::insert_memory(&conn, "conn-1", "Test").unwrap();
    let table = storage::ensure_vec_table(&conn, "conn-1", 4).unwrap();
    let embedding = test_embedding(4, 1.0);
    storage::insert_memory_vector(&conn, &table, id, &embedding).unwrap();

    // Verify the vector exists
    let count: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 1);
}

// ── delete_memory_vector ─────────────────────────────────────────────────

#[test]
fn delete_memory_vector_removes_entry() {
    let conn = setup_db();
    let id = storage::insert_memory(&conn, "conn-1", "Test").unwrap();
    let table = storage::ensure_vec_table(&conn, "conn-1", 4).unwrap();
    storage::insert_memory_vector(&conn, &table, id, &test_embedding(4, 1.0)).unwrap();

    storage::delete_memory_vector(&conn, "conn-1", id).unwrap();

    let count: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn delete_memory_vector_graceful_when_no_table() {
    let conn = setup_db();
    // Should not error even though vec table doesn't exist
    storage::delete_memory_vector(&conn, "nonexistent-conn", 999).unwrap();
}

// ── get_memory_texts ─────────────────────────────────────────────────────

#[test]
fn get_memory_texts_returns_id_content_pairs() {
    let conn = setup_db();
    let id1 = storage::insert_memory(&conn, "conn-1", "First").unwrap();
    let id2 = storage::insert_memory(&conn, "conn-1", "Second").unwrap();

    let texts = storage::get_memory_texts(&conn, "conn-1").unwrap();
    assert_eq!(texts.len(), 2);
    assert_eq!(texts[0].0, id1);
    assert_eq!(texts[0].1, "First");
    assert_eq!(texts[1].0, id2);
    assert_eq!(texts[1].1, "Second");
}

// ── KNN search (direct vec table query) ──────────────────────────────────

#[test]
fn knn_search_returns_nearest_vectors() {
    let conn = setup_db();
    let dim = 4;
    let table = storage::ensure_vec_table(&conn, "conn-1", dim).unwrap();

    // Insert 3 memories with different embeddings
    let id1 = storage::insert_memory(&conn, "conn-1", "Alpha").unwrap();
    let id2 = storage::insert_memory(&conn, "conn-1", "Beta").unwrap();
    let id3 = storage::insert_memory(&conn, "conn-1", "Gamma").unwrap();

    let emb1 = vec![1.0, 0.0, 0.0, 0.0];
    let emb2 = vec![0.9, 0.1, 0.0, 0.0]; // close to emb1
    let emb3 = vec![0.0, 0.0, 0.0, 1.0]; // far from emb1

    storage::insert_memory_vector(&conn, &table, id1, &emb1).unwrap();
    storage::insert_memory_vector(&conn, &table, id2, &emb2).unwrap();
    storage::insert_memory_vector(&conn, &table, id3, &emb3).unwrap();

    // Search for something close to emb1
    let query_emb = vec![1.0, 0.0, 0.0, 0.0];
    let query_bytes: Vec<u8> = query_emb
        .iter()
        .flat_map(|f: &f32| f.to_le_bytes())
        .collect();

    let sql = format!(
        "SELECT m.id, m.connection_id, m.content, m.created_at, m.source \
         FROM {table} v JOIN ai_memories m ON m.id = v.id \
         WHERE v.embedding MATCH ?1 AND k = ?2 \
         ORDER BY v.distance"
    );
    let mut stmt = conn.prepare(&sql).unwrap();
    let results: Vec<AiMemory> = stmt
        .query_map(params![query_bytes, 2i64], |row| {
            Ok(AiMemory {
                id: row.get(0)?,
                connection_id: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                source: row.get(4)?,
            })
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert_eq!(results.len(), 2);
    // First result should be "Alpha" (exact match), second "Beta" (close)
    assert_eq!(results[0].content, "Alpha");
    assert_eq!(results[1].content, "Beta");
}

// ── vec_table_name ───────────────────────────────────────────────────────

#[test]
fn vec_table_name_sanitizes_connection_id() {
    assert_eq!(
        storage::vec_table_name("abc-123"),
        "ai_memory_vectors_abc_123"
    );
    assert_eq!(storage::vec_table_name("a.b/c"), "ai_memory_vectors_a_b_c");
}

// ── Error path coverage ─────────────────────────────────────────────────

#[test]
fn insert_memory_vector_errors_on_missing_table() {
    let conn = setup_db();
    let embedding = test_embedding(4, 1.0);
    let result = storage::insert_memory_vector(&conn, "nonexistent_table", 1, &embedding);
    assert!(result.is_err());
}

#[test]
fn delete_memory_is_no_op_for_missing_id() {
    let conn = setup_db();
    // delete_memory doesn't error for missing id — it just does 0 affected rows
    storage::delete_memory(&conn, 99999).unwrap();
}

// ── Command-level tests ─────────────────────────────────────────────────

mod common;

#[test]
fn delete_memory_impl_errors_for_missing_memory() {
    use sqllumen_lib::commands::ai_memory::delete_memory_impl;

    let state = common::test_app_state();
    let result = delete_memory_impl(&state, 99999);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[test]
fn list_memories_impl_returns_memories() {
    use sqllumen_lib::commands::ai_memory::list_memories_impl;

    let state = common::test_app_state();
    {
        let conn = state.db.lock().unwrap();
        storage::insert_memory(&conn, "conn-1", "Hello").unwrap();
        storage::insert_memory(&conn, "conn-1", "World").unwrap();
    }
    let memories = list_memories_impl(&state, "conn-1").unwrap();
    assert_eq!(memories.len(), 2);
}

#[test]
fn list_memories_impl_empty_for_unknown_connection() {
    use sqllumen_lib::commands::ai_memory::list_memories_impl;

    let state = common::test_app_state();
    let memories = list_memories_impl(&state, "nonexistent").unwrap();
    assert!(memories.is_empty());
}

#[test]
fn delete_memory_impl_removes_memory_and_vector() {
    use sqllumen_lib::commands::ai_memory::delete_memory_impl;

    init_sqlite_vec();
    let state = common::test_app_state();
    let id = {
        let conn = state.db.lock().unwrap();
        let id = storage::insert_memory(&conn, "conn-1", "To delete").unwrap();
        let table = storage::ensure_vec_table(&conn, "conn-1", 4).unwrap();
        storage::insert_memory_vector(&conn, &table, id, &test_embedding(4, 1.0)).unwrap();
        id
    };
    delete_memory_impl(&state, id).unwrap();
    let conn = state.db.lock().unwrap();
    let mem = storage::get_memory_by_id(&conn, id).unwrap();
    assert!(mem.is_none());
}

// ── embedding_to_bytes tests ────────────────────────────────────────────

#[test]
fn embedding_to_bytes_produces_correct_output() {
    use sqllumen_lib::ai_memory::embedding_to_bytes;

    let embedding = vec![1.0f32, 2.0f32];
    let bytes = embedding_to_bytes(&embedding);
    assert_eq!(bytes.len(), 8); // 2 * 4 bytes
    // Verify first float
    let f1 = f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    assert!((f1 - 1.0).abs() < f32::EPSILON);
    let f2 = f32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    assert!((f2 - 2.0).abs() < f32::EPSILON);
}

#[test]
fn embedding_to_bytes_empty() {
    use sqllumen_lib::ai_memory::embedding_to_bytes;
    let bytes = embedding_to_bytes(&[]);
    assert!(bytes.is_empty());
}

// ── read_embedding_config tests ─────────────────────────────────────────

#[test]
fn read_embedding_config_returns_configured_values() {
    use sqllumen_lib::ai_memory::read_embedding_config;
    use sqllumen_lib::db::settings;

    let conn = setup_db();
    settings::set_setting(&conn, "ai.endpoint", "http://localhost:1234").unwrap();
    settings::set_setting(&conn, "ai.embeddingModel", "test-model").unwrap();

    let (endpoint, model) = read_embedding_config(&conn).unwrap();
    assert_eq!(endpoint, "http://localhost:1234");
    assert_eq!(model, "test-model");
}

#[test]
fn read_embedding_config_errors_when_endpoint_missing() {
    use sqllumen_lib::ai_memory::read_embedding_config;

    let conn = setup_db();
    let result = read_embedding_config(&conn);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("endpoint"));
}

#[test]
fn read_embedding_config_errors_when_model_missing() {
    use sqllumen_lib::ai_memory::read_embedding_config;
    use sqllumen_lib::db::settings;

    let conn = setup_db();
    settings::set_setting(&conn, "ai.endpoint", "http://localhost:1234").unwrap();
    let result = read_embedding_config(&conn);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("model"));
}

#[test]
fn read_embedding_config_errors_when_endpoint_empty() {
    use sqllumen_lib::ai_memory::read_embedding_config;
    use sqllumen_lib::db::settings;

    let conn = setup_db();
    settings::set_setting(&conn, "ai.endpoint", "  ").unwrap();
    settings::set_setting(&conn, "ai.embeddingModel", "test-model").unwrap();
    let result = read_embedding_config(&conn);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("empty"));
}

#[test]
fn read_embedding_config_errors_when_model_empty() {
    use sqllumen_lib::ai_memory::read_embedding_config;
    use sqllumen_lib::db::settings;

    let conn = setup_db();
    settings::set_setting(&conn, "ai.endpoint", "http://localhost:1234").unwrap();
    settings::set_setting(&conn, "ai.embeddingModel", "  ").unwrap();
    let result = read_embedding_config(&conn);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("empty"));
}

#[test]
fn read_embedding_config_surfaces_settings_query_errors() {
    use sqllumen_lib::ai_memory::read_embedding_config;

    let conn = setup_db();
    conn.execute_batch("DROP TABLE settings").unwrap();

    let result = read_embedding_config(&conn);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("no such table"));
}

// ── save_memory_impl tests ──────────────────────────────────────────────

#[test]
fn save_memory_impl_errors_without_embedding_config() {
    use sqllumen_lib::commands::ai_memory::save_memory_impl;

    let state = common::test_app_state();
    // Register a fake session -> profile mapping
    state
        .session_profile_map
        .lock()
        .unwrap()
        .insert("sess-1".to_string(), "profile-1".to_string());

    let result = save_memory_impl(&state, "sess-1", "Remember this");
    assert!(result.is_err());
    // Should fail because embedding config is not set
    let err = result.unwrap_err();
    assert!(err.contains("endpoint") || err.contains("not configured"));
}

#[test]
fn save_memory_impl_succeeds_with_config() {
    use sqllumen_lib::commands::ai_memory::save_memory_impl;
    use sqllumen_lib::db::settings;

    let state = common::test_app_state();
    state
        .session_profile_map
        .lock()
        .unwrap()
        .insert("sess-1".to_string(), "profile-1".to_string());

    {
        let conn = state.db.lock().unwrap();
        settings::set_setting(&conn, "ai.endpoint", "http://localhost:1234").unwrap();
        settings::set_setting(&conn, "ai.embeddingModel", "test-model").unwrap();
    }

    let (memory, profile_id, endpoint, model) =
        save_memory_impl(&state, "sess-1", "Remember this").unwrap();
    assert_eq!(memory.content, "Remember this");
    assert_eq!(profile_id, "profile-1");
    assert_eq!(endpoint, "http://localhost:1234");
    assert_eq!(model, "test-model");
}
