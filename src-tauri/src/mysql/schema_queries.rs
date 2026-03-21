//! MySQL schema queries using INFORMATION_SCHEMA.
//!
//! This module contains SQL query helpers that run against a live MySQL/MariaDB
//! server. It is intentionally separate from the `db/` module which is SQLite-only.

use serde::Serialize;
#[cfg(not(coverage))]
use sqlx::{MySqlPool, Row};
#[cfg(not(coverage))]
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Data models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDetails {
    pub name: String,
    pub default_character_set: String,
    pub default_collation: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharsetInfo {
    pub charset: String,
    pub description: String,
    pub default_collation: String,
    pub max_length: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollationInfo {
    pub name: String,
    pub charset: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObject {
    pub name: String,
    pub object_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub column_key: String,
    pub default_value: Option<String>,
    pub extra: String,
    pub ordinal_position: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub index_type: String,
    pub cardinality: Option<i64>,
    pub columns: Vec<String>,
    pub is_visible: bool,
    pub is_unique: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInfo {
    pub name: String,
    pub column_name: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub on_delete: String,
    pub on_update: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableMetadata {
    pub engine: String,
    pub collation: String,
    pub auto_increment: Option<i64>,
    pub create_time: Option<String>,
    pub table_rows: i64,
    pub data_length: i64,
    pub index_length: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfoResponse {
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub ddl: String,
    pub metadata: Option<TableMetadata>,
}

// ---------------------------------------------------------------------------
// Identifier escaping
// ---------------------------------------------------------------------------

/// Wraps a MySQL identifier in backticks, escaping any internal backticks
/// by doubling them. Rejects empty identifiers and identifiers exceeding
/// 64 characters.
pub fn safe_identifier(name: &str) -> Result<String, String> {
    if name.is_empty() {
        return Err("Identifier cannot be empty".to_string());
    }
    let char_count = name.chars().count();
    if char_count > 64 {
        return Err(format!(
            "Identifier exceeds 64 characters (got {char_count})"
        ));
    }
    let escaped = name.replace('`', "``");
    Ok(format!("`{escaped}`"))
}

// ---------------------------------------------------------------------------
// MySQL query functions — excluded from coverage builds (no real MySQL pool)
// ---------------------------------------------------------------------------

#[cfg(not(coverage))]
pub async fn query_list_databases(pool: &MySqlPool) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list databases: {e}"))?;

    Ok(rows.iter().map(|row| row.get::<String, _>(0)).collect())
}

#[cfg(not(coverage))]
pub async fn query_list_schema_objects(
    pool: &MySqlPool,
    database: &str,
    object_type: &str,
) -> Result<Vec<String>, String> {
    let sql = match object_type {
        "table" => {
            "SELECT TABLE_NAME FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' \
             ORDER BY TABLE_NAME"
        }
        "view" => {
            "SELECT TABLE_NAME FROM information_schema.VIEWS \
             WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME"
        }
        "procedure" => {
            "SELECT ROUTINE_NAME FROM information_schema.ROUTINES \
             WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE' \
             ORDER BY ROUTINE_NAME"
        }
        "function" => {
            "SELECT ROUTINE_NAME FROM information_schema.ROUTINES \
             WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION' \
             ORDER BY ROUTINE_NAME"
        }
        "trigger" => {
            "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS \
             WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME"
        }
        "event" => {
            "SELECT EVENT_NAME FROM information_schema.EVENTS \
             WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME"
        }
        _ => return Err(format!("Unknown object type: '{object_type}'")),
    };

    let rows = sqlx::query(sql)
        .bind(database)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to list {object_type}s: {e}"))?;

    Ok(rows.iter().map(|row| row.get::<String, _>(0)).collect())
}

#[cfg(not(coverage))]
pub async fn query_list_columns(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let rows = sqlx::query(
        "SELECT COLUMN_NAME, DATA_TYPE \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION",
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list columns: {e}"))?;

    Ok(rows
        .iter()
        .enumerate()
        .map(|(i, row)| ColumnInfo {
            name: row.get::<String, _>(0),
            data_type: row.get::<String, _>(1),
            nullable: false,
            column_key: String::new(),
            default_value: None,
            extra: String::new(),
            ordinal_position: (i + 1) as u32,
        })
        .collect())
}

#[cfg(not(coverage))]
pub async fn query_database_details(
    pool: &MySqlPool,
    database: &str,
) -> Result<DatabaseDetails, String> {
    let row = sqlx::query(
        "SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME \
         FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
    )
    .bind(database)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to get database details: {e}"))?
    .ok_or_else(|| format!("Database '{database}' not found"))?;

    Ok(DatabaseDetails {
        name: row.get::<String, _>(0),
        default_character_set: row.get::<String, _>(1),
        default_collation: row.get::<String, _>(2),
    })
}

#[cfg(not(coverage))]
pub async fn query_list_charsets(pool: &MySqlPool) -> Result<Vec<CharsetInfo>, String> {
    let rows = sqlx::query("SHOW CHARACTER SET")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to list character sets: {e}"))?;

    Ok(rows
        .iter()
        .map(|row| {
            let max_len: i64 = row.try_get(3).unwrap_or(1);
            CharsetInfo {
                charset: row.get::<String, _>(0),
                description: row.get::<String, _>(1),
                default_collation: row.get::<String, _>(2),
                max_length: max_len as u32,
            }
        })
        .collect())
}

#[cfg(not(coverage))]
pub async fn query_list_collations(pool: &MySqlPool) -> Result<Vec<CollationInfo>, String> {
    let rows = sqlx::query("SHOW COLLATION")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to list collations: {e}"))?;

    Ok(rows
        .iter()
        .map(|row| {
            let default_val: String = row.try_get(3).unwrap_or_default();
            CollationInfo {
                name: row.get::<String, _>(0),
                charset: row.get::<String, _>(1),
                is_default: default_val == "Yes",
            }
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Full schema info queries
// ---------------------------------------------------------------------------

/// Full column details from INFORMATION_SCHEMA.COLUMNS (used by get_schema_info).
#[cfg(not(coverage))]
pub async fn query_full_columns(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let rows = sqlx::query(
        "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, \
         COLUMN_DEFAULT, EXTRA, CAST(ORDINAL_POSITION AS SIGNED) \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION",
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to get column details: {e}"))?;

    Ok(rows
        .iter()
        .map(|row| {
            let nullable_str: String = row.try_get(2).unwrap_or_default();
            let ordinal: i64 = row.try_get(6).unwrap_or(0);
            ColumnInfo {
                name: row.get::<String, _>(0),
                data_type: row.get::<String, _>(1),
                nullable: nullable_str == "YES",
                column_key: row.try_get::<String, _>(3).unwrap_or_default(),
                default_value: row.try_get::<Option<String>, _>(4).unwrap_or(None),
                extra: row.try_get::<String, _>(5).unwrap_or_default(),
                ordinal_position: ordinal as u32,
            }
        })
        .collect())
}

/// Index info via `SHOW INDEX FROM db.table` (works across MySQL versions).
#[cfg(not(coverage))]
pub async fn query_indexes(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<Vec<IndexInfo>, String> {
    let safe_db = safe_identifier(database)?;
    let safe_table = safe_identifier(table)?;
    let sql = format!("SHOW INDEX FROM {safe_db}.{safe_table}");

    let rows = sqlx::query(&sql)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to get indexes: {e}"))?;

    let mut index_map: HashMap<String, IndexInfo> = HashMap::new();
    let mut index_order: Vec<String> = Vec::new();

    for row in &rows {
        let key_name: String = row.try_get("Key_name").unwrap_or_default();
        let column_name: String = row.try_get("Column_name").unwrap_or_default();
        let non_unique: i64 = row.try_get("Non_unique").unwrap_or(0);
        let index_type: String = row.try_get("Index_type").unwrap_or_default();
        let cardinality: Option<i64> = row.try_get("Cardinality").ok();

        // MySQL 8.0+ has a Visible column; older versions and MariaDB do not.
        let is_visible = row
            .try_get::<String, _>("Visible")
            .map(|v| v == "YES")
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

/// Foreign key info from INFORMATION_SCHEMA.
#[cfg(not(coverage))]
pub async fn query_foreign_keys(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<Vec<ForeignKeyInfo>, String> {
    let rows = sqlx::query(
        "SELECT \
             kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, \
             kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, \
             rc.DELETE_RULE, rc.UPDATE_RULE \
         FROM information_schema.KEY_COLUMN_USAGE kcu \
         JOIN information_schema.REFERENTIAL_CONSTRAINTS rc \
             ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME \
             AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA \
         WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? \
             AND kcu.REFERENCED_TABLE_NAME IS NOT NULL \
         ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to get foreign keys: {e}"))?;

    Ok(rows
        .iter()
        .map(|row| ForeignKeyInfo {
            name: row.try_get::<String, _>(0).unwrap_or_default(),
            column_name: row.try_get::<String, _>(1).unwrap_or_default(),
            referenced_table: row.try_get::<String, _>(2).unwrap_or_default(),
            referenced_column: row.try_get::<String, _>(3).unwrap_or_default(),
            on_delete: row.try_get::<String, _>(4).unwrap_or_default(),
            on_update: row.try_get::<String, _>(5).unwrap_or_default(),
        })
        .collect())
}

/// Table metadata from INFORMATION_SCHEMA.TABLES.
#[cfg(not(coverage))]
pub async fn query_table_metadata(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<TableMetadata, String> {
    let row = sqlx::query(
        "SELECT ENGINE, TABLE_COLLATION, \
             CAST(AUTO_INCREMENT AS SIGNED), \
             CAST(CREATE_TIME AS CHAR), \
             CAST(TABLE_ROWS AS SIGNED), \
             CAST(DATA_LENGTH AS SIGNED), \
             CAST(INDEX_LENGTH AS SIGNED) \
         FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    )
    .bind(database)
    .bind(table)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to get table metadata: {e}"))?
    .ok_or_else(|| format!("Table '{database}'.'{table}' not found"))?;

    let create_time: Option<String> = row.try_get(3).ok().flatten();

    Ok(TableMetadata {
        engine: row.try_get::<String, _>(0).unwrap_or_default(),
        collation: row.try_get::<String, _>(1).unwrap_or_default(),
        auto_increment: row.try_get(2).ok().flatten(),
        create_time,
        table_rows: row.try_get(4).unwrap_or(0),
        data_length: row.try_get(5).unwrap_or(0),
        index_length: row.try_get(6).unwrap_or(0),
    })
}

/// DDL via SHOW CREATE TABLE / VIEW / PROCEDURE / FUNCTION / TRIGGER / EVENT.
#[cfg(not(coverage))]
pub async fn query_ddl(
    pool: &MySqlPool,
    database: &str,
    object_name: &str,
    object_type: &str,
) -> Result<String, String> {
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
        "trigger" => (
            format!("SHOW CREATE TRIGGER {safe_db}.{safe_name}"),
            2usize,
        ),
        "event" => (format!("SHOW CREATE EVENT {safe_db}.{safe_name}"), 3usize),
        _ => return Err(format!("Unknown object type: '{object_type}'")),
    };

    let row = sqlx::query(&sql)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to get DDL for {object_type} '{object_name}': {e}"))?
        .ok_or_else(|| format!("{object_type} '{object_name}' not found in '{database}'"))?;

    // The DDL column may be NULL (e.g. insufficient privileges for SHOW CREATE PROCEDURE).
    let ddl: String = row
        .try_get::<Option<String>, _>(ddl_col_index)
        .unwrap_or(None)
        .unwrap_or_default();

    Ok(ddl)
}

/// Combined schema info for get_schema_info command.
#[cfg(not(coverage))]
pub async fn query_schema_info(
    pool: &MySqlPool,
    database: &str,
    object_name: &str,
    object_type: &str,
) -> Result<SchemaInfoResponse, String> {
    match object_type {
        "table" => {
            let columns = query_full_columns(pool, database, object_name).await?;
            let indexes = query_indexes(pool, database, object_name).await?;
            let foreign_keys = query_foreign_keys(pool, database, object_name).await?;
            let ddl = query_ddl(pool, database, object_name, "table").await?;
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
            let ddl = query_ddl(pool, database, object_name, "view").await?;
            Ok(SchemaInfoResponse {
                columns,
                indexes: vec![],
                foreign_keys: vec![],
                ddl,
                metadata: None,
            })
        }
        "procedure" | "function" | "trigger" | "event" => {
            let ddl = query_ddl(pool, database, object_name, object_type).await?;
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

// ---------------------------------------------------------------------------
// Charset / collation validation helpers
// ---------------------------------------------------------------------------

/// Validate that a charset exists on the server.
#[cfg(not(coverage))]
pub async fn validate_charset(pool: &MySqlPool, charset: &str) -> Result<(), String> {
    let charsets = query_list_charsets(pool).await?;
    if !charsets
        .iter()
        .any(|c| c.charset.eq_ignore_ascii_case(charset))
    {
        return Err(format!("Invalid character set: '{charset}'"));
    }
    Ok(())
}

/// Validate that a collation exists for a given charset on the server.
/// If charset is None, validates collation against all collations.
#[cfg(not(coverage))]
pub async fn validate_collation(
    pool: &MySqlPool,
    collation: &str,
    charset: Option<&str>,
) -> Result<(), String> {
    let collations = query_list_collations(pool).await?;
    let valid = match charset {
        Some(cs) => collations
            .iter()
            .any(|c| c.name.eq_ignore_ascii_case(collation) && c.charset.eq_ignore_ascii_case(cs)),
        None => collations
            .iter()
            .any(|c| c.name.eq_ignore_ascii_case(collation)),
    };
    if !valid {
        let suffix = charset
            .map(|cs| format!(" for charset '{cs}'"))
            .unwrap_or_default();
        return Err(format!("Invalid collation: '{collation}'{suffix}"));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Rename database preflight check
// ---------------------------------------------------------------------------

/// Check if a database has non-table objects (views, routines, triggers, events).
/// Returns Ok(()) if safe to rename (only tables), or Err with details.
#[cfg(not(coverage))]
pub async fn check_rename_safe(pool: &MySqlPool, database: &str) -> Result<(), String> {
    let view_count = count_query(
        pool,
        "SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?",
        database,
    )
    .await?;

    let proc_count = count_query(
        pool,
        "SELECT COUNT(*) FROM information_schema.ROUTINES \
         WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'",
        database,
    )
    .await?;

    let func_count = count_query(
        pool,
        "SELECT COUNT(*) FROM information_schema.ROUTINES \
         WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION'",
        database,
    )
    .await?;

    let trigger_count = count_query(
        pool,
        "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?",
        database,
    )
    .await?;

    let event_count = count_query(
        pool,
        "SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?",
        database,
    )
    .await?;

    let mut issues = Vec::new();
    if view_count > 0 {
        issues.push(format!("{view_count} view(s)"));
    }
    if proc_count > 0 {
        issues.push(format!("{proc_count} procedure(s)"));
    }
    if func_count > 0 {
        issues.push(format!("{func_count} function(s)"));
    }
    if trigger_count > 0 {
        issues.push(format!("{trigger_count} trigger(s)"));
    }
    if event_count > 0 {
        issues.push(format!("{event_count} event(s)"));
    }

    if !issues.is_empty() {
        return Err(format!(
            "Cannot rename database '{database}': contains {}. \
             Only databases with exclusively base tables can be renamed.",
            issues.join(", ")
        ));
    }

    Ok(())
}

#[cfg(not(coverage))]
async fn count_query(pool: &MySqlPool, sql: &str, bind: &str) -> Result<i64, String> {
    let row = sqlx::query(sql)
        .bind(bind)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Query failed: {e}"))?;
    Ok(row.try_get::<i64, _>(0).unwrap_or(0))
}

/// Get list of base table names in a database.
#[cfg(not(coverage))]
pub async fn query_table_names(pool: &MySqlPool, database: &str) -> Result<Vec<String>, String> {
    query_list_schema_objects(pool, database, "table").await
}
