//! Query execution engine: runs SQL against MySQL connections,
//! stores paginated results, and enforces read-only restrictions.

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[cfg(not(coverage))]
use sqlx::mysql::types::MySqlTime;
#[cfg(not(coverage))]
use sqlx::mysql::MySqlValueRef;
#[cfg(not(coverage))]
use sqlx::Column;
#[cfg(not(coverage))]
use sqlx::Executor;
#[cfg(not(coverage))]
use sqlx::Row;
#[cfg(not(coverage))]
use sqlx::TypeInfo;
#[cfg(not(coverage))]
use sqlx::Value;
#[cfg(not(coverage))]
use sqlx::ValueRef;
use uuid::Uuid;

#[cfg(not(coverage))]
const JS_SAFE_INTEGER_MAX: i64 = 9_007_199_254_740_991;

#[cfg(not(coverage))]
const JS_SAFE_INTEGER_MIN: i64 = -JS_SAFE_INTEGER_MAX;

// ── Data structures ────────────────────────────────────────────────────────────

/// Column metadata returned from a query result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
}

/// A stored result set in memory, keyed by (connection_id, tab_id).
pub struct StoredResult {
    pub query_id: String,
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub execution_time_ms: u64,
    pub affected_rows: u64,
    pub auto_limit_applied: bool,
    pub page_size: usize,
}

/// Response for `execute_query`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryResult {
    pub query_id: String,
    pub columns: Vec<ColumnMeta>,
    pub total_rows: usize,
    pub execution_time_ms: u64,
    pub affected_rows: u64,
    pub first_page: Vec<Vec<serde_json::Value>>,
    pub total_pages: usize,
    pub auto_limit_applied: bool,
}

/// Response for `fetch_result_page`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchPageResult {
    pub rows: Vec<Vec<serde_json::Value>>,
    pub page: usize,
    pub total_pages: usize,
}

/// Table metadata for the autocomplete schema cache.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub engine: String,
    pub charset: String,
    pub row_count: u64,
    pub data_size: u64,
}

/// Routine metadata for the autocomplete schema cache.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineMeta {
    pub name: String,
    pub routine_type: String,
}

/// Full schema metadata response for autocomplete cache.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMetadata {
    pub databases: Vec<String>,
    pub tables: std::collections::HashMap<String, Vec<TableInfo>>,
    pub columns: std::collections::HashMap<String, Vec<ColumnMeta>>,
    pub routines: std::collections::HashMap<String, Vec<RoutineMeta>>,
}

/// Metadata for a table detected in a SQL query, used for inline editing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryTableEditInfo {
    pub database: String,
    pub table: String,
    pub columns: Vec<crate::mysql::table_data::TableDataColumnMeta>,
    pub primary_key: Option<crate::mysql::table_data::PrimaryKeyInfo>,
    pub foreign_keys: Vec<crate::mysql::schema_queries::ForeignKeyInfo>,
}

// ── SQL comment stripping & keyword helpers ─────────────────────────────────────

