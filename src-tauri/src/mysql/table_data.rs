//! Table data operations: fetch paginated data, CRUD operations, and export.
//!
//! This module contains the business logic (`*_impl` functions) for browsing
//! and editing table data. Each function takes a `MySqlPool` directly (the
//! command wrappers in `commands::table_data` extract the pool from `AppState`).

use crate::mysql::schema_queries::safe_identifier;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[cfg(not(coverage))]
use sqlx::Column;
#[cfg(not(coverage))]
use sqlx::Row;
#[cfg(not(coverage))]
use sqlx::TypeInfo;
#[cfg(not(coverage))]
use sqlx::ValueRef;

#[cfg(not(coverage))]
const JS_SAFE_INTEGER_MAX: i64 = 9_007_199_254_740_991;

#[cfg(not(coverage))]
const JS_SAFE_INTEGER_MIN: i64 = -JS_SAFE_INTEGER_MAX;

// ── Data structures ────────────────────────────────────────────────────────────

/// Column metadata for table data, including PK/UNIQUE and nullability info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataColumnMeta {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
    pub is_unique_key: bool,
    pub has_default: bool,
    pub column_default: Option<String>,
    pub is_binary: bool,
    pub is_auto_increment: bool,
}

/// Primary / unique key info for a table.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrimaryKeyInfo {
    pub key_columns: Vec<String>,
    pub has_auto_increment: bool,
    pub is_unique_key_fallback: bool,
}

/// Paginated response from `fetch_table_data`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataResponse {
    pub columns: Vec<TableDataColumnMeta>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total_rows: u64,
    pub current_page: u32,
    pub total_pages: u32,
    pub page_size: u32,
    pub primary_key: Option<PrimaryKeyInfo>,
    pub execution_time_ms: u64,
}

/// Sort specification for a single column.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortInfo {
    pub column: String,
    pub direction: String,
}

/// AG Grid filter model entry for a single column.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterModelEntry {
    pub filter_type: String,
    pub filter_condition: String,
    pub filter: Option<String>,
    pub filter_to: Option<String>,
}

/// A WHERE clause fragment with bound parameter values.
#[derive(Debug, Clone)]
pub struct FilterClause {
    pub sql: String,
    pub params: Vec<serde_json::Value>,
}

/// Options for exporting table data to a file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTableOptions {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub format: String,
    pub file_path: String,
    pub include_headers: bool,
    pub table_name_for_sql: String,
    pub filter_model: HashMap<String, FilterModelEntry>,
    pub sort: Option<SortInfo>,
}

// ── Pure functions (always available) ──────────────────────────────────────────

