//! Cross-table / error-path DB behavior that spans repositories.

mod common;

use mysql_client_lib::db::connection_groups;
use mysql_client_lib::db::connections::{self, NewConnectionData, UpdateConnectionData};
use mysql_client_lib::db::settings;

#[test]
fn test_get_setting_errors_on_malformed_json() {
    let conn = common::test_db();
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('bad_key', 'not-valid-json')",
        [],
    )
    .expect("should insert malformed row");

    let result = settings::get_setting(&conn, "bad_key");

    assert!(
        result.is_err(),
        "should error when stored setting is malformed JSON"
    );
}

#[test]
fn test_get_all_settings_errors_on_malformed_json() {
    let conn = common::test_db();
    settings::set_setting(&conn, "theme", "dark").expect("should insert valid setting");
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('bad_key', 'not-valid-json')",
        [],
    )
    .expect("should insert malformed row");

    let result = settings::get_all_settings(&conn);

    assert!(
        result.is_err(),
        "should error when any stored setting is malformed JSON"
    );
}

#[test]
fn test_connection_group_reports_missing_rows_for_update_and_delete() {
    let conn = common::test_db();

    let update_result = connection_groups::update_group(&conn, "missing-group", "Renamed");
    let delete_result = connection_groups::delete_group(&conn, "missing-group");

    assert!(matches!(
        update_result,
        Err(rusqlite::Error::QueryReturnedNoRows)
    ));
    assert!(matches!(
        delete_result,
        Err(rusqlite::Error::QueryReturnedNoRows)
    ));
}

#[test]
fn test_connection_reports_missing_rows_for_update_and_delete() {
    let conn = common::test_db();
    let update = UpdateConnectionData {
        name: "Updated".to_string(),
        host: "127.0.0.1".to_string(),
        port: 3307,
        username: "admin".to_string(),
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
        keepalive_interval_secs: Some(30),
    };

    let update_result = connections::update_connection(&conn, "missing-connection", &update);
    let delete_result = connections::delete_connection(&conn, "missing-connection");

    assert!(matches!(
        update_result,
        Err(rusqlite::Error::QueryReturnedNoRows)
    ));
    assert!(matches!(
        delete_result,
        Err(rusqlite::Error::QueryReturnedNoRows)
    ));
}

#[test]
fn test_connection_and_group_round_trip_queries_work() {
    let conn = common::test_db();

    let group_id = connection_groups::insert_group(&conn, "Alpha").expect("should insert group");
    let mut data = NewConnectionData {
        name: "Test DB".to_string(),
        host: "localhost".to_string(),
        port: 3306,
        username: "root".to_string(),
        default_database: Some("app".to_string()),
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        color: Some("#3366ff".to_string()),
        group_id: None,
        read_only: false,
        sort_order: 0,
        connect_timeout_secs: Some(10),
        keepalive_interval_secs: Some(60),
    };
    data.group_id = Some(group_id.clone());
    let id = connections::insert_connection(&conn, &data).expect("should insert connection");

    let group = connection_groups::get_group(&conn, &group_id)
        .expect("should load group")
        .expect("group should exist");
    let loaded = connections::get_connection(&conn, &id)
        .expect("should load connection")
        .expect("connection should exist");

    assert_eq!(group.name, "Alpha");
    assert_eq!(loaded.group_id, Some(group_id));
}
