#[cfg(not(coverage))]
use crate::mysql::query_log;
#[cfg(not(coverage))]
use sqlx::mysql::MySqlRow;
#[cfg(not(coverage))]
use sqlx::MySqlPool;
#[cfg(not(coverage))]
use sqlx::Row;
use std::collections::HashMap;

#[cfg(not(coverage))]
use super::decode_mysql_text_cell;
use super::{ForeignKeyInfo, IndexInfo};

#[cfg(not(coverage))]
pub async fn query_all_foreign_keys(
    pool: &MySqlPool,
    database: &str,
) -> Result<HashMap<String, Vec<ForeignKeyInfo>>, String> {
    let sql = "SELECT \
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
         WHERE kcu.TABLE_SCHEMA = ? \
             AND kcu.REFERENCED_TABLE_NAME IS NOT NULL \
         ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION";
    query_log::log_outgoing_sql_bound(sql, &[database.to_string()]);
    let rows = sqlx::query(sql)
        .bind(database)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to get all foreign keys: {error}"))?;
    query_log::log_mysql_rows(&rows);

    let mut result: HashMap<String, Vec<ForeignKeyInfo>> = HashMap::new();
    for row in &rows {
        let table_name = decode_mysql_text_cell(row, 0).unwrap_or_default();
        let foreign_key = ForeignKeyInfo {
            name: decode_mysql_text_cell(row, 1).unwrap_or_default(),
            column_name: decode_mysql_text_cell(row, 2).unwrap_or_default(),
            referenced_database: decode_mysql_text_cell(row, 3).unwrap_or_default(),
            referenced_table: decode_mysql_text_cell(row, 4).unwrap_or_default(),
            referenced_column: decode_mysql_text_cell(row, 5).unwrap_or_default(),
            on_delete: decode_mysql_text_cell(row, 6).unwrap_or_default(),
            on_update: decode_mysql_text_cell(row, 7).unwrap_or_default(),
        };
        result.entry(table_name).or_default().push(foreign_key);
    }
    Ok(result)
}

#[cfg(coverage)]
pub async fn query_all_foreign_keys(
    _pool: &(),
    _database: &str,
) -> Result<HashMap<String, Vec<ForeignKeyInfo>>, String> {
    Ok(HashMap::new())
}

#[cfg(not(coverage))]
pub(super) struct IndexRowColumns {
    pub(super) index_name: usize,
    pub(super) non_unique: usize,
    pub(super) index_type: usize,
    pub(super) column_name: usize,
    pub(super) cardinality: usize,
}

#[cfg(not(coverage))]
pub(super) fn aggregate_index_rows(
    rows: &[MySqlRow],
    key_fn: impl Fn(&MySqlRow) -> String,
    columns: &IndexRowColumns,
) -> HashMap<String, Vec<IndexInfo>> {
    let mut composite_index_map: HashMap<String, HashMap<String, IndexInfo>> = HashMap::new();
    let mut composite_index_order: HashMap<String, Vec<String>> = HashMap::new();

    for row in rows {
        let key = key_fn(row);
        let index_name = decode_mysql_text_cell(row, columns.index_name).unwrap_or_default();
        let non_unique: i64 = row.try_get(columns.non_unique).unwrap_or(0);
        let index_type = decode_mysql_text_cell(row, columns.index_type).unwrap_or_default();
        let column_name = decode_mysql_text_cell(row, columns.column_name).unwrap_or_default();
        let cardinality: Option<i64> = row.try_get(columns.cardinality).ok();

        let index_map = composite_index_map.entry(key.clone()).or_default();
        let order = composite_index_order.entry(key).or_default();

        if !index_map.contains_key(&index_name) {
            order.push(index_name.clone());
            index_map.insert(
                index_name.clone(),
                IndexInfo {
                    name: index_name.clone(),
                    index_type,
                    cardinality,
                    columns: vec![],
                    is_visible: true,
                    is_unique: non_unique == 0,
                },
            );
        }

        if let Some(info) = index_map.get_mut(&index_name) {
            info.columns.push(column_name);
        }
    }

    let mut result: HashMap<String, Vec<IndexInfo>> = HashMap::new();
    for (key, mut index_map) in composite_index_map {
        let order = composite_index_order.remove(&key).unwrap_or_default();
        let indexes: Vec<IndexInfo> = order
            .into_iter()
            .filter_map(|name| index_map.remove(&name))
            .collect();
        result.insert(key, indexes);
    }
    result
}

#[cfg(not(coverage))]
pub async fn query_all_indexes(
    pool: &MySqlPool,
    database: &str,
) -> Result<HashMap<String, Vec<IndexInfo>>, String> {
    let sql = "SELECT \
             TABLE_NAME, \
             INDEX_NAME, \
             NON_UNIQUE, \
             INDEX_TYPE, \
             COLUMN_NAME, \
             CARDINALITY \
         FROM information_schema.STATISTICS \
         WHERE TABLE_SCHEMA = ? \
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX";
    query_log::log_outgoing_sql_bound(sql, &[database.to_string()]);
    let rows = sqlx::query(sql)
        .bind(database)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to get all indexes: {error}"))?;
    query_log::log_mysql_rows(&rows);

    Ok(aggregate_index_rows(
        &rows,
        |row| decode_mysql_text_cell(row, 0).unwrap_or_default(),
        &IndexRowColumns {
            index_name: 1,
            non_unique: 2,
            index_type: 3,
            column_name: 4,
            cardinality: 5,
        },
    ))
}

#[cfg(coverage)]
pub async fn query_all_indexes(
    _pool: &(),
    _database: &str,
) -> Result<HashMap<String, Vec<IndexInfo>>, String> {
    Ok(HashMap::new())
}