/// Describes how a filter condition maps to SQL.
enum FilterOp {
    /// Simple comparison operator: `col <op> ?` (e.g., `=`, `!=`, `<`, `>`)
    Operator(&'static str),
    /// LIKE pattern with prefix/suffix: `col LIKE ?` with value `{prefix}{val}{suffix}`
    Like(&'static str, &'static str),
    /// `col IS NULL OR col = ''`
    Blank,
    /// `col IS NOT NULL AND col != ''`
    NotBlank,
    /// `col >= ? AND col <= ?` using filter and filter_to
    InRange,
}

/// Map an AG Grid filter condition string to its SQL operation.
fn get_filter_op(condition: &str) -> Option<FilterOp> {
    match condition {
        "equals" => Some(FilterOp::Operator("=")),
        "notEqual" => Some(FilterOp::Operator("!=")),
        "lessThan" => Some(FilterOp::Operator("<")),
        "greaterThan" => Some(FilterOp::Operator(">")),
        "lessThanOrEqual" => Some(FilterOp::Operator("<=")),
        "greaterThanOrEqual" => Some(FilterOp::Operator(">=")),
        "contains" => Some(FilterOp::Like("%", "%")),
        "notContains" => Some(FilterOp::Like("%", "%")),
        "startsWith" => Some(FilterOp::Like("", "%")),
        "endsWith" => Some(FilterOp::Like("%", "")),
        "blank" => Some(FilterOp::Blank),
        "notBlank" => Some(FilterOp::NotBlank),
        "inRange" => Some(FilterOp::InRange),
        _ => None,
    }
}

/// Convert an AG Grid filter model to a SQL WHERE clause with bound params.
///
/// Entries are sorted by column name for deterministic SQL output.
/// Column names are backtick-quoted via `safe_identifier`.
/// If the filter model is empty, returns an empty `FilterClause`.
pub fn translate_filter_model(
    filter_model: &HashMap<String, FilterModelEntry>,
) -> FilterClause {
    if filter_model.is_empty() {
        return FilterClause {
            sql: String::new(),
            params: vec![],
        };
    }

    let mut entries: Vec<(&String, &FilterModelEntry)> = filter_model.iter().collect();
    entries.sort_by_key(|(k, _)| (*k).clone());

    let mut conditions = Vec::new();
    let mut params = Vec::new();

    for (col_name, entry) in entries {
        let safe_col = match safe_identifier(col_name) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let op = match get_filter_op(entry.filter_condition.as_str()) {
            Some(op) => op,
            None => continue, // Unknown condition — skip
        };

        match op {
            FilterOp::Operator(sql_op) => {
                if let Some(ref val) = entry.filter {
                    conditions.push(format!("{safe_col} {sql_op} ?"));
                    params.push(serde_json::Value::String(val.clone()));
                }
            }
            FilterOp::Like(prefix, suffix) => {
                if let Some(ref val) = entry.filter {
                    let is_not = entry.filter_condition == "notContains";
                    let like_kw = if is_not { "NOT LIKE" } else { "LIKE" };
                    conditions.push(format!("{safe_col} {like_kw} ?"));
                    params.push(serde_json::Value::String(format!(
                        "{prefix}{val}{suffix}"
                    )));
                }
            }
            FilterOp::Blank => {
                conditions.push(format!("({safe_col} IS NULL OR {safe_col} = '')"));
            }
            FilterOp::NotBlank => {
                conditions.push(format!(
                    "({safe_col} IS NOT NULL AND {safe_col} != '')"
                ));
            }
            FilterOp::InRange => {
                if let (Some(ref from), Some(ref to)) = (&entry.filter, &entry.filter_to) {
                    conditions.push(format!("{safe_col} >= ? AND {safe_col} <= ?"));
                    params.push(serde_json::Value::String(from.clone()));
                    params.push(serde_json::Value::String(to.clone()));
                }
            }
        }
    }

    if conditions.is_empty() {
        return FilterClause {
            sql: String::new(),
            params: vec![],
        };
    }

    FilterClause {
        sql: conditions.join(" AND "),
        params,
    }
}

// ── Helper: check whether a DATA_TYPE string is binary ─────────────────────────

fn is_binary_data_type(data_type: &str) -> bool {
    let upper = data_type.to_uppercase();
    matches!(
        upper.as_str(),
        "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BINARY" | "VARBINARY"
    )
}

// ── Real implementations (excluded from coverage builds) ──────────────────────

#[cfg(not(coverage))]
fn decode_text(row: &sqlx::mysql::MySqlRow, index: usize) -> String {
    match row.try_get::<String, _>(index) {
        Ok(s) => s,
        Err(_) => match row.try_get::<Vec<u8>, _>(index) {
            Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(_) => String::new(),
        },
    }
}

#[cfg(not(coverage))]
fn decode_optional_text(row: &sqlx::mysql::MySqlRow, index: usize) -> Option<String> {
    match row.try_get::<Option<String>, _>(index) {
        Ok(s) => s,
        Err(_) => match row.try_get::<Option<Vec<u8>>, _>(index) {
            Ok(opt) => opt.map(|b| String::from_utf8_lossy(&b).into_owned()),
            Err(_) => None,
        },
    }
}

/// Serialize a single cell value from a MySQL row for the table data browser.
///
/// Binary columns are handled specially:
/// - PK columns → hex string `0xABCDEF`
/// - Non-PK columns → placeholder `[BLOB - N bytes]`
#[cfg(not(coverage))]
fn serialize_table_value(
    row: &sqlx::mysql::MySqlRow,
    i: usize,
    is_binary: bool,
    is_pk: bool,
) -> serde_json::Value {
    let raw_value = match row.try_get_raw(i) {
        Ok(value) => value,
        Err(_) => return serde_json::Value::Null,
    };

    if raw_value.is_null() {
        return serde_json::Value::Null;
    }

    // Binary columns: placeholder or hex
    if is_binary {
        if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(i) {
            return match v {
                Some(bytes) => {
                    if is_pk {
                        let hex: String =
                            bytes.iter().map(|b| format!("{:02X}", b)).collect();
                        serde_json::Value::String(format!("0x{hex}"))
                    } else {
                        serde_json::Value::String(format!(
                            "[BLOB - {} bytes]",
                            bytes.len()
                        ))
                    }
                }
                None => serde_json::Value::Null,
            };
        }
        return serde_json::Value::Null;
    }

    let type_name = raw_value.type_info().name().to_uppercase();

    // Integer types
    if matches!(
        type_name.as_str(),
        "TINYINT" | "SHORT" | "LONG" | "INT24" | "LONGLONG"
    ) || type_name.contains("INT")
        || type_name == "YEAR"
    {
        if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
            return v
                .map(|n| {
                    if (JS_SAFE_INTEGER_MIN..=JS_SAFE_INTEGER_MAX).contains(&n) {
                        serde_json::Value::from(n)
                    } else {
                        serde_json::Value::String(n.to_string())
                    }
                })
                .unwrap_or(serde_json::Value::Null);
        }
        if let Ok(v) = row.try_get::<Option<u64>, _>(i) {
            return v
                .map(|n| {
                    if n > JS_SAFE_INTEGER_MAX as u64 {
                        serde_json::Value::String(n.to_string())
                    } else {
                        serde_json::Value::from(n)
                    }
                })
                .unwrap_or(serde_json::Value::Null);
        }
    }

    // Float types (FLOAT, DOUBLE — NOT DECIMAL/NUMERIC)
    if type_name.contains("FLOAT") || type_name.contains("DOUBLE") {
        if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
            return v
                .map(|f| {
                    serde_json::Number::from_f64(f)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null)
                })
                .unwrap_or(serde_json::Value::Null);
        }
    }

    // DECIMAL/NUMERIC: string to preserve precision
    if type_name.contains("DECIMAL") || type_name.contains("NUMERIC") {
        if let Ok(v) = row.try_get::<Option<String>, _>(i) {
            return v
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null);
        }
    }

    // Default: string
    match row.try_get::<Option<String>, _>(i) {
        Ok(Some(s)) => serde_json::Value::String(s),
        Ok(None) => serde_json::Value::Null,
        Err(_) => match row.try_get::<Option<Vec<u8>>, _>(i) {
            Ok(Some(bytes)) => {
                serde_json::Value::String(String::from_utf8_lossy(&bytes).into_owned())
            }
            _ => serde_json::Value::Null,
        },
    }
}

