//! Integration tests for chunk type variants and new ChunkInsert fields
//! (text_for_embedding, row_count_approx) and the FkEdge CRUD.

use rusqlite::Connection;
use sqllumen_lib::db::migrations::run_migrations;
use sqllumen_lib::init_sqlite_vec;
use sqllumen_lib::schema_index::storage;
use sqllumen_lib::schema_index::types::{ChunkInsert, ChunkType, FkEdge};

fn setup_db() -> Connection {
    init_sqlite_vec();
    let conn = Connection::open_in_memory().expect("open in-memory db");
    run_migrations(&conn).expect("run migrations");
    storage::create_vec_table(&conn, "conn-1", 4).expect("create vec table");
    conn
}

fn test_embedding() -> Vec<f32> {
    vec![0.1, 0.2, 0.3, 0.4]
}

// ── ChunkType variants ──────────────────────────────────────────────────

#[test]
fn chunk_type_view_roundtrip() {
    assert_eq!(ChunkType::View.as_str(), "view");
    assert_eq!(ChunkType::from_str("view"), Some(ChunkType::View));
}

#[test]
fn chunk_type_procedure_roundtrip() {
    assert_eq!(ChunkType::Procedure.as_str(), "procedure");
    assert_eq!(ChunkType::from_str("procedure"), Some(ChunkType::Procedure));
}

#[test]
fn chunk_type_function_roundtrip() {
    assert_eq!(ChunkType::Function.as_str(), "function");
    assert_eq!(ChunkType::from_str("function"), Some(ChunkType::Function));
}

// ── text_for_embedding / row_count_approx ───────────────────────────────

#[test]
fn chunk_insert_with_text_for_embedding_and_row_count() {
    let conn = setup_db();

    let chunk = ChunkInsert {
        connection_id: "conn-1".to_string(),
        chunk_key: "table:mydb.users".to_string(),
        db_name: "mydb".to_string(),
        table_name: "users".to_string(),
        chunk_type: ChunkType::Table,
        ddl_text: "CREATE TABLE users (id INT)".to_string(),
        ddl_hash: "h1".to_string(),
        model_id: "m1".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding: test_embedding(),
        text_for_embedding: Some(
            "Table users in database mydb. Columns: id (INT, PK).".to_string(),
        ),
        row_count_approx: Some(42_000),
    };
    storage::insert_chunk(&conn, &chunk).expect("insert");

    let meta = storage::get_chunk_by_key(&conn, "conn-1", "table:mydb.users")
        .expect("get")
        .expect("should exist");
    assert_eq!(
        meta.text_for_embedding.as_deref(),
        Some("Table users in database mydb. Columns: id (INT, PK).")
    );
    assert_eq!(meta.row_count_approx, Some(42_000));
}

#[test]
fn chunk_insert_without_text_for_embedding() {
    let conn = setup_db();

    let chunk = ChunkInsert {
        connection_id: "conn-1".to_string(),
        chunk_key: "table:mydb.orders".to_string(),
        db_name: "mydb".to_string(),
        table_name: "orders".to_string(),
        chunk_type: ChunkType::Table,
        ddl_text: "CREATE TABLE orders (id INT)".to_string(),
        ddl_hash: "h2".to_string(),
        model_id: "m1".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding: test_embedding(),
        text_for_embedding: None,
        row_count_approx: None,
    };
    storage::insert_chunk(&conn, &chunk).expect("insert");

    let meta = storage::get_chunk_by_key(&conn, "conn-1", "table:mydb.orders")
        .expect("get")
        .expect("should exist");
    assert!(meta.text_for_embedding.is_none());
    assert!(meta.row_count_approx.is_none());
}

// ── View/Procedure/Function chunks ──────────────────────────────────────

#[test]
fn insert_view_chunk() {
    let conn = setup_db();
    let chunk = ChunkInsert {
        connection_id: "conn-1".to_string(),
        chunk_key: "view:mydb.active_users".to_string(),
        db_name: "mydb".to_string(),
        table_name: "active_users".to_string(),
        chunk_type: ChunkType::View,
        ddl_text: "CREATE VIEW active_users AS SELECT * FROM users WHERE active = 1".to_string(),
        ddl_hash: "vh1".to_string(),
        model_id: "m1".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding: test_embedding(),
        text_for_embedding: Some("View active_users: shows active users.".to_string()),
        row_count_approx: None,
    };
    storage::insert_chunk(&conn, &chunk).expect("insert view");

    let meta = storage::get_chunk_by_key(&conn, "conn-1", "view:mydb.active_users")
        .expect("get")
        .expect("should exist");
    assert_eq!(meta.chunk_type, ChunkType::View);
}

