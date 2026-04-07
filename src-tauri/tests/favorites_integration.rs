//! Command-layer favorites `_impl` functions (`commands/favorites.rs`).

mod common;

use mysql_client_lib::commands::favorites::{
    create_favorite_impl, delete_favorite_impl, list_favorites_impl, update_favorite_impl,
};
use mysql_client_lib::db::favorites::{CreateFavoriteInput, UpdateFavoriteInput};

fn sample_create_input(connection_id: Option<&str>, name: &str) -> CreateFavoriteInput {
    CreateFavoriteInput {
        name: name.to_string(),
        sql_text: format!("SELECT * FROM {name}"),
        description: Some(format!("Description for {name}")),
        category: None,
        connection_id: connection_id.map(|s| s.to_string()),
    }
}

#[test]
fn test_create_and_list_favorites() {
    let state = common::test_app_state();
    let id = create_favorite_impl(&state, sample_create_input(Some("p1"), "fav1")).expect("create");
    assert!(id > 0);

    let list = list_favorites_impl(&state, "p1").expect("list");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "fav1");
    assert_eq!(list[0].sql_text, "SELECT * FROM fav1");
    assert_eq!(list[0].description.as_deref(), Some("Description for fav1"));
}

#[test]
fn test_list_favorites_empty() {
    let state = common::test_app_state();
    let list = list_favorites_impl(&state, "p1").expect("list");
    assert!(list.is_empty());
}

#[test]
fn test_list_favorites_connection_isolation() {
    let state = common::test_app_state();
    create_favorite_impl(&state, sample_create_input(Some("p1"), "a")).expect("create p1");
    create_favorite_impl(&state, sample_create_input(Some("p1"), "b")).expect("create p1");
    create_favorite_impl(&state, sample_create_input(Some("p2"), "c")).expect("create p2");

    let p1 = list_favorites_impl(&state, "p1").expect("list p1");
    assert_eq!(p1.len(), 2);

    let p2 = list_favorites_impl(&state, "p2").expect("list p2");
    assert_eq!(p2.len(), 1);
}

#[test]
fn test_global_favorites_included() {
    let state = common::test_app_state();
    // Create a global favorite (no connection_id)
    create_favorite_impl(&state, sample_create_input(None, "global_fav")).expect("create global");
    // Create a connection-specific favorite
    create_favorite_impl(&state, sample_create_input(Some("p1"), "conn_fav")).expect("create conn");

    // Listing for p1 should include both global and connection-specific
    let list = list_favorites_impl(&state, "p1").expect("list p1");
    assert_eq!(list.len(), 2);
}

#[test]
fn test_update_favorite() {
    let state = common::test_app_state();
    let id = create_favorite_impl(&state, sample_create_input(Some("p1"), "original")).expect("create");

    let updated = update_favorite_impl(
        &state,
        id,
        UpdateFavoriteInput {
            name: "updated".to_string(),
            sql_text: "SELECT 42".to_string(),
            description: Some("Updated description".to_string()),
            category: Some("queries".to_string()),
        },
    )
    .expect("update");
    assert!(updated);

    let list = list_favorites_impl(&state, "p1").expect("list");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "updated");
    assert_eq!(list[0].sql_text, "SELECT 42");
    assert_eq!(list[0].description.as_deref(), Some("Updated description"));
    assert_eq!(list[0].category.as_deref(), Some("queries"));
}

#[test]
fn test_update_nonexistent_favorite() {
    let state = common::test_app_state();
    let updated = update_favorite_impl(
        &state,
        99999,
        UpdateFavoriteInput {
            name: "x".to_string(),
            sql_text: "SELECT 1".to_string(),
            description: None,
            category: None,
        },
    )
    .expect("should not error");
    assert!(!updated);
}

#[test]
fn test_delete_favorite() {
    let state = common::test_app_state();
    let id = create_favorite_impl(&state, sample_create_input(Some("p1"), "to_delete")).expect("create");

    let deleted = delete_favorite_impl(&state, id).expect("delete");
    assert!(deleted);

    let list = list_favorites_impl(&state, "p1").expect("list");
    assert!(list.is_empty());
}

#[test]
fn test_delete_nonexistent_favorite() {
    let state = common::test_app_state();
    let deleted = delete_favorite_impl(&state, 99999).expect("should not error");
    assert!(!deleted);
}

