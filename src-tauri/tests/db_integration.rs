use mysql_client_lib::db::connection::open_database;
use mysql_client_lib::db::connection_groups;
use mysql_client_lib::db::connections::{self, NewConnectionData, UpdateConnectionData};
use mysql_client_lib::db::migrations;
use mysql_client_lib::db::settings;
use rusqlite::Connection;

fn unique_temp_path(prefix: &str, file_name: &str) -> std::path::PathBuf {
    let unique = format!(
        "{}_{}_{}",
        prefix,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );

    std::env::temp_dir().join(unique).join(file_name)
}

#[test]
fn test_open_database_creates_parent_directory_and_supports_queries() {
    let db_path = unique_temp_path("db_open_parent", "nested/app.db");

    let conn =
        open_database(db_path.clone()).expect("should create parent directories and open db");
    let one: i64 = conn
        .query_row("SELECT 1", [], |row| row.get(0))
        .expect("should run a simple query");

    assert_eq!(one, 1);

    drop(conn);
    let root = db_path
        .parent()
        .and_then(|path| path.parent())
        .expect("test path should have a root directory")
        .to_path_buf();
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn test_open_database_enables_wal_mode() {
    let db_path = unique_temp_path("db_open_wal", "wal.db");

    let conn = open_database(db_path.clone()).expect("should open database");
    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode;", [], |row| row.get(0))
        .expect("should query journal mode");

    assert_eq!(journal_mode, "wal");

    drop(conn);
    if let Some(parent) = db_path.parent() {
        let _ = std::fs::remove_dir_all(parent);
    }
}

#[test]
fn test_open_database_returns_error_when_parent_path_is_a_file() {
    let blocker_path = unique_temp_path("db_open_blocker", "blocker");
    let blocker_parent = blocker_path
        .parent()
        .expect("blocker path should have a parent")
        .to_path_buf();
    std::fs::create_dir_all(&blocker_parent).expect("should create blocker parent directory");
    std::fs::write(&blocker_path, "not a directory").expect("should create blocker file");

    let result = open_database(blocker_path.join("child").join("app.db"));

    assert!(
        result.is_err(),
        "should fail when a required parent path is a file"
    );

    let _ = std::fs::remove_dir_all(blocker_parent);
}

fn test_settings_db() -> Connection {
    let conn = Connection::open_in_memory().expect("should open in-memory db");
    migrations::run_migrations(&conn).expect("should run migrations");
    conn
}

fn sample_connection() -> NewConnectionData {
    NewConnectionData {
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
    }
}

#[test]
fn test_get_setting_errors_on_malformed_json() {
    let conn = test_settings_db();
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
    let conn = test_settings_db();
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
    let conn = test_settings_db();

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
    let conn = test_settings_db();
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
    let conn = test_settings_db();

    let group_id = connection_groups::insert_group(&conn, "Alpha").expect("should insert group");
    let mut data = sample_connection();
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