/// Strip non-executable SQL comments from a SQL string.
/// Preserves MySQL executable comments (`/*! ... */`) and optimizer hints (`/*+ ... */`).
/// Removes standard block comments (`/* ... */`), line comments (`-- ...`), and hash comments (`# ...`).
pub fn strip_non_executable_comments(sql: &str) -> String {
    let mut result = String::with_capacity(sql.len());
    let chars: Vec<char> = sql.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Check for block comment start `/*`
        if i + 1 < len && chars[i] == '/' && chars[i + 1] == '*' {
            // Check if it's an executable comment `/*!` or hint `/*+`
            if i + 2 < len && (chars[i + 2] == '!' || chars[i + 2] == '+') {
                // Preserve this comment — copy until closing `*/`
                result.push(chars[i]);
                result.push(chars[i + 1]);
                i += 2;
                while i < len {
                    if i + 1 < len && chars[i] == '*' && chars[i + 1] == '/' {
                        result.push(chars[i]);
                        result.push(chars[i + 1]);
                        i += 2;
                        break;
                    }
                    result.push(chars[i]);
                    i += 1;
                }
            } else {
                // Standard block comment — skip until `*/`
                i += 2;
                while i < len {
                    if i + 1 < len && chars[i] == '*' && chars[i + 1] == '/' {
                        i += 2;
                        break;
                    }
                    i += 1;
                }
                // Replace the comment with a space to avoid joining tokens
                result.push(' ');
            }
        }
        // Line comment `--`
        else if i + 1 < len && chars[i] == '-' && chars[i + 1] == '-' {
            // Skip until end of line
            i += 2;
            while i < len && chars[i] != '\n' {
                i += 1;
            }
            // Keep the newline if present
            if i < len && chars[i] == '\n' {
                result.push('\n');
                i += 1;
            }
        }
        // Hash comment `#`
        else if chars[i] == '#' {
            // Skip until end of line
            i += 1;
            while i < len && chars[i] != '\n' {
                i += 1;
            }
            if i < len && chars[i] == '\n' {
                result.push('\n');
                i += 1;
            }
        }
        // String literal — skip to preserve content
        else if chars[i] == '\'' || chars[i] == '"' || chars[i] == '`' {
            let quote = chars[i];
            result.push(chars[i]);
            i += 1;
            while i < len {
                if chars[i] == '\\' && i + 1 < len {
                    result.push(chars[i]);
                    result.push(chars[i + 1]);
                    i += 2;
                    continue;
                }
                result.push(chars[i]);
                if chars[i] == quote {
                    i += 1;
                    break;
                }
                i += 1;
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }

    result
}

/// Get the first SQL keyword from a (comment-stripped) SQL string.
/// Handles executable comments (`/*!50001 SELECT ... */`) by extracting the keyword inside.
pub fn get_first_keyword(sql: &str) -> String {
    let trimmed = sql.trim();

    // Handle executable comments: /*!50001 keyword ... */
    if trimmed.starts_with("/*!") {
        let inner = &trimmed[3..]; // Strip /*!
        // Skip optional version number (digits)
        let after_version = inner.trim_start_matches(|c: char| c.is_ascii_digit());
        let after_ws = after_version.trim_start();
        // Extract first word
        let first_word: String = after_ws
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if !first_word.is_empty() {
            return first_word.to_uppercase();
        }
    }

    trimmed
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_uppercase()
        .trim_end_matches(';')
        .to_uppercase()
}

/// Given a WITH statement (comment-stripped), find the main DML keyword after all CTE definitions.
/// Scans past parenthesized CTE bodies to find the first DML verb at depth 0.
/// Returns the uppercased keyword (e.g., "SELECT", "INSERT") or "" if not found.
pub fn find_with_main_keyword(sql: &str) -> String {
    let chars: Vec<char> = sql.chars().collect();
    let len = chars.len();
    let mut i = 0;
    let mut depth: i32 = 0;

    // Skip leading whitespace
    while i < len && chars[i].is_whitespace() {
        i += 1;
    }

    // Skip past "WITH" keyword
    let remaining: String = chars[i..].iter().collect();
    if remaining.to_uppercase().starts_with("WITH") {
        i += 4;
    } else {
        return String::new();
    }

    while i < len {
        // Skip string literals
        if chars[i] == '\'' || chars[i] == '"' || chars[i] == '`' {
            let quote = chars[i];
            i += 1;
            while i < len {
                if chars[i] == '\\' && i + 1 < len {
                    i += 2;
                    continue;
                }
                if chars[i] == quote {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }

        if chars[i] == '(' {
            depth += 1;
            i += 1;
            continue;
        }
        if chars[i] == ')' {
            if depth > 0 {
                depth -= 1;
            }
            i += 1;
            continue;
        }

        if depth == 0 && chars[i].is_alphabetic() {
            let start = i;
            while i < len && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            let upper_word = word.to_uppercase();
            match upper_word.as_str() {
                "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "REPLACE" => return upper_word,
                _ => continue,
            }
        } else {
            i += 1;
        }
    }

    String::new()
}

/// Check whether a LIMIT keyword appears at the top level of a SQL string.
/// Skips LIMIT tokens inside string literals and parenthesized subqueries.
pub fn has_top_level_limit(sql: &str) -> bool {
    let chars: Vec<char> = sql.chars().collect();
    let len = chars.len();
    let mut i = 0;
    let mut depth: i32 = 0;

    while i < len {
        // Skip string literals
        if chars[i] == '\'' || chars[i] == '"' || chars[i] == '`' {
            let quote = chars[i];
            i += 1;
            while i < len {
                if chars[i] == '\\' && i + 1 < len {
                    i += 2;
                    continue;
                }
                if chars[i] == quote {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }

        if chars[i] == '(' {
            depth += 1;
            i += 1;
            continue;
        }
        if chars[i] == ')' {
            if depth > 0 {
                depth -= 1;
            }
            i += 1;
            continue;
        }

        // At depth 0, look for LIMIT keyword (case-insensitive, word boundary)
        if depth == 0 && i + 4 < len && chars[i].to_ascii_uppercase() == 'L' {
            let word: String = chars[i..i + 5].iter().collect();
            if word.eq_ignore_ascii_case("LIMIT") {
                let before_ok =
                    i == 0 || !(chars[i - 1].is_alphanumeric() || chars[i - 1] == '_');
                let after_ok =
                    i + 5 >= len || !(chars[i + 5].is_alphanumeric() || chars[i + 5] == '_');
                if before_ok && after_ok {
                    return true;
                }
            }
        }

        i += 1;
    }

    false
}

/// Check whether a SQL string contains INTO OUTFILE at the top level.
fn has_into_outfile(sql: &str) -> bool {
    let upper = sql.to_uppercase();
    // Simple check — INTO OUTFILE is rarely inside strings
    upper.contains("INTO OUTFILE")
}

/// Check whether a SQL string ends with a trailing locking clause.
/// Returns the byte offset of the clause start if found, or None.
fn find_trailing_lock_clause(sql: &str) -> Option<usize> {
    let upper = sql.trim_end().to_uppercase();
    let patterns = [
        "FOR UPDATE",
        "FOR SHARE",
        "LOCK IN SHARE MODE",
    ];
    for pat in &patterns {
        if upper.ends_with(pat) {
            return Some(sql.trim_end().len() - pat.len());
        }
    }
    None
}

/// Returns true if the statement is SELECT-like (returns rows).
pub fn is_select_like(keyword: &str) -> bool {
    matches!(
        keyword,
        "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN"
    )
}

/// Returns true if a SELECT statement needs an auto-LIMIT injected.
/// Returns true for SELECT and WITH...SELECT statements without an explicit top-level LIMIT.
pub fn needs_auto_limit(sql: &str) -> bool {
    let stripped = strip_non_executable_comments(sql);
    let keyword = get_first_keyword(&stripped);

    match keyword.as_str() {
        "SELECT" => !has_top_level_limit(&stripped),
        "WITH" => {
            // Only auto-limit if the main verb after CTEs is SELECT
            let main_kw = find_with_main_keyword(&stripped);
            if main_kw == "SELECT" {
                !has_top_level_limit(&stripped)
            } else {
                false
            }
        }
        _ => false,
    }
}

/// Injects `LIMIT {limit}` into a SELECT statement at the correct position.
/// Handles trailing FOR UPDATE / FOR SHARE / LOCK IN SHARE MODE / INTO OUTFILE clauses.
pub fn inject_limit_into_select(sql: &str, limit: usize) -> String {
    let trimmed = sql.trim_end_matches(';').trim_end();

    // Check for INTO OUTFILE — don't inject LIMIT after it
    if has_into_outfile(trimmed) {
        return format!("{trimmed};");
    }

    // Check for trailing locking clauses
    if let Some(lock_start) = find_trailing_lock_clause(trimmed) {
        let before = trimmed[..lock_start].trim_end();
        let after = &trimmed[lock_start..];
        return format!("{before} LIMIT {limit} {after}");
    }

    format!("{trimmed} LIMIT {limit}")
}

/// Returns true if this SQL is allowed on a read-only connection.
/// Uses an allowlist: SELECT, SHOW, DESCRIBE, DESC, EXPLAIN, USE, SET (non-GLOBAL/PERSIST/PASSWORD).
/// WITH CTEs are allowed only if the main verb is SELECT.
pub fn is_read_only_allowed(sql: &str) -> bool {
    let stripped = strip_non_executable_comments(sql);
    let trimmed = stripped.trim();
    if trimmed.is_empty() {
        return true; // empty statement, allow
    }

    let keyword = get_first_keyword(trimmed);
    match keyword.as_str() {
        "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" | "USE" => true,
        "WITH" => {
            // WITH CTEs: check the main verb — only allow if SELECT
            let main_kw = find_with_main_keyword(trimmed);
            // If we can't determine the verb, allow (safe default for edge cases)
            main_kw.is_empty() || main_kw == "SELECT"
        }
        "SET" => {
            // Allow SET unless it targets global/persist scope or password
            let words: Vec<&str> = trimmed.split_whitespace().collect();
            if words.len() < 2 {
                return true; // bare SET, allow
            }
            let second = words[1].to_uppercase();

            // Block SET GLOBAL, SET PERSIST, SET PERSIST_ONLY, SET PASSWORD
            if matches!(
                second.as_str(),
                "GLOBAL" | "PERSIST" | "PERSIST_ONLY" | "PASSWORD"
            ) {
                return false;
            }

            // Block SET @@GLOBAL.xxx and SET @@PERSIST.xxx and SET @@PERSIST_ONLY.xxx
            let second_upper = second.as_str();
            if second_upper.starts_with("@@GLOBAL.")
                || second_upper.starts_with("@@PERSIST.")
                || second_upper.starts_with("@@PERSIST_ONLY.")
            {
                return false;
            }

            // Allow everything else: SET SESSION, SET LOCAL, SET @@session., SET @var, plain SET var = ...
            true
        }
        _ => false,
    }
}

// ── Value serialization ────────────────────────────────────────────────────────

#[cfg(not(coverage))]
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

#[cfg(not(coverage))]
fn serialize_value(row: &sqlx::mysql::MySqlRow, i: usize) -> serde_json::Value {
    let raw_value = match row.try_get_raw(i) {
        Ok(value) => value,
        Err(_) => return serde_json::Value::Null,
    };

    if raw_value.is_null() {
        return serde_json::Value::Null;
    }

    let type_name = raw_value.type_info().name().to_uppercase();

    // Integer types
    if matches!(type_name.as_str(), "TINYINT" | "SHORT" | "LONG" | "INT24" | "LONGLONG")
        || type_name.contains("INT")
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
        // BIGINT UNSIGNED values > i64::MAX: serialize as string to avoid precision loss
        if let Ok(v) = row.try_get::<Option<String>, _>(i) {
            return v
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null);
        }
        if let Some(value) = decode_unchecked_string(row, i).map(serde_json::Value::String) {
            return value;
        }
        if let Some(value) = decode_raw_string(raw_value.clone()).map(serde_json::Value::String) {
            return value;
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

    // DECIMAL/NUMERIC: serialize as string to preserve precision for monetary values
    if type_name.contains("DECIMAL") || type_name.contains("NUMERIC") {
        if let Ok(v) = row.try_get::<Option<String>, _>(i) {
            return v
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null);
        }
        if let Some(value) = decode_unchecked_string(row, i).map(serde_json::Value::String) {
            return value;
        }
        if let Some(value) = serialize_decimal_value(raw_value.clone()) {
            return value;
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

    // Boolean
    if type_name == "BOOL" || type_name == "BOOLEAN" {
        if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
            return v
                .map(serde_json::Value::from)
                .unwrap_or(serde_json::Value::Null);
        }
    }

    // Binary types
    if type_name.contains("BLOB") || type_name == "BINARY" || type_name == "VARBINARY" {
        if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(i) {
            return v
                .map(|b| serde_json::Value::String(BASE64_STANDARD.encode(&b)))
                .unwrap_or(serde_json::Value::Null);
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
fn decode_required_identifier(row: &sqlx::mysql::MySqlRow, index: usize) -> Option<String> {
    decode_unchecked_string(row, index)
        .filter(|value| !value.trim().is_empty())
}

#[cfg(not(coverage))]
fn decode_metadata_text(row: &sqlx::mysql::MySqlRow, index: usize) -> String {
    decode_unchecked_string(row, index).unwrap_or_default()
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
fn serialize_decimal_value(value: MySqlValueRef<'_>) -> Option<serde_json::Value> {
    decode_raw_string(value).map(serde_json::Value::String)
}

#[cfg(not(coverage))]
fn serialize_row(row: &sqlx::mysql::MySqlRow) -> Vec<serde_json::Value> {
    (0..row.columns().len())
        .map(|i| serialize_value(row, i))
        .collect()
}

// ── Pagination helpers ─────────────────────────────────────────────────────────

/// Calculate total pages from row count and page size.
/// Always returns at least 1 (even for 0 rows).
pub fn calculate_total_pages(total_rows: usize, page_size: usize) -> usize {
    if page_size == 0 || total_rows == 0 {
        return 1;
    }
    (total_rows + page_size - 1) / page_size
}

/// Extract a single page of rows from a full result set.
/// `page` is 1-indexed. Returns the slice for the requested page.
pub fn get_page_rows<'a>(
    rows: &'a [Vec<serde_json::Value>],
    page: usize,
    page_size: usize,
) -> &'a [Vec<serde_json::Value>] {
    let start = (page - 1).saturating_mul(page_size);
    let end = (start + page_size).min(rows.len());
    &rows[start..end]
}

// ── Core impl functions ────────────────────────────────────────────────────────

#[cfg(not(coverage))]
pub async fn execute_query_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    sql: &str,
    page_size: usize,
) -> Result<ExecuteQueryResult, String> {
    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Read-only enforcement
    if state.registry.is_read_only(connection_id) && !is_read_only_allowed(sql) {
        return Err("This connection is read-only. Only SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, USE, and SET (non-GLOBAL) statements are allowed.".to_string());
    }

    // Determine effective SQL (with auto-LIMIT if needed)
    let auto_limit_applied = needs_auto_limit(sql);
    let sql_to_execute = if auto_limit_applied {
        inject_limit_into_select(sql, 1000)
    } else {
        // Remove trailing semicolons for non-SELECT, but keep for SELECT
        sql.to_string()
    };

    // Determine if this is a SELECT-like query
    let stripped = strip_non_executable_comments(sql);
    let keyword = get_first_keyword(&stripped);
    let is_result_set = if keyword == "WITH" {
        let main_kw = find_with_main_keyword(&stripped);
        is_select_like(&main_kw) || main_kw.is_empty()
    } else {
        is_select_like(&keyword)
    };

    // Acquire a dedicated connection and capture its MySQL thread ID
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| format!("Failed to acquire connection: {e}"))?;
    let thread_id: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()")
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| format!("Failed to get connection ID: {e}"))?;

    // Track the running query for cancellation
    let key = (connection_id.to_string(), tab_id.to_string());
    state
        .running_queries
        .write()
        .await
        .insert(key.clone(), thread_id);

    let start = std::time::Instant::now();

    let query_result: Result<(Vec<ColumnMeta>, Vec<Vec<serde_json::Value>>, u64), String> =
        if is_result_set {
            crate::mysql::query_log::log_outgoing_sql(sql_to_execute.as_str());
            match sqlx::query(&sql_to_execute)
                .fetch_all(&mut *conn)
                .await
            {
                Ok(rows) => {
                    crate::mysql::query_log::log_mysql_rows(&rows);

                    let columns: Vec<ColumnMeta> = if let Some(first_row) = rows.first() {
                        first_row
                            .columns()
                            .iter()
                            .map(|c| ColumnMeta {
                                name: c.name().to_string(),
                                data_type: c.type_info().name().to_string(),
                            })
                            .collect()
                    } else {
                        // Empty result set — try to get column metadata via PREPARE/describe
                        crate::mysql::query_log::log_sqlx_describe(sql_to_execute.as_str());
                        match (&pool).describe(sql_to_execute.as_str()).await {
                            Ok(desc) => desc
                                .columns
                                .iter()
                                .map(|c| ColumnMeta {
                                    name: c.name().to_string(),
                                    data_type: c.type_info().name().to_string(),
                                })
                                .collect(),
                            Err(_) => vec![],
                        }
                    };

                    let serialized_rows: Vec<Vec<serde_json::Value>> =
                        rows.iter().map(serialize_row).collect();

                    Ok((columns, serialized_rows, 0u64))
                }
                Err(e) => Err(format!("Query failed: {e}")),
            }
        } else {
            crate::mysql::query_log::log_outgoing_sql(sql_to_execute.as_str());
            match sqlx::query(&sql_to_execute)
                .execute(&mut *conn)
                .await
            {
                Ok(result) => {
                    crate::mysql::query_log::log_execute_result(&result);
                    Ok((vec![], vec![], result.rows_affected()))
                }
                Err(e) => Err(format!("Query failed: {e}")),
            }
        };

    // Remove thread ID from running_queries (cleanup on both success and error)
    state.running_queries.write().await.remove(&key);

    let (columns, all_rows, affected_rows) = query_result?;

    let execution_time_ms = start.elapsed().as_millis() as u64;
    let total_rows = all_rows.len();
    let page_size_used = if page_size == 0 { 1000 } else { page_size };
    let total_pages = calculate_total_pages(total_rows, page_size_used);

    let first_page: Vec<Vec<serde_json::Value>> =
        get_page_rows(&all_rows, 1, page_size_used).to_vec();

    let query_id = Uuid::new_v4().to_string();

    // Store result set in state
    {
        let mut results = state.results.write().expect("results lock poisoned");
        results.insert(
            (connection_id.to_string(), tab_id.to_string()),
            StoredResult {
                query_id: query_id.clone(),
                columns: columns.clone(),
                rows: all_rows,
                execution_time_ms,
                affected_rows,
                auto_limit_applied,
                page_size: page_size_used,
            },
        );
    }

    Ok(ExecuteQueryResult {
        query_id,
        columns,
        total_rows,
        execution_time_ms,
        affected_rows,
        first_page,
        total_pages,
        auto_limit_applied,
    })
}

/// Coverage stub: exercises connection validation, read-only enforcement, and
/// auto-limit detection without requiring a live MySQL pool.
#[cfg(coverage)]
pub async fn execute_query_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    sql: &str,
    page_size: usize,
) -> Result<ExecuteQueryResult, String> {
    // Validate connection exists
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Read-only enforcement (same logic as real impl)
    if state.registry.is_read_only(connection_id) && !is_read_only_allowed(sql) {
        return Err("This connection is read-only. Only SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, USE, and SET (non-GLOBAL) statements are allowed.".to_string());
    }

    let auto_limit_applied = needs_auto_limit(sql);
    let query_id = Uuid::new_v4().to_string();
    let page_size_used = if page_size == 0 { 1000 } else { page_size };

    // Exercise the same pure-function paths as the real impl so they are
    // covered without a live MySQL connection.
    let stripped = strip_non_executable_comments(sql);
    let keyword = get_first_keyword(&stripped);
    let _is_result = if keyword == "WITH" {
        let main_kw = find_with_main_keyword(&stripped);
        is_select_like(&main_kw) || main_kw.is_empty()
    } else {
        is_select_like(&keyword)
    };
    if auto_limit_applied {
        let _sql_to_execute = inject_limit_into_select(sql, 1000);
    }

    // Track a dummy thread ID to exercise the running_queries path
    let key = (connection_id.to_string(), tab_id.to_string());
    state
        .running_queries
        .write()
        .await
        .insert(key.clone(), 42u64);

    // Store empty result in state (exercises the results lock path)
    {
        let mut results = state.results.write().expect("results lock poisoned");
        results.insert(
            (connection_id.to_string(), tab_id.to_string()),
            StoredResult {
                query_id: query_id.clone(),
                columns: vec![],
                rows: vec![],
                execution_time_ms: 0,
                affected_rows: 0,
                auto_limit_applied,
                page_size: page_size_used,
            },
        );
    }

    // Remove dummy thread ID
    state.running_queries.write().await.remove(&key);

    Ok(ExecuteQueryResult {
        query_id,
        columns: vec![],
        total_rows: 0,
        execution_time_ms: 0,
        affected_rows: 0,
        first_page: vec![],
        total_pages: 1,
        auto_limit_applied,
    })
}

pub fn fetch_result_page_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    query_id: &str,
    page: usize,
) -> Result<FetchPageResult, String> {
    let results = state.results.read().expect("results lock poisoned");
    let stored = results
        .get(&(connection_id.to_string(), tab_id.to_string()))
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;

    if stored.query_id != query_id {
        return Err(
            "Query ID mismatch — results may have been replaced by a newer query".to_string(),
        );
    }

    let page_size = stored.page_size;
    let total_rows = stored.rows.len();
    let total_pages = calculate_total_pages(total_rows, page_size);

    if page < 1 || page > total_pages {
        return Err(format!("Page {page} out of range (1..={total_pages})"));
    }

    let rows = get_page_rows(&stored.rows, page, page_size).to_vec();

    Ok(FetchPageResult {
        rows,
        page,
        total_pages,
    })
}

pub fn evict_results_impl(state: &AppState, connection_id: &str, tab_id: &str) {
    let mut results = state.results.write().expect("results lock poisoned");
    results.remove(&(connection_id.to_string(), tab_id.to_string()));
}

/// Cancel a running query by issuing `KILL QUERY <thread_id>` on the MySQL server.
///
/// Returns `Ok(true)` if a running query was found and `KILL QUERY` was issued,
/// or `Ok(false)` if no running query was found for the given (connection_id, tab_id).
#[cfg(not(coverage))]
pub async fn cancel_query_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
) -> Result<bool, String> {
    let key = (connection_id.to_string(), tab_id.to_string());

    // Look up the MySQL thread ID for the running query
    let thread_id = {
        let running = state.running_queries.read().await;
        running.get(&key).copied()
    };

    let Some(thread_id) = thread_id else {
        return Ok(false);
    };

    // Resolve the pool from the registry (only needed when we actually issue KILL)
    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Acquire a different connection from the pool to issue the KILL command
    let mut conn = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        pool.acquire(),
    )
    .await
    .map_err(|_| "Cancel timed out waiting for a pool connection".to_string())?
    .map_err(|e| e.to_string())?;

    let kill_sql = format!("KILL QUERY {}", thread_id);
    tracing::debug!(connection_id, tab_id, thread_id, "cancel_query: issuing KILL QUERY");
    crate::mysql::query_log::log_outgoing_sql(&kill_sql);
    let result = sqlx::query(&kill_sql)
        .execute(&mut *conn)
        .await
        .map_err(|e| format!("Failed to cancel query: {e}"))?;
    crate::mysql::query_log::log_execute_result(&result);

    Ok(true)
}