#[test]
fn test_favorites_ordering_newest_first() {
    let state = common::test_app_state();
    create_favorite_impl(&state, sample_create_input(Some("p1"), "first")).expect("create");
    // Small delay to ensure different timestamps
    std::thread::sleep(std::time::Duration::from_millis(10));
    create_favorite_impl(&state, sample_create_input(Some("p1"), "second")).expect("create");

    let list = list_favorites_impl(&state, "p1").expect("list");
    assert_eq!(list.len(), 2);
    // Newest first
    assert_eq!(list[0].name, "second");
    assert_eq!(list[1].name, "first");
}

// ── session_id resolution fallback ────────────────────────────────────────

#[test]
fn test_list_favorites_unknown_session_id_falls_back_to_raw_id() {
    let state = common::test_app_state();
    // Create a favorite keyed by "profile-abc" (simulating a resolved profile_id write)
    create_favorite_impl(&state, sample_create_input(Some("profile-abc"), "fav1")).expect("create");

    // Registry is empty, so list_favorites_impl falls back to the raw id
    let list = list_favorites_impl(&state, "profile-abc").expect("list");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "fav1");
}

#[test]
fn test_create_favorite_unknown_session_id_falls_back_to_raw_id() {
    let state = common::test_app_state();
    // Registry is empty, so create_favorite_impl falls back to the raw id "session-123"
    let id = create_favorite_impl(
        &state,
        sample_create_input(Some("session-123"), "my_fav"),
    )
    .expect("create");
    assert!(id > 0);

    // The favorite should be stored under the raw id and retrievable
    let list = list_favorites_impl(&state, "session-123").expect("list");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "my_fav");
    assert_eq!(list[0].connection_id.as_deref(), Some("session-123"));
}

// ── get_favorite ─────────────────────────────────────────────────────────

#[test]
fn test_get_favorite_by_id() {
    let state = common::test_app_state();
    let id = create_favorite_impl(&state, sample_create_input(Some("p1"), "my_query")).expect("create");

    let conn = state.db.lock().expect("db lock");
    let favorite = mysql_client_lib::db::favorites::get_favorite(&conn, id)
        .expect("should succeed")
        .expect("should find favorite");

    assert_eq!(favorite.id, id);
    assert_eq!(favorite.name, "my_query");
    assert_eq!(favorite.sql_text, "SELECT * FROM my_query");
    assert_eq!(favorite.description.as_deref(), Some("Description for my_query"));
    assert_eq!(favorite.connection_id.as_deref(), Some("p1"));
    assert!(favorite.category.is_none());
}

#[test]
fn test_get_favorite_nonexistent() {
    let state = common::test_app_state();
    let conn = state.db.lock().expect("db lock");
    let result = mysql_client_lib::db::favorites::get_favorite(&conn, 99999)
        .expect("should succeed");
    assert!(result.is_none());
}

// ── create with category ─────────────────────────────────────────────────

#[test]
fn test_create_favorite_with_category() {
    let state = common::test_app_state();
    let input = mysql_client_lib::db::favorites::CreateFavoriteInput {
        name: "categorized".to_string(),
        sql_text: "SELECT * FROM reports".to_string(),
        description: Some("A report query".to_string()),
        category: Some("reports".to_string()),
        connection_id: Some("p1".to_string()),
    };
    let id = create_favorite_impl(&state, input).expect("create");

    let list = list_favorites_impl(&state, "p1").expect("list");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].category.as_deref(), Some("reports"));
    assert_eq!(list[0].id, id);
}

// ── global favorite without connection_id ────────────────────────────────

#[test]
fn test_get_global_favorite_by_id() {
    let state = common::test_app_state();
    let id = create_favorite_impl(&state, sample_create_input(None, "global_q")).expect("create");

    let conn = state.db.lock().expect("db lock");
    let favorite = mysql_client_lib::db::favorites::get_favorite(&conn, id)
        .expect("should succeed")
        .expect("should find favorite");

    assert_eq!(favorite.id, id);
    assert_eq!(favorite.name, "global_q");
    assert!(favorite.connection_id.is_none());
}

// ── Error-path coverage: trigger map_err closures ────────────────────────

/// Drop the `favorites` table so that subsequent `*_impl` calls hit the
/// `map_err(|e| e.to_string())` closures in `commands/favorites.rs`.
#[test]
fn test_create_favorite_impl_error_when_table_missing() {
    let state = common::test_app_state();
    // Drop the favorites table so the INSERT fails.
    {
        let conn = state.db.lock().expect("db lock");
        conn.execute_batch("DROP TABLE IF EXISTS favorites").expect("drop");
    }
    let result = create_favorite_impl(
        &state,
        sample_create_input(Some("p1"), "will_fail"),
    );
    assert!(result.is_err(), "should error when favorites table is missing");
    assert!(
        result.unwrap_err().contains("no such table"),
        "error should mention missing table"
    );
}

