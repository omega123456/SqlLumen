//! Building registry connection params from a saved connection row.

use crate::common;
use sqllumen_lib::db::ssl_mode::SslMode;

use sqllumen_lib::db::connections::{get_connection, insert_connection, NewConnectionData};
use sqllumen_lib::mysql::pool::SslSettings;
use sqllumen_lib::mysql::registry::{StoredConnectionParams, DEFAULT_CONNECT_TIMEOUT_SECS};

fn saved_connection(
    connect_timeout_secs: Option<i64>,
    keepalive_interval_secs: Option<i64>,
) -> NewConnectionData {
    NewConnectionData {
        name: "Primary".to_string(),
        host: "db.internal".to_string(),
        port: 3307,
        username: "app".to_string(),
        default_database: Some("orders".to_string()),
        ssl_mode: SslMode::Required,
        ssl_ca_path: Some("/certs/ca.pem".to_string()),
        ssl_cert_path: Some("/certs/client.pem".to_string()),
        ssl_key_path: Some("/certs/client.key".to_string()),
        color: None,
        group_id: None,
        read_only: false,
        sort_order: 0,
        connect_timeout_secs,
        keepalive_interval_secs,
    }
}

#[test]
fn from_connection_record_copies_the_row_and_groups_ssl_settings() {
    let conn = common::test_db();
    let id = insert_connection(&conn, &saved_connection(Some(20), Some(30))).expect("insert");
    let record = get_connection(&conn, &id).expect("query").expect("row");

    let params = StoredConnectionParams::from_connection_record(&id, &record);

    assert_eq!(params.profile_id, id);
    assert_eq!(params.host, "db.internal");
    assert_eq!(params.port, 3307);
    assert_eq!(params.username, "app");
    assert_eq!(params.default_database, Some("orders".to_string()));
    assert_eq!(
        params.ssl,
        SslSettings {
            mode: SslMode::Required,
            ca_path: Some("/certs/ca.pem".to_string()),
            cert_path: Some("/certs/client.pem".to_string()),
            key_path: Some("/certs/client.key".to_string()),
        }
    );
    assert_eq!(params.connect_timeout_secs, 20);
    assert_eq!(params.keepalive_interval_secs, 30);
}

#[test]
fn from_connection_record_defaults_and_clamps_timeouts() {
    let conn = common::test_db();
    let id = insert_connection(&conn, &saved_connection(None, None)).expect("insert");
    let record = get_connection(&conn, &id).expect("query").expect("row");

    let params = StoredConnectionParams::from_connection_record(&id, &record);

    assert_eq!(
        params.connect_timeout_secs,
        DEFAULT_CONNECT_TIMEOUT_SECS as u64
    );
    assert_eq!(params.keepalive_interval_secs, 60);

    let clamped_id =
        insert_connection(&conn, &saved_connection(Some(0), Some(-5))).expect("insert");
    let clamped_record = get_connection(&conn, &clamped_id)
        .expect("query")
        .expect("row");
    let clamped = StoredConnectionParams::from_connection_record(&clamped_id, &clamped_record);
    assert_eq!(clamped.connect_timeout_secs, 1);
    assert_eq!(clamped.keepalive_interval_secs, 0);
}
