//! Table data operations: fetch paginated data, CRUD operations, and export.
//!
//! This module contains the business logic (`*_impl` functions) for browsing
//! and editing table data. Each function takes a `MySqlPool` directly (the
//! command wrappers in `commands::table_data` extract the pool from `AppState`).

use crate::mysql::metadata_cache::MetadataCache;
use crate::mysql::result_cache::CacheGet;
use crate::mysql::schema_queries::safe_identifier;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::RwLock as TokioRwLock;

#[cfg(not(coverage))]
use sqlx::mysql::types::MySqlTime;
#[cfg(not(coverage))]
use sqlx::mysql::MySqlValueRef;
#[cfg(not(coverage))]
use sqlx::Column;
#[cfg(not(coverage))]
use sqlx::Row;
#[cfg(not(coverage))]
use sqlx::TypeInfo;
#[cfg(not(coverage))]
use sqlx::Value;
#[cfg(not(coverage))]
use sqlx::ValueRef;

#[cfg(not(coverage))]
const JS_SAFE_INTEGER_MAX: i64 = 9_007_199_254_740_991;

#[cfg(not(coverage))]
const JS_SAFE_INTEGER_MIN: i64 = -JS_SAFE_INTEGER_MAX;

// ── Data structures ────────────────────────────────────────────────────────────

/// Column metadata for table data, including PK/UNIQUE and nullability info.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableDataColumnMeta {
    pub name: String,
    pub data_type: String,
    pub is_boolean_alias: bool,
    pub enum_values: Option<Vec<String>>,
    pub set_values: Option<Vec<String>>,
    pub is_nullable: bool,
    pub is_primary_key: bool,
    pub is_unique_key: bool,
    pub has_default: bool,
    pub column_default: Option<String>,
    pub is_binary: bool,
    pub is_auto_increment: bool,
}

/// Primary / unique key info for a table.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrimaryKeyInfo {
    pub key_columns: Vec<String>,
    pub has_auto_increment: bool,
    pub is_unique_key_fallback: bool,
}

/// Response from `fetch_blob_value`: the raw bytes of a single binary cell,
/// base64-encoded for transport, with a size guard.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlobValueResponse {
    /// Base64-encoded bytes, or `None` for SQL NULL or when `too_large` is set.
    pub base64: Option<String>,
    /// Stored byte count (always returned, even when `too_large`).
    pub byte_length: u64,
    /// `true` when the stored size exceeds the 10 MB cap; bytes are then omitted.
    pub too_large: bool,
}

/// Paginated response from `fetch_table_data`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableDataResponse {
    pub columns: Vec<TableDataColumnMeta>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub current_page: u32,
    pub page_size: u32,
    pub primary_key: Option<PrimaryKeyInfo>,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCacheRestoreResponse {
    pub status: String,
    pub data: Option<TableDataResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCacheSyncResponse {
    pub status: String,
}

/// Sort specification for a single column.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortInfo {
    pub column: String,
    pub direction: String,
}

/// A single filter condition from the frontend filter dialog.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterCondition {
    pub column: String,
    pub operator: String,
    pub value: String,
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
    pub database: String,
    pub table: String,
    pub format: String,
    pub file_path: String,
    pub include_headers: bool,
    pub table_name_for_sql: String,
    pub filter_model: Vec<FilterCondition>,
    pub sort: Option<SortInfo>,
    /// When set, limits the export to a single page of results (current visible rows).
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

pub fn touch_table_data_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
) -> serde_json::Value {
    match state.table_data_cache.get(connection_id, tab_id) {
        CacheGet::Found(_) | CacheGet::ReWarmed(_) => serde_json::json!({ "status": "available" }),
        CacheGet::Expired => serde_json::json!({ "status": "expired" }),
        CacheGet::NeverStored => serde_json::json!({ "status": "missing" }),
    }
}

pub fn restore_table_data_cache_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    database: &str,
    table: &str,
) -> TableDataCacheRestoreResponse {
    match state.table_data_cache.get(connection_id, tab_id) {
        CacheGet::Found(entry) | CacheGet::ReWarmed(entry) => TableDataCacheRestoreResponse {
            status: "available".to_string(),
            data: Some(entry.value.clone()),
        },
        CacheGet::Expired => {
            tracing::debug!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                database = %database,
                table = %table,
                "table-data cache restore missed: entry expired"
            );
            TableDataCacheRestoreResponse {
                status: "expired".to_string(),
                data: None,
            }
        }
        CacheGet::NeverStored => {
            tracing::debug!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                database = %database,
                table = %table,
                "table-data cache restore missed: entry missing"
            );
            TableDataCacheRestoreResponse {
                status: "missing".to_string(),
                data: None,
            }
        }
    }
}

fn sync_table_data_cache_response(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    database: &str,
    table: &str,
    response: TableDataResponse,
) -> TableDataCacheSyncResponse {
    let expected_invalidation_version = state
        .table_data_cache
        .current_invalidation_version(connection_id, tab_id);
    match state.table_data_cache.get(connection_id, tab_id) {
        CacheGet::Found(_) | CacheGet::ReWarmed(_) => {
            if state.table_data_cache.insert_if_current(
                connection_id,
                tab_id,
                expected_invalidation_version,
                response,
            ) {
                TableDataCacheSyncResponse {
                    status: "synced".to_string(),
                }
            } else {
                tracing::debug!(
                    connection_id = %connection_id,
                    tab_id = %tab_id,
                    database = %database,
                    table = %table,
                    expected_invalidation_version,
                    "table-data cache sync skipped: entry invalidated before write"
                );
                TableDataCacheSyncResponse {
                    status: "missing".to_string(),
                }
            }
        }
        CacheGet::Expired => {
            tracing::debug!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                database = %database,
                table = %table,
                "table-data cache sync skipped: entry expired"
            );
            TableDataCacheSyncResponse {
                status: "expired".to_string(),
            }
        }
        CacheGet::NeverStored => {
            tracing::debug!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                database = %database,
                table = %table,
                "table-data cache sync skipped: entry missing"
            );
            TableDataCacheSyncResponse {
                status: "missing".to_string(),
            }
        }
    }
}