#[test]
fn test_list_favorites_impl_error_when_table_missing() {
    let state = common::test_app_state();
    {
        let conn = state.db.lock().expect("db lock");
        conn.execute_batch("DROP TABLE IF EXISTS favorites").expect("drop");
    }
    let result = list_favorites_impl(&state, "p1");
    assert!(result.is_err(), "should error when favorites table is missing");
}

#[test]
fn test_update_favorite_impl_error_when_table_missing() {
    let state = common::test_app_state();
    {
        let conn = state.db.lock().expect("db lock");
        conn.execute_batch("DROP TABLE IF EXISTS favorites").expect("drop");
    }
    let result = update_favorite_impl(
        &state,
        1,
        UpdateFavoriteInput {
            name: "x".to_string(),
            sql_text: "SELECT 1".to_string(),
            description: None,
            category: None,
        },
    );
    assert!(result.is_err(), "should error when favorites table is missing");
}

#[test]
fn test_delete_favorite_impl_error_when_table_missing() {
    let state = common::test_app_state();
    {
        let conn = state.db.lock().expect("db lock");
        conn.execute_batch("DROP TABLE IF EXISTS favorites").expect("drop");
    }
    let result = delete_favorite_impl(&state, 1);
    assert!(result.is_err(), "should error when favorites table is missing");
}

// ── Serde deserialization coverage ───────────────────────────────────────

#[test]
fn test_create_favorite_input_deserialize_from_json() {
    let json = serde_json::json!({
        "name": "My Query",
        "sqlText": "SELECT * FROM users",
        "description": "Fetches all users",
        "category": "reports",
        "connectionId": "conn-1"
    });

    let input: CreateFavoriteInput =
        serde_json::from_value(json).expect("should deserialize CreateFavoriteInput");
    assert_eq!(input.name, "My Query");
    assert_eq!(input.sql_text, "SELECT * FROM users");
    assert_eq!(input.description.as_deref(), Some("Fetches all users"));
    assert_eq!(input.category.as_deref(), Some("reports"));
    assert_eq!(input.connection_id.as_deref(), Some("conn-1"));
}

#[test]
fn test_create_favorite_input_deserialize_minimal() {
    let json = serde_json::json!({
        "name": "Quick",
        "sqlText": "SELECT 1"
    });

    let input: CreateFavoriteInput =
        serde_json::from_value(json).expect("should deserialize with optional fields missing");
    assert_eq!(input.name, "Quick");
    assert_eq!(input.sql_text, "SELECT 1");
    assert!(input.description.is_none());
    assert!(input.category.is_none());
    assert!(input.connection_id.is_none());
}

#[test]
fn test_update_favorite_input_deserialize_from_json() {
    let json = serde_json::json!({
        "name": "Updated",
        "sqlText": "SELECT 42",
        "description": "Updated desc",
        "category": "misc"
    });

    let input: UpdateFavoriteInput =
        serde_json::from_value(json).expect("should deserialize UpdateFavoriteInput");
    assert_eq!(input.name, "Updated");
    assert_eq!(input.sql_text, "SELECT 42");
    assert_eq!(input.description.as_deref(), Some("Updated desc"));
    assert_eq!(input.category.as_deref(), Some("misc"));
}

#[test]
fn test_favorite_entry_deserialize_from_json() {
    use mysql_client_lib::db::favorites::FavoriteEntry;

    let json = serde_json::json!({
        "id": 7,
        "name": "Test Fav",
        "sqlText": "SELECT * FROM orders",
        "description": "Order query",
        "category": "admin",
        "connectionId": "conn-x",
        "createdAt": "2025-01-15T10:30:00Z",
        "updatedAt": "2025-01-15T11:00:00Z"
    });

    let entry: FavoriteEntry =
        serde_json::from_value(json).expect("should deserialize FavoriteEntry");
    assert_eq!(entry.id, 7);
    assert_eq!(entry.name, "Test Fav");
    assert_eq!(entry.sql_text, "SELECT * FROM orders");
    assert_eq!(entry.description.as_deref(), Some("Order query"));
    assert_eq!(entry.category.as_deref(), Some("admin"));
    assert_eq!(entry.connection_id.as_deref(), Some("conn-x"));
    assert_eq!(entry.created_at, "2025-01-15T10:30:00Z");
    assert_eq!(entry.updated_at, "2025-01-15T11:00:00Z");
}
