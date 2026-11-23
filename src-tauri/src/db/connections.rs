use rusqlite::{Connection, OptionalExtension, Result, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use crate::db::ssl_mode::SslMode;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewConnectionData {
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub default_database: Option<String>,
    pub ssl_mode: SslMode,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub color: Option<String>,
    pub group_id: Option<String>,
    pub read_only: bool,
    pub sort_order: i64,
    pub connect_timeout_secs: Option<i64>,
    pub keepalive_interval_secs: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConnectionData {
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub default_database: Option<String>,
    pub ssl_mode: SslMode,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub color: Option<String>,
    pub group_id: Option<String>,
    pub read_only: bool,
    pub sort_order: i64,
    pub connect_timeout_secs: Option<i64>,
    pub keepalive_interval_secs: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRecord {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub has_password: bool,
    pub default_database: Option<String>,
    pub ssl_mode: SslMode,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub color: Option<String>,
    pub group_id: Option<String>,
    pub read_only: bool,
    pub sort_order: i64,
    pub connect_timeout_secs: Option<i64>,
    pub keepalive_interval_secs: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub last_connected_at: Option<String>,
    #[serde(skip_serializing, skip_deserializing, default)]
    pub(crate) keychain_ref: Option<String>,
}

const CONNECTION_SELECT_COLUMNS: &str = "
    c.id, c.name, c.host, c.port, c.username,
    (c.keychain_ref IS NOT NULL AND c.keychain_ref != '') as has_password,
    c.default_database, c.ssl_mode, c.ssl_ca_path, c.ssl_cert_path, c.ssl_key_path,
    c.color, c.group_id, c.read_only, c.sort_order,
    c.connect_timeout_secs, c.keepalive_interval_secs,
    c.created_at, c.updated_at,
    c.last_connected_at,
    c.keychain_ref";

fn row_to_connection_record(row: &rusqlite::Row) -> rusqlite::Result<ConnectionRecord> {
    Ok(ConnectionRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        port: row.get(3)?,
        username: row.get(4)?,
        has_password: row.get(5)?,
        default_database: row.get(6)?,
        ssl_mode: row.get(7)?,
        ssl_ca_path: row.get(8)?,
        ssl_cert_path: row.get(9)?,
        ssl_key_path: row.get(10)?,
        color: row.get(11)?,
        group_id: row.get(12)?,
        read_only: row.get(13)?,
        sort_order: row.get(14)?,
        connect_timeout_secs: row.get(15)?,
        keepalive_interval_secs: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
        last_connected_at: row.get(19)?,
        keychain_ref: row.get(20)?,
    })
}

pub fn insert_connection(conn: &Connection, data: &NewConnectionData) -> Result<String> {
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO connections (
            id, name, host, port, username, keychain_ref,
            default_database, ssl_mode, ssl_ca_path, ssl_cert_path, ssl_key_path,
            color, group_id, read_only, sort_order,
            connect_timeout_secs, keepalive_interval_secs,
            created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6,
            ?7, ?8, ?9, ?10, ?11,
            ?12, ?13, ?14, ?15,
            ?16, ?17,
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )",
        params![
            id,
            data.name,
            data.host,
            data.port,
            data.username,
            id,
            data.default_database,
            data.ssl_mode,
            data.ssl_ca_path,
            data.ssl_cert_path,
            data.ssl_key_path,
            data.color,
            data.group_id,
            data.read_only,
            data.sort_order,
            data.connect_timeout_secs,
            data.keepalive_interval_secs,
        ],
    )?;

    Ok(id)
}

pub fn get_connection(conn: &Connection, id: &str) -> Result<Option<ConnectionRecord>> {
    let sql = format!(
        "SELECT {} FROM connections c WHERE c.id = ?1",
        CONNECTION_SELECT_COLUMNS
    );

    conn.query_row(&sql, [id], row_to_connection_record)
        .optional()
}

pub fn get_keychain_ref(conn: &Connection, id: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT keychain_ref FROM connections WHERE id = ?1",
        [id],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional()
    .map(|result| result.flatten())
}

pub fn set_keychain_ref(conn: &Connection, id: &str, keychain_ref: Option<&str>) -> Result<()> {
    let rows_affected = conn.execute(
        "UPDATE connections SET keychain_ref = ?1 WHERE id = ?2",
        params![keychain_ref, id],
    )?;

    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(())
}

pub fn list_connections(conn: &Connection) -> Result<Vec<ConnectionRecord>> {
    let sql = format!(
        "SELECT {}
         FROM connections c
         LEFT JOIN connection_groups cg ON c.group_id = cg.id
         ORDER BY
             CASE WHEN c.group_id IS NULL THEN 1 ELSE 0 END,
             cg.sort_order,
             c.name COLLATE NOCASE",
        CONNECTION_SELECT_COLUMNS
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_connection_record)?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row?);
    }
    Ok(records)
}

pub fn update_connection(conn: &Connection, id: &str, data: &UpdateConnectionData) -> Result<()> {
    let rows_affected = conn.execute(
        "UPDATE connections SET
            name = ?1, host = ?2, port = ?3, username = ?4,
            default_database = ?5, ssl_mode = ?6,
            ssl_ca_path = ?7, ssl_cert_path = ?8, ssl_key_path = ?9,
            color = ?10, group_id = ?11, read_only = ?12, sort_order = ?13,
            connect_timeout_secs = ?14, keepalive_interval_secs = ?15,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ?16",
        params![
            data.name,
            data.host,
            data.port,
            data.username,
            data.default_database,
            data.ssl_mode,
            data.ssl_ca_path,
            data.ssl_cert_path,
            data.ssl_key_path,
            data.color,
            data.group_id,
            data.read_only,
            data.sort_order,
            data.connect_timeout_secs,
            data.keepalive_interval_secs,
            id,
        ],
    )?;

    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(())
}

pub fn record_connected(conn: &Connection, id: &str, connected_at: &str) -> Result<()> {
    let rows_affected = conn.execute(
        "UPDATE connections SET last_connected_at = ?1 WHERE id = ?2",
        params![connected_at, id],
    )?;

    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(())
}

pub fn delete_connection(conn: &Connection, id: &str) -> Result<()> {
    let rows_affected = conn.execute("DELETE FROM connections WHERE id = ?1", [id])?;

    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(())
}
