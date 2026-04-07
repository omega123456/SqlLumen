//! Integration tests for the SQL dump export module.
//!
//! Tests cover the dump engine (header/footer, CREATE TABLE/VIEW formatting,
//! INSERT batching, value escaping) and the command-level progress tracking.

mod common;

use sqllumen_lib::export::sql_dump::{
    self, DumpOptions, SqlDumpValue, INSERT_BATCH_SIZE,
};
use sqllumen_lib::state::{DumpJobProgress, DumpJobStatus};

// ── Header/Footer generation ──────────────────────────────────────────────

#[test]
fn test_write_header_includes_database_and_version() {
    let mut buf = Vec::new();
    sql_dump::write_header(&mut buf, "test_db", "8.0.33")
        .expect("write_header should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("Database: test_db"));
    assert!(output.contains("Server version: 8.0.33"));
    assert!(output.contains("SET @OLD_CHARACTER_SET_CLIENT"));
    assert!(output.contains("SET NAMES utf8mb4"));
}

#[test]
fn test_write_footer_restores_settings() {
    let mut buf = Vec::new();
    sql_dump::write_footer(&mut buf)
        .expect("write_footer should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT"));
    assert!(output.contains("SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS"));
    assert!(output.contains("SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION"));
}

// ── Structure writing ─────────────────────────────────────────────────────

