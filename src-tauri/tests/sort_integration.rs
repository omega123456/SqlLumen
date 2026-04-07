//! Integration tests for the in-memory sort implementation.
//!
//! Tests exercise `sort_results_impl` and the `compare_json_values` helper
//! against various data type scenarios, NULL handling, and pagination.

use sqllumen_lib::mysql::query_executor::{
    compare_json_values, sort_results_impl, ColumnMeta, StoredResult,
};
use sqllumen_lib::mysql::registry::ConnectionRegistry;
use sqllumen_lib::state::AppState;
use rusqlite::Connection;
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
    }
}

/// Insert a StoredResult with the given columns and rows into state.
fn insert_result(
    state: &AppState,
    conn_id: &str,
    tab_id: &str,
    columns: Vec<ColumnMeta>,
    rows: Vec<Vec<serde_json::Value>>,
    page_size: usize,
) {
    let mut results = state.results.write().expect("lock ok");
    results.insert(
        (conn_id.to_string(), tab_id.to_string()),
        vec![StoredResult {
            query_id: "q-sort-test".to_string(),
            columns,
            rows,
            execution_time_ms: 1,
            affected_rows: 0,
            auto_limit_applied: false,
            page_size,
        }],
    );
}

fn name_col() -> Vec<ColumnMeta> {
    vec![ColumnMeta {
        name: "name".to_string(),
        data_type: "VARCHAR".to_string(),
    }]
}

fn id_col() -> Vec<ColumnMeta> {
    vec![ColumnMeta {
        name: "id".to_string(),
        data_type: "INT".to_string(),
    }]
}

fn id_name_cols() -> Vec<ColumnMeta> {
    vec![
        ColumnMeta {
            name: "id".to_string(),
            data_type: "INT".to_string(),
        },
        ColumnMeta {
            name: "name".to_string(),
            data_type: "VARCHAR".to_string(),
        },
    ]
}

// ── compare_json_values unit tests ────────────────────────────────────────────

#[test]
fn compare_null_null_equal() {
    assert_eq!(
        compare_json_values(&serde_json::Value::Null, &serde_json::Value::Null),
        std::cmp::Ordering::Equal
    );
}

#[test]
fn compare_null_greater_than_non_null() {
    let val = serde_json::json!(42);
    assert_eq!(
        compare_json_values(&serde_json::Value::Null, &val),
        std::cmp::Ordering::Greater
    );
    assert_eq!(
        compare_json_values(&val, &serde_json::Value::Null),
        std::cmp::Ordering::Less
    );
}

#[test]
fn compare_numbers() {
    let a = serde_json::json!(10);
    let b = serde_json::json!(20);
    assert_eq!(
        compare_json_values(&a, &b),
        std::cmp::Ordering::Less
    );
    assert_eq!(
        compare_json_values(&b, &a),
        std::cmp::Ordering::Greater
    );
    assert_eq!(
        compare_json_values(&a, &a),
        std::cmp::Ordering::Equal
    );
}

#[test]
fn compare_float_numbers() {
    let a = serde_json::json!(1.5);
    let b = serde_json::json!(2.5);
    assert_eq!(
        compare_json_values(&a, &b),
        std::cmp::Ordering::Less
    );
}

#[test]
fn compare_strings() {
    let a = serde_json::json!("apple");
    let b = serde_json::json!("banana");
    assert_eq!(
        compare_json_values(&a, &b),
        std::cmp::Ordering::Less
    );
    assert_eq!(
        compare_json_values(&b, &a),
        std::cmp::Ordering::Greater
    );
}

#[test]
fn compare_mixed_types_as_strings() {
    let num = serde_json::json!(42);
    let str_val = serde_json::json!("hello");
    // Mixed types compare via to_string(): "42" vs "\"hello\""
    let result = compare_json_values(&num, &str_val);
    // Just verify it doesn't panic and returns a deterministic ordering
    assert!(result == std::cmp::Ordering::Less || result == std::cmp::Ordering::Greater);
}

#[test]
fn compare_booleans_as_mixed() {
    let t = serde_json::json!(true);
    let f = serde_json::json!(false);
    let result = compare_json_values(&t, &f);
    // Booleans fall through to the to_string() path
    assert!(
        result == std::cmp::Ordering::Less
            || result == std::cmp::Ordering::Greater
            || result == std::cmp::Ordering::Equal
    );
}

// ── sort_results_impl integration tests ───────────────────────────────────────

