//! Integration tests for the export module — CSV, JSON, SQL, and XLSX writers.

use mysql_client_lib::export::csv_writer::write_csv;
use mysql_client_lib::export::json_writer::write_json;
use mysql_client_lib::export::sql_writer::write_sql;
use mysql_client_lib::export::xlsx_writer::write_xlsx;
use mysql_client_lib::export::{ExportFormat, ExportOptions, ExportResult};
use mysql_client_lib::commands::export::{export_results_impl, export_with_data};
use mysql_client_lib::mysql::query_executor::{ColumnMeta, StoredResult};
use mysql_client_lib::mysql::registry::ConnectionRegistry;
use mysql_client_lib::state::AppState;
use rusqlite::Connection;
use std::io::{self, Write};
use std::sync::Mutex;

mod common;

fn test_state() -> AppState {
    common::ensure_fake_backend_once();
    let conn = Connection::open_in_memory().expect("should open in-memory db");
    mysql_client_lib::db::migrations::run_migrations(&conn).expect("should run migrations");
    AppState {
        db: Mutex::new(conn),
        registry: ConnectionRegistry::new(),
        app_handle: None,
        results: std::sync::RwLock::new(std::collections::HashMap::new()),
        log_filter_reload: Mutex::new(None),
        running_queries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
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

#[test]
fn test_xlsx_without_headers() {
    let columns = sample_columns();
    let rows = sample_rows();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_export_no_hdr_{}.xlsx", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    let bytes = write_xlsx(&path_str, &columns, &rows, false).expect("write_xlsx should succeed");
    assert!(bytes > 0);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn test_xlsx_null_and_boolean() {
    let columns = vec!["val".to_string()];
    let rows = vec![
        vec![serde_json::Value::Null],
        vec![serde_json::json!(true)],
        vec![serde_json::json!(false)],
    ];
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_export_types_{}.xlsx", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    let bytes = write_xlsx(&path_str, &columns, &rows, true).expect("write_xlsx should succeed");
    assert!(bytes > 0);

    let _ = std::fs::remove_file(&path);
}

// ── Empty result set ──────────────────────────────────────────────────────────

#[test]
fn test_empty_result_set_csv() {
    let columns = sample_columns();
    let rows: Vec<Vec<serde_json::Value>> = vec![];
    let mut buf = Vec::new();
    write_csv(&mut buf, &columns, &rows, true).expect("write_csv should succeed");
    let output = String::from_utf8(buf).unwrap();

    // Should contain only the header row
    assert_eq!(output.trim(), "id,name,email");
}

#[test]
fn test_empty_result_set_json() {
    let columns = sample_columns();
    let rows: Vec<Vec<serde_json::Value>> = vec![];
    let mut buf = Vec::new();
    write_json(&mut buf, &columns, &rows, true).expect("write_json should succeed");
    let output = String::from_utf8(buf).unwrap();

    let parsed: serde_json::Value = serde_json::from_str(&output).expect("valid JSON");
    assert_eq!(parsed.as_array().unwrap().len(), 0);
}

#[test]
fn test_empty_result_set_sql() {
    let columns = sample_columns();
    let rows: Vec<Vec<serde_json::Value>> = vec![];
    let mut buf = Vec::new();
    write_sql(&mut buf, &columns, &rows, true, "t").expect("write_sql should succeed");
    let output = String::from_utf8(buf).unwrap();

    // Empty result: no INSERT statements
    assert!(output.is_empty());
}

#[test]
fn test_empty_result_set_xlsx() {
    let columns = sample_columns();
    let rows: Vec<Vec<serde_json::Value>> = vec![];
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_export_empty_{}.xlsx", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    let bytes = write_xlsx(&path_str, &columns, &rows, true).expect("write_xlsx should succeed");
    assert!(bytes > 0, "even empty xlsx should have file structure");

    let _ = std::fs::remove_file(&path);
}

// ── export_with_data ──────────────────────────────────────────────────────────

#[test]
fn test_export_with_data_csv() {
    let columns = sample_columns();
    let rows = sample_rows();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_ewd_csv_{}.csv", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    let options = ExportOptions {
        format: ExportFormat::Csv,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: None,
    };

    let result = export_with_data(&columns, &rows, options).expect("export_with_data should succeed");
    assert_eq!(result.rows_exported, 2);
    assert!(result.bytes_written > 0);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn test_export_with_data_json() {
    let columns = sample_columns();
    let rows = sample_rows();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_ewd_json_{}.json", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    let options = ExportOptions {
        format: ExportFormat::Json,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: None,
    };

    let result = export_with_data(&columns, &rows, options).expect("export_with_data should succeed");
    assert_eq!(result.rows_exported, 2);
    assert!(result.bytes_written > 0);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn test_export_with_data_sql() {
    let columns = sample_columns();
    let rows = sample_rows();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_ewd_sql_{}.sql", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    let options = ExportOptions {
        format: ExportFormat::SqlInsert,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: Some("my_table".to_string()),
    };

    let result = export_with_data(&columns, &rows, options).expect("export_with_data should succeed");
    assert_eq!(result.rows_exported, 2);
    assert!(result.bytes_written > 0);

    let content = std::fs::read_to_string(&path).expect("read file");
    assert!(content.contains("INSERT INTO `my_table`"));

    let _ = std::fs::remove_file(&path);
}

#[test]
fn test_export_with_data_xlsx() {
    let columns = sample_columns();
    let rows = sample_rows();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_ewd_xlsx_{}.xlsx", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    let options = ExportOptions {
        format: ExportFormat::Xlsx,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: None,
    };

    let result = export_with_data(&columns, &rows, options).expect("export_with_data should succeed");
    assert_eq!(result.rows_exported, 2);
    assert!(result.bytes_written > 0);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn test_export_format_from_format_str_accepts_supported_values() {
    assert_eq!(
        ExportFormat::from_format_str("csv").expect("csv should parse"),
        ExportFormat::Csv
    );
    assert_eq!(
        ExportFormat::from_format_str("json").expect("json should parse"),
        ExportFormat::Json
    );
    assert_eq!(
        ExportFormat::from_format_str("xlsx").expect("xlsx should parse"),
        ExportFormat::Xlsx
    );
    assert_eq!(
        ExportFormat::from_format_str("sql").expect("sql should parse"),
        ExportFormat::SqlInsert
    );
    assert_eq!(
        ExportFormat::from_format_str("sql-insert").expect("sql-insert should parse"),
        ExportFormat::SqlInsert
    );
}

#[test]
fn test_export_format_from_format_str_rejects_unknown_value() {
    let error = ExportFormat::from_format_str("yaml").expect_err("unknown format should fail");
    assert!(error.contains("Unknown export format"));
}

#[test]
fn test_export_format_serde_round_trip() {
    let json = serde_json::to_string(&ExportFormat::SqlInsert).expect("serialize export format");
    assert_eq!(json, r#""sql-insert""#);

    let round_trip: ExportFormat =
        serde_json::from_str(&json).expect("deserialize export format");
    assert_eq!(round_trip, ExportFormat::SqlInsert);
}

#[test]
fn test_export_options_serde_round_trip() {
    let options = ExportOptions {
        format: ExportFormat::Json,
        file_path: "D:/tmp/result.json".to_string(),
        include_headers: false,
        table_name: Some("audit_log".to_string()),
    };

    let json = serde_json::to_value(&options).expect("serialize export options");
    assert_eq!(json["filePath"], serde_json::json!("D:/tmp/result.json"));
    assert_eq!(json["includeHeaders"], serde_json::json!(false));
    assert_eq!(json["tableName"], serde_json::json!("audit_log"));

    let round_trip: ExportOptions =
        serde_json::from_value(json).expect("deserialize export options");
    assert_eq!(round_trip.file_path, "D:/tmp/result.json");
    assert_eq!(round_trip.format, ExportFormat::Json);
    assert_eq!(round_trip.table_name.as_deref(), Some("audit_log"));
}

#[test]
fn test_export_result_serde_round_trip() {
    let result = ExportResult {
        bytes_written: 128,
        rows_exported: 3,
    };

    let json = serde_json::to_value(&result).expect("serialize export result");
    assert_eq!(json["bytesWritten"], serde_json::json!(128));
    assert_eq!(json["rowsExported"], serde_json::json!(3));

    let round_trip: ExportResult =
        serde_json::from_value(json).expect("deserialize export result");
    assert_eq!(round_trip.bytes_written, 128);
    assert_eq!(round_trip.rows_exported, 3);
}

#[test]
fn test_export_with_data_reports_create_file_errors() {
    let columns = sample_columns();
    let rows = sample_rows();
    let missing_parent = temp_export_path("missing_parent_export", "csv")
        .join("nested")
        .join("export.csv");

    let options = ExportOptions {
        format: ExportFormat::Csv,
        file_path: missing_parent.to_string_lossy().to_string(),
        include_headers: true,
        table_name: None,
    };

    let error = export_with_data(&columns, &rows, options).expect_err("create should fail");
    assert!(error.contains("Failed to create file"));
}

#[test]
fn test_export_with_data_reports_create_file_errors_for_json() {
    let columns = sample_columns();
    let rows = sample_rows();
    let missing_parent = temp_export_path("missing_parent_export_json", "json")
        .join("nested")
        .join("export.json");

    let options = ExportOptions {
        format: ExportFormat::Json,
        file_path: missing_parent.to_string_lossy().to_string(),
        include_headers: true,
        table_name: None,
    };

    let error = export_with_data(&columns, &rows, options).expect_err("create should fail");
    assert!(error.contains("Failed to create file"));
}

#[test]
fn test_export_with_data_surfaces_sql_writer_errors() {
    let columns = sample_columns();
    let rows = sample_rows();
    let path = temp_export_path("bad_sql_export", "sql");

    let options = ExportOptions {
        format: ExportFormat::SqlInsert,
        file_path: path.to_string_lossy().to_string(),
        include_headers: true,
        table_name: Some(String::new()),
    };

    let error = export_with_data(&columns, &rows, options).expect_err("sql write should fail");
    assert!(error.contains("Failed to write SQL"));

    let _ = std::fs::remove_file(&path);
}

// ── export_results_impl with state ────────────────────────────────────────────

#[test]
fn test_export_results_impl_success() {
    let state = test_state();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_impl_export_{}.csv", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    // Insert a stored result
    {
        let mut results = state.results.write().expect("lock ok");
        results.insert(
            ("conn-1".to_string(), "tab-1".to_string()),
            StoredResult {
                query_id: "qid-1".to_string(),
                columns: vec![
                    ColumnMeta { name: "id".to_string(), data_type: "INT".to_string() },
                    ColumnMeta { name: "name".to_string(), data_type: "VARCHAR".to_string() },
                ],
                rows: vec![
                    vec![serde_json::json!(1), serde_json::json!("Alice")],
                    vec![serde_json::json!(2), serde_json::json!("Bob")],
                ],
                execution_time_ms: 5,
                affected_rows: 0,
                auto_limit_applied: false,
                page_size: 1000,
            },
        );
    }

    let options = ExportOptions {
        format: ExportFormat::Csv,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: None,
    };

    let result = export_results_impl(&state, "conn-1", "tab-1", options)
        .expect("export should succeed");
    assert_eq!(result.rows_exported, 2);
    assert!(result.bytes_written > 0);

    let content = std::fs::read_to_string(&path).expect("read file");
    assert!(content.contains("id,name"));
    assert!(content.contains("1,Alice"));

    let _ = std::fs::remove_file(&path);
}

#[test]
fn test_export_results_impl_no_results() {
    let state = test_state();

    let options = ExportOptions {
        format: ExportFormat::Csv,
        file_path: "unused.csv".to_string(),
        include_headers: true,
        table_name: None,
    };

    let err = export_results_impl(&state, "conn-missing", "tab-missing", options)
        .expect_err("should fail when no results");
    assert!(err.contains("No results found"));
}

#[test]
fn test_export_sql_default_table_name_via_impl() {
    let state = test_state();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_impl_sql_{}.sql", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    {
        let mut results = state.results.write().expect("lock ok");
        results.insert(
            ("c1".to_string(), "t1".to_string()),
            StoredResult {
                query_id: "q1".to_string(),
                columns: vec![ColumnMeta { name: "id".to_string(), data_type: "INT".to_string() }],
                rows: vec![vec![serde_json::json!(42)]],
                execution_time_ms: 1,
                affected_rows: 0,
                auto_limit_applied: false,
                page_size: 1000,
            },
        );
    }

    let options = ExportOptions {
        format: ExportFormat::SqlInsert,
        file_path: path_str.clone(),
        include_headers: true,
        table_name: None, // should default to "exported_results"
    };

    let result = export_results_impl(&state, "c1", "t1", options).expect("export should succeed");
    assert_eq!(result.rows_exported, 1);

    let content = std::fs::read_to_string(&path).expect("read file");
    assert!(content.contains("INSERT INTO `exported_results`"));

    let _ = std::fs::remove_file(&path);
}