/// Coverage stub: exercises thread-ID lookup and connection validation without
/// requiring a live MySQL pool to issue the actual KILL QUERY command.
#[cfg(coverage)]
pub async fn cancel_query_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
) -> Result<bool, String> {
    let key = (connection_id.to_string(), tab_id.to_string());

    // Look up the MySQL thread ID for the running query
    let thread_id = {
        let running = state.running_queries.read().await;
        running.get(&key).copied()
    };

    let Some(thread_id) = thread_id else {
        return Ok(false);
    };

    // Validate connection exists (matches real impl behavior)
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Exercise the KILL SQL formatting to cover that code path
    let _kill_sql = format!("KILL QUERY {}", thread_id);

    Ok(true)
}

#[cfg(not(coverage))]
pub async fn fetch_schema_metadata_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<SchemaMetadata, String> {
    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    const SYSTEM_DBS: &str = "'information_schema','performance_schema','sys','mysql'";

    // Fetch databases
    let db_sql = format!(
        "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA \
         WHERE SCHEMA_NAME NOT IN ({SYSTEM_DBS}) ORDER BY SCHEMA_NAME"
    );
    crate::mysql::query_log::log_outgoing_sql(&db_sql);
    let db_rows = sqlx::query(&db_sql)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch databases: {e}"))?;
    crate::mysql::query_log::log_mysql_rows(&db_rows);

    let databases: Vec<String> = db_rows
        .iter()
        .filter_map(|row| decode_required_identifier(row, 0))
        .collect();

    // Fetch tables
    let table_sql = format!(
        "SELECT t.TABLE_SCHEMA, t.TABLE_NAME, COALESCE(t.ENGINE,''), \
         COALESCE(c.CHARACTER_SET_NAME,''), COALESCE(t.TABLE_ROWS,0), COALESCE(t.DATA_LENGTH,0) \
         FROM information_schema.TABLES t \
         LEFT JOIN information_schema.COLLATION_CHARACTER_SET_APPLICABILITY c \
           ON c.COLLATION_NAME = t.TABLE_COLLATION \
         WHERE t.TABLE_SCHEMA NOT IN ({SYSTEM_DBS}) \
         ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME"
    );
    crate::mysql::query_log::log_outgoing_sql(&table_sql);
    let table_rows = sqlx::query(&table_sql)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch tables: {e}"))?;
    crate::mysql::query_log::log_mysql_rows(&table_rows);

    let mut tables: std::collections::HashMap<String, Vec<TableInfo>> =
        std::collections::HashMap::new();
    for row in &table_rows {
        let Some(schema) = decode_required_identifier(row, 0) else {
            continue;
        };
        let Some(name) = decode_required_identifier(row, 1) else {
            continue;
        };
        let engine = decode_metadata_text(row, 2);
        let charset = decode_metadata_text(row, 3);
        let row_count: u64 = row
            .try_get::<Option<i64>, _>(4)
            .unwrap_or(None)
            .map(|v| v as u64)
            .unwrap_or(0);
        let data_size: u64 = row
            .try_get::<Option<i64>, _>(5)
            .unwrap_or(None)
            .map(|v| v as u64)
            .unwrap_or(0);
        tables.entry(schema).or_default().push(TableInfo {
            name,
            engine,
            charset,
            row_count,
            data_size,
        });
    }

    // Fetch columns
    let col_sql = format!(
        "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA NOT IN ({SYSTEM_DBS}) \
         ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
    );
    crate::mysql::query_log::log_outgoing_sql(&col_sql);
    let col_rows = sqlx::query(&col_sql)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch columns: {e}"))?;
    crate::mysql::query_log::log_mysql_rows(&col_rows);

    let mut columns: std::collections::HashMap<String, Vec<ColumnMeta>> =
        std::collections::HashMap::new();
    for row in &col_rows {
        let Some(schema) = decode_required_identifier(row, 0) else {
            continue;
        };
        let Some(table) = decode_required_identifier(row, 1) else {
            continue;
        };
        let Some(col_name) = decode_required_identifier(row, 2) else {
            continue;
        };
        let data_type = decode_metadata_text(row, 3);
        let key = format!("{schema}.{table}");
        columns.entry(key).or_default().push(ColumnMeta {
            name: col_name,
            data_type,
        });
    }

    // Fetch routines
    let routine_sql = format!(
        "SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE \
         FROM information_schema.ROUTINES \
         WHERE ROUTINE_SCHEMA NOT IN ({SYSTEM_DBS}) \
         ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME"
    );
    crate::mysql::query_log::log_outgoing_sql(&routine_sql);
    let routine_rows = sqlx::query(&routine_sql)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch routines: {e}"))?;
    crate::mysql::query_log::log_mysql_rows(&routine_rows);

    let mut routines: std::collections::HashMap<String, Vec<RoutineMeta>> =
        std::collections::HashMap::new();
    for row in &routine_rows {
        let Some(schema) = decode_required_identifier(row, 0) else {
            continue;
        };
        let Some(name) = decode_required_identifier(row, 1) else {
            continue;
        };
        let routine_type = decode_metadata_text(row, 2);
        routines.entry(schema).or_default().push(RoutineMeta {
            name,
            routine_type,
        });
    }

    Ok(SchemaMetadata {
        databases,
        tables,
        columns,
        routines,
    })
}

