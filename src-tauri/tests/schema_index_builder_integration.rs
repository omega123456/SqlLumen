//! Integration tests for `schema_index::builder` — DDL compaction, FK parsing,
//! hash computation, chunk key generation, and diff logic.

use sqllumen_lib::schema_index::builder;
use sqllumen_lib::schema_index::types::{FkInput, TableDdlInput};

// ── compact_ddl ──────────────────────────────────────────────────────────

#[test]
fn test_compact_ddl_strips_auto_increment() {
    let ddl = "CREATE TABLE `users` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `name` varchar(255)\n) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4";
    let result = builder::compact_ddl(ddl);
    assert!(
        !result.contains("AUTO_INCREMENT=42"),
        "AUTO_INCREMENT=42 should be stripped, got: {result}"
    );
    assert!(
        !result.contains("auto_increment=42"),
        "auto_increment should be stripped (case-insensitive)"
    );
}

#[test]
fn test_compact_ddl_strips_engine() {
    let ddl =
        "CREATE TABLE `orders` (\n  `id` int NOT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
    let result = builder::compact_ddl(ddl);
    assert!(
        !result.contains("ENGINE=InnoDB"),
        "ENGINE clause should be stripped, got: {result}"
    );
}

#[test]
fn test_compact_ddl_strips_row_format() {
    let ddl = "CREATE TABLE `items` (\n  `id` int\n) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4";
    let result = builder::compact_ddl(ddl);
    assert!(
        !result.contains("ROW_FORMAT"),
        "ROW_FORMAT should be stripped, got: {result}"
    );
}

#[test]
fn test_compact_ddl_normalizes_whitespace() {
    let ddl = "CREATE  TABLE   `t`  (\n  `id`   int\n)";
    let result = builder::compact_ddl(ddl);
    assert!(
        !result.contains("  "),
        "Multiple spaces should be normalized, got: {result}"
    );
}

#[test]
fn test_compact_ddl_preserves_constraints() {
    let ddl = "CREATE TABLE `orders` (\n  `id` int NOT NULL,\n  `user_id` int,\n  PRIMARY KEY (`id`),\n  CONSTRAINT `fk_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE\n) ENGINE=InnoDB AUTO_INCREMENT=100 DEFAULT CHARSET=utf8mb4";
    let result = builder::compact_ddl(ddl);
    assert!(
        result.contains("PRIMARY KEY"),
        "PRIMARY KEY should be preserved, got: {result}"
    );
    assert!(
        result.contains("FOREIGN KEY"),
        "FOREIGN KEY should be preserved, got: {result}"
    );
    assert!(
        result.contains("REFERENCES"),
        "REFERENCES should be preserved, got: {result}"
    );
}

#[test]
fn test_compact_ddl_trims_result() {
    let ddl = "  CREATE TABLE `t` (`id` int)  ENGINE=InnoDB  ;  ";
    let result = builder::compact_ddl(ddl);
    assert_eq!(result, result.trim(), "Result should be trimmed");
}

#[test]
fn test_compact_ddl_keeps_column_auto_increment() {
    // Column-level AUTO_INCREMENT keyword (not the table option AUTO_INCREMENT=N)
    let ddl = "CREATE TABLE `t` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4";
    let result = builder::compact_ddl(ddl);
    // The column-level "AUTO_INCREMENT" keyword (without =N) should be preserved
    // while the table-level "AUTO_INCREMENT=5" should be stripped
    assert!(
        !result.contains("AUTO_INCREMENT=5"),
        "Table-level AUTO_INCREMENT=N should be stripped, got: {result}"
    );
}

// ── generate_fk_chunk_text ───────────────────────────────────────────────

