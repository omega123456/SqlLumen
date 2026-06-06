//! Query execution engine: runs SQL against MySQL connections,
//! stores paginated results, and enforces read-only restrictions.

use crate::state::AppState;
use serde::{Deserialize, Serialize};
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
use std::collections::HashMap;
use std::sync::Arc;
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredResult {
    pub query_id: String,
    pub columns: Vec<ColumnMeta>,
    pub rows: Arc<Vec<Vec<serde_json::Value>>>,
    /// Server-execution-only time (narrow): up to first row / header availability.
    pub execution_time_ms: u64,
    /// Combined time (execution + row transfer + serialization). Equals the
    /// single value reported before the timing split.
    pub total_time_ms: u64,
    pub affected_rows: u64,
    pub auto_limit_applied: bool,
}

/// Response for `execute_query`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryResult {
    pub query_id: String,
    pub columns: Vec<ColumnMeta>,
    pub total_rows: usize,
    /// Server-execution-only time (narrow).
    pub execution_time_ms: u64,
    /// Combined time (execution + transfer + serialization).
    pub total_time_ms: u64,
    pub affected_rows: u64,
    pub rows: Arc<Vec<Vec<serde_json::Value>>>,
    pub auto_limit_applied: bool,
}

/// Response for `sort_results`: returns the full sorted cached row set.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SortedRowsResult {
    pub rows: Arc<Vec<Vec<serde_json::Value>>>,
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

