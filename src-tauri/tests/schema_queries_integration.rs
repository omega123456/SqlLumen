mod common;

#[cfg(not(coverage))]
use common::mock_mysql_server::{MockCell, MockColumnDef, MockMySqlServer, MockQueryStep};
#[cfg(not(coverage))]
use opensrv_mysql::{ColumnFlags, ColumnType, ErrorKind};
use sqllumen_lib::mysql::schema_queries::safe_identifier;

#[cfg(not(coverage))]
use sqllumen_lib::mysql::schema_queries::{
    check_rename_safe, query_all_foreign_keys, query_all_indexes, query_database_details,
    query_foreign_keys, query_full_columns, query_indexes, query_list_charsets,
    query_list_collations, query_list_columns, query_list_databases, query_list_schema_objects,
    query_routine_exists, query_routine_parameters, query_routine_parameters_with_return_type,
    query_schema_info, query_table_metadata, validate_charset, validate_collation,
};

#[cfg(not(coverage))]
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

#[cfg(not(coverage))]
fn pool_for(port: u16) -> sqlx::MySqlPool {
    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(port)
        .username("root")
        .password("");
    MySqlPoolOptions::new().connect_lazy_with(opts)
}

#[cfg(not(coverage))]
fn text_col(name: &'static str) -> MockColumnDef {
    MockColumnDef {
        name,
        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
        colflags: ColumnFlags::empty(),
    }
}

#[cfg(not(coverage))]
fn int_col(name: &'static str) -> MockColumnDef {
    MockColumnDef {
        name,
        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
        colflags: ColumnFlags::empty(),
    }
}

#[test]
fn safe_identifier_rejects_empty_and_long_names() {
    assert!(safe_identifier("").is_err());
    assert!(safe_identifier(&"a".repeat(65)).is_err());
}

