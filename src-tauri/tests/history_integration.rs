//! Command-layer history `_impl` functions (`commands/history.rs`).

mod common;

use sqllumen_lib::commands::history::{
    clear_history_impl, delete_history_entry_impl, list_history_impl,
};
use sqllumen_lib::db::history::{self, NewHistoryEntry};

fn insert_sample_entries(state: &sqllumen_lib::state::AppState, connection_id: &str, count: usize) {
    let conn = state.db.lock().expect("db lock");
    for i in 0..count {
        let entry = NewHistoryEntry {
            connection_id: connection_id.to_string(),
            database_name: Some("testdb".to_string()),
            sql_text: format!("SELECT {i} FROM t"),
            duration_ms: Some((i as i64) * 10),
            row_count: Some(i as i64),
            affected_rows: Some(0),
            success: true,
            error_message: None,
        };
        history::insert_history(&conn, &entry).expect("insert should work");
    }
}

#[test]
fn test_list_history_empty() {
    let state = common::test_app_state();
    let page = list_history_impl(&state, "p1", 1, 10, None).expect("should list");
    assert_eq!(page.entries.len(), 0);
    assert_eq!(page.total, 0);
}

#[test]
fn test_list_history_with_entries() {
    let state = common::test_app_state();
    insert_sample_entries(&state, "p1", 5);
    let page = list_history_impl(&state, "p1", 1, 10, None).expect("should list");
    assert_eq!(page.entries.len(), 5);
    assert_eq!(page.total, 5);
}

#[test]
fn test_list_history_pagination() {
    let state = common::test_app_state();
    insert_sample_entries(&state, "p1", 15);
    let page1 = list_history_impl(&state, "p1", 1, 10, None).expect("page 1");
    assert_eq!(page1.entries.len(), 10);
    assert_eq!(page1.total, 15);

    let page2 = list_history_impl(&state, "p1", 2, 10, None).expect("page 2");
    assert_eq!(page2.entries.len(), 5);
    assert_eq!(page2.total, 15);
}

#[test]
fn test_list_history_search() {
    let state = common::test_app_state();
    insert_sample_entries(&state, "p1", 10);
    // Insert a distinctive entry
    {
        let conn = state.db.lock().expect("db lock");
        let entry = NewHistoryEntry {
            connection_id: "p1".to_string(),
            database_name: None,
            sql_text: "INSERT INTO special_table VALUES (42)".to_string(),
            duration_ms: Some(5),
            row_count: Some(1),
            affected_rows: Some(1),
            success: true,
            error_message: None,
        };
        history::insert_history(&conn, &entry).expect("insert");
    }

    let page = list_history_impl(&state, "p1", 1, 50, Some("special_table")).expect("search");
    assert_eq!(page.entries.len(), 1);
    assert!(page.entries[0].sql_text.contains("special_table"));
}

#[test]
fn test_list_history_connection_isolation() {
    let state = common::test_app_state();
    insert_sample_entries(&state, "p1", 3);
    insert_sample_entries(&state, "p2", 2);

    let page1 = list_history_impl(&state, "p1", 1, 50, None).expect("p1");
    assert_eq!(page1.total, 3);

    let page2 = list_history_impl(&state, "p2", 1, 50, None).expect("p2");
    assert_eq!(page2.total, 2);
}

#[test]
fn test_delete_history_entry() {
    let state = common::test_app_state();
    let id = {
        let conn = state.db.lock().expect("db lock");
        let entry = NewHistoryEntry {
            connection_id: "p1".to_string(),
            database_name: None,
            sql_text: "SELECT 1".to_string(),
            duration_ms: Some(10),
            row_count: Some(1),
            affected_rows: Some(0),
            success: true,
            error_message: None,
        };
        history::insert_history(&conn, &entry).expect("insert")
    };

    let deleted = delete_history_entry_impl(&state, id).expect("should delete");
    assert!(deleted);

    // Verify it's gone
    let page = list_history_impl(&state, "p1", 1, 50, None).expect("list");
    assert_eq!(page.total, 0);
}

#[test]
fn test_delete_nonexistent_history_entry() {
    let state = common::test_app_state();
    let deleted = delete_history_entry_impl(&state, 99999).expect("should not error");
    assert!(!deleted);
}

#[test]
fn test_clear_history() {
    let state = common::test_app_state();
    insert_sample_entries(&state, "p1", 5);
    insert_sample_entries(&state, "p2", 3);

    let cleared = clear_history_impl(&state, "p1").expect("should clear");
    assert_eq!(cleared, 5);

    // p1 should be empty
    let page1 = list_history_impl(&state, "p1", 1, 50, None).expect("p1");
    assert_eq!(page1.total, 0);

    // p2 should still have 3
    let page2 = list_history_impl(&state, "p2", 1, 50, None).expect("p2");
    assert_eq!(page2.total, 3);
}