/// Base64-encode bytes for export serialization.
#[cfg(not(coverage))]
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

/// Serialize a row value for export (uses base64 for binary, no placeholder logic).
#[cfg(not(coverage))]
fn serialize_export_value(row: &sqlx::mysql::MySqlRow, i: usize) -> serde_json::Value {
    let raw_value = match row.try_get_raw(i) {
        Ok(value) => value,
        Err(_) => return serde_json::Value::Null,
    };

    if raw_value.is_null() {
        return serde_json::Value::Null;
    }

    let type_name = raw_value.type_info().name().to_uppercase();

    // Binary types → base64
    if type_name.contains("BLOB") || type_name == "BINARY" || type_name == "VARBINARY" {
        if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(i) {
            return serde_json::Value::String(BASE64_STANDARD.encode(&bytes));
        }
        return serde_json::Value::Null;
    }

    // Integer types
    if matches!(
        type_name.as_str(),
        "TINYINT" | "SHORT" | "LONG" | "INT24" | "LONGLONG"
    ) || type_name.contains("INT")
        || type_name == "YEAR"
    {
        if let Ok(Some(v)) = row.try_get::<Option<i64>, _>(i) {
            return serde_json::Value::from(v);
        }
        if let Ok(Some(v)) = row.try_get::<Option<u64>, _>(i) {
            return serde_json::Value::from(v);
        }
    }

    // Float types
    if type_name.contains("FLOAT") || type_name.contains("DOUBLE") {
        if let Ok(Some(v)) = row.try_get::<Option<f64>, _>(i) {
            return serde_json::Number::from_f64(v)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null);
        }
    }

    // DECIMAL/NUMERIC
    if type_name.contains("DECIMAL") || type_name.contains("NUMERIC") {
        if let Ok(Some(v)) = row.try_get::<Option<String>, _>(i) {
            return serde_json::Value::String(v);
        }
    }

    // Default: string
    match row.try_get::<Option<String>, _>(i) {
        Ok(Some(s)) => serde_json::Value::String(s),
        Ok(None) => serde_json::Value::Null,
        Err(_) => match row.try_get::<Option<Vec<u8>>, _>(i) {
            Ok(Some(bytes)) => {
                serde_json::Value::String(String::from_utf8_lossy(&bytes).into_owned())
            }
            _ => serde_json::Value::Null,
        },
    }
}

/// Debug-log outgoing SQL with bound parameter values (JSON string form).
#[cfg(not(coverage))]
fn log_table_data_sql(sql: &str, params: &[serde_json::Value]) {
    let binds: Vec<String> = params.iter().map(|v| v.to_string()).collect();
    crate::mysql::query_log::log_outgoing_sql_bound(sql, &binds);
}

/// Bind a serde_json::Value to a sqlx query, returning the updated query.
#[cfg(not(coverage))]
fn bind_json_value<'q>(
    query: sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments>,
    value: &serde_json::Value,
) -> sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments> {
    match value {
        serde_json::Value::Null => query.bind(Option::<String>::None),
        serde_json::Value::String(s) => query.bind(s.clone()),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                query.bind(i)
            } else if let Some(f) = n.as_f64() {
                query.bind(f)
            } else {
                query.bind(n.to_string())
            }
        }
        serde_json::Value::Bool(b) => query.bind(*b as i64),
        _ => query.bind(value.to_string()),
    }
}

// ── fetch_table_pk_impl (internal helper, real impl only) ──────────────────────

