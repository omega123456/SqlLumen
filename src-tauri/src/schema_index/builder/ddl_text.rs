use regex::Regex;
use std::sync::OnceLock;

/// Strip MySQL engine/storage metadata from a CREATE TABLE statement so that
/// the resulting text captures only the schema structure (columns, indexes, FKs).
///
/// Removes: `AUTO_INCREMENT=\d+`, `ROW_FORMAT=...`, `ENGINE=...`, trailing
/// `DEFAULT CHARSET=...`, `COLLATE=...`, and `COMMENT='...'` clauses that
/// appear after the closing `)` of the column list.
pub fn compact_ddl(create_table_sql: &str) -> String {
    static AUTO_INCREMENT_REGEX: OnceLock<Regex> = OnceLock::new();
    static TRAILING_CLAUSE_REGEX: OnceLock<Regex> = OnceLock::new();
    static WHITESPACE_REGEX: OnceLock<Regex> = OnceLock::new();

    // Remove AUTO_INCREMENT=<digits> (case-insensitive)
    let re_auto_inc = AUTO_INCREMENT_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\s*AUTO_INCREMENT\s*=\s*\d+").expect("valid auto_increment regex")
    });
    let text = re_auto_inc.replace_all(create_table_sql, "");

    // Remove trailing engine/storage clauses after the last `)`
    // These are: ENGINE=..., ROW_FORMAT=..., DEFAULT CHARSET=..., COLLATE=..., COMMENT='...'
    let re_trailing = TRAILING_CLAUSE_REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)\)\s*(ENGINE\s*=\s*\S+|ROW_FORMAT\s*=\s*\S+|DEFAULT\s+CHARSET\s*=\s*\S+|COLLATE\s*=\s*\S+|COMMENT\s*=\s*'[^']*'|/\*![^*]*\*/|\s)*\s*;?\s*$",
        )
        .expect("valid trailing clause regex")
    });

    let text = strip_trailing_table_options(&text, re_trailing);

    // Normalize whitespace
    let re_ws =
        WHITESPACE_REGEX.get_or_init(|| Regex::new(r"\s+").expect("valid whitespace regex"));
    let text = re_ws.replace_all(&text, " ");

    text.trim().to_string()
}

fn strip_trailing_table_options(text: &str, trailing_clause_regex: &Regex) -> String {
    let Some(trailing_match) = trailing_clause_regex.find(text) else {
        return text.to_string();
    };
    match text[..trailing_match.start() + 1].rfind(')') {
        Some(paren_position) => format!("{})", &text[..paren_position]),
        None => text.to_string(),
    }
}

/// Strip MySQL engine/storage metadata from DDL but **keep** `COMMENT '...'`
/// annotations (both table-level and column-level). This variant is used to
/// produce the text sent to the embedding model, where comments carry useful
/// semantic information.
///
/// Removes: `ENGINE=...`, `ROW_FORMAT=...`, `DEFAULT CHARSET=...`,
/// `COLLATE=...`, `AUTO_INCREMENT=\d+` — but preserves `COMMENT` clauses.
pub fn compact_ddl_for_llm(create_table_sql: &str) -> String {
    static AUTO_INCREMENT_REGEX: OnceLock<Regex> = OnceLock::new();
    static ENGINE_REGEX: OnceLock<Regex> = OnceLock::new();
    static ROW_FORMAT_REGEX: OnceLock<Regex> = OnceLock::new();
    static CHARSET_REGEX: OnceLock<Regex> = OnceLock::new();
    static COLLATE_REGEX: OnceLock<Regex> = OnceLock::new();
    static WHITESPACE_REGEX2: OnceLock<Regex> = OnceLock::new();
    static ROW_COUNT_COMMENT_REGEX: OnceLock<Regex> = OnceLock::new();

    // Strip any previously appended row-count annotation so hashing is stable on round-trip
    let re_row_count = ROW_COUNT_COMMENT_REGEX.get_or_init(|| {
        Regex::new(r"(?m)\n?--\s*approximate rows:\s*\d+\s*$").expect("valid regex")
    });
    let text = re_row_count.replace_all(create_table_sql, "");

    let re_auto_inc = AUTO_INCREMENT_REGEX
        .get_or_init(|| Regex::new(r"(?i)\s*AUTO_INCREMENT\s*=\s*\d+").expect("valid regex"));
    let text = re_auto_inc.replace_all(&text, "");

    let re_engine =
        ENGINE_REGEX.get_or_init(|| Regex::new(r"(?i)\bENGINE\s*=\s*\S+").expect("valid regex"));
    let text = re_engine.replace_all(&text, "");

    let re_row_format = ROW_FORMAT_REGEX
        .get_or_init(|| Regex::new(r"(?i)\bROW_FORMAT\s*=\s*\S+").expect("valid regex"));
    let text = re_row_format.replace_all(&text, "");

    let re_charset = CHARSET_REGEX
        .get_or_init(|| Regex::new(r"(?i)\bDEFAULT\s+CHARSET\s*=\s*\S+").expect("valid regex"));
    let text = re_charset.replace_all(&text, "");

    let re_collate =
        COLLATE_REGEX.get_or_init(|| Regex::new(r"(?i)\bCOLLATE\s*=\s*\S+").expect("valid regex"));
    let text = re_collate.replace_all(&text, "");

    let re_ws = WHITESPACE_REGEX2.get_or_init(|| Regex::new(r"\s+").expect("valid regex"));
    let text = re_ws.replace_all(&text, " ");

    text.trim().to_string()
}

