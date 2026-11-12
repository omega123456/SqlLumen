//! Extracts source table names from SQL SELECT statements by parsing
//! `FROM` and `JOIN` clauses. Pure function — no database access required.

use serde::{Deserialize, Serialize};

use crate::mysql::query_executor::strip_non_executable_comments;

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
    let len = chars.len();

    let mut tables: Vec<TableReference> = Vec::new();
    let mut position = 0;

    while position < len {
        // Skip string literals (single/double quotes)
        if chars[position] == '\'' || chars[position] == '"' {
            position = skip_quoted(&chars, position);
            continue;
        }

        // Skip backtick-quoted identifiers (not relevant at this scan level unless
        // they happen to contain keywords; we handle them when extracting identifiers)
        if chars[position] == '`' {
            position = skip_backtick(&chars, position);
            continue;
        }

        // Track parenthesized groups — skip them entirely at top level
        // (subqueries, function calls, etc.)
        if chars[position] == '(' {
            position = skip_parenthesized(&chars, position);
            continue;
        }

        // Look for keywords at word boundary
        if is_word_boundary_before(&chars, position) {
            // Check for FROM keyword
            if matches_keyword_at(&chars, position, "FROM") {
                position += 4; // skip "FROM"
                position = skip_whitespace(&chars, position);
                // Parse comma-separated table list
                position = parse_table_list(&chars, position, &mut tables);
                continue;
            }

            // Check for JOIN keywords
            // Patterns: JOIN, INNER JOIN, LEFT JOIN, LEFT OUTER JOIN, RIGHT JOIN,
            // RIGHT OUTER JOIN, CROSS JOIN, NATURAL JOIN, STRAIGHT_JOIN
            if let Some(after_join) = match_join_keyword(&chars, position) {
                position = after_join;
                position = skip_whitespace(&chars, position);
                // Parse single table reference after JOIN
                position = parse_single_table_ref(&chars, position, &mut tables);
                continue;
            }

            // Stop-keywords: WHERE, GROUP, HAVING, ORDER, LIMIT, UNION, EXCEPT,
            // INTERSECT, PROCEDURE, INTO, FOR, LOCK
            if matches_any_stop_keyword(&chars, position) {
                break;
            }
        }

        position += 1;
    }

    // Deduplicate
    deduplicate(&mut tables);

    tables
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/// Get the first keyword (uppercased) from a trimmed SQL string.
fn first_keyword_upper(sql: &str) -> String {
    sql.chars()
        .take_while(|character| character.is_alphanumeric() || *character == '_')
        .collect::<String>()
        .to_uppercase()
}

/// Check if position `i` is at a word boundary (start of string, or previous char is not alphanumeric/underscore).
fn is_word_boundary_before(chars: &[char], position: usize) -> bool {
    if position == 0 {
        return true;
    }
    let previous = chars[position - 1];
    !(previous.is_alphanumeric() || previous == '_')
}

/// Check if position after keyword end is a word boundary.
fn is_word_boundary_after(chars: &[char], end: usize) -> bool {
    if end >= chars.len() {
        return true;
    }
    let next = chars[end];
    !(next.is_alphanumeric() || next == '_')
}

/// Check if a keyword matches at position `i` (case-insensitive), with word boundaries.
fn matches_keyword_at(chars: &[char], position: usize, keyword: &str) -> bool {
    let kw_len = keyword.len();
    if position + kw_len > chars.len() {
        return false;
    }

    // Compare characters case-insensitively
    let kw_chars: Vec<char> = keyword.chars().collect();
    for offset in 0..kw_len {
        if !chars[position + offset].eq_ignore_ascii_case(&kw_chars[offset]) {
            return false;
        }
    }

    // Check word boundaries
    is_word_boundary_before(chars, position) && is_word_boundary_after(chars, position + kw_len)
}

