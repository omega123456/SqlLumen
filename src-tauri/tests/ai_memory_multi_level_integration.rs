//! Integration tests for multi-level `ai_memory` — scope-aware storage,
//! move, and group cascade.

use rusqlite::{params, Connection};
use sqllumen_lib::ai_memory::storage;
use sqllumen_lib::ai_memory::types::{AiMemory, MemoryScope};
use sqllumen_lib::db::migrations::run_migrations;
use sqllumen_lib::init_sqlite_vec;

/// Register sqlite-vec, open an in-memory DB, run all migrations.
fn setup_db() -> Connection {
    init_sqlite_vec();
    let conn = Connection::open_in_memory().expect("open in-memory db");
    run_migrations(&conn).expect("run migrations");
    conn
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            params![name],
            |row| row.get(0),
        )
        .unwrap();
    count == 1
}

/// KNN-query a vec table joined back to its row table; returns matched contents.
fn knn_contents(conn: &Connection, scope: MemoryScope, vec_table: &str, query: &[f32]) -> Vec<String> {
    let row_table = match scope {
        MemoryScope::Connection => "connection_memories",
        MemoryScope::Group => "group_memories",
        MemoryScope::Global => "global_memories",
    };
    let bytes: Vec<u8> = query.iter().flat_map(|f: &f32| f.to_le_bytes()).collect();
    let sql = format!(
        "SELECT m.content FROM {vec_table} v JOIN {row_table} m ON m.id = v.id \
         WHERE v.embedding MATCH ?1 AND k = ?2 ORDER BY v.distance"
    );
    let mut stmt = conn.prepare(&sql).unwrap();
    stmt.query_map(params![bytes, 5i64], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

// ── Migration ────────────────────────────────────────────────────────────

#[test]
fn migration_creates_all_three_tables() {
    let conn = setup_db();
    assert!(table_exists(&conn, "connection_memories"));
    assert!(table_exists(&conn, "group_memories"));
    assert!(table_exists(&conn, "global_memories"));
    // Old name no longer present.
    assert!(!table_exists(&conn, "ai_memories"));
}

#[test]
fn migration_creates_group_index() {
    let conn = setup_db();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_group_memories_group_id'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

// ── Vec-table naming ──────────────────────────────────────────────────────

#[test]
fn vec_table_names_per_scope() {
    assert_eq!(storage::vec_table_name("c-1"), "ai_memory_vectors_c_1");
    assert_eq!(
        storage::group_vec_table_name("g-1"),
        "ai_memory_vectors_group_g_1"
    );
    assert_eq!(storage::global_vec_table_name(), "ai_memory_vectors_global");
}

#[test]
fn vec_table_for_scope_resolves_and_validates() {
    assert_eq!(
        storage::vec_table_for_scope(MemoryScope::Connection, Some("c-1")).unwrap(),
        "ai_memory_vectors_c_1"
    );
    assert_eq!(
        storage::vec_table_for_scope(MemoryScope::Group, Some("g-1")).unwrap(),
        "ai_memory_vectors_group_g_1"
    );
    assert_eq!(
        storage::vec_table_for_scope(MemoryScope::Global, None).unwrap(),
        "ai_memory_vectors_global"
    );
    assert!(storage::vec_table_for_scope(MemoryScope::Connection, None).is_err());
    assert!(storage::vec_table_for_scope(MemoryScope::Group, None).is_err());
}

// ── Insert / list / delete per scope ──────────────────────────────────────

#[test]
fn insert_list_delete_connection_scope() {
    let conn = setup_db();
    let id =
        storage::insert_memory_scoped(&conn, MemoryScope::Connection, Some("c-1"), "Conn note")
            .unwrap();
    let list =
        storage::list_memories_scoped(&conn, MemoryScope::Connection, Some("c-1")).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].scope, MemoryScope::Connection);
    assert_eq!(list[0].connection_id.as_deref(), Some("c-1"));
    assert!(list[0].group_id.is_none());

    storage::delete_memory_scoped(&conn, MemoryScope::Connection, id).unwrap();
    assert!(storage::list_memories_scoped(&conn, MemoryScope::Connection, Some("c-1"))
        .unwrap()
        .is_empty());
}

#[test]
fn insert_list_delete_group_scope() {
    let conn = setup_db();
    let id = storage::insert_memory_scoped(&conn, MemoryScope::Group, Some("g-1"), "Group note")
        .unwrap();
    let list = storage::list_memories_scoped(&conn, MemoryScope::Group, Some("g-1")).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].scope, MemoryScope::Group);
    assert_eq!(list[0].group_id.as_deref(), Some("g-1"));
    assert!(list[0].connection_id.is_none());

    storage::delete_memory_scoped(&conn, MemoryScope::Group, id).unwrap();
    assert!(storage::list_memories_scoped(&conn, MemoryScope::Group, Some("g-1"))
        .unwrap()
        .is_empty());
}