#[cfg(not(coverage))]
#[tokio::test]
async fn schema_queries_cover_success_and_error_paths() {
    let steps = vec![
        MockQueryStep {
            query: "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME",
            columns: vec![text_col("SCHEMA_NAME")],
            rows: vec![vec![MockCell::Bytes(b"analytics")], vec![MockCell::Bytes(b"app")]],
            error: None,
        },
        MockQueryStep {
            query: "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
            columns: vec![text_col("TABLE_NAME")],
            rows: vec![vec![MockCell::Bytes(b"orders")], vec![MockCell::Bytes(b"users")]],
            error: None,
        },
        MockQueryStep {
            query: "SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME",
            columns: vec![text_col("EVENT_NAME")],
            rows: vec![vec![MockCell::Bytes(b"nightly_cleanup")]],
            error: None,
        },
        MockQueryStep {
            query: "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
            columns: vec![text_col("COLUMN_NAME"), text_col("DATA_TYPE")],
            rows: vec![
                vec![MockCell::Bytes(b"id"), MockCell::Bytes(b"bigint")],
                vec![MockCell::Bytes(b"email"), MockCell::Bytes(b"varchar")],
            ],
            error: None,
        },
        MockQueryStep {
            query: "SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
            columns: vec![
                text_col("SCHEMA_NAME"),
                text_col("DEFAULT_CHARACTER_SET_NAME"),
                text_col("DEFAULT_COLLATION_NAME"),
            ],
            rows: vec![vec![
                MockCell::Bytes(b"app"),
                MockCell::Bytes(b"utf8mb4"),
                MockCell::Bytes(b"utf8mb4_general_ci"),
            ]],
            error: None,
        },
        MockQueryStep {
            query: "SHOW CHARACTER SET",
            columns: vec![
                text_col("Charset"),
                text_col("Description"),
                text_col("Default collation"),
                int_col("Maxlen"),
            ],
            rows: vec![
                vec![
                    MockCell::Bytes(b"utf8mb4"),
                    MockCell::Bytes(b"UTF-8 Unicode"),
                    MockCell::Bytes(b"utf8mb4_general_ci"),
                    MockCell::I64(4),
                ],
                vec![
                    MockCell::Bytes(b"latin1"),
                    MockCell::Bytes(b"cp1252 West European"),
                    MockCell::Bytes(b"latin1_swedish_ci"),
                    MockCell::I64(1),
                ],
            ],
            error: None,
        },
        MockQueryStep {
            query: "SHOW COLLATION",
            columns: vec![
                text_col("Collation"),
                text_col("Charset"),
                int_col("Id"),
                text_col("Default"),
            ],
            rows: vec![
                vec![
                    MockCell::Bytes(b"utf8mb4_general_ci"),
                    MockCell::Bytes(b"utf8mb4"),
                    MockCell::I64(45),
                    MockCell::Bytes(b"Yes"),
                ],
                vec![
                    MockCell::Bytes(b"latin1_swedish_ci"),
                    MockCell::Bytes(b"latin1"),
                    MockCell::I64(8),
                    MockCell::Bytes(b"Yes"),
                ],
            ],
            error: None,
        },
        MockQueryStep {
            query: "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, CAST(ORDINAL_POSITION AS SIGNED) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
            columns: vec![
                text_col("COLUMN_NAME"),
                text_col("DATA_TYPE"),
                text_col("IS_NULLABLE"),
                text_col("COLUMN_KEY"),
                text_col("COLUMN_DEFAULT"),
                text_col("EXTRA"),
                int_col("ORDINAL_POSITION"),
            ],
            rows: vec![
                vec![
                    MockCell::Bytes(b"id"),
                    MockCell::Bytes(b"bigint"),
                    MockCell::Bytes(b"NO"),
                    MockCell::Bytes(b"PRI"),
                    MockCell::Null,
                    MockCell::Bytes(b"auto_increment"),
                    MockCell::I64(1),
                ],
                vec![
                    MockCell::Bytes(b"email"),
                    MockCell::Bytes(b"varchar"),
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b""),
                    MockCell::Bytes(b"guest@example.com"),
                    MockCell::Bytes(b""),
                    MockCell::I64(2),
                ],
            ],
            error: None,
        },
        MockQueryStep {
            query: "SHOW INDEX FROM `app`.`users`",
            columns: vec![
                text_col("Table"),
                int_col("Non_unique"),
                text_col("Key_name"),
                int_col("Seq_in_index"),
                text_col("Column_name"),
                text_col("Collation"),
                int_col("Cardinality"),
                text_col("Sub_part"),
                text_col("Packed"),
                text_col("Null"),
                text_col("Index_type"),
                text_col("Comment"),
                text_col("Index_comment"),
                text_col("Visible"),
            ],
            rows: vec![
                vec![
                    MockCell::Bytes(b"users"),
                    MockCell::I64(0),
                    MockCell::Bytes(b"PRIMARY"),
                    MockCell::I64(1),
                    MockCell::Bytes(b"id"),
                    MockCell::Bytes(b"A"),
                    MockCell::I64(10),
                    MockCell::Null,
                    MockCell::Null,
                    MockCell::Bytes(b""),
                    MockCell::Bytes(b"BTREE"),
                    MockCell::Bytes(b""),
                    MockCell::Bytes(b""),
                    MockCell::Bytes(b"YES"),
                ],
                vec![
                    MockCell::Bytes(b"users"),
                    MockCell::I64(1),
                    MockCell::Bytes(b"idx_email"),
                    MockCell::I64(1),
                    MockCell::Bytes(b"email"),
                    MockCell::Bytes(b"A"),
                    MockCell::I64(8),
                    MockCell::Null,
                    MockCell::Null,
                    MockCell::Bytes(b"YES"),
                    MockCell::Bytes(b"BTREE"),
                    MockCell::Bytes(b""),
                    MockCell::Bytes(b""),
                    MockCell::Bytes(b"NO"),
                ],
            ],
            error: None,
        },
        MockQueryStep {
            query: "SELECT kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, rc.DELETE_RULE, rc.UPDATE_RULE FROM information_schema.KEY_COLUMN_USAGE kcu JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
            columns: vec![
                text_col("CONSTRAINT_NAME"),
                text_col("COLUMN_NAME"),
                text_col("REFERENCED_TABLE_SCHEMA"),
                text_col("REFERENCED_TABLE_NAME"),
                text_col("REFERENCED_COLUMN_NAME"),
                text_col("DELETE_RULE"),
                text_col("UPDATE_RULE"),
            ],
            rows: vec![vec![
                MockCell::Bytes(b"fk_users_org"),
                MockCell::Bytes(b"org_id"),
                MockCell::Bytes(b"app"),
                MockCell::Bytes(b"orgs"),
                MockCell::Bytes(b"id"),
                MockCell::Bytes(b"CASCADE"),
                MockCell::Bytes(b"RESTRICT"),
            ]],
            error: None,
        },
        MockQueryStep {
            query: "SELECT ENGINE, TABLE_COLLATION, CAST(AUTO_INCREMENT AS SIGNED), CAST(CREATE_TIME AS CHAR), CAST(TABLE_ROWS AS SIGNED), CAST(DATA_LENGTH AS SIGNED), CAST(INDEX_LENGTH AS SIGNED) FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
            columns: vec![
                text_col("ENGINE"),
                text_col("TABLE_COLLATION"),
                int_col("AUTO_INCREMENT"),
                text_col("CREATE_TIME"),
                int_col("TABLE_ROWS"),
                int_col("DATA_LENGTH"),
                int_col("INDEX_LENGTH"),
            ],
            rows: vec![vec![
                MockCell::Bytes(b"InnoDB"),
                MockCell::Bytes(b"utf8mb4_general_ci"),
                MockCell::I64(11),
                MockCell::Bytes(b"2025-01-01 00:00:00"),
                MockCell::I64(10),
                MockCell::I64(4096),
                MockCell::I64(2048),
            ]],
            error: None,
        },
        MockQueryStep {
            query: "SHOW CREATE TABLE `app`.`users`",
            columns: vec![text_col("Table"), text_col("Create Table")],
            rows: vec![vec![
                MockCell::Bytes(b"users"),
                MockCell::Bytes(b"CREATE TABLE `users` (`id` bigint unsigned NOT NULL)"),
            ]],
            error: None,
        },
        MockQueryStep {
            query: "SHOW CREATE PROCEDURE `app`.`sync_users`",
            columns: vec![text_col("Procedure"), text_col("sql_mode"), text_col("Create Procedure")],
            rows: vec![vec![
                MockCell::Bytes(b"sync_users"),
                MockCell::Bytes(b"STRICT_ALL_TABLES"),
                MockCell::Bytes(b"CREATE PROCEDURE `sync_users`() BEGIN SELECT 1; END"),
            ]],
            error: None,
        },
        MockQueryStep {
            query: "SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?",
            columns: vec![int_col("COUNT(*)")],
            rows: vec![vec![MockCell::I64(0)]],
            error: None,
        },
        MockQueryStep {
            query: "SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'",
            columns: vec![int_col("COUNT(*)")],
            rows: vec![vec![MockCell::I64(1)]],
            error: None,
        },
        MockQueryStep {
            query: "SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION'",
            columns: vec![int_col("COUNT(*)")],
            rows: vec![vec![MockCell::I64(0)]],
            error: None,
        },
        MockQueryStep {
            query: "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?",
            columns: vec![int_col("COUNT(*)")],
            rows: vec![vec![MockCell::I64(0)]],
            error: None,
        },
        MockQueryStep {
            query: "SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?",
            columns: vec![int_col("COUNT(*)")],
            rows: vec![vec![MockCell::I64(0)]],
            error: None,
        },
        MockQueryStep {
            query: "SELECT PARAMETER_NAME, DTD_IDENTIFIER, PARAMETER_MODE, CAST(ORDINAL_POSITION AS SIGNED) FROM INFORMATION_SCHEMA.PARAMETERS WHERE SPECIFIC_SCHEMA = ? AND SPECIFIC_NAME = ? AND ROUTINE_TYPE = ? AND ORDINAL_POSITION > 0 ORDER BY ORDINAL_POSITION",
            columns: vec![
                text_col("PARAMETER_NAME"),
                text_col("DTD_IDENTIFIER"),
                text_col("PARAMETER_MODE"),
                int_col("ORDINAL_POSITION"),
            ],
            rows: vec![vec![
                MockCell::Bytes(b"p_limit"),
                MockCell::Bytes(b"INT"),
                MockCell::Bytes(b"IN"),
                MockCell::I64(1),
            ]],
            error: None,
        },
        MockQueryStep {
            query: "SELECT PARAMETER_NAME, DTD_IDENTIFIER, PARAMETER_MODE, CAST(ORDINAL_POSITION AS SIGNED) FROM INFORMATION_SCHEMA.PARAMETERS WHERE SPECIFIC_SCHEMA = ? AND SPECIFIC_NAME = ? AND ROUTINE_TYPE = ? AND ORDINAL_POSITION >= 0 ORDER BY ORDINAL_POSITION",
            columns: vec![
                text_col("PARAMETER_NAME"),
                text_col("DTD_IDENTIFIER"),
                text_col("PARAMETER_MODE"),
                int_col("ORDINAL_POSITION"),
            ],
            rows: vec![
                vec![MockCell::Null, MockCell::Bytes(b"VARCHAR(255)"), MockCell::Null, MockCell::I64(0)],
                vec![
                    MockCell::Bytes(b"p_name"),
                    MockCell::Bytes(b"VARCHAR(255)"),
                    MockCell::Bytes(b"IN"),
                    MockCell::I64(1),
                ],
            ],
            error: None,
        },
        MockQueryStep {
            query: "SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ? AND ROUTINE_TYPE = ?",
            columns: vec![int_col("COUNT(*)")],
            rows: vec![vec![MockCell::I64(1)]],
            error: None,
        },
        MockQueryStep {
            query: "SELECT kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, rc.DELETE_RULE, rc.UPDATE_RULE FROM information_schema.KEY_COLUMN_USAGE kcu JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA WHERE kcu.TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
            columns: vec![
                text_col("TABLE_NAME"),
                text_col("CONSTRAINT_NAME"),
                text_col("COLUMN_NAME"),
                text_col("REFERENCED_TABLE_SCHEMA"),
                text_col("REFERENCED_TABLE_NAME"),
                text_col("REFERENCED_COLUMN_NAME"),
                text_col("DELETE_RULE"),
                text_col("UPDATE_RULE"),
            ],
            rows: vec![vec![
                MockCell::Bytes(b"users"),
                MockCell::Bytes(b"fk_users_org"),
                MockCell::Bytes(b"org_id"),
                MockCell::Bytes(b"app"),
                MockCell::Bytes(b"orgs"),
                MockCell::Bytes(b"id"),
                MockCell::Bytes(b"CASCADE"),
                MockCell::Bytes(b"RESTRICT"),
            ]],
            error: None,
        },
        MockQueryStep {
            query: "SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, INDEX_TYPE, COLUMN_NAME, CARDINALITY FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
            columns: vec![
                text_col("TABLE_NAME"),
                text_col("INDEX_NAME"),
                int_col("NON_UNIQUE"),
                text_col("INDEX_TYPE"),
                text_col("COLUMN_NAME"),
                int_col("CARDINALITY"),
            ],
            rows: vec![
                vec![
                    MockCell::Bytes(b"users"),
                    MockCell::Bytes(b"PRIMARY"),
                    MockCell::I64(0),
                    MockCell::Bytes(b"BTREE"),
                    MockCell::Bytes(b"id"),
                    MockCell::I64(10),
                ],
                vec![
                    MockCell::Bytes(b"users"),
                    MockCell::Bytes(b"idx_email"),
                    MockCell::I64(1),
                    MockCell::Bytes(b"BTREE"),
                    MockCell::Bytes(b"email"),
                    MockCell::I64(8),
                ],
            ],
            error: None,
        },
    ];

    let server = MockMySqlServer::start_script(steps).await;
    let pool = pool_for(server.port);

    let databases = query_list_databases(&pool).await.expect("list databases");
    assert_eq!(databases, vec!["analytics".to_string(), "app".to_string()]);

    let tables = query_list_schema_objects(&pool, "app", "table")
        .await
        .expect("list tables");
    assert_eq!(tables, vec!["orders".to_string(), "users".to_string()]);

    let events = query_list_schema_objects(&pool, "app", "event")
        .await
        .expect("list events");
    assert_eq!(events, vec!["nightly_cleanup".to_string()]);

    let columns = query_list_columns(&pool, "app", "users")
        .await
        .expect("columns");
    assert_eq!(columns.len(), 2);
    assert_eq!(columns[1].name, "email");

    let details = query_database_details(&pool, "app")
        .await
        .expect("database details");
    assert_eq!(details.default_character_set, "utf8mb4");

    let charsets = query_list_charsets(&pool).await.expect("charsets");
    assert_eq!(charsets[0].max_length, 4);

    let collations = query_list_collations(&pool).await.expect("collations");
    assert!(collations[0].is_default);

    let full_columns = query_full_columns(&pool, "app", "users")
        .await
        .expect("full columns");
    assert_eq!(
        full_columns[1].default_value.as_deref(),
        Some("guest@example.com")
    );

    let indexes = query_indexes(&pool, "app", "users").await.expect("indexes");
    assert_eq!(indexes.len(), 2);
    assert!(!indexes[1].is_visible);

    let fks = query_foreign_keys(&pool, "app", "users")
        .await
        .expect("foreign keys");
    assert_eq!(fks[0].referenced_table, "orgs");

    let metadata = query_table_metadata(&pool, "app", "users")
        .await
        .expect("metadata");
    assert_eq!(metadata.table_rows, 10);

    let schema_info = query_schema_info(&pool, "app", "users", "table")
        .await
        .expect("schema info table");
    assert_eq!(schema_info.columns.len(), 2);
    assert_eq!(schema_info.indexes.len(), 2);
    assert_eq!(schema_info.foreign_keys.len(), 1);
    assert!(schema_info.metadata.is_some());

    let proc_info = query_schema_info(&pool, "app", "sync_users", "procedure")
        .await
        .expect("schema info procedure");
    assert!(proc_info.columns.is_empty());
    assert!(proc_info.ddl.contains("CREATE PROCEDURE"));

    validate_charset(&pool, "utf8mb4")
        .await
        .expect("valid charset");
    validate_collation(&pool, "utf8mb4_general_ci", Some("utf8mb4"))
        .await
        .expect("valid collation");

    let rename_err = check_rename_safe(&pool, "app")
        .await
        .expect_err("procedures should block rename");
    assert!(rename_err.contains("1 procedure(s)"));

    let routine_params = query_routine_parameters(&pool, "app", "sync_users", "PROCEDURE")
        .await
        .expect("routine params");
    assert_eq!(routine_params[0].name, "p_limit");

    let routine_with_return =
        query_routine_parameters_with_return_type(&pool, "app", "fn_user_name", "FUNCTION")
            .await
            .expect("routine with return");
    assert_eq!(routine_with_return[0].ordinal_position, 0);

    let routine_exists = query_routine_exists(&pool, "app", "fn_user_name", "FUNCTION")
        .await
        .expect("routine exists");
    assert!(routine_exists);

    let all_fks = query_all_foreign_keys(&pool, "app").await.expect("all fks");
    assert_eq!(all_fks.get("users").map(Vec::len), Some(1));

    let all_indexes = query_all_indexes(&pool, "app").await.expect("all indexes");
    assert_eq!(all_indexes.get("users").map(Vec::len), Some(2));
}