#[test]
fn test_write_structure_table_with_drop() {
    let mut buf = Vec::new();
    let create_sql = "CREATE TABLE `users` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `name` varchar(255) DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB";
    sql_dump::write_structure(&mut buf, "users", create_sql, true, false)
        .expect("write_structure should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("Table structure for `users`"));
    assert!(output.contains("DROP TABLE IF EXISTS `users`;"));
    assert!(output.contains("CREATE TABLE `users`"));
    assert!(output.contains("ENGINE=InnoDB;"));
}

#[test]
fn test_write_structure_view_with_drop() {
    let mut buf = Vec::new();
    let create_sql = "CREATE VIEW `user_stats` AS SELECT id, name FROM users";
    sql_dump::write_structure(&mut buf, "user_stats", create_sql, true, true)
        .expect("write_structure should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("View for `user_stats`"));
    assert!(output.contains("DROP VIEW IF EXISTS `user_stats`;"));
    assert!(output.contains("CREATE VIEW `user_stats`"));
}

#[test]
fn test_write_structure_without_drop() {
    let mut buf = Vec::new();
    let create_sql = "CREATE TABLE `orders` (\n  `id` int NOT NULL\n)";
    sql_dump::write_structure(&mut buf, "orders", create_sql, false, false)
        .expect("write_structure should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(!output.contains("DROP TABLE IF EXISTS"));
    assert!(output.contains("CREATE TABLE `orders`"));
}

#[test]
fn test_write_structure_strips_trailing_semicolon() {
    let mut buf = Vec::new();
    let create_sql = "CREATE TABLE `t` (`id` int);";
    sql_dump::write_structure(&mut buf, "t", create_sql, false, false)
        .expect("write_structure should succeed");
    let output = String::from_utf8(buf).unwrap();

    // Should have exactly one semicolon at the end, not double
    assert!(output.contains("(`id` int);"));
    assert!(!output.contains("(`id` int);;"));
}

// ── INSERT batching ───────────────────────────────────────────────────────

#[test]
fn test_write_data_inserts_basic() {
    let mut buf = Vec::new();
    let columns = vec!["id".to_string(), "name".to_string()];
    let rows = vec![
        vec![SqlDumpValue::Int(1), SqlDumpValue::QuotedString("Alice".to_string())],
        vec![SqlDumpValue::Int(2), SqlDumpValue::QuotedString("Bob".to_string())],
    ];

    let count = sql_dump::write_data_inserts(&mut buf, "users", &columns, &rows)
        .expect("write_data_inserts should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert_eq!(count, 2);
    assert!(output.contains("Data for `users`"));
    assert!(output.contains("LOCK TABLES `users` WRITE;"));
    assert!(output.contains("INSERT INTO `users` (`id`, `name`) VALUES"));
    assert!(output.contains("(1, 'Alice')"));
    assert!(output.contains("(2, 'Bob')"));
    assert!(output.contains("UNLOCK TABLES;"));
}

#[test]
fn test_write_data_inserts_multi_row_values() {
    let mut buf = Vec::new();
    let columns = vec!["id".to_string()];
    let rows = vec![
        vec![SqlDumpValue::Int(1)],
        vec![SqlDumpValue::Int(2)],
        vec![SqlDumpValue::Int(3)],
    ];

    sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows)
        .expect("write_data_inserts should succeed");
    let output = String::from_utf8(buf).unwrap();

    // Should use multi-row VALUES: VALUES\n(...),\n(...),\n(...);
    assert!(output.contains("VALUES\n(1),\n(2),\n(3);"));
}

#[test]
fn test_write_data_inserts_empty_rows() {
    let mut buf = Vec::new();
    let columns = vec!["id".to_string()];
    let rows: Vec<Vec<SqlDumpValue>> = vec![];

    let count = sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows)
        .expect("write_data_inserts should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert_eq!(count, 0);
    assert!(output.is_empty());
}

#[test]
fn test_write_data_inserts_empty_columns() {
    let mut buf = Vec::new();
    let columns: Vec<String> = vec![];
    let rows = vec![vec![SqlDumpValue::Int(1)]];

    let count = sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows)
        .expect("write_data_inserts should succeed");

    assert_eq!(count, 0);
}

#[test]
fn test_write_data_inserts_batching() {
    let mut buf = Vec::new();
    let columns = vec!["id".to_string()];

    // Create more than INSERT_BATCH_SIZE rows
    let row_count = INSERT_BATCH_SIZE + 5;
    let rows: Vec<Vec<SqlDumpValue>> = (0..row_count)
        .map(|i| vec![SqlDumpValue::Int(i as i64)])
        .collect();

    let count = sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows)
        .expect("write_data_inserts should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert_eq!(count, row_count as u64);
    // Should have 2 INSERT statements
    let insert_count = output.matches("INSERT INTO `t`").count();
    assert_eq!(insert_count, 2);
}

// ── Value escaping ────────────────────────────────────────────────────────

#[test]
fn test_write_data_inserts_null_values() {
    let mut buf = Vec::new();
    let columns = vec!["id".to_string(), "name".to_string()];
    let rows = vec![vec![SqlDumpValue::Int(1), SqlDumpValue::Null]];

    sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows)
        .expect("should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("(1, NULL)"));
}

#[test]
fn test_write_data_inserts_boolean_values() {
    let mut buf = Vec::new();
    let columns = vec!["flag".to_string()];
    let rows = vec![
        vec![SqlDumpValue::Bool(true)],
        vec![SqlDumpValue::Bool(false)],
    ];

    sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows)
        .expect("should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("(1)"));
    assert!(output.contains("(0)"));
}

#[test]
fn test_write_data_inserts_string_escaping() {
    let mut buf = Vec::new();
    let columns = vec!["val".to_string()];
    let rows = vec![
        vec![SqlDumpValue::QuotedString("it's a test".to_string())],
        vec![SqlDumpValue::QuotedString("C:\\Users\\test".to_string())],
    ];

    sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows)
        .expect("should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("'it''s a test'"));
    assert!(output.contains("'C:\\\\Users\\\\test'"));
}

#[test]
fn test_write_data_inserts_backtick_in_names() {
    let mut buf = Vec::new();
    let columns = vec!["col`name".to_string()];
    let rows = vec![vec![SqlDumpValue::Int(42)]];

    sql_dump::write_data_inserts(&mut buf, "table`name", &columns, &rows)
        .expect("should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("`table``name`"));
    assert!(output.contains("`col``name`"));
}

// ── Identifier/value escape functions ─────────────────────────────────────

#[test]
fn test_escape_identifier_basic() {
    assert_eq!(sql_dump::escape_identifier("users"), "users");
    assert_eq!(sql_dump::escape_identifier("foo`bar"), "foo``bar");
    assert_eq!(sql_dump::escape_identifier("a``b"), "a````b");
}

#[test]
fn test_escape_string_value_basic() {
    assert_eq!(sql_dump::escape_string_value("hello"), "hello");
    assert_eq!(sql_dump::escape_string_value("it's"), "it''s");
    assert_eq!(sql_dump::escape_string_value("a\\b"), "a\\\\b");
    assert_eq!(sql_dump::escape_string_value("a'\\b"), "a''\\\\b");
    // New: null bytes, newlines, carriage returns
    assert_eq!(sql_dump::escape_string_value("a\0b"), "a\\0b");
    assert_eq!(sql_dump::escape_string_value("line1\nline2"), "line1\\nline2");
    assert_eq!(sql_dump::escape_string_value("cr\rhere"), "cr\\rhere");
}

// ── Transaction wrappers ──────────────────────────────────────────────────

#[test]
fn test_transaction_wrappers() {
    let mut buf = Vec::new();
    sql_dump::write_transaction_start(&mut buf)
        .expect("should succeed");
    let start = String::from_utf8(buf).unwrap();
    assert!(start.contains("SET AUTOCOMMIT = 0;"));
    assert!(start.contains("SET FOREIGN_KEY_CHECKS = 0;"));

    let mut buf = Vec::new();
    sql_dump::write_transaction_end(&mut buf)
        .expect("should succeed");
    let end = String::from_utf8(buf).unwrap();
    assert!(end.contains("SET FOREIGN_KEY_CHECKS = 1;"));
    assert!(end.contains("COMMIT;"));
}

// ── DumpOptions defaults ──────────────────────────────────────────────────

#[test]
fn test_dump_options_default() {
    let opts = DumpOptions::default();
    assert!(opts.include_structure);
    assert!(opts.include_data);
    assert!(opts.include_drop);
    assert!(opts.use_transaction);
}

#[test]
fn test_dump_options_serde_round_trip() {
    let opts = DumpOptions {
        include_structure: true,
        include_data: false,
        include_drop: true,
        use_transaction: false,
    };
    let json = serde_json::to_value(&opts).expect("serialize");
    assert_eq!(json["includeStructure"], serde_json::json!(true));
    assert_eq!(json["includeData"], serde_json::json!(false));
    assert_eq!(json["includeDrop"], serde_json::json!(true));
    assert_eq!(json["useTransaction"], serde_json::json!(false));

    let round_trip: DumpOptions =
        serde_json::from_value(json).expect("deserialize");
    assert_eq!(round_trip.include_data, false);
    assert_eq!(round_trip.use_transaction, false);
}

// ── DumpJobProgress/DumpJobStatus ─────────────────────────────────────────

#[test]
fn test_dump_job_progress_serde() {
    let progress = DumpJobProgress {
        job_id: "abc-123".to_string(),
        status: DumpJobStatus::Running,
        tables_total: 10,
        tables_done: 3,
        current_table: Some("users".to_string()),
        bytes_written: 0,
        error_message: None,
        completed_at: None,
    };

    let json = serde_json::to_value(&progress).expect("serialize");
    assert_eq!(json["jobId"], serde_json::json!("abc-123"));
    assert_eq!(json["status"], serde_json::json!("running"));
    assert_eq!(json["tablesTotal"], serde_json::json!(10));
    assert_eq!(json["tablesDone"], serde_json::json!(3));
    assert_eq!(json["currentTable"], serde_json::json!("users"));
    assert_eq!(json["bytesWritten"], serde_json::json!(0));
    assert!(json["errorMessage"].is_null());
}

#[test]
fn test_dump_job_status_variants() {
    let running = DumpJobStatus::Running;
    let completed = DumpJobStatus::Completed;
    let failed = DumpJobStatus::Failed;

    assert_eq!(
        serde_json::to_string(&running).unwrap(),
        "\"running\""
    );
    assert_eq!(
        serde_json::to_string(&completed).unwrap(),
        "\"completed\""
    );
    assert_eq!(
        serde_json::to_string(&failed).unwrap(),
        "\"failed\""
    );

    assert_eq!(running, DumpJobStatus::Running);
    assert_ne!(running, DumpJobStatus::Failed);
}

// ── get_dump_progress_impl ────────────────────────────────────────────────

#[test]
fn test_get_dump_progress_not_found() {
    let state = common::test_app_state();
    let result = sqllumen_lib::commands::sql_dump::get_dump_progress_impl(&state, "nonexistent");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[test]
fn test_get_dump_progress_found() {
    let state = common::test_app_state();

    // Insert a progress entry
    {
        let mut jobs = state.dump_jobs.write().unwrap();
        jobs.insert(
            "job-1".to_string(),
            DumpJobProgress {
                job_id: "job-1".to_string(),
                status: DumpJobStatus::Completed,
                tables_total: 5,
                tables_done: 5,
                current_table: None,
                bytes_written: 1024,
                error_message: None,
                completed_at: None,
            },
        );
    }

    let progress = sqllumen_lib::commands::sql_dump::get_dump_progress_impl(&state, "job-1")
        .expect("should find progress");
    assert_eq!(progress.job_id, "job-1");
    assert_eq!(progress.status, DumpJobStatus::Completed);
    assert_eq!(progress.tables_done, 5);
    assert_eq!(progress.bytes_written, 1024);
}

// ── ExportableDatabase / ExportableTable serde ────────────────────────────

#[test]
fn test_exportable_database_serde() {
    let db = sqllumen_lib::commands::sql_dump::ExportableDatabase {
        name: "test_db".to_string(),
        tables: vec![
            sqllumen_lib::commands::sql_dump::ExportableTable {
                name: "users".to_string(),
                object_type: "table".to_string(),
                estimated_rows: 1000,
            },
            sqllumen_lib::commands::sql_dump::ExportableTable {
                name: "user_stats".to_string(),
                object_type: "view".to_string(),
                estimated_rows: 0,
            },
        ],
    };

    let json = serde_json::to_value(&db).expect("serialize");
    assert_eq!(json["name"], serde_json::json!("test_db"));
    let tables = json["tables"].as_array().unwrap();
    assert_eq!(tables.len(), 2);
    assert_eq!(tables[0]["name"], serde_json::json!("users"));
    assert_eq!(tables[0]["objectType"], serde_json::json!("table"));
    assert_eq!(tables[0]["estimatedRows"], serde_json::json!(1000));
    assert_eq!(tables[1]["objectType"], serde_json::json!("view"));
}

// ── StartDumpInput serde ──────────────────────────────────────────────────

#[test]
fn test_start_dump_input_serde() {
    let input_json = serde_json::json!({
        "connectionId": "conn-1",
        "filePath": "/tmp/dump.sql",
        "databases": ["db1"],
        "tables": {
            "db1": ["users", "orders"]
        },
        "options": {
            "includeStructure": true,
            "includeData": true,
            "includeDrop": false,
            "useTransaction": true
        }
    });

    let input: sqllumen_lib::commands::sql_dump::StartDumpInput =
        serde_json::from_value(input_json).expect("deserialize StartDumpInput");

    assert_eq!(input.connection_id, "conn-1");
    assert_eq!(input.file_path, "/tmp/dump.sql");
    assert_eq!(input.databases, vec!["db1"]);
    assert_eq!(
        input.tables.get("db1").unwrap(),
        &vec!["users".to_string(), "orders".to_string()]
    );
    assert_eq!(input.options.include_drop, false);
}

// ── Full header + data + footer integration ───────────────────────────────

#[test]
fn test_full_dump_output_structure() {
    let mut buf = Vec::new();

    sql_dump::write_header(&mut buf, "mydb", "8.0.33").unwrap();
    sql_dump::write_transaction_start(&mut buf).unwrap();

    let create_sql = "CREATE TABLE `users` (\n  `id` int NOT NULL,\n  `name` varchar(255)\n) ENGINE=InnoDB";
    sql_dump::write_structure(&mut buf, "users", create_sql, true, false).unwrap();

    let columns = vec!["id".to_string(), "name".to_string()];
    let rows = vec![
        vec![SqlDumpValue::Int(1), SqlDumpValue::QuotedString("Alice".to_string())],
        vec![SqlDumpValue::Int(2), SqlDumpValue::QuotedString("Bob".to_string())],
    ];
    sql_dump::write_data_inserts(&mut buf, "users", &columns, &rows).unwrap();

    sql_dump::write_transaction_end(&mut buf).unwrap();
    sql_dump::write_footer(&mut buf).unwrap();

    let output = String::from_utf8(buf).unwrap();

    // Verify order: header → transaction start → structure → data → transaction end → footer
    let header_pos = output.find("SQL Dump").expect("header present");
    let tx_start_pos = output.find("SET AUTOCOMMIT = 0").expect("tx start present");
    let drop_pos = output.find("DROP TABLE IF EXISTS").expect("drop present");
    let create_pos = output.find("CREATE TABLE").expect("create present");
    let data_pos = output.find("Data for").expect("data section present");
    let insert_pos = output.find("INSERT INTO").expect("insert present");
    let tx_end_pos = output.find("COMMIT;").expect("tx end present");
    let footer_pos = output
        .find("SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT")
        .expect("footer present");

    assert!(header_pos < tx_start_pos);
    assert!(tx_start_pos < drop_pos);
    assert!(drop_pos < create_pos);
    assert!(create_pos < data_pos);
    assert!(data_pos < insert_pos);
    assert!(insert_pos < tx_end_pos);
    assert!(tx_end_pos < footer_pos);
}

// ── SqlDumpValue type-aware serialization ─────────────────────────────────

#[test]
fn test_sql_dump_value_uint() {
    let mut buf = Vec::new();
    let columns = vec!["id".to_string()];
    let rows = vec![vec![SqlDumpValue::UInt(18446744073709551615)]];

    sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows).unwrap();
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("(18446744073709551615)"));
}

#[test]
fn test_sql_dump_value_float() {
    let mut buf = Vec::new();
    let columns = vec!["price".to_string()];
    let rows = vec![vec![SqlDumpValue::Float(3.14)]];

    sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows).unwrap();
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("(3.14)"));
}