pub fn sync_table_data_cache_after_insert_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    database: &str,
    table: &str,
    columns: Vec<TableDataColumnMeta>,
    rows: Vec<Vec<serde_json::Value>>,
    current_page: u32,
    page_size: u32,
    primary_key: Option<PrimaryKeyInfo>,
    execution_time_ms: u64,
) -> TableDataCacheSyncResponse {
    sync_table_data_cache_response(
        state,
        connection_id,
        tab_id,
        database,
        table,
        TableDataResponse {
            columns,
            rows,
            current_page,
            page_size,
            primary_key,
            execution_time_ms,
        },
    )
}

pub fn sync_table_data_cache_after_update_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    database: &str,
    table: &str,
    columns: Vec<TableDataColumnMeta>,
    rows: Vec<Vec<serde_json::Value>>,
    current_page: u32,
    page_size: u32,
    primary_key: Option<PrimaryKeyInfo>,
    execution_time_ms: u64,
) -> TableDataCacheSyncResponse {
    sync_table_data_cache_after_insert_impl(
        state,
        connection_id,
        tab_id,
        database,
        table,
        columns,
        rows,
        current_page,
        page_size,
        primary_key,
        execution_time_ms,
    )
}

pub fn sync_table_data_cache_after_delete_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    database: &str,
    table: &str,
    columns: Vec<TableDataColumnMeta>,
    rows: Vec<Vec<serde_json::Value>>,
    current_page: u32,
    page_size: u32,
    primary_key: Option<PrimaryKeyInfo>,
    execution_time_ms: u64,
) -> TableDataCacheSyncResponse {
    sync_table_data_cache_after_insert_impl(
        state,
        connection_id,
        tab_id,
        database,
        table,
        columns,
        rows,
        current_page,
        page_size,
        primary_key,
        execution_time_ms,
    )
}

pub fn evict_table_data_impl(state: &AppState, connection_id: &str, tab_id: &str) {
    state
        .table_data_cache
        .remove_with_spill_cleanup(connection_id, tab_id);
}

// ── Pure functions (always available) ──────────────────────────────────────────