// ── session_id resolution fallback ────────────────────────────────────────

#[test]
fn test_list_history_unknown_session_id_falls_back_to_raw_id() {
    let state = common::test_app_state();
    // Insert entries keyed by "profile-abc" (simulating writes via resolved profile_id)
    insert_sample_entries(&state, "profile-abc", 3);

    // When the registry has no entry for "profile-abc", get_profile_id returns None
    // and unwrap_or_else falls back to the raw id — so we still find the entries.
    let page = list_history_impl(&state, "profile-abc", 1, 50, None).expect("should list");
    assert_eq!(page.total, 3);
    assert_eq!(page.entries.len(), 3);
}

#[test]
fn test_clear_history_unknown_session_id_falls_back_to_raw_id() {
    let state = common::test_app_state();
    insert_sample_entries(&state, "profile-xyz", 4);

    // Registry is empty, so clear_history_impl falls back to raw id
    let cleared = clear_history_impl(&state, "profile-xyz").expect("should clear");
    assert_eq!(cleared, 4);

    let page = list_history_impl(&state, "profile-xyz", 1, 50, None).expect("list");
    assert_eq!(page.total, 0);
}

// ── prune_all_history ─────────────────────────────────────────────────────

#[test]
fn test_prune_all_history_empty_db() {
    let state = common::test_app_state();
    let conn = state.db.lock().expect("db lock");
    let pruned = history::prune_all_history(&conn).expect("prune should succeed");
    assert_eq!(pruned, 0);
}

#[test]
fn test_prune_all_history_recent_entries() {
    let state = common::test_app_state();
    // Insert entries for multiple connections
    insert_sample_entries(&state, "conn-a", 3);
    insert_sample_entries(&state, "conn-b", 2);

    let conn = state.db.lock().expect("db lock");
    // All entries are recent, so nothing should be pruned
    let pruned = history::prune_all_history(&conn).expect("prune should succeed");
    assert_eq!(pruned, 0);
}

// ── insert_history_batch edge cases ───────────────────────────────────────

#[test]
fn test_insert_history_batch_empty() {
    let state = common::test_app_state();
    let conn = state.db.lock().expect("db lock");
    // Empty batch should succeed without inserting anything
    history::insert_history_batch(&conn, &[]).expect("empty batch should succeed");

    drop(conn);
    let page = list_history_impl(&state, "any", 1, 50, None).expect("list");
    assert_eq!(page.total, 0);
}

// ── list_history page zero defaults ───────────────────────────────────────

#[test]
fn test_list_history_page_zero_clamps_to_one() {
    let state = common::test_app_state();
    insert_sample_entries(&state, "p1", 5);
    // Page 0 should be clamped to page 1 internally
    let page = list_history_impl(&state, "p1", 0, 10, None).expect("page 0 should work");
    assert_eq!(page.entries.len(), 5);
    assert_eq!(page.page, 1);
}

// ── Error entry fields ───────────────────────────────────────────────────

#[test]
fn test_list_history_error_entry_fields() {
    let state = common::test_app_state();
    {
        let conn = state.db.lock().expect("db lock");
        let entry = history::NewHistoryEntry {
            connection_id: "p1".to_string(),
            database_name: Some("testdb".to_string()),
            sql_text: "DROP TABLE oops".to_string(),
            duration_ms: Some(3),
            row_count: Some(0),
            affected_rows: Some(0),
            success: false,
            error_message: Some("Table does not exist".to_string()),
        };
        history::insert_history(&conn, &entry).expect("insert");
    }

    let page = list_history_impl(&state, "p1", 1, 50, None).expect("list");
    assert_eq!(page.entries.len(), 1);
    let e = &page.entries[0];
    assert!(!e.success);
    assert_eq!(e.error_message.as_deref(), Some("Table does not exist"));
    assert_eq!(e.database_name.as_deref(), Some("testdb"));
    assert_eq!(e.duration_ms, Some(3));
}

// ── Search with no matches ───────────────────────────────────────────────

#[test]
fn test_list_history_search_no_matches() {
    let state = common::test_app_state();
    insert_sample_entries(&state, "p1", 5);
    let page = list_history_impl(&state, "p1", 1, 50, Some("NONEXISTENT_KEYWORD")).expect("search");
    assert_eq!(page.entries.len(), 0);
    assert_eq!(page.total, 0);
}

// ── Batch insert and verify fields ───────────────────────────────────────

