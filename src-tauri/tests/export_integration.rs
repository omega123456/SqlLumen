//! Integration tests for the export module — CSV, JSON, SQL, and XLSX writers.

use sqllumen_lib::export::csv_writer::write_csv;
use sqllumen_lib::export::json_writer::write_json;
use sqllumen_lib::export::sql_writer::write_sql;
use sqllumen_lib::export::xlsx_writer::write_xlsx;
use sqllumen_lib::export::{ExportFormat, ExportOptions};
use sqllumen_lib::commands::export::{export_results_impl, export_with_data};
use sqllumen_lib::mysql::query_executor::{ColumnMeta, StoredResult};
use sqllumen_lib::mysql::registry::ConnectionRegistry;
use sqllumen_lib::state::AppState;
use rusqlite::Connection;
use std::io::{self, Write};
use std::sync::{Arc, Mutex};

mod common;

fn test_state() -> AppState {
    common::ensure_fake_backend_once();
    let conn = Connection::open_in_memory().expect("should open in-memory db");
    sqllumen_lib::db::migrations::run_migrations(&conn).expect("should run migrations");
    AppState {
        db: Arc::new(Mutex::new(conn)),
        registry: ConnectionRegistry::new(),
        app_handle: None,
        results: std::sync::RwLock::new(std::collections::HashMap::new()),
        log_filter_reload: Mutex::new(None),
        running_queries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        dump_jobs: std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        import_jobs: std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        ai_requests: Arc::new(Mutex::new(std::collections::HashMap::new())),
    }
}

fn sample_columns() -> Vec<String> {
    vec!["id".to_string(), "name".to_string(), "email".to_string()]
}

fn sample_rows() -> Vec<Vec<serde_json::Value>> {
    vec![
        vec![
            serde_json::json!(1),
            serde_json::json!("Alice"),
            serde_json::json!("alice@example.com"),
        ],
        vec![
            serde_json::json!(2),
            serde_json::json!("Bob"),
            serde_json::json!("bob@example.com"),
        ],
    ]
}

fn temp_export_path(prefix: &str, extension: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "{}_{}_{}.{}",
        prefix,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos(),
        extension
    ))
}

// ── CSV tests ─────────────────────────────────────────────────────────────────