/// Query INFORMATION_SCHEMA for primary key, unique key fallback, and column metadata.
///
/// Returns `(Option<PrimaryKeyInfo>, Vec<TableDataColumnMeta>)`.
/// `PrimaryKeyInfo` is `None` when the table has neither a PRIMARY KEY nor a usable
/// UNIQUE index (all columns non-nullable).
#[cfg(not(coverage))]
pub async fn fetch_table_pk_impl(
    pool: &sqlx::MySqlPool,
    database: &str,
    table: &str,
) -> Result<(Option<PrimaryKeyInfo>, Vec<TableDataColumnMeta>), String> {
    // ── 1. Fetch all column metadata ───────────────────────────────────────
    let col_sql = "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, \
                   COLUMN_DEFAULT, EXTRA \
                   FROM INFORMATION_SCHEMA.COLUMNS \
                   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
                   ORDER BY ORDINAL_POSITION";

    log_table_data_sql(
        col_sql,
        &[
            serde_json::Value::String(database.to_string()),
            serde_json::Value::String(table.to_string()),
        ],
    );
    let col_rows = sqlx::query(col_sql)
        .bind(database)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch column metadata: {e}"))?;
    crate::mysql::query_log::log_mysql_rows(&col_rows);

    let mut columns: Vec<TableDataColumnMeta> = Vec::with_capacity(col_rows.len());
    let mut column_nullable: HashMap<String, bool> = HashMap::new();

    for row in &col_rows {
        let name = decode_text(row, 0);
        let data_type = decode_text(row, 1).to_uppercase();
        let is_nullable = decode_text(row, 2) == "YES";
        let column_key = decode_text(row, 3);
        let column_default = decode_optional_text(row, 4);
        let extra = decode_text(row, 5).to_lowercase();

        let is_binary = is_binary_data_type(&data_type);
        let is_auto_increment = extra.contains("auto_increment");
        let has_default = column_default.is_some() || is_nullable;
        let is_primary_key = column_key.contains("PRI");
        let is_unique_key = column_key.contains("UNI");

        column_nullable.insert(name.clone(), is_nullable);

        columns.push(TableDataColumnMeta {
            name,
            data_type,
            is_nullable,
            is_primary_key,
            is_unique_key,
            has_default,
            column_default,
            is_binary,
            is_auto_increment,
        });
    }

    // ── 2. Fetch PRIMARY KEY columns ───────────────────────────────────────
    let pk_sql = "SELECT kcu.COLUMN_NAME \
                  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu \
                  JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc \
                    ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME \
                    AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA \
                    AND kcu.TABLE_NAME = tc.TABLE_NAME \
                  WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? \
                    AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY' \
                  ORDER BY kcu.ORDINAL_POSITION";

    log_table_data_sql(
        pk_sql,
        &[
            serde_json::Value::String(database.to_string()),
            serde_json::Value::String(table.to_string()),
        ],
    );
    let pk_rows = sqlx::query(pk_sql)
        .bind(database)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch primary key info: {e}"))?;
    crate::mysql::query_log::log_mysql_rows(&pk_rows);

    let pk_columns: Vec<String> = pk_rows.iter().map(|r| decode_text(r, 0)).collect();

    if !pk_columns.is_empty() {
        let has_auto_increment = columns
            .iter()
            .any(|c| pk_columns.contains(&c.name) && c.is_auto_increment);

        return Ok((
            Some(PrimaryKeyInfo {
                key_columns: pk_columns,
                has_auto_increment,
                is_unique_key_fallback: false,
            }),
            columns,
        ));
    }

    // ── 3. Fallback: UNIQUE constraint with all non-nullable columns ───────
    let uniq_sql = "SELECT tc.CONSTRAINT_NAME, kcu.COLUMN_NAME \
                    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc \
                    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu \
                      ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME \
                      AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA \
                      AND tc.TABLE_NAME = kcu.TABLE_NAME \
                    WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ? \
                      AND tc.CONSTRAINT_TYPE = 'UNIQUE' \
                    ORDER BY tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION";

    log_table_data_sql(
        uniq_sql,
        &[
            serde_json::Value::String(database.to_string()),
            serde_json::Value::String(table.to_string()),
        ],
    );
    let uniq_rows = sqlx::query(uniq_sql)
        .bind(database)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch unique key info: {e}"))?;
    crate::mysql::query_log::log_mysql_rows(&uniq_rows);

    // Group columns by constraint name, preserving order
    let mut constraint_columns: Vec<(String, Vec<String>)> = Vec::new();
    for row in &uniq_rows {
        let constraint_name = decode_text(row, 0);
        let col_name = decode_text(row, 1);

        if let Some(last) = constraint_columns.last_mut() {
            if last.0 == constraint_name {
                last.1.push(col_name);
                continue;
            }
        }
        constraint_columns.push((constraint_name, vec![col_name]));
    }

    // Find the first UNIQUE constraint where ALL columns are non-nullable
    for (_constraint_name, cols) in &constraint_columns {
        let all_not_null = cols.iter().all(|c| {
            column_nullable
                .get(c)
                .map(|nullable| !nullable)
                .unwrap_or(false)
        });

        if all_not_null {
            let has_auto_increment = columns
                .iter()
                .any(|c| cols.contains(&c.name) && c.is_auto_increment);

            return Ok((
                Some(PrimaryKeyInfo {
                    key_columns: cols.clone(),
                    has_auto_increment,
                    is_unique_key_fallback: true,
                }),
                columns,
            ));
        }
    }

    // No usable key found
    Ok((None, columns))
}

// ── fetch_table_data_impl ──────────────────────────────────────────────────────

