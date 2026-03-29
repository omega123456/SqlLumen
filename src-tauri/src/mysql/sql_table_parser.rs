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
    let mut i = 0;

    while i < len {
        // Skip string literals (single/double quotes)
        if chars[i] == '\'' || chars[i] == '"' {
            i = skip_quoted(&chars, i);
            continue;
        }

        // Skip backtick-quoted identifiers (not relevant at this scan level unless
        // they happen to contain keywords; we handle them when extracting identifiers)
        if chars[i] == '`' {
            i = skip_backtick(&chars, i);
            continue;
        }

        // Track parenthesized groups — skip them entirely at top level
        // (subqueries, function calls, etc.)
        if chars[i] == '(' {
            i = skip_parenthesized(&chars, i);
            continue;
        }

        // Look for keywords at word boundary
        if is_word_boundary_before(&chars, i) {
            // Check for FROM keyword
            if matches_keyword_at(&chars, i, "FROM") {
                i += 4; // skip "FROM"
                i = skip_whitespace(&chars, i);
                // Parse comma-separated table list
                i = parse_table_list(&chars, i, &mut tables);
                continue;
            }

            // Check for JOIN keywords
            // Patterns: JOIN, INNER JOIN, LEFT JOIN, LEFT OUTER JOIN, RIGHT JOIN,
            // RIGHT OUTER JOIN, CROSS JOIN, NATURAL JOIN, STRAIGHT_JOIN
            if let Some(after_join) = match_join_keyword(&chars, i) {
                i = after_join;
                i = skip_whitespace(&chars, i);
                // Parse single table reference after JOIN
                i = parse_single_table_ref(&chars, i, &mut tables);
                continue;
            }

            // Stop-keywords: WHERE, GROUP, HAVING, ORDER, LIMIT, UNION, EXCEPT,
            // INTERSECT, PROCEDURE, INTO, FOR, LOCK
            if matches_any_stop_keyword(&chars, i) {
                break;
            }
        }

        i += 1;
    }

    // Deduplicate
    deduplicate(&mut tables);

    tables
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/// Get the first keyword (uppercased) from a trimmed SQL string.
fn first_keyword_upper(sql: &str) -> String {
    sql.chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect::<String>()
        .to_uppercase()
}

