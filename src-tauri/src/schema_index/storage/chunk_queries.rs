use super::*;

#[derive(Debug, Clone, Copy)]
pub struct IndexedTableRef<'a> {
    pub connection_id: &'a str,
    pub db_name: &'a str,
    pub table_name: &'a str,
}

pub fn delete_chunks_by_table(conn: &Connection, table: &IndexedTableRef<'_>) -> Result<()> {
    let IndexedTableRef {
        connection_id,
        db_name,
        table_name,
    } = *table;
    let vec_table = vec_table_name(connection_id);

    let mut stmt = conn.prepare(
        "SELECT id FROM schema_index_chunks
         WHERE (connection_id = ?1 AND db_name = ?2 AND table_name = ?3)
            OR (connection_id = ?1 AND ref_db_name = ?2 AND ref_table_name = ?3)",
    )?;
    let ids: Vec<i64> = stmt
        .query_map(params![connection_id, db_name, table_name], |row| {
            row.get(0)
        })?
        .collect::<Result<Vec<_>>>()?;

    for id in &ids {
        conn.execute(
            &format!("DELETE FROM {vec_table} WHERE id = ?1"),
            params![id],
        )?;
    }

    conn.execute(
        "DELETE FROM schema_index_chunks
         WHERE (connection_id = ?1 AND db_name = ?2 AND table_name = ?3)
            OR (connection_id = ?1 AND ref_db_name = ?2 AND ref_table_name = ?3)",
        params![connection_id, db_name, table_name],
    )?;

    Ok(())
}

pub fn delete_all_chunks(conn: &Connection, connection_id: &str) -> Result<()> {
    let vec_table = vec_table_name(connection_id);

    let mut stmt = conn.prepare("SELECT id FROM schema_index_chunks WHERE connection_id = ?1")?;
    let ids: Vec<i64> = stmt
        .query_map(params![connection_id], |row| row.get(0))?
        .collect::<Result<Vec<_>>>()?;

    for id in &ids {
        conn.execute(
            &format!("DELETE FROM {vec_table} WHERE id = ?1"),
            params![id],
        )?;
    }

    conn.execute(
        "DELETE FROM schema_index_chunks WHERE connection_id = ?1",
        params![connection_id],
    )?;

    delete_all_signatures(conn, connection_id)?;

    delete_fk_edges_for_connection(conn, connection_id)?;
    delete_segment_df_for_connection(conn, connection_id)?;

    Ok(())
}

pub fn delete_chunk_by_key(conn: &Connection, connection_id: &str, chunk_key: &str) -> Result<()> {
    let vec_table = vec_table_name(connection_id);

    let mut stmt = conn.prepare(
        "SELECT id FROM schema_index_chunks WHERE connection_id = ?1 AND chunk_key = ?2",
    )?;
    let ids: Vec<i64> = stmt
        .query_map(params![connection_id, chunk_key], |row| row.get(0))?
        .collect::<Result<Vec<_>>>()?;

    for id in &ids {
        conn.execute(
            &format!("DELETE FROM {vec_table} WHERE id = ?1"),
            params![id],
        )?;
    }

    conn.execute(
        "DELETE FROM schema_index_chunks WHERE connection_id = ?1 AND chunk_key = ?2",
        params![connection_id, chunk_key],
    )?;

    Ok(())
}

pub fn get_chunk_hashes(conn: &Connection, connection_id: &str) -> Result<Vec<(String, String)>> {
    let mut stmt = conn
        .prepare("SELECT chunk_key, ddl_hash FROM schema_index_chunks WHERE connection_id = ?1")?;
    let rows = stmt
        .query_map(params![connection_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get_chunk_by_key(
    conn: &Connection,
    connection_id: &str,
    chunk_key: &str,
) -> Result<Option<ChunkMetadata>> {
    let mut stmt = conn.prepare(
        "SELECT id, connection_id, chunk_key, db_name, table_name, chunk_type, ddl_text, ddl_hash, model_id, embedded_at, ref_db_name, ref_table_name, text_for_embedding, row_count_approx
         FROM schema_index_chunks
         WHERE connection_id = ?1 AND chunk_key = ?2",
    )?;
    let mut rows = stmt.query_map(params![connection_id, chunk_key], |row| {
        row_to_chunk_metadata(row)
    })?;
    match rows.next() {
        Some(Ok(meta)) => Ok(Some(meta)),
        Some(Err(error)) => Err(error),
        None => Ok(None),
    }
}

pub fn list_chunks(conn: &Connection, connection_id: &str) -> Result<Vec<ChunkMetadata>> {
    let mut stmt = conn.prepare(
        "SELECT id, connection_id, chunk_key, db_name, table_name, chunk_type, ddl_text, ddl_hash, model_id, embedded_at, ref_db_name, ref_table_name, text_for_embedding, row_count_approx
         FROM schema_index_chunks
         WHERE connection_id = ?1
         ORDER BY id",
    )?;
    let rows = stmt
        .query_map(params![connection_id], row_to_chunk_metadata)?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

pub(super) fn row_to_chunk_metadata(row: &rusqlite::Row<'_>) -> Result<ChunkMetadata> {
    let chunk_type_str: String = row.get(5)?;
    Ok(ChunkMetadata {
        id: row.get(0)?,
        connection_id: row.get(1)?,
        chunk_key: row.get(2)?,
        db_name: row.get(3)?,
        table_name: row.get(4)?,
        chunk_type: ChunkType::from_storage_str(&chunk_type_str).unwrap_or(ChunkType::Table),
        ddl_text: row.get(6)?,
        ddl_hash: row.get(7)?,
        model_id: row.get(8)?,
        embedded_at: row.get(9)?,
        ref_db_name: row.get(10)?,
        ref_table_name: row.get(11)?,
        text_for_embedding: row.get(12)?,
        row_count_approx: row.get(13)?,
    })
}

pub fn count_table_chunks(conn: &Connection, connection_id: &str) -> Result<usize> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_index_chunks WHERE connection_id = ?1 AND chunk_type = 'table'",
        params![connection_id],
        |row| row.get(0),
    )?;
    Ok(count as usize)
}
