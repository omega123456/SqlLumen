use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Data required to create a new connection profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewConnectionData {
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub default_database: Option<String>,
    pub ssl_enabled: bool,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub color: Option<String>,
    pub group_id: Option<String>,
    pub read_only: bool,
    pub sort_order: i64,
    pub connect_timeout_secs: Option<i64>,
    pub keepalive_interval_secs: Option<i64>,
}

/// Data for updating an existing connection profile (full replacement).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConnectionData {
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub default_database: Option<String>,
    pub ssl_enabled: bool,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub color: Option<String>,
    pub group_id: Option<String>,
    pub read_only: bool,
    pub sort_order: i64,
    pub connect_timeout_secs: Option<i64>,
    pub keepalive_interval_secs: Option<i64>,
}

/// A connection record as returned to callers. Excludes keychain_ref,
/// includes has_password computed from keychain_ref presence.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRecord {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub has_password: bool,
    pub default_database: Option<String>,
    pub ssl_enabled: bool,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub color: Option<String>,
    pub group_id: Option<String>,
    pub read_only: bool,
    pub sort_order: i64,
    pub connect_timeout_secs: Option<i64>,
    pub keepalive_interval_secs: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

/// The SELECT columns used by both get and list queries.
const CONNECTION_SELECT_COLUMNS: &str = "
    c.id, c.name, c.host, c.port, c.username,
    (c.keychain_ref IS NOT NULL AND c.keychain_ref != '') as has_password,
    c.default_database, c.ssl_enabled, c.ssl_ca_path, c.ssl_cert_path, c.ssl_key_path,
    c.color, c.group_id, c.read_only, c.sort_order,
    c.connect_timeout_secs, c.keepalive_interval_secs,
    c.created_at, c.updated_at";

/// Map a rusqlite Row to a ConnectionRecord.
fn row_to_connection_record(row: &rusqlite::Row) -> rusqlite::Result<ConnectionRecord> {
    Ok(ConnectionRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        port: row.get(3)?,
        username: row.get(4)?,
        has_password: row.get(5)?,
        default_database: row.get(6)?,
        ssl_enabled: row.get(7)?,
        ssl_ca_path: row.get(8)?,
        ssl_cert_path: row.get(9)?,
        ssl_key_path: row.get(10)?,
        color: row.get(11)?,
        group_id: row.get(12)?,
        read_only: row.get(13)?,
        sort_order: row.get(14)?,
        connect_timeout_secs: row.get(15)?,
        keepalive_interval_secs: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

/// Insert a new connection profile. Sets keychain_ref to the generated UUID.
/// Returns the new connection's UUID.
pub fn insert_connection(conn: &Connection, data: &NewConnectionData) -> Result<String> {
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO connections (
            id, name, host, port, username, keychain_ref,
            default_database, ssl_enabled, ssl_ca_path, ssl_cert_path, ssl_key_path,
            color, group_id, read_only, sort_order,
            connect_timeout_secs, keepalive_interval_secs,
            created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6,
            ?7, ?8, ?9, ?10, ?11,
            ?12, ?13, ?14, ?15,
            ?16, ?17,
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )",
        params![
            id,
            data.name,
            data.host,
            data.port,
            data.username,
            id, // keychain_ref = id
            data.default_database,
            data.ssl_enabled,
            data.ssl_ca_path,
            data.ssl_cert_path,
            data.ssl_key_path,
            data.color,
            data.group_id,
            data.read_only,
            data.sort_order,
            data.connect_timeout_secs,
            data.keepalive_interval_secs,
        ],
    )?;

    Ok(id)
}

/// Get a connection by ID. Returns None if not found.
/// Returns all fields except keychain_ref; includes has_password.
pub fn get_connection(conn: &Connection, id: &str) -> Result<Option<ConnectionRecord>> {
    let sql = format!(
        "SELECT {} FROM connections c WHERE c.id = ?1",
        CONNECTION_SELECT_COLUMNS
    );

    conn.query_row(&sql, [id], row_to_connection_record)
        .optional()
}

/// List all connections, sorted by group sort_order then connection name.
/// Ungrouped connections (group_id IS NULL) appear last.
pub fn list_connections(conn: &Connection) -> Result<Vec<ConnectionRecord>> {
    let sql = format!(
        "SELECT {}
         FROM connections c
         LEFT JOIN connection_groups cg ON c.group_id = cg.id
         ORDER BY
             CASE WHEN c.group_id IS NULL THEN 1 ELSE 0 END,
             cg.sort_order,
             c.name COLLATE NOCASE",
        CONNECTION_SELECT_COLUMNS
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_connection_record)?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row?);
    }
    Ok(records)
}

