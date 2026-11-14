use crate::mysql::query_executor::{TriggerMeta, ViewMeta};
#[cfg(not(coverage))]
use crate::mysql::query_log;
#[cfg(not(coverage))]
use sqlx::MySqlPool;
use std::collections::HashMap;

#[cfg(not(coverage))]
use super::connection_keys::{aggregate_index_rows, IndexRowColumns};
#[cfg(not(coverage))]
use super::decode_mysql_text_cell;
use super::{ForeignKeyInfo, IndexInfo};

#[cfg(not(coverage))]
pub async fn query_all_foreign_keys_batch(
    pool: &MySqlPool,
    databases: &[String],
) -> Result<HashMap<String, Vec<ForeignKeyInfo>>, String> {
    if databases.is_empty() {
        return Ok(HashMap::new());
    }

    let mut qb: sqlx::QueryBuilder<sqlx::MySql> = sqlx::QueryBuilder::new(
        "SELECT \
             kcu.TABLE_SCHEMA, \
             kcu.TABLE_NAME, \
             kcu.CONSTRAINT_NAME, \
             kcu.COLUMN_NAME, \
             kcu.REFERENCED_TABLE_SCHEMA, \
             kcu.REFERENCED_TABLE_NAME, \
             kcu.REFERENCED_COLUMN_NAME, \
             rc.DELETE_RULE, \
             rc.UPDATE_RULE \
         FROM information_schema.KEY_COLUMN_USAGE kcu \
         JOIN information_schema.REFERENTIAL_CONSTRAINTS rc \
             ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME \
             AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA \
         WHERE kcu.TABLE_SCHEMA IN (",
    );
    let mut sep = qb.separated(", ");
    for db in databases {
        sep.push_bind(db.clone());
    }
    sep.push_unseparated(
        ") AND kcu.REFERENCED_TABLE_NAME IS NOT NULL \
         ORDER BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
    );

    let sql = qb.sql();
    query_log::log_outgoing_sql_bound(sql.as_str(), databases);
    let rows = qb
        .build()
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to get batch foreign keys: {error}"))?;
    query_log::log_mysql_rows(&rows);

    let mut result: HashMap<String, Vec<ForeignKeyInfo>> = HashMap::new();
    for row in &rows {
        let schema = decode_mysql_text_cell(row, 0).unwrap_or_default();
        let table_name = decode_mysql_text_cell(row, 1).unwrap_or_default();
        let key = format!("{schema}.{table_name}");
        let foreign_key = ForeignKeyInfo {
            name: decode_mysql_text_cell(row, 2).unwrap_or_default(),
            column_name: decode_mysql_text_cell(row, 3).unwrap_or_default(),
            referenced_database: decode_mysql_text_cell(row, 4).unwrap_or_default(),
            referenced_table: decode_mysql_text_cell(row, 5).unwrap_or_default(),
            referenced_column: decode_mysql_text_cell(row, 6).unwrap_or_default(),
            on_delete: decode_mysql_text_cell(row, 7).unwrap_or_default(),
            on_update: decode_mysql_text_cell(row, 8).unwrap_or_default(),
        };
        result.entry(key).or_default().push(foreign_key);
    }
    Ok(result)
}

#[cfg(coverage)]
pub async fn query_all_foreign_keys_batch(
    _pool: &(),
    _databases: &[String],
) -> Result<HashMap<String, Vec<ForeignKeyInfo>>, String> {
    Ok(HashMap::new())
}

#[cfg(not(coverage))]
pub async fn query_all_views_batch(
    pool: &MySqlPool,
    databases: &[String],
) -> Result<HashMap<String, Vec<ViewMeta>>, String> {
    if databases.is_empty() {
        return Ok(HashMap::new());
    }

    let mut qb: sqlx::QueryBuilder<sqlx::MySql> = sqlx::QueryBuilder::new(
        "SELECT TABLE_SCHEMA, TABLE_NAME \
         FROM information_schema.VIEWS \
         WHERE TABLE_SCHEMA IN (",
    );
    let mut sep = qb.separated(", ");
    for db in databases {
        sep.push_bind(db.as_str());
    }
    sep.push_unseparated(
        ") AND TABLE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
         ORDER BY TABLE_SCHEMA, TABLE_NAME",
    );

    let sql = qb.sql();
    query_log::log_outgoing_sql_bound(sql.as_str(), databases);
    let rows = qb
        .build()
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to get batch views: {error}"))?;
    query_log::log_mysql_rows(&rows);

    let mut result: HashMap<String, Vec<ViewMeta>> = HashMap::new();
    for row in &rows {
        let schema = decode_mysql_text_cell(row, 0).unwrap_or_default();
        let name = decode_mysql_text_cell(row, 1).unwrap_or_default();
        result.entry(schema).or_default().push(ViewMeta { name });
    }
    Ok(result)
}

