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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableReference {
    pub database: Option<String>,
    pub table: String,
}

pub fn extract_tables(sql: &str) -> Vec<TableReference> {
    let stripped = strip_non_executable_comments(sql);
    let trimmed = stripped.trim();

    if trimmed.is_empty() {
        return vec![];
    }

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
    if character == '`' {
        return ScanStep::Continue(skip_backtick(chars, position));
    }
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