#[test]
fn test_sql_dump_value_float_nan_becomes_null() {
    let mut buf = Vec::new();
    let columns = vec!["val".to_string()];
    let rows = vec![vec![SqlDumpValue::Float(f64::NAN)]];

    sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows).unwrap();
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("(NULL)"));
}

#[test]
fn test_sql_dump_value_decimal_preserves_exact_string() {
    let mut buf = Vec::new();
    let columns = vec!["amount".to_string()];
    let rows = vec![
        vec![SqlDumpValue::Decimal("00123.4500".to_string())],
        vec![SqlDumpValue::Decimal("99999999999999999.99".to_string())],
    ];

    sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows).unwrap();
    let output = String::from_utf8(buf).unwrap();

    // Decimals are emitted unquoted, preserving the exact string
    assert!(output.contains("(00123.4500)"));
    assert!(output.contains("(99999999999999999.99)"));
}

#[test]
fn test_sql_dump_value_hex_bytes() {
    let mut buf = Vec::new();
    let columns = vec!["data".to_string()];
    let rows = vec![
        vec![SqlDumpValue::HexBytes(vec![0xDE, 0xAD, 0xBE, 0xEF])],
        vec![SqlDumpValue::HexBytes(vec![])],
    ];

    sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows).unwrap();
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("(0xDEADBEEF)"));
    assert!(output.contains("(0x)"));
}

