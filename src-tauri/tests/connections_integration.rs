mod common;

use sqllumen_lib::db::connection_groups;
use sqllumen_lib::db::connections::{self, NewConnectionData};

// --- Connection CRUD Integration Tests ---

#[test]
fn test_full_connection_crud_workflow() {
    let conn = common::test_db();

    // Initially empty
    let list = connections::list_connections(&conn).expect("should list connections");
    assert!(list.is_empty(), "connections should be empty initially");

    // Create a connection
    let data = NewConnectionData {
        name: "Production DB".to_string(),
        host: "db.example.com".to_string(),
        port: 3306,
        username: "admin".to_string(),
        default_database: Some("app_prod".to_string()),
        ssl_enabled: true,
        ssl_ca_path: Some("/certs/ca.pem".to_string()),
        ssl_cert_path: None,
        ssl_key_path: None,
        color: Some("#e74c3c".to_string()),
        group_id: None,
        read_only: false,
        sort_order: 0,
        connect_timeout_secs: Some(15),
        keepalive_interval_secs: Some(30),
    };
    let id = connections::insert_connection(&conn, &data).expect("should insert connection");
    assert!(!id.is_empty(), "should return UUID");

    // Read it back
    let record = connections::get_connection(&conn, &id)
        .expect("should not error")
        .expect("should find connection");
    assert_eq!(record.name, "Production DB");
    assert_eq!(record.host, "db.example.com");
    assert_eq!(record.port, 3306);
    assert_eq!(record.username, "admin");
    assert!(record.has_password);
    assert_eq!(record.default_database, Some("app_prod".to_string()));
    assert!(record.ssl_enabled);
    assert_eq!(record.ssl_ca_path, Some("/certs/ca.pem".to_string()));
    assert_eq!(record.color, Some("#e74c3c".to_string()));
    assert!(!record.read_only);
    assert_eq!(record.connect_timeout_secs, Some(15));
    assert_eq!(record.keepalive_interval_secs, Some(30));

    // Update it
    let update = connections::UpdateConnectionData {
        name: "Production DB (Updated)".to_string(),
        host: "db2.example.com".to_string(),
        port: 3307,
        username: "root".to_string(),
        default_database: None,
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        color: None,
        group_id: None,
        read_only: true,
        sort_order: 1,
        connect_timeout_secs: Some(5),
        keepalive_interval_secs: Some(120),
    };
    connections::update_connection(&conn, &id, &update).expect("should update");

    // Verify update
    let updated = connections::get_connection(&conn, &id)
        .expect("should not error")
        .expect("should find updated connection");
    assert_eq!(updated.name, "Production DB (Updated)");
    assert_eq!(updated.host, "db2.example.com");
    assert_eq!(updated.port, 3307);
    assert!(updated.read_only);
    assert_eq!(updated.default_database, None);
    assert!(!updated.ssl_enabled);

    // Verify list returns 1
    let list = connections::list_connections(&conn).expect("should list");
    assert_eq!(list.len(), 1);

    // Delete it
    connections::delete_connection(&conn, &id).expect("should delete");

    // Verify deletion
    let deleted = connections::get_connection(&conn, &id).expect("should not error");
    assert!(deleted.is_none(), "connection should be deleted");

    // Verify list returns 0
    let list = connections::list_connections(&conn).expect("should list");
    assert!(list.is_empty());
}

