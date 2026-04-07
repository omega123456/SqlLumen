//! Settings table helpers (`db/settings.rs`).

mod common;

use sqllumen_lib::db::settings;

#[test]
fn test_get_setting_returns_none_for_missing_key() {
    let conn = common::test_db();
    let result = settings::get_setting(&conn, "nonexistent_key").expect("should not error");
    assert_eq!(result, None);
}

#[test]
fn test_set_and_get_setting() {
    let conn = common::test_db();
    settings::set_setting(&conn, "theme", "dark").expect("should set");
    let value = settings::get_setting(&conn, "theme").expect("should get");
    assert_eq!(value, Some("dark".to_string()));
}

#[test]
fn test_set_setting_upserts_existing_key() {
    let conn = common::test_db();
    settings::set_setting(&conn, "theme", "light").expect("should set initial");
    settings::set_setting(&conn, "theme", "dark").expect("should update");
    let value = settings::get_setting(&conn, "theme").expect("should get");
    assert_eq!(value, Some("dark".to_string()));
}

#[test]
fn test_get_all_settings_returns_empty_map_when_no_settings() {
    let conn = common::test_db();
    let all = settings::get_all_settings(&conn).expect("should get all");
    assert!(all.is_empty());
}

#[test]
fn test_get_all_settings_returns_all_settings() {
    let conn = common::test_db();
    settings::set_setting(&conn, "theme", "dark").expect("should set theme");
    settings::set_setting(&conn, "sidebar_width", "250").expect("should set sidebar_width");

    let all = settings::get_all_settings(&conn).expect("should get all");
    assert_eq!(all.len(), 2);
    assert_eq!(all.get("theme"), Some(&"dark".to_string()));
    assert_eq!(all.get("sidebar_width"), Some(&"250".to_string()));
}

#[test]
fn test_get_all_settings_after_upsert() {
    let conn = common::test_db();
    settings::set_setting(&conn, "theme", "light").expect("should set initial");
    settings::set_setting(&conn, "theme", "dark").expect("should upsert");

    let all = settings::get_all_settings(&conn).expect("should get all");
    assert_eq!(all.len(), 1);
    assert_eq!(all.get("theme"), Some(&"dark".to_string()));
}
