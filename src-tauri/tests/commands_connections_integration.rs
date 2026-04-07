//! Command-layer connection `_impl` functions (`commands/connections.rs`).

mod common;

use mysql_client_lib::commands::connections::{
    delete_connection_impl, get_connection_impl, list_connections_impl, save_connection_impl,
    update_connection_impl, UpdateConnectionInput,
};

#[test]
fn test_save_connection_impl_returns_uuid() {
    let state = common::test_app_state();
    let id = save_connection_impl(&state, common::sample_save_input()).expect("should save");
    assert!(!id.is_empty());
}

#[test]
fn test_get_connection_impl_returns_record() {
    let state = common::test_app_state();
    let id = save_connection_impl(&state, common::sample_save_input()).expect("should save");

    let record = get_connection_impl(&state, &id)
        .expect("should not error")
        .expect("should find");

    assert_eq!(record.id, id);
    assert_eq!(record.name, "Test DB");
    assert!(!record.has_password);
}

#[test]
fn test_list_connections_impl_returns_all() {
    let state = common::test_app_state();
    save_connection_impl(&state, common::sample_save_input()).expect("should save 1");

    let mut input2 = common::sample_save_input();
    input2.name = "Second DB".to_string();
    save_connection_impl(&state, input2).expect("should save 2");

    let list = list_connections_impl(&state).expect("should list");
    assert_eq!(list.len(), 2);
}

#[test]
fn test_update_connection_impl_modifies_fields() {
    let state = common::test_app_state();
    let id = save_connection_impl(&state, common::sample_save_input()).expect("should save");

    let update = UpdateConnectionInput {
        name: "Updated DB".to_string(),
        host: "192.168.1.1".to_string(),
        port: 3307,
        username: "admin".to_string(),
        password: None,
        clear_password: false,
        default_database: None,
        ssl_enabled: true,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        color: Some("#00ff00".to_string()),
        group_id: None,
        read_only: false,
        sort_order: 0,
        connect_timeout_secs: Some(30),
        keepalive_interval_secs: Some(120),
    };
    update_connection_impl(&state, &id, update).expect("should update");

    let record = get_connection_impl(&state, &id)
        .expect("should not error")
        .expect("should find");
    assert_eq!(record.name, "Updated DB");
    assert_eq!(record.host, "192.168.1.1");
}

#[test]
fn test_delete_connection_impl_removes_record() {
    let state = common::test_app_state();
    let id = save_connection_impl(&state, common::sample_save_input()).expect("should save");

    delete_connection_impl(&state, &id).expect("should delete");

    let result = get_connection_impl(&state, &id).expect("should not error");
    assert!(result.is_none());
}

#[test]
fn test_save_without_password_sets_has_password_false() {
    let state = common::test_app_state();
    let mut input = common::sample_save_input();
    input.password = None;

    let id = save_connection_impl(&state, input).expect("should save");

    let record = get_connection_impl(&state, &id)
        .expect("should not error")
        .expect("should find");

    assert!(
        !record.has_password,
        "has_password should be false when no password provided"
    );
}

#[test]
fn test_password_is_not_stored_in_sqlite() {
    let state = common::test_app_state();
    let mut input = common::sample_save_input();
    input.password = Some("secret".to_string());

    let id = save_connection_impl(&state, input).expect("should save");

    let conn = state.db.lock().unwrap();
    let row_data: String = conn
        .query_row(
            "SELECT name || host || username || COALESCE(keychain_ref, '') || \
             COALESCE(default_database, '') || COALESCE(ssl_ca_path, '') || \
             COALESCE(ssl_cert_path, '') || COALESCE(ssl_key_path, '') || \
             COALESCE(color, '') FROM connections WHERE id = ?1",
            [&id],
            |row| row.get::<_, String>(0),
        )
        .expect("should find connection");

    assert!(
        !row_data.contains("secret"),
        "password 'secret' should not appear in any SQLite column"
    );
}

#[test]
fn test_save_with_password_sets_has_password_true() {
    let state = common::test_app_state();
    let mut input = common::sample_save_input();
    input.password = Some("secret".to_string());

    let id = save_connection_impl(&state, input).expect("should save");

    let record = get_connection_impl(&state, &id)
        .expect("should not error")
        .expect("should find");

    assert!(
        record.has_password,
        "has_password should be true when password is provided"
    );
}