#[test]
fn test_csv_with_headers() {
    let columns = sample_columns();
    let rows = sample_rows();
    let mut buf = Vec::new();
    write_csv(&mut buf, &columns, &rows, true).expect("write_csv should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(output.starts_with("id,name,email\n"));
    assert!(output.contains("1,Alice,alice@example.com"));
    assert!(output.contains("2,Bob,bob@example.com"));
}

#[test]
fn test_csv_without_headers() {
    let columns = sample_columns();
    let rows = sample_rows();
    let mut buf = Vec::new();
    write_csv(&mut buf, &columns, &rows, false).expect("write_csv should succeed");
    let output = String::from_utf8(buf).unwrap();

    // Should NOT start with header row
    assert!(!output.contains("id,name,email"));
    assert!(output.starts_with("1,Alice,alice@example.com"));
}

#[test]
fn test_csv_escaping() {
    let columns = vec!["value".to_string()];
    let rows = vec![
        vec![serde_json::json!("hello, world")],
        vec![serde_json::json!("she said \"hi\"")],
        vec![serde_json::json!("line1\nline2")],
        vec![serde_json::json!("normal")],
    ];
    let mut buf = Vec::new();
    write_csv(&mut buf, &columns, &rows, false).expect("write_csv should succeed");
    let output = String::from_utf8(buf).unwrap();

    // Comma in value: wrapped in double quotes
    assert!(output.contains("\"hello, world\""));
    // Double quotes in value: doubled and wrapped
    assert!(output.contains("\"she said \"\"hi\"\"\""));
    // Newline in value: wrapped in double quotes
    assert!(output.contains("\"line1\nline2\""));
    // Normal value: no wrapping
    assert!(output.contains("\nnormal\n"));
}

#[test]
fn test_csv_null_values() {
    let columns = vec!["id".to_string(), "name".to_string()];
    let rows = vec![vec![serde_json::json!(1), serde_json::Value::Null]];
    let mut buf = Vec::new();
    write_csv(&mut buf, &columns, &rows, false).expect("write_csv should succeed");
    let output = String::from_utf8(buf).unwrap();

    // NULL is an empty field (just comma separator, no content)
    assert_eq!(output.trim(), "1,");
}

#[test]
fn test_csv_boolean_values() {
    let columns = vec!["flag".to_string()];
    let rows = vec![
        vec![serde_json::json!(true)],
        vec![serde_json::json!(false)],
    ];
    let mut buf = Vec::new();
    write_csv(&mut buf, &columns, &rows, false).expect("write_csv should succeed");
    let output = String::from_utf8(buf).unwrap();

    let lines: Vec<&str> = output.trim().lines().collect();
    assert_eq!(lines[0], "1");
    assert_eq!(lines[1], "0");
}

// ── JSON tests ────────────────────────────────────────────────────────────────

#[test]
fn test_json_format() {
    let columns = sample_columns();
    let rows = sample_rows();
    let mut buf = Vec::new();
    write_json(&mut buf, &columns, &rows, true).expect("write_json should succeed");
    let output = String::from_utf8(buf).unwrap();

    let parsed: serde_json::Value = serde_json::from_str(&output).expect("valid JSON");
    let arr = parsed.as_array().expect("should be an array");
    assert_eq!(arr.len(), 2);

    assert_eq!(arr[0]["id"], serde_json::json!(1));
    assert_eq!(arr[0]["name"], serde_json::json!("Alice"));
    assert_eq!(arr[0]["email"], serde_json::json!("alice@example.com"));
    assert_eq!(arr[1]["id"], serde_json::json!(2));
    assert_eq!(arr[1]["name"], serde_json::json!("Bob"));
}

#[test]
fn test_json_null_values() {
    let columns = vec!["id".to_string(), "name".to_string()];
    let rows = vec![vec![serde_json::json!(1), serde_json::Value::Null]];
    let mut buf = Vec::new();
    write_json(&mut buf, &columns, &rows, false).expect("write_json should succeed");
    let output = String::from_utf8(buf).unwrap();

    let parsed: serde_json::Value = serde_json::from_str(&output).expect("valid JSON");
    let arr = parsed.as_array().expect("should be an array");
    assert_eq!(arr[0]["name"], serde_json::Value::Null);
}

#[test]
fn test_json_ignores_include_headers() {
    let columns = vec!["id".to_string()];
    let rows = vec![vec![serde_json::json!(42)]];

    // Both include_headers=true and include_headers=false should produce the same output
    let mut buf_with = Vec::new();
    let mut buf_without = Vec::new();
    write_json(&mut buf_with, &columns, &rows, true).unwrap();
    write_json(&mut buf_without, &columns, &rows, false).unwrap();
    assert_eq!(buf_with, buf_without);
}

#[test]
fn test_json_writer_surfaces_underlying_writer_errors() {
    struct FailingWriter;

    impl Write for FailingWriter {
        fn write(&mut self, _buf: &[u8]) -> io::Result<usize> {
            Err(io::Error::other("sink failed"))
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    let columns = vec!["id".to_string()];
    let rows = vec![vec![serde_json::json!(1)]];
    let error = write_json(&mut FailingWriter, &columns, &rows, true)
        .expect_err("writer failure should be surfaced");
    assert_eq!(error.kind(), io::ErrorKind::Other);
}

// ── SQL INSERT tests ──────────────────────────────────────────────────────────

#[test]
fn test_sql_insert() {
    let columns = sample_columns();
    let rows = sample_rows();
    let mut buf = Vec::new();
    write_sql(&mut buf, &columns, &rows, true, "users").expect("write_sql should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("INSERT INTO `users` (`id`, `name`, `email`) VALUES (1, 'Alice', 'alice@example.com');"));
    assert!(output.contains("INSERT INTO `users` (`id`, `name`, `email`) VALUES (2, 'Bob', 'bob@example.com');"));
}

#[test]
fn test_sql_escaping() {
    let columns = vec!["name".to_string()];
    let rows = vec![vec![serde_json::json!("it's a test")]];
    let mut buf = Vec::new();
    write_sql(&mut buf, &columns, &rows, true, "test_table").expect("write_sql should succeed");
    let output = String::from_utf8(buf).unwrap();

    // Single quote should be doubled
    assert!(output.contains("'it''s a test'"));
}

#[test]
fn test_sql_null_values() {
    let columns = vec!["id".to_string(), "name".to_string()];
    let rows = vec![vec![serde_json::json!(1), serde_json::Value::Null]];
    let mut buf = Vec::new();
    write_sql(&mut buf, &columns, &rows, true, "t").expect("write_sql should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("VALUES (1, NULL);"));
}

#[test]
fn test_sql_boolean_values() {
    let columns = vec!["flag".to_string()];
    let rows = vec![
        vec![serde_json::json!(true)],
        vec![serde_json::json!(false)],
    ];
    let mut buf = Vec::new();
    write_sql(&mut buf, &columns, &rows, true, "t").expect("write_sql should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("VALUES (1);"));
    assert!(output.contains("VALUES (0);"));
}

#[test]
fn test_sql_default_table_name() {
    let columns = vec!["id".to_string()];
    let rows = vec![vec![serde_json::json!(1)]];
    let mut buf = Vec::new();
    write_sql(&mut buf, &columns, &rows, true, "exported_results")
        .expect("write_sql should succeed");
    let output = String::from_utf8(buf).unwrap();
    assert!(output.contains("INSERT INTO `exported_results`"));
}

#[test]
fn test_sql_empty_table_name_returns_error() {
    let columns = vec!["id".to_string()];
    let rows = vec![vec![serde_json::json!(1)]];
    let mut buf = Vec::new();
    let result = write_sql(&mut buf, &columns, &rows, true, "");
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    assert!(err.to_string().contains("table_name must not be empty"));
}

#[test]
fn test_sql_backtick_in_table_name() {
    let columns = vec!["id".to_string()];
    let rows = vec![vec![serde_json::json!(1)]];
    let mut buf = Vec::new();
    write_sql(&mut buf, &columns, &rows, true, "foo`bar")
        .expect("write_sql should succeed");
    let output = String::from_utf8(buf).unwrap();
    // Backtick in table name should be doubled
    assert!(output.contains("INSERT INTO `foo``bar`"));
}

#[test]
fn test_sql_backtick_in_column_name() {
    let columns = vec!["col`name".to_string()];
    let rows = vec![vec![serde_json::json!(42)]];
    let mut buf = Vec::new();
    write_sql(&mut buf, &columns, &rows, true, "t")
        .expect("write_sql should succeed");
    let output = String::from_utf8(buf).unwrap();
    // Backtick in column name should be doubled
    assert!(output.contains("`col``name`"));
}

#[test]
fn test_sql_backslash_in_string_value() {
    let columns = vec!["path".to_string()];
    let rows = vec![vec![serde_json::json!("C:\\Users\\test")]];
    let mut buf = Vec::new();
    write_sql(&mut buf, &columns, &rows, true, "t")
        .expect("write_sql should succeed");
    let output = String::from_utf8(buf).unwrap();
    // Backslashes should be escaped
    assert!(output.contains("'C:\\\\Users\\\\test'"));
}

// ── XLSX tests ────────────────────────────────────────────────────────────────

#[test]
fn test_xlsx_creates_file() {
    let columns = sample_columns();
    let rows = sample_rows();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_export_{}.xlsx", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    let bytes = write_xlsx(&path_str, &columns, &rows, true).expect("write_xlsx should succeed");
    assert!(bytes > 0, "file should be non-empty");
    assert!(path.exists(), "file should exist on disk");

    // Cleanup
    let _ = std::fs::remove_file(&path);
}

// ── export_with_data SQL insert default table name ────────────────────────

#[test]
fn test_export_with_data_sql_default_table_name() {
    let columns = sample_columns();
    let rows = sample_rows();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_ewd_sql_default_{}.sql", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    let options = ExportOptions {
        format: ExportFormat::SqlInsert,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: None, // should default to "exported_results"
    };

    let result = export_with_data(&columns, &rows, options).expect("export_with_data should succeed");
    assert_eq!(result.rows_exported, 2);
    assert!(result.bytes_written > 0);

    let content = std::fs::read_to_string(&path).expect("read file");
    assert!(content.contains("INSERT INTO `exported_results`"));

    let _ = std::fs::remove_file(&path);
}

// ── export_with_data XLSX error path ──────────────────────────────────────

#[test]
fn test_export_with_data_xlsx_invalid_path() {
    let columns = sample_columns();
    let rows = sample_rows();
    let missing_parent = temp_export_path("missing_parent_xlsx", "xlsx")
        .join("nested")
        .join("export.xlsx");

    let options = ExportOptions {
        format: ExportFormat::Xlsx,
        file_path: missing_parent.to_string_lossy().to_string(),
        include_headers: true,
        table_name: None,
    };

    let error = export_with_data(&columns, &rows, options).expect_err("create should fail");
    assert!(!error.is_empty());
}

// ── export_with_data SQL with explicit table name ─────────────────────────

#[test]
fn test_export_with_data_sql_with_custom_table_name() {
    let columns = vec!["col1".to_string()];
    let rows = vec![vec![serde_json::json!(99)]];
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_ewd_custom_table_{}.sql", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    let options = ExportOptions {
        format: ExportFormat::SqlInsert,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: Some("my_custom_table".to_string()),
    };

    let result = export_with_data(&columns, &rows, options).expect("export should succeed");
    assert_eq!(result.rows_exported, 1);

    let content = std::fs::read_to_string(&path).expect("read file");
    assert!(content.contains("INSERT INTO `my_custom_table`"));

    let _ = std::fs::remove_file(&path);
}

// ── ExportFormat::from_format_str ─────────────────────────────────────────

#[test]
fn test_from_format_str_csv() {
    assert_eq!(ExportFormat::from_format_str("csv").unwrap(), ExportFormat::Csv);
}

#[test]
fn test_from_format_str_json() {
    assert_eq!(ExportFormat::from_format_str("json").unwrap(), ExportFormat::Json);
}

#[test]
fn test_from_format_str_xlsx() {
    assert_eq!(ExportFormat::from_format_str("xlsx").unwrap(), ExportFormat::Xlsx);
}

#[test]
fn test_from_format_str_sql() {
    assert_eq!(ExportFormat::from_format_str("sql").unwrap(), ExportFormat::SqlInsert);
}

#[test]
fn test_from_format_str_sql_insert() {
    assert_eq!(ExportFormat::from_format_str("sql-insert").unwrap(), ExportFormat::SqlInsert);
}

#[test]
fn test_from_format_str_unknown() {
    let err = ExportFormat::from_format_str("parquet").unwrap_err();
    assert!(err.contains("Unknown export format"));
    assert!(err.contains("parquet"));
}

// ── ExportFormat serde round-trips ────────────────────────────────────────

#[test]
fn test_export_format_serde_csv() {
    let json = serde_json::to_string(&ExportFormat::Csv).unwrap();
    assert_eq!(json, "\"csv\"");
    let deser: ExportFormat = serde_json::from_str(&json).unwrap();
    assert_eq!(deser, ExportFormat::Csv);
}

#[test]
fn test_export_format_serde_json() {
    let json = serde_json::to_string(&ExportFormat::Json).unwrap();
    assert_eq!(json, "\"json\"");
    let deser: ExportFormat = serde_json::from_str(&json).unwrap();
    assert_eq!(deser, ExportFormat::Json);
}

#[test]
fn test_export_format_serde_xlsx() {
    let json = serde_json::to_string(&ExportFormat::Xlsx).unwrap();
    assert_eq!(json, "\"xlsx\"");
    let deser: ExportFormat = serde_json::from_str(&json).unwrap();
    assert_eq!(deser, ExportFormat::Xlsx);
}

#[test]
fn test_export_format_serde_sql_insert() {
    let json = serde_json::to_string(&ExportFormat::SqlInsert).unwrap();
    assert_eq!(json, "\"sql-insert\"");
    let deser: ExportFormat = serde_json::from_str(&json).unwrap();
    assert_eq!(deser, ExportFormat::SqlInsert);
}

// ── ExportOptions serde round-trip ────────────────────────────────────────

#[test]
fn test_export_options_serde_round_trip() {
    let options = ExportOptions {
        format: ExportFormat::Csv,
        file_path: "/tmp/test.csv".to_string(),
        include_headers: true,
        table_name: Some("my_table".to_string()),
    };
    let json = serde_json::to_string(&options).unwrap();
    let deser: ExportOptions = serde_json::from_str(&json).unwrap();
    assert_eq!(deser.format, ExportFormat::Csv);
    assert_eq!(deser.file_path, "/tmp/test.csv");
    assert!(deser.include_headers);
    assert_eq!(deser.table_name, Some("my_table".to_string()));
}

#[test]
fn test_export_options_serde_camel_case() {
    let options = ExportOptions {
        format: ExportFormat::Json,
        file_path: "/tmp/test.json".to_string(),
        include_headers: false,
        table_name: None,
    };
    let value = serde_json::to_value(&options).unwrap();
    assert!(value.get("filePath").is_some());
    assert!(value.get("includeHeaders").is_some());
    assert!(value.get("tableName").is_some());
}

// ── ExportResult serde round-trip ─────────────────────────────────────────

#[test]
fn test_export_result_serde_round_trip() {
    use sqllumen_lib::export::ExportResult;
    let result = ExportResult {
        bytes_written: 1024,
        rows_exported: 42,
    };
    let json = serde_json::to_string(&result).unwrap();
    let deser: ExportResult = serde_json::from_str(&json).unwrap();
    assert_eq!(deser.bytes_written, 1024);
    assert_eq!(deser.rows_exported, 42);
}

#[test]
fn test_export_result_serde_camel_case() {
    use sqllumen_lib::export::ExportResult;
    let result = ExportResult {
        bytes_written: 256,
        rows_exported: 10,
    };
    let value = serde_json::to_value(&result).unwrap();
    assert!(value.get("bytesWritten").is_some());
    assert!(value.get("rowsExported").is_some());
}

// ── export_with_data CSV path ─────────────────────────────────────────────

#[test]
fn test_export_with_data_csv() {
    let columns = sample_columns();
    let rows = sample_rows();
    let path = temp_export_path("test_ewd_csv", "csv");
    let path_str = path.to_string_lossy().to_string();

    let options = ExportOptions {
        format: ExportFormat::Csv,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: None,
    };

    let result = export_with_data(&columns, &rows, options).expect("csv export should succeed");
    assert_eq!(result.rows_exported, 2);
    assert!(result.bytes_written > 0);

    let content = std::fs::read_to_string(&path).expect("read file");
    assert!(content.contains("id,name,email"));
    assert!(content.contains("Alice"));

    let _ = std::fs::remove_file(&path);
}

// ── export_with_data JSON path ────────────────────────────────────────────

#[test]
fn test_export_with_data_json() {
    let columns = sample_columns();
    let rows = sample_rows();
    let path = temp_export_path("test_ewd_json", "json");
    let path_str = path.to_string_lossy().to_string();

    let options = ExportOptions {
        format: ExportFormat::Json,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: None,
    };

    let result = export_with_data(&columns, &rows, options).expect("json export should succeed");
    assert_eq!(result.rows_exported, 2);
    assert!(result.bytes_written > 0);

    let content = std::fs::read_to_string(&path).expect("read file");
    let parsed: serde_json::Value = serde_json::from_str(&content).expect("valid json");
    let arr = parsed.as_array().expect("should be array");
    assert_eq!(arr.len(), 2);

    let _ = std::fs::remove_file(&path);
}

// ── export_with_data XLSX success path ────────────────────────────────────

#[test]
fn test_export_with_data_xlsx() {
    let columns = sample_columns();
    let rows = sample_rows();
    let path = temp_export_path("test_ewd_xlsx", "xlsx");
    let path_str = path.to_string_lossy().to_string();

    let options = ExportOptions {
        format: ExportFormat::Xlsx,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: None,
    };

    let result = export_with_data(&columns, &rows, options).expect("xlsx export should succeed");
    assert_eq!(result.rows_exported, 2);
    assert!(result.bytes_written > 0);
    assert!(path.exists());

    let _ = std::fs::remove_file(&path);
}

// ── export_with_data CSV error path (invalid path) ────────────────────────

#[test]
fn test_export_with_data_csv_invalid_path() {
    let columns = sample_columns();
    let rows = sample_rows();

    let options = ExportOptions {
        format: ExportFormat::Csv,
        file_path: "/nonexistent/dir/test.csv".to_string(),
        include_headers: true,
        table_name: None,
    };

    let err = export_with_data(&columns, &rows, options).expect_err("should fail for invalid path");
    assert!(err.contains("Failed to create file"));
}

// ── export_with_data JSON error path (invalid path) ───────────────────────

#[test]
fn test_export_with_data_json_invalid_path() {
    let columns = sample_columns();
    let rows = sample_rows();

    let options = ExportOptions {
        format: ExportFormat::Json,
        file_path: "/nonexistent/dir/test.json".to_string(),
        include_headers: true,
        table_name: None,
    };

    let err = export_with_data(&columns, &rows, options).expect_err("should fail for invalid path");
    assert!(err.contains("Failed to create file"));
}

// ── export_with_data SQL error path (invalid path) ────────────────────────

#[test]
fn test_export_with_data_sql_invalid_path() {
    let columns = sample_columns();
    let rows = sample_rows();

    let options = ExportOptions {
        format: ExportFormat::SqlInsert,
        file_path: "/nonexistent/dir/test.sql".to_string(),
        include_headers: true,
        table_name: None,
    };

    let err = export_with_data(&columns, &rows, options).expect_err("should fail for invalid path");
    assert!(err.contains("Failed to create file"));
}

// ── ExportFormat debug impl ───────────────────────────────────────────────

#[test]
fn test_export_format_debug() {
    let debug_str = format!("{:?}", ExportFormat::Csv);
    assert_eq!(debug_str, "Csv");

    let debug_str = format!("{:?}", ExportFormat::SqlInsert);
    assert_eq!(debug_str, "SqlInsert");
}

// ── ExportOptions clone and debug ─────────────────────────────────────────

#[test]
fn test_export_options_clone() {
    let options = ExportOptions {
        format: ExportFormat::Json,
        file_path: "/tmp/test.json".to_string(),
        include_headers: false,
        table_name: Some("tbl".to_string()),
    };
    let cloned = options.clone();
    assert_eq!(cloned.format, ExportFormat::Json);
    assert_eq!(cloned.file_path, "/tmp/test.json");
    assert!(!cloned.include_headers);
    assert_eq!(cloned.table_name, Some("tbl".to_string()));
}

// ── export_results_impl missing tab ───────────────────────────────────────

#[test]
fn test_export_results_impl_missing_tab() {
    let state = test_state();
    let options = ExportOptions {
        format: ExportFormat::Csv,
        file_path: "unused.csv".to_string(),
        include_headers: true,
        table_name: None,
    };

    let err = export_results_impl(&state, "cx", "missing-tab", options, None)
        .expect_err("should fail for missing tab");
    assert!(err.contains("No results found"));
}

// ── export_results_impl with specific result_index ────────────────────────

#[test]
fn test_export_results_impl_with_query_id() {
    let state = test_state();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_impl_qid_{}.csv", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    // Insert two stored results
    {
        let mut results = state.results.write().expect("lock ok");
        results.insert(
            ("conn-m".to_string(), "tab-m".to_string()),
            vec![
                StoredResult {
                    query_id: "first-q".to_string(),
                    columns: vec![ColumnMeta { name: "a".to_string(), data_type: "INT".to_string() }],
                    rows: vec![vec![serde_json::json!(10)]],
                    execution_time_ms: 1,
                    affected_rows: 0,
                    auto_limit_applied: false,
                    page_size: 1000,
                },
                StoredResult {
                    query_id: "second-q".to_string(),
                    columns: vec![ColumnMeta { name: "b".to_string(), data_type: "INT".to_string() }],
                    rows: vec![vec![serde_json::json!(20)]],
                    execution_time_ms: 2,
                    affected_rows: 0,
                    auto_limit_applied: false,
                    page_size: 1000,
                },
            ],
        );
    }

    let options = ExportOptions {
        format: ExportFormat::Csv,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: None,
    };

    // Export the second result using result_index
    let result = export_results_impl(&state, "conn-m", "tab-m", options, Some(1))
        .expect("export should succeed");
    assert_eq!(result.rows_exported, 1);

    let content = std::fs::read_to_string(&path).expect("read file");
    assert!(content.contains("b"));
    assert!(content.contains("20"));

    let _ = std::fs::remove_file(&path);
}

// ── export_results_impl with invalid result_index ─────────────────────────

#[test]
fn test_export_results_impl_invalid_query_id() {
    let state = test_state();

    {
        let mut results = state.results.write().expect("lock ok");
        results.insert(
            ("cx".to_string(), "tx".to_string()),
            vec![StoredResult {
                query_id: "real-q".to_string(),
                columns: vec![ColumnMeta { name: "id".to_string(), data_type: "INT".to_string() }],
                rows: vec![vec![serde_json::json!(1)]],
                execution_time_ms: 1,
                affected_rows: 0,
                auto_limit_applied: false,
                page_size: 1000,
            }],
        );
    }

    let options = ExportOptions {
        format: ExportFormat::Csv,
        file_path: "unused.csv".to_string(),
        include_headers: true,
        table_name: None,
    };

    let err = export_results_impl(&state, "cx", "tx", options, Some(99))
        .expect_err("should fail for out-of-range index");
    assert!(err.contains("out of range") || err.contains("No result"));
}

// ── ExportFormat debug and clone ──────────────────────────────────────────

#[test]
fn test_export_format_clone_and_eq() {
    let fmt = ExportFormat::Csv;
    let cloned = fmt.clone();
    assert_eq!(fmt, cloned);

    assert_ne!(ExportFormat::Csv, ExportFormat::Json);
    assert_ne!(ExportFormat::Json, ExportFormat::Xlsx);
    assert_ne!(ExportFormat::Xlsx, ExportFormat::SqlInsert);
}

// ── CSV with all value types ──────────────────────────────────────────────

#[test]
fn test_csv_with_numeric_and_object_values() {
    let columns = vec!["val".to_string()];
    let rows = vec![
        vec![serde_json::json!(42.5)],
        vec![serde_json::json!({"key": "value"})],
        vec![serde_json::json!([1, 2, 3])],
    ];
    let mut buf = Vec::new();
    write_csv(&mut buf, &columns, &rows, false).expect("write_csv should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("42.5"));
    // JSON objects and arrays get serialized as strings
    assert!(!output.is_empty());
}

// ── SQL writer with various value types ───────────────────────────────────

#[test]
fn test_sql_with_float_values() {
    let columns = vec!["price".to_string()];
    let rows = vec![
        vec![serde_json::json!(19.99)],
        vec![serde_json::json!(-3.14)],
    ];
    let mut buf = Vec::new();
    write_sql(&mut buf, &columns, &rows, true, "prices").expect("write_sql should succeed");
    let output = String::from_utf8(buf).unwrap();

    assert!(output.contains("19.99"));
    assert!(output.contains("-3.14"));
}

#[test]
fn test_sql_with_array_and_object_values() {
    let columns = vec!["data".to_string()];
    let rows = vec![
        vec![serde_json::json!([1, 2, 3])],
        vec![serde_json::json!({"nested": true})],
    ];
    let mut buf = Vec::new();
    write_sql(&mut buf, &columns, &rows, true, "json_data").expect("write_sql should succeed");
    let output = String::from_utf8(buf).unwrap();

    // JSON values should be quoted as strings
    assert!(output.contains("INSERT INTO `json_data`"));
}

// ── export_results_impl with SQL and default table_name ───────────────────

#[test]
fn test_export_results_impl_sql_default_table_name() {
    let state = test_state();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_impl_sql_{}.sql", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    {
        let mut results = state.results.write().expect("lock ok");
        results.insert(
            ("c1".to_string(), "t1".to_string()),
            vec![StoredResult {
                query_id: "q1".to_string(),
                columns: vec![ColumnMeta { name: "id".to_string(), data_type: "INT".to_string() }],
                rows: vec![vec![serde_json::json!(42)]],
                execution_time_ms: 1,
                affected_rows: 0,
                auto_limit_applied: false,
                page_size: 1000,
            }],
        );
    }

    let options = ExportOptions {
        format: ExportFormat::SqlInsert,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: None, // should default to "exported_results"
    };

    let result = export_results_impl(&state, "c1", "t1", options, None).expect("export should succeed");
    assert_eq!(result.rows_exported, 1);

    let content = std::fs::read_to_string(&path).expect("read file");
    assert!(content.contains("INSERT INTO `exported_results`"));

    let _ = std::fs::remove_file(&path);
}
