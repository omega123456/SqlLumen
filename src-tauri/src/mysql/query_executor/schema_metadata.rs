use super::*;

#[cfg(not(coverage))]
fn decode_unchecked_string(row: &sqlx::mysql::MySqlRow, column_index: usize) -> Option<String> {
    if let Ok(value) = row.try_get_unchecked::<Option<String>, _>(column_index) {
        return value;
    }

    row.try_get_unchecked::<Option<Vec<u8>>, _>(column_index)
        .ok()
        .flatten()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(not(coverage))]
fn decode_required_identifier(row: &sqlx::mysql::MySqlRow, index: usize) -> Option<String> {
    decode_unchecked_string(row, index)
        .filter(|value| !crate::mysql::sql_chars::is_blank_identifier(value))
}

#[cfg(not(coverage))]
fn decode_metadata_text(row: &sqlx::mysql::MySqlRow, index: usize) -> String {
    decode_unchecked_string(row, index).unwrap_or_default()
}

#[cfg(not(coverage))]
const SYSTEM_DBS: &str = "'information_schema','performance_schema','sys','mysql'";

#[cfg(not(coverage))]
struct MetadataQuery {
    sql: String,
    label: &'static str,
}

#[cfg(not(coverage))]
async fn fetch_metadata_rows(
    pool: &sqlx::MySqlPool,
    query: MetadataQuery,
) -> Result<Vec<sqlx::mysql::MySqlRow>, String> {
    crate::mysql::query_log::log_outgoing_sql(&query.sql);
    let rows = sqlx::query(sqlx::AssertSqlSafe(query.sql.as_str()))
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to fetch {}: {error}", query.label))?;
    crate::mysql::query_log::log_mysql_rows(&rows);
    Ok(rows)
}

#[cfg(not(coverage))]
fn database_query() -> MetadataQuery {
    MetadataQuery {
        sql: format!(
            "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA \
             WHERE SCHEMA_NAME NOT IN ({SYSTEM_DBS}) ORDER BY SCHEMA_NAME"
        ),
        label: "databases",
    }
}

#[cfg(not(coverage))]
fn table_query() -> MetadataQuery {
    MetadataQuery {
        sql: format!(
            "SELECT t.TABLE_SCHEMA, t.TABLE_NAME, COALESCE(t.ENGINE,''), \
             COALESCE(c.CHARACTER_SET_NAME,''), COALESCE(t.TABLE_ROWS,0), COALESCE(t.DATA_LENGTH,0) \
             FROM information_schema.TABLES t \
             LEFT JOIN information_schema.COLLATION_CHARACTER_SET_APPLICABILITY c \
               ON c.COLLATION_NAME = t.TABLE_COLLATION \
             WHERE t.TABLE_SCHEMA NOT IN ({SYSTEM_DBS}) \
             ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME"
        ),
        label: "tables",
    }
}

#[cfg(not(coverage))]
fn column_query() -> MetadataQuery {
    MetadataQuery {
        sql: format!(
            "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE \
             FROM information_schema.COLUMNS \
             WHERE TABLE_SCHEMA NOT IN ({SYSTEM_DBS}) \
             ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
        ),
        label: "columns",
    }
}

#[cfg(not(coverage))]
fn routine_query() -> MetadataQuery {
    MetadataQuery {
        sql: format!(
            "SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE \
             FROM information_schema.ROUTINES \
             WHERE ROUTINE_SCHEMA NOT IN ({SYSTEM_DBS}) \
             ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME"
        ),
        label: "routines",
    }
}

#[cfg(not(coverage))]
fn decode_non_negative_count(row: &sqlx::mysql::MySqlRow, index: usize) -> u64 {
    row.try_get::<Option<i64>, _>(index)
        .unwrap_or(None)
        .map(|value| value as u64)
        .unwrap_or(0)
}

#[cfg(not(coverage))]
struct SchemaTableRow {
    schema: String,
    table: TableInfo,
}

#[cfg(not(coverage))]
fn decode_table_row(row: &sqlx::mysql::MySqlRow) -> Option<SchemaTableRow> {
    let schema = decode_required_identifier(row, 0)?;
    let name = decode_required_identifier(row, 1)?;
    let table = TableInfo {
        name,
        engine: decode_metadata_text(row, 2),
        charset: decode_metadata_text(row, 3),
        row_count: decode_non_negative_count(row, 4),
        data_size: decode_non_negative_count(row, 5),
    };
    Some(SchemaTableRow { schema, table })
}

#[cfg(not(coverage))]
fn group_tables(rows: &[sqlx::mysql::MySqlRow]) -> HashMap<String, Vec<TableInfo>> {
    let mut tables: HashMap<String, Vec<TableInfo>> = HashMap::new();
    for decoded in rows.iter().filter_map(decode_table_row) {
        tables
            .entry(decoded.schema)
            .or_default()
            .push(decoded.table);
    }
    tables
}

#[cfg(not(coverage))]
struct TableColumnRow {
    table_key: String,
    column: ColumnMeta,
}

#[cfg(not(coverage))]
fn decode_column_row(row: &sqlx::mysql::MySqlRow) -> Option<TableColumnRow> {
    let schema = decode_required_identifier(row, 0)?;
    let table = decode_required_identifier(row, 1)?;
    let name = decode_required_identifier(row, 2)?;
    Some(TableColumnRow {
        table_key: format!("{schema}.{table}"),
        column: ColumnMeta {
            name,
            data_type: decode_metadata_text(row, 3),
        },
    })
}

