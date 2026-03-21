//! Connection group rows (`db/connection_groups.rs`).

mod common;

use mysql_client_lib::db::connection_groups::{
    delete_group, get_group, insert_group, list_groups, update_group,
};
use mysql_client_lib::db::connections::{get_connection, insert_connection, NewConnectionData};

#[test]
fn test_insert_group_returns_uuid() {
    let conn = common::test_db();
    let id = insert_group(&conn, "Production").expect("should insert");
    assert!(!id.is_empty());
    assert!(uuid::Uuid::parse_str(&id).is_ok());
}

#[test]
fn test_get_group_returns_record() {
    let conn = common::test_db();
    let id = insert_group(&conn, "Production").expect("should insert");

    let record = get_group(&conn, &id)
        .expect("should not error")
        .expect("should find");

    assert_eq!(record.id, id);
    assert_eq!(record.name, "Production");
    assert!(record.parent_id.is_none());
    assert_eq!(record.sort_order, 0);
    assert!(!record.created_at.is_empty());
}

#[test]
fn test_get_group_returns_none_for_missing() {
    let conn = common::test_db();
    let result = get_group(&conn, "nonexistent").expect("should not error");
    assert!(result.is_none());
}

#[test]
fn test_list_groups_empty() {
    let conn = common::test_db();
    let list = list_groups(&conn).expect("should list");
    assert!(list.is_empty());
}

#[test]
fn test_list_groups_returns_all_sorted() {
    let conn = common::test_db();
    insert_group(&conn, "Beta").expect("should insert");
    insert_group(&conn, "Alpha").expect("should insert");

    let list = list_groups(&conn).expect("should list");
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].name, "Alpha");
    assert_eq!(list[1].name, "Beta");
}

#[test]
fn test_update_group_modifies_name() {
    let conn = common::test_db();
    let id = insert_group(&conn, "Old Name").expect("should insert");

    update_group(&conn, &id, "New Name").expect("should update");

    let record = get_group(&conn, &id)
        .expect("should not error")
        .expect("should find");
    assert_eq!(record.name, "New Name");
}

#[test]
fn test_update_group_errors_for_missing() {
    let conn = common::test_db();
    let result = update_group(&conn, "nonexistent", "Name");
    assert!(result.is_err());
}

#[test]
fn test_delete_group_removes_record() {
    let conn = common::test_db();
    let id = insert_group(&conn, "To Delete").expect("should insert");

    delete_group(&conn, &id).expect("should delete");

    let result = get_group(&conn, &id).expect("should not error");
    assert!(result.is_none());
}

#[test]
fn test_delete_group_errors_for_missing() {
    let conn = common::test_db();
    let result = delete_group(&conn, "nonexistent");
    assert!(result.is_err());
}

#[test]
fn test_delete_group_nullifies_connections() {
    let conn = common::test_db();
    let group_id = insert_group(&conn, "My Group").expect("should insert");

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
    let conn_id = insert_connection(&conn, &conn_data).expect("should insert");

    delete_group(&conn, &group_id).expect("should delete");

    let record = get_connection(&conn, &conn_id)
        .expect("should not error")
        .expect("connection should still exist");
    assert!(record.group_id.is_none());
}

#[test]
fn test_insert_group_timestamp_is_iso8601() {
    let conn = common::test_db();
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