/// Try to match a JOIN keyword at position `i`. Returns the position after the keyword if matched.
/// Handles: JOIN, INNER JOIN, LEFT [OUTER] JOIN, RIGHT [OUTER] JOIN, CROSS JOIN,
/// NATURAL [LEFT|RIGHT] [OUTER] JOIN, STRAIGHT_JOIN
fn match_join_keyword(chars: &[char], position: usize) -> Option<usize> {
    // STRAIGHT_JOIN
    if matches_keyword_at(chars, position, "STRAIGHT_JOIN") {
        return Some(position + 13);
    }

    // NATURAL [LEFT|RIGHT] [OUTER] JOIN
    if matches_keyword_at(chars, position, "NATURAL") {
        let mut pos = position + 7;
        pos = skip_whitespace(chars, pos);
        let side_keyword = ["LEFT", "RIGHT"]
            .into_iter()
            .find(|keyword| matches_keyword_at(chars, pos, keyword));
        if let Some(keyword) = side_keyword {
            pos = skip_whitespace(chars, pos + keyword.len());
        }
        // Optional OUTER
        if matches_keyword_at(chars, pos, "OUTER") {
            pos += 5;
            pos = skip_whitespace(chars, pos);
        }
        if matches_keyword_at(chars, pos, "JOIN") {
            return Some(pos + 4);
        }
        return None;
    }

    // INNER JOIN
    if matches_keyword_at(chars, position, "INNER") {
        let mut pos = position + 5;
        pos = skip_whitespace(chars, pos);
        if matches_keyword_at(chars, pos, "JOIN") {
            return Some(pos + 4);
        }
        return None;
    }

    // LEFT [OUTER] JOIN
    if matches_keyword_at(chars, position, "LEFT") {
        let mut pos = position + 4;
        pos = skip_whitespace(chars, pos);
        if matches_keyword_at(chars, pos, "OUTER") {
            pos += 5;
            pos = skip_whitespace(chars, pos);
        }
        if matches_keyword_at(chars, pos, "JOIN") {
            return Some(pos + 4);
        }
        return None;
    }

    // RIGHT [OUTER] JOIN
    if matches_keyword_at(chars, position, "RIGHT") {
        let mut pos = position + 5;
        pos = skip_whitespace(chars, pos);
        if matches_keyword_at(chars, pos, "OUTER") {
            pos += 5;
            pos = skip_whitespace(chars, pos);
        }
        if matches_keyword_at(chars, pos, "JOIN") {
            return Some(pos + 4);
        }
        return None;
    }

    // CROSS JOIN
    if matches_keyword_at(chars, position, "CROSS") {
        let mut pos = position + 5;
        pos = skip_whitespace(chars, pos);
        if matches_keyword_at(chars, pos, "JOIN") {
            return Some(pos + 4);
        }
        return None;
    }

    // Bare JOIN
    if matches_keyword_at(chars, position, "JOIN") {
        return Some(position + 4);
    }

    None
}

/// Check if position matches any of the stop keywords that end the FROM/JOIN clause scanning.
fn matches_any_stop_keyword(chars: &[char], position: usize) -> bool {
    const STOP_KEYWORDS: &[&str] = &[
        "WHERE",
        "GROUP",
        "HAVING",
        "ORDER",
        "LIMIT",
        "UNION",
        "EXCEPT",
        "INTERSECT",
        "PROCEDURE",
        "INTO",
        "FOR",
        "LOCK",
        "WINDOW",
    ];

    for kw in STOP_KEYWORDS {
        if matches_keyword_at(chars, position, kw) {
            return true;
        }
    }
    false
}

/// Skip whitespace characters starting at position `i`, return new position.
fn skip_whitespace(chars: &[char], mut position: usize) -> usize {
    while position < chars.len() && chars[position].is_whitespace() {
        position += 1;
    }
    position
}

/// Skip a quoted string (single or double quote) starting at position `i`.
/// Returns the position after the closing quote.
fn skip_quoted(chars: &[char], position: usize) -> usize {
    let quote = chars[position];
    let mut pos = position + 1;
    while pos < chars.len() {
        if chars[pos] == '\\' && pos + 1 < chars.len() {
            pos += 2;
            continue;
        }
        if chars[pos] == quote {
            return pos + 1;
        }
        pos += 1;
    }
    pos
}