/// Update an existing connection's fields. Does not modify keychain_ref.
/// Returns an error if the connection does not exist.
pub fn update_connection(
    conn: &Connection,
    id: &str,
    data: &UpdateConnectionData,
) -> Result<()> {
    let rows_affected = conn.execute(
        "UPDATE connections SET
            name = ?1, host = ?2, port = ?3, username = ?4,
            default_database = ?5, ssl_enabled = ?6,
            ssl_ca_path = ?7, ssl_cert_path = ?8, ssl_key_path = ?9,
            color = ?10, group_id = ?11, read_only = ?12, sort_order = ?13,
            connect_timeout_secs = ?14, keepalive_interval_secs = ?15,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ?16",
        params![
            data.name,
            data.host,
            data.port,
            data.username,
            data.default_database,
            data.ssl_enabled,
            data.ssl_ca_path,
            data.ssl_cert_path,
            data.ssl_key_path,
            data.color,
            data.group_id,
            data.read_only,
            data.sort_order,
            data.connect_timeout_secs,
            data.keepalive_interval_secs,
            id,
        ],
    )?;

    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(())
}

/// Delete a connection by ID.
/// Returns an error if the connection does not exist.
pub fn delete_connection(conn: &Connection, id: &str) -> Result<()> {
    let rows_affected = conn.execute("DELETE FROM connections WHERE id = ?1", [id])?;

    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::run_migrations;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("should open in-memory connection");
        run_migrations(&conn).expect("should run migrations");
        conn
    }

    fn sample_new_connection() -> NewConnectionData {
        NewConnectionData {
            name: "Test DB".to_string(),
            host: "localhost".to_string(),
            port: 3306,
            username: "root".to_string(),
            default_database: Some("mydb".to_string()),
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            color: Some("#ff0000".to_string()),
            group_id: None,
            read_only: false,
            sort_order: 0,
            connect_timeout_secs: Some(10),
            keepalive_interval_secs: Some(60),
        }
    }

    #[test]
    fn test_insert_connection_returns_uuid() {
        let conn = test_conn();
        let data = sample_new_connection();
        let id = insert_connection(&conn, &data).expect("should insert connection");
        assert!(!id.is_empty(), "should return a non-empty UUID");
        // Verify it's a valid UUID format
        assert!(uuid::Uuid::parse_str(&id).is_ok(), "should be valid UUID");
    }

    #[test]
    fn test_insert_sets_keychain_ref_to_id() {
        let conn = test_conn();
        let data = sample_new_connection();
        let id = insert_connection(&conn, &data).expect("should insert");

        let keychain_ref: String = conn
            .query_row(
                "SELECT keychain_ref FROM connections WHERE id = ?1",
                [&id],
                |row| row.get(0),
            )
            .expect("should find connection");
        assert_eq!(keychain_ref, id, "keychain_ref should equal the connection id");
    }

    #[test]
    fn test_get_connection_returns_record() {
        let conn = test_conn();
        let data = sample_new_connection();
        let id = insert_connection(&conn, &data).expect("should insert");

        let record = get_connection(&conn, &id)
            .expect("should not error")
            .expect("should find connection");

        assert_eq!(record.id, id);
        assert_eq!(record.name, "Test DB");
        assert_eq!(record.host, "localhost");
        assert_eq!(record.port, 3306);
        assert_eq!(record.username, "root");
        assert!(record.has_password, "has_password should be true when keychain_ref is set");
        assert_eq!(record.default_database, Some("mydb".to_string()));
        assert!(!record.ssl_enabled);
        assert_eq!(record.color, Some("#ff0000".to_string()));
        assert!(!record.read_only);
        assert!(!record.created_at.is_empty());
        assert!(!record.updated_at.is_empty());
    }

    #[test]
    fn test_get_connection_returns_none_for_missing() {
        let conn = test_conn();
        let result = get_connection(&conn, "nonexistent-id")
            .expect("should not error");
        assert!(result.is_none());
    }

    #[test]
    fn test_list_connections_empty() {
        let conn = test_conn();
        let list = list_connections(&conn).expect("should list connections");
        assert!(list.is_empty());
    }

    #[test]
    fn test_list_connections_returns_all() {
        let conn = test_conn();
        let data1 = NewConnectionData {
            name: "Alpha".to_string(),
            ..sample_new_connection()
        };
        let data2 = NewConnectionData {
            name: "Beta".to_string(),
            ..sample_new_connection()
        };

        insert_connection(&conn, &data1).expect("should insert 1");
        insert_connection(&conn, &data2).expect("should insert 2");

        let list = list_connections(&conn).expect("should list");
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn test_update_connection_modifies_fields() {
        let conn = test_conn();
        let data = sample_new_connection();
        let id = insert_connection(&conn, &data).expect("should insert");

        let update = UpdateConnectionData {
            name: "Updated DB".to_string(),
            host: "192.168.1.1".to_string(),
            port: 3307,
            username: "admin".to_string(),
            default_database: None,
            ssl_enabled: true,
            ssl_ca_path: Some("/path/to/ca.pem".to_string()),
            ssl_cert_path: None,
            ssl_key_path: None,
            color: None,
            group_id: None,
            read_only: true,
            sort_order: 1,
            connect_timeout_secs: Some(30),
            keepalive_interval_secs: Some(120),
        };

        update_connection(&conn, &id, &update).expect("should update");

        let record = get_connection(&conn, &id)
            .expect("should not error")
            .expect("should find updated connection");

        assert_eq!(record.name, "Updated DB");
        assert_eq!(record.host, "192.168.1.1");
        assert_eq!(record.port, 3307);
        assert_eq!(record.username, "admin");
        assert_eq!(record.default_database, None);
        assert!(record.ssl_enabled);
        assert_eq!(record.ssl_ca_path, Some("/path/to/ca.pem".to_string()));
        assert!(record.read_only);
        assert_eq!(record.connect_timeout_secs, Some(30));
        assert_eq!(record.keepalive_interval_secs, Some(120));
    }

    #[test]
    fn test_update_connection_errors_for_missing() {
        let conn = test_conn();
        let update = UpdateConnectionData {
            name: "Nope".to_string(),
            host: "localhost".to_string(),
            port: 3306,
            username: "root".to_string(),
            default_database: None,
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            color: None,
            group_id: None,
            read_only: false,
            sort_order: 0,
            connect_timeout_secs: None,
            keepalive_interval_secs: None,
        };

        let result = update_connection(&conn, "nonexistent", &update);
        assert!(result.is_err());
    }

    #[test]
    fn test_delete_connection_removes_record() {
        let conn = test_conn();
        let data = sample_new_connection();
        let id = insert_connection(&conn, &data).expect("should insert");

        delete_connection(&conn, &id).expect("should delete");

        let record = get_connection(&conn, &id).expect("should not error");
        assert!(record.is_none(), "connection should be deleted");
    }

    #[test]
    fn test_delete_connection_errors_for_missing() {
        let conn = test_conn();
        let result = delete_connection(&conn, "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_insert_connection_timestamps_are_iso8601() {
        let conn = test_conn();
        let data = sample_new_connection();
        let id = insert_connection(&conn, &data).expect("should insert");

        let record = get_connection(&conn, &id)
            .expect("should not error")
            .expect("should find");

        // ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ
        assert!(
            record.created_at.contains('T') && record.created_at.ends_with('Z'),
            "created_at should be ISO 8601: {}",
            record.created_at
        );
        assert!(
            record.updated_at.contains('T') && record.updated_at.ends_with('Z'),
            "updated_at should be ISO 8601: {}",
            record.updated_at
        );
    }
}
