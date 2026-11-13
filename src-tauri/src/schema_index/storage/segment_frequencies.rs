use super::*;

/// Replace all segment document frequency entries for a connection.
/// `entries` is a list of `(segment, doc_count)`.
pub fn replace_segment_df_for_connection(
    conn: &Connection,
    connection_id: &str,
    entries: &[(String, usize)],
) -> Result<()> {
    delete_segment_df_for_connection(conn, connection_id)?;
    let mut stmt = conn.prepare(
        "INSERT INTO schema_index_segment_df (connection_id, segment, doc_count)
         VALUES (?1, ?2, ?3)",
    )?;
    for (segment, doc_count) in entries {
        stmt.execute(params![connection_id, segment, *doc_count as i64])?;
    }
    Ok(())
}

/// Get segment → doc_count map for a connection.
pub fn get_segment_df_for_connection(
    conn: &Connection,
    connection_id: &str,
) -> Result<HashMap<String, usize>> {
    let mut stmt = conn.prepare(
        "SELECT segment, doc_count FROM schema_index_segment_df WHERE connection_id = ?1",
    )?;
    let rows = stmt.query_map(params![connection_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
    })?;
    let mut map = HashMap::new();
    for row in rows {
        let (seg, count) = row?;
        map.insert(seg, count);
    }
    Ok(map)
}

/// Delete all segment DF entries for a connection.
pub fn delete_segment_df_for_connection(conn: &Connection, connection_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM schema_index_segment_df WHERE connection_id = ?1",
        params![connection_id],
    )?;
    Ok(())
}