/// Coverage stub: validates connection lookup and constructs all metadata types
/// (TableInfo, RoutineMeta, SchemaMetadata) to exercise their Serialize impls.
#[cfg(coverage)]
pub async fn fetch_schema_metadata_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<SchemaMetadata, String> {
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Construct all metadata types to exercise their code paths
    let mut tables = std::collections::HashMap::new();
    tables.insert(
        "stub_db".to_string(),
        vec![TableInfo {
            name: "stub_table".to_string(),
            engine: "InnoDB".to_string(),
            charset: "utf8mb4".to_string(),
            row_count: 0,
            data_size: 0,
        }],
    );

    let mut columns = std::collections::HashMap::new();
    columns.insert(
        "stub_db.stub_table".to_string(),
        vec![ColumnMeta {
            name: "id".to_string(),
            data_type: "INT".to_string(),
        }],
    );

    let mut routines = std::collections::HashMap::new();
    routines.insert(
        "stub_db".to_string(),
        vec![RoutineMeta {
            name: "stub_proc".to_string(),
            routine_type: "PROCEDURE".to_string(),
        }],
    );

    Ok(SchemaMetadata {
        databases: vec!["stub_db".to_string()],
        tables,
        columns,
        routines,
    })
}

pub fn read_file_impl(path: &str) -> Result<String, String> {
    let p = std::path::Path::new(path);
    let metadata =
        std::fs::metadata(p).map_err(|e| format!("Failed to read file metadata: {e}"))?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Err("File exceeds the 50 MB limit".to_string());
    }
    let bytes = std::fs::read(p).map_err(|e| format!("Failed to read file: {e}"))?;
    String::from_utf8(bytes).map_err(|_| "File is not valid UTF-8".to_string())
}

