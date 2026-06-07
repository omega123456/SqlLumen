//! Cascade-aware connection deletion (`commands/connections.rs`
//! `delete_connection_impl`) plus migration 013 orphan-purge behavior.
//!
//! These tests require foreign-key enforcement so the `ON DELETE CASCADE`
//! foreign keys added by migration 013 actually remove the per-connection child
//! rows. They therefore use the dedicated FK-enabled helpers in `common`
//! (`test_db_fk_enabled` / `test_app_state_fk_enabled`); the default FK-off
//! helpers cannot observe cascade.

mod common;

use rusqlite::{params, Connection};
use sqllumen_lib::commands::connections::delete_connection_impl;
use sqllumen_lib::db::connections::{self, NewConnectionData};
use sqllumen_lib::db::migrations::run_migrations;
use sqllumen_lib::init_sqlite_vec;
use sqllumen_lib::{ai_memory, schema_index};

/// Insert a saved connection profile and return its generated id.
fn seed_connection(conn: &Connection, name: &str) -> String {
    let id = connections::insert_connection(
        conn,
        &NewConnectionData {
            name: name.to_string(),
            host: "localhost".to_string(),
            port: 3306,
            username: "root".to_string(),
            default_database: Some("mydb".to_string()),
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            color: None,
            group_id: None,
            read_only: false,
            sort_order: 0,
            connect_timeout_secs: Some(10),
            keepalive_interval_secs: Some(60),
        },
    )
    .expect("should insert connection");
    // insert_connection sets keychain_ref to the id as a password-present
    // marker; clear it so delete_connection_impl does not attempt a keychain
    // delete for a password that was never stored.
    connections::set_keychain_ref(conn, &id, None).expect("clear keychain ref");
    id
}

/// Seed exactly one child row into each of the eight cascade-managed tables for
/// the given connection id.
fn seed_all_child_rows(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO schema_cache_snapshots (connection_id, snapshot_json, updated_at)
         VALUES (?1, '{}', 0)",
        params![id],
    )
    .expect("seed schema_cache_snapshots");

    conn.execute(
        "INSERT INTO schema_index_meta (connection_id, model_id, embedding_dimension, status)
         VALUES (?1, 'model', 8, 'ready')",
        params![id],
    )
    .expect("seed schema_index_meta");

    conn.execute(
        "INSERT INTO schema_index_chunks
            (connection_id, chunk_key, db_name, table_name, chunk_type, ddl_text, ddl_hash, model_id)
         VALUES (?1, 'k', 'db', 't', 'table', 'CREATE TABLE t (id INT)', 'hash', 'model')",
        params![id],
    )
    .expect("seed schema_index_chunks");

    conn.execute(
        "INSERT INTO schema_index_table_signatures
            (connection_id, db_name, table_name, mysql_signature)
         VALUES (?1, 'db', 't', 'sig')",
        params![id],
    )
    .expect("seed schema_index_table_signatures");

    conn.execute(
        "INSERT INTO schema_index_fk_edges
            (connection_id, src_db, src_tbl, src_col, dst_db, dst_tbl, dst_col, constraint_name)
         VALUES (?1, 'db', 'child', 'pid', 'db', 'parent', 'id', 'fk_child_parent')",
        params![id],
    )
    .expect("seed schema_index_fk_edges");

    conn.execute(
        "INSERT INTO schema_index_segment_df (connection_id, segment, doc_count)
         VALUES (?1, 'users', 3)",
        params![id],
    )
    .expect("seed schema_index_segment_df");

    conn.execute(
        "INSERT INTO query_history
            (connection_id, database_name, sql_text, timestamp, success)
         VALUES (?1, 'mydb', 'SELECT 1', '2026-01-01T00:00:00Z', 1)",
        params![id],
    )
    .expect("seed query_history");

    conn.execute(
        "INSERT INTO favorites (name, sql_text, connection_id, created_at, updated_at)
         VALUES ('fav', 'SELECT 1', ?1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        params![id],
    )
    .expect("seed favorites");
}

/// Count the rows in `table` whose `connection_id` matches `id`.
fn child_row_count(conn: &Connection, table: &str, id: &str) -> i64 {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM {table} WHERE connection_id = ?1"),
        params![id],
        |row| row.get(0),
    )
    .unwrap_or_else(|e| panic!("count {table}: {e}"))
}

/// All eight cascade-managed table names.
const CASCADE_TABLES: &[&str] = &[
    "schema_cache_snapshots",
    "schema_index_meta",
    "schema_index_chunks",
    "schema_index_table_signatures",
    "schema_index_fk_edges",
    "schema_index_segment_df",
    "query_history",
    "favorites",
];

/// Whether a table with `name` currently exists in the schema.
fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table','virtual') AND name = ?1",
        params![name],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
    .unwrap_or(false)
}

