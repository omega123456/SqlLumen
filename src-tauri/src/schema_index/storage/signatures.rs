use super::*;

pub fn get_signatures_for_connection(
    conn: &Connection,
    connection_id: &str,
) -> Result<HashMap<(String, String), String>> {
    let mut stmt = conn.prepare(
        "SELECT db_name, table_name, mysql_signature
         FROM schema_index_table_signatures
         WHERE connection_id = ?1",
    )?;
    let rows = stmt.query_map(params![connection_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let mut out = HashMap::new();
    for row in rows {
        let (db, table, sig) = row?;
        out.insert((db, table), sig);
    }
    Ok(out)
}

pub fn upsert_signatures(
    conn: &Connection,
    connection_id: &str,
    entries: &[(String, String, String)],
) -> Result<()> {
    let mut stmt = conn.prepare(
        "INSERT INTO schema_index_table_signatures
            (connection_id, db_name, table_name, mysql_signature, captured_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT (connection_id, db_name, table_name)
         DO UPDATE SET mysql_signature = excluded.mysql_signature,
                       captured_at = excluded.captured_at",
    )?;
    for (db, table, sig) in entries {
        stmt.execute(params![connection_id, db, table, sig])?;
    }
    Ok(())
}

pub fn delete_signature(conn: &Connection, table: &IndexedTableRef<'_>) -> Result<()> {
    conn.execute(
        "DELETE FROM schema_index_table_signatures
         WHERE connection_id = ?1 AND db_name = ?2 AND table_name = ?3",
        params![table.connection_id, table.db_name, table.table_name],
    )?;
    Ok(())
}

pub fn delete_all_signatures(conn: &Connection, connection_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM schema_index_table_signatures WHERE connection_id = ?1",
        params![connection_id],
    )?;
    Ok(())
}
