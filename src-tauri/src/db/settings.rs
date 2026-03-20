use rusqlite::{Connection, OptionalExtension, Result};
use std::collections::HashMap;

/// Get a setting value by key. Returns None if the key doesn't exist.
/// Values are stored as JSON strings in the database and deserialized on read.
pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [key],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .and_then(|opt| match opt {
        None => Ok(None),
        Some(json_value) => {
            serde_json::from_str::<String>(&json_value)
                .map(Some)
                .map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        0,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })
        }
    })
}

/// Set a setting value (insert or replace).
/// Values are serialized as JSON strings before storage to support future structured data.
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    // serde_json::to_string on a &str is infallible
    let json_value =
        serde_json::to_string(value).expect("string serialization is infallible");
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        [key, &json_value],
    )?;
    Ok(())
}

/// Get all settings as a HashMap<key, value>.
/// Values are deserialized from JSON strings on read.
pub fn get_all_settings(conn: &Connection) -> Result<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut map = HashMap::new();
    for row in rows {
        let (key, json_value) = row?;
        let value: String = serde_json::from_str(&json_value).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })?;
        map.insert(key, value);
    }
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::run_migrations;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("should open in-memory connection");
        run_migrations(&conn).expect("should run migrations");
        conn
    }

    #[test]
    fn test_get_setting_returns_none_for_missing_key() {
        let conn = test_conn();
        let result = get_setting(&conn, "nonexistent_key").expect("should not error");
        assert_eq!(result, None);
    }

    #[test]
    fn test_set_and_get_setting() {
        let conn = test_conn();
        set_setting(&conn, "theme", "dark").expect("should set setting");
        let value = get_setting(&conn, "theme").expect("should get setting");
        assert_eq!(value, Some("dark".to_string()));
    }

    #[test]
    fn test_set_setting_upserts_existing_key() {
        let conn = test_conn();
        set_setting(&conn, "theme", "light").expect("should set initial value");
        set_setting(&conn, "theme", "dark").expect("should update value");
        let value = get_setting(&conn, "theme").expect("should get updated value");
        assert_eq!(value, Some("dark".to_string()));
    }

    #[test]
    fn test_get_all_settings_returns_empty_map_when_no_settings() {
        let conn = test_conn();
        let all = get_all_settings(&conn).expect("should get all settings");
        assert!(all.is_empty());
    }

    #[test]
    fn test_get_all_settings_returns_all_settings() {
        let conn = test_conn();
        set_setting(&conn, "theme", "dark").expect("should set theme");
        set_setting(&conn, "sidebar_width", "250").expect("should set sidebar_width");

        let all = get_all_settings(&conn).expect("should get all settings");
        assert_eq!(all.len(), 2);
        assert_eq!(all.get("theme"), Some(&"dark".to_string()));
        assert_eq!(all.get("sidebar_width"), Some(&"250".to_string()));
    }

    #[test]
    fn test_get_all_settings_after_upsert() {
        let conn = test_conn();
        set_setting(&conn, "theme", "light").expect("should set initial");
        set_setting(&conn, "theme", "dark").expect("should upsert");

        let all = get_all_settings(&conn).expect("should get all");
        assert_eq!(all.len(), 1);
        assert_eq!(all.get("theme"), Some(&"dark".to_string()));
    }

    #[test]
    fn test_get_setting_errors_on_malformed_json() {
        let conn = test_conn();
        // Directly insert non-JSON value to simulate DB corruption
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('bad_key', 'not-valid-json')",
            [],
        )
        .expect("should insert raw value");

        let result = get_setting(&conn, "bad_key");
        assert!(result.is_err(), "should error on malformed JSON value");
    }

    #[test]
    fn test_get_all_settings_errors_on_malformed_json() {
        let conn = test_conn();
        set_setting(&conn, "good_key", "valid").expect("should set valid");
        // Directly insert non-JSON value to simulate DB corruption
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('bad_key', 'not-valid-json')",
            [],
        )
        .expect("should insert raw value");

        let result = get_all_settings(&conn);
        assert!(result.is_err(), "should error on malformed JSON value");
    }
}
