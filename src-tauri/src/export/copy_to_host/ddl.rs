use super::*;

fn is_quote_byte(byte: u8) -> bool {
    matches!(byte, b'\'' | b'`' | b'"')
}

fn quoted_span_end(bytes: &[u8], start: usize, quote: u8) -> Option<usize> {
    let mut position = start;
    while position < bytes.len() {
        let byte = bytes[position];
        position += 1;
        if byte != quote {
            continue;
        }
        let is_doubled_quote = has_byte_at(bytes, position, quote);
        if !is_doubled_quote {
            return Some(position);
        }
        position += 1;
    }
    None
}

fn definer_spec_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut position = start;
    while position < bytes.len() {
        let byte = bytes[position];
        if byte.is_ascii_whitespace() {
            return Some(position);
        }
        position += 1;
        if is_quote_byte(byte) {
            position = quoted_span_end(bytes, position, byte)?;
        }
    }
    Some(position)
}

pub fn strip_definer(ddl: &str) -> String {
    let bytes = ddl.as_bytes();
    let lower = ddl.to_ascii_lowercase();
    let needle = "definer";
    let Some(start) = lower.find(needle) else {
        return ddl.to_string();
    };

    let mut position = start + needle.len();
    while is_ascii_whitespace_byte_at(bytes, position) {
        position += 1;
    }
    if !has_byte_at(bytes, position, b'=') {
        return ddl.to_string();
    }
    position += 1;
    while is_ascii_whitespace_byte_at(bytes, position) {
        position += 1;
    }
    let has_definer_spec = position < bytes.len() && !is_ascii_whitespace_byte_at(bytes, position);
    if !has_definer_spec {
        return ddl.to_string();
    }
    let Some(position) = definer_spec_end(bytes, position) else {
        return ddl.to_string();
    };
    let mut after = position;
    while is_ascii_whitespace_byte_at(bytes, after) {
        after += 1;
    }

    let mut result = String::with_capacity(ddl.len());
    result.push_str(&ddl[..start]);
    let needs_space =
        !result.is_empty() && !result.ends_with(char::is_whitespace) && after < ddl.len();
    if needs_space {
        result.push(' ');
    }
    result.push_str(&ddl[after..]);
    result
}

pub fn drop_if_exists_statement(object_type: CopyObjectType, escaped_name: &str) -> String {
    let keyword = match object_type {
        CopyObjectType::Table => "TABLE",
        CopyObjectType::Procedure => "PROCEDURE",
        CopyObjectType::Function => "FUNCTION",
        CopyObjectType::Trigger => "TRIGGER",
        CopyObjectType::Event => "EVENT",
    };
    format!("DROP {keyword} IF EXISTS `{escaped_name}`")
}

pub fn apply_create_if_not_exists(object_type: CopyObjectType, ddl: &str) -> String {
    if object_type != CopyObjectType::Table {
        return ddl.to_string();
    }
    let trimmed_start = ddl.trim_start();
    let lower = trimmed_start.to_ascii_lowercase();
    if lower.starts_with("create table if not exists") {
        return ddl.to_string();
    }
    if !lower.starts_with("create table") {
        return ddl.to_string();
    }
    let leading_len = ddl.len() - trimmed_start.len();
    let leading = &ddl[..leading_len];
    let rest = &trimmed_start["create table".len()..];
    format!("{leading}CREATE TABLE IF NOT EXISTS{rest}")
}

#[derive(Debug, Clone, Copy)]
pub struct CopyObject<'a> {
    pub object_type: CopyObjectType,
    pub name: &'a str,
}

#[derive(Debug, Clone, Copy)]
pub struct TargetObject<'a> {
    pub object_type: CopyObjectType,
    pub target_database: &'a str,
    pub object_name: &'a str,
}

pub fn rewrite_non_table_ddl_schema(ddl: &str, target: TargetObject<'_>) -> String {
    let TargetObject {
        object_type,
        target_database,
        object_name,
    } = target;
    let is_unqualifiable = object_type == CopyObjectType::Table
        || target_database.is_empty()
        || object_name.is_empty();
    if is_unqualifiable {
        return ddl.to_string();
    }

    let keyword = match object_type {
        CopyObjectType::Table => return ddl.to_string(),
        CopyObjectType::Procedure => "procedure",
        CopyObjectType::Function => "function",
        CopyObjectType::Trigger => "trigger",
        CopyObjectType::Event => "event",
    };
    let lower = ddl.to_ascii_lowercase();
    let Some(keyword_pos) = lower.find(keyword) else {
        return ddl.to_string();
    };

    let escaped_target = target_database.replace('`', "``");
    let escaped_object = object_name.replace('`', "``");
    let target_qualified = format!("`{escaped_target}`.`{escaped_object}`");

    let search_start = keyword_pos + keyword.len();
    let Some(header_range) = find_create_header_identifier(ddl, search_start) else {
        return ddl.to_string();
    };
    let replace_start = header_range.start;
    let replace_end = header_range.end;

    let mut rewritten =
        String::with_capacity(ddl.len() - (replace_end - replace_start) + target_qualified.len());
    rewritten.push_str(&ddl[..replace_start]);
    rewritten.push_str(&target_qualified);
    rewritten.push_str(&ddl[replace_end..]);
    rewritten
}

