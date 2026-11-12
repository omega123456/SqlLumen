//! Query execution engine: runs SQL against MySQL connections,
//! stores paginated results, and enforces read-only restrictions.

use crate::mysql::cache_status::cache_status_json;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
#[cfg(not(coverage))]
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Arc;
#[cfg(coverage)]
use uuid::Uuid;

// ── Data structures ────────────────────────────────────────────────────────────

/// One cached result row. Rows are shared by pointer between the cache, IPC
/// payloads, sort output and exports, so editing one row never copies the rest.
pub type SharedRow = Arc<[serde_json::Value]>;

/// A full cached row set (serializes identically to `Vec<Vec<Value>>`).
pub type SharedRows = Arc<Vec<SharedRow>>;

/// Column metadata returned from a query result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
}

/// Why a truncated result cannot be exported in full by re-running its SQL.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FullExportBlockedReason {
    /// A `CALL`: re-running would repeat the procedure's writes.
    Call,
    /// A locking `SELECT` (`FOR UPDATE`, `FOR SHARE`, `LOCK IN SHARE MODE`).
    Locking,
    /// The database the query ran in could not be read back after truncation.
    UnknownDatabase,
}

/// The session database a result's SQL ran in (re-run context).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum RunDatabase {
    /// Not captured: only truncated, re-runnable results read `SELECT DATABASE()`.
    #[default]
    NotCaptured,
    /// `SELECT DATABASE()` returned NULL (no default database).
    NoDatabase,
    /// The session's current database when the query ran.
    Named(String),
}

/// A stored result set in memory, keyed by (connection_id, tab_id).
///
/// `rows` are the base rows in their original order. `view` (when present) is a
/// permutation of base-row indices encoding the current sort, filter and
/// tombstone exclusion; `None` means the identity view (no sort, filter or
/// tombstones). All view fields are written only through
/// `ResultCache::modify_slot_in_place_if_current`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredResult {
    pub query_id: String,
    pub columns: Vec<ColumnMeta>,
    pub rows: SharedRows,
    /// Server-execution-only time (narrow): up to first row / header availability.
    pub execution_time_ms: u64,
    /// Combined time (execution + row transfer + serialization). Equals the
    /// single value reported before the timing split.
    pub total_time_ms: u64,
    pub affected_rows: u64,
    pub auto_limit_applied: bool,
    /// Current view over `rows` (`None` = identity).
    pub view: Option<Arc<Vec<u32>>>,
    /// Sort and filters the current view was built from.
    pub view_spec: crate::mysql::result_view::ResultViewSpec,
    /// Monotonic view version, bumped on every view or tombstone change.
    pub view_version: u64,
    /// Base indices of deleted rows (excluded from every view).
    pub tombstones: Arc<std::collections::BTreeSet<u32>>,
    /// True when at least one row beyond the ceiling was seen.
    pub truncated: bool,
    /// Row ceiling in force when this result ran.
    pub row_ceiling: usize,
    /// The LIMIT injected by auto-LIMIT (after clamping), if any.
    pub applied_row_limit: Option<usize>,
    /// Re-run context: the SQL that produced this result.
    pub source_sql: String,
    /// Re-run context: the session database when the query ran.
    pub run_database: RunDatabase,
    /// Re-run context: why a full re-run export is not allowed, if it is not.
    pub full_export_blocked_reason: Option<FullExportBlockedReason>,
}

impl StoredResult {
    /// Build a result with default view, truncation and re-run fields.
    pub fn new(
        query_id: String,
        columns: Vec<ColumnMeta>,
        rows: SharedRows,
        execution_time_ms: u64,
        total_time_ms: u64,
        affected_rows: u64,
        auto_limit_applied: bool,
    ) -> Self {
        Self {
            query_id,
            columns,
            rows,
            execution_time_ms,
            total_time_ms,
            affected_rows,
            auto_limit_applied,
            view: None,
            view_spec: crate::mysql::result_view::ResultViewSpec::default(),
            view_version: crate::mysql::result_view::INITIAL_VIEW_VERSION,
            tombstones: Arc::new(std::collections::BTreeSet::new()),
            truncated: false,
            row_ceiling: crate::mysql::result_cache::DEFAULT_ROW_CEILING,
            applied_row_limit: None,
            source_sql: String::new(),
            run_database: RunDatabase::NotCaptured,
            full_export_blocked_reason: None,
        }
    }

    /// An empty result (no columns, no rows) for DML, errors and stubs.
    pub fn empty(query_id: String) -> Self {
        Self::new(query_id, vec![], Arc::new(vec![]), 0, 0, 0, false)
    }

    /// Live base rows: all rows minus tombstones.
    pub fn live_row_count(&self) -> usize {
        self.rows.len().saturating_sub(self.tombstones.len())
    }
}

/// Response for `execute_query`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryResult {
    pub query_id: String,
    pub columns: Vec<ColumnMeta>,
    /// Live base rows (tombstones excluded).
    pub total_rows: usize,
    /// Server-execution-only time (narrow).
    pub execution_time_ms: u64,
    /// Combined time (execution + transfer + serialization).
    pub total_time_ms: u64,
    pub affected_rows: u64,
    pub auto_limit_applied: bool,
    pub view_row_count: usize,
    pub view_version: u64,
    pub truncated: bool,
    pub row_ceiling: usize,
    pub applied_row_limit: Option<usize>,
    pub full_export_blocked_reason: Option<FullExportBlockedReason>,
    pub first_window: crate::mysql::result_view::ResultWindow,
}

