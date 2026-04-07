use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

/// A saved favorite query.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteEntry {
    pub id: i64,
    pub name: String,
    pub sql_text: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub connection_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Data for creating a new favorite.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFavoriteInput {
    pub name: String,
    pub sql_text: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub connection_id: Option<String>,
}

/// Data for updating an existing favorite.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFavoriteInput {
    pub name: String,
    pub sql_text: String,
    pub description: Option<String>,
    pub category: Option<String>,
}

/// Insert a new favorite. Returns the new row id.
pub fn insert_favorite(conn: &Connection, input: &CreateFavoriteInput) -> Result<i64> {
    let now = timestamp_now();
    conn.execute(
        "INSERT INTO favorites (name, sql_text, description, category, connection_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            input.name,
            input.sql_text,
            input.description,
            input.category,
            input.connection_id,
            now,
            now,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Get a favorite by ID.
pub fn get_favorite(conn: &Connection, id: i64) -> Result<Option<FavoriteEntry>> {
    conn.query_row(
        "SELECT id, name, sql_text, description, category, connection_id, created_at, updated_at
         FROM favorites WHERE id = ?1",
        params![id],
        map_row,
    )
    .optional()
}

/// List all favorites for a connection, newest first.
/// If connection_id is provided, returns favorites for that connection plus global (NULL connection_id) favorites.
pub fn list_favorites(conn: &Connection, connection_id: &str) -> Result<Vec<FavoriteEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, sql_text, description, category, connection_id, created_at, updated_at
         FROM favorites
         WHERE connection_id = ?1 OR connection_id IS NULL
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![connection_id], map_row)?;
    rows.collect::<Result<Vec<_>>>()
}

/// Update a favorite.
pub fn update_favorite(conn: &Connection, id: i64, input: &UpdateFavoriteInput) -> Result<bool> {
    let now = timestamp_now();
    let rows = conn.execute(
        "UPDATE favorites SET name = ?2, sql_text = ?3, description = ?4, category = ?5, updated_at = ?6
         WHERE id = ?1",
        params![id, input.name, input.sql_text, input.description, input.category, now],
    )?;
    Ok(rows > 0)
}

/// Delete a favorite by ID.
pub fn delete_favorite(conn: &Connection, id: i64) -> Result<bool> {
    let rows = conn.execute("DELETE FROM favorites WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

fn map_row(row: &rusqlite::Row) -> Result<FavoriteEntry> {
    Ok(FavoriteEntry {
        id: row.get(0)?,
        name: row.get(1)?,
        sql_text: row.get(2)?,
        description: row.get(3)?,
        category: row.get(4)?,
        connection_id: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

/// ISO-8601 timestamp string.
fn timestamp_now() -> String {
    chrono::Utc::now().to_rfc3339()
}