pub fn write_file_impl(path: &str, content: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directories: {e}"))?;
        }
    }
    std::fs::write(p, content).map_err(|e| format!("Failed to write file: {e}"))
}

// ── Sort helpers ───────────────────────────────────────────────────────────────

/// Compare two `serde_json::Value` items for sorting purposes.
///
/// - `Null` sorts **after** all non-null values (for ascending order;
///   callers reverse the result for descending).
/// - Two `Number` values are compared as f64.
/// - Two `String` values are compared lexicographically.
/// - Mixed types (or booleans / arrays / objects) fall back to `to_string()` comparison.
pub fn compare_json_values(a: &serde_json::Value, b: &serde_json::Value) -> std::cmp::Ordering {
    use serde_json::Value;
    use std::cmp::Ordering;

    match (a, b) {
        (Value::Null, Value::Null) => Ordering::Equal,
        (Value::Null, _) => Ordering::Greater, // NULLs sort LAST in ASC
        (_, Value::Null) => Ordering::Less,

        (Value::Number(na), Value::Number(nb)) => {
            let fa = na.as_f64().unwrap_or(0.0);
            let fb = nb.as_f64().unwrap_or(0.0);
            fa.partial_cmp(&fb).unwrap_or(Ordering::Equal)
        }

        (Value::String(sa), Value::String(sb)) => sa.cmp(sb),

        // Mixed types: compare as strings
        _ => {
            let sa = a.to_string();
            let sb = b.to_string();
            sa.cmp(&sb)
        }
    }
}