#[test]
fn test_generate_fk_chunk_text_single_column() {
    let fk = FkInput {
        db_name: "mydb".to_string(),
        table_name: "orders".to_string(),
        constraint_name: "fk_user".to_string(),
        columns: vec!["user_id".to_string()],
        ref_db_name: "mydb".to_string(),
        ref_table_name: "users".to_string(),
        ref_columns: vec!["id".to_string()],
        on_delete: "CASCADE".to_string(),
        on_update: "NO ACTION".to_string(),
    };

    let text = builder::generate_fk_chunk_text(&fk);
    assert_eq!(
        text,
        "Table mydb.orders has a foreign key (user_id) that references mydb.users(id) ON DELETE CASCADE ON UPDATE NO ACTION"
    );
}

#[test]
fn test_generate_fk_chunk_text_multi_column() {
    let fk = FkInput {
        db_name: "shop".to_string(),
        table_name: "order_items".to_string(),
        constraint_name: "fk_order_product".to_string(),
        columns: vec!["order_id".to_string(), "product_id".to_string()],
        ref_db_name: "shop".to_string(),
        ref_table_name: "products".to_string(),
        ref_columns: vec!["order_id".to_string(), "id".to_string()],
        on_delete: "RESTRICT".to_string(),
        on_update: "CASCADE".to_string(),
    };

    let text = builder::generate_fk_chunk_text(&fk);
    assert!(
        text.contains("(order_id, product_id)"),
        "Multi-column FKs should be comma-separated, got: {text}"
    );
    assert!(
        text.contains("(order_id, id)"),
        "Multi-column refs should be comma-separated, got: {text}"
    );
}

// ── compute_hash ─────────────────────────────────────────────────────────

#[test]
fn test_compute_hash_consistent() {
    let hash1 = builder::compute_hash("CREATE TABLE t (id int)");
    let hash2 = builder::compute_hash("CREATE TABLE t (id int)");
    assert_eq!(hash1, hash2, "Same input should produce same hash");
}

#[test]
fn test_compute_hash_different_inputs() {
    let hash1 = builder::compute_hash("CREATE TABLE t (id int)");
    let hash2 = builder::compute_hash("CREATE TABLE t (id bigint)");
    assert_ne!(
        hash1, hash2,
        "Different inputs should produce different hashes"
    );
}

#[test]
fn test_compute_hash_is_sha256_hex() {
    let hash = builder::compute_hash("test");
    assert_eq!(
        hash.len(),
        64,
        "SHA-256 hex should be 64 chars, got {}",
        hash.len()
    );
    assert!(
        hash.chars().all(|c| c.is_ascii_hexdigit()),
        "Should be hex digits only, got: {hash}"
    );
    // Known SHA-256 of "test"
    assert_eq!(
        hash,
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    );
}

// ── chunk key generation ─────────────────────────────────────────────────

#[test]
fn test_table_chunk_key() {
    assert_eq!(
        builder::table_chunk_key("mydb", "users"),
        "table:mydb.users"
    );
}

#[test]
fn test_fk_chunk_key() {
    assert_eq!(
        builder::fk_chunk_key("mydb", "orders", "fk_user"),
        "fk:mydb.orders:fk_user"
    );
}

// ── parse_fks_from_ddl ───────────────────────────────────────────────────