#[cfg(not(coverage))]
pub async fn fetch_table_data_impl(
    pool: &sqlx::MySqlPool,
    database: &str,
    table: &str,
    page: u32,
    page_size: u32,
    sort: Option<SortInfo>,
    filter_model: HashMap<String, FilterModelEntry>,
    _connection_id: &str,
) -> Result<TableDataResponse, String> {
    let start = std::time::Instant::now();

    // Get column metadata and PK info
    let (pk_info, columns) = fetch_table_pk_impl(pool, database, table).await?;

    // Build filter WHERE clause
    let filter_clause = translate_filter_model(&filter_model);
    let where_sql = if filter_clause.sql.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", filter_clause.sql)
    };

    // Build ORDER BY clause
    let order_sql = match &sort {
        Some(s) => {
            let safe_col = safe_identifier(&s.column)?;
            let dir = if s.direction == "desc" { "DESC" } else { "ASC" };
            format!(" ORDER BY {safe_col} {dir}")
        }
        None => String::new(),
    };

    let safe_db = safe_identifier(database)?;
    let safe_table = safe_identifier(table)?;

    // Build and execute COUNT query
    let count_sql = format!("SELECT COUNT(*) FROM {safe_db}.{safe_table}{where_sql}");
    log_table_data_sql(&count_sql, &filter_clause.params);
    let mut count_query = sqlx::query(&count_sql);
    for param in &filter_clause.params {
        count_query = bind_json_value(count_query, param);
    }
    let count_row = count_query
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Count query failed: {e}"))?;
    crate::mysql::query_log::log_mysql_row(&count_row);
    let total_rows: i64 = count_row.try_get(0).map_err(|e| format!("Failed to read count: {e}"))?;
    let total_rows = total_rows as u64;

    // Build and execute DATA query
    let page = if page < 1 { 1 } else { page };
    let offset = (page - 1) as u64 * page_size as u64;
    let data_sql = format!(
        "SELECT * FROM {safe_db}.{safe_table}{where_sql}{order_sql} LIMIT {page_size} OFFSET {offset}"
    );
    log_table_data_sql(&data_sql, &filter_clause.params);
    let mut data_query = sqlx::query(&data_sql);
    for param in &filter_clause.params {
        data_query = bind_json_value(data_query, param);
    }
    let data_rows = data_query
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Data query failed: {e}"))?;
    crate::mysql::query_log::log_mysql_rows(&data_rows);

    let execution_time_ms = start.elapsed().as_millis() as u64;

    // Build PK column set for binary serialization
    let pk_col_set: std::collections::HashSet<&str> = pk_info
        .as_ref()
        .map(|pk| pk.key_columns.iter().map(|s| s.as_str()).collect())
        .unwrap_or_default();

    // Serialize rows
    let mut serialized_rows = Vec::with_capacity(data_rows.len());
    for row in &data_rows {
        let row_col_count = row.columns().len();
        let mut serialized_row = Vec::with_capacity(columns.len());

        for (i, col_meta) in columns.iter().enumerate() {
            if i < row_col_count {
                let is_pk = pk_col_set.contains(col_meta.name.as_str());
                serialized_row.push(serialize_table_value(row, i, col_meta.is_binary, is_pk));
            } else {
                serialized_row.push(serde_json::Value::Null);
            }
        }
        serialized_rows.push(serialized_row);
    }

    // Calculate pagination
    let total_pages = if total_rows == 0 {
        1u32
    } else {
        ((total_rows + page_size as u64 - 1) / page_size as u64) as u32
    };

    Ok(TableDataResponse {
        columns,
        rows: serialized_rows,
        total_rows,
        current_page: page,
        total_pages,
        page_size,
        primary_key: pk_info,
        execution_time_ms,
    })
}

/// Coverage stub: returns a default empty response without querying MySQL.
#[cfg(coverage)]
pub async fn fetch_table_data_impl(
    _pool: &sqlx::MySqlPool,
    _database: &str,
    _table: &str,
    page: u32,
    page_size: u32,
    _sort: Option<SortInfo>,
    _filter_model: HashMap<String, FilterModelEntry>,
    _connection_id: &str,
) -> Result<TableDataResponse, String> {
    Ok(TableDataResponse {
        columns: vec![],
        rows: vec![],
        total_rows: 0,
        current_page: page,
        total_pages: 1,
        page_size,
        primary_key: None,
        execution_time_ms: 0,
    })
}

// ── update_table_row_impl ──────────────────────────────────────────────────────

#[cfg(not(coverage))]
pub async fn update_table_row_impl(
    pool: &sqlx::MySqlPool,
    database: &str,
    table: &str,
    primary_key_columns: &[String],
    original_pk_values: &HashMap<String, serde_json::Value>,
    updated_values: &HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    if primary_key_columns.is_empty() {
        return Err("Cannot update: no primary key columns specified".to_string());
    }
    if updated_values.is_empty() {
        return Err("No values to update".to_string());
    }

    let safe_db = safe_identifier(database)?;
    let safe_table = safe_identifier(table)?;

    // Build SET clause
    let mut set_parts = Vec::new();
    let mut set_params: Vec<serde_json::Value> = Vec::new();

    // Sort keys for deterministic SQL
    let mut update_keys: Vec<&String> = updated_values.keys().collect();
    update_keys.sort();

    for col in &update_keys {
        let safe_col = safe_identifier(col)?;
        set_parts.push(format!("{safe_col} = ?"));
        set_params.push(updated_values[*col].clone());
    }

    // Build WHERE clause from original PK values
    let mut where_parts = Vec::new();
    let mut where_params: Vec<serde_json::Value> = Vec::new();
    for pk_col in primary_key_columns {
        let safe_col = safe_identifier(pk_col)?;
        where_parts.push(format!("{safe_col} = ?"));
        where_params.push(
            original_pk_values
                .get(pk_col)
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        );
    }

    let sql = format!(
        "UPDATE {safe_db}.{safe_table} SET {} WHERE {}",
        set_parts.join(", "),
        where_parts.join(" AND ")
    );

    // Bind all parameters: SET values first, then WHERE values
    let mut all_params = set_params;
    all_params.extend(where_params);

    log_table_data_sql(&sql, &all_params);
    let mut query = sqlx::query(&sql);
    for param in &all_params {
        query = bind_json_value(query, param);
    }

    let result = query
        .execute(pool)
        .await
        .map_err(|e| format!("Update failed: {e}"))?;
    crate::mysql::query_log::log_execute_result(&result);

    if result.rows_affected() != 1 {
        return Err(format!(
            "Expected 1 row affected, got {}",
            result.rows_affected()
        ));
    }

    Ok(())
}

/// Coverage stub for update.
#[cfg(coverage)]
pub async fn update_table_row_impl(
    _pool: &sqlx::MySqlPool,
    _database: &str,
    _table: &str,
    _primary_key_columns: &[String],
    _original_pk_values: &HashMap<String, serde_json::Value>,
    _updated_values: &HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    Ok(())
}