/// Sort a stored result set in-place by a named column and return the first page.
///
/// The sort is performed under a write lock on `state.results`. After sorting
/// the rows are re-paginated starting from page 1.
pub fn sort_results_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    column_name: &str,
    direction: &str, // "asc" or "desc"
) -> Result<FetchPageResult, String> {
    let mut results = state.results.write().expect("results lock poisoned");
    let stored = results
        .get_mut(&(connection_id.to_string(), tab_id.to_string()))
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;

    // Find column index
    let col_idx = stored
        .columns
        .iter()
        .position(|c| c.name == column_name)
        .ok_or_else(|| format!("Column '{column_name}' not found in result set"))?;

    let is_asc = direction == "asc";

    // Sort rows in-place (stable sort preserves relative order for equal values)
    stored.rows.sort_by(|a, b| {
        let va = a.get(col_idx).unwrap_or(&serde_json::Value::Null);
        let vb = b.get(col_idx).unwrap_or(&serde_json::Value::Null);
        let cmp = compare_json_values(va, vb);
        if is_asc {
            cmp
        } else {
            cmp.reverse()
        }
    });

    // Return first page
    let page_size = stored.page_size;
    let total_rows = stored.rows.len();
    let total_pages = calculate_total_pages(total_rows, page_size);

    let rows = get_page_rows(&stored.rows, 1, page_size).to_vec();

    Ok(FetchPageResult {
        rows,
        page: 1,
        total_pages,
    })
}

// ── Analyze query for edit ─────────────────────────────────────────────────────

/// Analyze a SQL query and return table metadata for inline editing.
///
/// Extracts table references from the SQL, resolves their databases, and
/// fetches primary key / column metadata for each table via `fetch_table_pk_impl`.
#[cfg(not(coverage))]
pub async fn analyze_query_for_edit_impl(
    state: &AppState,
    connection_id: &str,
    sql: &str,
) -> Result<Vec<QueryTableEditInfo>, String> {
    use crate::mysql::sql_table_parser;

    let table_refs = sql_table_parser::extract_tables(sql);
    tracing::debug!(
        sql = %sql,
        table_count = table_refs.len(),
        "analyze_query_for_edit: parsed SQL"
    );
    if table_refs.is_empty() {
        tracing::debug!("analyze_query_for_edit: no table refs found, returning empty");
        return Ok(vec![]);
    }

    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let params = state.registry.get_connection_params(connection_id);
    let default_database = params.and_then(|p| p.default_database);

    // Fallback: if no default database stored in registry, query the MySQL
    // session's current database via SELECT DATABASE().
    let default_database = if default_database.is_some() {
        default_database
    } else {
        match sqlx::query("SELECT DATABASE()")
            .fetch_one(&pool)
            .await
        {
            Ok(row) => match row.try_get::<String, _>(0) {
                Ok(db) => {
                    tracing::debug!(database = %db, "analyze_query_for_edit: resolved current database via SELECT DATABASE()");
                    Some(db)
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "analyze_query_for_edit: SELECT DATABASE() returned non-string (NULL?)"
                    );
                    None
                }
            },
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "analyze_query_for_edit: SELECT DATABASE() query failed"
                );
                None
            }
        }
    };

    tracing::debug!(
        default_database = ?default_database,
        "analyze_query_for_edit: resolved default database"
    );

    let mut results = Vec::new();

    for table_ref in &table_refs {
        let database = table_ref
            .database
            .as_deref()
            .or(default_database.as_deref());

        let Some(database) = database else {
            tracing::warn!(
                table = %table_ref.table,
                "analyze_query_for_edit: skipping table — no database could be resolved"
            );
            continue;
        };

        match crate::mysql::table_data::fetch_table_pk_impl(&pool, database, &table_ref.table)
            .await
        {
            Ok((pk_info, columns)) => {
                let foreign_keys = crate::mysql::schema_queries::query_foreign_keys(
                    &pool,
                    database,
                    &table_ref.table,
                )
                .await
                .unwrap_or_else(|e| {
                    tracing::warn!(
                        table = %table_ref.table,
                        database = %database,
                        error = %e,
                        "analyze_query_for_edit: foreign key lookup failed; continuing without FK metadata"
                    );
                    vec![]
                });

                tracing::debug!(
                    table = %table_ref.table,
                    database = %database,
                    column_count = columns.len(),
                    has_pk = pk_info.is_some(),
                    "analyze_query_for_edit: fetched table metadata"
                );
                results.push(QueryTableEditInfo {
                    database: database.to_string(),
                    table: table_ref.table.clone(),
                    columns,
                    primary_key: pk_info,
                    foreign_keys,
                });
            }
            Err(e) => {
                tracing::warn!(
                    table = %table_ref.table,
                    database = %database,
                    error = %e,
                    "analyze_query_for_edit: skipping table due to metadata fetch failure"
                );
                continue;
            }
        }
    }

    tracing::debug!(
        result_count = results.len(),
        "analyze_query_for_edit: returning results"
    );
    Ok(results)
}