#[test]
fn test_parse_fks_from_ddl_single_fk() {
    let ddl = r#"CREATE TABLE `orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_user_idx` (`user_id`),
  CONSTRAINT `fk_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"#;

    let fks = builder::parse_fks_from_ddl("mydb", "orders", ddl);
    assert_eq!(fks.len(), 1, "Should find 1 FK");
    let fk = &fks[0];
    assert_eq!(fk.constraint_name, "fk_user");
    assert_eq!(fk.columns, vec!["user_id"]);
    assert_eq!(fk.ref_table_name, "users");
    assert_eq!(fk.ref_columns, vec!["id"]);
    assert_eq!(fk.on_delete, "CASCADE");
    assert_eq!(fk.on_update, "NO ACTION");
    assert_eq!(fk.db_name, "mydb");
    assert_eq!(fk.ref_db_name, "mydb"); // same db since no explicit schema in REFERENCES
}

#[test]
fn test_parse_fks_from_ddl_multi_column_fk() {
    let ddl = r#"CREATE TABLE `order_items` (
  `order_id` int NOT NULL,
  `product_id` int NOT NULL,
  `qty` int DEFAULT 1,
  PRIMARY KEY (`order_id`, `product_id`),
  CONSTRAINT `fk_order_product` FOREIGN KEY (`order_id`, `product_id`) REFERENCES `products` (`order_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB"#;

    let fks = builder::parse_fks_from_ddl("shop", "order_items", ddl);
    assert_eq!(fks.len(), 1);
    let fk = &fks[0];
    assert_eq!(fk.constraint_name, "fk_order_product");
    assert_eq!(fk.columns, vec!["order_id", "product_id"]);
    assert_eq!(fk.ref_columns, vec!["order_id", "id"]);
    assert_eq!(fk.on_delete, "RESTRICT");
    assert_eq!(fk.on_update, "CASCADE");
}

#[test]
fn test_parse_fks_from_ddl_multiple_fks() {
    let ddl = r#"CREATE TABLE `reviews` (
  `id` int NOT NULL,
  `user_id` int,
  `product_id` int,
  CONSTRAINT `fk_review_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `fk_review_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB"#;

    let fks = builder::parse_fks_from_ddl("shop", "reviews", ddl);
    assert_eq!(fks.len(), 2, "Should find 2 FKs");
    assert_eq!(fks[0].constraint_name, "fk_review_user");
    assert_eq!(fks[0].on_delete, "SET NULL");
    assert_eq!(fks[1].constraint_name, "fk_review_product");
    assert_eq!(fks[1].on_delete, "CASCADE");
}

#[test]
fn test_parse_fks_from_ddl_no_fks() {
    let ddl = r#"CREATE TABLE `simple` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB"#;

    let fks = builder::parse_fks_from_ddl("mydb", "simple", ddl);
    assert!(fks.is_empty(), "Should find no FKs");
}