// ── insert_table_row_impl ──────────────────────────────────────────────────────

#[cfg(not(coverage))]
pub async fn insert_table_row_impl(
    pool: &sqlx::MySqlPool,
    database: &str,
    table: &str,
    values: &HashMap<String, serde_json::Value>,
    pk_info: &PrimaryKeyInfo,
) -> Result<Vec<(String, serde_json::Value)>, String> {
    let safe_db = safe_identifier(database)?;
    let safe_table = safe_identifier(table)?;

    // Sort column names for deterministic SQL
    let mut col_names: Vec<&String> = values.keys().collect();
    col_names.sort();

    if col_names.is_empty() {
        return Err("No values to insert".to_string());
    }

    let mut safe_cols = Vec::with_capacity(col_names.len());
    let mut placeholders = Vec::with_capacity(col_names.len());
    let mut params: Vec<serde_json::Value> = Vec::with_capacity(col_names.len());

    for col in &col_names {
        safe_cols.push(safe_identifier(col)?);
        placeholders.push("?".to_string());
        params.push(values[*col].clone());
    }

    let sql = format!(
        "INSERT INTO {safe_db}.{safe_table} ({}) VALUES ({})",
        safe_cols.join(", "),
        placeholders.join(", ")
    );

    log_table_data_sql(&sql, &params);
    let mut query = sqlx::query(&sql);
    for param in &params {
        query = bind_json_value(query, param);
    }

    let insert_result = query
        .execute(pool)
        .await
        .map_err(|e| format!("Insert failed: {e}"))?;
    crate::mysql::query_log::log_execute_result(&insert_result);

    // Re-fetch the inserted row
    let refetch_row = if pk_info.has_auto_increment {
        // Get LAST_INSERT_ID()
        const LAST_ID_SQL: &str = "SELECT LAST_INSERT_ID() AS id";
        crate::mysql::query_log::log_outgoing_sql(LAST_ID_SQL);
        let id_row = sqlx::query(LAST_ID_SQL)
            .fetch_one(pool)
            .await
            .map_err(|e| format!("Failed to get LAST_INSERT_ID: {e}"))?;
        crate::mysql::query_log::log_mysql_row(&id_row);

        let last_id: i64 = id_row
            .try_get(0)
            .map_err(|e| format!("Failed to read LAST_INSERT_ID: {e}"))?;

        // Build WHERE using LAST_INSERT_ID for missing PK cols, provided values for rest
        let mut where_parts = Vec::new();
        let mut where_params: Vec<serde_json::Value> = Vec::new();

        for pk_col in &pk_info.key_columns {
            let safe_col = safe_identifier(pk_col)?;
            // If the PK column was NOT provided in the values map, assume it's auto-increment
            if !values.contains_key(pk_col) || values[pk_col].is_null() {
                where_parts.push(format!("{safe_col} = ?"));
                where_params.push(serde_json::Value::from(last_id));
            } else {
                where_parts.push(format!("{safe_col} = ?"));
                where_params.push(values[pk_col].clone());
            }
        }

        let refetch_sql = format!(
            "SELECT * FROM {safe_db}.{safe_table} WHERE {}",
            where_parts.join(" AND ")
        );

        log_table_data_sql(&refetch_sql, &where_params);
        let mut refetch_query = sqlx::query(&refetch_sql);
        for param in &where_params {
            refetch_query = bind_json_value(refetch_query, param);
        }

        let opt = refetch_query.fetch_optional(pool).await.map_err(|e| {
            format!("Failed to re-fetch inserted row: {e}")
        })?;
        if let Some(ref r) = opt {
            crate::mysql::query_log::log_mysql_row(r);
        }
        opt
    } else {
        // No auto-increment: use provided PK values
        let mut where_parts = Vec::new();
        let mut where_params: Vec<serde_json::Value> = Vec::new();

        for pk_col in &pk_info.key_columns {
            let safe_col = safe_identifier(pk_col)?;
            where_parts.push(format!("{safe_col} = ?"));
            where_params.push(
                values
                    .get(pk_col)
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            );
        }

        let refetch_sql = format!(
            "SELECT * FROM {safe_db}.{safe_table} WHERE {}",
            where_parts.join(" AND ")
        );

        log_table_data_sql(&refetch_sql, &where_params);
        let mut refetch_query = sqlx::query(&refetch_sql);
        for param in &where_params {
            refetch_query = bind_json_value(refetch_query, param);
        }

        let opt = refetch_query.fetch_optional(pool).await.map_err(|e| {
            format!("Failed to re-fetch inserted row: {e}")
        })?;
        if let Some(ref r) = opt {
            crate::mysql::query_log::log_mysql_row(r);
        }
        opt
    };

    // Serialize the re-fetched row
    match refetch_row {
        Some(row) => {
            let result: Vec<(String, serde_json::Value)> = (0..row.columns().len())
                .map(|i| {
                    let col_name = row.column(i).name().to_string();
                    let value = serialize_table_value(&row, i, false, false);
                    (col_name, value)
                })
                .collect();
            Ok(result)
        }
        None => Ok(vec![]),
    }
}