#[test]
fn test_update_with_password_sets_has_password_true() {
    let state = common::test_app_state();
    let mut input = common::sample_save_input();
    input.password = None;
    let id = save_connection_impl(&state, input).expect("should save");

    let record = get_connection_impl(&state, &id)
        .expect("should not error")
        .expect("should find");
    assert!(!record.has_password);

    let update = UpdateConnectionInput {
        name: "Test DB".to_string(),
        host: "localhost".to_string(),
        port: 3306,
        username: "root".to_string(),
        password: Some("new_secret".to_string()),
        clear_password: false,
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
    update_connection_impl(&state, &id, update).expect("should update");

    let record = get_connection_impl(&state, &id)
        .expect("should not error")
        .expect("should find");
    assert!(
        record.has_password,
        "has_password should be true after update with password"
    );
}

#[test]
fn test_update_rejects_setting_and_clearing_password_together() {
    let state = common::test_app_state();
    let id = save_connection_impl(&state, common::sample_save_input()).expect("should save");

    let update = UpdateConnectionInput {
        name: "Test DB".to_string(),
        host: "localhost".to_string(),
        port: 3306,
        username: "root".to_string(),
        password: Some("new_secret".to_string()),
        clear_password: true,
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

    let error = update_connection_impl(&state, &id, update).expect_err("should reject conflict");
    assert_eq!(error, "Cannot set and clear password at the same time");
}

#[test]
fn test_delete_connection_tolerates_missing_keychain_entry() {
    let state = common::test_app_state();
    let id = save_connection_impl(&state, common::sample_save_input()).expect("should save");

    delete_connection_impl(&state, &id).expect("should delete even without keychain");

    let result = get_connection_impl(&state, &id).expect("should not error");
    assert!(result.is_none());
}

// ── Serde deserialization coverage ───────────────────────────────────────

#[test]
fn test_save_connection_input_deserialize_from_json() {
    use mysql_client_lib::commands::connections::SaveConnectionInput;

    let json = serde_json::json!({
        "name": "My DB",
        "host": "db.example.com",
        "port": 3306,
        "username": "admin",
        "password": "secret",
        "defaultDatabase": "prod",
        "sslEnabled": true,
        "sslCaPath": "/path/to/ca.pem",
        "sslCertPath": null,
        "sslKeyPath": null,
        "color": "#ff0000",
        "groupId": "grp-1",
        "readOnly": true,
        "sortOrder": 5,
        "connectTimeoutSecs": 30,
        "keepaliveIntervalSecs": 120
    });

    let input: SaveConnectionInput =
        serde_json::from_value(json).expect("should deserialize SaveConnectionInput");
    assert_eq!(input.name, "My DB");
    assert_eq!(input.host, "db.example.com");
    assert_eq!(input.port, 3306);
    assert_eq!(input.username, "admin");
    assert_eq!(input.password.as_deref(), Some("secret"));
    assert_eq!(input.default_database.as_deref(), Some("prod"));
    assert!(input.ssl_enabled);
    assert_eq!(input.ssl_ca_path.as_deref(), Some("/path/to/ca.pem"));
    assert!(input.ssl_cert_path.is_none());
    assert!(input.ssl_key_path.is_none());
    assert_eq!(input.color.as_deref(), Some("#ff0000"));
    assert_eq!(input.group_id.as_deref(), Some("grp-1"));
    assert!(input.read_only);
    assert_eq!(input.sort_order, 5);
    assert_eq!(input.connect_timeout_secs, Some(30));
    assert_eq!(input.keepalive_interval_secs, Some(120));
}

#[test]
fn test_update_connection_input_deserialize_from_json() {
    let json = serde_json::json!({
        "name": "Updated DB",
        "host": "new-host",
        "port": 3307,
        "username": "new_user",
        "password": null,
        "clearPassword": true,
        "defaultDatabase": null,
        "sslEnabled": false,
        "sslCaPath": null,
        "sslCertPath": null,
        "sslKeyPath": null,
        "color": null,
        "groupId": null,
        "readOnly": false,
        "sortOrder": 0,
        "connectTimeoutSecs": null,
        "keepaliveIntervalSecs": null
    });

    let input: UpdateConnectionInput =
        serde_json::from_value(json).expect("should deserialize UpdateConnectionInput");
    assert_eq!(input.name, "Updated DB");
    assert_eq!(input.host, "new-host");
    assert_eq!(input.port, 3307);
    assert_eq!(input.username, "new_user");
    assert!(input.password.is_none());
    assert!(input.clear_password);
    assert!(input.default_database.is_none());
    assert!(!input.ssl_enabled);
    assert!(!input.read_only);
    assert_eq!(input.sort_order, 0);
}

#[test]
fn test_update_connection_input_deserialize_clear_password_default() {
    // When clearPassword is omitted, #[serde(default)] should set it to false
    let json = serde_json::json!({
        "name": "Test",
        "host": "localhost",
        "port": 3306,
        "username": "root",
        "sslEnabled": false,
        "readOnly": false,
        "sortOrder": 0
    });

    let input: UpdateConnectionInput =
        serde_json::from_value(json).expect("should deserialize with defaults");
    assert!(!input.clear_password);
}
