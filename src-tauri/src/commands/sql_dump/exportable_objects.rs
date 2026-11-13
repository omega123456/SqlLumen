use super::*;

/// List databases and their tables/views that can be exported.
pub async fn list_exportable_objects_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<ExportableDatabase>, String> {
    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found in registry"))?;

    // Consolidated metadata query: retrieve all non-system schemas and their
    // optional table/view metadata in a single round trip.
    let metadata_query = "\
        SELECT s.SCHEMA_NAME, t.TABLE_NAME, t.TABLE_TYPE, t.TABLE_ROWS \
        FROM information_schema.SCHEMATA s \
        LEFT JOIN information_schema.TABLES t \
          ON t.TABLE_SCHEMA = s.SCHEMA_NAME \
        WHERE s.SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
        ORDER BY s.SCHEMA_NAME, t.TABLE_NAME";

    crate::mysql::query_log::log_outgoing_sql(metadata_query);

    let rows = sqlx::query(metadata_query)
        .fetch_all(&pool)
        .await
        .map_err(|error| format!("Failed to list exportable objects: {error}"))?;

    // Group rows by schema name, preserving deterministic ordering.
    let mut result: Vec<ExportableDatabase> = Vec::new();
    for row in &rows {
        append_exportable_row(&mut result, row);
    }

    Ok(result)
}

pub(super) fn starts_new_database(databases: &[ExportableDatabase], schema_name: &str) -> bool {
    databases.last().map(|database| database.name.as_str()) != Some(schema_name)
}

pub(super) fn exportable_table_from_row(row: &sqlx::mysql::MySqlRow) -> Option<ExportableTable> {
    // LEFT JOIN produces NULL TABLE_NAME for empty databases
    let name = decode_mysql_text_cell_named(row, "TABLE_NAME").ok()?;
    if name.is_empty() {
        return None;
    }
    let table_type: String = decode_mysql_text_cell_named(row, "TABLE_TYPE").unwrap_or_default();
    let estimated_rows: i64 = row.try_get("TABLE_ROWS").unwrap_or(0);
    Some(ExportableTable {
        name,
        object_type: dump_object_type(&table_type),
        estimated_rows: estimated_rows.max(0) as u64,
    })
}

pub(super) fn append_exportable_row(
    databases: &mut Vec<ExportableDatabase>,
    row: &sqlx::mysql::MySqlRow,
) {
    let schema_name: String = decode_mysql_text_cell_named(row, "SCHEMA_NAME").unwrap_or_default();
    if starts_new_database(databases, &schema_name) {
        databases.push(ExportableDatabase {
            name: schema_name,
            tables: Vec::new(),
        });
    }
    let Some(table) = exportable_table_from_row(row) else {
        return;
    };
    if let Some(database) = databases.last_mut() {
        database.tables.push(table);
    }
}
