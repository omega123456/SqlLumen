//! Extracts source table names from SQL SELECT statements by parsing
//! `FROM` and `JOIN` clauses. Pure function — no database access required.

use serde::{Deserialize, Serialize};

use crate::mysql::query_executor::strip_non_executable_comments;
use crate::mysql::sql_chars::{
    has_char_at, has_text_at_ignore_ascii_case, is_escape_before_char, is_identifier_char,
    is_identifier_char_at, is_identifier_or_dollar_char, is_identifier_start_char, is_past_end,
    is_string_quote_char, is_whitespace_at,
};

mod keyword_scan;
mod table_list;
use keyword_scan::*;
use table_list::*;

/// A table reference extracted from a SQL statement.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableReference {
    /// Schema qualifier if present (e.g., `mydb` in `mydb.users`).
    pub database: Option<String>,
    /// The table name.
    pub table: String,
}

/// Extract table references from a SQL SELECT statement.
///
/// Parses `FROM` and `JOIN` clauses to find direct table references.
/// Handles backtick-quoted identifiers, schema-qualified names, aliases,
/// and various JOIN types. Deduplicates results so a self-joined table
/// appears only once.
///
/// Returns an empty `Vec` for non-SELECT statements, empty strings, or
/// statements where no table references can be found.
pub fn extract_tables(sql: &str) -> Vec<TableReference> {
    let stripped = strip_non_executable_comments(sql);
    let trimmed = stripped.trim();

    if trimmed.is_empty() {
        return vec![];
    }

    // Only parse SELECT statements (case-insensitive)
    let first_keyword = first_keyword_upper(trimmed);
    if first_keyword != "SELECT" {
        return vec![];
    }

    let chars: Vec<char> = trimmed.chars().collect();
    let mut tables: Vec<TableReference> = Vec::new();
    let mut position = 0;
    while position < chars.len() {
        match next_scan_step(&chars, position, &mut tables) {
            ScanStep::Continue(next) => position = next,
            ScanStep::Stop => break,
        }
    }

    deduplicate(&mut tables);
    tables
}

enum ScanStep {
    Continue(usize),
    Stop,
}

const FROM_KEYWORD: &str = "FROM";

fn next_scan_step(chars: &[char], position: usize, tables: &mut Vec<TableReference>) -> ScanStep {
    let character = chars[position];
    if is_string_quote_char(character) {
        return ScanStep::Continue(skip_quoted(chars, position));
    }
    // Backtick identifiers only matter when extracting table names, so skip them here.
    if character == '`' {
        return ScanStep::Continue(skip_backtick(chars, position));
    }
    // Parenthesized groups (subqueries, function calls) are skipped at top level.
    if character == '(' {
        return ScanStep::Continue(skip_parenthesized(chars, position));
    }
    if !is_word_boundary_before(chars, position) {
        return ScanStep::Continue(position + 1);
    }
    if matches_keyword_at(chars, position, FROM_KEYWORD) {
        let list_start = skip_whitespace(chars, position + FROM_KEYWORD.len());
        return ScanStep::Continue(parse_table_list(chars, list_start, tables));
    }
    if let Some(after_join) = match_join_keyword(chars, position) {
        let table_start = skip_whitespace(chars, after_join);
        return ScanStep::Continue(parse_single_table_ref(chars, table_start, tables));
    }
    if matches_any_stop_keyword(chars, position) {
        return ScanStep::Stop;
    }
    ScanStep::Continue(position + 1)
}