#[test]
fn test_keychain_ref_is_set_to_connection_id() {
    let conn = common::test_db();

    let data = NewConnectionData {
        name: "Test".to_string(),
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
    let id = connections::insert_connection(&conn, &data).expect("should insert");

    // Verify keychain_ref equals the connection ID
    let keychain_ref: String = conn
        .query_row(
            "SELECT keychain_ref FROM connections WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .expect("should find connection");
    assert_eq!(keychain_ref, id);

    // Verify has_password is true
    let record = connections::get_connection(&conn, &id)
        .expect("should not error")
        .expect("should find");
    assert!(record.has_password);
}

#[test]
fn test_list_connections_sort_order() {
    let conn = common::test_db();

    // Create two groups with different sort orders
    let group_b_id =
        connection_groups::insert_group(&conn, "Group B").expect("should insert group B");
    let group_a_id =
        connection_groups::insert_group(&conn, "Group A").expect("should insert group A");

    // Set sort_order: Group A = 0, Group B = 1
    conn.execute(
        "UPDATE connection_groups SET sort_order = 0 WHERE id = ?1",
        [&group_a_id],
    )
    .expect("should update sort_order");
    conn.execute(
        "UPDATE connection_groups SET sort_order = 1 WHERE id = ?1",
        [&group_b_id],
    )
    .expect("should update sort_order");

    // Create connections: ungrouped, in group B, in group A
    let ungrouped = NewConnectionData {
        name: "Ungrouped".to_string(),
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

    let in_group_b = NewConnectionData {
        name: "In Group B".to_string(),
        group_id: Some(group_b_id.clone()),
        ..ungrouped.clone()
    };

    let in_group_a_z = NewConnectionData {
        name: "Zebra in A".to_string(),
        group_id: Some(group_a_id.clone()),
        ..ungrouped.clone()
    };

    let in_group_a_a = NewConnectionData {
        name: "Alpha in A".to_string(),
        group_id: Some(group_a_id.clone()),
        ..ungrouped.clone()
    };

    connections::insert_connection(&conn, &ungrouped).expect("should insert");
    connections::insert_connection(&conn, &in_group_b).expect("should insert");
    connections::insert_connection(&conn, &in_group_a_z).expect("should insert");
    connections::insert_connection(&conn, &in_group_a_a).expect("should insert");

    let list = connections::list_connections(&conn).expect("should list");
    assert_eq!(list.len(), 4);

    // Group A (sort_order=0) connections first, sorted by name
    assert_eq!(list[0].name, "Alpha in A");
    assert_eq!(list[1].name, "Zebra in A");
    // Group B (sort_order=1) connections next
    assert_eq!(list[2].name, "In Group B");
    // Ungrouped last
    assert_eq!(list[3].name, "Ungrouped");
}

#[test]
fn test_migration_002_adds_timeout_columns() {
    let conn = common::test_db();

    // Verify the columns exist by inserting with values
    let data = NewConnectionData {
        name: "Timeout Test".to_string(),
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
        connect_timeout_secs: Some(20),
        keepalive_interval_secs: Some(90),
    };
    let id = connections::insert_connection(&conn, &data).expect("should insert");

    let record = connections::get_connection(&conn, &id)
        .expect("should not error")
        .expect("should find");
    assert_eq!(record.connect_timeout_secs, Some(20));
    assert_eq!(record.keepalive_interval_secs, Some(90));
}

// --- Connection Group CRUD Integration Tests ---

#[test]
fn test_full_group_crud_workflow() {
    let conn = common::test_db();

    // Initially empty
    let list = connection_groups::list_groups(&conn).expect("should list groups");
    assert!(list.is_empty(), "groups should be empty initially");

    // Create a group
    let id = connection_groups::insert_group(&conn, "Production").expect("should insert group");
    assert!(!id.is_empty());

    // Read it back
    let record = connection_groups::get_group(&conn, &id)
        .expect("should not error")
        .expect("should find group");
    assert_eq!(record.name, "Production");
    assert!(record.parent_id.is_none());
    assert_eq!(record.sort_order, 0);

    // Update it
    connection_groups::update_group(&conn, &id, "Prod Servers").expect("should update");
    let updated = connection_groups::get_group(&conn, &id)
        .expect("should not error")
        .expect("should find updated group");
    assert_eq!(updated.name, "Prod Servers");

    // List returns 1
    let list = connection_groups::list_groups(&conn).expect("should list");
    assert_eq!(list.len(), 1);

    // Delete it
    connection_groups::delete_group(&conn, &id).expect("should delete");
    let deleted = connection_groups::get_group(&conn, &id).expect("should not error");
    assert!(deleted.is_none(), "group should be deleted");
}

#[test]
fn test_delete_group_nullifies_contained_connections() {
    let conn = common::test_db();

    // Create a group
    let group_id =
        connection_groups::insert_group(&conn, "Staging").expect("should insert group");

    // Create two connections in the group
    let data1 = NewConnectionData {
        name: "DB 1".to_string(),
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
    let data2 = NewConnectionData {
        name: "DB 2".to_string(),
        ..data1.clone()
    };

    let id1 = connections::insert_connection(&conn, &data1).expect("should insert 1");
    let id2 = connections::insert_connection(&conn, &data2).expect("should insert 2");

    // Delete the group
    connection_groups::delete_group(&conn, &group_id).expect("should delete group");

    // Both connections should still exist but with group_id = NULL
    let rec1 = connections::get_connection(&conn, &id1)
        .expect("should not error")
        .expect("connection 1 should exist");
    let rec2 = connections::get_connection(&conn, &id2)
        .expect("should not error")
        .expect("connection 2 should exist");

    assert!(rec1.group_id.is_none(), "connection 1 group_id should be NULL");
    assert!(rec2.group_id.is_none(), "connection 2 group_id should be NULL");
}

#[test]
fn test_list_groups_sorted_by_sort_order() {
    let conn = common::test_db();

    let id1 = connection_groups::insert_group(&conn, "Third").expect("should insert");
    let id2 = connection_groups::insert_group(&conn, "First").expect("should insert");
    let id3 = connection_groups::insert_group(&conn, "Second").expect("should insert");

    // Set explicit sort orders
    conn.execute(
        "UPDATE connection_groups SET sort_order = 2 WHERE id = ?1",
        [&id1],
    )
    .expect("should update");
    conn.execute(
        "UPDATE connection_groups SET sort_order = 0 WHERE id = ?1",
        [&id2],
    )
    .expect("should update");
    conn.execute(
        "UPDATE connection_groups SET sort_order = 1 WHERE id = ?1",
        [&id3],
    )
    .expect("should update");

    let list = connection_groups::list_groups(&conn).expect("should list");
    assert_eq!(list.len(), 3);
    assert_eq!(list[0].name, "First");
    assert_eq!(list[1].name, "Second");
    assert_eq!(list[2].name, "Third");
}

#[test]
fn test_connection_timestamps_are_iso8601() {
    let conn = common::test_db();

    let data = NewConnectionData {
        name: "Timestamp Test".to_string(),
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
    let id = connections::insert_connection(&conn, &data).expect("should insert");

    let record = connections::get_connection(&conn, &id)
        .expect("should not error")
        .expect("should find");

    // Verify ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ
    assert!(
        record.created_at.contains('T') && record.created_at.ends_with('Z'),
        "created_at should be ISO 8601 format, got: {}",
        record.created_at
    );
    assert!(
        record.updated_at.contains('T') && record.updated_at.ends_with('Z'),
        "updated_at should be ISO 8601 format, got: {}",
        record.updated_at
    );
}

#[test]
fn test_group_timestamps_are_iso8601() {
    let conn = common::test_db();

    let id = connection_groups::insert_group(&conn, "Test").expect("should insert");

    let record = connection_groups::get_group(&conn, &id)
        .expect("should not error")
        .expect("should find");

    assert!(
        record.created_at.contains('T') && record.created_at.ends_with('Z'),
        "created_at should be ISO 8601 format, got: {}",
        record.created_at
    );
}