/// Describes how a filter operator maps to SQL.
enum FilterOp {
    /// Simple comparison: `col <op> ?`
    Comparison(&'static str),
    /// `col LIKE ?` — value passed as-is (user provides wildcards)
    Like,
    /// `col NOT LIKE ?` — value passed as-is (user provides wildcards)
    NotLike,
    /// `col IS NULL` (no value binding)
    IsNull,
    /// `col IS NOT NULL` (no value binding)
    IsNotNull,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ColumnFilterKind {
    TextLike,
    NonText,
}

fn classify_column_filter_kind(data_type: &str) -> ColumnFilterKind {
    let upper = data_type.to_uppercase();

    if is_binary_data_type(&upper) {
        return ColumnFilterKind::NonText;
    }

    if upper.contains("CHAR")
        || upper.contains("TEXT")
        || upper.contains("ENUM")
        || upper.contains("SET")
    {
        return ColumnFilterKind::TextLike;
    }

    ColumnFilterKind::NonText
}

#[cfg(not(coverage))]
fn is_boolean_alias_column(data_type: &str, column_type: &str) -> bool {
    let normalized_data_type = data_type.trim().to_uppercase();
    let normalized_column_type = column_type.trim().to_uppercase();

    normalized_data_type == "BOOL"
        || normalized_data_type == "BOOLEAN"
        || (normalized_data_type == "TINYINT" && normalized_column_type.starts_with("TINYINT(1)"))
}

/// Map a filter operator string from the frontend to its SQL operation.
fn get_filter_op(operator: &str) -> Option<FilterOp> {
    match operator {
        ">" => Some(FilterOp::Comparison(">")),
        ">=" => Some(FilterOp::Comparison(">=")),
        "<" => Some(FilterOp::Comparison("<")),
        "<=" => Some(FilterOp::Comparison("<=")),
        "==" => Some(FilterOp::Comparison("=")),
        "!=" => Some(FilterOp::Comparison("!=")),
        "LIKE" => Some(FilterOp::Like),
        "NOT LIKE" => Some(FilterOp::NotLike),
        "IS NULL" => Some(FilterOp::IsNull),
        "IS NOT NULL" => Some(FilterOp::IsNotNull),
        _ => None,
    }
}

/// Convert a slice of `FilterCondition` to a SQL WHERE clause with bound params.
///
/// Conditions are processed in order (the frontend controls ordering).
/// Column names are backtick-quoted via `safe_identifier`.
/// If the slice is empty, returns an empty `FilterClause`.
pub fn translate_filter_model(conditions: &[FilterCondition]) -> FilterClause {
    if conditions.is_empty() {
        return FilterClause {
            sql: String::new(),
            params: vec![],
        };
    }

    let mut sql_parts = Vec::new();
    let mut params = Vec::new();

    for entry in conditions {
        let safe_col = match safe_identifier(&entry.column) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let op = match get_filter_op(&entry.operator) {
            Some(op) => op,
            None => continue,
        };

        match op {
            FilterOp::Comparison(sql_op) => {
                sql_parts.push(format!("{safe_col} {sql_op} ?"));
                params.push(serde_json::Value::String(entry.value.clone()));
            }
            FilterOp::Like => {
                sql_parts.push(format!("{safe_col} LIKE ?"));
                params.push(serde_json::Value::String(entry.value.clone()));
            }
            FilterOp::NotLike => {
                sql_parts.push(format!("{safe_col} NOT LIKE ?"));
                params.push(serde_json::Value::String(entry.value.clone()));
            }
            FilterOp::IsNull => {
                sql_parts.push(format!("({safe_col} IS NULL OR {safe_col} = '')"));
            }
            FilterOp::IsNotNull => {
                sql_parts.push(format!("({safe_col} IS NOT NULL AND {safe_col} != '')"));
            }
        }
    }

    if sql_parts.is_empty() {
        return FilterClause {
            sql: String::new(),
            params: vec![],
        };
    }

    FilterClause {
        sql: sql_parts.join(" AND "),
        params,
    }
}

/// Convert a slice of `FilterCondition` to a SQL WHERE clause using column metadata.
///
/// This variant uses column type information to generate type-appropriate SQL
/// for IS NULL / IS NOT NULL operators:
/// - TextLike columns: IS NULL maps to `(col IS NULL OR col = '')`, IS NOT NULL maps to
///   `(col IS NOT NULL AND col != '')`
/// - NonText columns: IS NULL maps to `col IS NULL`, IS NOT NULL maps to `col IS NOT NULL`
pub fn translate_filter_model_with_columns(
    conditions: &[FilterCondition],
    columns: &[TableDataColumnMeta],
) -> FilterClause {
    if conditions.is_empty() {
        return FilterClause {
            sql: String::new(),
            params: vec![],
        };
    }

    let column_kinds: std::collections::HashMap<&str, ColumnFilterKind> = columns
        .iter()
        .map(|column| {
            (
                column.name.as_str(),
                classify_column_filter_kind(&column.data_type),
            )
        })
        .collect();

    let mut sql_parts = Vec::new();
    let mut params = Vec::new();

    for entry in conditions {
        let safe_col = match safe_identifier(&entry.column) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let op = match get_filter_op(&entry.operator) {
            Some(op) => op,
            None => continue,
        };

        let column_kind = column_kinds
            .get(entry.column.as_str())
            .copied()
            .unwrap_or(ColumnFilterKind::TextLike);

        match op {
            FilterOp::Comparison(sql_op) => {
                sql_parts.push(format!("{safe_col} {sql_op} ?"));
                params.push(serde_json::Value::String(entry.value.clone()));
            }
            FilterOp::Like => {
                sql_parts.push(format!("{safe_col} LIKE ?"));
                params.push(serde_json::Value::String(entry.value.clone()));
            }
            FilterOp::NotLike => {
                sql_parts.push(format!("{safe_col} NOT LIKE ?"));
                params.push(serde_json::Value::String(entry.value.clone()));
            }
            FilterOp::IsNull => {
                if column_kind == ColumnFilterKind::TextLike {
                    sql_parts.push(format!("({safe_col} IS NULL OR {safe_col} = '')"));
                } else {
                    sql_parts.push(format!("{safe_col} IS NULL"));
                }
            }
            FilterOp::IsNotNull => {
                if column_kind == ColumnFilterKind::TextLike {
                    sql_parts.push(format!("({safe_col} IS NOT NULL AND {safe_col} != '')"));
                } else {
                    sql_parts.push(format!("{safe_col} IS NOT NULL"));
                }
            }
        }
    }

    if sql_parts.is_empty() {
        return FilterClause {
            sql: String::new(),
            params: vec![],
        };
    }

    FilterClause {
        sql: sql_parts.join(" AND "),
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

/// Format a byte count with a human-friendly unit (B, KB, MB, GB, TB).
///
/// Mirrors the frontend `formatBytes` helper exactly so a binary cell rendered
/// by the backend (table grid) and one rendered by the frontend (query grid,
/// from inlined base64) produce the identical `[BLOB - <size>]` placeholder.
pub fn format_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];
    let mut value = bytes as f64 / 1024.0;
    let mut unit_index = 0;
    while value >= 1024.0 && unit_index < UNITS.len() - 1 {
        value /= 1024.0;
        unit_index += 1;
    }
    let rounded = (value * 10.0).round() / 10.0;
    let text = if (rounded.fract()).abs() < f64::EPSILON {
        format!("{}", rounded as i64)
    } else {
        format!("{rounded:.1}")
    };
    format!("{text} {}", UNITS[unit_index])
}

// ── Blob envelope handling ─────────────────────────────────────────────────────

/// Maximum number of bytes returned for a single binary cell fetch / file read.
pub const BLOB_FETCH_CAP: usize = 10 * 1024 * 1024;

/// Marker key identifying a self-describing blob-envelope JSON object staged by
/// the frontend. A staged binary edit travels as
/// `{ "__sqllumen_blob__": true, "kind": "bytes" | "null" | "empty", "base64"?: string }`.
pub const BLOB_ENVELOPE_MARKER: &str = "__sqllumen_blob__";

/// Decoded form of a blob-envelope, ready to bind to a sqlx query.
#[derive(Debug, Clone, PartialEq)]
pub enum BlobBind {
    /// Bind real bytes (`Vec<u8>`).
    Bytes(Vec<u8>),
    /// Bind an empty byte string (`b''`).
    Empty,
    /// Bind a typed SQL NULL.
    Null,
}

/// Inspect a JSON value and, if it is a recognised blob-envelope, decode it into
/// a [`BlobBind`]. Returns:
/// - `None` when the value is **not** a blob-envelope (caller falls back to its
///   normal binding logic),
/// - `Some(Ok(_))` for a well-formed envelope,
/// - `Some(Err(_))` for a malformed envelope (e.g. invalid base64) — the caller
///   should propagate the error rather than silently stringify the value.
///
/// This helper is pure (no DB/Tauri dependency) so it can be unit-tested without
/// a live MySQL connection.
pub fn decode_blob_envelope(value: &serde_json::Value) -> Option<Result<BlobBind, String>> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let obj = value.as_object()?;
    // Only treat objects explicitly marked as blob-envelopes.
    if obj.get(BLOB_ENVELOPE_MARKER) != Some(&serde_json::Value::Bool(true)) {
        return None;
    }

    let kind = match obj.get("kind").and_then(|k| k.as_str()) {
        Some(k) => k,
        None => {
            return Some(Err(
                "Blob envelope is missing a string `kind` field".to_string()
            ))
        }
    };

    match kind {
        "null" => Some(Ok(BlobBind::Null)),
        "empty" => Some(Ok(BlobBind::Empty)),
        "bytes" => {
            let b64 = match obj.get("base64").and_then(|b| b.as_str()) {
                Some(b) => b,
                None => {
                    return Some(Err(
                        "Blob envelope of kind `bytes` is missing the `base64` field".to_string(),
                    ))
                }
            };
            match B64.decode(b64) {
                Ok(bytes) => Some(Ok(BlobBind::Bytes(bytes))),
                Err(e) => Some(Err(format!("Invalid base64 in blob envelope: {e}"))),
            }
        }
        other => Some(Err(format!("Unknown blob envelope kind: {other}"))),
    }
}

pub fn parse_enum_values(column_type: &str) -> Option<Vec<String>> {
    parse_quoted_type_values(column_type, "enum")
}

pub fn parse_set_values(column_type: &str) -> Option<Vec<String>> {
    parse_quoted_type_values(column_type, "set")
}

fn parse_quoted_type_values(column_type: &str, type_name: &str) -> Option<Vec<String>> {
    let trimmed = column_type.trim();
    let lower = trimmed.to_ascii_lowercase();
    let prefix = format!("{type_name}(");
    if !lower.starts_with(&prefix) || !trimmed.ends_with(')') {
        return None;
    }

    let inner = &trimmed[prefix.len()..trimmed.len() - 1];
    let mut values = Vec::new();
    let mut current = String::new();
    let mut chars = inner.chars().peekable();
    let mut in_quote = false;

    while let Some(ch) = chars.next() {
        match ch {
            '\'' => {
                if in_quote {
                    if matches!(chars.peek(), Some('\'')) {
                        current.push('\'');
                        chars.next();
                    } else {
                        in_quote = false;
                    }
                } else {
                    in_quote = true;
                }
            }
            ',' if !in_quote => {
                values.push(current.clone());
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    if in_quote {
        return None;
    }

    values.push(current);
    Some(values)
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

#[cfg(not(coverage))]
fn decode_unchecked_string(row: &sqlx::mysql::MySqlRow, i: usize) -> Option<String> {
    if let Ok(value) = row.try_get_unchecked::<Option<String>, _>(i) {
        return value;
    }

    row.try_get_unchecked::<Option<Vec<u8>>, _>(i)
        .ok()
        .flatten()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(not(coverage))]
fn decode_raw_string(value: MySqlValueRef<'_>) -> Option<String> {
    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(text) = owned.try_decode::<String>() {
        return Some(text);
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    owned
        .try_decode::<Vec<u8>>()
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(not(coverage))]
fn build_table_data_projection(
    columns: &[TableDataColumnMeta],
    pk_col_set: &std::collections::HashSet<&str>,
) -> Result<String, String> {
    let mut projection_parts = Vec::with_capacity(columns.len());

    for column in columns {
        let safe_col = safe_identifier(&column.name)?;
        let is_pk = pk_col_set.contains(column.name.as_str());
        if column.is_binary && !is_pk {
            projection_parts.push(format!("OCTET_LENGTH({safe_col}) AS {safe_col}"));
        } else {
            projection_parts.push(safe_col);
        }
    }

    Ok(projection_parts.join(", "))
}

#[cfg(not(coverage))]
fn format_mysql_time(value: MySqlTime) -> String {
    let sign = if value.sign().is_negative() { "-" } else { "" };
    let hours = value.hours();

    if value.microseconds() == 0 {
        format!(
            "{sign}{hours:02}:{:02}:{:02}",
            value.minutes(),
            value.seconds()
        )
    } else {
        format!(
            "{sign}{hours:02}:{:02}:{:02}.{:06}",
            value.minutes(),
            value.seconds(),
            value.microseconds()
        )
    }
}

#[cfg(not(coverage))]
fn serialize_temporal_value(value: MySqlValueRef<'_>) -> Option<serde_json::Value> {
    use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};

    let owned = sqlx::ValueRef::to_owned(&value);

    if let Ok(v) = owned.try_decode::<NaiveDateTime>() {
        return Some(serde_json::Value::String(v.to_string()));
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(v) = owned.try_decode::<DateTime<Utc>>() {
        return Some(serde_json::Value::String(v.naive_utc().to_string()));
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(v) = owned.try_decode::<NaiveDate>() {
        return Some(serde_json::Value::String(v.to_string()));
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(v) = owned.try_decode::<MySqlTime>() {
        return Some(serde_json::Value::String(format_mysql_time(v)));
    }

    sqlx::ValueRef::to_owned(&value)
        .try_decode::<String>()
        .ok()
        .map(serde_json::Value::String)
}

/// Serialize a single cell value from a MySQL row for the table data browser.
///
/// Binary columns are handled specially:
/// - PK columns → hex string `0xABCDEF`
/// - Non-PK columns → placeholder `[BLOB - <size>]` (e.g. `[BLOB - 1.5 KB]`)
#[cfg(not(coverage))]
fn serialize_table_value(
    row: &sqlx::mysql::MySqlRow,
    i: usize,
    is_boolean_alias: bool,
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
        if is_pk {
            if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(i) {
                return match v {
                    Some(bytes) => {
                        serde_json::Value::String(format!("0x{}", hex::encode_upper(bytes)))
                    }
                    None => serde_json::Value::Null,
                };
            }
        } else {
            if let Ok(v) = row.try_get::<Option<u64>, _>(i) {
                return match v {
                    Some(byte_len) => {
                        serde_json::Value::String(format!("[BLOB - {}]", format_bytes(byte_len)))
                    }
                    None => serde_json::Value::Null,
                };
            }
            if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
                return match v {
                    Some(byte_len) if byte_len >= 0 => serde_json::Value::String(format!(
                        "[BLOB - {}]",
                        format_bytes(byte_len as u64)
                    )),
                    Some(_) | None => serde_json::Value::Null,
                };
            }
        }
        return serde_json::Value::Null;
    }

    let type_name = raw_value.type_info().name().to_uppercase();

    if is_boolean_alias {
        if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
            return v
                .map(|b| serde_json::Value::from(if b { 1 } else { 0 }))
                .unwrap_or(serde_json::Value::Null);
        }
    }

    // BIT: sqlx u64 decoder has an explicit ColumnType::Bit path that reads raw big-endian bytes
    if type_name == "BIT" {
        return match row.try_get::<Option<u64>, _>(i) {
            Ok(Some(val)) => {
                if val > JS_SAFE_INTEGER_MAX as u64 {
                    serde_json::Value::String(val.to_string())
                } else {
                    serde_json::Value::from(val)
                }
            }
            Ok(None) => serde_json::Value::Null,
            Err(e) => {
                tracing::warn!(column_index = i, error = ?e, "Failed to decode BIT column as u64");
                serde_json::Value::Null
            }
        };
    }

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

    // Date/time values
    if matches!(
        type_name.as_str(),
        "DATE" | "DATETIME" | "TIMESTAMP" | "TIME" | "NEWDATE"
    ) {
        if let Some(value) = serialize_temporal_value(raw_value.clone()) {
            return value;
        }
    }

    // Default: string
    match row.try_get::<Option<String>, _>(i) {
        Ok(Some(s)) => serde_json::Value::String(s),
        Ok(None) => serde_json::Value::Null,
        Err(_) => decode_unchecked_string(row, i)
            .or_else(|| decode_raw_string(raw_value))
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
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

    // BIT: sqlx u64 decoder has an explicit ColumnType::Bit path that reads raw big-endian bytes
    if type_name == "BIT" {
        return match row.try_get::<Option<u64>, _>(i) {
            Ok(Some(val)) => {
                if val > JS_SAFE_INTEGER_MAX as u64 {
                    serde_json::Value::String(val.to_string())
                } else {
                    serde_json::Value::from(val)
                }
            }
            Ok(None) => serde_json::Value::Null,
            Err(e) => {
                tracing::warn!(column_index = i, error = ?e, "Failed to decode BIT column as u64");
                serde_json::Value::Null
            }
        };
    }

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

    // Date/time values
    if matches!(
        type_name.as_str(),
        "DATE" | "DATETIME" | "TIMESTAMP" | "TIME" | "NEWDATE"
    ) {
        if let Some(value) = serialize_temporal_value(raw_value.clone()) {
            return value;
        }
    }

    // Default: string
    match row.try_get::<Option<String>, _>(i) {
        Ok(Some(s)) => serde_json::Value::String(s),
        Ok(None) => serde_json::Value::Null,
        Err(_) => decode_unchecked_string(row, i)
            .or_else(|| decode_raw_string(raw_value))
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
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
            } else if let Some(u) = n.as_u64() {
                query.bind(u)
            } else if let Some(f) = n.as_f64() {
                query.bind(f)
            } else {
                query.bind(n.to_string())
            }
        }
        serde_json::Value::Bool(b) => query.bind(*b as i64),
        // Recognise a staged blob-envelope before the object catch-all and bind
        // it as real bytes / empty / SQL NULL. Malformed envelopes are rejected
        // up-front by `validate_blob_envelopes` in the write impls, so any error
        // reaching here is a defensive fallback: log and bind SQL NULL rather
        // than silently stringify the envelope into the column.
        serde_json::Value::Object(_) => match decode_blob_envelope(value) {
            Some(Ok(BlobBind::Bytes(bytes))) => query.bind(bytes),
            Some(Ok(BlobBind::Empty)) => query.bind(Vec::<u8>::new()),
            Some(Ok(BlobBind::Null)) => query.bind(Option::<Vec<u8>>::None),
            Some(Err(e)) => {
                tracing::error!(error = %e, "Malformed blob envelope reached bind stage; binding NULL");
                query.bind(Option::<Vec<u8>>::None)
            }
            None => query.bind(value.to_string()),
        },
        _ => query.bind(value.to_string()),
    }
}

/// Validate any blob-envelopes in a set of column values before binding, so a
/// malformed envelope (e.g. invalid base64) surfaces as a clean error instead of
/// being silently coerced. Non-envelope values are ignored.
#[cfg_attr(coverage, allow(dead_code))]
pub fn validate_blob_envelopes(values: &HashMap<String, serde_json::Value>) -> Result<(), String> {
    for (col, value) in values {
        if let Some(Err(e)) = decode_blob_envelope(value) {
            return Err(format!("Column `{col}`: {e}"));
        }
    }
    Ok(())
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
    let col_sql = "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, \
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
        let column_type = decode_text(row, 2);
        let enum_values = parse_enum_values(&column_type);
        let set_values = parse_set_values(&column_type);
        let is_nullable = decode_text(row, 3) == "YES";
        let column_key = decode_text(row, 4);
        let column_default = decode_optional_text(row, 5);
        let extra = decode_text(row, 6).to_lowercase();

        let is_binary = is_binary_data_type(&data_type);
        let is_boolean_alias = is_boolean_alias_column(&data_type, &column_type);
        let is_auto_increment = extra.contains("auto_increment");
        let has_default = column_default.is_some() || is_nullable;
        let is_primary_key = column_key.contains("PRI");
        let is_unique_key = column_key.contains("UNI");

        column_nullable.insert(name.clone(), is_nullable);

        columns.push(TableDataColumnMeta {
            name,
            data_type,
            is_boolean_alias,
            enum_values,
            set_values,
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

#[cfg(not(coverage))]
pub async fn fetch_table_pk_cached(
    pool: &sqlx::MySqlPool,
    connection_id: &str,
    database: &str,
    table: &str,
    metadata_cache: &MetadataCache,
) -> Result<(Option<PrimaryKeyInfo>, Vec<TableDataColumnMeta>), String> {
    if let Some((primary_key, columns)) = metadata_cache.get(connection_id, database, table) {
        return Ok((primary_key, columns));
    }

    let (primary_key, columns) = fetch_table_pk_impl(pool, database, table).await?;
    metadata_cache.insert(
        connection_id,
        database,
        table,
        primary_key.clone(),
        columns.clone(),
    );

    Ok((primary_key, columns))
}

/// Coverage stub: returns cached metadata when present and otherwise skips MySQL access.
#[cfg(coverage)]
pub async fn fetch_table_pk_cached(
    _pool: &sqlx::MySqlPool,
    connection_id: &str,
    database: &str,
    table: &str,
    metadata_cache: &MetadataCache,
) -> Result<(Option<PrimaryKeyInfo>, Vec<TableDataColumnMeta>), String> {
    Ok(metadata_cache
        .get(connection_id, database, table)
        .unwrap_or_else(|| (None, Vec::new())))
}

// ── fetch_table_data_impl ──────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[allow(clippy::too_many_arguments)]
pub async fn fetch_table_data_impl(
    pool: &sqlx::MySqlPool,
    connection_id: &str,
    tab_id: &str,
    running_queries: &TokioRwLock<HashMap<(String, String), u64>>,
    metadata_cache: &MetadataCache,
    database: &str,
    table: &str,
    page: u32,
    page_size: u32,
    sort: Option<SortInfo>,
    filter_model: Vec<FilterCondition>,
) -> Result<TableDataResponse, String> {
    let start = std::time::Instant::now();

    // Get column metadata and PK info
    let (pk_info, columns) =
        fetch_table_pk_cached(pool, connection_id, database, table, metadata_cache).await?;

    // Build PK column set for binary serialization and projection handling
    let pk_col_set: std::collections::HashSet<&str> = pk_info
        .as_ref()
        .map(|pk| pk.key_columns.iter().map(|s| s.as_str()).collect())
        .unwrap_or_default();

    // Build filter WHERE clause
    let filter_clause = translate_filter_model_with_columns(&filter_model, &columns);
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
    let projection = build_table_data_projection(&columns, &pk_col_set)?;

    // Build and execute DATA query
    let page = if page < 1 { 1 } else { page };
    let offset = (page - 1) as u64 * page_size as u64;
    let data_sql = format!(
        "SELECT {projection} FROM {safe_db}.{safe_table}{where_sql}{order_sql} LIMIT {page_size} OFFSET {offset}"
    );
    log_table_data_sql(&data_sql, &filter_clause.params);

    // Run the data query on a dedicated connection whose MySQL thread ID is
    // tracked in `running_queries`, so it can be cancelled via `KILL QUERY`
    // (the same mechanism the query editor uses). Filtering/sorting a large
    // table can be slow; this lets the user abort it.
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| format!("Failed to acquire connection: {e}"))?;
    let cancel_key = (connection_id.to_string(), tab_id.to_string());
    let thread_id: Option<u64> = sqlx::query_scalar("SELECT CONNECTION_ID()")
        .fetch_one(&mut *conn)
        .await
        .ok();
    if let Some(tid) = thread_id {
        running_queries
            .write()
            .await
            .insert(cancel_key.clone(), tid);
    }

    let mut data_query = sqlx::query(&data_sql);
    for param in &filter_clause.params {
        data_query = bind_json_value(data_query, param);
    }
    let data_result = data_query.fetch_all(&mut *conn).await;

    // Always unregister the running query (on success and error).
    if thread_id.is_some() {
        running_queries.write().await.remove(&cancel_key);
    }

    let data_rows = data_result.map_err(|e| format!("Data query failed: {e}"))?;
    crate::mysql::query_log::log_mysql_rows(&data_rows);

    let execution_time_ms = start.elapsed().as_millis() as u64;

    // Serialize rows
    let mut serialized_rows = Vec::with_capacity(data_rows.len());
    for row in &data_rows {
        let row_col_count = row.columns().len();
        let mut serialized_row = Vec::with_capacity(columns.len());

        for (i, col_meta) in columns.iter().enumerate() {
            if i < row_col_count {
                let is_pk = pk_col_set.contains(col_meta.name.as_str());
                serialized_row.push(serialize_table_value(
                    row,
                    i,
                    col_meta.is_boolean_alias,
                    col_meta.is_binary,
                    is_pk,
                ));
            } else {
                serialized_row.push(serde_json::Value::Null);
            }
        }
        serialized_rows.push(serialized_row);
    }

    Ok(TableDataResponse {
        columns,
        rows: serialized_rows,
        current_page: page,
        page_size,
        primary_key: pk_info,
        execution_time_ms,
    })
}

/// Coverage stub: returns a default empty response without querying MySQL.
#[cfg(coverage)]
#[allow(clippy::too_many_arguments)]
pub async fn fetch_table_data_impl(
    _pool: &sqlx::MySqlPool,
    _connection_id: &str,
    _tab_id: &str,
    _running_queries: &TokioRwLock<HashMap<(String, String), u64>>,
    _metadata_cache: &MetadataCache,
    _database: &str,
    _table: &str,
    page: u32,
    page_size: u32,
    _sort: Option<SortInfo>,
    _filter_model: Vec<FilterCondition>,
) -> Result<TableDataResponse, String> {
    Ok(TableDataResponse {
        columns: vec![],
        rows: vec![],
        current_page: page,
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
    validate_blob_envelopes(updated_values)?;

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
    connection_id: &str,
    metadata_cache: &MetadataCache,
    database: &str,
    table: &str,
    values: &HashMap<String, serde_json::Value>,
    pk_info: &PrimaryKeyInfo,
) -> Result<Vec<(String, serde_json::Value)>, String> {
    validate_blob_envelopes(values)?;
    let safe_db = safe_identifier(database)?;
    let safe_table = safe_identifier(table)?;
    let (_, columns) =
        fetch_table_pk_cached(pool, connection_id, database, table, metadata_cache).await?;
    let pk_col_set: std::collections::HashSet<&str> =
        pk_info.key_columns.iter().map(|s| s.as_str()).collect();
    let projection = build_table_data_projection(&columns, &pk_col_set)?;

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
        // Use the connection's insert id from the driver (`u64`). A separate
        // `SELECT LAST_INSERT_ID()` decodes as `BIGINT UNSIGNED` and breaks when read as `i64`.
        let last_id = insert_result.last_insert_id();

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
            "SELECT {projection} FROM {safe_db}.{safe_table} WHERE {}",
            where_parts.join(" AND ")
        );

        log_table_data_sql(&refetch_sql, &where_params);
        let mut refetch_query = sqlx::query(&refetch_sql);
        for param in &where_params {
            refetch_query = bind_json_value(refetch_query, param);
        }

        let opt = refetch_query
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to re-fetch inserted row: {e}"))?;
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
            "SELECT {projection} FROM {safe_db}.{safe_table} WHERE {}",
            where_parts.join(" AND ")
        );

        log_table_data_sql(&refetch_sql, &where_params);
        let mut refetch_query = sqlx::query(&refetch_sql);
        for param in &where_params {
            refetch_query = bind_json_value(refetch_query, param);
        }

        let opt = refetch_query
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to re-fetch inserted row: {e}"))?;
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
                    let col_meta = columns.get(i);
                    let is_boolean_alias = col_meta
                        .map(|column| column.is_boolean_alias)
                        .unwrap_or(false);
                    let is_binary = col_meta.map(|column| column.is_binary).unwrap_or(false);
                    let is_pk = col_meta
                        .map(|column| pk_col_set.contains(column.name.as_str()))
                        .unwrap_or(false);
                    let value = serialize_table_value(&row, i, is_boolean_alias, is_binary, is_pk);
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
    _connection_id: &str,
    _metadata_cache: &MetadataCache,
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
    connection_id: &str,
    metadata_cache: &MetadataCache,
    options: &ExportTableOptions,
) -> Result<(), String> {
    use futures::TryStreamExt;
    use std::io::Write;

    let safe_db = safe_identifier(&options.database)?;
    let safe_table = safe_identifier(&options.table)?;
    let (_, columns) = fetch_table_pk_cached(
        pool,
        connection_id,
        &options.database,
        &options.table,
        metadata_cache,
    )
    .await?;

    // Build WHERE, ORDER BY, and optional LIMIT/OFFSET (to export only the current page)
    let filter_clause = translate_filter_model_with_columns(&options.filter_model, &columns);
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

    let limit_sql = match (options.page, options.page_size) {
        (Some(page), Some(page_size)) => {
            let offset = (page.saturating_sub(1)) as u64 * page_size as u64;
            format!(" LIMIT {page_size} OFFSET {offset}")
        }
        _ => String::new(),
    };

    let sql = format!("SELECT * FROM {safe_db}.{safe_table}{where_sql}{order_sql}{limit_sql}");
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

    let file =
        std::fs::File::create(&temp_path).map_err(|e| format!("Failed to create file: {e}"))?;
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
                        let cols: Vec<String> =
                            row.columns().iter().map(|c| c.name().to_string()).collect();
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
                    columns = Some(row.columns().iter().map(|c| c.name().to_string()).collect());
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
                    columns = Some(row.columns().iter().map(|c| c.name().to_string()).collect());
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
    std::fs::rename(&temp_path, &options.file_path)
        .map_err(|e| format!("Failed to finalize export file: {e}"))?;
    guard.disarm();

    Ok(())
}

/// Coverage stub for export.
#[cfg(coverage)]
pub async fn export_table_data_impl(
    _pool: &sqlx::MySqlPool,
    _connection_id: &str,
    _metadata_cache: &MetadataCache,
    _options: &ExportTableOptions,
) -> Result<(), String> {
    Ok(())
}

// ── fetch_blob_value_impl ──────────────────────────────────────────────────────

/// Fetch the raw bytes of a single binary cell, identified by table + primary-key
/// column/value pairs + target column.
///
/// Enforces the [`BLOB_FETCH_CAP`] (10 MB): if the stored byte length exceeds the
/// cap, the bytes are **not** transported — only the size and a `too_large` flag.
/// SQL NULL is reported as `base64: None, too_large: false`.
#[cfg(not(coverage))]
pub async fn fetch_blob_value_impl(
    pool: &sqlx::MySqlPool,
    database: &str,
    table: &str,
    column: &str,
    pk_pairs: &[(String, serde_json::Value)],
) -> Result<BlobValueResponse, String> {
    if pk_pairs.is_empty() {
        return Err("Cannot fetch blob: no primary key values specified".to_string());
    }

    let safe_db = safe_identifier(database)?;
    let safe_table = safe_identifier(table)?;
    let safe_col = safe_identifier(column)?;

    let mut where_parts = Vec::with_capacity(pk_pairs.len());
    for (pk_col, _) in pk_pairs {
        let safe_pk = safe_identifier(pk_col)?;
        where_parts.push(format!("{safe_pk} = ?"));
    }
    let where_sql = where_parts.join(" AND ");

    // ── 1. Read the stored byte length so over-cap blobs are never transported.
    let len_sql = format!(
        "SELECT OCTET_LENGTH({safe_col}) AS `len` FROM {safe_db}.{safe_table} WHERE {where_sql} LIMIT 1"
    );
    let binds: Vec<String> = pk_pairs.iter().map(|(_, v)| v.to_string()).collect();
    crate::mysql::query_log::log_outgoing_sql_bound(&len_sql, &binds);

    let mut len_query = sqlx::query(&len_sql);
    for (_, value) in pk_pairs {
        len_query = bind_json_value(len_query, value);
    }
    let len_rows = len_query
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Blob length query failed: {e}"))?;
    crate::mysql::query_log::log_mysql_rows(&len_rows);

    let len_row = match len_rows.first() {
        Some(r) => r,
        None => return Err("No row matched the supplied primary key".to_string()),
    };

    let stored_len: Option<i64> = len_row
        .try_get::<Option<i64>, _>("len")
        .map_err(|e| format!("Failed to read blob length: {e}"))?;

    let byte_length = match stored_len {
        // SQL NULL value in the cell.
        None => {
            return Ok(BlobValueResponse {
                base64: None,
                byte_length: 0,
                too_large: false,
            });
        }
        Some(len) if len < 0 => 0u64,
        Some(len) => len as u64,
    };

    if byte_length as usize > BLOB_FETCH_CAP {
        return Ok(BlobValueResponse {
            base64: None,
            byte_length,
            too_large: true,
        });
    }

    // ── 2. Within cap: fetch the actual bytes.
    let data_sql =
        format!("SELECT {safe_col} AS `val` FROM {safe_db}.{safe_table} WHERE {where_sql} LIMIT 1");
    crate::mysql::query_log::log_outgoing_sql_bound(&data_sql, &binds);

    let mut data_query = sqlx::query(&data_sql);
    for (_, value) in pk_pairs {
        data_query = bind_json_value(data_query, value);
    }
    let data_rows = data_query
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Blob fetch query failed: {e}"))?;
    crate::mysql::query_log::log_mysql_rows(&data_rows);

    let data_row = match data_rows.first() {
        Some(r) => r,
        None => return Err("No row matched the supplied primary key".to_string()),
    };

    let bytes: Option<Vec<u8>> = data_row
        .try_get::<Option<Vec<u8>>, _>("val")
        .map_err(|e| format!("Failed to read blob bytes: {e}"))?;

    match bytes {
        None => Ok(BlobValueResponse {
            base64: None,
            byte_length: 0,
            too_large: false,
        }),
        Some(b) => Ok(BlobValueResponse {
            base64: Some(BASE64_STANDARD.encode(&b)),
            byte_length: b.len() as u64,
            too_large: false,
        }),
    }
}

/// Coverage stub for blob fetch.
#[cfg(coverage)]
pub async fn fetch_blob_value_impl(
    _pool: &sqlx::MySqlPool,
    _database: &str,
    _table: &str,
    _column: &str,
    _pk_pairs: &[(String, serde_json::Value)],
) -> Result<BlobValueResponse, String> {
    Ok(BlobValueResponse {
        base64: None,
        byte_length: 0,
        too_large: false,
    })
}

// ── File byte I/O (binary-safe; distinct from UTF-8 read_file/write_file) ───────

/// Read a file's raw bytes and return them base64-encoded.
///
/// Enforces the [`BLOB_FETCH_CAP`] (10 MB). Unlike `read_file_impl`, this is
/// binary-safe (no UTF-8 validation) so it can carry images and other blobs.
pub fn read_file_bytes_impl(path: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let p = std::path::Path::new(path);
    let metadata = std::fs::metadata(p).map_err(|e| {
        tracing::error!(path = %path, error = %e, "Failed to read file metadata for blob read");
        format!("Failed to read file metadata: {e}")
    })?;
    if metadata.len() as usize > BLOB_FETCH_CAP {
        return Err("File exceeds the 10 MB limit".to_string());
    }
    let bytes = std::fs::read(p).map_err(|e| {
        tracing::error!(path = %path, error = %e, "Failed to read file bytes for blob read");
        format!("Failed to read file: {e}")
    })?;
    if bytes.len() > BLOB_FETCH_CAP {
        return Err("File exceeds the 10 MB limit".to_string());
    }
    Ok(B64.encode(&bytes))
}

/// Decode base64 content and write the raw bytes to `path` (binary-safe).
pub fn write_file_bytes_impl(path: &str, base64: &str) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let bytes = B64.decode(base64).map_err(|e| {
        tracing::error!(path = %path, error = %e, "Invalid base64 supplied to blob write");
        format!("Invalid base64 content: {e}")
    })?;

    let p = std::path::Path::new(path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| {
                tracing::error!(path = %path, error = %e, "Failed to create parent dirs for blob write");
                format!("Failed to create directories: {e}")
            })?;
        }
    }
    std::fs::write(p, &bytes).map_err(|e| {
        tracing::error!(path = %path, error = %e, "Failed to write blob bytes");
        format!("Failed to write file: {e}")
    })
}
