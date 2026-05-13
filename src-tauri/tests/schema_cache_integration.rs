//! Schema metadata cache snapshot persistence helpers.

mod common;

use sqllumen_lib::db::schema_cache;

#[test]
fn load_schema_cache_snapshot_returns_none_when_missing() {
    let conn = common::test_db();

    let snapshot = schema_cache::load_schema_cache_snapshot(&conn, "missing-profile")
        .expect("load should succeed");

    assert_eq!(snapshot, None);
}

#[test]
fn save_and_load_schema_cache_snapshot_round_trips_json() {
    let conn = common::test_db();
    let json = r#"{"databases":["app"],"tables":{"app":[{"name":"users"}]},"columns":{},"routines":{},"foreignKeys":{},"indexes":{}}"#;

    schema_cache::save_schema_cache_snapshot(&conn, "profile-1", json).expect("save should work");
    let loaded = schema_cache::load_schema_cache_snapshot(&conn, "profile-1")
        .expect("load should work");

    assert_eq!(loaded, Some(json.to_string()));
}

#[test]
fn save_schema_cache_snapshot_upserts_existing_profile() {
    let conn = common::test_db();

    schema_cache::save_schema_cache_snapshot(&conn, "profile-1", r#"{"databases":["old"]}"#)
        .expect("initial save should work");
    schema_cache::save_schema_cache_snapshot(&conn, "profile-1", r#"{"databases":["new"]}"#)
        .expect("upsert should work");

    let loaded = schema_cache::load_schema_cache_snapshot(&conn, "profile-1")
        .expect("load should work");
    assert_eq!(loaded, Some(r#"{"databases":["new"]}"#.to_string()));
}