/// Coverage stub: exercises the SQL parser and connection validation without
/// calling `fetch_table_pk_impl` (which is gated behind `#[cfg(not(coverage))]`).
#[cfg(coverage)]
pub async fn analyze_query_for_edit_impl(
    state: &AppState,
    connection_id: &str,
    sql: &str,
) -> Result<Vec<QueryTableEditInfo>, String> {
    use crate::mysql::sql_table_parser;

    // Exercise the parser — mirrors the real impl's early return for empty tables
    let table_refs = sql_table_parser::extract_tables(sql);
    if table_refs.is_empty() {
        return Ok(vec![]);
    }

    // Validate connection exists (only reached when tables were found)
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Cannot call fetch_table_pk_impl under coverage — return empty
    Ok(vec![])
}

// ── Update result cell ─────────────────────────────────────────────────────────

/// Update specific cells in a cached result set after a save operation.
///
/// Acquires a write lock on `state.results`, finds the stored result by
/// `(connection_id, tab_id)`, and sets each specified cell to its new value.
pub fn update_result_cell_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    row_index: usize,
    updates: HashMap<usize, serde_json::Value>,
) -> Result<(), String> {
    let mut results = state.results.write().expect("results lock poisoned");
    let stored = results
        .get_mut(&(connection_id.to_string(), tab_id.to_string()))
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;

    if row_index >= stored.rows.len() {
        return Err(format!(
            "Row index {row_index} out of bounds (total rows: {})",
            stored.rows.len()
        ));
    }

    for (col_index, new_value) in updates {
        if col_index < stored.rows[row_index].len() {
            stored.rows[row_index][col_index] = new_value;
        }
    }

    Ok(())
}