#[test]
fn test_delete_connection_cascades_all_eight_tables() {
    init_sqlite_vec();
    let state = common::test_app_state_fk_enabled();
    let id = {
        let conn = state.db.lock().unwrap();
        let id = seed_connection(&conn, "Cascade DB");
        seed_all_child_rows(&conn, &id);
        // Sanity: every child table has the seeded row before deletion.
        for table in CASCADE_TABLES {
            assert_eq!(child_row_count(&conn, table, &id), 1, "{table} pre-delete");
        }
        id
    };

    delete_connection_impl(&state, &id).expect("delete should succeed");

    let conn = state.db.lock().unwrap();
    for table in CASCADE_TABLES {
        assert_eq!(
            child_row_count(&conn, table, &id),
            0,
            "{table} should be cascade-deleted"
        );
    }
    assert!(
        connections::get_connection(&conn, &id)
            .expect("get")
            .is_none(),
        "connection row should be gone"
    );
}

#[test]
fn test_cascade_requires_fk_enforcement() {
    // Same scenario against an FK-OFF connection: deleting the parent row must
    // NOT remove child rows, proving the cascade is observable only with the
    // FK-enabled helper.
    let conn = common::test_db();
    let id = seed_connection(&conn, "No-Cascade DB");
    seed_all_child_rows(&conn, &id);

    connections::delete_connection(&conn, &id).expect("delete parent row");

    for table in CASCADE_TABLES {
        assert_eq!(
            child_row_count(&conn, table, &id),
            1,
            "{table} should survive when FK enforcement is OFF"
        );
    }
}

#[test]
fn test_delete_connection_drops_both_vector_tables() {
    init_sqlite_vec();
    let state = common::test_app_state_fk_enabled();
    let id = {
        let conn = state.db.lock().unwrap();
        let id = seed_connection(&conn, "Vector DB");
        // Create both dynamically-named vec0 virtual tables for this connection.
        schema_index::storage::create_vec_table(&conn, &id, 8)
            .expect("create schema-index vec table");
        ai_memory::storage::ensure_vec_table(&conn, &id, 8).expect("create ai-memory vec table");

        let schema_vec = schema_index::storage::vec_table_name(&id);
        let memory_vec = ai_memory::storage::vec_table_name(&id);
        assert!(table_exists(&conn, &schema_vec), "schema vec table created");
        assert!(table_exists(&conn, &memory_vec), "memory vec table created");
        id
    };

    delete_connection_impl(&state, &id).expect("delete should succeed");

    let conn = state.db.lock().unwrap();
    let schema_vec = schema_index::storage::vec_table_name(&id);
    let memory_vec = ai_memory::storage::vec_table_name(&id);
    assert!(
        !table_exists(&conn, &schema_vec),
        "schema_index_vectors table should be dropped"
    );
    assert!(
        !table_exists(&conn, &memory_vec),
        "ai_memory_vectors table should be dropped"
    );
}

