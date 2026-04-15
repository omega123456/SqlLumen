//! Integration tests for `analyze_query_for_edit_impl` and `update_result_cell_impl`.

mod common;

use common::test_app_state;
use sqllumen_lib::mysql::query_executor::{
    analyze_query_for_edit_impl, update_result_cell_impl, ColumnMeta, StoredResult,
};
use std::collections::HashMap;

// ── update_result_cell_impl tests ──────────────────────────────────────────────

#[test]
fn update_result_cell_successful() {
    let state = test_app_state();

    // Insert a stored result
    {
        let mut results = state.results.write().unwrap();
        results.insert(
            ("conn-1".to_string(), "tab-1".to_string()),
            vec![StoredResult {
                query_id: "q1".to_string(),
                columns: vec![
                    ColumnMeta {
                        name: "id".to_string(),
                        data_type: "INT".to_string(),
                    },
                    ColumnMeta {
                        name: "name".to_string(),
                        data_type: "VARCHAR".to_string(),
                    },
                    ColumnMeta {
                        name: "email".to_string(),
                        data_type: "VARCHAR".to_string(),
                    },
                ],
                rows: vec![
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
                ],
                execution_time_ms: 10,
                affected_rows: 0,
                auto_limit_applied: false,
                page_size: 1000,
            }],
        );
    }

    // Update name in row 0
    let mut updates = HashMap::new();
    updates.insert(1, serde_json::json!("Alice Updated"));

    let result = update_result_cell_impl(&state, "conn-1", "tab-1", 0, updates, None);
    assert!(result.is_ok());

    // Verify the update
    let results = state.results.read().unwrap();
    let result_vec = results
        .get(&("conn-1".to_string(), "tab-1".to_string()))
        .unwrap();
    let stored = &result_vec[0];
    assert_eq!(stored.rows[0][1], serde_json::json!("Alice Updated"));
    // Other cells should be unchanged
    assert_eq!(stored.rows[0][0], serde_json::json!(1));
    assert_eq!(stored.rows[0][2], serde_json::json!("alice@example.com"));
    // Other row should be unchanged
    assert_eq!(stored.rows[1][1], serde_json::json!("Bob"));
}

#[test]
fn update_result_cell_result_not_found() {
    let state = test_app_state();

    let updates = HashMap::new();
    let result = update_result_cell_impl(&state, "conn-1", "nonexistent-tab", 0, updates, None);
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .contains("No results found for tab 'nonexistent-tab'"));
}

#[test]
fn update_result_cell_row_index_out_of_bounds() {
    let state = test_app_state();

    // Insert a stored result with 1 row
    {
        let mut results = state.results.write().unwrap();
        results.insert(
            ("conn-1".to_string(), "tab-1".to_string()),
            vec![StoredResult {
                query_id: "q1".to_string(),
                columns: vec![ColumnMeta {
                    name: "id".to_string(),
                    data_type: "INT".to_string(),
                }],
                rows: vec![vec![serde_json::json!(1)]],
                execution_time_ms: 5,
                affected_rows: 0,
                auto_limit_applied: false,
                page_size: 1000,
            }],
        );
    }

    let updates = HashMap::new();
    let result = update_result_cell_impl(&state, "conn-1", "tab-1", 5, updates, None);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Row index 5 out of bounds"));
}

#[test]
fn update_result_cell_multiple_columns() {
    let state = test_app_state();

    // Insert a stored result
    {
        let mut results = state.results.write().unwrap();
        results.insert(
            ("conn-1".to_string(), "tab-1".to_string()),
            vec![StoredResult {
                query_id: "q1".to_string(),
                columns: vec![
                    ColumnMeta {
                        name: "id".to_string(),
                        data_type: "INT".to_string(),
                    },
                    ColumnMeta {
                        name: "name".to_string(),
                        data_type: "VARCHAR".to_string(),
                    },
                    ColumnMeta {
                        name: "email".to_string(),
                        data_type: "VARCHAR".to_string(),
                    },
                ],
                rows: vec![vec![
                    serde_json::json!(1),
                    serde_json::json!("Alice"),
                    serde_json::json!("alice@example.com"),
                ]],
                execution_time_ms: 10,
                affected_rows: 0,
                auto_limit_applied: false,
                page_size: 1000,
            }],
        );
    }

    // Update both name and email at once
    let mut updates = HashMap::new();
    updates.insert(1, serde_json::json!("Alice New"));
    updates.insert(2, serde_json::json!("alice.new@example.com"));

    let result = update_result_cell_impl(&state, "conn-1", "tab-1", 0, updates, None);
    assert!(result.is_ok());

    // Verify both updates
    let results = state.results.read().unwrap();
    let result_vec = results
        .get(&("conn-1".to_string(), "tab-1".to_string()))
        .unwrap();
    let stored = &result_vec[0];
    assert_eq!(stored.rows[0][0], serde_json::json!(1)); // id unchanged
    assert_eq!(stored.rows[0][1], serde_json::json!("Alice New"));
    assert_eq!(
        stored.rows[0][2],
        serde_json::json!("alice.new@example.com")
    );
}

// ── analyze_query_for_edit_impl coverage-stub tests ────────────────────────────

#[tokio::test]
async fn analyze_query_for_edit_connection_not_found() {
    let state = test_app_state();

    let result =
        analyze_query_for_edit_impl(&state, "nonexistent-conn", "SELECT * FROM users").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[tokio::test]
async fn analyze_query_for_edit_non_select() {
    let state = test_app_state();

    // Non-SELECT statements return empty vec without needing a connection
    let result =
        analyze_query_for_edit_impl(&state, "conn-1", "INSERT INTO users VALUES (1)").await;
    // Under coverage: extract_tables returns empty → Ok(vec![])
    // Under real: extract_tables returns empty → Ok(vec![])
    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
}

#[tokio::test]
async fn analyze_query_for_edit_empty_sql() {
    let state = test_app_state();

    let result = analyze_query_for_edit_impl(&state, "conn-1", "").await;
    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
}
