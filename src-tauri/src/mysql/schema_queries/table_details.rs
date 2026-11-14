#[cfg(not(coverage))]
use crate::mysql::query_log;
#[cfg(not(coverage))]
use sqlx::MySqlPool;
use sqlx::Row;
use std::collections::HashMap;

#[cfg(not(coverage))]
use super::decode_mysql_optional_text_cell;
use super::{
    decode_mysql_text_cell, decode_mysql_text_cell_named, safe_identifier, ColumnInfo,
    ForeignKeyInfo, IndexInfo, SchemaInfoResponse, SchemaObjectRef, TableMetadata,
};

#[cfg(not(coverage))]
pub async fn query_full_columns(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let sql = "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, \
         COLUMN_DEFAULT, EXTRA, CAST(ORDINAL_POSITION AS SIGNED) \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION";
    query_log::log_outgoing_sql_bound(sql, &[database.to_string(), table.to_string()]);
    let rows = sqlx::query(sql)
        .bind(database)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to get column details: {error}"))?;
    query_log::log_mysql_rows(&rows);

    let mut columns = Vec::with_capacity(rows.len());
    for row in &rows {
        let nullable_str = decode_mysql_text_cell(row, 2).unwrap_or_default();
        let ordinal: i64 = row.try_get(6).unwrap_or(0);
        columns.push(ColumnInfo {
            name: decode_mysql_text_cell(row, 0)?,
            data_type: decode_mysql_text_cell(row, 1)?,
            nullable: nullable_str == "YES",
            column_key: decode_mysql_text_cell(row, 3).unwrap_or_default(),
            default_value: decode_mysql_optional_text_cell(row, 4)?,
            extra: decode_mysql_text_cell(row, 5).unwrap_or_default(),
            ordinal_position: ordinal as u32,
        });
    }
    Ok(columns)
}

#[cfg(not(coverage))]
pub async fn query_indexes(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<Vec<IndexInfo>, String> {
    let safe_db = safe_identifier(database)?;
    let safe_table = safe_identifier(table)?;
    let sql = format!("SHOW INDEX FROM {safe_db}.{safe_table}");
    query_log::log_outgoing_sql(&sql);
    let rows = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to get indexes: {error}"))?;
    query_log::log_mysql_rows(&rows);

    let mut index_map: HashMap<String, IndexInfo> = HashMap::new();
    let mut index_order: Vec<String> = Vec::new();

    for row in &rows {
        let key_name: String = decode_mysql_text_cell_named(row, "Key_name").unwrap_or_default();
        let column_name: String =
            decode_mysql_text_cell_named(row, "Column_name").unwrap_or_default();
        let non_unique: i64 = row.try_get("Non_unique").unwrap_or(0);
        let index_type: String =
            decode_mysql_text_cell_named(row, "Index_type").unwrap_or_default();
        let cardinality: Option<i64> = row.try_get("Cardinality").ok();

        let is_visible = decode_mysql_text_cell_named(row, "Visible")
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
    pool: &MySqlPool,
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
    query_log::log_outgoing_sql_bound(sql, &[database.to_string(), table.to_string()]);
    let rows = sqlx::query(sql)
        .bind(database)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to get foreign keys: {error}"))?;
    query_log::log_mysql_rows(&rows);

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.push(ForeignKeyInfo {
            name: decode_mysql_text_cell(row, 0).unwrap_or_default(),
            column_name: decode_mysql_text_cell(row, 1).unwrap_or_default(),
            referenced_database: decode_mysql_text_cell(row, 2).unwrap_or_default(),
            referenced_table: decode_mysql_text_cell(row, 3).unwrap_or_default(),
            referenced_column: decode_mysql_text_cell(row, 4).unwrap_or_default(),
            on_delete: decode_mysql_text_cell(row, 5).unwrap_or_default(),
            on_update: decode_mysql_text_cell(row, 6).unwrap_or_default(),
        });
    }
    Ok(out)
}

#[cfg(not(coverage))]
pub async fn query_table_metadata(
    pool: &MySqlPool,
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
    query_log::log_outgoing_sql_bound(sql, &[database.to_string(), table.to_string()]);
    let row = sqlx::query(sql)
        .bind(database)
        .bind(table)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("Failed to get table metadata: {error}"))?
        .ok_or_else(|| format!("Table '{database}'.'{table}' not found"))?;
    query_log::log_mysql_rows(std::slice::from_ref(&row));

    let create_time: Option<String> = decode_mysql_optional_text_cell(&row, 3)?;

    Ok(TableMetadata {
        engine: decode_mysql_text_cell(&row, 0).unwrap_or_default(),
        collation: decode_mysql_text_cell(&row, 1).unwrap_or_default(),
        auto_increment: row.try_get(2).ok().flatten(),
        create_time,
        table_rows: row.try_get(4).unwrap_or(0),
        data_length: row.try_get(5).unwrap_or(0),
        index_length: row.try_get(6).unwrap_or(0),
    })
}

#[cfg(not(coverage))]
pub async fn query_ddl(pool: &MySqlPool, object: SchemaObjectRef<'_>) -> Result<String, String> {
    let SchemaObjectRef {
        database,
        object_name,
        object_type,
    } = object;
    let safe_db = safe_identifier(database)?;
    let safe_name = safe_identifier(object_name)?;

    let (sql, ddl_col_index) = match object_type {
        "table" => (format!("SHOW CREATE TABLE {safe_db}.{safe_name}"), 1usize),
        "view" => (format!("SHOW CREATE VIEW {safe_db}.{safe_name}"), 1usize),
        "procedure" => (
            format!("SHOW CREATE PROCEDURE {safe_db}.{safe_name}"),
            2usize,
        ),
        "function" => (
            format!("SHOW CREATE FUNCTION {safe_db}.{safe_name}"),
            2usize,
        ),
        "trigger" => (format!("SHOW CREATE TRIGGER {safe_db}.{safe_name}"), 2usize),
        "event" => (format!("SHOW CREATE EVENT {safe_db}.{safe_name}"), 3usize),
        _ => return Err(format!("Unknown object type: '{object_type}'")),
    };

    query_log::log_outgoing_sql(&sql);
    let row = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("Failed to get DDL for {object_type} '{object_name}': {error}"))?
        .ok_or_else(|| format!("{object_type} '{object_name}' not found in '{database}'"))?;
    query_log::log_mysql_rows(std::slice::from_ref(&row));

    let ddl: String = decode_mysql_optional_text_cell(&row, ddl_col_index)?.unwrap_or_default();

    Ok(ddl)
}

#[cfg(not(coverage))]
pub async fn query_schema_info(
    pool: &MySqlPool,
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