#[test]
fn test_global_favorites_survive_connection_deletion() {
    init_sqlite_vec();
    let state = common::test_app_state_fk_enabled();
    let id = {
        let conn = state.db.lock().unwrap();
        let id = seed_connection(&conn, "Fav DB");
        // A connection-scoped favorite (should cascade away) ...
        conn.execute(
            "INSERT INTO favorites (name, sql_text, connection_id, created_at, updated_at)
             VALUES ('scoped', 'SELECT 1', ?1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![id],
        )
        .expect("seed scoped favorite");
        // ... and a global favorite with NULL connection_id (should survive).
        conn.execute(
            "INSERT INTO favorites (name, sql_text, connection_id, created_at, updated_at)
             VALUES ('global', 'SELECT 2', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![],
        )
        .expect("seed global favorite");
        id
    };

    delete_connection_impl(&state, &id).expect("delete should succeed");

    let conn = state.db.lock().unwrap();
    let scoped: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM favorites WHERE name = 'scoped'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let global: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM favorites WHERE name = 'global' AND connection_id IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(scoped, 0, "scoped favorite should cascade away");
    assert_eq!(global, 1, "global (NULL) favorite should survive");
}

#[test]
fn test_delete_connection_is_atomic_on_failure() {
    // Force a mid-transaction failure: a child table with an FK to connections
    // declared WITHOUT cascade (NO ACTION/RESTRICT) holds a row, so the
    // `DELETE FROM connections` step inside delete_connection_impl is rejected
    // by foreign-key enforcement. The whole transaction must roll back, leaving
    // the connection and all of its cascade-managed data intact.
    init_sqlite_vec();
    let state = common::test_app_state_fk_enabled();
    let id = {
        let conn = state.db.lock().unwrap();
        let id = seed_connection(&conn, "Atomic DB");
        seed_all_child_rows(&conn, &id);

        // Create both dynamically-named vec0 virtual tables so the rollback of
        // their DROP TABLE during a failed deletion is verified below.
        schema_index::storage::create_vec_table(&conn, &id, 8)
            .expect("create schema-index vec table");
        ai_memory::storage::ensure_vec_table(&conn, &id, 8).expect("create ai-memory vec table");
        let schema_vec = schema_index::storage::vec_table_name(&id);
        let memory_vec = ai_memory::storage::vec_table_name(&id);
        assert!(table_exists(&conn, &schema_vec), "schema vec table created");
        assert!(table_exists(&conn, &memory_vec), "memory vec table created");

        conn.execute_batch(
            "CREATE TABLE blocking_child (
                id INTEGER PRIMARY KEY,
                connection_id TEXT NOT NULL,
                FOREIGN KEY(connection_id) REFERENCES connections(id)
            );",
        )
        .expect("create blocking child table");
        conn.execute(
            "INSERT INTO blocking_child (connection_id) VALUES (?1)",
            params![id],
        )
        .expect("seed blocking child row");
        id
    };

    let result = delete_connection_impl(&state, &id);
    assert!(
        result.is_err(),
        "deletion should fail due to the blocking FK row"
    );

    let conn = state.db.lock().unwrap();
    // The connection itself is intact ...
    assert!(
        connections::get_connection(&conn, &id)
            .expect("get")
            .is_some(),
        "connection should remain after rollback"
    );
    // ... and every cascade-managed child row was rolled back into place.
    for table in CASCADE_TABLES {
        assert_eq!(
            child_row_count(&conn, table, &id),
            1,
            "{table} should be intact after rollback"
        );
    }
    // ... and both vec0 virtual tables survive: their DROP TABLE was rolled back
    // atomically with the rest of the failed deletion.
    let schema_vec = schema_index::storage::vec_table_name(&id);
    let memory_vec = ai_memory::storage::vec_table_name(&id);
    assert!(
        table_exists(&conn, &schema_vec),
        "schema_index_vectors table should survive rollback"
    );
    assert!(
        table_exists(&conn, &memory_vec),
        "ai_memory_vectors table should survive rollback"
    );
}

#[test]
fn test_migration_013_purges_orphans_and_keeps_valid_and_global_rows() {
    // Build a database at the pre-013 state, insert valid rows, orphan rows
    // (connection_id not in connections), and a global favorite (NULL), then
    // apply migration 013 and assert the orphans are purged while valid and
    // global rows survive.
    init_sqlite_vec();
    let conn = Connection::open_in_memory().expect("open in-memory db");

    // Apply migrations through 012 only (pre-013) by seeding the tracking table
    // with 013 marked applied is the wrong direction; instead run the full set
    // (013 included) to create the tables, turn FK OFF so we can insert orphans
    // freely, seed data, drop the 013 bookkeeping row + recreate pre-013 table
    // shapes is unnecessary — migration 013 is idempotent only via the runner.
    //
    // Simplest correct approach: run migrations up to 012 by applying them
    // manually, seed orphans with FK off, then apply 013 alone and verify.
    run_migrations(&conn).expect("run all migrations");
    conn.execute_batch("PRAGMA foreign_keys = OFF;")
        .expect("disable fk for orphan seeding");

    // Valid connection + its valid child rows.
    let valid_id = seed_connection(&conn, "Valid DB");
    seed_all_child_rows(&conn, &valid_id);

    // Orphan rows whose connection_id has no matching connections row.
    let orphan_id = "orphan-connection-id";
    seed_all_child_rows(&conn, orphan_id);

    // Global favorite with NULL connection_id.
    conn.execute(
        "INSERT INTO favorites (name, sql_text, connection_id, created_at, updated_at)
         VALUES ('global', 'SELECT 9', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        [],
    )
    .expect("seed global favorite");

    // Re-running the 013 SQL directly purges orphans (the migration's
    // INSERT ... SELECT copies forward only connection_id IN connections, plus
    // NULL for favorites). We invoke the migration body again to exercise the
    // copy-forward purge over the seeded orphan data.
    let migration_013 = include_str!("../migrations/013_connection_cascade_cleanup.sql");
    conn.execute_batch(migration_013)
        .expect("re-apply migration 013 body");

    // Valid rows survive in every table.
    for table in CASCADE_TABLES {
        assert_eq!(
            child_row_count(&conn, table, &valid_id),
            1,
            "{table} valid row should survive purge"
        );
        assert_eq!(
            child_row_count(&conn, table, orphan_id),
            0,
            "{table} orphan row should be purged"
        );
    }

    // The global (NULL) favorite survives.
    let global: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM favorites WHERE name = 'global' AND connection_id IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(global, 1, "global favorite should survive purge");
}

#[test]
fn test_migration_013_retains_autoincrement_high_water_after_orphan_purge() {
    // Regression: the migration rebuilds AUTOINCREMENT tables via INSERT...SELECT
    // of only non-orphan rows. If the highest-id rows are orphans that get
    // purged, sqlite_sequence must NOT drop below the original high-water mark,
    // otherwise a future insert reuses an id that belonged to a deleted row.
    init_sqlite_vec();
    let conn = Connection::open_in_memory().expect("open in-memory db");
    run_migrations(&conn).expect("run all migrations");
    conn.execute_batch("PRAGMA foreign_keys = OFF;")
        .expect("disable fk for orphan seeding");

    // A valid connection keeps a low-id row that survives the purge.
    let valid_id = seed_connection(&conn, "Seq DB");
    let orphan_id = "orphan-seq-id";

    // query_history: id=1 valid (survives), id=2 orphan (purged, highest id).
    conn.execute(
        "INSERT INTO query_history (connection_id, database_name, sql_text, timestamp, success)
         VALUES (?1, 'mydb', 'SELECT 1', '2026-01-01T00:00:00Z', 1)",
        params![valid_id],
    )
    .expect("seed valid query_history");
    conn.execute(
        "INSERT INTO query_history (connection_id, database_name, sql_text, timestamp, success)
         VALUES (?1, 'mydb', 'SELECT 2', '2026-01-01T00:00:00Z', 1)",
        params![orphan_id],
    )
    .expect("seed orphan query_history");

    // schema_index_chunks: id=1 valid (survives), id=2 orphan (purged, highest).
    conn.execute(
        "INSERT INTO schema_index_chunks
            (connection_id, chunk_key, db_name, table_name, chunk_type, ddl_text, ddl_hash, model_id)
         VALUES (?1, 'k1', 'db', 't', 'table', 'CREATE TABLE t (id INT)', 'h1', 'model')",
        params![valid_id],
    )
    .expect("seed valid chunk");
    conn.execute(
        "INSERT INTO schema_index_chunks
            (connection_id, chunk_key, db_name, table_name, chunk_type, ddl_text, ddl_hash, model_id)
         VALUES (?1, 'k2', 'db', 't', 'table', 'CREATE TABLE t (id INT)', 'h2', 'model')",
        params![orphan_id],
    )
    .expect("seed orphan chunk");

    let original_qh_hwm: i64 = conn
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name = 'query_history'",
            [],
            |row| row.get(0),
        )
        .expect("query_history seq");
    let original_chunk_hwm: i64 = conn
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name = 'schema_index_chunks'",
            [],
            |row| row.get(0),
        )
        .expect("schema_index_chunks seq");
    assert_eq!(original_qh_hwm, 2, "query_history high-water before purge");
    assert_eq!(original_chunk_hwm, 2, "chunks high-water before purge");

    // Re-apply the migration body to purge the orphan (highest-id) rows.
    let migration_013 = include_str!("../migrations/013_connection_cascade_cleanup.sql");
    conn.execute_batch(migration_013)
        .expect("re-apply migration 013 body");

    // sqlite_sequence must still report the original high-water mark.
    let qh_seq: i64 = conn
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name = 'query_history'",
            [],
            |row| row.get(0),
        )
        .expect("query_history seq after purge");
    let chunk_seq: i64 = conn
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name = 'schema_index_chunks'",
            [],
            |row| row.get(0),
        )
        .expect("schema_index_chunks seq after purge");
    assert_eq!(qh_seq, 2, "query_history seq must retain original high-water");
    assert_eq!(chunk_seq, 2, "chunks seq must retain original high-water");

    // A subsequent insert must get an id GREATER than the original high-water,
    // proving the purged orphan id (2) is not reused.
    conn.execute(
        "INSERT INTO query_history (connection_id, database_name, sql_text, timestamp, success)
         VALUES (?1, 'mydb', 'SELECT 3', '2026-01-01T00:00:00Z', 1)",
        params![valid_id],
    )
    .expect("insert new query_history after purge");
    let new_qh_id = conn.last_insert_rowid();
    assert!(
        new_qh_id > original_qh_hwm,
        "new query_history id ({new_qh_id}) must exceed original high-water ({original_qh_hwm})"
    );

    conn.execute(
        "INSERT INTO schema_index_chunks
            (connection_id, chunk_key, db_name, table_name, chunk_type, ddl_text, ddl_hash, model_id)
         VALUES (?1, 'k3', 'db', 't', 'table', 'CREATE TABLE t (id INT)', 'h3', 'model')",
        params![valid_id],
    )
    .expect("insert new chunk after purge");
    let new_chunk_id = conn.last_insert_rowid();
    assert!(
        new_chunk_id > original_chunk_hwm,
        "new chunk id ({new_chunk_id}) must exceed original high-water ({original_chunk_hwm})"
    );
}
