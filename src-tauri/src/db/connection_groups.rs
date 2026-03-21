use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A connection group record as returned to callers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionGroupRecord {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
}

/// Map a rusqlite Row to a ConnectionGroupRecord.
fn row_to_group_record(row: &rusqlite::Row) -> rusqlite::Result<ConnectionGroupRecord> {
    Ok(ConnectionGroupRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        parent_id: row.get(2)?,
        sort_order: row.get(3)?,
        created_at: row.get(4)?,
    })
}

/// Insert a new connection group. Returns the new group's UUID.
pub fn insert_group(conn: &Connection, name: &str) -> Result<String> {
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO connection_groups (id, name, parent_id, sort_order, created_at)
         VALUES (?1, ?2, NULL, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
        params![id, name],
    )?;

    Ok(id)
}

/// Get a connection group by ID. Returns None if not found.
pub fn get_group(conn: &Connection, id: &str) -> Result<Option<ConnectionGroupRecord>> {
    conn.query_row(
        "SELECT id, name, parent_id, sort_order, created_at
         FROM connection_groups WHERE id = ?1",
        [id],
        row_to_group_record,
    )
    .optional()
}

/// List all connection groups, sorted by sort_order.
pub fn list_groups(conn: &Connection) -> Result<Vec<ConnectionGroupRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, parent_id, sort_order, created_at
         FROM connection_groups ORDER BY sort_order, name COLLATE NOCASE",
    )?;

    let rows = stmt.query_map([], row_to_group_record)?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row?);
    }
    Ok(records)
}

/// Update a connection group's name. Returns an error if the group does not exist.
/// Note: connection_groups has no updated_at column.
pub fn update_group(conn: &Connection, id: &str, name: &str) -> Result<()> {
    let rows_affected = conn.execute(
        "UPDATE connection_groups SET name = ?1 WHERE id = ?2",
        params![name, id],
    )?;

    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(())
}

/// Delete a connection group by ID.
/// Sets group_id = NULL on all connections in the group before deleting.
/// Returns an error if the group does not exist.
pub fn delete_group(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;

    // Nullify group_id on all connections in this group
    tx.execute(
        "UPDATE connections SET group_id = NULL WHERE group_id = ?1",
        [id],
    )?;

    // Delete the group
    let rows_affected = tx.execute(
        "DELETE FROM connection_groups WHERE id = ?1",
        [id],
    )?;

    if rows_affected == 0 {
        tx.rollback().ok();
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    tx.commit()?;
    Ok(())
}