#[test]
fn insert_list_delete_global_scope() {
    let conn = setup_db();
    let id =
        storage::insert_memory_scoped(&conn, MemoryScope::Global, None, "Global note").unwrap();
    let list = storage::list_memories_scoped(&conn, MemoryScope::Global, None).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].scope, MemoryScope::Global);
    assert!(list[0].connection_id.is_none());
    assert!(list[0].group_id.is_none());

    storage::delete_memory_scoped(&conn, MemoryScope::Global, id).unwrap();
    assert!(storage::list_memories_scoped(&conn, MemoryScope::Global, None)
        .unwrap()
        .is_empty());
}

#[test]
fn list_scoped_filters_by_owner() {
    let conn = setup_db();
    storage::insert_memory_scoped(&conn, MemoryScope::Connection, Some("c-1"), "A").unwrap();
    storage::insert_memory_scoped(&conn, MemoryScope::Connection, Some("c-2"), "B").unwrap();
    assert_eq!(
        storage::list_memories_scoped(&conn, MemoryScope::Connection, Some("c-1"))
            .unwrap()
            .len(),
        1
    );
    storage::insert_memory_scoped(&conn, MemoryScope::Group, Some("g-1"), "G1").unwrap();
    storage::insert_memory_scoped(&conn, MemoryScope::Group, Some("g-2"), "G2").unwrap();
    assert_eq!(
        storage::list_memories_scoped(&conn, MemoryScope::Group, Some("g-2"))
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn get_by_id_and_texts_per_scope() {
    let conn = setup_db();
    let gid = storage::insert_memory_scoped(&conn, MemoryScope::Group, Some("g-1"), "GG").unwrap();
    let fetched = storage::get_memory_by_id_scoped(&conn, MemoryScope::Group, gid)
        .unwrap()
        .unwrap();
    assert_eq!(fetched.content, "GG");

    let glob = storage::insert_memory_scoped(&conn, MemoryScope::Global, None, "World").unwrap();
    let texts = storage::get_memory_texts_scoped(&conn, MemoryScope::Global, None).unwrap();
    assert_eq!(texts, vec![(glob, "World".to_string())]);
}

// ── Vectors per scope ─────────────────────────────────────────────────────

#[test]
fn ensure_and_insert_vector_each_scope() {
    let conn = setup_db();
    let dim = 4;

    let g_id = storage::insert_memory_scoped(&conn, MemoryScope::Global, None, "x").unwrap();
    let g_table =
        storage::ensure_vec_table_for_scope(&conn, MemoryScope::Global, None, dim).unwrap();
    assert_eq!(g_table, "ai_memory_vectors_global");
    storage::insert_memory_vector(&conn, &g_table, g_id, &[1.0, 0.0, 0.0, 0.0]).unwrap();

    let gr_id = storage::insert_memory_scoped(&conn, MemoryScope::Group, Some("g-1"), "y").unwrap();
    let gr_table =
        storage::ensure_vec_table_for_scope(&conn, MemoryScope::Group, Some("g-1"), dim).unwrap();
    storage::insert_memory_vector(&conn, &gr_table, gr_id, &[0.0, 1.0, 0.0, 0.0]).unwrap();

    assert!(table_exists(&conn, &g_table));
    assert!(table_exists(&conn, &gr_table));

    // delete vector scoped clears it (and is graceful for missing tables).
    storage::delete_memory_vector_scoped(&conn, MemoryScope::Global, None, g_id).unwrap();
    let remaining: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {g_table}"), [], |row| row.get(0))
        .unwrap();
    assert_eq!(remaining, 0);
    storage::delete_memory_vector_scoped(&conn, MemoryScope::Connection, Some("missing"), 1)
        .unwrap();
}

// ── Move ──────────────────────────────────────────────────────────────────

#[test]
fn move_transfers_row_and_vector_and_is_knn_searchable() {
    let mut conn = setup_db();
    let dim = 4;
    let embedding = vec![1.0f32, 0.0, 0.0, 0.0];

    // Source: a connection memory with a vector.
    let src_id =
        storage::insert_memory_scoped(&conn, MemoryScope::Connection, Some("c-1"), "Moved note")
            .unwrap();
    let src_table =
        storage::ensure_vec_table_for_scope(&conn, MemoryScope::Connection, Some("c-1"), dim)
            .unwrap();
    storage::insert_memory_vector(&conn, &src_table, src_id, &embedding).unwrap();

    // Move to global (caller-provided embedding bytes).
    let moved = storage::move_memory(
        &mut conn,
        MemoryScope::Connection,
        Some("c-1"),
        src_id,
        MemoryScope::Global,
        None,
        &embedding,
    )
    .unwrap();

    assert_eq!(moved.scope, MemoryScope::Global);
    assert_eq!(moved.content, "Moved note");

    // Source row + vector gone.
    assert!(storage::get_memory_by_id_scoped(&conn, MemoryScope::Connection, src_id)
        .unwrap()
        .is_none());
    let src_vec_count: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {src_table}"), [], |row| row.get(0))
        .unwrap();
    assert_eq!(src_vec_count, 0);

    // Target row present and KNN-searchable.
    let global_table = storage::global_vec_table_name();
    let found = knn_contents(&conn, MemoryScope::Global, &global_table, &embedding);
    assert!(found.contains(&"Moved note".to_string()));
}

#[test]
fn move_errors_for_missing_source() {
    let mut conn = setup_db();
    let result = storage::move_memory(
        &mut conn,
        MemoryScope::Connection,
        Some("c-1"),
        9999,
        MemoryScope::Global,
        None,
        &[1.0, 0.0, 0.0, 0.0],
    );
    assert!(result.is_err());
}

// ── Group cascade ─────────────────────────────────────────────────────────

#[test]
fn group_cascade_deletes_rows_and_drops_vec_table() {
    let conn = setup_db();
    let dim = 4;
    let id1 = storage::insert_memory_scoped(&conn, MemoryScope::Group, Some("g-1"), "A").unwrap();
    storage::insert_memory_scoped(&conn, MemoryScope::Group, Some("g-1"), "B").unwrap();
    // A different group is untouched.
    storage::insert_memory_scoped(&conn, MemoryScope::Group, Some("g-2"), "Keep").unwrap();

    let table =
        storage::ensure_vec_table_for_scope(&conn, MemoryScope::Group, Some("g-1"), dim).unwrap();
    storage::insert_memory_vector(&conn, &table, id1, &[1.0, 0.0, 0.0, 0.0]).unwrap();
    assert!(table_exists(&conn, &table));

    storage::delete_memories_for_group(&conn, "g-1").unwrap();

    assert!(storage::list_memories_scoped(&conn, MemoryScope::Group, Some("g-1"))
        .unwrap()
        .is_empty());
    assert!(!table_exists(&conn, &table));
    // Other group preserved.
    assert_eq!(
        storage::list_memories_scoped(&conn, MemoryScope::Group, Some("g-2"))
            .unwrap()
            .len(),
        1
    );
}

// ── Existing connection rows survive (preservation contract) ──────────────

#[test]
fn connection_rows_and_vectors_preserved_under_new_table_name() {
    let conn = setup_db();
    let dim = 4;
    let id = storage::insert_memory(&conn, "c-1", "Preserved").unwrap();
    let table = storage::ensure_vec_table(&conn, "c-1", dim).unwrap();
    assert_eq!(table, "ai_memory_vectors_c_1");
    storage::insert_memory_vector(&conn, &table, id, &[1.0, 0.0, 0.0, 0.0]).unwrap();

    // Listing returns the unified AiMemory.
    let list: Vec<AiMemory> = storage::list_memories(&conn, "c-1").unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].content, "Preserved");
    assert_eq!(list[0].scope, MemoryScope::Connection);
}

