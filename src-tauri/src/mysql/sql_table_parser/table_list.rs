use super::*;

pub(super) enum TableListStep {
    Next(usize),
    End(usize),
}

pub(super) fn continue_after_comma(chars: &[char], position: usize) -> TableListStep {
    if has_char_at(chars, position, ',') {
        return TableListStep::Next(position + 1);
    }
    TableListStep::End(position)
}

pub(super) fn parse_table_list_entry(
    chars: &[char],
    position: usize,
    tables: &mut Vec<TableReference>,
) -> TableListStep {
    let position = skip_whitespace(chars, position);
    if is_past_end(chars, position) {
        return TableListStep::End(position);
    }
    if chars[position] == '(' {
        let after_group = skip_alias(chars, skip_parenthesized(chars, position));
        return continue_after_comma(chars, skip_whitespace(chars, after_group));
    }
    let ends_table_list = is_word_boundary_before(chars, position)
        && (matches_any_stop_keyword(chars, position)
            || match_join_keyword(chars, position).is_some());
    if ends_table_list {
        return TableListStep::End(position);
    }
    let after_reference = parse_single_table_ref(chars, position, tables);
    let made_no_progress = after_reference == position;
    if made_no_progress {
        return TableListStep::End(position);
    }
    continue_after_comma(chars, skip_whitespace(chars, after_reference))
}

pub(super) fn parse_table_list(
    chars: &[char],
    mut position: usize,
    tables: &mut Vec<TableReference>,
) -> usize {
    loop {
        match parse_table_list_entry(chars, position, tables) {
            TableListStep::Next(next) => position = next,
            TableListStep::End(end) => return end,
        }
    }
}

pub(super) fn is_subquery_start(chars: &[char], position: usize) -> bool {
    matches_keyword_at(chars, position, "SELECT")
}

pub(super) fn parse_single_table_ref(
    chars: &[char],
    mut position: usize,
    tables: &mut Vec<TableReference>,
) -> usize {
    position = skip_whitespace(chars, position);

    if is_past_end(chars, position) {
        return position;
    }

    if chars[position] == '(' {
        let inner_start = skip_whitespace(chars, position + 1);
        if is_subquery_start(chars, inner_start) {
            position = skip_parenthesized(chars, position);
            position = skip_alias(chars, position);
            return position;
        }
        position = skip_parenthesized(chars, position);
        position = skip_alias(chars, position);
        return position;
    }

    let first_read = read_identifier(chars, position);
    let Some(first_ident) = first_read.name else {
        return position;
    };
    position = first_read.end;

    let has_schema_dot = has_char_at(chars, position, '.');
    if !has_schema_dot {
        tables.push(TableReference {
            database: None,
            table: first_ident,
        });
        return skip_alias(chars, position);
    }

    position += 1;
    let second_read = read_identifier(chars, position);
    let Some(table_name) = second_read.name else {
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
    skip_alias(chars, second_read.end)
}

pub(super) struct IdentifierRead {
    pub(super) name: Option<String>,
    pub(super) end: usize,
}

impl IdentifierRead {
    pub(super) fn from_name(name: String, end: usize) -> Self {
        Self {
            name: non_empty_name(name),
            end,
        }
    }

    pub(super) fn missing_at(position: usize) -> Self {
        Self {
            name: None,
            end: position,
        }
    }
}

pub(super) fn read_identifier(chars: &[char], position: usize) -> IdentifierRead {
    if is_past_end(chars, position) {
        return IdentifierRead::missing_at(position);
    }

    if chars[position] == '`' {
        return read_backtick_identifier(chars, position);
    }
    if is_identifier_start_char(chars[position]) {
        return read_plain_identifier(chars, position);
    }
    IdentifierRead::missing_at(position)
}

pub(super) fn read_backtick_identifier(chars: &[char], position: usize) -> IdentifierRead {
    let mut pos = position + 1;
    let mut name = String::new();
    while !is_past_end(chars, pos) {
        if chars[pos] != '`' {
            name.push(chars[pos]);
            pos += 1;
            continue;
        }
        let is_escaped_backtick = has_char_at(chars, pos + 1, '`');
        if !is_escaped_backtick {
            return IdentifierRead::from_name(name, pos + 1);
        }
        name.push('`');
        pos += 2;
    }
    IdentifierRead::from_name(name, pos)
}

pub(super) fn read_plain_identifier(chars: &[char], position: usize) -> IdentifierRead {
    let mut pos = position;
    let mut name = String::new();
    while chars
        .get(pos)
        .is_some_and(|character| is_identifier_or_dollar_char(*character))
    {
        name.push(chars[pos]);
        pos += 1;
    }
    IdentifierRead::from_name(name, pos)
}

pub(super) fn is_identifier_opening_char(character: char) -> bool {
    character == '`' || is_identifier_start_char(character)
}

pub(super) fn non_empty_name(name: String) -> Option<String> {
    Some(name).filter(|name| !name.is_empty())
}

pub(super) fn skip_alias(chars: &[char], mut position: usize) -> usize {
    let saved = position;
    position = skip_whitespace(chars, position);

    if is_past_end(chars, position) {
        return position;
    }

    if is_keyword_at_word_start(chars, position, "ON") {
        return saved;
    }

    if is_keyword_at_word_start(chars, position, "AS") {
        position += 2;
        position = skip_whitespace(chars, position);
        return read_identifier(chars, position).end;
    }

    let starts_implicit_alias = chars
        .get(position)
        .is_some_and(|character| is_identifier_opening_char(*character));
    if !starts_implicit_alias {
        return saved;
    }
    let alias_read = read_identifier(chars, position);
    let Some(alias) = alias_read.name else {
        return saved;
    };
    if is_sql_keyword(&alias.to_uppercase()) {
        return saved;
    }
    alias_read.end
}

pub(super) fn is_sql_keyword(word: &str) -> bool {
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

pub(super) fn deduplicate(tables: &mut Vec<TableReference>) {
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
