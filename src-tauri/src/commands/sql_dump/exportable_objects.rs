use super::*;

pub async fn list_exportable_objects_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<ExportableDatabase>, String> {
    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found in registry"))?;

    let metadata_query = "\
        SELECT s.SCHEMA_NAME, t.TABLE_NAME, t.TABLE_TYPE, t.TABLE_ROWS \
        FROM information_schema.SCHEMATA s \
        LEFT JOIN information_schema.TABLES t \
          ON t.TABLE_SCHEMA = s.SCHEMA_NAME \
        WHERE s.SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
        ORDER BY s.SCHEMA_NAME, t.TABLE_NAME";

    let rows = fetch_decoded_pooled(&pool, LoggedStatement::text(metadata_query))
        .await
        .map_err(|error| format!("Failed to list exportable objects: {error}"))?;

    let mut result: Vec<ExportableDatabase> = Vec::new();
    for row in &rows {
        append_exportable_row(&mut result, row);
    }

    Ok(result)
}

pub(super) fn starts_new_database(databases: &[ExportableDatabase], schema_name: &str) -> bool {
    databases.last().map(|database| database.name.as_str()) != Some(schema_name)
}

pub(super) fn exportable_table_from_row(row: &DecodedRow) -> Option<ExportableTable> {
    let name = row.required_text("TABLE_NAME").ok()?;
    if name.is_empty() {
        return None;
    }
    let table_type: String = row.required_text("TABLE_TYPE").unwrap_or_default();
    let estimated_rows = row.signed("TABLE_ROWS").unwrap_or(0);
    Some(ExportableTable {
        name,
        object_type: dump_object_type(&table_type),
        estimated_rows: estimated_rows.max(0) as u64,
    })
}

pub(super) fn append_exportable_row(databases: &mut Vec<ExportableDatabase>, row: &DecodedRow) {
    let schema_name: String = row.required_text("SCHEMA_NAME").unwrap_or_default();
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