#[test]
fn test_insert_history_batch_with_mixed_entries() {
    let state = common::test_app_state();
    let entries = vec![
        history::NewHistoryEntry {
            connection_id: "p1".to_string(),
            database_name: Some("db1".to_string()),
            sql_text: "SELECT 1".to_string(),
            duration_ms: Some(5),
            row_count: Some(1),
            affected_rows: Some(0),
            success: true,
            error_message: None,
        },
        history::NewHistoryEntry {
            connection_id: "p1".to_string(),
            database_name: None,
            sql_text: "BAD QUERY".to_string(),
            duration_ms: Some(2),
            row_count: Some(0),
            affected_rows: Some(0),
            success: false,
            error_message: Some("syntax error".to_string()),
        },
    ];

    {
        let conn = state.db.lock().expect("db lock");
        history::insert_history_batch(&conn, &entries).expect("batch insert");
    }

    let page = list_history_impl(&state, "p1", 1, 50, None).expect("list");
    assert_eq!(page.total, 2);
    // Entries are ordered by timestamp DESC; both have the same timestamp, so check presence
    let has_success = page
        .entries
        .iter()
        .any(|e| e.success && e.sql_text == "SELECT 1");
    let has_error = page
        .entries
        .iter()
        .any(|e| !e.success && e.error_message.as_deref() == Some("syntax error"));
    assert!(has_success);
    assert!(has_error);
}

// ── Error-path coverage: trigger map_err closures ────────────────────────

/// Drop the `query_history` table so that subsequent `*_impl` calls hit the
/// `map_err(|e| e.to_string())` closures in `commands/history.rs`.
#[test]
fn test_list_history_impl_error_when_table_missing() {
    let state = common::test_app_state();
    {
        let conn = state.db.lock().expect("db lock");
        conn.execute_batch("DROP TABLE IF EXISTS query_history")
            .expect("drop");
    }
    let result = list_history_impl(&state, "p1", 1, 10, None);
    assert!(
        result.is_err(),
        "should error when query_history table is missing"
    );
    assert!(
        result.unwrap_err().contains("no such table"),
        "error should mention missing table"
    );
}

#[test]
fn test_delete_history_entry_impl_error_when_table_missing() {
    let state = common::test_app_state();
    {
        let conn = state.db.lock().expect("db lock");
        conn.execute_batch("DROP TABLE IF EXISTS query_history")
            .expect("drop");
    }
    let result = delete_history_entry_impl(&state, 1);
    assert!(
        result.is_err(),
        "should error when query_history table is missing"
    );
}

#[test]
fn test_clear_history_impl_error_when_table_missing() {
    let state = common::test_app_state();
    {
        let conn = state.db.lock().expect("db lock");
        conn.execute_batch("DROP TABLE IF EXISTS query_history")
            .expect("drop");
    }
    let result = clear_history_impl(&state, "p1");
    assert!(
        result.is_err(),
        "should error when query_history table is missing"
    );
}

// ── Serde deserialization coverage ───────────────────────────────────────

#[test]
fn test_history_entry_deserialize_from_json() {
    use sqllumen_lib::db::history::HistoryEntry;

    let json = serde_json::json!({
        "id": 42,
        "connectionId": "conn-1",
        "databaseName": "mydb",
        "sqlText": "SELECT * FROM users",
        "timestamp": "2025-06-01T12:00:00Z",
        "durationMs": 150,
        "rowCount": 10,
        "affectedRows": 0,
        "success": true,
        "errorMessage": null
    });

    let entry: HistoryEntry =
        serde_json::from_value(json).expect("should deserialize HistoryEntry");
    assert_eq!(entry.id, 42);
    assert_eq!(entry.connection_id, "conn-1");
    assert_eq!(entry.database_name.as_deref(), Some("mydb"));
    assert_eq!(entry.sql_text, "SELECT * FROM users");
    assert_eq!(entry.timestamp, "2025-06-01T12:00:00Z");
    assert_eq!(entry.duration_ms, Some(150));
    assert_eq!(entry.row_count, Some(10));
    assert_eq!(entry.affected_rows, Some(0));
    assert!(entry.success);
    assert!(entry.error_message.is_none());
}

#[test]
fn test_history_page_deserialize_from_json() {
    use sqllumen_lib::db::history::HistoryPage;

    let json = serde_json::json!({
        "entries": [
            {
                "id": 1,
                "connectionId": "c1",
                "databaseName": null,
                "sqlText": "SELECT 1",
                "timestamp": "2025-01-01T00:00:00Z",
                "durationMs": 5,
                "rowCount": 1,
                "affectedRows": 0,
                "success": true,
                "errorMessage": null
            }
        ],
        "total": 100,
        "page": 1,
        "pageSize": 25
    });

    let page: HistoryPage = serde_json::from_value(json).expect("should deserialize HistoryPage");
    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.total, 100);
    assert_eq!(page.page, 1);
    assert_eq!(page.page_size, 25);
    assert_eq!(page.entries[0].id, 1);
    assert_eq!(page.entries[0].sql_text, "SELECT 1");
}