#[cfg(coverage)]
pub async fn query_all_views_batch(
    _pool: &(),
    _databases: &[String],
) -> Result<HashMap<String, Vec<ViewMeta>>, String> {
    Ok(HashMap::new())
}

#[cfg(not(coverage))]
pub async fn query_all_triggers_batch(
    pool: &MySqlPool,
    databases: &[String],
) -> Result<HashMap<String, Vec<TriggerMeta>>, String> {
    if databases.is_empty() {
        return Ok(HashMap::new());
    }

    let mut qb: sqlx::QueryBuilder<sqlx::MySql> = sqlx::QueryBuilder::new(
        "SELECT TRIGGER_SCHEMA, TRIGGER_NAME \
         FROM information_schema.TRIGGERS \
         WHERE TRIGGER_SCHEMA IN (",
    );
    let mut sep = qb.separated(", ");
    for db in databases {
        sep.push_bind(db.as_str());
    }
    sep.push_unseparated(
        ") AND TRIGGER_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
         ORDER BY TRIGGER_SCHEMA, TRIGGER_NAME",
    );

    let sql = qb.sql();
    query_log::log_outgoing_sql_bound(sql.as_str(), databases);
    let rows = qb
        .build()
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to get batch triggers: {error}"))?;
    query_log::log_mysql_rows(&rows);

    let mut result: HashMap<String, Vec<TriggerMeta>> = HashMap::new();
    for row in &rows {
        let schema = decode_mysql_text_cell(row, 0).unwrap_or_default();
        let name = decode_mysql_text_cell(row, 1).unwrap_or_default();
        result.entry(schema).or_default().push(TriggerMeta { name });
    }
    Ok(result)
}

#[cfg(coverage)]
pub async fn query_all_triggers_batch(
    _pool: &(),
    _databases: &[String],
) -> Result<HashMap<String, Vec<TriggerMeta>>, String> {
    Ok(HashMap::new())
}

#[cfg(not(coverage))]
pub async fn query_all_indexes_batch(
    pool: &MySqlPool,
    databases: &[String],
) -> Result<HashMap<String, Vec<IndexInfo>>, String> {
    if databases.is_empty() {
        return Ok(HashMap::new());
    }

    let mut qb: sqlx::QueryBuilder<sqlx::MySql> = sqlx::QueryBuilder::new(
        "SELECT \
             TABLE_SCHEMA, \
             TABLE_NAME, \
             INDEX_NAME, \
             NON_UNIQUE, \
             INDEX_TYPE, \
             COLUMN_NAME, \
             CARDINALITY \
         FROM information_schema.STATISTICS \
         WHERE TABLE_SCHEMA IN (",
    );
    let mut sep = qb.separated(", ");
    for db in databases {
        sep.push_bind(db.as_str());
    }
    sep.push_unseparated(") ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX");

    let sql = qb.sql();
    query_log::log_outgoing_sql_bound(sql.as_str(), databases);
    let rows = qb
        .build()
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to get batch indexes: {error}"))?;
    query_log::log_mysql_rows(&rows);

    Ok(aggregate_index_rows(
        &rows,
        |row| {
            let schema = decode_mysql_text_cell(row, 0).unwrap_or_default();
            let table_name = decode_mysql_text_cell(row, 1).unwrap_or_default();
            format!("{schema}.{table_name}")
        },
        &IndexRowColumns {
            index_name: 2,
            non_unique: 3,
            index_type: 4,
            column_name: 5,
            cardinality: 6,
        },
    ))
}

#[cfg(coverage)]
pub async fn query_all_indexes_batch(
    _pool: &(),
    _databases: &[String],
) -> Result<HashMap<String, Vec<IndexInfo>>, String> {
    Ok(HashMap::new())
}