/// Check if position `i` is at a word boundary (start of string, or previous char is not alphanumeric/underscore).
fn is_word_boundary_before(chars: &[char], i: usize) -> bool {
    if i == 0 {
        return true;
    }
    let prev = chars[i - 1];
    !(prev.is_alphanumeric() || prev == '_')
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
fn matches_keyword_at(chars: &[char], i: usize, keyword: &str) -> bool {
    let kw_len = keyword.len();
    if i + kw_len > chars.len() {
        return false;
    }

    // Compare characters case-insensitively
    let kw_chars: Vec<char> = keyword.chars().collect();
    for j in 0..kw_len {
        if chars[i + j].to_ascii_uppercase() != kw_chars[j].to_ascii_uppercase() {
            return false;
        }
    }

    // Check word boundaries
    is_word_boundary_before(chars, i) && is_word_boundary_after(chars, i + kw_len)
}

/// Try to match a JOIN keyword at position `i`. Returns the position after the keyword if matched.
/// Handles: JOIN, INNER JOIN, LEFT [OUTER] JOIN, RIGHT [OUTER] JOIN, CROSS JOIN,
/// NATURAL [LEFT|RIGHT] [OUTER] JOIN, STRAIGHT_JOIN
fn match_join_keyword(chars: &[char], i: usize) -> Option<usize> {
    // STRAIGHT_JOIN
    if matches_keyword_at(chars, i, "STRAIGHT_JOIN") {
        return Some(i + 13);
    }

    // NATURAL [LEFT|RIGHT] [OUTER] JOIN
    if matches_keyword_at(chars, i, "NATURAL") {
        let mut pos = i + 7;
        pos = skip_whitespace(chars, pos);
        // Optional LEFT/RIGHT
        if matches_keyword_at(chars, pos, "LEFT") {
            pos += 4;
            pos = skip_whitespace(chars, pos);
        } else if matches_keyword_at(chars, pos, "RIGHT") {
            pos += 5;
            pos = skip_whitespace(chars, pos);
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
    if matches_keyword_at(chars, i, "INNER") {
        let mut pos = i + 5;
        pos = skip_whitespace(chars, pos);
        if matches_keyword_at(chars, pos, "JOIN") {
            return Some(pos + 4);
        }
        return None;
    }

    // LEFT [OUTER] JOIN
    if matches_keyword_at(chars, i, "LEFT") {
        let mut pos = i + 4;
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
    if matches_keyword_at(chars, i, "RIGHT") {
        let mut pos = i + 5;
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
    if matches_keyword_at(chars, i, "CROSS") {
        let mut pos = i + 5;
        pos = skip_whitespace(chars, pos);
        if matches_keyword_at(chars, pos, "JOIN") {
            return Some(pos + 4);
        }
        return None;
    }

    // Bare JOIN
    if matches_keyword_at(chars, i, "JOIN") {
        return Some(i + 4);
    }

    None
}

/// Check if position matches any of the stop keywords that end the FROM/JOIN clause scanning.
fn matches_any_stop_keyword(chars: &[char], i: usize) -> bool {
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
        if matches_keyword_at(chars, i, kw) {
            return true;
        }
    }
    false
}

/// Skip whitespace characters starting at position `i`, return new position.
fn skip_whitespace(chars: &[char], mut i: usize) -> usize {
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    i
}

/// Skip a quoted string (single or double quote) starting at position `i`.
/// Returns the position after the closing quote.
fn skip_quoted(chars: &[char], i: usize) -> usize {
    let quote = chars[i];
    let mut pos = i + 1;
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
fn skip_backtick(chars: &[char], i: usize) -> usize {
    let mut pos = i + 1;
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
fn skip_parenthesized(chars: &[char], i: usize) -> usize {
    let mut depth = 1;
    let mut pos = i + 1;
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
fn parse_table_list(chars: &[char], mut i: usize, tables: &mut Vec<TableReference>) -> usize {
    loop {
        i = skip_whitespace(chars, i);

        if i >= chars.len() {
            break;
        }

        // Check for parenthesized expression (could be subquery or join group)
        if chars[i] == '(' {
            // Look ahead: is this a subquery?
            let inner_start = skip_whitespace(chars, i + 1);
            if is_subquery_start(chars, inner_start) {
                // Skip the entire parenthesized subquery
                i = skip_parenthesized(chars, i);
                // Skip optional alias after subquery
                i = skip_alias(chars, i);
                // Check for comma to continue
                i = skip_whitespace(chars, i);
                if i < chars.len() && chars[i] == ',' {
                    i += 1;
                    continue;
                }
                break;
            } else {
                // Parenthesized join group — skip it (handle gracefully)
                i = skip_parenthesized(chars, i);
                i = skip_alias(chars, i);
                i = skip_whitespace(chars, i);
                if i < chars.len() && chars[i] == ',' {
                    i += 1;
                    continue;
                }
                break;
            }
        }

        // Check if we've hit a stop keyword or JOIN before reading a table
        if is_word_boundary_before(chars, i) {
            if matches_any_stop_keyword(chars, i) || match_join_keyword(chars, i).is_some() {
                break;
            }
        }

        // Parse a single table reference
        let before = i;
        i = parse_single_table_ref(chars, i, tables);
        if i == before {
            // No progress — bail
            break;
        }

        i = skip_whitespace(chars, i);

        // Check for comma to continue the list
        if i < chars.len() && chars[i] == ',' {
            i += 1;
            continue;
        }

        // No comma — end of table list
        break;
    }

    i
}

/// Check if position looks like the start of a subquery (SELECT keyword).
fn is_subquery_start(chars: &[char], i: usize) -> bool {
    matches_keyword_at(chars, i, "SELECT")
}

/// Parse a single table reference (possibly schema-qualified, possibly backtick-quoted).
/// Adds the table to `tables` if found. Skips any alias.
/// Returns the new position after the table ref and alias.
fn parse_single_table_ref(chars: &[char], mut i: usize, tables: &mut Vec<TableReference>) -> usize {
    i = skip_whitespace(chars, i);

    if i >= chars.len() {
        return i;
    }

    // Check for parenthesized expression (subquery in JOIN position)
    if chars[i] == '(' {
        let inner_start = skip_whitespace(chars, i + 1);
        if is_subquery_start(chars, inner_start) {
            // Skip subquery — don't extract table
            i = skip_parenthesized(chars, i);
            i = skip_alias(chars, i);
            return i;
        }
        // Parenthesized join group — skip gracefully
        i = skip_parenthesized(chars, i);
        i = skip_alias(chars, i);
        return i;
    }

    // Read the first identifier (could be database or table)
    let (first_ident, after_first) = read_identifier(chars, i);
    if first_ident.is_none() {
        return i;
    }
    let first_ident = first_ident.unwrap();
    i = after_first;

    // Check for dot (schema.table)
    if i < chars.len() && chars[i] == '.' {
        i += 1; // skip dot
        let (second_ident, after_second) = read_identifier(chars, i);
        if let Some(table_name) = second_ident {
            tables.push(TableReference {
                database: Some(first_ident),
                table: table_name,
            });
            i = after_second;
        } else {
            // Dot but no table name — treat first_ident as table
            tables.push(TableReference {
                database: None,
                table: first_ident,
            });
        }
    } else {
        // No dot — first_ident is the table
        tables.push(TableReference {
            database: None,
            table: first_ident,
        });
    }

    // Skip alias
    i = skip_alias(chars, i);

    i
}

/// Read an identifier (plain or backtick-quoted) at position `i`.
/// Returns (Some(name), position_after) or (None, i) if no identifier found.
fn read_identifier(chars: &[char], i: usize) -> (Option<String>, usize) {
    if i >= chars.len() {
        return (None, i);
    }

    if chars[i] == '`' {
        // Backtick-quoted identifier
        let mut pos = i + 1;
        let mut name = String::new();
        while pos < chars.len() {
            if chars[pos] == '`' {
                // Check for doubled backtick (escaped)
                if pos + 1 < chars.len() && chars[pos + 1] == '`' {
                    name.push('`');
                    pos += 2;
                    continue;
                }
                // Empty backtick identifier is not a valid table name
                if name.is_empty() {
                    return (None, pos + 1);
                }
                return (Some(name), pos + 1);
            }
            name.push(chars[pos]);
            pos += 1;
        }
        // Unterminated backtick — return what we have
        if name.is_empty() {
            (None, pos)
        } else {
            (Some(name), pos)
        }
    } else if chars[i].is_alphabetic() || chars[i] == '_' {
        // Plain identifier
        let mut pos = i;
        let mut name = String::new();
        while pos < chars.len()
            && (chars[pos].is_alphanumeric() || chars[pos] == '_' || chars[pos] == '$')
        {
            name.push(chars[pos]);
            pos += 1;
        }
        if name.is_empty() {
            (None, pos)
        } else {
            (Some(name), pos)
        }
    } else {
        (None, i)
    }
}

/// Skip an optional alias (AS alias_name or just alias_name).
/// Must be careful not to consume JOIN keywords or other SQL keywords as aliases.
fn skip_alias(chars: &[char], mut i: usize) -> usize {
    let saved = i;
    i = skip_whitespace(chars, i);

    if i >= chars.len() {
        return i;
    }

    // Check for ON keyword (after JOIN — not an alias)
    if is_word_boundary_before(chars, i) && matches_keyword_at(chars, i, "ON") {
        return saved;
    }

    // Check for AS keyword
    if is_word_boundary_before(chars, i) && matches_keyword_at(chars, i, "AS") {
        i += 2;
        i = skip_whitespace(chars, i);
        // Read alias name
        let (_, after_alias) = read_identifier(chars, i);
        return after_alias;
    }

    // Check for implicit alias (next token is an identifier that is NOT a keyword)
    if i < chars.len() && (chars[i] == '`' || chars[i].is_alphabetic() || chars[i] == '_') {
        // Peek at the identifier
        let (maybe_alias, after_alias) = read_identifier(chars, i);
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
    tables.retain(|t| {
        let key = (t.database.clone(), t.table.clone());
        if seen.contains(&key) {
            false
        } else {
            seen.push(key);
            true
        }
    });
}
