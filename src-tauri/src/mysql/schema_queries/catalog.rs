#[cfg(not(coverage))]
use crate::mysql::logged_query::{
    LoggedStatement, fetch_decoded_pooled, fetch_first_decoded_pooled,
};
#[cfg(not(coverage))]
use crate::mysql::pool::BackgroundPool;

use super::{CharsetInfo, CollationInfo, ColumnInfo, DatabaseDetails};

#[cfg(not(coverage))]
pub async fn query_list_databases(pool: &BackgroundPool) -> Result<Vec<String>, String> {
    let sql = "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME";
    let rows = fetch_decoded_pooled(pool, LoggedStatement::text(sql))
        .await
        .map_err(|error| format!("Failed to list databases: {error}"))?;

    let mut names = Vec::with_capacity(rows.len());
    for row in &rows {
        names.push(row.required_text(0)?);
    }
    Ok(names)
}

#[cfg(not(coverage))]
pub async fn query_list_schema_objects(
    pool: &BackgroundPool,
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

    let rows = fetch_decoded_pooled(pool, LoggedStatement::bound(sql, vec![database.into()]))
        .await
        .map_err(|error| format!("Failed to list {object_type}s: {error}"))?;

    let mut names = Vec::with_capacity(rows.len());
    for row in &rows {
        names.push(row.required_text(0)?);
    }
    Ok(names)
}

#[cfg(not(coverage))]
pub async fn query_list_columns(
    pool: &BackgroundPool,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let sql = "SELECT COLUMN_NAME, DATA_TYPE \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION";
    let rows = fetch_decoded_pooled(
        pool,
        LoggedStatement::bound(sql, vec![database.into(), table.into()]),
    )
    .await
    .map_err(|error| format!("Failed to list columns: {error}"))?;

    let mut columns = Vec::with_capacity(rows.len());
    for (row_index, row) in rows.iter().enumerate() {
        columns.push(ColumnInfo {
            name: row.required_text(0)?,
            data_type: row.required_text(1)?,
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
    pool: &BackgroundPool,
    database: &str,
) -> Result<DatabaseDetails, String> {
    let sql = "SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME \
         FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?";
    let row = fetch_first_decoded_pooled(pool, LoggedStatement::bound(sql, vec![database.into()]))
        .await
        .map_err(|error| format!("Failed to get database details: {error}"))?
        .ok_or_else(|| format!("Database '{database}' not found"))?;

    Ok(DatabaseDetails {
        name: row.required_text(0)?,
        default_character_set: row.required_text(1)?,
        default_collation: row.required_text(2)?,
    })
}

#[cfg(not(coverage))]
pub async fn query_list_charsets(pool: &BackgroundPool) -> Result<Vec<CharsetInfo>, String> {
    let sql = "SHOW CHARACTER SET";
    let rows = fetch_decoded_pooled(pool, LoggedStatement::text(sql))
        .await
        .map_err(|error| format!("Failed to list character sets: {error}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let max_len = row.signed(3).unwrap_or(1);
        out.push(CharsetInfo {
            charset: row.required_text(0)?,
            description: row.required_text(1)?,
            default_collation: row.required_text(2)?,
            max_length: max_len as u32,
        });
    }
    Ok(out)
}

#[cfg(not(coverage))]
pub async fn query_list_collations(pool: &BackgroundPool) -> Result<Vec<CollationInfo>, String> {
    let sql = "SHOW COLLATION";
    let rows = fetch_decoded_pooled(pool, LoggedStatement::text(sql))
        .await
        .map_err(|error| format!("Failed to list collations: {error}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let default_value = row.required_text(3).unwrap_or_default();
        out.push(CollationInfo {
            name: row.required_text(0)?,
            charset: row.required_text(1)?,
            is_default: default_value == "Yes",
        });
    }
    Ok(out)
}

#[cfg(not(coverage))]
pub async fn validate_charset(pool: &BackgroundPool, charset: &str) -> Result<(), String> {
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
    pool: &BackgroundPool,
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

const RENAME_BLOCKER_QUERY_COUNT: usize = 5;

#[cfg(not(coverage))]
pub async fn check_rename_safe(pool: &BackgroundPool, database: &str) -> Result<(), String> {
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

    let rows = fetch_decoded_pooled(
        pool,
        LoggedStatement::bound(
            sql,
            vec![mysql_async::Value::from(database); RENAME_BLOCKER_QUERY_COUNT],
        ),
    )
    .await
    .map_err(|error| format!("Query failed: {error}"))?;

    let blockers: Vec<String> = rows
        .iter()
        .filter_map(|row| row.required_text(0).ok())
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
pub async fn query_table_names(
    pool: &BackgroundPool,
    database: &str,
) -> Result<Vec<String>, String> {
    query_list_schema_objects(pool, database, "table").await
}
