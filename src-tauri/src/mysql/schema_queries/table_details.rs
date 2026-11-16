use crate::mysql::cell_values::DecodedRow;
#[cfg(not(coverage))]
use crate::mysql::logged_query::{
    fetch_decoded_pooled, fetch_first_decoded_pooled, LoggedStatement,
};
#[cfg(not(coverage))]
use crate::mysql::pool::BackgroundPool;
use std::collections::HashMap;

use super::{
    safe_identifier, ColumnInfo, ForeignKeyInfo, IndexInfo, SchemaInfoResponse, SchemaObjectRef,
    TableMetadata,
};

#[cfg(not(coverage))]
pub async fn query_full_columns(
    pool: &BackgroundPool,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let sql = "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, \
         COLUMN_DEFAULT, EXTRA, CAST(ORDINAL_POSITION AS SIGNED) \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION";
    let rows = fetch_decoded_pooled(
        pool,
        LoggedStatement::bound(sql, vec![database.into(), table.into()]),
    )
    .await
    .map_err(|error| format!("Failed to get column details: {error}"))?;

    let mut columns = Vec::with_capacity(rows.len());
    for row in &rows {
        let nullable_str = row.required_text(2).unwrap_or_default();
        let ordinal = row.signed(6).unwrap_or(0);
        columns.push(ColumnInfo {
            name: row.required_text(0)?,
            data_type: row.required_text(1)?,
            nullable: nullable_str == "YES",
            column_key: row.required_text(3).unwrap_or_default(),
            default_value: row.optional_text(4)?,
            extra: row.required_text(5).unwrap_or_default(),
            ordinal_position: ordinal as u32,
        });
    }
    Ok(columns)
}

#[cfg(not(coverage))]
pub async fn query_indexes(
    pool: &BackgroundPool,
    database: &str,
    table: &str,
) -> Result<Vec<IndexInfo>, String> {
    let safe_db = safe_identifier(database)?;
    let safe_table = safe_identifier(table)?;
    let sql = format!("SHOW INDEX FROM {safe_db}.{safe_table}");
    let rows = fetch_decoded_pooled(pool, LoggedStatement::text(&sql))
        .await
        .map_err(|error| format!("Failed to get indexes: {error}"))?;

    let mut index_map: HashMap<String, IndexInfo> = HashMap::new();
    let mut index_order: Vec<String> = Vec::new();

    for row in &rows {
        let key_name: String = row.required_text("Key_name").unwrap_or_default();
        let column_name: String = row.required_text("Column_name").unwrap_or_default();
        let non_unique = row.signed("Non_unique").unwrap_or(0);
        let index_type: String = row.required_text("Index_type").unwrap_or_default();
        let cardinality = row.signed("Cardinality").ok();

        let is_visible = row
            .required_text("Visible")
            .map(|value| value == "YES")
            .unwrap_or(true);

        if !index_map.contains_key(&key_name) {
            index_order.push(key_name.clone());
            index_map.insert(
                key_name.clone(),
                IndexInfo {
                    name: key_name.clone(),
                    index_type,
                    cardinality,
                    columns: vec![],
                    is_visible,
                    is_unique: non_unique == 0,
                },
            );
        }

        if let Some(info) = index_map.get_mut(&key_name) {
            info.columns.push(column_name);
        }
    }

    Ok(index_order
        .into_iter()
        .filter_map(|name| index_map.remove(&name))
        .collect())
}

#[cfg(not(coverage))]
pub async fn query_foreign_keys(
    pool: &BackgroundPool,
    database: &str,
    table: &str,
) -> Result<Vec<ForeignKeyInfo>, String> {
    let sql = "SELECT \
             kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, \
             kcu.REFERENCED_TABLE_SCHEMA, \
             kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, \
             rc.DELETE_RULE, rc.UPDATE_RULE \
         FROM information_schema.KEY_COLUMN_USAGE kcu \
         JOIN information_schema.REFERENTIAL_CONSTRAINTS rc \
             ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME \
             AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA \
         WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? \
             AND kcu.REFERENCED_TABLE_NAME IS NOT NULL \
         ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION";
    let rows = fetch_decoded_pooled(
        pool,
        LoggedStatement::bound(sql, vec![database.into(), table.into()]),
    )
    .await
    .map_err(|error| format!("Failed to get foreign keys: {error}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.push(ForeignKeyInfo {
            name: row.required_text(0).unwrap_or_default(),
            column_name: row.required_text(1).unwrap_or_default(),
            referenced_database: row.required_text(2).unwrap_or_default(),
            referenced_table: row.required_text(3).unwrap_or_default(),
            referenced_column: row.required_text(4).unwrap_or_default(),
            on_delete: row.required_text(5).unwrap_or_default(),
            on_update: row.required_text(6).unwrap_or_default(),
        });
    }
    Ok(out)
}