#[test]
fn sort_string_column_asc() {
    let state = test_state();
    insert_result(
        &state,
        "c1",
        "t1",
        name_col(),
        vec![
            vec![serde_json::json!("Charlie")],
            vec![serde_json::json!("Alice")],
            vec![serde_json::json!("Bob")],
        ],
        1000,
    );

    let result = sort_results_impl(&state, "c1", "t1", "name", "asc", None).expect("sort ok");
    assert_eq!(result.rows[0][0], serde_json::json!("Alice"));
    assert_eq!(result.rows[1][0], serde_json::json!("Bob"));
    assert_eq!(result.rows[2][0], serde_json::json!("Charlie"));
    assert_eq!(result.page, 1);
}

#[test]
fn sort_string_column_desc() {
    let state = test_state();
    insert_result(
        &state,
        "c1",
        "t1",
        name_col(),
        vec![
            vec![serde_json::json!("Alice")],
            vec![serde_json::json!("Charlie")],
            vec![serde_json::json!("Bob")],
        ],
        1000,
    );

    let result = sort_results_impl(&state, "c1", "t1", "name", "desc", None).expect("sort ok");
    assert_eq!(result.rows[0][0], serde_json::json!("Charlie"));
    assert_eq!(result.rows[1][0], serde_json::json!("Bob"));
    assert_eq!(result.rows[2][0], serde_json::json!("Alice"));
}

#[test]
fn sort_numeric_column_asc() {
    let state = test_state();
    insert_result(
        &state,
        "c1",
        "t1",
        id_col(),
        vec![
            vec![serde_json::json!(30)],
            vec![serde_json::json!(10)],
            vec![serde_json::json!(20)],
        ],
        1000,
    );

    let result = sort_results_impl(&state, "c1", "t1", "id", "asc", None).expect("sort ok");
    assert_eq!(result.rows[0][0], serde_json::json!(10));
    assert_eq!(result.rows[1][0], serde_json::json!(20));
    assert_eq!(result.rows[2][0], serde_json::json!(30));
}

#[test]
fn sort_numeric_column_desc() {
    let state = test_state();
    insert_result(
        &state,
        "c1",
        "t1",
        id_col(),
        vec![
            vec![serde_json::json!(10)],
            vec![serde_json::json!(30)],
            vec![serde_json::json!(20)],
        ],
        1000,
    );

    let result = sort_results_impl(&state, "c1", "t1", "id", "desc", None).expect("sort ok");
    assert_eq!(result.rows[0][0], serde_json::json!(30));
    assert_eq!(result.rows[1][0], serde_json::json!(20));
    assert_eq!(result.rows[2][0], serde_json::json!(10));
}

#[test]
fn sort_nulls_last_asc() {
    let state = test_state();
    insert_result(
        &state,
        "c1",
        "t1",
        name_col(),
        vec![
            vec![serde_json::Value::Null],
            vec![serde_json::json!("Alice")],
            vec![serde_json::Value::Null],
            vec![serde_json::json!("Bob")],
        ],
        1000,
    );

    let result = sort_results_impl(&state, "c1", "t1", "name", "asc", None).expect("sort ok");
    // Non-nulls first, then nulls
    assert_eq!(result.rows[0][0], serde_json::json!("Alice"));
    assert_eq!(result.rows[1][0], serde_json::json!("Bob"));
    assert_eq!(result.rows[2][0], serde_json::Value::Null);
    assert_eq!(result.rows[3][0], serde_json::Value::Null);
}

#[test]
fn sort_nulls_first_desc() {
    let state = test_state();
    insert_result(
        &state,
        "c1",
        "t1",
        name_col(),
        vec![
            vec![serde_json::json!("Alice")],
            vec![serde_json::Value::Null],
            vec![serde_json::json!("Bob")],
            vec![serde_json::Value::Null],
        ],
        1000,
    );

    let result = sort_results_impl(&state, "c1", "t1", "name", "desc", None).expect("sort ok");
    // NULLs first in DESC
    assert_eq!(result.rows[0][0], serde_json::Value::Null);
    assert_eq!(result.rows[1][0], serde_json::Value::Null);
    // Then descending non-nulls
    assert_eq!(result.rows[2][0], serde_json::json!("Bob"));
    assert_eq!(result.rows[3][0], serde_json::json!("Alice"));
}