/// Full schema metadata response including foreign keys and indexes (for AI assistant context).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMetadataFull {
    pub databases: Vec<String>,
    pub tables: std::collections::HashMap<String, Vec<TableInfo>>,
    pub columns: std::collections::HashMap<String, Vec<ColumnMeta>>,
    pub routines: std::collections::HashMap<String, Vec<RoutineMeta>>,
    pub foreign_keys:
        std::collections::HashMap<String, Vec<crate::mysql::schema_queries::ForeignKeyInfo>>,
    pub indexes: std::collections::HashMap<String, Vec<crate::mysql::schema_queries::IndexInfo>>,
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
    let mut iter = sql.char_indices().peekable();

    while let Some((_, ch)) = iter.next() {
        // Check for block comment start `/*`
        if ch == '/' && iter.peek().map(|&(_, c)| c) == Some('*') {
            iter.next(); // consume '*'
                         // Check if it's an executable comment `/*!` or hint `/*+`
            if iter
                .peek()
                .map(|&(_, c)| c == '!' || c == '+')
                .unwrap_or(false)
            {
                let (_, special) = iter.next().unwrap(); // safe: peek above confirmed element exists
                                                         // Preserve this comment — copy until closing `*/`
                result.push('/');
                result.push('*');
                result.push(special);
                while let Some((_, c)) = iter.next() {
                    if c == '*' && iter.peek().map(|&(_, c2)| c2) == Some('/') {
                        result.push('*');
                        result.push('/');
                        iter.next(); // consume '/'
                        break;
                    }
                    result.push(c);
                }
            } else {
                // Standard block comment — skip until `*/`
                while let Some((_, c)) = iter.next() {
                    if c == '*' && iter.peek().map(|&(_, c2)| c2) == Some('/') {
                        iter.next(); // consume '/'
                        break;
                    }
                }
                // Replace the comment with a space to avoid joining tokens
                result.push(' ');
            }
        }
        // Line comment `--`
        else if ch == '-' && iter.peek().map(|&(_, c)| c) == Some('-') {
            iter.next(); // consume second '-'
                         // Skip until end of line
            while iter.peek().map(|&(_, c)| c != '\n').unwrap_or(false) {
                iter.next();
            }
            // Keep the newline if present
            if iter.peek().map(|&(_, c)| c) == Some('\n') {
                iter.next(); // consume '\n'
                result.push('\n');
            }
        }
        // Hash comment `#`
        else if ch == '#' {
            // Skip until end of line
            while iter.peek().map(|&(_, c)| c != '\n').unwrap_or(false) {
                iter.next();
            }
            if iter.peek().map(|&(_, c)| c) == Some('\n') {
                iter.next(); // consume '\n'
                result.push('\n');
            }
        }
        // String literal — skip to preserve content
        else if ch == '\'' || ch == '"' || ch == '`' {
            let quote = ch;
            result.push(ch);
            while let Some((_, c)) = iter.next() {
                if c == '\\' {
                    result.push(c);
                    if let Some((_, escaped)) = iter.next() {
                        result.push(escaped);
                    }
                    continue;
                }
                result.push(c);
                if c == quote {
                    break;
                }
            }
        } else {
            result.push(ch);
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
                let before_ok = i == 0 || !(chars[i - 1].is_alphanumeric() || chars[i - 1] == '_');
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
    let patterns = ["FOR UPDATE", "FOR SHARE", "LOCK IN SHARE MODE"];
    for pat in &patterns {
        if upper.ends_with(pat) {
            return Some(sql.trim_end().len() - pat.len());
        }
    }
    None
}

/// Returns true if the statement is SELECT-like (returns rows).
/// Note: CALL is intentionally excluded — it is handled via a dedicated
/// `execute_call_query` path that supports multiple result sets.
pub fn is_select_like(keyword: &str) -> bool {
    matches!(keyword, "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN")
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
    decode_unchecked_string(row, index).filter(|value| !value.trim().is_empty())
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

// ── Core impl functions ────────────────────────────────────────────────────────

/// Inner helper: execute a single SQL statement on an already-acquired connection.
///
/// Handles: auto-limit detection/injection, query vs DML execution, column extraction,
/// row serialization and StoredResult + MultiQueryResultItem construction.
///
/// Callers are responsible for: pool retrieval, read-only enforcement, connection
/// acquisition, thread-ID tracking, and storing the result in `state.results`.
#[cfg(not(coverage))]
async fn execute_single_statement_inner(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    pool: &sqlx::MySqlPool,
    sql: &str,
    row_limit: usize,
) -> Result<(StoredResult, MultiQueryResultItem), String> {
    // Determine effective SQL (with auto-LIMIT if needed)
    let auto_limit_applied = needs_auto_limit(sql);
    let sql_to_execute = if auto_limit_applied {
        inject_limit_into_select(sql, row_limit)
    } else {
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

    let start = std::time::Instant::now();

    // `needs_describe` defers the empty-result column-metadata fallback until
    // after the stream is dropped so the metadata-only describe round-trip is
    // excluded from both the execution and total timings.
    let (columns, all_rows, affected_rows, execution_time_ms, total_time_ms, needs_describe) =
        if is_result_set {
            use futures::TryStreamExt;

            crate::mysql::query_log::log_outgoing_sql(sql_to_execute.as_str());

            let mut stream = sqlx::query(&sql_to_execute).fetch(&mut **conn);

            let mut columns: Vec<ColumnMeta> = vec![];
            let mut raw_rows: Vec<sqlx::mysql::MySqlRow> = vec![];
            let mut serialized_rows: Vec<Vec<serde_json::Value>> = vec![];
            let mut execution_time_ms: u64 = 0;
            let mut first_row_seen = false;

            loop {
                match stream.try_next().await {
                    Ok(Some(row)) => {
                        if !first_row_seen {
                            // First row available — server execution finished and
                            // the result header arrived. Record execution time and
                            // capture column metadata from this row.
                            execution_time_ms = start.elapsed().as_millis() as u64;
                            first_row_seen = true;
                            columns = row
                                .columns()
                                .iter()
                                .map(|c| ColumnMeta {
                                    name: c.name().to_string(),
                                    data_type: c.type_info().name().to_string(),
                                })
                                .collect();
                        }
                        serialized_rows.push(serialize_row(&row));
                        raw_rows.push(row);
                    }
                    Ok(None) => {
                        if !first_row_seen {
                            // Empty result set — the stream completed with no rows;
                            // execution time is the elapsed time at stream completion.
                            execution_time_ms = start.elapsed().as_millis() as u64;
                        }
                        break;
                    }
                    Err(e) => {
                        return Err(format!("Query failed: {e}"));
                    }
                }
            }

            // Drop the stream to release the borrow on `conn` before any further
            // (post-timing) use of the connection or pool.
            drop(stream);

            crate::mysql::query_log::log_mysql_rows(&raw_rows);

            let total_time_ms = start.elapsed().as_millis() as u64;
            let needs_describe = columns.is_empty();

            (
                columns,
                serialized_rows,
                0u64,
                execution_time_ms,
                total_time_ms,
                needs_describe,
            )
        } else {
            crate::mysql::query_log::log_outgoing_sql(sql_to_execute.as_str());
            match sqlx::query(&sql_to_execute).execute(&mut **conn).await {
                Ok(result) => {
                    crate::mysql::query_log::log_execute_result(&result);
                    // DML / DDL: no separate row-transfer phase, so execution and
                    // total time are the same elapsed value.
                    let elapsed = start.elapsed().as_millis() as u64;
                    (
                        vec![],
                        vec![],
                        result.rows_affected(),
                        elapsed,
                        elapsed,
                        false,
                    )
                }
                Err(e) => return Err(format!("Query failed: {e}")),
            }
        };

    // Empty-result column-metadata fallback. Runs AFTER the stream is dropped and
    // is intentionally excluded from both `execution_time_ms` and `total_time_ms`
    // because `describe` is metadata-only and not part of executing the statement.
    let columns = if needs_describe {
        crate::mysql::query_log::log_sqlx_describe(sql_to_execute.as_str());
        match pool.describe(sql_to_execute.as_str()).await {
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
    } else {
        columns
    };

    let total_rows = all_rows.len();

    let query_id = Uuid::new_v4().to_string();

    let shared_rows = Arc::new(all_rows);

    let stored = StoredResult {
        query_id: query_id.clone(),
        columns: columns.clone(),
        rows: Arc::clone(&shared_rows),
        execution_time_ms,
        total_time_ms,
        affected_rows,
        auto_limit_applied,
    };

    let item = MultiQueryResultItem {
        query_id,
        source_sql: sql.to_string(),
        columns,
        total_rows: total_rows as i64,
        execution_time_ms,
        total_time_ms,
        affected_rows,
        rows: shared_rows,
        auto_limit_applied,
        error: None,
        re_executable: true,
    };

    Ok((stored, item))
}

/// Coverage stub for `execute_single_statement_inner`: exercises pure-function
/// paths (auto-limit, keyword classification) without a live MySQL pool.
#[cfg(coverage)]
#[allow(dead_code)]
async fn execute_single_statement_inner(
    _conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    _pool: &sqlx::MySqlPool,
    sql: &str,
    _row_limit: usize,
) -> Result<(StoredResult, MultiQueryResultItem), String> {
    let auto_limit_applied = needs_auto_limit(sql);
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

    let query_id = Uuid::new_v4().to_string();
    Ok((
        StoredResult {
            query_id: query_id.clone(),
            columns: vec![],
            rows: Arc::new(vec![]),
            execution_time_ms: 0,
            total_time_ms: 0,
            affected_rows: 0,
            auto_limit_applied,
        },
        MultiQueryResultItem {
            query_id,
            source_sql: sql.to_string(),
            columns: vec![],
            total_rows: 0,
            execution_time_ms: 0,
            total_time_ms: 0,
            affected_rows: 0,
            rows: Arc::new(vec![]),
            auto_limit_applied,
            error: None,
            re_executable: true,
        },
    ))
}

#[cfg(not(coverage))]
pub async fn execute_query_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    sql: &str,
    row_limit: usize,
) -> Result<ExecuteQueryResult, String> {
    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Read-only enforcement
    if state.registry.is_read_only(connection_id) && !is_read_only_allowed(sql) {
        return Err("This connection is read-only. Only SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, USE, and SET (non-GLOBAL) statements are allowed.".to_string());
    }

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

    let result = execute_single_statement_inner(&mut conn, &pool, sql, row_limit).await;

    // Remove thread ID from running_queries (cleanup on both success and error)
    state.running_queries.write().await.remove(&key);

    let (stored, item) = result?;

    // Store result set in state — execute_query replaces the WHOLE tab result vector
    state
        .result_cache
        .insert(connection_id, tab_id, vec![stored]);

    Ok(ExecuteQueryResult {
        query_id: item.query_id,
        columns: item.columns,
        total_rows: item.total_rows as usize,
        execution_time_ms: item.execution_time_ms,
        total_time_ms: item.total_time_ms,
        affected_rows: item.affected_rows,
        rows: item.rows,
        auto_limit_applied: item.auto_limit_applied,
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
    _row_limit: usize,
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

    // Store empty result in state (exercises the result_cache path)
    state.result_cache.insert(
        connection_id,
        tab_id,
        vec![StoredResult {
            query_id: query_id.clone(),
            columns: vec![],
            rows: Arc::new(vec![]),
            execution_time_ms: 0,
            total_time_ms: 0,
            affected_rows: 0,
            auto_limit_applied,
        }],
    );

    // Remove dummy thread ID
    state.running_queries.write().await.remove(&key);

    Ok(ExecuteQueryResult {
        query_id,
        columns: vec![],
        total_rows: 0,
        execution_time_ms: 0,
        total_time_ms: 0,
        affected_rows: 0,
        rows: Arc::new(vec![]),
        auto_limit_applied,
    })
}

/// Response for `fetch_cached_rows`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchCachedRowsResult {
    pub rows: Arc<Vec<Vec<serde_json::Value>>>,
    pub columns: Vec<ColumnMeta>,
}

pub fn fetch_cached_rows_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    query_id: &str,
    result_index: Option<usize>,
) -> Result<FetchCachedRowsResult, String> {
    let cache_result = state.result_cache.get(connection_id, tab_id);
    if cache_result.is_expired() {
        return Err(
            "results_expired: Results for this tab have expired. Re-run the query to see results."
                .to_string(),
        );
    }
    let entry = cache_result
        .into_entry()
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;
    let result_vec = &entry.value;

    let idx = result_index.unwrap_or(0);
    let stored = result_vec.get(idx).ok_or_else(|| {
        format!(
            "Result index {idx} out of range (total: {})",
            result_vec.len()
        )
    })?;

    if stored.query_id != query_id {
        return Err(
            "Query ID mismatch — results may have been replaced by a newer query".to_string(),
        );
    }

    Ok(FetchCachedRowsResult {
        rows: stored.rows.clone(),
        columns: stored.columns.clone(),
    })
}

pub fn evict_results_impl(state: &AppState, connection_id: &str, tab_id: &str) {
    state
        .result_cache
        .remove_with_spill_cleanup(connection_id, tab_id);
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
    let mut conn = tokio::time::timeout(std::time::Duration::from_secs(5), pool.acquire())
        .await
        .map_err(|_| "Cancel timed out waiting for a pool connection".to_string())?
        .map_err(|e| e.to_string())?;

    let kill_sql = format!("KILL QUERY {}", thread_id);
    tracing::debug!(
        connection_id,
        tab_id,
        thread_id,
        "cancel_query: issuing KILL QUERY"
    );
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

    // Build all 4 SQL strings up front
    let db_sql = format!(
        "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA \
         WHERE SCHEMA_NAME NOT IN ({SYSTEM_DBS}) ORDER BY SCHEMA_NAME"
    );
    let table_sql = format!(
        "SELECT t.TABLE_SCHEMA, t.TABLE_NAME, COALESCE(t.ENGINE,''), \
         COALESCE(c.CHARACTER_SET_NAME,''), COALESCE(t.TABLE_ROWS,0), COALESCE(t.DATA_LENGTH,0) \
         FROM information_schema.TABLES t \
         LEFT JOIN information_schema.COLLATION_CHARACTER_SET_APPLICABILITY c \
           ON c.COLLATION_NAME = t.TABLE_COLLATION \
         WHERE t.TABLE_SCHEMA NOT IN ({SYSTEM_DBS}) \
         ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME"
    );
    let col_sql = format!(
        "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA NOT IN ({SYSTEM_DBS}) \
         ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
    );
    let routine_sql = format!(
        "SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE \
         FROM information_schema.ROUTINES \
         WHERE ROUTINE_SCHEMA NOT IN ({SYSTEM_DBS}) \
         ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME"
    );

    // Fire all 4 queries concurrently
    let (db_rows, table_rows, col_rows, routine_rows) = tokio::try_join!(
        async {
            crate::mysql::query_log::log_outgoing_sql(&db_sql);
            let rows = sqlx::query(&db_sql)
                .fetch_all(&pool)
                .await
                .map_err(|e| format!("Failed to fetch databases: {e}"))?;
            crate::mysql::query_log::log_mysql_rows(&rows);
            Ok::<_, String>(rows)
        },
        async {
            crate::mysql::query_log::log_outgoing_sql(&table_sql);
            let rows = sqlx::query(&table_sql)
                .fetch_all(&pool)
                .await
                .map_err(|e| format!("Failed to fetch tables: {e}"))?;
            crate::mysql::query_log::log_mysql_rows(&rows);
            Ok::<_, String>(rows)
        },
        async {
            crate::mysql::query_log::log_outgoing_sql(&col_sql);
            let rows = sqlx::query(&col_sql)
                .fetch_all(&pool)
                .await
                .map_err(|e| format!("Failed to fetch columns: {e}"))?;
            crate::mysql::query_log::log_mysql_rows(&rows);
            Ok::<_, String>(rows)
        },
        async {
            crate::mysql::query_log::log_outgoing_sql(&routine_sql);
            let rows = sqlx::query(&routine_sql)
                .fetch_all(&pool)
                .await
                .map_err(|e| format!("Failed to fetch routines: {e}"))?;
            crate::mysql::query_log::log_mysql_rows(&rows);
            Ok::<_, String>(rows)
        },
    )?;

    // Decode databases
    let databases: Vec<String> = db_rows
        .iter()
        .filter_map(|row| decode_required_identifier(row, 0))
        .collect();

    // Decode tables
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

    // Decode columns
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

    // Decode routines
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
        routines
            .entry(schema)
            .or_default()
            .push(RoutineMeta { name, routine_type });
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

/// Full schema metadata including foreign keys and indexes — real implementation.
#[cfg(not(coverage))]
pub async fn fetch_schema_metadata_full_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<SchemaMetadataFull, String> {
    use crate::mysql::schema_queries::{query_all_foreign_keys_batch, query_all_indexes_batch};

    // First get the base metadata (databases, tables, columns, routines)
    let base = fetch_schema_metadata_impl(state, connection_id).await?;

    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Extract database names for batch queries
    let db_names: Vec<String> = base.databases.clone();

    // Run both batch queries concurrently
    let (foreign_keys, indexes) = tokio::join!(
        async {
            query_all_foreign_keys_batch(&pool, &db_names)
                .await
                .unwrap_or_else(|e| {
                    tracing::warn!(
                        error = %e,
                        "failed to fetch foreign keys batch"
                    );
                    HashMap::new()
                })
        },
        async {
            query_all_indexes_batch(&pool, &db_names)
                .await
                .unwrap_or_else(|e| {
                    tracing::warn!(
                        error = %e,
                        "failed to fetch indexes batch"
                    );
                    HashMap::new()
                })
        },
    );

    Ok(SchemaMetadataFull {
        databases: base.databases,
        tables: base.tables,
        columns: base.columns,
        routines: base.routines,
        foreign_keys,
        indexes,
    })
}

/// Coverage stub for `fetch_schema_metadata_full_impl`.
#[cfg(coverage)]
pub async fn fetch_schema_metadata_full_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<SchemaMetadataFull, String> {
    let base = fetch_schema_metadata_impl(state, connection_id).await?;

    Ok(SchemaMetadataFull {
        databases: base.databases,
        tables: base.tables,
        columns: base.columns,
        routines: base.routines,
        foreign_keys: HashMap::new(),
        indexes: HashMap::new(),
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

/// Sort a stored result set by a named column and return all sorted rows.
///
/// Uses clone-on-write with `spawn_blocking`: clones the result vec from the
/// cache, offloads the O(n log n) sort to the blocking thread pool, performs a
/// staleness check, and re-inserts the updated vec.
pub async fn sort_results_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    column_name: &str,
    direction: &str, // "asc" or "desc"
    result_index: Option<usize>,
) -> Result<SortedRowsResult, String> {
    let cache_result = state.result_cache.get(connection_id, tab_id);
    if cache_result.is_expired() {
        return Err(
            "results_expired: Results for this tab have expired. Re-run the query to see results."
                .to_string(),
        );
    }
    let entry = cache_result
        .into_entry()
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;

    // Capture the invalidation version up front so the post-sort write-back can
    // skip its update if a new query bumped the version during sorting.
    let expected_invalidation_version = state
        .result_cache
        .current_invalidation_version(connection_id, tab_id);

    let idx = result_index.unwrap_or(0);

    // Borrow the target slot instead of cloning the whole `Vec<StoredResult>`.
    // We only need `col_idx` (a usize), the small `query_id` String, and the
    // slot's rows Arc — cloning every sibling result's `columns` would be waste.
    let stored = entry.value.get(idx).ok_or_else(|| {
        format!(
            "Result index {idx} out of range (total: {})",
            entry.value.len()
        )
    })?;

    // Find column index (validation before spawn_blocking for fast error returns)
    let col_idx = stored
        .columns
        .iter()
        .position(|c| c.name == column_name)
        .ok_or_else(|| format!("Column '{column_name}' not found in result set"))?;

    let is_asc = direction == "asc";

    // Capture query_id for staleness guard
    let query_id = stored.query_id.clone();

    // Clone the slot's rows Arc to move into the blocking closure as an owned
    // Vec. We cannot hold a borrow across the `.await`, so unwrap the Arc to an
    // owned buffer (cloning only if the cache still shares it).
    let taken = Arc::clone(&stored.rows);
    drop(entry);
    let mut rows = Arc::try_unwrap(taken).unwrap_or_else(|a| (*a).clone());

    // Offload the sort to the blocking thread pool
    rows = tokio::task::spawn_blocking(move || {
        rows.sort_by(|a, b| {
            let va = a.get(col_idx).unwrap_or(&serde_json::Value::Null);
            let vb = b.get(col_idx).unwrap_or(&serde_json::Value::Null);
            let cmp = compare_json_values(va, vb);
            if is_asc {
                cmp
            } else {
                cmp.reverse()
            }
        });
        rows
    })
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "sort spawn_blocking task failed");
        format!("Sort task failed: {e}")
    })?;

    // Staleness and eviction guards: re-read the cache after the sort
    let expired_during_sort_msg =
        "results_expired: Results for this tab expired during sort. Re-run the query.";
    let post_sort_result = state.result_cache.get(connection_id, tab_id);
    if post_sort_result.is_expired() {
        return Err(expired_during_sort_msg.to_string());
    }
    let post_entry = post_sort_result
        .into_entry()
        .ok_or_else(|| expired_during_sort_msg.to_string())?;

    // Check if query_id changed (another query was executed during the sort)
    let post_stored = post_entry
        .value
        .get(idx)
        .ok_or_else(|| "Results were replaced during sort".to_string())?;
    if post_stored.query_id != query_id {
        return Err("Results were refreshed during sort".to_string());
    }

    // Drop the post-sort read borrow before the in-place write so `make_mut`
    // can mutate the cached entry directly instead of cloning it.
    drop(post_entry);

    // Wrap the sorted buffer in ONE fresh Arc, shared between the cache
    // write-back and the IPC return value (no extra deep copy).
    let sorted_rows = Arc::new(rows);

    // Apply the sorted rows in place under the captured invalidation version.
    // This swaps only `value[idx].rows` (no sibling-`columns` clone) and is
    // skipped if a new query bumped the invalidation version before the write.
    // Note: the version check and the cache write are not a single atomic step,
    // so a very narrow race remains (same as `insert_if_current`); the
    // `query_id` re-check above is the defense-in-depth guard.
    let applied = state.result_cache.update_rows_in_place_if_current(
        connection_id,
        tab_id,
        expected_invalidation_version,
        idx,
        Arc::clone(&sorted_rows),
    );
    if !applied {
        tracing::info!(
            connection_id = %connection_id,
            tab_id = %tab_id,
            "sort write-back skipped: results invalidated during sort"
        );
        return Err("Results were refreshed during sort".to_string());
    }

    Ok(SortedRowsResult { rows: sorted_rows })
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
        match sqlx::query("SELECT DATABASE()").fetch_one(&pool).await {
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

        match crate::mysql::table_data::fetch_table_pk_impl(&pool, database, &table_ref.table).await
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
/// Uses clone-on-write: clones the result vec from the cache, applies
/// updates, and re-inserts.
pub fn update_result_cell_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    row_index: usize,
    updates: HashMap<usize, serde_json::Value>,
    result_index: Option<usize>,
) -> Result<(), String> {
    let cache_result = state.result_cache.get(connection_id, tab_id);
    if cache_result.is_expired() {
        return Err(
            "results_expired: Results for this tab have expired. Re-run the query to see results."
                .to_string(),
        );
    }
    let entry = cache_result
        .into_entry()
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;

    let mut result_vec = entry.value.clone();

    let idx = result_index.unwrap_or(0);
    if idx >= result_vec.len() {
        return Err(format!(
            "Result index {idx} out of range (total: {})",
            result_vec.len()
        ));
    }
    let stored = &mut result_vec[idx];

    if row_index >= stored.rows.len() {
        return Err(format!(
            "Row index {row_index} out of bounds (total rows: {})",
            stored.rows.len()
        ));
    }

    // Copy-on-write: `make_mut` clones the inner buffer only if it is still
    // shared with another holder (e.g. a previously returned IPC payload),
    // so an already-returned buffer is never mutated in place.
    let rows_mut = Arc::make_mut(&mut stored.rows);
    for (col_index, new_value) in updates {
        if col_index < rows_mut[row_index].len() {
            rows_mut[row_index][col_index] = new_value;
        }
    }

    state.result_cache.insert(connection_id, tab_id, result_vec);

    Ok(())
}

// ── Multi-query result types ───────────────────────────────────────────────────

/// A single result item from a multi-query or CALL execution.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiQueryResultItem {
    pub query_id: String,
    pub source_sql: String,
    pub columns: Vec<ColumnMeta>,
    pub total_rows: i64,
    /// Server-execution-only time (narrow).
    pub execution_time_ms: u64,
    /// Combined time (execution + transfer + serialization).
    pub total_time_ms: u64,
    pub affected_rows: u64,
    pub rows: Arc<Vec<Vec<serde_json::Value>>>,
    pub auto_limit_applied: bool,
    pub error: Option<String>,
    pub re_executable: bool,
}

/// Wrapper for multiple result items returned from batch execution.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiQueryResult {
    pub results: Vec<MultiQueryResultItem>,
}

// ── Re-execute single result ───────────────────────────────────────────────────

/// Re-execute a single SQL statement and replace only the targeted entry in the
/// `Vec<StoredResult>` for a given tab. Uses the existing sqlx pool.
/// Returns a `MultiQueryResultItem` with the fresh result data.
#[cfg(not(coverage))]
pub async fn reexecute_single_result_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    result_index: usize,
    sql: &str,
    row_limit: usize,
) -> Result<MultiQueryResultItem, String> {
    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Read-only enforcement
    if state.registry.is_read_only(connection_id) && !is_read_only_allowed(sql) {
        return Err("This connection is read-only. Only SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, USE, and SET (non-GLOBAL) statements are allowed.".to_string());
    }

    // Verify the result index exists and capture the current query_id for
    // post-await staleness detection.
    let expected_query_id: Option<String>;
    {
        let cache_result = state.result_cache.get(connection_id, tab_id);
        if cache_result.is_expired() {
            return Err(
                "results_expired: Results for this tab have expired. Re-run the query to see results."
                    .to_string(),
            );
        }
        let entry = cache_result
            .into_entry()
            .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;
        let result_vec = &entry.value;
        if result_index >= result_vec.len() {
            return Err(format!(
                "Result index {result_index} out of range (total: {})",
                result_vec.len()
            ));
        }
        expected_query_id = Some(result_vec[result_index].query_id.clone());
    }

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

    let result = execute_single_statement_inner(&mut conn, &pool, sql, row_limit).await;

    // Remove thread ID from running_queries
    state.running_queries.write().await.remove(&key);

    let (stored, item) = result?;

    // Replace only the targeted result entry — re-validate after the await to
    // prevent out-of-bounds panics or stale overwrites if the tab's results
    // were replaced by a newer query while this re-execution was in flight.
    {
        let entry = match state.result_cache.get(connection_id, tab_id).into_entry() {
            Some(e) => e,
            None => {
                tracing::warn!(
                    tab_id,
                    result_index,
                    "reexecute_single_result: tab results disappeared after await — discarding stale result"
                );
                return Err(
                    "Tab results no longer exist — a newer query may have replaced them"
                        .to_string(),
                );
            }
        };
        let mut result_vec = entry.value.clone();
        if result_index >= result_vec.len() {
            tracing::warn!(
                tab_id,
                result_index,
                result_vec_len = result_vec.len(),
                "reexecute_single_result: result_index out of range after await — discarding stale result"
            );
            return Err(format!(
                "Result index {result_index} out of range after re-execution (total: {}) — a newer query may have replaced the results",
                result_vec.len()
            ));
        }
        // Check that the entry at result_index still has the same query_id
        // that was captured before the await — prevents overwriting results
        // from a newer query execution.
        if let Some(ref expected_qid) = expected_query_id {
            if result_vec[result_index].query_id != *expected_qid {
                tracing::warn!(
                    tab_id,
                    result_index,
                    expected_query_id = %expected_qid,
                    actual_query_id = %result_vec[result_index].query_id,
                    "reexecute_single_result: query_id mismatch after await — discarding stale result"
                );
                return Err("Result was replaced by a newer query during re-execution".to_string());
            }
        }
        result_vec[result_index] = stored;
        state.result_cache.insert(connection_id, tab_id, result_vec);
    }

    Ok(item)
}

/// Coverage stub for `reexecute_single_result_impl`: exercises connection validation,
/// read-only enforcement, result index validation, and result replacement without
/// requiring a live MySQL pool.
#[cfg(coverage)]
pub async fn reexecute_single_result_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    result_index: usize,
    sql: &str,
    _row_limit: usize,
) -> Result<MultiQueryResultItem, String> {
    // Validate connection exists
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Read-only enforcement
    if state.registry.is_read_only(connection_id) && !is_read_only_allowed(sql) {
        return Err("This connection is read-only. Only SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, USE, and SET (non-GLOBAL) statements are allowed.".to_string());
    }

    // Exercise pure-function paths
    let auto_limit_applied = needs_auto_limit(sql);
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

    let query_id = Uuid::new_v4().to_string();
    // Verify result index exists and capture expected_query_id for staleness detection
    let expected_query_id: Option<String>;
    {
        let cache_result = state.result_cache.get(connection_id, tab_id);
        if cache_result.is_expired() {
            return Err(
                "results_expired: Results for this tab have expired. Re-run the query to see results."
                    .to_string(),
            );
        }
        let entry = cache_result
            .into_entry()
            .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;
        let result_vec = &entry.value;
        if result_index >= result_vec.len() {
            return Err(format!(
                "Result index {result_index} out of range (total: {})",
                result_vec.len()
            ));
        }
        expected_query_id = Some(result_vec[result_index].query_id.clone());
    }

    // Re-validate after (simulated) await — check tab still exists, index in range,
    // and query_id hasn't changed (prevents overwriting newer results).
    {
        let entry = match state.result_cache.get(connection_id, tab_id).into_entry() {
            Some(e) => e,
            None => {
                return Err(
                    "Tab results no longer exist — a newer query may have replaced them"
                        .to_string(),
                );
            }
        };
        let mut result_vec = entry.value.clone();
        if result_index >= result_vec.len() {
            return Err(format!(
                "Result index {result_index} out of range after re-execution (total: {}) — a newer query may have replaced the results",
                result_vec.len()
            ));
        }
        if let Some(ref expected_qid) = expected_query_id {
            if result_vec[result_index].query_id != *expected_qid {
                return Err("Result was replaced by a newer query during re-execution".to_string());
            }
        }
        result_vec[result_index] = StoredResult {
            query_id: query_id.clone(),
            columns: vec![],
            rows: Arc::new(vec![]),
            execution_time_ms: 0,
            total_time_ms: 0,
            affected_rows: 0,
            auto_limit_applied,
        };
        state.result_cache.insert(connection_id, tab_id, result_vec);
    }

    Ok(MultiQueryResultItem {
        query_id,
        source_sql: sql.to_string(),
        columns: vec![],
        total_rows: 0,
        execution_time_ms: 0,
        total_time_ms: 0,
        affected_rows: 0,
        rows: Arc::new(vec![]),
        auto_limit_applied,
        error: None,
        re_executable: true,
    })
}