// ── Command `_impl` tests (correctness; commands/ai_memory.rs is llvm-cov-excluded) ──

mod common;

use sqllumen_lib::commands::ai_memory::{
    delete_memory_impl, list_connection_memories_impl, list_global_memories_impl,
    list_group_memories_impl, move_memory_prepare, reembed_targets, resolve_save_owner,
    resolve_search_owners, save_memory_impl,
};
use sqllumen_lib::db::connection_groups::insert_group;
use sqllumen_lib::db::connections::{insert_connection, NewConnectionData};
use sqllumen_lib::db::settings;

fn new_conn_data(name: &str, group_id: Option<String>) -> NewConnectionData {
    NewConnectionData {
        name: name.to_string(),
        host: "localhost".to_string(),
        port: 3306,
        username: "root".to_string(),
        default_database: None,
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        color: None,
        group_id,
        read_only: false,
        sort_order: 0,
        connect_timeout_secs: None,
        keepalive_interval_secs: None,
    }
}

fn map_session(state: &sqllumen_lib::state::AppState, session: &str, profile: &str) {
    state
        .session_profile_map
        .lock()
        .unwrap()
        .insert(session.to_string(), profile.to_string());
}

fn set_embedding_config(state: &sqllumen_lib::state::AppState) {
    let conn = state.db.lock().unwrap();
    settings::set_setting(&conn, "ai.endpoint", "http://localhost:1234").unwrap();
    settings::set_setting(&conn, "ai.embeddingModel", "test-model").unwrap();
}