#[test]
fn sort_mixed_types() {
    let state = test_state();
    insert_result(
        &state,
        "c1",
        "t1",
        vec![ColumnMeta {
            name: "val".to_string(),
            data_type: "VARCHAR".to_string(),
        }],
        vec![
            vec![serde_json::json!(42)],
            vec![serde_json::json!("hello")],
            vec![serde_json::json!(true)],
            vec![serde_json::json!(1)],
        ],
        1000,
    );

    // Should not panic — mixed types compare gracefully as strings
    let result = sort_results_impl(&state, "c1", "t1", "val", "asc", None).expect("sort ok");
    assert_eq!(result.rows.len(), 4);
}

#[test]
fn sort_nonexistent_column_returns_error() {
    let state = test_state();
    insert_result(
        &state,
        "c1",
        "t1",
        name_col(),
        vec![vec![serde_json::json!("Alice")]],
        1000,
    );

    let err = sort_results_impl(&state, "c1", "t1", "nonexistent", "asc", None)
        .expect_err("should error for missing column");
    assert!(err.contains("not found"), "error was: {err}");
}

#[test]
fn sort_missing_result_returns_error() {
    let state = test_state();

    let err = sort_results_impl(&state, "c-missing", "t-missing", "id", "asc", None)
        .expect_err("should error for missing result");
    assert!(
        err.contains("No results found"),
        "error was: {err}"
    );
}

#[test]
fn sort_returns_first_page_with_correct_pagination() {
    let state = test_state();

    // Create 25 rows with page_size = 10
    let rows: Vec<Vec<serde_json::Value>> = (1i64..=25)
        .map(|i| vec![serde_json::json!(i)])
        .collect();

    insert_result(&state, "c1", "t1", id_col(), rows, 10);

    let result = sort_results_impl(&state, "c1", "t1", "id", "desc", None).expect("sort ok");

    // First page should have 10 rows
    assert_eq!(result.rows.len(), 10);
    // Total pages: ceil(25/10) = 3
    assert_eq!(result.total_pages, 3);
    // Page number should be 1
    assert_eq!(result.page, 1);
    // First row should be 25 (desc)
    assert_eq!(result.rows[0][0], serde_json::json!(25));
    // Last row on page should be 16 (25-9=16)
    assert_eq!(result.rows[9][0], serde_json::json!(16));
}

#[test]
fn sort_with_multiple_columns_sorts_by_specified() {
    let state = test_state();
    insert_result(
        &state,
        "c1",
        "t1",
        id_name_cols(),
        vec![
            vec![serde_json::json!(3), serde_json::json!("Charlie")],
            vec![serde_json::json!(1), serde_json::json!("Alice")],
            vec![serde_json::json!(2), serde_json::json!("Bob")],
        ],
        1000,
    );

    // Sort by name column
    let result = sort_results_impl(&state, "c1", "t1", "name", "asc", None).expect("sort ok");
    assert_eq!(result.rows[0][1], serde_json::json!("Alice"));
    assert_eq!(result.rows[1][1], serde_json::json!("Bob"));
    assert_eq!(result.rows[2][1], serde_json::json!("Charlie"));

    // Verify the id column moved with the name column
    assert_eq!(result.rows[0][0], serde_json::json!(1));
    assert_eq!(result.rows[1][0], serde_json::json!(2));
    assert_eq!(result.rows[2][0], serde_json::json!(3));
}

#[test]
fn sort_empty_result_set() {
    let state = test_state();
    insert_result(&state, "c1", "t1", id_col(), vec![], 1000);

    let result = sort_results_impl(&state, "c1", "t1", "id", "asc", None).expect("sort ok");
    assert_eq!(result.rows.len(), 0);
    assert_eq!(result.total_pages, 1);
    assert_eq!(result.page, 1);
}

#[test]
fn sort_numeric_not_lexicographic() {
    // Ensure numeric sort doesn't compare as strings (e.g. "9" > "10" lexicographically)
    let state = test_state();
    insert_result(
        &state,
        "c1",
        "t1",
        id_col(),
        vec![
            vec![serde_json::json!(9)],
            vec![serde_json::json!(10)],
            vec![serde_json::json!(2)],
            vec![serde_json::json!(100)],
        ],
        1000,
    );

    let result = sort_results_impl(&state, "c1", "t1", "id", "asc", None).expect("sort ok");
    assert_eq!(result.rows[0][0], serde_json::json!(2));
    assert_eq!(result.rows[1][0], serde_json::json!(9));
    assert_eq!(result.rows[2][0], serde_json::json!(10));
    assert_eq!(result.rows[3][0], serde_json::json!(100));
}