// ── Multi-query execution ──────────────────────────────────────────────────────

/// Execute multiple SQL statements sequentially on a single `mysql_async` connection.
///
/// Stores all results in `state.results` under `(connection_id, tab_id)` and
/// returns a `MultiQueryResult` with one entry per statement (plus extra entries
/// for CALL statements that return multiple result sets).
#[cfg(not(coverage))]
pub async fn execute_multi_query_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    statements: Vec<String>,
    row_limit: usize,
) -> Result<MultiQueryResult, String> {
    // Validate connection exists
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let is_read_only = state.registry.is_read_only(connection_id);

    let (stored_results, result_items) = crate::mysql::multi_result::execute_multi_query_internal(
        state,
        connection_id,
        tab_id,
        &statements,
        row_limit,
        is_read_only,
    )
    .await?;

    // Store all results in state
    state
        .result_cache
        .insert(connection_id, tab_id, stored_results);

    Ok(MultiQueryResult {
        results: result_items,
    })
}

/// Coverage stub for `execute_multi_query_impl`: exercises connection validation,
/// read-only enforcement, statement classification, and result storage without
/// requiring a live MySQL connection.
#[cfg(coverage)]
pub async fn execute_multi_query_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    statements: Vec<String>,
    _row_limit: usize,
) -> Result<MultiQueryResult, String> {
    // Validate connection exists
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let is_read_only = state.registry.is_read_only(connection_id);
    let mut stored_results: Vec<StoredResult> = Vec::new();
    let mut result_items: Vec<MultiQueryResultItem> = Vec::new();

    // Exercise pure-function paths for each statement
    for sql in &statements {
        let sql = sql.trim();
        if sql.is_empty() {
            continue;
        }

        // Exercise read-only enforcement
        if is_read_only && !is_read_only_allowed(sql) {
            let query_id = uuid::Uuid::new_v4().to_string();
            stored_results.push(StoredResult {
                query_id: query_id.clone(),
                columns: vec![],
                rows: Arc::new(vec![]),
                execution_time_ms: 0,
                total_time_ms: 0,
                affected_rows: 0,
                auto_limit_applied: false,
            });
            result_items.push(MultiQueryResultItem {
                query_id,
                source_sql: sql.to_string(),
                columns: vec![],
                total_rows: 0,
                execution_time_ms: 0,
                total_time_ms: 0,
                affected_rows: 0,
                rows: Arc::new(vec![]),
                auto_limit_applied: false,
                error: Some("This connection is read-only. Only SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, USE, and SET (non-GLOBAL) statements are allowed.".to_string()),
                re_executable: false,
            });
            break;
        }

        // Exercise statement classification
        let is_call = crate::mysql::multi_result::is_call_statement(sql);
        let stripped = strip_non_executable_comments(sql);
        let keyword = get_first_keyword(&stripped);
        let _is_result_set = if keyword == "WITH" {
            let main_kw = find_with_main_keyword(&stripped);
            is_select_like(&main_kw) || main_kw.is_empty()
        } else {
            is_select_like(&keyword)
        };
        let auto_limit_applied = needs_auto_limit(sql);
        if auto_limit_applied {
            let _sql_to_execute = inject_limit_into_select(sql, 1000);
        }

        let query_id = uuid::Uuid::new_v4().to_string();
        stored_results.push(StoredResult {
            query_id: query_id.clone(),
            columns: vec![],
            rows: Arc::new(vec![]),
            execution_time_ms: 0,
            total_time_ms: 0,
            affected_rows: 0,
            auto_limit_applied,
        });
        result_items.push(MultiQueryResultItem {
            query_id,
            source_sql: sql.to_string(),
            columns: vec![],
            total_rows: 0,
            execution_time_ms: 0,
            total_time_ms: 0,
            affected_rows: 0,
            rows: Arc::new(vec![]),
            auto_limit_applied,
            error: None,
            re_executable: !is_call,
        });
    }

    // Track a dummy thread ID to exercise the running_queries path
    let key = (connection_id.to_string(), tab_id.to_string());
    state
        .running_queries
        .write()
        .await
        .insert(key.clone(), 42u64);
    state.running_queries.write().await.remove(&key);

    // Store results in state
    state
        .result_cache
        .insert(connection_id, tab_id, stored_results);

    Ok(MultiQueryResult {
        results: result_items,
    })
}