#[test]
fn insert_procedure_chunk() {
    let conn = setup_db();
    let chunk = ChunkInsert {
        connection_id: "conn-1".to_string(),
        chunk_key: "procedure:mydb.process_orders".to_string(),
        db_name: "mydb".to_string(),
        table_name: "process_orders".to_string(),
        chunk_type: ChunkType::Procedure,
        ddl_text: "CREATE PROCEDURE process_orders() BEGIN END".to_string(),
        ddl_hash: "ph1".to_string(),
        model_id: "m1".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding: test_embedding(),
        text_for_embedding: None,
        row_count_approx: None,
    };
    storage::insert_chunk(&conn, &chunk).expect("insert procedure");

    let meta = storage::get_chunk_by_key(&conn, "conn-1", "procedure:mydb.process_orders")
        .expect("get")
        .expect("should exist");
    assert_eq!(meta.chunk_type, ChunkType::Procedure);
}

#[test]
fn insert_function_chunk() {
    let conn = setup_db();
    let chunk = ChunkInsert {
        connection_id: "conn-1".to_string(),
        chunk_key: "function:mydb.calc_tax".to_string(),
        db_name: "mydb".to_string(),
        table_name: "calc_tax".to_string(),
        chunk_type: ChunkType::Function,
        ddl_text: "CREATE FUNCTION calc_tax() RETURNS DECIMAL BEGIN RETURN 0; END".to_string(),
        ddl_hash: "fh1".to_string(),
        model_id: "m1".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding: test_embedding(),
        text_for_embedding: None,
        row_count_approx: None,
    };
    storage::insert_chunk(&conn, &chunk).expect("insert function");

    let meta = storage::get_chunk_by_key(&conn, "conn-1", "function:mydb.calc_tax")
        .expect("get")
        .expect("should exist");
    assert_eq!(meta.chunk_type, ChunkType::Function);
}

// ── FK edge CRUD ────────────────────────────────────────────────────────

#[test]
fn fk_edges_replace_and_get() {
    let conn = setup_db();

    let edges = vec![
        FkEdge {
            connection_id: "conn-1".to_string(),
            src_db: "mydb".to_string(),
            src_tbl: "orders".to_string(),
            src_col: "user_id".to_string(),
            dst_db: "mydb".to_string(),
            dst_tbl: "users".to_string(),
            dst_col: "id".to_string(),
            constraint_name: "fk_user_id".to_string(),
            on_delete: Some("CASCADE".to_string()),
            on_update: Some("RESTRICT".to_string()),
        },
        FkEdge {
            connection_id: "conn-1".to_string(),
            src_db: "mydb".to_string(),
            src_tbl: "orders".to_string(),
            src_col: "product_id".to_string(),
            dst_db: "mydb".to_string(),
            dst_tbl: "products".to_string(),
            dst_col: "id".to_string(),
            constraint_name: "fk_product_id".to_string(),
            on_delete: None,
            on_update: None,
        },
    ];

    storage::replace_fk_edges_for_table(&conn, "conn-1", "mydb", "orders", &edges)
        .expect("replace edges");

    let all = storage::get_fk_edges_for_connection(&conn, "conn-1").expect("get edges");
    assert_eq!(all.len(), 2);
    assert!(all.iter().any(|e| e.constraint_name == "fk_user_id"));
    assert!(all.iter().any(|e| e.constraint_name == "fk_product_id"));
}

#[test]
fn fk_edges_replace_overwrites_existing() {
    let conn = setup_db();

    let edges_v1 = vec![FkEdge {
        connection_id: "conn-1".to_string(),
        src_db: "db".to_string(),
        src_tbl: "t".to_string(),
        src_col: "a".to_string(),
        dst_db: "db".to_string(),
        dst_tbl: "u".to_string(),
        dst_col: "id".to_string(),
        constraint_name: "fk1".to_string(),
        on_delete: None,
        on_update: None,
    }];
    storage::replace_fk_edges_for_table(&conn, "conn-1", "db", "t", &edges_v1).expect("v1");

    let edges_v2 = vec![FkEdge {
        connection_id: "conn-1".to_string(),
        src_db: "db".to_string(),
        src_tbl: "t".to_string(),
        src_col: "b".to_string(),
        dst_db: "db".to_string(),
        dst_tbl: "v".to_string(),
        dst_col: "id".to_string(),
        constraint_name: "fk2".to_string(),
        on_delete: None,
        on_update: None,
    }];
    storage::replace_fk_edges_for_table(&conn, "conn-1", "db", "t", &edges_v2).expect("v2");

    let all = storage::get_fk_edges_for_connection(&conn, "conn-1").expect("get");
    assert_eq!(all.len(), 1, "old edges should be replaced");
    assert_eq!(all[0].constraint_name, "fk2");
}