/// Coverage stub for insert.
#[cfg(coverage)]
pub async fn insert_table_row_impl(
    _pool: &sqlx::MySqlPool,
    _database: &str,
    _table: &str,
    _values: &HashMap<String, serde_json::Value>,
    _pk_info: &PrimaryKeyInfo,
) -> Result<Vec<(String, serde_json::Value)>, String> {
    Ok(vec![])
}

// ── delete_table_row_impl ──────────────────────────────────────────────────────

#[cfg(not(coverage))]
pub async fn delete_table_row_impl(
    pool: &sqlx::MySqlPool,
    database: &str,
    table: &str,
    pk_columns: &[String],
    pk_values: &HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    if pk_columns.is_empty() {
        return Err("Cannot delete: no primary key columns specified".to_string());
    }

    let safe_db = safe_identifier(database)?;
    let safe_table = safe_identifier(table)?;

    let mut where_parts = Vec::new();
    let mut params: Vec<serde_json::Value> = Vec::new();

    for pk_col in pk_columns {
        let safe_col = safe_identifier(pk_col)?;
        where_parts.push(format!("{safe_col} = ?"));
        params.push(
            pk_values
                .get(pk_col)
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        );
    }

    let sql = format!(
        "DELETE FROM {safe_db}.{safe_table} WHERE {}",
        where_parts.join(" AND ")
    );

    log_table_data_sql(&sql, &params);
    let mut query = sqlx::query(&sql);
    for param in &params {
        query = bind_json_value(query, param);
    }

    let result = query
        .execute(pool)
        .await
        .map_err(|e| format!("Delete failed: {e}"))?;
    crate::mysql::query_log::log_execute_result(&result);

    if result.rows_affected() != 1 {
        return Err(format!(
            "Expected 1 row affected, got {}",
            result.rows_affected()
        ));
    }

    Ok(())
}

/// Coverage stub for delete.
#[cfg(coverage)]
pub async fn delete_table_row_impl(
    _pool: &sqlx::MySqlPool,
    _database: &str,
    _table: &str,
    _pk_columns: &[String],
    _pk_values: &HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    Ok(())
}

// ── export_table_data_impl ─────────────────────────────────────────────────────

/// RAII guard that removes a temporary file on drop unless disarmed.
/// Used by the streaming export to ensure partial files are cleaned up on error.
#[cfg(not(coverage))]
struct TempFileGuard {
    path: String,
    armed: bool,
}

#[cfg(not(coverage))]
impl TempFileGuard {
    fn new(path: String) -> Self {
        Self { path, armed: true }
    }

    /// Call after a successful write + rename to prevent cleanup.
    fn disarm(&mut self) {
        self.armed = false;
    }
}