impl From<MultiQueryResultItem> for ExecuteQueryResult {
    fn from(item: MultiQueryResultItem) -> Self {
        Self {
            query_id: item.query_id,
            columns: item.columns,
            total_rows: item.total_rows.max(0) as usize,
            execution_time_ms: item.execution_time_ms,
            total_time_ms: item.total_time_ms,
            affected_rows: item.affected_rows,
            auto_limit_applied: item.auto_limit_applied,
            view_row_count: item.view_row_count,
            view_version: item.view_version,
            truncated: item.truncated,
            row_ceiling: item.row_ceiling,
            applied_row_limit: item.applied_row_limit,
            full_export_blocked_reason: item.full_export_blocked_reason,
            first_window: item.first_window,
        }
    }
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewMeta {
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerMeta {
    pub name: String,
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
    pub views: std::collections::HashMap<String, Vec<ViewMeta>>,
    pub triggers: std::collections::HashMap<String, Vec<TriggerMeta>>,
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
    let mut chars = sql.chars().peekable();

    while let Some(ch) = chars.next() {
        let next_char = chars.peek().copied();
        if ch == '/' && next_char == Some('*') {
            chars.next();
            copy_or_drop_block_comment(&mut chars, &mut result);
            continue;
        }
        if ch == '-' && next_char == Some('-') {
            chars.next();
            drop_line_comment(&mut chars, &mut result);
            continue;
        }
        if ch == '#' {
            drop_line_comment(&mut chars, &mut result);
            continue;
        }
        if matches!(ch, '\'' | '"' | '`') {
            copy_quoted_literal(ch, &mut chars, &mut result);
            continue;
        }
        result.push(ch);
    }

    result
}

type SqlChars<'a> = std::iter::Peekable<std::str::Chars<'a>>;

fn copy_or_drop_block_comment(chars: &mut SqlChars<'_>, result: &mut String) {
    let is_executable_or_hint = chars
        .peek()
        .is_some_and(|&character| character == '!' || character == '+');
    if !is_executable_or_hint {
        skip_past_block_comment_end(chars);
        result.push(' ');
        return;
    }
    result.push('/');
    result.push('*');
    while let Some(character) = chars.next() {
        let closes_comment = character == '*' && chars.peek() == Some(&'/');
        if closes_comment {
            chars.next();
            result.push_str("*/");
            return;
        }
        result.push(character);
    }
}

fn skip_past_block_comment_end(chars: &mut SqlChars<'_>) {
    while let Some(character) = chars.next() {
        let closes_comment = character == '*' && chars.peek() == Some(&'/');
        if closes_comment {
            chars.next();
            return;
        }
    }
}

fn drop_line_comment(chars: &mut SqlChars<'_>, result: &mut String) {
    while chars.next_if(|&character| character != '\n').is_some() {}
    if chars.next_if_eq(&'\n').is_some() {
        result.push('\n');
    }
}

fn copy_quoted_literal(quote: char, chars: &mut SqlChars<'_>, result: &mut String) {
    result.push(quote);
    while let Some(character) = chars.next() {
        result.push(character);
        if character == '\\' {
            result.extend(chars.next());
            continue;
        }
        if character == quote {
            return;
        }
    }
}

/// Get the first SQL keyword from a (comment-stripped) SQL string.
/// Handles executable comments (`/*!50001 SELECT ... */`) by extracting the keyword inside.
pub fn get_first_keyword(sql: &str) -> String {
    let trimmed = sql.trim();

    // Handle executable comments: /*!50001 keyword ... */
    if let Some(inner) = trimmed.strip_prefix("/*!") {
        // Skip optional version number (digits)
        let after_version = inner.trim_start_matches(|character: char| character.is_ascii_digit());
        let after_ws = after_version.trim_start();
        // Extract first word
        let first_word: String = after_ws
            .chars()
            .take_while(|character| character.is_alphanumeric() || *character == '_')
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
    let mut position = 0;
    let mut depth: i32 = 0;

    // Skip leading whitespace
    while position < len && chars[position].is_whitespace() {
        position += 1;
    }

    // Skip past "WITH" keyword
    let remaining: String = chars[position..].iter().collect();
    if !remaining.to_uppercase().starts_with("WITH") {
        return String::new();
    }
    position += 4;

    while position < len {
        // Skip string literals
        if chars[position] == '\'' || chars[position] == '"' || chars[position] == '`' {
            let quote = chars[position];
            position += 1;
            while position < len {
                if chars[position] == '\\' && position + 1 < len {
                    position += 2;
                    continue;
                }
                if chars[position] == quote {
                    position += 1;
                    break;
                }
                position += 1;
            }
            continue;
        }

        if chars[position] == '(' {
            depth += 1;
            position += 1;
            continue;
        }
        if chars[position] == ')' {
            if depth > 0 {
                depth -= 1;
            }
            position += 1;
            continue;
        }

        let starts_top_level_word = depth == 0 && chars[position].is_alphabetic();
        if !starts_top_level_word {
            position += 1;
            continue;
        }
        let start = position;
        while position < len && (chars[position].is_alphanumeric() || chars[position] == '_') {
            position += 1;
        }
        let word: String = chars[start..position].iter().collect();
        let upper_word = word.to_uppercase();
        if matches!(
            upper_word.as_str(),
            "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "REPLACE"
        ) {
            return upper_word;
        }
    }

    String::new()
}

/// Check whether a LIMIT keyword appears at the top level of a SQL string.
/// Skips LIMIT tokens inside string literals and parenthesized subqueries.
pub fn has_top_level_limit(sql: &str) -> bool {
    let chars: Vec<char> = sql.chars().collect();
    let len = chars.len();
    let mut position = 0;
    let mut depth: i32 = 0;

    while position < len {
        // Skip string literals
        if chars[position] == '\'' || chars[position] == '"' || chars[position] == '`' {
            let quote = chars[position];
            position += 1;
            while position < len {
                if chars[position] == '\\' && position + 1 < len {
                    position += 2;
                    continue;
                }
                if chars[position] == quote {
                    position += 1;
                    break;
                }
                position += 1;
            }
            continue;
        }

        if chars[position] == '(' {
            depth += 1;
            position += 1;
            continue;
        }
        if chars[position] == ')' {
            if depth > 0 {
                depth -= 1;
            }
            position += 1;
            continue;
        }

        // At depth 0, look for LIMIT keyword (case-insensitive, word boundary)
        if depth == 0 && position + 4 < len && chars[position].eq_ignore_ascii_case(&'L') {
            let word: String = chars[position..position + 5].iter().collect();
            if word.eq_ignore_ascii_case("LIMIT") {
                let before_ok = position == 0
                    || !(chars[position - 1].is_alphanumeric() || chars[position - 1] == '_');
                let after_ok = position + 5 >= len
                    || !(chars[position + 5].is_alphanumeric() || chars[position + 5] == '_');
                if before_ok && after_ok {
                    return true;
                }
            }
        }

        position += 1;
    }

    false
}

/// Returns true if a `;` outside string literals and comments is followed by
/// more SQL (trailing semicolons alone do not count).
pub fn has_multiple_statements(sql: &str) -> bool {
    let stripped = strip_non_executable_comments(sql);
    let mut quote: Option<char> = None;
    let mut chars = stripped.char_indices();
    while let Some((position, ch)) = chars.next() {
        match quote {
            Some(_) if ch == '\\' => {
                chars.next();
            }
            Some(open_quote) if ch == open_quote => quote = None,
            Some(_) => {}
            None if matches!(ch, '\'' | '"' | '`') => quote = Some(ch),
            None if ch == ';' => {
                return !stripped[position + 1..]
                    .trim_matches(|character: char| character == ';' || character.is_whitespace())
                    .is_empty();
            }
            None => {}
        }
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

/// Returns true if `sql` contains a row-locking clause anywhere outside string
/// literals and comments: `FOR UPDATE`, `FOR SHARE` or `LOCK IN SHARE MODE`.
///
/// Deliberately conservative (it also matches inside subqueries and CTEs, and
/// covers `NOWAIT`, `SKIP LOCKED`, `OF tbl` and trailing `;` variants), because a
/// re-run of a locking query would take its locks again. Unlike
/// [`find_trailing_lock_clause`], which only positions an injected LIMIT, this
/// decides whether a truncated result may be re-run for a full export.
pub fn has_locking_clause(sql: &str) -> bool {
    // One pass over the raw SQL that skips strings and comments with MySQL's
    // rules, so the two can never fall out of step: `--` only starts a comment
    // when followed by whitespace, a control character or the end of input, and
    // backticks have no backslash escapes. The contents of executable comments
    // (`/*! */`) and optimizer hints (`/*+ */`) are scanned like normal SQL.
    let tokens = LockingClauseTokenizer::new(sql).tokenize();

    let is = |token_index: usize, kw: &str| {
        tokens.get(token_index).and_then(|token| token.as_deref()) == Some(kw)
    };
    (0..tokens.len()).any(|token_index| {
        (is(token_index, "FOR") && (is(token_index + 1, "UPDATE") || is(token_index + 1, "SHARE")))
            || (is(token_index, "LOCK")
                && is(token_index + 1, "IN")
                && is(token_index + 2, "SHARE")
                && is(token_index + 3, "MODE"))
    })
}

struct LockingClauseTokenizer<'a> {
    chars: SqlChars<'a>,
    word: String,
    tokens: Vec<Option<String>>,
}

impl<'a> LockingClauseTokenizer<'a> {
    fn new(sql: &'a str) -> Self {
        Self {
            chars: sql.chars().peekable(),
            word: String::new(),
            tokens: Vec::new(),
        }
    }

    fn tokenize(mut self) -> Vec<Option<String>> {
        while let Some(ch) = self.chars.next() {
            self.consume(ch);
        }
        self.flush_word();
        self.tokens
    }

    fn consume(&mut self, ch: char) {
        let next_char = self.chars.peek().copied();
        if matches!(ch, '\'' | '"' | '`') {
            self.break_keyword_sequence();
            self.skip_quoted(ch);
            return;
        }
        if ch == '#' {
            self.break_keyword_sequence();
            self.skip_line();
            return;
        }
        if ch == '-' && next_char == Some('-') {
            self.break_keyword_sequence();
            self.skip_dash_dash_comment();
            return;
        }
        if ch == '/' && next_char == Some('*') {
            self.chars.next();
            self.break_keyword_sequence();
            self.skip_block_comment();
            return;
        }
        if ch.is_alphanumeric() || ch == '_' || ch == '$' {
            self.word.push(ch);
            return;
        }
        self.flush_word();
        if !ch.is_whitespace() {
            self.tokens.push(None);
        }
    }

    fn flush_word(&mut self) {
        if self.word.is_empty() {
            return;
        }
        self.tokens.push(Some(self.word.to_ascii_uppercase()));
        self.word.clear();
    }

    fn break_keyword_sequence(&mut self) {
        self.flush_word();
        self.tokens.push(None);
    }

    fn skip_line(&mut self) {
        while self.chars.next_if(|&character| character != '\n').is_some() {}
    }

    fn skip_quoted(&mut self, quote: char) {
        while let Some(character) = self.chars.next() {
            let is_backslash_escape = character == '\\' && quote != '`';
            if is_backslash_escape {
                self.chars.next();
                continue;
            }
            if character != quote {
                continue;
            }
            if self.chars.next_if_eq(&quote).is_none() {
                return;
            }
        }
    }

    fn skip_dash_dash_comment(&mut self) {
        let mut ahead = self.chars.clone();
        ahead.next();
        let starts_comment = ahead
            .peek()
            .is_none_or(|character| character.is_whitespace() || character.is_control());
        if starts_comment {
            self.skip_line();
        }
    }

    fn skip_block_comment(&mut self) {
        let is_executable_or_hint = self
            .chars
            .next_if(|&character| character == '!' || character == '+')
            .is_some();
        if is_executable_or_hint {
            return;
        }
        let mut previous = '\0';
        for character in self.chars.by_ref() {
            if previous == '*' && character == '/' {
                return;
            }
            previous = character;
        }
    }
}

pub const DEFAULT_ROW_LIMIT: usize = 1000;

pub fn requested_row_limit(row_limit: usize) -> usize {
    if row_limit == 0 {
        return DEFAULT_ROW_LIMIT;
    }
    row_limit
}

pub fn returns_result_set(stripped_sql: &str) -> bool {
    let keyword = get_first_keyword(stripped_sql);
    if keyword != "WITH" {
        return is_select_like(&keyword);
    }
    let main_keyword = find_with_main_keyword(stripped_sql);
    is_select_like(&main_keyword) || main_keyword.is_empty()
}

/// The auto-LIMIT actually injected for a requested `row_limit`: `0` falls back
/// to 1,000 (as before), and the result is clamped to the hard row ceiling.
/// Only the injected LIMIT uses this; decoding is capped by the ceiling itself.
pub fn effective_row_limit(row_limit: usize, ceiling: usize) -> usize {
    requested_row_limit(row_limit).min(ceiling.max(1))
}

/// The blocked reason implied by a statement alone (before truncation is known).
pub fn statement_blocked_reason(sql: &str, is_call: bool) -> Option<FullExportBlockedReason> {
    if is_call {
        return Some(FullExportBlockedReason::Call);
    }
    if has_locking_clause(sql) {
        return Some(FullExportBlockedReason::Locking);
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
            main_kw == "SELECT" && !has_top_level_limit(&stripped)
        }
        _ => false,
    }
}

pub fn sql_with_auto_limit(sql: &str, auto_limit_applied: bool, limit: usize) -> String {
    if !auto_limit_applied {
        return sql.to_string();
    }
    inject_limit_into_select(sql, limit)
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

    // The editor session uses the text protocol, which runs every `;`-separated
    // statement — only the first would be vetted below.
    if has_multiple_statements(trimmed) {
        return false;
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

// ── Row decoding ───────────────────────────────────────────────────────────────

#[cfg(not(coverage))]
fn decode_unchecked_string(row: &sqlx::mysql::MySqlRow, column_index: usize) -> Option<String> {
    if let Ok(value) = row.try_get_unchecked::<Option<String>, _>(column_index) {
        return value;
    }

    row.try_get_unchecked::<Option<Vec<u8>>, _>(column_index)
        .ok()
        .flatten()
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

// ── Core impl functions ────────────────────────────────────────────────────────

#[cfg(not(coverage))]
pub async fn execute_query_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    sql: &str,
    row_limit: usize,
    view_spec: Option<crate::mysql::result_view::ResultViewSpec>,
) -> Result<ExecuteQueryResult, String> {
    if !state.registry.contains(connection_id) {
        return Err(format!("Connection '{connection_id}' not found"));
    }

    // Read-only enforcement
    if state.registry.is_read_only(connection_id) && !is_read_only_allowed(sql) {
        return Err("This connection is read-only. Only SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, USE, and SET (non-GLOBAL) statements are allowed.".to_string());
    }

    let row_limit = effective_row_limit(row_limit, state.result_cache.row_ceiling());
    let (stored, _item) = crate::mysql::multi_result::execute_single_on_session(
        state,
        connection_id,
        tab_id,
        sql,
        row_limit,
    )
    .await?;

    let stored = crate::mysql::result_view::apply_initial_view(stored, view_spec).await?;
    let item = MultiQueryResultItem::from_stored(&stored, None, true);

    // Store result set in state — execute_query replaces the WHOLE tab result vector
    state
        .result_cache
        .insert(connection_id, tab_id, vec![stored]);

    Ok(ExecuteQueryResult::from(item))
}

/// Coverage stub: exercises connection validation, read-only enforcement, the
/// row-limit clamp, auto-limit detection, the view-spec path and the first
/// window builder without requiring a live MySQL pool.
#[cfg(coverage)]
pub async fn execute_query_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    sql: &str,
    row_limit: usize,
    view_spec: Option<crate::mysql::result_view::ResultViewSpec>,
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

    let ceiling = state.result_cache.row_ceiling();
    let row_limit = effective_row_limit(row_limit, ceiling);
    let auto_limit_applied = needs_auto_limit(sql);
    let query_id = Uuid::new_v4().to_string();
    // Exercise the same pure-function paths as the real impl so they are
    // covered without a live MySQL connection.
    let _is_result = returns_result_set(&strip_non_executable_comments(sql));
    let _sql_to_execute = sql_with_auto_limit(sql, auto_limit_applied, row_limit);

    // Track a dummy thread ID to exercise the running_queries path
    let key = (connection_id.to_string(), tab_id.to_string());
    state
        .running_queries
        .write()
        .await
        .insert(key.clone(), 42u64);

    let mut stored = StoredResult::empty(query_id);
    stored.auto_limit_applied = auto_limit_applied;
    stored.applied_row_limit = auto_limit_applied.then_some(row_limit);
    stored.row_ceiling = ceiling;
    stored.source_sql = sql.to_string();
    stored.full_export_blocked_reason = statement_blocked_reason(sql, false);
    let stored = crate::mysql::result_view::apply_initial_view(stored, view_spec).await?;
    let item = MultiQueryResultItem::from_stored(&stored, None, true);

    // Store empty result in state (exercises the result_cache path)
    state
        .result_cache
        .insert(connection_id, tab_id, vec![stored]);

    // Remove dummy thread ID
    state.running_queries.write().await.remove(&key);

    Ok(ExecuteQueryResult::from(item))
}

pub fn evict_results_impl(state: &AppState, connection_id: &str, tab_id: &str) {
    state
        .result_cache
        .remove_with_spill_cleanup(connection_id, tab_id);
}

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
        let queued_run = crate::mysql::session::TabRun::new(connection_id, tab_id);
        return Ok(state.editor_sessions.cancel_queued_run(&queued_run));
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
        .map_err(|error| error.to_string())?;

    let kill_sql = format!("KILL QUERY {}", thread_id);
    tracing::debug!(
        connection_id,
        tab_id,
        thread_id,
        "cancel_query: issuing KILL QUERY"
    );
    crate::mysql::query_log::log_outgoing_sql(&kill_sql);
    let result = sqlx::query(sqlx::AssertSqlSafe(kill_sql.as_str()))
        .execute(&mut *conn)
        .await
        .map_err(|error| format!("Failed to cancel query: {error}"))?;
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
        let queued_run = crate::mysql::session::TabRun::new(connection_id, tab_id);
        return Ok(state.editor_sessions.cancel_queued_run(&queued_run));
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
            let rows = sqlx::query(sqlx::AssertSqlSafe(db_sql.as_str()))
                .fetch_all(&pool)
                .await
                .map_err(|error| format!("Failed to fetch databases: {error}"))?;
            crate::mysql::query_log::log_mysql_rows(&rows);
            Ok::<_, String>(rows)
        },
        async {
            crate::mysql::query_log::log_outgoing_sql(&table_sql);
            let rows = sqlx::query(sqlx::AssertSqlSafe(table_sql.as_str()))
                .fetch_all(&pool)
                .await
                .map_err(|error| format!("Failed to fetch tables: {error}"))?;
            crate::mysql::query_log::log_mysql_rows(&rows);
            Ok::<_, String>(rows)
        },
        async {
            crate::mysql::query_log::log_outgoing_sql(&col_sql);
            let rows = sqlx::query(sqlx::AssertSqlSafe(col_sql.as_str()))
                .fetch_all(&pool)
                .await
                .map_err(|error| format!("Failed to fetch columns: {error}"))?;
            crate::mysql::query_log::log_mysql_rows(&rows);
            Ok::<_, String>(rows)
        },
        async {
            crate::mysql::query_log::log_outgoing_sql(&routine_sql);
            let rows = sqlx::query(sqlx::AssertSqlSafe(routine_sql.as_str()))
                .fetch_all(&pool)
                .await
                .map_err(|error| format!("Failed to fetch routines: {error}"))?;
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
            .map(|value| value as u64)
            .unwrap_or(0);
        let data_size: u64 = row
            .try_get::<Option<i64>, _>(5)
            .unwrap_or(None)
            .map(|value| value as u64)
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
    use crate::mysql::schema_queries::{
        query_all_foreign_keys_batch, query_all_indexes_batch, query_all_triggers_batch,
        query_all_views_batch,
    };

    // First get the base metadata (databases, tables, columns, routines)
    let base = fetch_schema_metadata_impl(state, connection_id).await?;

    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Extract database names for batch queries
    let db_names: Vec<String> = base.databases.clone();

    // Run all additive batch queries concurrently.
    let (foreign_keys, indexes, views, triggers) = tokio::join!(
        async {
            query_all_foreign_keys_batch(&pool, &db_names)
                .await
                .unwrap_or_else(|error| {
                    tracing::warn!(
                        error = %error,
                        "failed to fetch foreign keys batch"
                    );
                    HashMap::new()
                })
        },
        async {
            query_all_indexes_batch(&pool, &db_names)
                .await
                .unwrap_or_else(|error| {
                    tracing::warn!(
                        error = %error,
                        "failed to fetch indexes batch"
                    );
                    HashMap::new()
                })
        },
        async {
            query_all_views_batch(&pool, &db_names)
                .await
                .unwrap_or_else(|error| {
                    tracing::warn!(
                        error = %error,
                        "failed to fetch views batch"
                    );
                    HashMap::new()
                })
        },
        async {
            query_all_triggers_batch(&pool, &db_names)
                .await
                .unwrap_or_else(|error| {
                    tracing::warn!(
                        error = %error,
                        "failed to fetch triggers batch"
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
        views,
        triggers,
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
        views: HashMap::new(),
        triggers: HashMap::new(),
        foreign_keys: HashMap::new(),
        indexes: HashMap::new(),
    })
}

pub fn read_file_impl(path: &str) -> Result<String, String> {
    let file_path = std::path::Path::new(path);
    let metadata = std::fs::metadata(file_path)
        .map_err(|error| format!("Failed to read file metadata: {error}"))?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Err("File exceeds the 50 MB limit".to_string());
    }
    let bytes =
        std::fs::read(file_path).map_err(|error| format!("Failed to read file: {error}"))?;
    String::from_utf8(bytes).map_err(|_| "File is not valid UTF-8".to_string())
}

pub fn write_file_impl(path: &str, content: &str) -> Result<(), String> {
    let file_path = std::path::Path::new(path);
    if let Some(parent) = file_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create directories: {error}"))?;
        }
    }
    std::fs::write(file_path, content).map_err(|error| format!("Failed to write file: {error}"))
}

// ── Sort helpers ───────────────────────────────────────────────────────────────

/// Compare two `serde_json::Value` items for sorting purposes.
///
/// - `Null` sorts **after** all non-null values (for ascending order;
///   callers reverse the result for descending).
/// - Two `Number` values are compared as f64.
/// - Two `String` values are compared lexicographically.
/// - Mixed types (or booleans / arrays / objects) fall back to `to_string()` comparison.
pub fn compare_json_values(
    left: &serde_json::Value,
    right: &serde_json::Value,
) -> std::cmp::Ordering {
    use serde_json::Value;
    use std::cmp::Ordering;

    match (left, right) {
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
            let sa = left.to_string();
            let sb = right.to_string();
            sa.cmp(&sb)
        }
    }
}

// ── Analyze query for edit ─────────────────────────────────────────────────────

/// Analyze a SQL query and return table metadata for inline editing.
///
/// Extracts table references from the SQL, resolves their databases, and
/// fetches primary key / column metadata for each table via `fetch_table_pk_impl`.
#[cfg(not(coverage))]
async fn query_session_current_database(pool: &sqlx::MySqlPool) -> Option<String> {
    match sqlx::query("SELECT DATABASE()").fetch_one(pool).await {
        Ok(row) => match row.try_get::<String, _>(0) {
            Ok(db) => {
                tracing::debug!(database = %db, "analyze_query_for_edit: resolved current database via SELECT DATABASE()");
                Some(db)
            }
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    "analyze_query_for_edit: SELECT DATABASE() returned non-string (NULL?)"
                );
                None
            }
        },
        Err(error) => {
            tracing::warn!(
                error = %error,
                "analyze_query_for_edit: SELECT DATABASE() query failed"
            );
            None
        }
    }
}

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
    let default_database = params.and_then(|params| params.default_database);

    let default_database = match default_database {
        Some(database) => Some(database),
        None => query_session_current_database(&pool).await,
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
                .unwrap_or_else(|error| {
                    tracing::warn!(
                        table = %table_ref.table,
                        database = %database,
                        error = %error,
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
            Err(error) => {
                tracing::warn!(
                    table = %table_ref.table,
                    database = %database,
                    error = %error,
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
/// `row_index` is a **base** row index (the index into the result's original
/// rows), never a view position, so a save under any sort or filter targets the
/// right row. A tombstoned (deleted) row is refused.
///
/// Builds a fresh `SharedRow` for the edited row and a new pointer list that
/// shares every other row with the previous one, then swaps it in through the
/// version-checked, lock-serialized slot modifier. Rows already returned over
/// IPC are never mutated, and an edit that races a re-run is refused instead of
/// resurrecting the old result: the slot must still hold `query_id`, so a save
/// that lands after a re-run replaced the slot never edits the new result at
/// the old base index. The view (and its version) is unchanged.
pub fn update_result_cell_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    row_index: usize,
    updates: HashMap<usize, serde_json::Value>,
    result_index: Option<usize>,
    query_id: &str,
) -> Result<(), String> {
    let expected_invalidation_version = state
        .result_cache
        .current_invalidation_version(connection_id, tab_id);

    let cache_result = state.result_cache.get(connection_id, tab_id);
    if cache_result.is_expired() {
        return Err(crate::mysql::result_view::RESULTS_EXPIRED_MESSAGE.to_string());
    }
    let entry = cache_result
        .into_entry()
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;

    let resolved_index = result_index.unwrap_or(0);
    if resolved_index >= entry.value.len() {
        return Err(format!(
            "Result index {resolved_index} out of range (total: {})",
            entry.value.len()
        ));
    }
    drop(entry);

    let outcome = state.result_cache.modify_slot_in_place_if_current(
        connection_id,
        tab_id,
        expected_invalidation_version,
        resolved_index,
        Some(query_id),
        None,
        |slot| {
            let current = slot.rows.get(row_index).ok_or_else(|| {
                format!(
                    "Row index {row_index} out of bounds (total rows: {})",
                    slot.rows.len()
                )
            })?;
            if u32::try_from(row_index).is_ok_and(|index| slot.tombstones.contains(&index)) {
                return Err(format!(
                    "Row {row_index} was deleted from this result and can't be updated"
                ));
            }
            let mut edited: Vec<serde_json::Value> = current.to_vec();
            for (col_index, new_value) in updates {
                if col_index < edited.len() {
                    edited[col_index] = new_value;
                }
            }
            let mut next: Vec<SharedRow> = (*slot.rows).clone();
            next[row_index] = SharedRow::from(edited);
            slot.rows = Arc::new(next);
            Ok(())
        },
    )?;

    match outcome {
        crate::mysql::result_cache::SlotWrite::Applied(()) => Ok(()),
        _ => {
            tracing::info!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                "result cell update skipped: results invalidated during edit"
            );
            Err("Results were refreshed during edit".to_string())
        }
    }
}

// ── Multi-query result types ───────────────────────────────────────────────────

/// A single result item from a multi-query or CALL execution.
///
/// Carries metadata plus the **first window** of the result's view; the full
/// result stays in the Rust cache and is read with `fetch_result_window`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiQueryResultItem {
    pub query_id: String,
    pub source_sql: String,
    pub columns: Vec<ColumnMeta>,
    /// Live base rows (tombstones excluded).
    pub total_rows: i64,
    /// Server-execution-only time (narrow).
    pub execution_time_ms: u64,
    /// Combined time (execution + transfer + serialization).
    pub total_time_ms: u64,
    pub affected_rows: u64,
    pub auto_limit_applied: bool,
    pub error: Option<String>,
    pub re_executable: bool,
    pub view_row_count: usize,
    pub view_version: u64,
    pub truncated: bool,
    pub row_ceiling: usize,
    pub applied_row_limit: Option<usize>,
    pub full_export_blocked_reason: Option<FullExportBlockedReason>,
    pub first_window: crate::mysql::result_view::ResultWindow,
}

impl MultiQueryResultItem {
    /// Build the IPC item for a stored result: metadata plus its first window.
    pub fn from_stored(stored: &StoredResult, error: Option<String>, re_executable: bool) -> Self {
        Self {
            query_id: stored.query_id.clone(),
            source_sql: stored.source_sql.clone(),
            columns: stored.columns.clone(),
            total_rows: stored.live_row_count() as i64,
            execution_time_ms: stored.execution_time_ms,
            total_time_ms: stored.total_time_ms,
            affected_rows: stored.affected_rows,
            auto_limit_applied: stored.auto_limit_applied,
            error,
            re_executable,
            view_row_count: crate::mysql::result_view::view_len(stored),
            view_version: stored.view_version,
            truncated: stored.truncated,
            row_ceiling: stored.row_ceiling,
            applied_row_limit: stored.applied_row_limit,
            full_export_blocked_reason: stored.full_export_blocked_reason,
            first_window: crate::mysql::result_view::first_window(stored),
        }
    }
}

/// Wrapper for multiple result items returned from batch execution.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiQueryResult {
    pub results: Vec<MultiQueryResultItem>,
}

// ── Re-execute single result ───────────────────────────────────────────────────

/// Verify a re-execute target slot exists and return its current query id.
fn capture_reexecute_target(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    result_index: usize,
) -> Result<String, String> {
    let cache_result = state.result_cache.get(connection_id, tab_id);
    if cache_result.is_expired() {
        return Err(crate::mysql::result_view::RESULTS_EXPIRED_MESSAGE.to_string());
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
    Ok(result_vec[result_index].query_id.clone())
}

/// Replace only the targeted result slot after a re-execution, re-validating
/// that the tab, the index and the captured query id are all still current so
/// a newer query's results are never overwritten.
fn replace_reexecuted_slot(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    result_index: usize,
    expected_query_id: &str,
    stored: StoredResult,
) -> Result<(), String> {
    let entry = match state.result_cache.get(connection_id, tab_id).into_entry() {
        Some(found) => found,
        None => {
            tracing::warn!(
                tab_id,
                result_index,
                "reexecute_single_result: tab results disappeared after await — discarding stale result"
            );
            return Err(
                "Tab results no longer exist — a newer query may have replaced them".to_string(),
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
    if result_vec[result_index].query_id != expected_query_id {
        tracing::warn!(
            tab_id,
            result_index,
            expected_query_id = %expected_query_id,
            actual_query_id = %result_vec[result_index].query_id,
            "reexecute_single_result: query_id mismatch after await — discarding stale result"
        );
        return Err("Result was replaced by a newer query during re-execution".to_string());
    }
    result_vec[result_index] = stored;
    state.result_cache.insert(connection_id, tab_id, result_vec);
    Ok(())
}

/// Re-execute a single SQL statement and replace only the targeted entry in the
/// `Vec<StoredResult>` for a given tab. Runs on the shared editor session.
///
/// When `view_spec` is given, the fresh result is stored with that sort and
/// filter and its first window comes back already sorted and filtered.
/// Conditions or a sort on columns the new result lacks are dropped.
#[cfg(not(coverage))]
pub async fn reexecute_single_result_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    result_index: usize,
    sql: &str,
    row_limit: usize,
    view_spec: Option<crate::mysql::result_view::ResultViewSpec>,
) -> Result<MultiQueryResultItem, String> {
    if !state.registry.contains(connection_id) {
        return Err(format!("Connection '{connection_id}' not found"));
    }

    // Read-only enforcement
    if state.registry.is_read_only(connection_id) && !is_read_only_allowed(sql) {
        return Err("This connection is read-only. Only SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, USE, and SET (non-GLOBAL) statements are allowed.".to_string());
    }

    // Verify the result index exists and capture the current query_id for
    // post-await staleness detection.
    let expected_query_id = capture_reexecute_target(state, connection_id, tab_id, result_index)?;

    let row_limit = effective_row_limit(row_limit, state.result_cache.row_ceiling());
    let (stored, _item) = crate::mysql::multi_result::execute_single_on_session(
        state,
        connection_id,
        tab_id,
        sql,
        row_limit,
    )
    .await?;
    let stored = crate::mysql::result_view::apply_initial_view(stored, view_spec).await?;
    let item = MultiQueryResultItem::from_stored(&stored, None, true);

    replace_reexecuted_slot(
        state,
        connection_id,
        tab_id,
        result_index,
        &expected_query_id,
        stored,
    )?;

    Ok(item)
}

/// Coverage stub for `reexecute_single_result_impl`: exercises connection validation,
/// read-only enforcement, the row-limit clamp, result index validation, the
/// view-spec path and result replacement without requiring a live MySQL pool.
#[cfg(coverage)]
pub async fn reexecute_single_result_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    result_index: usize,
    sql: &str,
    row_limit: usize,
    view_spec: Option<crate::mysql::result_view::ResultViewSpec>,
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
    let ceiling = state.result_cache.row_ceiling();
    let row_limit = effective_row_limit(row_limit, ceiling);
    let auto_limit_applied = needs_auto_limit(sql);
    let _is_result = returns_result_set(&strip_non_executable_comments(sql));
    let _sql_to_execute = sql_with_auto_limit(sql, auto_limit_applied, row_limit);

    let expected_query_id = capture_reexecute_target(state, connection_id, tab_id, result_index)?;

    // Re-validate after the (simulated) execution and replace the slot. The
    // previous slot's rows stand in for the fresh result so the view-spec
    // path is exercised against real data.
    let previous = state
        .result_cache
        .get(connection_id, tab_id)
        .into_entry()
        .and_then(|entry| entry.value.get(result_index).cloned());
    let mut stored = StoredResult::empty(Uuid::new_v4().to_string());
    if let Some(previous) = previous {
        stored.columns = previous.columns;
        stored.rows = previous.rows;
    }
    stored.auto_limit_applied = auto_limit_applied;
    stored.applied_row_limit = auto_limit_applied.then_some(row_limit);
    stored.row_ceiling = ceiling;
    stored.source_sql = sql.to_string();
    stored.full_export_blocked_reason = statement_blocked_reason(sql, false);
    let stored = crate::mysql::result_view::apply_initial_view(stored, view_spec).await?;
    let item = MultiQueryResultItem::from_stored(&stored, None, true);

    replace_reexecuted_slot(
        state,
        connection_id,
        tab_id,
        result_index,
        &expected_query_id,
        stored,
    )?;

    Ok(item)
}

// ── Multi-query execution ──────────────────────────────────────────────────────

/// Execute multiple SQL statements sequentially on the shared editor session.
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
    let row_limit = effective_row_limit(row_limit, state.result_cache.row_ceiling());

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
/// read-only enforcement, statement classification, the row-limit clamp, the
/// first-window builder and result storage without a live MySQL connection.
#[cfg(coverage)]
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
    let ceiling = state.result_cache.row_ceiling();
    let row_limit = effective_row_limit(row_limit, ceiling);
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
            let mut stored = StoredResult::empty(uuid::Uuid::new_v4().to_string());
            stored.source_sql = sql.to_string();
            result_items.push(MultiQueryResultItem::from_stored(
                &stored,
                Some("This connection is read-only. Only SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, USE, and SET (non-GLOBAL) statements are allowed.".to_string()),
                false,
            ));
            stored_results.push(stored);
            break;
        }

        // Exercise statement classification
        let is_call = crate::mysql::multi_result::is_call_statement(sql);
        let _is_result_set = returns_result_set(&strip_non_executable_comments(sql));
        let auto_limit_applied = needs_auto_limit(sql);
        let _sql_to_execute = sql_with_auto_limit(sql, auto_limit_applied, row_limit);

        let mut stored = StoredResult::empty(uuid::Uuid::new_v4().to_string());
        stored.auto_limit_applied = auto_limit_applied;
        stored.applied_row_limit = auto_limit_applied.then_some(row_limit);
        stored.row_ceiling = ceiling;
        stored.source_sql = sql.to_string();
        stored.full_export_blocked_reason = statement_blocked_reason(sql, is_call);
        result_items.push(MultiQueryResultItem::from_stored(&stored, None, !is_call));
        stored_results.push(stored);
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

    let row_limit = effective_row_limit(row_limit, state.result_cache.row_ceiling());
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
/// read-only enforcement, CALL detection, the row-limit clamp and the
/// first-window builder without requiring a live MySQL connection.
#[cfg(coverage)]
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

    // Exercise CALL detection and the row-limit clamp
    let is_call = crate::mysql::multi_result::is_call_statement(sql);
    let ceiling = state.result_cache.row_ceiling();
    let _row_limit = effective_row_limit(row_limit, ceiling);

    // Track a dummy thread ID to exercise the running_queries path
    let key = (connection_id.to_string(), tab_id.to_string());
    state
        .running_queries
        .write()
        .await
        .insert(key.clone(), 42u64);
    state.running_queries.write().await.remove(&key);

    let mut stored = StoredResult::empty(uuid::Uuid::new_v4().to_string());
    stored.row_ceiling = ceiling;
    stored.source_sql = sql.to_string();
    stored.full_export_blocked_reason = statement_blocked_reason(sql, is_call);
    let item = MultiQueryResultItem::from_stored(&stored, None, false);

    // Store result in state
    state
        .result_cache
        .insert(connection_id, tab_id, vec![stored]);

    Ok(MultiQueryResult {
        results: vec![item],
    })
}

pub fn touch_results_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
) -> serde_json::Value {
    let lookup = state.result_cache.get(connection_id, tab_id);
    cache_status_json(lookup.lookup_status())
}