/// Skip a backtick-quoted identifier starting at position `i`.
/// Returns the position after the closing backtick.
fn skip_backtick(chars: &[char], position: usize) -> usize {
    let mut pos = position + 1;
    while pos < chars.len() {
        if chars[pos] == '`' {
            // Check for escaped backtick (doubled)
            if pos + 1 < chars.len() && chars[pos + 1] == '`' {
                pos += 2;
                continue;
            }
            return pos + 1;
        }
        pos += 1;
    }
    pos
}

/// Skip a parenthesized expression starting at position `i` (which must be '(').
/// Handles nested parentheses and string/backtick literals within.
/// Returns the position after the closing ')'.
fn skip_parenthesized(chars: &[char], position: usize) -> usize {
    let mut depth = 1;
    let mut pos = position + 1;
    while pos < chars.len() && depth > 0 {
        match chars[pos] {
            '\'' | '"' => {
                pos = skip_quoted(chars, pos);
                continue;
            }
            '`' => {
                pos = skip_backtick(chars, pos);
                continue;
            }
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
        pos += 1;
    }
    pos
}

/// Parse a comma-separated list of table references after FROM.
/// Stops when encountering a JOIN keyword, a stop keyword, or end of input.
fn parse_table_list(
    chars: &[char],
    mut position: usize,
    tables: &mut Vec<TableReference>,
) -> usize {
    loop {
        position = skip_whitespace(chars, position);

        if position >= chars.len() {
            break;
        }

        if chars[position] == '(' {
            position = skip_parenthesized(chars, position);
            position = skip_alias(chars, position);
            position = skip_whitespace(chars, position);
            if position < chars.len() && chars[position] == ',' {
                position += 1;
                continue;
            }
            break;
        }

        // Check if we've hit a stop keyword or JOIN before reading a table
        if is_word_boundary_before(chars, position)
            && (matches_any_stop_keyword(chars, position)
                || match_join_keyword(chars, position).is_some())
        {
            break;
        }

        // Parse a single table reference
        let before = position;
        position = parse_single_table_ref(chars, position, tables);
        if position == before {
            // No progress — bail
            break;
        }

        position = skip_whitespace(chars, position);

        // Check for comma to continue the list
        if position < chars.len() && chars[position] == ',' {
            position += 1;
            continue;
        }

        // No comma — end of table list
        break;
    }

    position
}

/// Check if position looks like the start of a subquery (SELECT keyword).
fn is_subquery_start(chars: &[char], position: usize) -> bool {
    matches_keyword_at(chars, position, "SELECT")
}

/// Parse a single table reference (possibly schema-qualified, possibly backtick-quoted).
/// Adds the table to `tables` if found. Skips any alias.
/// Returns the new position after the table ref and alias.
fn parse_single_table_ref(
    chars: &[char],
    mut position: usize,
    tables: &mut Vec<TableReference>,
) -> usize {
    position = skip_whitespace(chars, position);

    if position >= chars.len() {
        return position;
    }

    // Check for parenthesized expression (subquery in JOIN position)
    if chars[position] == '(' {
        let inner_start = skip_whitespace(chars, position + 1);
        if is_subquery_start(chars, inner_start) {
            // Skip subquery — don't extract table
            position = skip_parenthesized(chars, position);
            position = skip_alias(chars, position);
            return position;
        }
        // Parenthesized join group — skip gracefully
        position = skip_parenthesized(chars, position);
        position = skip_alias(chars, position);
        return position;
    }

    // Read the first identifier (could be database or table)
    let (first_ident, after_first) = read_identifier(chars, position);
    if first_ident.is_none() {
        return position;
    }
    let first_ident = first_ident.unwrap();
    position = after_first;

    let has_schema_dot = position < chars.len() && chars[position] == '.';
    if !has_schema_dot {
        tables.push(TableReference {
            database: None,
            table: first_ident,
        });
        return skip_alias(chars, position);
    }

    position += 1;
    let (second_ident, after_second) = read_identifier(chars, position);
    let Some(table_name) = second_ident else {
        tables.push(TableReference {
            database: None,
            table: first_ident,
        });
        return skip_alias(chars, position);
    };
    tables.push(TableReference {
        database: Some(first_ident),
        table: table_name,
    });
    skip_alias(chars, after_second)
}

/// Read an identifier (plain or backtick-quoted) at position `i`.
/// Returns (Some(name), position_after) or (None, i) if no identifier found.
fn read_identifier(chars: &[char], position: usize) -> (Option<String>, usize) {
    if position >= chars.len() {
        return (None, position);
    }

    if chars[position] == '`' {
        return read_backtick_identifier(chars, position);
    }
    if chars[position].is_alphabetic() || chars[position] == '_' {
        return read_plain_identifier(chars, position);
    }
    (None, position)
}

fn read_backtick_identifier(chars: &[char], position: usize) -> (Option<String>, usize) {
    let mut pos = position + 1;
    let mut name = String::new();
    while pos < chars.len() {
        if chars[pos] != '`' {
            name.push(chars[pos]);
            pos += 1;
            continue;
        }
        let is_escaped_backtick = pos + 1 < chars.len() && chars[pos + 1] == '`';
        if !is_escaped_backtick {
            return (non_empty_name(name), pos + 1);
        }
        name.push('`');
        pos += 2;
    }
    (non_empty_name(name), pos)
}

fn read_plain_identifier(chars: &[char], position: usize) -> (Option<String>, usize) {
    let mut pos = position;
    let mut name = String::new();
    while pos < chars.len()
        && (chars[pos].is_alphanumeric() || chars[pos] == '_' || chars[pos] == '$')
    {
        name.push(chars[pos]);
        pos += 1;
    }
    (non_empty_name(name), pos)
}

fn non_empty_name(name: String) -> Option<String> {
    Some(name).filter(|name| !name.is_empty())
}

/// Skip an optional alias (AS alias_name or just alias_name).
/// Must be careful not to consume JOIN keywords or other SQL keywords as aliases.
fn skip_alias(chars: &[char], mut position: usize) -> usize {
    let saved = position;
    position = skip_whitespace(chars, position);

    if position >= chars.len() {
        return position;
    }

    // Check for ON keyword (after JOIN — not an alias)
    if is_word_boundary_before(chars, position) && matches_keyword_at(chars, position, "ON") {
        return saved;
    }

    // Check for AS keyword
    if is_word_boundary_before(chars, position) && matches_keyword_at(chars, position, "AS") {
        position += 2;
        position = skip_whitespace(chars, position);
        // Read alias name
        let (_, after_alias) = read_identifier(chars, position);
        return after_alias;
    }

    // Check for implicit alias (next token is an identifier that is NOT a keyword)
    if position < chars.len()
        && (chars[position] == '`' || chars[position].is_alphabetic() || chars[position] == '_')
    {
        // Peek at the identifier
        let (maybe_alias, after_alias) = read_identifier(chars, position);
        if let Some(alias) = maybe_alias {
            let upper = alias.to_uppercase();
            // If it's a keyword, don't consume it as an alias
            if is_sql_keyword(&upper) {
                return saved;
            }
            // If it looks like it could be a JOIN keyword prefix, be careful
            // It's an alias — consume it
            return after_alias;
        }
    }

    // Nothing to skip
    saved
}

/// Check if a word is a SQL keyword that should NOT be treated as an alias.
fn is_sql_keyword(word: &str) -> bool {
    matches!(
        word,
        "JOIN"
            | "INNER"
            | "LEFT"
            | "RIGHT"
            | "CROSS"
            | "NATURAL"
            | "STRAIGHT_JOIN"
            | "ON"
            | "WHERE"
            | "GROUP"
            | "HAVING"
            | "ORDER"
            | "LIMIT"
            | "UNION"
            | "EXCEPT"
            | "INTERSECT"
            | "INTO"
            | "FOR"
            | "LOCK"
            | "SET"
            | "VALUES"
            | "SELECT"
            | "FROM"
            | "OUTER"
            | "USING"
            | "WINDOW"
            | "PROCEDURE"
    )
}

/// Deduplicate table references in-place, preserving first occurrence order.
fn deduplicate(tables: &mut Vec<TableReference>) {
    let mut seen: Vec<(Option<String>, String)> = Vec::new();
    tables.retain(|table| {
        let key = (table.database.clone(), table.table.clone());
        if seen.contains(&key) {
            return false;
        }
        seen.push(key);
        true
    });
}
