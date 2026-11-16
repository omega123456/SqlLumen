#[cfg(not(coverage))]
use crate::mysql::cell_values::DecodedRow;
#[cfg(not(coverage))]
use crate::mysql::logged_query::{
    fetch_decoded_pooled, placeholder_list, text_values, LoggedStatement,
};
#[cfg(not(coverage))]
use crate::mysql::pool::BackgroundPool;
use crate::mysql::query_executor::{TriggerMeta, ViewMeta};
use std::collections::HashMap;

#[cfg(not(coverage))]
use super::connection_keys::{aggregate_index_rows, IndexRowColumns};
use super::{ForeignKeyInfo, IndexInfo};

#[cfg(not(coverage))]
struct DatabaseListQuery<'a> {
    sql_before_list: &'a str,
    sql_after_list: &'a str,
    failure_label: &'a str,
}

#[cfg(not(coverage))]
async fn fetch_rows_for_databases(
    pool: &BackgroundPool,
    query: DatabaseListQuery<'_>,
    databases: &[String],
) -> Result<Vec<DecodedRow>, String> {
    let sql = [
        query.sql_before_list,
        placeholder_list(databases.len()).as_str(),
        query.sql_after_list,
    ]
    .concat();
    fetch_decoded_pooled(pool, LoggedStatement::bound(&sql, text_values(databases)))
        .await
        .map_err(|error| format!("Failed to get batch {}: {error}", query.failure_label))
}

#[cfg(not(coverage))]
pub async fn query_all_foreign_keys_batch(
    pool: &BackgroundPool,
    databases: &[String],
) -> Result<HashMap<String, Vec<ForeignKeyInfo>>, String> {
    if databases.is_empty() {
        return Ok(HashMap::new());
    }

    let query = DatabaseListQuery {
        sql_before_list: "SELECT \
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
        sql_after_list: ") AND kcu.REFERENCED_TABLE_NAME IS NOT NULL \
         ORDER BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
        failure_label: "foreign keys",
    };
    let rows = fetch_rows_for_databases(pool, query, databases).await?;

    let mut result: HashMap<String, Vec<ForeignKeyInfo>> = HashMap::new();
    for row in &rows {
        let schema = row.required_text(0).unwrap_or_default();
        let table_name = row.required_text(1).unwrap_or_default();
        let key = format!("{schema}.{table_name}");
        let foreign_key = ForeignKeyInfo {
            name: row.required_text(2).unwrap_or_default(),
            column_name: row.required_text(3).unwrap_or_default(),
            referenced_database: row.required_text(4).unwrap_or_default(),
            referenced_table: row.required_text(5).unwrap_or_default(),
            referenced_column: row.required_text(6).unwrap_or_default(),
            on_delete: row.required_text(7).unwrap_or_default(),
            on_update: row.required_text(8).unwrap_or_default(),
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
    pool: &BackgroundPool,
    databases: &[String],
) -> Result<HashMap<String, Vec<ViewMeta>>, String> {
    if databases.is_empty() {
        return Ok(HashMap::new());
    }

    let query = DatabaseListQuery {
        sql_before_list: "SELECT TABLE_SCHEMA, TABLE_NAME \
         FROM information_schema.VIEWS \
         WHERE TABLE_SCHEMA IN (",
        sql_after_list: ") AND TABLE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
         ORDER BY TABLE_SCHEMA, TABLE_NAME",
        failure_label: "views",
    };
    let rows = fetch_rows_for_databases(pool, query, databases).await?;

    let mut result: HashMap<String, Vec<ViewMeta>> = HashMap::new();
    for row in &rows {
        let schema = row.required_text(0).unwrap_or_default();
        let name = row.required_text(1).unwrap_or_default();
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
    pool: &BackgroundPool,
    databases: &[String],
) -> Result<HashMap<String, Vec<TriggerMeta>>, String> {
    if databases.is_empty() {
        return Ok(HashMap::new());
    }

    let query = DatabaseListQuery {
        sql_before_list: "SELECT TRIGGER_SCHEMA, TRIGGER_NAME \
         FROM information_schema.TRIGGERS \
         WHERE TRIGGER_SCHEMA IN (",
        sql_after_list: ") AND TRIGGER_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
         ORDER BY TRIGGER_SCHEMA, TRIGGER_NAME",
        failure_label: "triggers",
    };
    let rows = fetch_rows_for_databases(pool, query, databases).await?;

    let mut result: HashMap<String, Vec<TriggerMeta>> = HashMap::new();
    for row in &rows {
        let schema = row.required_text(0).unwrap_or_default();
        let name = row.required_text(1).unwrap_or_default();
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
    pool: &BackgroundPool,
    databases: &[String],
) -> Result<HashMap<String, Vec<IndexInfo>>, String> {
    if databases.is_empty() {
        return Ok(HashMap::new());
    }

    let query = DatabaseListQuery {
        sql_before_list: "SELECT \
             TABLE_SCHEMA, \
             TABLE_NAME, \
             INDEX_NAME, \
             NON_UNIQUE, \
             INDEX_TYPE, \
             COLUMN_NAME, \
             CARDINALITY \
         FROM information_schema.STATISTICS \
         WHERE TABLE_SCHEMA IN (",
        sql_after_list: ") ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
        failure_label: "indexes",
    };
    let rows = fetch_rows_for_databases(pool, query, databases).await?;

    Ok(aggregate_index_rows(
        &rows,
        |row| {
            let schema = row.required_text(0).unwrap_or_default();
            let table_name = row.required_text(1).unwrap_or_default();
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