#[cfg(not(coverage))]
impl Drop for TempFileGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[cfg(not(coverage))]
pub async fn export_table_data_impl(
    pool: &sqlx::MySqlPool,
    options: &ExportTableOptions,
) -> Result<(), String> {
    use futures::TryStreamExt;
    use std::io::Write;

    let safe_db = safe_identifier(&options.database)?;
    let safe_table = safe_identifier(&options.table)?;

    // Build WHERE and ORDER BY (same as data fetch, but no LIMIT/OFFSET)
    let filter_clause = translate_filter_model(&options.filter_model);
    let where_sql = if filter_clause.sql.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", filter_clause.sql)
    };

    let order_sql = match &options.sort {
        Some(s) => {
            let safe_col = safe_identifier(&s.column)?;
            let dir = if s.direction == "desc" { "DESC" } else { "ASC" };
            format!(" ORDER BY {safe_col} {dir}")
        }
        None => String::new(),
    };

    let sql = format!("SELECT * FROM {safe_db}.{safe_table}{where_sql}{order_sql}");
    log_table_data_sql(&sql, &filter_clause.params);
    let format = crate::export::ExportFormat::from_format_str(&options.format)?;

    let table_name = if options.table_name_for_sql.is_empty() {
        &options.table
    } else {
        &options.table_name_for_sql
    };

    // XLSX: rust_xlsxwriter builds the entire workbook in memory before saving,
    // so we must fetch all rows upfront. Other formats stream row-by-row.
    if format == crate::export::ExportFormat::Xlsx {
        let mut query = sqlx::query(&sql);
        for param in &filter_clause.params {
            query = bind_json_value(query, param);
        }

        let rows = query
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Export query failed: {e}"))?;
        crate::mysql::query_log::log_mysql_rows(&rows);

        let columns: Vec<String> = if let Some(first) = rows.first() {
            first
                .columns()
                .iter()
                .map(|c| c.name().to_string())
                .collect()
        } else {
            vec![]
        };

        let serialized_rows: Vec<Vec<serde_json::Value>> = rows
            .iter()
            .map(|row| {
                (0..row.columns().len())
                    .map(|i| serialize_export_value(row, i))
                    .collect()
            })
            .collect();

        let export_options = crate::export::ExportOptions {
            format,
            file_path: options.file_path.clone(),
            include_headers: options.include_headers,
            table_name: Some(table_name.to_string()),
        };

        return crate::export::export_with_data(&columns, &serialized_rows, export_options)
            .map(|_| ());
    }

    // ── Streaming path for CSV, JSON, SQL INSERT ────────────────────────────
    // Streams rows from MySQL and writes them to disk one at a time to avoid
    // holding the full result set in memory.
    // We write to a temp file first, then atomically rename on success.
    // If the stream fails mid-write, the guard removes the temp file on drop,
    // leaving the original target file untouched.

    let temp_path = format!("{}.tmp", &options.file_path);
    let mut guard = TempFileGuard::new(temp_path.clone());

    let mut query = sqlx::query(&sql);
    for param in &filter_clause.params {
        query = bind_json_value(query, param);
    }
    let mut stream = query.fetch(pool);

    let file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create file: {e}"))?;
    let buf_writer = std::io::BufWriter::new(file);

    match format {
        crate::export::ExportFormat::Csv => {
            let mut csv_wtr = csv::WriterBuilder::new()
                .has_headers(false)
                .from_writer(buf_writer);
            let mut headers_written = false;

            while let Some(row) = stream
                .try_next()
                .await
                .map_err(|e| format!("Export query failed: {e}"))?
            {
                crate::mysql::query_log::log_mysql_row(&row);
                if !headers_written {
                    if options.include_headers {
                        let cols: Vec<String> = row
                            .columns()
                            .iter()
                            .map(|c| c.name().to_string())
                            .collect();
                        csv_wtr
                            .write_record(&cols)
                            .map_err(|e| format!("CSV write error: {e}"))?;
                    }
                    headers_written = true;
                }

                let col_count = row.columns().len();
                let record: Vec<String> = (0..col_count)
                    .map(|i| {
                        let v = serialize_export_value(&row, i);
                        match v {
                            serde_json::Value::Null => String::new(),
                            serde_json::Value::Bool(b) => {
                                if b {
                                    "1".to_string()
                                } else {
                                    "0".to_string()
                                }
                            }
                            serde_json::Value::String(s) => s,
                            other => other.to_string(),
                        }
                    })
                    .collect();
                csv_wtr
                    .write_record(&record)
                    .map_err(|e| format!("CSV write error: {e}"))?;
            }

            csv_wtr
                .flush()
                .map_err(|e| format!("CSV flush error: {e}"))?;
        }

        crate::export::ExportFormat::Json => {
            let mut writer = buf_writer;
            write!(writer, "[").map_err(|e| format!("Write error: {e}"))?;
            let mut columns: Option<Vec<String>> = None;
            let mut is_first = true;

            while let Some(row) = stream
                .try_next()
                .await
                .map_err(|e| format!("Export query failed: {e}"))?
            {
                crate::mysql::query_log::log_mysql_row(&row);
                if columns.is_none() {
                    columns = Some(
                        row.columns()
                            .iter()
                            .map(|c| c.name().to_string())
                            .collect(),
                    );
                }
                let cols = columns.as_ref().unwrap();
                let col_count = row.columns().len();

                let mut obj = serde_json::Map::new();
                for (i, col) in cols.iter().enumerate() {
                    let value = if i < col_count {
                        serialize_export_value(&row, i)
                    } else {
                        serde_json::Value::Null
                    };
                    obj.insert(col.clone(), value);
                }

                if !is_first {
                    write!(writer, ",").map_err(|e| format!("Write error: {e}"))?;
                }
                // Pretty-print each object and indent by 2 spaces to match
                // the output format of serde_json::to_writer_pretty on an array.
                let pretty = serde_json::to_string_pretty(&serde_json::Value::Object(obj))
                    .map_err(|e| format!("JSON serialize error: {e}"))?;
                let indented: String = pretty
                    .lines()
                    .map(|line| format!("  {line}"))
                    .collect::<Vec<_>>()
                    .join("\n");
                write!(writer, "\n{indented}").map_err(|e| format!("Write error: {e}"))?;
                is_first = false;
            }

            if is_first {
                // No rows — produce `[]`
                writeln!(writer, "]").map_err(|e| format!("Write error: {e}"))?;
            } else {
                writeln!(writer, "\n]").map_err(|e| format!("Write error: {e}"))?;
            }
            writer.flush().map_err(|e| format!("Flush error: {e}"))?;
        }

        crate::export::ExportFormat::SqlInsert => {
            let mut writer = buf_writer;
            let mut columns: Option<Vec<String>> = None;

            while let Some(row) = stream
                .try_next()
                .await
                .map_err(|e| format!("Export query failed: {e}"))?
            {
                crate::mysql::query_log::log_mysql_row(&row);
                if columns.is_none() {
                    columns = Some(
                        row.columns()
                            .iter()
                            .map(|c| c.name().to_string())
                            .collect(),
                    );
                }
                let cols = columns.as_ref().unwrap();
                let col_count = row.columns().len();

                let serialized: Vec<serde_json::Value> = (0..col_count)
                    .map(|i| serialize_export_value(&row, i))
                    .collect();

                // Reuse the shared SQL writer for a single-row batch
                crate::export::sql_writer::write_sql(
                    &mut writer,
                    cols,
                    &[serialized],
                    false,
                    table_name,
                )
                .map_err(|e| format!("SQL write error: {e}"))?;
            }

            writer.flush().map_err(|e| format!("Flush error: {e}"))?;
        }

        _ => {
            return Err("Unexpected format for streaming export".to_string());
        }
    }

    // Streaming succeeded — atomically replace the target file
    std::fs::rename(&temp_path, &options.file_path).map_err(|e| {
        format!("Failed to finalize export file: {e}")
    })?;
    guard.disarm();

    Ok(())
}

/// Coverage stub for export.
#[cfg(coverage)]
pub async fn export_table_data_impl(
    _pool: &sqlx::MySqlPool,
    _options: &ExportTableOptions,
) -> Result<(), String> {
    Ok(())
}
