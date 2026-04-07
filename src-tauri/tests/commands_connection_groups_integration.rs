//! Command-layer connection group `_impl` functions (`commands/connection_groups.rs`).

mod common;

use sqllumen_lib::commands::connection_groups::{
    create_connection_group_impl, delete_connection_group_impl, list_connection_groups_impl,
    update_connection_group_impl,
};
use sqllumen_lib::commands::connections::{get_connection_impl, save_connection_impl, SaveConnectionInput};

#[test]
fn test_create_connection_group_impl_returns_uuid() {
    let state = common::test_app_state();
    let id = create_connection_group_impl(&state, "Production").expect("should create");
    assert!(!id.is_empty());
}

#[test]
fn test_list_connection_groups_impl_returns_all() {
    let state = common::test_app_state();
    create_connection_group_impl(&state, "Production").expect("should create");
    create_connection_group_impl(&state, "Staging").expect("should create");

    let list = list_connection_groups_impl(&state).expect("should list");
    assert_eq!(list.len(), 2);
}

#[test]
fn test_update_connection_group_impl_modifies_name() {
    let state = common::test_app_state();
    let id = create_connection_group_impl(&state, "Old Name").expect("should create");

    update_connection_group_impl(&state, &id, "New Name").expect("should update");

    let list = list_connection_groups_impl(&state).expect("should list");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "New Name");
}

#[test]
fn test_delete_connection_group_impl_removes_group() {
    let state = common::test_app_state();
    let id = create_connection_group_impl(&state, "To Delete").expect("should create");

    delete_connection_group_impl(&state, &id).expect("should delete");

    let list = list_connection_groups_impl(&state).expect("should list");
    assert!(list.is_empty());
}

#[test]
fn test_delete_connection_group_impl_nullifies_connections() {
    let state = common::test_app_state();
    let group_id = create_connection_group_impl(&state, "My Group").expect("should create");

    let input = SaveConnectionInput {
        name: "Test DB".to_string(),
        host: "localhost".to_string(),
        port: 3306,
        username: "root".to_string(),
        password: None,
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
    let conn_id = save_connection_impl(&state, input).expect("should save");

    delete_connection_group_impl(&state, &group_id).expect("should delete group");

    let record = get_connection_impl(&state, &conn_id)
        .expect("should not error")
        .expect("should exist");
    assert!(record.group_id.is_none());
}