#[test]
fn test_sql_dump_value_quoted_string_with_special_chars() {
    let mut buf = Vec::new();
    let columns = vec!["text".to_string()];
    let rows = vec![
        // Leading zeros preserved as quoted string
        vec![SqlDumpValue::QuotedString("00123".to_string())],
        // Null byte, newline, carriage return
        vec![SqlDumpValue::QuotedString("a\0b\nc\rd".to_string())],
        // JSON content
        vec![SqlDumpValue::QuotedString("{\"key\": \"value\"}".to_string())],
    ];

    sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows).unwrap();
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("('00123')"));
    assert!(output.contains("('a\\0b\\nc\\rd')"));
    assert!(output.contains("('{\"key\": \"value\"}')"));
}

#[test]
fn test_sql_dump_value_mixed_types_in_row() {
    let mut buf = Vec::new();
    let columns = vec![
        "id".to_string(),
        "name".to_string(),
        "balance".to_string(),
        "photo".to_string(),
        "active".to_string(),
        "notes".to_string(),
    ];
    let rows = vec![vec![
        SqlDumpValue::Int(42),
        SqlDumpValue::QuotedString("Alice".to_string()),
        SqlDumpValue::Decimal("1234.56".to_string()),
        SqlDumpValue::HexBytes(vec![0xFF, 0x00]),
        SqlDumpValue::Bool(true),
        SqlDumpValue::Null,
    ]];

    sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows).unwrap();
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("(42, 'Alice', 1234.56, 0xFF00, 1, NULL)"));
}

