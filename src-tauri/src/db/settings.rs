use rusqlite::{Connection, OptionalExtension, Result};
use std::collections::HashMap;

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get::<_, String>(0)
    })
    .optional()
    .and_then(|opt| match opt {
        None => Ok(None),
        Some(json_value) => serde_json::from_str::<String>(&json_value)
            .map(Some)
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            }),
    })
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    let json_value = serde_json::to_string(value).expect("string serialization is infallible");
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        [key, &json_value],
    )?;
    Ok(())
}

pub fn get_all_settings(conn: &Connection) -> Result<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut map = HashMap::new();
    for row in rows {
        let (key, json_value) = row?;
        let value: String = serde_json::from_str(&json_value).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
        map.insert(key, value);
    }
    Ok(map)
}
