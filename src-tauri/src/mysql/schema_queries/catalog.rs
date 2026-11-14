#[cfg(not(coverage))]
use crate::mysql::query_log;
#[cfg(not(coverage))]
use sqlx::MySqlPool;
use sqlx::Row;

use super::{decode_mysql_text_cell, CharsetInfo, CollationInfo, ColumnInfo, DatabaseDetails};

#[cfg(not(coverage))]
pub async fn query_list_databases(pool: &MySqlPool) -> Result<Vec<String>, String> {
    let sql = "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME";
    query_log::log_outgoing_sql(sql);
    let rows = sqlx::query(sql)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to list databases: {error}"))?;
    query_log::log_mysql_rows(&rows);

    let mut names = Vec::with_capacity(rows.len());
    for row in &rows {
        names.push(decode_mysql_text_cell(row, 0)?);
    }
    Ok(names)
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

    query_log::log_outgoing_sql_bound(sql, &[database.to_string()]);
    let rows = sqlx::query(sql)
        .bind(database)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to list {object_type}s: {error}"))?;
    query_log::log_mysql_rows(&rows);

    let mut names = Vec::with_capacity(rows.len());
    for row in &rows {
        names.push(decode_mysql_text_cell(row, 0)?);
    }
    Ok(names)
}

#[cfg(not(coverage))]
pub async fn query_list_columns(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let sql = "SELECT COLUMN_NAME, DATA_TYPE \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION";
    query_log::log_outgoing_sql_bound(sql, &[database.to_string(), table.to_string()]);
    let rows = sqlx::query(sql)
        .bind(database)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to list columns: {error}"))?;
    query_log::log_mysql_rows(&rows);

    let mut columns = Vec::with_capacity(rows.len());
    for (row_index, row) in rows.iter().enumerate() {
        columns.push(ColumnInfo {
            name: decode_mysql_text_cell(row, 0)?,
            data_type: decode_mysql_text_cell(row, 1)?,
            nullable: false,
            column_key: String::new(),
            default_value: None,
            extra: String::new(),
            ordinal_position: (row_index + 1) as u32,
        });
    }
    Ok(columns)
}

#[cfg(not(coverage))]
pub async fn query_database_details(
    pool: &MySqlPool,
    database: &str,
) -> Result<DatabaseDetails, String> {
    let sql = "SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME \
         FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?";
    query_log::log_outgoing_sql_bound(sql, &[database.to_string()]);
    let row = sqlx::query(sql)
        .bind(database)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("Failed to get database details: {error}"))?
        .ok_or_else(|| format!("Database '{database}' not found"))?;
    query_log::log_mysql_rows(std::slice::from_ref(&row));

    Ok(DatabaseDetails {
        name: decode_mysql_text_cell(&row, 0)?,
        default_character_set: decode_mysql_text_cell(&row, 1)?,
        default_collation: decode_mysql_text_cell(&row, 2)?,
    })
}

#[cfg(not(coverage))]
pub async fn query_list_charsets(pool: &MySqlPool) -> Result<Vec<CharsetInfo>, String> {
    let sql = "SHOW CHARACTER SET";
    query_log::log_outgoing_sql(sql);
    let rows = sqlx::query(sql)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to list character sets: {error}"))?;
    query_log::log_mysql_rows(&rows);

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let max_len: i64 = row.try_get(3).unwrap_or(1);
        out.push(CharsetInfo {
            charset: decode_mysql_text_cell(row, 0)?,
            description: decode_mysql_text_cell(row, 1)?,
            default_collation: decode_mysql_text_cell(row, 2)?,
            max_length: max_len as u32,
        });
    }
    Ok(out)
}

#[cfg(not(coverage))]
pub async fn query_list_collations(pool: &MySqlPool) -> Result<Vec<CollationInfo>, String> {
    let sql = "SHOW COLLATION";
    query_log::log_outgoing_sql(sql);
    let rows = sqlx::query(sql)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to list collations: {error}"))?;
    query_log::log_mysql_rows(&rows);

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let default_value = decode_mysql_text_cell(row, 3).unwrap_or_default();
        out.push(CollationInfo {
            name: decode_mysql_text_cell(row, 0)?,
            charset: decode_mysql_text_cell(row, 1)?,
            is_default: default_value == "Yes",
        });
    }
    Ok(out)
}

#[cfg(not(coverage))]
pub async fn validate_charset(pool: &MySqlPool, charset: &str) -> Result<(), String> {
    let charsets = query_list_charsets(pool).await?;
    let is_known_charset = charsets
        .iter()
        .any(|known_charset| known_charset.charset.eq_ignore_ascii_case(charset));
    if !is_known_charset {
        return Err(format!("Invalid character set: '{charset}'"));
    }
    Ok(())
}

#[cfg(not(coverage))]
fn is_collation_in_charset(
    known_collation: &CollationInfo,
    collation: &str,
    charset: &str,
) -> bool {
    known_collation.name.eq_ignore_ascii_case(collation)
        && known_collation.charset.eq_ignore_ascii_case(charset)
}

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
            .any(|known_collation| is_collation_in_charset(known_collation, collation, cs)),
        None => collations
            .iter()
            .any(|known_collation| known_collation.name.eq_ignore_ascii_case(collation)),
    };
    if !valid {
        let suffix = charset
            .map(|cs| format!(" for charset '{cs}'"))
            .unwrap_or_default();
        return Err(format!("Invalid collation: '{collation}'{suffix}"));
    }
    Ok(())
}

#[cfg(not(coverage))]
pub async fn check_rename_safe(pool: &MySqlPool, database: &str) -> Result<(), String> {
    let sql = "\
        SELECT object_type FROM (\
          (SELECT 'view'      AS object_type FROM information_schema.VIEWS \
           WHERE TABLE_SCHEMA = ? LIMIT 1) \
          UNION ALL \
          (SELECT 'procedure' FROM information_schema.ROUTINES \
           WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE' LIMIT 1) \
          UNION ALL \
          (SELECT 'function'  FROM information_schema.ROUTINES \
           WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION'  LIMIT 1) \
          UNION ALL \
          (SELECT 'trigger'   FROM information_schema.TRIGGERS \
           WHERE TRIGGER_SCHEMA = ? LIMIT 1) \
          UNION ALL \
          (SELECT 'event'     FROM information_schema.EVENTS \
           WHERE EVENT_SCHEMA = ? LIMIT 1) \
        ) blockers";

    query_log::log_outgoing_sql_bound(sql, &vec![database.to_string(); 5]);
    let rows = sqlx::query(sql)
        .bind(database)
        .bind(database)
        .bind(database)
        .bind(database)
        .bind(database)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Query failed: {error}"))?;
    query_log::log_mysql_rows(&rows);

    let blockers: Vec<String> = rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>(0).ok())
        .map(|object_type| format!("{object_type}s"))
        .collect();

    if !blockers.is_empty() {
        return Err(format!(
            "Cannot rename database '{database}': contains {}. \
             Only databases with exclusively base tables can be renamed.",
            blockers.join(", ")
        ));
    }

    Ok(())
}

#[cfg(not(coverage))]
pub async fn query_table_names(pool: &MySqlPool, database: &str) -> Result<Vec<String>, String> {
    query_list_schema_objects(pool, database, "table").await
}
