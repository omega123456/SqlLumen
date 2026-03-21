//! Connection rows (`db/connections.rs`).

mod common;

use mysql_client_lib::db::connections::{
    delete_connection, get_connection, insert_connection, list_connections, update_connection,
    NewConnectionData, UpdateConnectionData,
};

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
    let conn = common::test_db();
    let data = sample_new_connection();
    let id = insert_connection(&conn, &data).expect("should insert");
    assert!(!id.is_empty());
    assert!(uuid::Uuid::parse_str(&id).is_ok(), "should be valid UUID");
}

#[test]
fn test_insert_sets_keychain_ref_to_id() {
    let conn = common::test_db();
    let data = sample_new_connection();
    let id = insert_connection(&conn, &data).expect("should insert");

    let keychain_ref: String = conn
        .query_row(
            "SELECT keychain_ref FROM connections WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .expect("should find connection");
    assert_eq!(keychain_ref, id);
}

#[test]
fn test_get_connection_returns_record() {
    let conn = common::test_db();
    let data = sample_new_connection();
    let id = insert_connection(&conn, &data).expect("should insert");

    let record = get_connection(&conn, &id)
        .expect("should not error")
        .expect("should find");

    assert_eq!(record.id, id);
    assert_eq!(record.name, "Test DB");
    assert_eq!(record.host, "localhost");
    assert_eq!(record.port, 3306);
    assert_eq!(record.username, "root");
    assert!(record.has_password);
    assert_eq!(record.default_database, Some("mydb".to_string()));
    assert!(!record.ssl_enabled);
    assert_eq!(record.color, Some("#ff0000".to_string()));
    assert!(!record.read_only);
    assert!(!record.created_at.is_empty());
    assert!(!record.updated_at.is_empty());
}

#[test]
fn test_get_connection_returns_none_for_missing() {
    let conn = common::test_db();
    let result = get_connection(&conn, "nonexistent-id").expect("should not error");
    assert!(result.is_none());
}

#[test]
fn test_list_connections_empty() {
    let conn = common::test_db();
    let list = list_connections(&conn).expect("should list");
    assert!(list.is_empty());
}

#[test]
fn test_list_connections_returns_all() {
    let conn = common::test_db();
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
    let conn = common::test_db();
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
        .expect("should find");

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
    let conn = common::test_db();
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
    let conn = common::test_db();
    let data = sample_new_connection();
    let id = insert_connection(&conn, &data).expect("should insert");

    delete_connection(&conn, &id).expect("should delete");

    let record = get_connection(&conn, &id).expect("should not error");
    assert!(record.is_none());
}

#[test]
fn test_delete_connection_errors_for_missing() {
    let conn = common::test_db();
    let result = delete_connection(&conn, "nonexistent");
    assert!(result.is_err());
}

#[test]
fn test_insert_connection_timestamps_are_iso8601() {
    let conn = common::test_db();
    let data = sample_new_connection();
    let id = insert_connection(&conn, &data).expect("should insert");

    let record = get_connection(&conn, &id)
        .expect("should not error")
        .expect("should find");

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