fn find_create_header_identifier(ddl: &str, search_start: usize) -> Option<std::ops::Range<usize>> {
    let after_keyword = &ddl[search_start..];
    let ws_len = after_keyword
        .bytes()
        .take_while(|byte| byte.is_ascii_whitespace())
        .count();
    let name_start = search_start + ws_len;
    let first_end = parse_mysql_identifier_end(ddl, name_start)?;
    let after_first = &ddl[first_end..];
    let ws_after_first = after_first
        .bytes()
        .take_while(|byte| byte.is_ascii_whitespace())
        .count();
    let dot_pos = first_end + ws_after_first;
    let is_schema_qualified = ddl[dot_pos..].starts_with('.');
    if !is_schema_qualified {
        return Some(name_start..first_end);
    }
    let after_dot = dot_pos + 1;
    let ws_after_dot = ddl[after_dot..]
        .bytes()
        .take_while(|byte| byte.is_ascii_whitespace())
        .count();
    let object_start = after_dot + ws_after_dot;
    let object_end = parse_mysql_identifier_end(ddl, object_start)?;
    Some(name_start..object_end)
}

fn is_unquoted_identifier_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_' || character == '$'
}

fn parse_mysql_identifier_end(sql: &str, start: usize) -> Option<usize> {
    if sql[start..].starts_with('`') {
        return quoted_span_end(sql.as_bytes(), start + 1, b'`');
    }

    let identifier_len: usize = sql[start..]
        .chars()
        .take_while(|character| is_unquoted_identifier_char(*character))
        .map(char::len_utf8)
        .sum();
    let end = start + identifier_len;
    (end > start).then_some(end)
}

pub fn qualified_drop_if_exists_statement(
    object_type: CopyObjectType,
    target_database: &str,
    escaped_object_name: &str,
) -> String {
    let escaped_db = target_database.replace('`', "``");
    let qualified = format!("`{escaped_db}`.`{escaped_object_name}`");
    match object_type {
        CopyObjectType::Table => format!("DROP TABLE IF EXISTS {qualified}"),
        CopyObjectType::Procedure => format!("DROP PROCEDURE IF EXISTS {qualified}"),
        CopyObjectType::Function => format!("DROP FUNCTION IF EXISTS {qualified}"),
        CopyObjectType::Trigger => format!("DROP TRIGGER IF EXISTS {qualified}"),
        CopyObjectType::Event => format!("DROP EVENT IF EXISTS {qualified}"),
    }
}

fn create_table_prefix_len(lower_ddl: &str) -> Option<usize> {
    ["create table if not exists", "create table"]
        .into_iter()
        .find(|prefix| lower_ddl.starts_with(prefix))
        .map(str::len)
}

pub fn qualify_table_ddl_schema(ddl: &str, target_database: &str, table_name: &str) -> String {
    let is_missing_target_name = target_database.is_empty() || table_name.is_empty();
    if is_missing_target_name {
        return ddl.to_string();
    }

    let trimmed_start = ddl.trim_start();
    let leading_len = ddl.len() - trimmed_start.len();
    let lower = trimmed_start.to_ascii_lowercase();
    let Some(prefix_len) = create_table_prefix_len(&lower) else {
        return ddl.to_string();
    };

    let header_start = leading_len + prefix_len;
    let after_prefix = &ddl[header_start..];
    let ws_len = after_prefix
        .bytes()
        .take_while(|byte| byte.is_ascii_whitespace())
        .count();
    let name_start = header_start + ws_len;
    let escaped_table = table_name.replace('`', "``");
    let unqualified = format!("`{escaped_table}`");
    let starts_with_unqualified_name = ddl[name_start..].starts_with(&unqualified);
    if !starts_with_unqualified_name {
        return ddl.to_string();
    }

    let escaped_db = target_database.replace('`', "``");
    let qualified = format!("`{escaped_db}`.{unqualified}");
    let name_end = name_start + unqualified.len();
    let mut rewritten = String::with_capacity(ddl.len() + escaped_db.len() + 3);
    rewritten.push_str(&ddl[..name_start]);
    rewritten.push_str(&qualified);
    rewritten.push_str(&ddl[name_end..]);
    rewritten
}