#[test]
fn save_memory_impl_connection_scope_writes_connection_row() {
    let state = common::test_app_state();
    let conn_id = {
        let conn = state.db.lock().unwrap();
        insert_connection(&conn, &new_conn_data("Local", None)).unwrap()
    };
    map_session(&state, "sess-1", &conn_id);
    set_embedding_config(&state);

    let (memory, owner_id, _endpoint, _model) =
        save_memory_impl(&state, "sess-1", "Conn note", MemoryScope::Connection).unwrap();
    assert_eq!(memory.scope, MemoryScope::Connection);
    assert_eq!(owner_id.as_deref(), Some(conn_id.as_str()));

    let conn = state.db.lock().unwrap();
    let rows = storage::list_memories(&conn, &conn_id).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].content, "Conn note");
}

#[test]
fn save_memory_impl_global_scope_writes_global_row() {
    let state = common::test_app_state();
    let conn_id = {
        let conn = state.db.lock().unwrap();
        insert_connection(&conn, &new_conn_data("Local", None)).unwrap()
    };
    map_session(&state, "sess-1", &conn_id);
    set_embedding_config(&state);

    let (memory, owner_id, _, _) =
        save_memory_impl(&state, "sess-1", "Global note", MemoryScope::Global).unwrap();
    assert_eq!(memory.scope, MemoryScope::Global);
    assert!(owner_id.is_none());

    let conn = state.db.lock().unwrap();
    assert_eq!(storage::list_global_memories(&conn).unwrap().len(), 1);
}

#[test]
fn save_memory_impl_group_scope_writes_group_row() {
    let state = common::test_app_state();
    let group_id = {
        let conn = state.db.lock().unwrap();
        insert_group(&conn, "Work").unwrap()
    };
    let conn_id = {
        let conn = state.db.lock().unwrap();
        insert_connection(&conn, &new_conn_data("Local", Some(group_id.clone()))).unwrap()
    };
    map_session(&state, "sess-1", &conn_id);
    set_embedding_config(&state);

    let (memory, owner_id, _, _) =
        save_memory_impl(&state, "sess-1", "Group note", MemoryScope::Group).unwrap();
    assert_eq!(memory.scope, MemoryScope::Group);
    assert_eq!(owner_id.as_deref(), Some(group_id.as_str()));

    let conn = state.db.lock().unwrap();
    assert_eq!(storage::list_group_memories(&conn, &group_id).unwrap().len(), 1);
}

#[test]
fn save_memory_group_scope_without_group_errors_and_writes_nothing() {
    let state = common::test_app_state();
    let conn_id = {
        let conn = state.db.lock().unwrap();
        insert_connection(&conn, &new_conn_data("Local", None)).unwrap()
    };
    map_session(&state, "sess-1", &conn_id);
    set_embedding_config(&state);

    let err = resolve_save_owner(&state, "sess-1", MemoryScope::Group).unwrap_err();
    assert!(err.contains("not in a group"), "got: {err}");

    let result = save_memory_impl(&state, "sess-1", "Group note", MemoryScope::Group);
    assert!(result.is_err());
    // Nothing should have been written at any scope.
    let conn = state.db.lock().unwrap();
    assert!(storage::list_global_memories(&conn).unwrap().is_empty());
}