fn quote_identifier(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

fn parse_identifier_parts(identifier: &str) -> Vec<String> {
    identifier
        .split('.')
        .map(|part| part.trim_matches('`').trim().to_string())
        .filter(|part| !part.is_empty())
        .collect()
}

/// Ensure the leading `CREATE TABLE ...` identifier is fully qualified with the
/// source database name so semantic search and downstream prompt assembly retain
/// unambiguous table identity across databases.
pub fn qualify_table_ddl(db_name: &str, table_name: &str, ddl: &str) -> String {
    static CREATE_TABLE_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = CREATE_TABLE_REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)^\s*(CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+((?:`[^`]+`|[a-z_][a-z0-9_$]*)(?:\.(?:`[^`]+`|[a-z_][a-z0-9_$]*))?)",
        )
        .expect("valid create table qualification regex")
    });

    let quoted_db = quote_identifier(db_name);
    let quoted_table = quote_identifier(table_name);

    re.replace(ddl, format!("$1 {quoted_db}.{quoted_table}"))
        .into_owned()
}

fn qualified_reference(db_name: &str, identifier: &str) -> String {
    let parts = parse_identifier_parts(identifier);
    match parts.as_slice() {
        [table_name] => format!(
            "{}.{}",
            quote_identifier(db_name),
            quote_identifier(table_name)
        ),
        [ref_db_name, table_name] => format!(
            "{}.{}",
            quote_identifier(ref_db_name),
            quote_identifier(table_name)
        ),
        _ => identifier.to_string(),
    }
}

/// Ensure REFERENCES clauses also use database-qualified table names.
pub fn qualify_references_in_ddl(db_name: &str, ddl: &str) -> String {
    static REFERENCES_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = REFERENCES_REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)\bREFERENCES\s+((?:`[^`]+`|[a-z_][a-z0-9_$]*)(?:\.(?:`[^`]+`|[a-z_][a-z0-9_$]*))?)\s*\(",
        )
        .expect("valid references qualification regex")
    });

    re.replace_all(ddl, |captures: &regex::Captures<'_>| {
        let identifier = captures
            .get(1)
            .map(|matched| matched.as_str())
            .unwrap_or_default();
        let qualified = qualified_reference(db_name, identifier);
        format!("REFERENCES {qualified} (")
    })
    .into_owned()
}

/// Normalize table DDL so both the declared table and its REFERENCES targets are
/// database-qualified.
pub fn normalize_table_ddl(db_name: &str, table_name: &str, ddl: &str) -> String {
    let ddl = qualify_table_ddl(db_name, table_name, ddl);
    qualify_references_in_ddl(db_name, &ddl)
}
