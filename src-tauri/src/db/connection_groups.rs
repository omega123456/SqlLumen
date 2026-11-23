use rusqlite::{Connection, OptionalExtension, Result, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionGroupRecord {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub color: Option<String>,
}

pub struct GroupChanges<'a> {
    pub name: &'a str,
    pub color: Option<&'a str>,
}

fn row_to_group_record(row: &rusqlite::Row) -> rusqlite::Result<ConnectionGroupRecord> {
    Ok(ConnectionGroupRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        parent_id: row.get(2)?,
        sort_order: row.get(3)?,
        created_at: row.get(4)?,
        color: row.get(5)?,
    })
}

pub fn insert_group(conn: &Connection, name: &str) -> Result<String> {
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO connection_groups (id, name, parent_id, sort_order, created_at)
         VALUES (?1, ?2, NULL, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
        params![id, name],
    )?;

    Ok(id)
}

pub fn get_group(conn: &Connection, id: &str) -> Result<Option<ConnectionGroupRecord>> {
    conn.query_row(
        "SELECT id, name, parent_id, sort_order, created_at, color
         FROM connection_groups WHERE id = ?1",
        [id],
        row_to_group_record,
    )
    .optional()
}

pub fn list_groups(conn: &Connection) -> Result<Vec<ConnectionGroupRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, parent_id, sort_order, created_at, color
         FROM connection_groups ORDER BY sort_order, name COLLATE NOCASE",
    )?;

    let rows = stmt.query_map([], row_to_group_record)?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row?);
    }
    Ok(records)
}

pub fn update_group(conn: &Connection, id: &str, changes: &GroupChanges) -> Result<()> {
    let rows_affected = conn.execute(
        "UPDATE connection_groups SET name = ?1, color = ?2 WHERE id = ?3",
        params![changes.name, changes.color, id],
    )?;

    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(())
}

pub fn delete_group(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "UPDATE connections SET group_id = NULL WHERE group_id = ?1",
        [id],
    )?;

    crate::ai_memory::storage::delete_memories_for_group(&tx, id)?;

    let rows_affected = tx.execute("DELETE FROM connection_groups WHERE id = ?1", [id])?;

    if rows_affected == 0 {
        tx.rollback().ok();
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    tx.commit()?;
    Ok(())
}