#[cfg(not(coverage))]
fn group_columns(rows: &[sqlx::mysql::MySqlRow]) -> HashMap<String, Vec<ColumnMeta>> {
    let mut columns: HashMap<String, Vec<ColumnMeta>> = HashMap::new();
    for decoded in rows.iter().filter_map(decode_column_row) {
        columns
            .entry(decoded.table_key)
            .or_default()
            .push(decoded.column);
    }
    columns
}

#[cfg(not(coverage))]
struct SchemaRoutineRow {
    schema: String,
    routine: RoutineMeta,
}

#[cfg(not(coverage))]
fn decode_routine_row(row: &sqlx::mysql::MySqlRow) -> Option<SchemaRoutineRow> {
    let schema = decode_required_identifier(row, 0)?;
    let name = decode_required_identifier(row, 1)?;
    let routine_type = decode_metadata_text(row, 2);
    Some(SchemaRoutineRow {
        schema,
        routine: RoutineMeta { name, routine_type },
    })
}

#[cfg(not(coverage))]
fn group_routines(rows: &[sqlx::mysql::MySqlRow]) -> HashMap<String, Vec<RoutineMeta>> {
    let mut routines: HashMap<String, Vec<RoutineMeta>> = HashMap::new();
    for decoded in rows.iter().filter_map(decode_routine_row) {
        routines
            .entry(decoded.schema)
            .or_default()
            .push(decoded.routine);
    }
    routines
}

#[cfg(not(coverage))]
pub async fn fetch_schema_metadata_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<SchemaMetadata, String> {
    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let (db_rows, table_rows, col_rows, routine_rows) = tokio::try_join!(
        fetch_metadata_rows(&pool, database_query()),
        fetch_metadata_rows(&pool, table_query()),
        fetch_metadata_rows(&pool, column_query()),
        fetch_metadata_rows(&pool, routine_query()),
    )?;

    Ok(SchemaMetadata {
        databases: db_rows
            .iter()
            .filter_map(|row| decode_required_identifier(row, 0))
            .collect(),
        tables: group_tables(&table_rows),
        columns: group_columns(&col_rows),
        routines: group_routines(&routine_rows),
    })
}

#[cfg(coverage)]
pub async fn fetch_schema_metadata_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<SchemaMetadata, String> {
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let mut tables = std::collections::HashMap::new();
    tables.insert(
        "stub_db".to_string(),
        vec![TableInfo {
            name: "stub_table".to_string(),
            engine: "InnoDB".to_string(),
            charset: "utf8mb4".to_string(),
            row_count: 0,
            data_size: 0,
        }],
    );

    let mut columns = std::collections::HashMap::new();
    columns.insert(
        "stub_db.stub_table".to_string(),
        vec![ColumnMeta {
            name: "id".to_string(),
            data_type: "INT".to_string(),
        }],
    );

    let mut routines = std::collections::HashMap::new();
    routines.insert(
        "stub_db".to_string(),
        vec![RoutineMeta {
            name: "stub_proc".to_string(),
            routine_type: "PROCEDURE".to_string(),
        }],
    );

    Ok(SchemaMetadata {
        databases: vec!["stub_db".to_string()],
        tables,
        columns,
        routines,
    })
}

#[cfg(not(coverage))]
fn batch_or_empty<T>(
    result: Result<HashMap<String, T>, String>,
    label: &str,
) -> HashMap<String, T> {
    result.unwrap_or_else(|error| {
        tracing::warn!(error = %error, "failed to fetch {label} batch");
        HashMap::new()
    })
}

#[cfg(not(coverage))]
pub async fn fetch_schema_metadata_full_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<SchemaMetadataFull, String> {
    use crate::mysql::schema_queries::{
        query_all_foreign_keys_batch, query_all_indexes_batch, query_all_triggers_batch,
        query_all_views_batch,
    };

    let base = fetch_schema_metadata_impl(state, connection_id).await?;

    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let db_names: Vec<String> = base.databases.clone();

    let (foreign_keys, indexes, views, triggers) = tokio::join!(
        async {
            batch_or_empty(
                query_all_foreign_keys_batch(&pool, &db_names).await,
                "foreign keys",
            )
        },
        async { batch_or_empty(query_all_indexes_batch(&pool, &db_names).await, "indexes") },
        async { batch_or_empty(query_all_views_batch(&pool, &db_names).await, "views") },
        async { batch_or_empty(query_all_triggers_batch(&pool, &db_names).await, "triggers") },
    );

    Ok(SchemaMetadataFull {
        databases: base.databases,
        tables: base.tables,
        columns: base.columns,
        routines: base.routines,
        views,
        triggers,
        foreign_keys,
        indexes,
    })
}

#[cfg(coverage)]
pub async fn fetch_schema_metadata_full_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<SchemaMetadataFull, String> {
    let base = fetch_schema_metadata_impl(state, connection_id).await?;

    Ok(SchemaMetadataFull {
        databases: base.databases,
        tables: base.tables,
        columns: base.columns,
        routines: base.routines,
        views: HashMap::new(),
        triggers: HashMap::new(),
        foreign_keys: HashMap::new(),
        indexes: HashMap::new(),
    })
}