// ── Import progress commands ──────────────────────────────────────────────

#[test]
fn test_get_import_progress_not_found() {
    let state = common::test_app_state();
    let result = sqllumen_lib::commands::sql_dump::get_import_progress_impl(&state, "nonexistent");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[test]
fn test_get_import_progress_found() {
    use sqllumen_lib::state::{ImportJobProgress, ImportJobStatus};

    let state = common::test_app_state();

    {
        let mut jobs = state.import_jobs.write().unwrap();
        jobs.insert(
            "import-1".to_string(),
            ImportJobProgress {
                job_id: "import-1".to_string(),
                status: ImportJobStatus::Running,
                statements_total: 20,
                statements_done: 10,
                errors: Vec::new(),
                stop_on_error: false,
                cancel_requested: false,
                completed_at: None,
            },
        );
    }

    let progress = sqllumen_lib::commands::sql_dump::get_import_progress_impl(&state, "import-1")
        .expect("should find progress");
    assert_eq!(progress.job_id, "import-1");
    assert_eq!(progress.status, ImportJobStatus::Running);
    assert_eq!(progress.statements_total, 20);
    assert_eq!(progress.statements_done, 10);
}

// ── Cancel import ─────────────────────────────────────────────────────────

#[test]
fn test_cancel_import_success() {
    use sqllumen_lib::state::{ImportJobProgress, ImportJobStatus};

    let state = common::test_app_state();

    {
        let mut jobs = state.import_jobs.write().unwrap();
        jobs.insert(
            "import-cancel".to_string(),
            ImportJobProgress {
                job_id: "import-cancel".to_string(),
                status: ImportJobStatus::Running,
                statements_total: 50,
                statements_done: 5,
                errors: Vec::new(),
                stop_on_error: false,
                cancel_requested: false,
                completed_at: None,
            },
        );
    }

    sqllumen_lib::commands::sql_dump::cancel_import_impl(&state, "import-cancel")
        .expect("cancel should succeed");

    // Verify cancel_requested is set
    let jobs = state.import_jobs.read().unwrap();
    assert!(jobs.get("import-cancel").unwrap().cancel_requested);
}

#[test]
fn test_cancel_import_not_found() {
    let state = common::test_app_state();
    let result = sqllumen_lib::commands::sql_dump::cancel_import_impl(&state, "nonexistent");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

// ── Stale job cleanup ─────────────────────────────────────────────────────

#[test]
fn test_stale_dump_job_cleanup() {
    let state = common::test_app_state();

    {
        let mut jobs = state.dump_jobs.write().unwrap();
        // Insert a completed job with old completed_at
        jobs.insert(
            "stale-dump".to_string(),
            DumpJobProgress {
                job_id: "stale-dump".to_string(),
                status: DumpJobStatus::Completed,
                tables_total: 5,
                tables_done: 5,
                current_table: None,
                bytes_written: 1024,
                error_message: None,
                // completed_at set to 10 minutes ago (stale > 5 min)
                completed_at: Some(std::time::Instant::now() - std::time::Duration::from_secs(601)),
            },
        );
        // Insert a running job (should never be cleaned up)
        jobs.insert(
            "running-dump".to_string(),
            DumpJobProgress {
                job_id: "running-dump".to_string(),
                status: DumpJobStatus::Running,
                tables_total: 10,
                tables_done: 2,
                current_table: Some("users".to_string()),
                bytes_written: 0,
                error_message: None,
                completed_at: None,
            },
        );
    }

    // Accessing get_dump_progress_impl triggers cleanup
    let result = sqllumen_lib::commands::sql_dump::get_dump_progress_impl(&state, "running-dump");
    assert!(result.is_ok());

    // Stale job should be cleaned up
    let stale = sqllumen_lib::commands::sql_dump::get_dump_progress_impl(&state, "stale-dump");
    assert!(stale.is_err());
}

#[test]
fn test_stale_import_job_cleanup() {
    use sqllumen_lib::state::{ImportJobProgress, ImportJobStatus};

    let state = common::test_app_state();

    {
        let mut jobs = state.import_jobs.write().unwrap();
        // Insert a completed import job with old completed_at
        jobs.insert(
            "stale-import".to_string(),
            ImportJobProgress {
                job_id: "stale-import".to_string(),
                status: ImportJobStatus::Completed,
                statements_total: 10,
                statements_done: 10,
                errors: Vec::new(),
                stop_on_error: false,
                cancel_requested: false,
                completed_at: Some(std::time::Instant::now() - std::time::Duration::from_secs(601)),
            },
        );
        // Insert a running import job
        jobs.insert(
            "running-import".to_string(),
            ImportJobProgress {
                job_id: "running-import".to_string(),
                status: ImportJobStatus::Running,
                statements_total: 20,
                statements_done: 5,
                errors: Vec::new(),
                stop_on_error: false,
                cancel_requested: false,
                completed_at: None,
            },
        );
    }

    // Accessing get_import_progress_impl triggers cleanup
    let result = sqllumen_lib::commands::sql_dump::get_import_progress_impl(&state, "running-import");
    assert!(result.is_ok());

    // Stale import job should be cleaned up
    let stale = sqllumen_lib::commands::sql_dump::get_import_progress_impl(&state, "stale-import");
    assert!(stale.is_err());
}

// ── StartImportInput serde ────────────────────────────────────────────────

#[test]
fn test_start_import_input_serde() {
    let input_json = serde_json::json!({
        "connectionId": "conn-2",
        "filePath": "/tmp/import.sql",
        "stopOnError": true
    });

    let input: sqllumen_lib::commands::sql_dump::StartImportInput =
        serde_json::from_value(input_json).expect("deserialize StartImportInput");

    assert_eq!(input.connection_id, "conn-2");
    assert_eq!(input.file_path, "/tmp/import.sql");
    assert!(input.stop_on_error);

    // Round-trip
    let json = serde_json::to_value(&input).expect("serialize");
    assert_eq!(json["connectionId"], serde_json::json!("conn-2"));
    assert_eq!(json["filePath"], serde_json::json!("/tmp/import.sql"));
    assert_eq!(json["stopOnError"], serde_json::json!(true));
}

// ── Float infinity ────────────────────────────────────────────────────────

#[test]
fn test_sql_dump_value_float_infinity_becomes_null() {
    let mut buf = Vec::new();
    let columns = vec!["val".to_string()];
    let rows = vec![
        vec![SqlDumpValue::Float(f64::INFINITY)],
        vec![SqlDumpValue::Float(f64::NEG_INFINITY)],
    ];

    sql_dump::write_data_inserts(&mut buf, "t", &columns, &rows).unwrap();
    let output = String::from_utf8(buf).unwrap();

    // Both infinity values should become NULL
    let null_count = output.matches("(NULL)").count();
    assert_eq!(null_count, 2);
}

// ── DumpJobProgress with error message ────────────────────────────────────

#[test]
fn test_dump_job_progress_with_error() {
    let progress = DumpJobProgress {
        job_id: "err-job".to_string(),
        status: DumpJobStatus::Failed,
        tables_total: 5,
        tables_done: 2,
        current_table: None,
        bytes_written: 512,
        error_message: Some("Connection lost".to_string()),
        completed_at: None,
    };

    let json = serde_json::to_value(&progress).expect("serialize");
    assert_eq!(json["status"], serde_json::json!("failed"));
    assert_eq!(json["errorMessage"], serde_json::json!("Connection lost"));
    assert_eq!(json["tablesDone"], serde_json::json!(2));
}

// ── StartDumpInput with empty tables map ──────────────────────────────────

#[test]
fn test_start_dump_input_empty_tables() {
    let input_json = serde_json::json!({
        "connectionId": "conn-1",
        "filePath": "/tmp/dump.sql",
        "databases": ["db1", "db2"],
        "tables": {},
        "options": {
            "includeStructure": false,
            "includeData": true,
            "includeDrop": false,
            "useTransaction": false
        }
    });

    let input: sqllumen_lib::commands::sql_dump::StartDumpInput =
        serde_json::from_value(input_json).expect("deserialize");

    assert_eq!(input.databases.len(), 2);
    assert!(input.tables.is_empty());
    assert!(!input.options.include_structure);
    assert!(!input.options.use_transaction);
}
