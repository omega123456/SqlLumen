use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A connection group record as returned to callers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionGroupRecord {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
}

/// Map a rusqlite Row to a ConnectionGroupRecord.
fn row_to_group_record(row: &rusqlite::Row) -> rusqlite::Result<ConnectionGroupRecord> {
    Ok(ConnectionGroupRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        parent_id: row.get(2)?,
        sort_order: row.get(3)?,
        created_at: row.get(4)?,
    })
}

/// Insert a new connection group. Returns the new group's UUID.
pub fn insert_group(conn: &Connection, name: &str) -> Result<String> {
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO connection_groups (id, name, parent_id, sort_order, created_at)
         VALUES (?1, ?2, NULL, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
        params![id, name],
    )?;

    Ok(id)
}

/// Get a connection group by ID. Returns None if not found.
pub fn get_group(conn: &Connection, id: &str) -> Result<Option<ConnectionGroupRecord>> {
    conn.query_row(
        "SELECT id, name, parent_id, sort_order, created_at
         FROM connection_groups WHERE id = ?1",
        [id],
        row_to_group_record,
    )
    .optional()
}

/// List all connection groups, sorted by sort_order.
pub fn list_groups(conn: &Connection) -> Result<Vec<ConnectionGroupRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, parent_id, sort_order, created_at
         FROM connection_groups ORDER BY sort_order, name COLLATE NOCASE",
    )?;

    let rows = stmt.query_map([], row_to_group_record)?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row?);
    }
    Ok(records)
}

/// Update a connection group's name. Returns an error if the group does not exist.
/// Note: connection_groups has no updated_at column.
pub fn update_group(conn: &Connection, id: &str, name: &str) -> Result<()> {
    let rows_affected = conn.execute(
        "UPDATE connection_groups SET name = ?1 WHERE id = ?2",
        params![name, id],
    )?;

    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(())
}

/// Delete a connection group by ID.
/// Sets group_id = NULL on all connections in the group before deleting.
/// Returns an error if the group does not exist.
pub fn delete_group(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;

    // Nullify group_id on all connections in this group
    tx.execute(
        "UPDATE connections SET group_id = NULL WHERE group_id = ?1",
        [id],
    )?;

    // Delete the group
    let rows_affected = tx.execute(
        "DELETE FROM connection_groups WHERE id = ?1",
        [id],
    )?;

    if rows_affected == 0 {
        tx.rollback().ok();
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connections::{insert_connection, get_connection, NewConnectionData};
    use crate::db::migrations::run_migrations;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("should open in-memory connection");
        run_migrations(&conn).expect("should run migrations");
        conn
    }

    #[test]
    fn test_insert_group_returns_uuid() {
        let conn = test_conn();
        let id = insert_group(&conn, "Production").expect("should insert group");
        assert!(!id.is_empty());
        assert!(uuid::Uuid::parse_str(&id).is_ok(), "should be valid UUID");
    }

    #[test]
    fn test_get_group_returns_record() {
        let conn = test_conn();
        let id = insert_group(&conn, "Production").expect("should insert");

        let record = get_group(&conn, &id)
            .expect("should not error")
            .expect("should find group");

        assert_eq!(record.id, id);
        assert_eq!(record.name, "Production");
        assert!(record.parent_id.is_none());
        assert_eq!(record.sort_order, 0);
        assert!(!record.created_at.is_empty());
    }

    #[test]
    fn test_get_group_returns_none_for_missing() {
        let conn = test_conn();
        let result = get_group(&conn, "nonexistent").expect("should not error");
        assert!(result.is_none());
    }

    #[test]
    fn test_list_groups_empty() {
        let conn = test_conn();
        let list = list_groups(&conn).expect("should list groups");
        assert!(list.is_empty());
    }

    #[test]
    fn test_list_groups_returns_all_sorted() {
        let conn = test_conn();
        insert_group(&conn, "Beta").expect("should insert");
        insert_group(&conn, "Alpha").expect("should insert");

        let list = list_groups(&conn).expect("should list");
        assert_eq!(list.len(), 2);
        // Both have sort_order 0, so sorted by name
        assert_eq!(list[0].name, "Alpha");
        assert_eq!(list[1].name, "Beta");
    }

    #[test]
    fn test_update_group_modifies_name() {
        let conn = test_conn();
        let id = insert_group(&conn, "Old Name").expect("should insert");

        update_group(&conn, &id, "New Name").expect("should update");

        let record = get_group(&conn, &id)
            .expect("should not error")
            .expect("should find");
        assert_eq!(record.name, "New Name");
    }

    #[test]
    fn test_update_group_errors_for_missing() {
        let conn = test_conn();
        let result = update_group(&conn, "nonexistent", "Name");
        assert!(result.is_err());
    }

    #[test]
    fn test_delete_group_removes_record() {
        let conn = test_conn();
        let id = insert_group(&conn, "To Delete").expect("should insert");

        delete_group(&conn, &id).expect("should delete");

        let result = get_group(&conn, &id).expect("should not error");
        assert!(result.is_none());
    }

    #[test]
    fn test_delete_group_errors_for_missing() {
        let conn = test_conn();
        let result = delete_group(&conn, "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_delete_group_nullifies_connections() {
        let conn = test_conn();
        let group_id = insert_group(&conn, "My Group").expect("should insert group");

        // Create a connection in this group
        let conn_data = NewConnectionData {
            name: "Test DB".to_string(),
            host: "localhost".to_string(),
            port: 3306,
            username: "root".to_string(),
            default_database: None,
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            color: None,
            group_id: Some(group_id.clone()),
            read_only: false,
            sort_order: 0,
            connect_timeout_secs: None,
            keepalive_interval_secs: None,
        };
        let conn_id = insert_connection(&conn, &conn_data).expect("should insert connection");

        // Delete the group
        delete_group(&conn, &group_id).expect("should delete group");

        // Verify the connection's group_id is now NULL
        let record = get_connection(&conn, &conn_id)
            .expect("should not error")
            .expect("connection should still exist");
        assert!(
            record.group_id.is_none(),
            "group_id should be NULL after group deletion"
        );
    }

    #[test]
    fn test_insert_group_timestamp_is_iso8601() {
        let conn = test_conn();
        let id = insert_group(&conn, "Test").expect("should insert");

        let record = get_group(&conn, &id)
            .expect("should not error")
            .expect("should find");

        assert!(
            record.created_at.contains('T') && record.created_at.ends_with('Z'),
            "created_at should be ISO 8601: {}",
            record.created_at
        );
    }
}
