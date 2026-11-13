use regex::Regex;
use std::sync::OnceLock;

use super::super::types::FkInput;

const DEFAULT_REFERENTIAL_ACTION: &str = "RESTRICT";

/// Extract the table-level `COMMENT='...'` value from a `CREATE TABLE` DDL.
pub fn extract_table_comment(ddl: &str) -> Option<String> {
    static TABLE_COMMENT_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = TABLE_COMMENT_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\)\s*[^;]*COMMENT\s*=\s*'((?:[^'\\]|\\.)*)'")
            .expect("valid table comment regex")
    });
    re.captures(ddl).map(|captures| captures[1].to_string())
}

/// Extract `(column_name, comment)` pairs from inline column `COMMENT '...'`
/// clauses in a `CREATE TABLE` DDL.
pub fn extract_column_comments(ddl: &str) -> Vec<(String, String)> {
    static COL_COMMENT_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = COL_COMMENT_REGEX.get_or_init(|| {
        Regex::new(r"(?i)`([^`]+)`\s+\S+[^,\n]*COMMENT\s+'((?:[^'\\]|\\.)*)'")
            .expect("valid column comment regex")
    });
    re.captures_iter(ddl)
        .map(|captures| (captures[1].to_string(), captures[2].to_string()))
        .collect()
}

fn referential_action(captures: &regex::Captures<'_>, group: usize) -> String {
    captures
        .get(group)
        .map(|matched| matched.as_str().to_uppercase())
        .unwrap_or_else(|| DEFAULT_REFERENTIAL_ACTION.to_string())
}

/// Parse foreign key definitions from a `SHOW CREATE TABLE` result.
///
/// Looks for lines matching:
/// ```text
/// CONSTRAINT `fk_name` FOREIGN KEY (`col1`, `col2`) REFERENCES `ref_table` (`ref_col1`, `ref_col2`) ON DELETE CASCADE ON UPDATE NO ACTION
/// ```
pub fn parse_fks_from_ddl(db_name: &str, table_name: &str, ddl: &str) -> Vec<FkInput> {
    static FK_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = FK_REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)CONSTRAINT\s+`([^`]+)`\s+FOREIGN\s+KEY\s+\(([^)]+)\)\s+REFERENCES\s+(?:`([^`]+)`\.)?`([^`]+)`\s+\(([^)]+)\)(?:\s+ON\s+DELETE\s+(RESTRICT|CASCADE|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION))?(?:\s+ON\s+UPDATE\s+(RESTRICT|CASCADE|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION))?",
        )
        .expect("valid FK regex")
    });

    re.captures_iter(ddl)
        .map(|captures| FkInput {
            db_name: db_name.to_string(),
            table_name: table_name.to_string(),
            constraint_name: captures[1].to_string(),
            columns: parse_backtick_list(&captures[2]),
            ref_db_name: captures
                .get(3)
                .map(|matched| matched.as_str().to_string())
                .unwrap_or_else(|| db_name.to_string()),
            ref_table_name: captures[4].to_string(),
            ref_columns: parse_backtick_list(&captures[5]),
            on_delete: referential_action(&captures, 6),
            on_update: referential_action(&captures, 7),
        })
        .collect()
}

/// Parse a backtick-delimited column list like `` `col1`,`col2` `` into `["col1", "col2"]`.
fn parse_backtick_list(list: &str) -> Vec<String> {
    static BACKTICK_LIST_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = BACKTICK_LIST_REGEX
        .get_or_init(|| Regex::new(r"`([^`]+)`").expect("valid backtick list regex"));
    re.captures_iter(list)
        .map(|captures| captures[1].to_string())
        .collect()
}

const NON_COLUMN_DDL_LINE_KEYWORDS: [&str; 8] = [
    "PRIMARY",
    "KEY",
    "UNIQUE",
    "INDEX",
    "CONSTRAINT",
    "FULLTEXT",
    "SPATIAL",
    "CREATE",
];

fn is_non_column_ddl_line(trimmed_line: &str) -> bool {
    let upper_line = trimmed_line.to_uppercase();
    let starts_with_keyword = NON_COLUMN_DDL_LINE_KEYWORDS
        .iter()
        .any(|keyword| upper_line.starts_with(keyword));
    starts_with_keyword || trimmed_line.starts_with(')')
}

fn parse_column_line(trimmed_line: &str) -> Option<(String, String, Option<String>)> {
    static COL_DEF_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = COL_DEF_REGEX.get_or_init(|| {
        Regex::new(r"(?im)^\s*`([^`]+)`\s+(\S+(?:\([^)]*\))?(?:\s+unsigned)?)")
            .expect("valid column def regex")
    });
    static COL_COMMENT_INLINE: OnceLock<Regex> = OnceLock::new();
    let re_comment = COL_COMMENT_INLINE.get_or_init(|| {
        Regex::new(r"(?i)COMMENT\s+'((?:[^'\\]|\\.)*)'").expect("valid inline comment regex")
    });

    let captures = re.captures(trimmed_line)?;
    let comment = re_comment
        .captures(trimmed_line)
        .map(|comment_captures| comment_captures[1].to_string());
    Some((captures[1].to_string(), captures[2].to_string(), comment))
}

/// Parse column definitions from a `CREATE TABLE` DDL.
///
/// Returns `(col_name, col_type, col_comment)` triples.
pub fn parse_columns_from_ddl(ddl: &str) -> Vec<(String, String, Option<String>)> {
    ddl.lines()
        .map(str::trim)
        .filter(|trimmed_line| !is_non_column_ddl_line(trimmed_line))
        .filter_map(parse_column_line)
        .collect()
}

/// Parse primary key column names from a `CREATE TABLE` DDL.
pub fn parse_pk_from_ddl(ddl: &str) -> Vec<String> {
    static PK_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = PK_REGEX
        .get_or_init(|| Regex::new(r"(?i)PRIMARY\s+KEY\s+\(([^)]+)\)").expect("valid PK regex"));
    match re.captures(ddl) {
        Some(cap) => parse_backtick_list(&cap[1]),
        None => Vec::new(),
    }
}

/// Parse unique index names from a `CREATE TABLE` DDL.
pub fn parse_unique_indexes_from_ddl(ddl: &str) -> Vec<String> {
    static UNIQUE_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = UNIQUE_REGEX.get_or_init(|| {
        Regex::new(r"(?i)UNIQUE\s+(?:KEY|INDEX)\s+`([^`]+)`").expect("valid unique index regex")
    });
    re.captures_iter(ddl)
        .map(|captures| captures[1].to_string())
        .collect()
}
