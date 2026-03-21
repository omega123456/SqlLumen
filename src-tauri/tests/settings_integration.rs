mod common;

use mysql_client_lib::db::settings;

#[test]
fn test_full_settings_workflow() {
    let conn = common::test_db();

    // Initially empty
    let all = settings::get_all_settings(&conn).expect("should get all settings");
    assert!(all.is_empty(), "settings should be empty initially");

    // Set multiple settings
    settings::set_setting(&conn, "theme", "dark").expect("should set theme");
    settings::set_setting(&conn, "sidebar_width", "300").expect("should set sidebar_width");
    settings::set_setting(&conn, "font_size", "14").expect("should set font_size");

    // Verify all present
    let all = settings::get_all_settings(&conn).expect("should get all settings");
    assert_eq!(all.len(), 3);
    assert_eq!(all.get("theme"), Some(&"dark".to_string()));
    assert_eq!(all.get("sidebar_width"), Some(&"300".to_string()));
    assert_eq!(all.get("font_size"), Some(&"14".to_string()));

    // Update one
    settings::set_setting(&conn, "theme", "light").expect("should update theme");

    // Verify update
    let theme = settings::get_setting(&conn, "theme").expect("should get theme");
    assert_eq!(theme, Some("light".to_string()));

    // Count is still 3 (no duplicates)
    let all = settings::get_all_settings(&conn).expect("should get all settings");
    assert_eq!(all.len(), 3);
}

#[test]
fn test_all_tables_exist_after_migrations() {
    let conn = common::test_db();

    for table in &[
        "settings",
        "connections",
        "connection_groups",
        "_migrations",
    ] {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |row| row.get(0),
            )
            .expect("should query sqlite_master");

        assert_eq!(count, 1, "table '{}' should exist", table);
    }
}
