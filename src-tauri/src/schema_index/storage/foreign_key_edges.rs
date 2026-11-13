use super::*;

/// Replace all FK edges for an entire connection.
/// Deletes all existing edges for `connection_id` then inserts the new edges.
pub fn replace_fk_edges_for_connection(
    conn: &Connection,
    connection_id: &str,
    edges: &[FkEdge],
) -> Result<()> {
    delete_fk_edges_for_connection(conn, connection_id)?;
    let mut stmt = conn.prepare(
        "INSERT INTO schema_index_fk_edges (connection_id, src_db, src_tbl, src_col, dst_db, dst_tbl, dst_col, constraint_name, on_delete, on_update)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;
    for edge in edges {
        stmt.execute(params![
            connection_id,
            edge.src_db,
            edge.src_tbl,
            edge.src_col,
            edge.dst_db,
            edge.dst_tbl,
            edge.dst_col,
            edge.constraint_name,
            edge.on_delete.as_deref().unwrap_or("RESTRICT"),
            edge.on_update.as_deref().unwrap_or("RESTRICT"),
        ])?;
    }
    Ok(())
}

/// Replace all FK edges for a specific table (as source).
/// Deletes existing edges for this `(connection_id, src_db, src_tbl)` then
/// inserts the new edges.
pub fn replace_fk_edges_for_table(
    conn: &Connection,
    source_table: &IndexedTableRef<'_>,
    edges: &[FkEdge],
) -> Result<()> {
    let connection_id = source_table.connection_id;
    let src_db = source_table.db_name;
    let src_tbl = source_table.table_name;
    conn.execute(
        "DELETE FROM schema_index_fk_edges WHERE connection_id = ?1 AND src_db = ?2 AND src_tbl = ?3",
        params![connection_id, src_db, src_tbl],
    )?;
    let mut stmt = conn.prepare(
        "INSERT INTO schema_index_fk_edges (connection_id, src_db, src_tbl, src_col, dst_db, dst_tbl, dst_col, constraint_name, on_delete, on_update)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;
    for edge in edges {
        stmt.execute(params![
            connection_id,
            edge.src_db,
            edge.src_tbl,
            edge.src_col,
            edge.dst_db,
            edge.dst_tbl,
            edge.dst_col,
            edge.constraint_name,
            edge.on_delete.as_deref().unwrap_or("RESTRICT"),
            edge.on_update.as_deref().unwrap_or("RESTRICT"),
        ])?;
    }
    Ok(())
}

/// Get all FK edges for a connection.
pub fn get_fk_edges_for_connection(conn: &Connection, connection_id: &str) -> Result<Vec<FkEdge>> {
    let mut stmt = conn.prepare(
        "SELECT connection_id, src_db, src_tbl, src_col, dst_db, dst_tbl, dst_col, constraint_name, on_delete, on_update
         FROM schema_index_fk_edges
         WHERE connection_id = ?1",
    )?;
    let rows = stmt
        .query_map(params![connection_id], |row| {
            Ok(FkEdge {
                connection_id: row.get(0)?,
                src_db: row.get(1)?,
                src_tbl: row.get(2)?,
                src_col: row.get(3)?,
                dst_db: row.get(4)?,
                dst_tbl: row.get(5)?,
                dst_col: row.get(6)?,
                constraint_name: row.get(7)?,
                on_delete: row.get(8)?,
                on_update: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

/// Delete all FK edges for a connection.
pub fn delete_fk_edges_for_connection(conn: &Connection, connection_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM schema_index_fk_edges WHERE connection_id = ?1",
        params![connection_id],
    )?;
    Ok(())
}