#[test]
fn granular_list_commands_return_correct_level() {
    let state = common::test_app_state();
    let group_id = {
        let conn = state.db.lock().unwrap();
        insert_group(&conn, "Work").unwrap()
    };
    {
        let conn = state.db.lock().unwrap();
        storage::insert_memory(&conn, "conn-1", "C1").unwrap();
        storage::insert_group_memory(&conn, &group_id, "G1").unwrap();
        storage::insert_global_memory(&conn, "GL1").unwrap();
        storage::insert_global_memory(&conn, "GL2").unwrap();
    }

    assert_eq!(list_global_memories_impl(&state).unwrap().len(), 2);
    assert_eq!(list_group_memories_impl(&state, &group_id).unwrap().len(), 1);
    assert_eq!(list_connection_memories_impl(&state, "conn-1").unwrap().len(), 1);
    // A connection with nothing returns empty.
    assert!(list_connection_memories_impl(&state, "conn-2").unwrap().is_empty());
}

#[test]
fn delete_memory_impl_per_scope_removes_row_and_vector() {
    init_sqlite_vec();
    let state = common::test_app_state();
    let (gid, glob_id) = {
        let conn = state.db.lock().unwrap();
        let gid = storage::insert_group_memory(&conn, "g-1", "Group mem").unwrap();
        let table =
            storage::ensure_vec_table_for_scope(&conn, MemoryScope::Group, Some("g-1"), 4).unwrap();
        storage::insert_memory_vector(&conn, &table, gid, &[1.0, 0.0, 0.0, 0.0]).unwrap();

        let glob_id = storage::insert_global_memory(&conn, "Global mem").unwrap();
        let gtable =
            storage::ensure_vec_table_for_scope(&conn, MemoryScope::Global, None, 4).unwrap();
        storage::insert_memory_vector(&conn, &gtable, glob_id, &[0.0, 1.0, 0.0, 0.0]).unwrap();
        (gid, glob_id)
    };

    delete_memory_impl(&state, MemoryScope::Group, gid).unwrap();
    delete_memory_impl(&state, MemoryScope::Global, glob_id).unwrap();

    let conn = state.db.lock().unwrap();
    assert!(storage::list_group_memories(&conn, "g-1").unwrap().is_empty());
    assert!(storage::list_global_memories(&conn).unwrap().is_empty());
}

#[test]
fn delete_memory_impl_errors_for_missing_at_scope() {
    let state = common::test_app_state();
    let err = delete_memory_impl(&state, MemoryScope::Global, 12345).unwrap_err();
    assert!(err.contains("not found"));
}

#[test]
fn move_memory_prepare_validates_target_and_reads_content() {
    let state = common::test_app_state();
    let group_id = {
        let conn = state.db.lock().unwrap();
        insert_group(&conn, "Dest").unwrap()
    };
    set_embedding_config(&state);
    let mem_id = {
        let conn = state.db.lock().unwrap();
        storage::insert_global_memory(&conn, "Movable").unwrap()
    };

    // Global → Group (valid target).
    let (content, to_owner, _endpoint, _model) = move_memory_prepare(
        &state,
        mem_id,
        MemoryScope::Global,
        MemoryScope::Group,
        Some(&group_id),
        None,
    )
    .unwrap();
    assert_eq!(content, "Movable");
    assert_eq!(to_owner.as_deref(), Some(group_id.as_str()));

    // Missing target group is rejected.
    let err = move_memory_prepare(
        &state,
        mem_id,
        MemoryScope::Global,
        MemoryScope::Group,
        Some("nonexistent-group"),
        None,
    )
    .unwrap_err();
    assert!(err.contains("not found"));
}

#[test]
fn move_memory_storage_relocates_and_is_retrievable() {
    init_sqlite_vec();
    let conn_handle = setup_db();
    let mut conn = conn_handle;
    let src = storage::insert_global_memory(&conn, "Relocate me").unwrap();
    let gtable = storage::ensure_vec_table_for_scope(&conn, MemoryScope::Global, None, 4).unwrap();
    storage::insert_memory_vector(&conn, &gtable, src, &[1.0, 0.0, 0.0, 0.0]).unwrap();

    let moved = storage::move_memory(
        &mut conn,
        MemoryScope::Global,
        None,
        src,
        MemoryScope::Group,
        Some("g-dest"),
        &[1.0, 0.0, 0.0, 0.0],
    )
    .unwrap();
    assert_eq!(moved.scope, MemoryScope::Group);
    assert_eq!(moved.content, "Relocate me");

    // Retrievable at the target level via KNN.
    let found = knn_contents(
        &conn,
        MemoryScope::Group,
        &storage::group_vec_table_name("g-dest"),
        &[1.0, 0.0, 0.0, 0.0],
    );
    assert!(found.contains(&"Relocate me".to_string()));
    // Source gone.
    assert!(storage::list_global_memories(&conn).unwrap().is_empty());
}