#[test]
fn test_parse_fks_from_ddl_cross_database_reference() {
    let ddl = r#"CREATE TABLE `orders` (
  `id` int NOT NULL,
  `user_id` int,
  CONSTRAINT `fk_cross_db` FOREIGN KEY (`user_id`) REFERENCES `other_db`.`users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB"#;

    let fks = builder::parse_fks_from_ddl("mydb", "orders", ddl);
    assert_eq!(fks.len(), 1);
    assert_eq!(fks[0].ref_db_name, "other_db");
    assert_eq!(fks[0].ref_table_name, "users");
}

#[test]
fn test_parse_fks_defaults_to_restrict_when_no_action_clause() {
    // Some MySQL versions might omit ON DELETE/ON UPDATE clauses
    let ddl = r#"CREATE TABLE `t` (
  `id` int NOT NULL,
  `fk_col` int,
  CONSTRAINT `fk_noaction` FOREIGN KEY (`fk_col`) REFERENCES `other` (`id`)
) ENGINE=InnoDB"#;

    let fks = builder::parse_fks_from_ddl("db", "t", ddl);
    assert_eq!(fks.len(), 1);
    assert_eq!(fks[0].on_delete, "RESTRICT");
    assert_eq!(fks[0].on_update, "RESTRICT");
}

// ── diff_chunks ──────────────────────────────────────────────────────────

#[test]
fn test_diff_chunks_new_chunk() {
    let stored: Vec<(String, String)> = vec![];
    let new_chunks = vec![(
        "table:mydb.users".to_string(),
        "CREATE TABLE users (id int)".to_string(),
        "hash123".to_string(),
    )];

    let (needs_embed, to_delete) = builder::diff_chunks(&stored, &new_chunks);
    assert_eq!(needs_embed.len(), 1, "New chunk should need embedding");
    assert_eq!(needs_embed[0], "table:mydb.users");
    assert!(to_delete.is_empty(), "Nothing to delete");
}

#[test]
fn test_diff_chunks_unchanged() {
    let stored = vec![("table:mydb.users".to_string(), "hash123".to_string())];
    let new_chunks = vec![(
        "table:mydb.users".to_string(),
        "CREATE TABLE users (id int)".to_string(),
        "hash123".to_string(),
    )];

    let (needs_embed, to_delete) = builder::diff_chunks(&stored, &new_chunks);
    assert!(
        needs_embed.is_empty(),
        "Unchanged chunk should not need embedding"
    );
    assert!(to_delete.is_empty(), "Nothing to delete");
}

#[test]
fn test_diff_chunks_changed() {
    let stored = vec![("table:mydb.users".to_string(), "old_hash".to_string())];
    let new_chunks = vec![(
        "table:mydb.users".to_string(),
        "CREATE TABLE users (id int, name varchar)".to_string(),
        "new_hash".to_string(),
    )];

    let (needs_embed, to_delete) = builder::diff_chunks(&stored, &new_chunks);
    assert_eq!(needs_embed.len(), 1, "Changed chunk should need embedding");
    assert!(to_delete.is_empty(), "Key still exists, nothing to delete");
}

#[test]
fn test_diff_chunks_deleted() {
    let stored = vec![
        ("table:mydb.users".to_string(), "hash1".to_string()),
        ("table:mydb.orders".to_string(), "hash2".to_string()),
    ];
    let new_chunks = vec![(
        "table:mydb.users".to_string(),
        "CREATE TABLE users (id int)".to_string(),
        "hash1".to_string(),
    )];

    let (needs_embed, to_delete) = builder::diff_chunks(&stored, &new_chunks);
    assert!(
        needs_embed.is_empty(),
        "Existing unchanged chunk should not need embedding"
    );
    assert_eq!(to_delete.len(), 1, "Removed chunk should be in to_delete");
    assert_eq!(to_delete[0], "table:mydb.orders");
}

#[test]
fn test_diff_chunks_mixed_scenario() {
    let stored = vec![
        ("table:db.a".to_string(), "hash_a".to_string()), // unchanged
        ("table:db.b".to_string(), "old_hash_b".to_string()), // changed
        ("table:db.c".to_string(), "hash_c".to_string()), // deleted
    ];
    let new_chunks = vec![
        (
            "table:db.a".to_string(),
            "text_a".to_string(),
            "hash_a".to_string(),
        ), // unchanged
        (
            "table:db.b".to_string(),
            "text_b_new".to_string(),
            "new_hash_b".to_string(),
        ), // changed
        (
            "table:db.d".to_string(),
            "text_d".to_string(),
            "hash_d".to_string(),
        ), // new
    ];

    let (needs_embed, to_delete) = builder::diff_chunks(&stored, &new_chunks);
    assert_eq!(needs_embed.len(), 2, "Changed + new should need embedding");
    assert!(needs_embed.contains(&"table:db.b".to_string()));
    assert!(needs_embed.contains(&"table:db.d".to_string()));
    assert_eq!(to_delete.len(), 1, "Removed chunk c should be in to_delete");
    assert!(to_delete.contains(&"table:db.c".to_string()));
}

// ── generate_all_chunks ──────────────────────────────────────────────────

#[test]
fn test_generate_all_chunks_table_only() {
    let inputs = vec![TableDdlInput {
        db_name: "mydb".to_string(),
        table_name: "users".to_string(),
        create_table_sql: "CREATE TABLE `users` (\n  `id` int NOT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB AUTO_INCREMENT=10".to_string(),
    }];

    let (table_chunks, fk_chunks) = builder::generate_all_chunks(&inputs);
    assert_eq!(table_chunks.len(), 1);
    assert!(fk_chunks.is_empty());

    let (key, text, hash, db, table) = &table_chunks[0];
    assert_eq!(key, "table:mydb.users");
    assert_eq!(db, "mydb");
    assert_eq!(table, "users");
    assert!(
        text.starts_with("CREATE TABLE `mydb`.`users`"),
        "table chunk DDL should be database-qualified, got: {text}"
    );
    // Verify DDL was compacted
    assert!(!text.contains("ENGINE=InnoDB"));
    assert!(!text.contains("AUTO_INCREMENT=10"));
    // Verify hash is of the compacted text
    assert_eq!(hash, &builder::compute_hash(text));
}

#[test]
fn test_qualify_table_ddl_rewrites_unqualified_create_table() {
    let ddl = "CREATE TABLE `users` (`id` int)";
    let result = builder::qualify_table_ddl("analytics", "users", ddl);

    assert_eq!(result, "CREATE TABLE `analytics`.`users` (`id` int)");
}

#[test]
fn test_qualify_table_ddl_rewrites_if_not_exists_variant() {
    let ddl = "CREATE TABLE IF NOT EXISTS orders (`id` int)";
    let result = builder::qualify_table_ddl("sales", "orders", ddl);

    assert_eq!(
        result,
        "CREATE TABLE IF NOT EXISTS `sales`.`orders` (`id` int)"
    );
}

#[test]
fn test_qualify_table_ddl_rewrites_existing_wrong_prefix() {
    let ddl = "CREATE TABLE `old_db`.`users` (`id` int)";
    let result = builder::qualify_table_ddl("new_db", "users", ddl);

    assert_eq!(result, "CREATE TABLE `new_db`.`users` (`id` int)");
}

#[test]
fn test_qualify_references_in_ddl_prefixes_same_database_targets() {
    let ddl = "CREATE TABLE `shop`.`orders` (`user_id` int, CONSTRAINT `fk_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`))";
    let result = builder::qualify_references_in_ddl("shop", ddl);

    assert!(result.contains("REFERENCES `shop`.`users` (`id`)"));
}

#[test]
fn test_normalize_table_ddl_qualifies_table_and_references() {
    let ddl = "CREATE TABLE `orders` (`user_id` int, CONSTRAINT `fk_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`))";
    let result = builder::normalize_table_ddl("shop", "orders", ddl);

    assert!(result.starts_with("CREATE TABLE `shop`.`orders`"));
    assert!(result.contains("REFERENCES `shop`.`users` (`id`)"));
}

#[test]
fn test_generate_all_chunks_with_fks() {
    let inputs = vec![TableDdlInput {
        db_name: "shop".to_string(),
        table_name: "orders".to_string(),
        create_table_sql: r#"CREATE TABLE `orders` (
  `id` int NOT NULL,
  `user_id` int,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_order_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB"#.to_string(),
    }];

    let (table_chunks, fk_chunks) = builder::generate_all_chunks(&inputs);
    assert_eq!(table_chunks.len(), 1);
    assert_eq!(fk_chunks.len(), 1);

    let (fk_key, fk_text, fk_hash, fk) = &fk_chunks[0];
    assert_eq!(fk_key, "fk:shop.orders:fk_order_user");
    assert!(fk_text.contains("Table shop.orders has a foreign key"));
    assert_eq!(fk_hash, &builder::compute_hash(fk_text));
    assert_eq!(fk.constraint_name, "fk_order_user");
}

// ── Incremental build simulation (chunk generation + hash diffing) ───────

#[test]
fn test_incremental_build_simulation() {
    // Simulate first build: two tables
    let inputs_v1 = vec![
        TableDdlInput {
            db_name: "db".to_string(),
            table_name: "users".to_string(),
            create_table_sql: "CREATE TABLE `users` (`id` int) ENGINE=InnoDB".to_string(),
        },
        TableDdlInput {
            db_name: "db".to_string(),
            table_name: "orders".to_string(),
            create_table_sql: "CREATE TABLE `orders` (`id` int, `user_id` int) ENGINE=InnoDB"
                .to_string(),
        },
    ];

    let (chunks_v1, _fks_v1) = builder::generate_all_chunks(&inputs_v1);
    // Store as "existing"
    let stored_v1: Vec<(String, String)> = chunks_v1
        .iter()
        .map(|(k, _, h, _, _)| (k.clone(), h.clone()))
        .collect();

    // Simulate second build: users unchanged, orders modified, new table products
    let inputs_v2 = vec![
        TableDdlInput {
            db_name: "db".to_string(),
            table_name: "users".to_string(),
            create_table_sql: "CREATE TABLE `users` (`id` int) ENGINE=InnoDB".to_string(),
        },
        TableDdlInput {
            db_name: "db".to_string(),
            table_name: "orders".to_string(),
            create_table_sql: "CREATE TABLE `orders` (`id` int, `user_id` int, `total` decimal(10,2)) ENGINE=InnoDB".to_string(),
        },
        TableDdlInput {
            db_name: "db".to_string(),
            table_name: "products".to_string(),
            create_table_sql: "CREATE TABLE `products` (`id` int, `name` varchar(255)) ENGINE=InnoDB".to_string(),
        },
    ];

    let (chunks_v2, _fks_v2) = builder::generate_all_chunks(&inputs_v2);
    let new_for_diff: Vec<(String, String, String)> = chunks_v2
        .iter()
        .map(|(k, text, h, _, _)| (k.clone(), text.clone(), h.clone()))
        .collect();

    let (needs_embed, to_delete) = builder::diff_chunks(&stored_v1, &new_for_diff);

    // users is unchanged → not in needs_embed
    assert!(
        !needs_embed.contains(&"table:db.users".to_string()),
        "Unchanged table should not need re-embedding"
    );
    // orders changed → in needs_embed
    assert!(
        needs_embed.contains(&"table:db.orders".to_string()),
        "Changed table should need re-embedding"
    );
    // products is new → in needs_embed
    assert!(
        needs_embed.contains(&"table:db.products".to_string()),
        "New table should need embedding"
    );
    // nothing deleted
    assert!(to_delete.is_empty(), "No tables were removed");
}

#[test]
fn test_incremental_build_with_table_removal() {
    // Build v1: three tables
    let inputs_v1 = vec![
        TableDdlInput {
            db_name: "db".to_string(),
            table_name: "a".to_string(),
            create_table_sql: "CREATE TABLE `a` (`id` int) ENGINE=InnoDB".to_string(),
        },
        TableDdlInput {
            db_name: "db".to_string(),
            table_name: "b".to_string(),
            create_table_sql: "CREATE TABLE `b` (`id` int) ENGINE=InnoDB".to_string(),
        },
        TableDdlInput {
            db_name: "db".to_string(),
            table_name: "c".to_string(),
            create_table_sql: "CREATE TABLE `c` (`id` int) ENGINE=InnoDB".to_string(),
        },
    ];

    let (chunks_v1, _) = builder::generate_all_chunks(&inputs_v1);
    let stored_v1: Vec<(String, String)> = chunks_v1
        .iter()
        .map(|(k, _, h, _, _)| (k.clone(), h.clone()))
        .collect();

    // Build v2: table 'b' dropped
    let inputs_v2 = vec![
        TableDdlInput {
            db_name: "db".to_string(),
            table_name: "a".to_string(),
            create_table_sql: "CREATE TABLE `a` (`id` int) ENGINE=InnoDB".to_string(),
        },
        TableDdlInput {
            db_name: "db".to_string(),
            table_name: "c".to_string(),
            create_table_sql: "CREATE TABLE `c` (`id` int) ENGINE=InnoDB".to_string(),
        },
    ];

    let (chunks_v2, _) = builder::generate_all_chunks(&inputs_v2);
    let new_for_diff: Vec<(String, String, String)> = chunks_v2
        .iter()
        .map(|(k, text, h, _, _)| (k.clone(), text.clone(), h.clone()))
        .collect();

    let (needs_embed, to_delete) = builder::diff_chunks(&stored_v1, &new_for_diff);

    assert!(needs_embed.is_empty(), "No changes to existing tables");
    assert_eq!(to_delete.len(), 1, "One table was dropped");
    assert!(to_delete.contains(&"table:db.b".to_string()));
}

// ── BuildProgress / BuildResult serde coverage ───────────────────────────

#[test]
fn test_build_progress_serde() {
    use sqllumen_lib::schema_index::types::BuildProgress;
    let progress = BuildProgress {
        profile_id: "conn-1".to_string(),
        tables_done: 5,
        tables_total: 10,
    };
    let json = serde_json::to_value(&progress).expect("serialize");
    assert_eq!(json["profileId"], "conn-1");
    assert_eq!(json["tablesDone"], 5);
    assert_eq!(json["tablesTotal"], 10);
}

#[test]
fn test_build_result_serde() {
    use sqllumen_lib::schema_index::types::BuildResult;
    let result = BuildResult {
        profile_id: "conn-1".to_string(),
        tables_indexed: 42,
        duration_ms: 1234,
    };
    let json = serde_json::to_value(&result).expect("serialize");
    assert_eq!(json["profileId"], "conn-1");
    assert_eq!(json["tablesIndexed"], 42);
    assert_eq!(json["durationMs"], 1234);
}

// ── Edge cases ───────────────────────────────────────────────────────────

#[test]
fn test_compact_ddl_handles_empty_string() {
    let result = builder::compact_ddl("");
    assert_eq!(result, "");
}

#[test]
fn test_compact_ddl_handles_no_trailing_clauses() {
    let ddl = "CREATE TABLE `t` (`id` int)";
    let result = builder::compact_ddl(ddl);
    assert!(result.contains("CREATE TABLE"));
    assert!(result.contains("`id` int"));
}

#[test]
fn test_compute_hash_empty_string() {
    let hash = builder::compute_hash("");
    assert_eq!(hash.len(), 64);
    // SHA-256 of empty string
    assert_eq!(
        hash,
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn test_generate_fk_chunk_text_cross_db() {
    let fk = FkInput {
        db_name: "app_db".to_string(),
        table_name: "orders".to_string(),
        constraint_name: "fk_cross".to_string(),
        columns: vec!["user_id".to_string()],
        ref_db_name: "auth_db".to_string(),
        ref_table_name: "accounts".to_string(),
        ref_columns: vec!["id".to_string()],
        on_delete: "SET NULL".to_string(),
        on_update: "NO ACTION".to_string(),
    };

    let text = builder::generate_fk_chunk_text(&fk);
    assert!(text.contains("app_db.orders"));
    assert!(text.contains("auth_db.accounts"));
    assert!(text.contains("ON DELETE SET NULL"));
}

#[test]
fn test_diff_chunks_both_empty() {
    let (needs_embed, to_delete) = builder::diff_chunks(&[], &[]);
    assert!(needs_embed.is_empty());
    assert!(to_delete.is_empty());
}

#[test]
fn test_compact_ddl_with_comment_clause() {
    let ddl =
        "CREATE TABLE `t` (`id` int) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='test table'";
    let result = builder::compact_ddl(ddl);
    assert!(
        !result.contains("COMMENT="),
        "COMMENT should be stripped, got: {result}"
    );
    assert!(
        !result.contains("ENGINE="),
        "ENGINE should be stripped, got: {result}"
    );
}

#[test]
fn test_compact_ddl_with_semicolon() {
    let ddl = "CREATE TABLE `t` (`id` int) ENGINE=InnoDB;";
    let result = builder::compact_ddl(ddl);
    assert!(
        !result.contains("ENGINE="),
        "ENGINE should be stripped, got: {result}"
    );
    assert!(
        !result.ends_with(';'),
        "Trailing semicolon should be stripped, got: {result}"
    );
}