#[cfg(not(coverage))]
pub async fn query_table_metadata(
    pool: &BackgroundPool,
    database: &str,
    table: &str,
) -> Result<TableMetadata, String> {
    let sql = "SELECT ENGINE, TABLE_COLLATION, \
             CAST(AUTO_INCREMENT AS SIGNED), \
             CAST(CREATE_TIME AS CHAR), \
             CAST(TABLE_ROWS AS SIGNED), \
             CAST(DATA_LENGTH AS SIGNED), \
             CAST(INDEX_LENGTH AS SIGNED) \
         FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?";
    let row = fetch_first_decoded_pooled(
        pool,
        LoggedStatement::bound(sql, vec![database.into(), table.into()]),
    )
    .await
    .map_err(|error| format!("Failed to get table metadata: {error}"))?
    .ok_or_else(|| format!("Table '{database}'.'{table}' not found"))?;

    let create_time: Option<String> = row.optional_text(3)?;

    Ok(TableMetadata {
        engine: row.required_text(0).unwrap_or_default(),
        collation: row.required_text(1).unwrap_or_default(),
        auto_increment: row.signed(2).ok(),
        create_time,
        table_rows: row.signed(4).unwrap_or(0),
        data_length: row.signed(5).unwrap_or(0),
        index_length: row.signed(6).unwrap_or(0),
    })
}

struct DdlStatement {
    sql: String,
    ddl_column_index: usize,
}

const TABLE_OR_VIEW_DDL_COLUMN: usize = 1;
const ROUTINE_OR_TRIGGER_DDL_COLUMN: usize = 2;
const EVENT_DDL_COLUMN: usize = 3;

fn ddl_statement(object: SchemaObjectRef<'_>) -> Result<DdlStatement, String> {
    let safe_db = safe_identifier(object.database)?;
    let safe_name = safe_identifier(object.object_name)?;
    let (keyword, ddl_column_index) = match object.object_type {
        "table" => ("TABLE", TABLE_OR_VIEW_DDL_COLUMN),
        "view" => ("VIEW", TABLE_OR_VIEW_DDL_COLUMN),
        "procedure" => ("PROCEDURE", ROUTINE_OR_TRIGGER_DDL_COLUMN),
        "function" => ("FUNCTION", ROUTINE_OR_TRIGGER_DDL_COLUMN),
        "trigger" => ("TRIGGER", ROUTINE_OR_TRIGGER_DDL_COLUMN),
        "event" => ("EVENT", EVENT_DDL_COLUMN),
        object_type => return Err(format!("Unknown object type: '{object_type}'")),
    };
    Ok(DdlStatement {
        sql: format!("SHOW CREATE {keyword} {safe_db}.{safe_name}"),
        ddl_column_index,
    })
}

fn ddl_query_failure(object: SchemaObjectRef<'_>, error: mysql_async::Error) -> String {
    let SchemaObjectRef {
        object_name,
        object_type,
        ..
    } = object;
    format!("Failed to get DDL for {object_type} '{object_name}': {error}")
}

fn ddl_from_first_row(
    first_row: Option<DecodedRow>,
    object: SchemaObjectRef<'_>,
    ddl_column_index: usize,
) -> Result<String, String> {
    let SchemaObjectRef {
        database,
        object_name,
        object_type,
    } = object;
    let row = first_row
        .ok_or_else(|| format!("{object_type} '{object_name}' not found in '{database}'"))?;
    Ok(row.optional_text(ddl_column_index)?.unwrap_or_default())
}

pub async fn query_ddl(
    pool: &BackgroundPool,
    object: SchemaObjectRef<'_>,
) -> Result<String, String> {
    let statement = ddl_statement(object)?;
    let first_row = fetch_first_decoded_pooled(pool, LoggedStatement::text(&statement.sql))
        .await
        .map_err(|error| ddl_query_failure(object, error))?;
    ddl_from_first_row(first_row, object, statement.ddl_column_index)
}

pub async fn query_ddl_on_connection(
    conn: &mut mysql_async::Conn,
    object: SchemaObjectRef<'_>,
) -> Result<String, String> {
    use crate::mysql::logged_query::fetch_first_decoded;

    let statement = ddl_statement(object)?;
    let first_row = fetch_first_decoded(conn, LoggedStatement::text(&statement.sql))
        .await
        .map_err(|error| ddl_query_failure(object, error))?;
    ddl_from_first_row(first_row, object, statement.ddl_column_index)
}

#[cfg(not(coverage))]
pub async fn query_schema_info(
    pool: &BackgroundPool,
    object: SchemaObjectRef<'_>,
) -> Result<SchemaInfoResponse, String> {
    let SchemaObjectRef {
        database,
        object_name,
        object_type,
    } = object;
    match object_type {
        "table" => {
            let columns = query_full_columns(pool, database, object_name).await?;
            let indexes = query_indexes(pool, database, object_name).await?;
            let foreign_keys = query_foreign_keys(pool, database, object_name).await?;
            let ddl = query_ddl(pool, object).await?;
            let metadata = query_table_metadata(pool, database, object_name).await?;
            Ok(SchemaInfoResponse {
                columns,
                indexes,
                foreign_keys,
                ddl,
                metadata: Some(metadata),
            })
        }
        "view" => {
            let columns = query_full_columns(pool, database, object_name).await?;
            let ddl = query_ddl(pool, object).await?;
            Ok(SchemaInfoResponse {
                columns,
                indexes: vec![],
                foreign_keys: vec![],
                ddl,
                metadata: None,
            })
        }
        "procedure" | "function" | "trigger" | "event" => {
            let ddl = query_ddl(pool, object).await?;
            Ok(SchemaInfoResponse {
                columns: vec![],
                indexes: vec![],
                foreign_keys: vec![],
                ddl,
                metadata: None,
            })
        }
        _ => Err(format!("Unknown object type: '{object_type}'")),
    }
}
