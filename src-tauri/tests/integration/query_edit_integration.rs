//! Integration tests for `analyze_query_for_edit_impl` and `update_result_cell_impl`.

use crate::common::test_app_state;
use sqllumen_lib::mysql::query_executor::{
    analyze_query_for_edit_impl, fetch_cached_rows_impl, update_result_cell_impl, ColumnMeta,
    StoredResult,
};
use std::collections::HashMap;
use std::sync::Arc;

// ── update_result_cell_impl tests ──────────────────────────────────────────────

#[test]
fn update_result_cell_successful() {
    let state = test_app_state();

    // Insert a stored result
    state.result_cache.insert(
        "conn-1",
        "tab-1",
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
            rows: crate::common::shared_rows(vec![
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
            ]),
            execution_time_ms: 10,
            total_time_ms: 10,
            affected_rows: 0,
            auto_limit_applied: false,
        }],
    );

    // Update name in row 0
    let mut updates = HashMap::new();
    updates.insert(1, serde_json::json!("Alice Updated"));

    let result = update_result_cell_impl(&state, "conn-1", "tab-1", 0, updates, None);
    assert!(result.is_ok());

    // Verify the update
    let entry = state
        .result_cache
        .get("conn-1", "tab-1")
        .into_entry()
        .unwrap();
    let stored = &entry.value[0];
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
    state.result_cache.insert(
        "conn-1",
        "tab-1",
        vec![StoredResult {
            query_id: "q1".to_string(),
            columns: vec![ColumnMeta {
                name: "id".to_string(),
                data_type: "INT".to_string(),
            }],
            rows: crate::common::shared_rows(vec![vec![serde_json::json!(1)]]),
            execution_time_ms: 5,
            total_time_ms: 5,
            affected_rows: 0,
            auto_limit_applied: false,
        }],
    );

    let updates = HashMap::new();
    let result = update_result_cell_impl(&state, "conn-1", "tab-1", 5, updates, None);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Row index 5 out of bounds"));
}

#[test]
fn update_result_cell_multiple_columns() {
    let state = test_app_state();

    // Insert a stored result
    state.result_cache.insert(
        "conn-1",
        "tab-1",
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
            rows: crate::common::shared_rows(vec![vec![
                serde_json::json!(1),
                serde_json::json!("Alice"),
                serde_json::json!("alice@example.com"),
            ]]),
            execution_time_ms: 10,
            total_time_ms: 10,
            affected_rows: 0,
            auto_limit_applied: false,
        }],
    );

    // Update both name and email at once
    let mut updates = HashMap::new();
    updates.insert(1, serde_json::json!("Alice New"));
    updates.insert(2, serde_json::json!("alice.new@example.com"));

    let result = update_result_cell_impl(&state, "conn-1", "tab-1", 0, updates, None);
    assert!(result.is_ok());

    // Verify both updates
    let entry = state
        .result_cache
        .get("conn-1", "tab-1")
        .into_entry()
        .unwrap();
    let stored = &entry.value[0];
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

// ── update_result_cell_impl row sharing ────────────────────────────────────────

fn insert_three_row_result(state: &sqllumen_lib::state::AppState) {
    state.result_cache.insert(
        "conn-1",
        "tab-1",
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
            ],
            rows: crate::common::shared_rows(vec![
                vec![serde_json::json!(1), serde_json::json!("Alice")],
                vec![serde_json::json!(2), serde_json::json!("Bob")],
                vec![serde_json::json!(3), serde_json::json!("Cara")],
            ]),
            execution_time_ms: 1,
            total_time_ms: 1,
            affected_rows: 0,
            auto_limit_applied: false,
        }],
    );
}

#[test]
fn update_result_cell_leaves_previously_fetched_rows_untouched_and_shares_other_rows() {
    let state = test_app_state();
    insert_three_row_result(&state);

    let before = fetch_cached_rows_impl(&state, "conn-1", "tab-1", "q1", None)
        .expect("fetch before edit")
        .rows;

    let mut updates = HashMap::new();
    updates.insert(1, serde_json::json!("Bobby"));
    update_result_cell_impl(&state, "conn-1", "tab-1", 1, updates, None).expect("edit succeeds");

    // The Arc handed out before the edit still holds the old value.
    assert_eq!(before[1][1], serde_json::json!("Bob"));

    let after = fetch_cached_rows_impl(&state, "conn-1", "tab-1", "q1", None)
        .expect("fetch after edit")
        .rows;
    assert_eq!(after[1][1], serde_json::json!("Bobby"));
    assert!(!Arc::ptr_eq(&before, &after), "row list must be replaced");
    assert!(!Arc::ptr_eq(&before[1], &after[1]), "edited row is new");
    assert!(
        Arc::ptr_eq(&before[0], &after[0]),
        "unedited rows are shared"
    );
    assert!(
        Arc::ptr_eq(&before[2], &after[2]),
        "unedited rows are shared"
    );
}

#[test]
fn update_result_cell_result_index_out_of_range_error_unchanged() {
    let state = test_app_state();
    insert_three_row_result(&state);

    let err = update_result_cell_impl(&state, "conn-1", "tab-1", 0, HashMap::new(), Some(3))
        .expect_err("result index 3 does not exist");
    assert_eq!(err, "Result index 3 out of range (total: 1)");
}

#[test]
fn update_result_cell_row_index_out_of_bounds_leaves_cache_unchanged() {
    let state = test_app_state();
    insert_three_row_result(&state);
    let before = fetch_cached_rows_impl(&state, "conn-1", "tab-1", "q1", None)
        .expect("fetch before edit")
        .rows;

    let mut updates = HashMap::new();
    updates.insert(1, serde_json::json!("ignored"));
    let err = update_result_cell_impl(&state, "conn-1", "tab-1", 3, updates, None)
        .expect_err("row 3 does not exist");
    assert_eq!(err, "Row index 3 out of bounds (total rows: 3)");

    let after = fetch_cached_rows_impl(&state, "conn-1", "tab-1", "q1", None)
        .expect("fetch after failed edit")
        .rows;
    assert!(Arc::ptr_eq(&before, &after), "failed edit must not write");
}

#[test]
fn update_result_cell_expired_results_error_unchanged() {
    let state = test_app_state();
    insert_three_row_result(&state);
    state.result_cache.remove("conn-1", "tab-1");

    let err = update_result_cell_impl(&state, "conn-1", "tab-1", 0, HashMap::new(), None)
        .expect_err("removed results are expired");
    assert!(err.starts_with("results_expired:"), "{err}");
}