#[test]
fn delete_fk_edges_for_connection() {
    let conn = setup_db();

    let edges = vec![FkEdge {
        connection_id: "conn-1".to_string(),
        src_db: "db".to_string(),
        src_tbl: "t".to_string(),
        src_col: "a".to_string(),
        dst_db: "db".to_string(),
        dst_tbl: "u".to_string(),
        dst_col: "id".to_string(),
        constraint_name: "fk1".to_string(),
        on_delete: None,
        on_update: None,
    }];
    storage::replace_fk_edges_for_table(&conn, "conn-1", "db", "t", &edges).expect("insert");

    storage::delete_fk_edges_for_connection(&conn, "conn-1").expect("delete");

    let remaining = storage::get_fk_edges_for_connection(&conn, "conn-1").expect("get");
    assert!(remaining.is_empty());
}

#[test]
fn delete_all_chunks_also_wipes_fk_edges() {
    let conn = setup_db();

    // Insert a chunk and FK edges
    let chunk = ChunkInsert {
        connection_id: "conn-1".to_string(),
        chunk_key: "table:db.t".to_string(),
        db_name: "db".to_string(),
        table_name: "t".to_string(),
        chunk_type: ChunkType::Table,
        ddl_text: "CREATE TABLE t (id INT)".to_string(),
        ddl_hash: "h".to_string(),
        model_id: "m".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding: test_embedding(),
        text_for_embedding: None,
        row_count_approx: None,
    };
    storage::insert_chunk(&conn, &chunk).expect("insert chunk");

    let edges = vec![FkEdge {
        connection_id: "conn-1".to_string(),
        src_db: "db".to_string(),
        src_tbl: "t".to_string(),
        src_col: "a".to_string(),
        dst_db: "db".to_string(),
        dst_tbl: "u".to_string(),
        dst_col: "id".to_string(),
        constraint_name: "fk1".to_string(),
        on_delete: None,
        on_update: None,
    }];
    storage::replace_fk_edges_for_table(&conn, "conn-1", "db", "t", &edges).expect("insert edges");

    storage::delete_all_chunks(&conn, "conn-1").expect("wipe");

    let chunks = storage::list_chunks(&conn, "conn-1").expect("list");
    assert!(chunks.is_empty());
    let remaining_edges = storage::get_fk_edges_for_connection(&conn, "conn-1").expect("get edges");
    assert!(remaining_edges.is_empty(), "FK edges should also be wiped");
}

// ── vec_schema_version bump ─────────────────────────────────────────────

#[test]
fn vec_schema_version_is_2() {
    assert_eq!(storage::VEC_SCHEMA_VERSION, 2);
}

// ── compact_ddl_for_llm ─────────────────────────────────────────────────

use sqllumen_lib::schema_index::builder::{
    compact_ddl_for_llm, extract_column_comments, extract_table_comment,
    generate_text_for_embedding,
};

#[test]
fn compact_ddl_for_llm_strips_engine_but_keeps_comments() {
    let ddl = "CREATE TABLE `t` (\n  `id` INT COMMENT 'primary id'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='user table';";
    let result = compact_ddl_for_llm(ddl);
    assert!(!result.contains("ENGINE"));
    assert!(!result.contains("CHARSET"));
    assert!(!result.contains("COLLATE"));
    assert!(result.contains("COMMENT"));
    assert!(result.contains("primary id"));
    assert!(result.contains("user table"));
}

#[test]
fn compact_ddl_for_llm_strips_auto_increment() {
    let ddl = "CREATE TABLE `t` (`id` INT) AUTO_INCREMENT=100 ENGINE=InnoDB;";
    let result = compact_ddl_for_llm(ddl);
    assert!(!result.contains("AUTO_INCREMENT"));
    assert!(!result.contains("ENGINE"));
}

#[test]
fn compact_ddl_for_llm_strips_row_format() {
    let ddl = "CREATE TABLE `t` (`id` INT) ROW_FORMAT=DYNAMIC ENGINE=InnoDB;";
    let result = compact_ddl_for_llm(ddl);
    assert!(!result.contains("ROW_FORMAT"));
}

// ── extract_table_comment ───────────────────────────────────────────────

#[test]
fn extract_table_comment_finds_comment() {
    let ddl = "CREATE TABLE `users` (`id` INT) ENGINE=InnoDB COMMENT='Stores registered users';";
    let comment = extract_table_comment(ddl);
    assert_eq!(comment.as_deref(), Some("Stores registered users"));
}

#[test]
fn extract_table_comment_returns_none_without_comment() {
    let ddl = "CREATE TABLE `users` (`id` INT) ENGINE=InnoDB;";
    assert!(extract_table_comment(ddl).is_none());
}

#[test]
fn extract_table_comment_handles_escaped_quotes() {
    let ddl = r"CREATE TABLE `t` (`id` INT) COMMENT='It\'s a table';";
    let comment = extract_table_comment(ddl);
    assert_eq!(comment.as_deref(), Some(r"It\'s a table"));
}