#[test]
fn merged_knn_orders_levels_by_distance() {
    // Mirrors search.rs fan-out semantics: results from global + group +
    // connection vec tables, merged and sorted by ascending distance.
    let conn = setup_db();
    let dim = 4;

    let g = storage::insert_global_memory(&conn, "global").unwrap();
    let gp = storage::insert_group_memory(&conn, "grp", "group").unwrap();
    let c = storage::insert_memory(&conn, "cn", "connection").unwrap();

    let gt = storage::ensure_vec_table_for_scope(&conn, MemoryScope::Global, None, dim).unwrap();
    let gpt =
        storage::ensure_vec_table_for_scope(&conn, MemoryScope::Group, Some("grp"), dim).unwrap();
    let ct =
        storage::ensure_vec_table_for_scope(&conn, MemoryScope::Connection, Some("cn"), dim).unwrap();

    // Query vector [1,0,0,0]; pick embeddings so connection is closest, then group, then global.
    storage::insert_memory_vector(&conn, &ct, c, &[1.0, 0.0, 0.0, 0.0]).unwrap();
    storage::insert_memory_vector(&conn, &gpt, gp, &[0.9, 0.1, 0.0, 0.0]).unwrap();
    storage::insert_memory_vector(&conn, &gt, g, &[0.0, 1.0, 0.0, 0.0]).unwrap();

    let query = [1.0f32, 0.0, 0.0, 0.0];
    let mut merged: Vec<(String, f64)> = Vec::new();
    for (scope, table) in [
        (MemoryScope::Global, gt.clone()),
        (MemoryScope::Group, gpt.clone()),
        (MemoryScope::Connection, ct.clone()),
    ] {
        let row_table = match scope {
            MemoryScope::Connection => "connection_memories",
            MemoryScope::Group => "group_memories",
            MemoryScope::Global => "global_memories",
        };
        let bytes: Vec<u8> = query.iter().flat_map(|f: &f32| f.to_le_bytes()).collect();
        let sql = format!(
            "SELECT m.content, v.distance FROM {table} v JOIN {row_table} m ON m.id = v.id \
             WHERE v.embedding MATCH ?1 AND k = ?2 ORDER BY v.distance"
        );
        let mut stmt = conn.prepare(&sql).unwrap();
        let rows = stmt
            .query_map(params![bytes, 5i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
            })
            .unwrap();
        for r in rows {
            merged.push(r.unwrap());
        }
    }
    merged.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    let order: Vec<String> = merged.into_iter().map(|(c, _)| c).collect();
    assert_eq!(order, vec!["connection", "group", "global"]);
}

#[test]
fn resolve_search_owners_returns_connection_and_group() {
    let state = common::test_app_state();
    let group_id = {
        let conn = state.db.lock().unwrap();
        insert_group(&conn, "Work").unwrap()
    };
    let conn_id = {
        let conn = state.db.lock().unwrap();
        insert_connection(&conn, &new_conn_data("Local", Some(group_id.clone()))).unwrap()
    };
    map_session(&state, "sess-1", &conn_id);

    let (resolved_conn, resolved_group) = resolve_search_owners(&state, "sess-1").unwrap();
    assert_eq!(resolved_conn, conn_id);
    assert_eq!(resolved_group.as_deref(), Some(group_id.as_str()));
}

#[test]
fn reembed_targets_covers_global_groups_and_connections() {
    let state = common::test_app_state();
    let group_id = {
        let conn = state.db.lock().unwrap();
        insert_group(&conn, "Work").unwrap()
    };
    let conn_id = {
        let conn = state.db.lock().unwrap();
        insert_connection(&conn, &new_conn_data("Local", Some(group_id.clone()))).unwrap()
    };

    let targets = reembed_targets(&state).unwrap();
    // Global + one group + one connection.
    assert!(targets
        .iter()
        .any(|(s, o, k)| *s == MemoryScope::Global && o.is_none() && k == "global"));
    assert!(targets.iter().any(
        |(s, o, k)| *s == MemoryScope::Group && o.as_deref() == Some(group_id.as_str()) && k
            == &format!("group_{group_id}")
    ));
    assert!(targets
        .iter()
        .any(|(s, o, _)| *s == MemoryScope::Connection && o.as_deref() == Some(conn_id.as_str())));
}