#[cfg(not(coverage))]
#[tokio::test]
async fn schema_queries_cover_error_paths() {
    let server = MockMySqlServer::start_script(vec![MockQueryStep {
        query: "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME",
        columns: vec![text_col("SCHEMA_NAME")],
        rows: vec![],
        error: Some((ErrorKind::ER_WRONG_VALUE, b"boom")),
    }])
    .await;
    let pool = pool_for(server.port);

    let err = query_list_databases(&pool)
        .await
        .expect_err("query should fail");
    assert!(err.contains("Failed to list databases"));

    let unknown_object_err = query_list_schema_objects(&pool, "app", "unknown")
        .await
        .expect_err("unknown object type");
    assert!(unknown_object_err.contains("Unknown object type"));

    let invalid_charset = validate_charset(&pool, "utf16")
        .await
        .expect_err("invalid charset");
    assert!(invalid_charset.contains("Invalid character set"));

    let invalid_collation = validate_collation(&pool, "utf8mb4_bin", Some("latin1"))
        .await
        .expect_err("invalid collation");
    assert!(invalid_collation.contains("Invalid collation"));

    let invalid_schema_type = query_schema_info(&pool, "app", "users", "materialized_view")
        .await
        .expect_err("unknown type");
    assert!(invalid_schema_type.contains("Unknown object type"));
}