// ── extract_column_comments ─────────────────────────────────────────────

#[test]
fn extract_column_comments_finds_all() {
    let ddl = "CREATE TABLE `t` (\n  `id` INT COMMENT 'primary key',\n  `name` VARCHAR(100) NOT NULL COMMENT 'user name',\n  `age` INT\n);";
    let cols = extract_column_comments(ddl);
    assert_eq!(cols.len(), 2);
    assert_eq!(cols[0], ("id".to_string(), "primary key".to_string()));
    assert_eq!(cols[1], ("name".to_string(), "user name".to_string()));
}

#[test]
fn extract_column_comments_returns_empty_without_comments() {
    let ddl = "CREATE TABLE `t` (`id` INT, `name` VARCHAR(100));";
    let cols = extract_column_comments(ddl);
    assert!(cols.is_empty());
}

// ── generate_text_for_embedding ─────────────────────────────────────────

#[test]
fn generate_text_for_embedding_with_comment_and_fks() {
    let fks = vec![FkEdge {
        connection_id: "c".to_string(),
        src_db: "db".to_string(),
        src_tbl: "orders".to_string(),
        src_col: "user_id".to_string(),
        dst_db: "db".to_string(),
        dst_tbl: "users".to_string(),
        dst_col: "id".to_string(),
        constraint_name: "fk_user".to_string(),
        on_delete: Some("CASCADE".to_string()),
        on_update: Some("RESTRICT".to_string()),
    }];
    let text = generate_text_for_embedding(
        "db",
        "orders",
        Some("Customer orders"),
        &[
            ("id".to_string(), "INT".to_string(), None),
            (
                "user_id".to_string(),
                "INT".to_string(),
                Some("FK to users".to_string()),
            ),
        ],
        &["id".to_string()],
        &["email".to_string()],
        &fks,
        Some(1234),
    );
    assert!(text.contains("Table `db`.`orders` — Customer orders."));
    assert!(text.contains("Columns: id (INT), user_id (INT, \"FK to users\")."));
    assert!(text.contains("Primary key: id."));
    assert!(text.contains("Unique indexes: email."));
    assert!(text.contains("user_id references `db`.`users`(id)"));
    assert!(text.contains("[ON DELETE CASCADE]"));
    assert!(text.contains("Approximate rows: 1234."));
}

#[test]
fn generate_text_for_embedding_without_comment_uses_default() {
    let text = generate_text_for_embedding(
        "mydb",
        "items",
        None,
        &[("id".to_string(), "INT".to_string(), None)],
        &[],
        &[],
        &[],
        None,
    );
    assert!(text.contains("Table `mydb`.`items` — stores items data."));
    assert!(!text.contains("Primary key"));
    assert!(!text.contains("Approximate rows"));
}

// ── replace_fk_edges_for_connection ─────────────────────────────────────

#[test]
fn replace_fk_edges_for_connection_replaces_all() {
    let conn = setup_db();

    // Insert edges for two different tables
    let edges1 = vec![FkEdge {
        connection_id: "conn-1".to_string(),
        src_db: "db".to_string(),
        src_tbl: "a".to_string(),
        src_col: "x".to_string(),
        dst_db: "db".to_string(),
        dst_tbl: "b".to_string(),
        dst_col: "id".to_string(),
        constraint_name: "fk1".to_string(),
        on_delete: None,
        on_update: None,
    }];
    storage::replace_fk_edges_for_table(&conn, "conn-1", "db", "a", &edges1).expect("insert 1");

    let edges2 = vec![FkEdge {
        connection_id: "conn-1".to_string(),
        src_db: "db".to_string(),
        src_tbl: "c".to_string(),
        src_col: "y".to_string(),
        dst_db: "db".to_string(),
        dst_tbl: "d".to_string(),
        dst_col: "id".to_string(),
        constraint_name: "fk2".to_string(),
        on_delete: None,
        on_update: None,
    }];
    storage::replace_fk_edges_for_table(&conn, "conn-1", "db", "c", &edges2).expect("insert 2");

    // Now replace all edges for the connection at once
    let new_edges = vec![FkEdge {
        connection_id: "conn-1".to_string(),
        src_db: "db".to_string(),
        src_tbl: "e".to_string(),
        src_col: "z".to_string(),
        dst_db: "db".to_string(),
        dst_tbl: "f".to_string(),
        dst_col: "id".to_string(),
        constraint_name: "fk3".to_string(),
        on_delete: None,
        on_update: None,
    }];
    storage::replace_fk_edges_for_connection(&conn, "conn-1", &new_edges).expect("replace all");

    let all = storage::get_fk_edges_for_connection(&conn, "conn-1").expect("get");
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].constraint_name, "fk3");
}