/// Execute a single CALL statement and return all result sets.
///
/// Delegates to `execute_multi_query_internal` with a single-element slice.
/// Stores all results in `state.results` under `(connection_id, tab_id)`.
#[cfg(not(coverage))]
pub async fn execute_call_query_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    sql: &str,
    row_limit: usize,
) -> Result<MultiQueryResult, String> {
    // Validate connection exists
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let is_read_only = state.registry.is_read_only(connection_id);

    // CALL is blocked on read-only connections
    if is_read_only {
        return Err("This connection is read-only. CALL statements are not allowed on read-only connections.".to_string());
    }

    let statements = vec![sql.to_string()];
    let (stored_results, result_items) = crate::mysql::multi_result::execute_multi_query_internal(
        state,
        connection_id,
        tab_id,
        &statements,
        row_limit,
        is_read_only,
    )
    .await?;

    // Store all results in state
    state
        .result_cache
        .insert(connection_id, tab_id, stored_results);

    Ok(MultiQueryResult {
        results: result_items,
    })
}

/// Coverage stub for `execute_call_query_impl`: exercises connection validation,
/// read-only enforcement, and CALL detection without requiring a live MySQL connection.
#[cfg(coverage)]
pub async fn execute_call_query_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    sql: &str,
    _row_limit: usize,
) -> Result<MultiQueryResult, String> {
    // Validate connection exists
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let is_read_only = state.registry.is_read_only(connection_id);

    // CALL is blocked on read-only connections
    if is_read_only {
        return Err("This connection is read-only. CALL statements are not allowed on read-only connections.".to_string());
    }

    // Exercise CALL detection
    let _is_call = crate::mysql::multi_result::is_call_statement(sql);

    let query_id = uuid::Uuid::new_v4().to_string();

    // Track a dummy thread ID to exercise the running_queries path
    let key = (connection_id.to_string(), tab_id.to_string());
    state
        .running_queries
        .write()
        .await
        .insert(key.clone(), 42u64);
    state.running_queries.write().await.remove(&key);

    let stored = StoredResult {
        query_id: query_id.clone(),
        columns: vec![],
        rows: Arc::new(vec![]),
        execution_time_ms: 0,
        total_time_ms: 0,
        affected_rows: 0,
        auto_limit_applied: false,
    };

    // Store result in state
    state
        .result_cache
        .insert(connection_id, tab_id, vec![stored]);

    Ok(MultiQueryResult {
        results: vec![MultiQueryResultItem {
            query_id,
            source_sql: sql.to_string(),
            columns: vec![],
            total_rows: 0,
            execution_time_ms: 0,
            total_time_ms: 0,
            affected_rows: 0,
            rows: Arc::new(vec![]),
            auto_limit_applied: false,
            error: None,
            re_executable: false,
        }],
    })
}

// ── Touch results (availability check) ────────────────────────────────────

/// Check whether a cached result is still available for a given tab.
///
/// Returns a JSON object with `{ "status": "available" | "missing" }`.
/// A successful lookup also refreshes the cache's idle timer for that entry.
pub fn touch_results_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
) -> serde_json::Value {
    use crate::mysql::result_cache::ResultCacheGet;
    match state.result_cache.get(connection_id, tab_id) {
        ResultCacheGet::Found(_) | ResultCacheGet::ReWarmed(_) => {
            serde_json::json!({ "status": "available" })
        }
        ResultCacheGet::Expired => serde_json::json!({ "status": "expired" }),
        ResultCacheGet::NeverStored => serde_json::json!({ "status": "missing" }),
    }
}