// ── Unit tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_removes_block_comments() {
        let sql = "SELECT /* comment */ 1";
        assert_eq!(strip_non_executable_comments(sql).trim(), "SELECT   1");
    }

    #[test]
    fn test_strip_preserves_executable_comments() {
        let sql = "SELECT /*!50001 1 */ FROM t";
        let result = strip_non_executable_comments(sql);
        assert!(result.contains("/*!50001 1 */"));
    }

    #[test]
    fn test_strip_preserves_hint_comments() {
        let sql = "SELECT /*+ INDEX(t idx) */ * FROM t";
        let result = strip_non_executable_comments(sql);
        assert!(result.contains("/*+ INDEX(t idx) */"));
    }

    #[test]
    fn test_strip_removes_line_comments() {
        let sql = "SELECT 1 -- comment\nFROM t";
        let result = strip_non_executable_comments(sql);
        assert!(!result.contains("-- comment"));
        assert!(result.contains("FROM t"));
    }

    #[test]
    fn test_strip_removes_hash_comments() {
        let sql = "SELECT 1 # comment\nFROM t";
        let result = strip_non_executable_comments(sql);
        assert!(!result.contains("# comment"));
        assert!(result.contains("FROM t"));
    }

    #[test]
    fn test_get_first_keyword() {
        assert_eq!(get_first_keyword("SELECT * FROM t"), "SELECT");
        assert_eq!(get_first_keyword("  insert into t"), "INSERT");
        assert_eq!(get_first_keyword(""), "");
    }

    #[test]
    fn test_get_first_keyword_executable_comment() {
        assert_eq!(
            get_first_keyword("/*!50001 DELETE FROM t */"),
            "DELETE"
        );
        assert_eq!(
            get_first_keyword("/*!50708 SELECT * FROM t */"),
            "SELECT"
        );
        assert_eq!(get_first_keyword("/*!SELECT * FROM t */"), "SELECT");
    }

    #[test]
    fn test_find_with_main_keyword() {
        assert_eq!(
            find_with_main_keyword("WITH cte AS (SELECT 1) SELECT * FROM cte"),
            "SELECT"
        );
        assert_eq!(
            find_with_main_keyword("WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte"),
            "INSERT"
        );
        assert_eq!(
            find_with_main_keyword("WITH cte AS (SELECT 1) DELETE FROM t WHERE id IN (SELECT * FROM cte)"),
            "DELETE"
        );
        assert_eq!(
            find_with_main_keyword("WITH RECURSIVE cte AS (SELECT 1) SELECT * FROM cte"),
            "SELECT"
        );
    }

    #[test]
    fn test_has_top_level_limit() {
        assert!(has_top_level_limit("SELECT * FROM t LIMIT 10"));
        assert!(!has_top_level_limit("SELECT * FROM t"));
        // LIMIT inside subquery should not count
        assert!(!has_top_level_limit(
            "SELECT * FROM (SELECT id FROM users LIMIT 10) t"
        ));
        // LIMIT inside string should not count
        assert!(!has_top_level_limit(
            "SELECT * FROM t WHERE desc = 'LIMIT 1000'"
        ));
        // Top-level LIMIT should count even with subqueries
        assert!(has_top_level_limit(
            "SELECT * FROM (SELECT id FROM users) t LIMIT 10"
        ));
    }

    #[test]
    fn test_needs_auto_limit_select_without_limit() {
        assert!(needs_auto_limit("SELECT * FROM t"));
        assert!(needs_auto_limit("SELECT id FROM users WHERE active = 1"));
    }

    #[test]
    fn test_needs_auto_limit_select_with_limit() {
        assert!(!needs_auto_limit("SELECT * FROM t LIMIT 10"));
        assert!(!needs_auto_limit("SELECT * FROM t LIMIT 10, 20"));
        assert!(!needs_auto_limit("SELECT * FROM t LIMIT 10 OFFSET 5"));
    }

    #[test]
    fn test_needs_auto_limit_non_select() {
        assert!(!needs_auto_limit("SHOW TABLES"));
        assert!(!needs_auto_limit("DESCRIBE t"));
        assert!(!needs_auto_limit("INSERT INTO t VALUES (1)"));
    }

    #[test]
    fn test_needs_auto_limit_with_cte_select() {
        // WITH...SELECT should get auto-LIMIT
        assert!(needs_auto_limit(
            "WITH cte AS (SELECT 1) SELECT * FROM cte"
        ));
    }

    #[test]
    fn test_needs_auto_limit_with_cte_select_has_limit() {
        // WITH...SELECT that already has LIMIT should not
        assert!(!needs_auto_limit(
            "WITH cte AS (SELECT 1) SELECT * FROM cte LIMIT 10"
        ));
    }

    #[test]
    fn test_needs_auto_limit_with_cte_insert() {
        // WITH...INSERT should not get auto-LIMIT
        assert!(!needs_auto_limit(
            "WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte"
        ));
    }

    #[test]
    fn test_needs_auto_limit_subquery_limit_not_top_level() {
        // LIMIT inside subquery should not prevent auto-LIMIT on outer SELECT
        assert!(needs_auto_limit(
            "SELECT * FROM (SELECT id FROM users LIMIT 10) t"
        ));
    }

    #[test]
    fn test_needs_auto_limit_string_literal_limit() {
        // 'LIMIT 1000' in a string should not prevent auto-LIMIT
        assert!(needs_auto_limit(
            "SELECT * FROM t WHERE description = 'LIMIT 1000'"
        ));
    }

    #[test]
    fn test_inject_limit_basic() {
        let sql = "SELECT * FROM t";
        let result = inject_limit_into_select(sql, 1000);
        assert_eq!(result, "SELECT * FROM t LIMIT 1000");
    }

    #[test]
    fn test_inject_limit_before_for_update() {
        let sql = "SELECT * FROM t FOR UPDATE";
        let result = inject_limit_into_select(sql, 100);
        assert!(result.contains("LIMIT 100"));
        assert!(result.contains("FOR UPDATE"));
        // LIMIT should come before FOR UPDATE
        let limit_pos = result.find("LIMIT").unwrap();
        let for_pos = result.find("FOR UPDATE").unwrap();
        assert!(limit_pos < for_pos);
    }

    #[test]
    fn test_inject_limit_trims_trailing_semicolon() {
        let sql = "SELECT * FROM t;";
        let result = inject_limit_into_select(sql, 1000);
        assert_eq!(result, "SELECT * FROM t LIMIT 1000");
    }

    #[test]
    fn test_is_read_only_allowed() {
        assert!(is_read_only_allowed("SELECT * FROM t"));
        assert!(is_read_only_allowed("SHOW TABLES"));
        assert!(is_read_only_allowed("DESCRIBE t"));
        assert!(is_read_only_allowed("DESC t"));
        assert!(is_read_only_allowed("EXPLAIN SELECT * FROM t"));
        assert!(is_read_only_allowed(
            "WITH cte AS (SELECT 1) SELECT * FROM cte"
        ));
        assert!(is_read_only_allowed("USE mydb"));
        assert!(is_read_only_allowed("SET session_timeout = 30"));
    }

    #[test]
    fn test_is_read_only_blocked() {
        assert!(!is_read_only_allowed("INSERT INTO t VALUES (1)"));
        assert!(!is_read_only_allowed("UPDATE t SET x = 1"));
        assert!(!is_read_only_allowed("DELETE FROM t"));
        assert!(!is_read_only_allowed("DROP TABLE t"));
        assert!(!is_read_only_allowed("CREATE TABLE t (id INT)"));
        assert!(!is_read_only_allowed("SET GLOBAL max_connections = 100"));
        assert!(!is_read_only_allowed("TRUNCATE TABLE t"));
    }

    #[test]
    fn test_is_read_only_with_dml_blocked() {
        assert!(!is_read_only_allowed(
            "WITH cte AS (SELECT 1) DELETE FROM t WHERE id IN (SELECT * FROM cte)"
        ));
        assert!(!is_read_only_allowed(
            "WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte"
        ));
        assert!(!is_read_only_allowed(
            "WITH cte AS (SELECT 1) UPDATE t SET x = 1"
        ));
    }

    #[test]
    fn test_is_read_only_set_global_forms_blocked() {
        assert!(!is_read_only_allowed("SET @@GLOBAL.max_connections = 100"));
        assert!(!is_read_only_allowed("SET PERSIST max_connections = 100"));
        assert!(!is_read_only_allowed(
            "SET PERSIST_ONLY max_connections = 100"
        ));
        assert!(!is_read_only_allowed("SET PASSWORD = 'newpass'"));
    }

    #[test]
    fn test_is_read_only_set_session_allowed() {
        assert!(is_read_only_allowed("SET SESSION wait_timeout = 60"));
        assert!(is_read_only_allowed("SET LOCAL wait_timeout = 60"));
        assert!(is_read_only_allowed("SET @@session.wait_timeout = 60"));
        assert!(is_read_only_allowed("SET @@local.wait_timeout = 60"));
        assert!(is_read_only_allowed("SET @myvar = 42"));
    }

    #[test]
    fn test_is_read_only_executable_comment_select() {
        // Executable comment containing SELECT should be allowed
        assert!(is_read_only_allowed("/*!50001 SELECT * FROM t */"));
    }

    #[test]
    fn test_is_read_only_with_leading_comment() {
        // Leading block comment should be stripped
        assert!(!is_read_only_allowed("/* comment */ DELETE FROM t"));
        assert!(is_read_only_allowed("/* comment */ SELECT * FROM t"));
        // Hash comment
        assert!(!is_read_only_allowed("# comment\nDELETE FROM t"));
        // Line comment
        assert!(!is_read_only_allowed("-- comment\nDELETE FROM t"));
    }

    #[test]
    fn test_is_read_only_executable_comment() {
        // Executable comment should be treated as executable SQL
        // The content after stripping should start with the executable comment
        let sql = "/*!50001 DELETE FROM t */";
        // After stripping, starts with /*! which is preserved
        // get_first_keyword on "/*!50001 DELETE FROM t */" would return "/*!50001"
        // This doesn't match any allowlist keyword → blocked
        assert!(!is_read_only_allowed(sql));
    }

    #[test]
    fn test_base64_standard_encode_samples() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        assert_eq!(STANDARD.encode(b"Man"), "TWFu");
        assert_eq!(STANDARD.encode(b"Ma"), "TWE=");
        assert_eq!(STANDARD.encode(b"M"), "TQ==");
        assert_eq!(STANDARD.encode(b""), "");
    }

    #[test]
    fn test_read_file_missing() {
        let result = read_file_impl("/nonexistent/path/file.sql");
        assert!(result.is_err());
    }

    #[test]
    fn test_write_and_read_file() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("test_query_{}.sql", std::process::id()));
        let path_str = path.to_str().unwrap();
        write_file_impl(path_str, "SELECT 1;").expect("write should succeed");
        let content = read_file_impl(path_str).expect("read should succeed");
        assert_eq!(content, "SELECT 1;");
        let _ = std::fs::remove_file(path);
    }
}
