use super::*;

pub(super) fn first_keyword_upper(sql: &str) -> String {
    sql.chars()
        .take_while(|character| is_identifier_char(*character))
        .collect::<String>()
        .to_uppercase()
}

pub(super) fn is_word_boundary_before(chars: &[char], position: usize) -> bool {
    if position == 0 {
        return true;
    }
    !is_identifier_char(chars[position - 1])
}

pub(super) fn is_keyword_at_word_start(chars: &[char], position: usize, keyword: &str) -> bool {
    is_word_boundary_before(chars, position) && matches_keyword_at(chars, position, keyword)
}

pub(super) fn is_word_boundary_after(chars: &[char], end: usize) -> bool {
    !is_identifier_char_at(chars, end)
}

pub(super) fn matches_keyword_at(chars: &[char], position: usize, keyword: &str) -> bool {
    let keyword_end = position + keyword.len();
    has_text_at_ignore_ascii_case(chars, position, keyword)
        && is_word_boundary_before(chars, position)
        && is_word_boundary_after(chars, keyword_end)
}

pub(super) const JOIN_KEYWORD: &str = "JOIN";
pub(super) const STRAIGHT_JOIN_KEYWORD: &str = "STRAIGHT_JOIN";
pub(super) const NATURAL_KEYWORD: &str = "NATURAL";
pub(super) const OUTER_KEYWORD: &str = "OUTER";
pub(super) const JOIN_SIDE_KEYWORDS: [&str; 2] = ["LEFT", "RIGHT"];

pub(super) struct JoinPrefix {
    pub(super) keyword: &'static str,
    pub(super) allows_outer: bool,
}

pub(super) const JOIN_PREFIXES: [JoinPrefix; 4] = [
    JoinPrefix {
        keyword: "INNER",
        allows_outer: false,
    },
    JoinPrefix {
        keyword: "LEFT",
        allows_outer: true,
    },
    JoinPrefix {
        keyword: "RIGHT",
        allows_outer: true,
    },
    JoinPrefix {
        keyword: "CROSS",
        allows_outer: false,
    },
];

pub(super) fn skip_keyword_and_whitespace(chars: &[char], position: usize, keyword: &str) -> usize {
    skip_whitespace(chars, position + keyword.len())
}

pub(super) fn skip_optional_keyword(chars: &[char], position: usize, keyword: &str) -> usize {
    if !matches_keyword_at(chars, position, keyword) {
        return position;
    }
    skip_keyword_and_whitespace(chars, position, keyword)
}

pub(super) fn join_keyword_end(chars: &[char], position: usize) -> Option<usize> {
    matches_keyword_at(chars, position, JOIN_KEYWORD).then_some(position + JOIN_KEYWORD.len())
}

pub(super) fn match_natural_join(chars: &[char], position: usize) -> Option<usize> {
    let mut pos = skip_keyword_and_whitespace(chars, position, NATURAL_KEYWORD);
    let side_keyword = JOIN_SIDE_KEYWORDS
        .into_iter()
        .find(|keyword| matches_keyword_at(chars, pos, keyword));
    if let Some(keyword) = side_keyword {
        pos = skip_keyword_and_whitespace(chars, pos, keyword);
    }
    join_keyword_end(chars, skip_optional_keyword(chars, pos, OUTER_KEYWORD))
}

pub(super) fn match_prefixed_join(
    chars: &[char],
    position: usize,
    prefix: &JoinPrefix,
) -> Option<usize> {
    let mut pos = skip_keyword_and_whitespace(chars, position, prefix.keyword);
    if prefix.allows_outer {
        pos = skip_optional_keyword(chars, pos, OUTER_KEYWORD);
    }
    join_keyword_end(chars, pos)
}

pub(super) fn match_join_keyword(chars: &[char], position: usize) -> Option<usize> {
    if matches_keyword_at(chars, position, STRAIGHT_JOIN_KEYWORD) {
        return Some(position + STRAIGHT_JOIN_KEYWORD.len());
    }
    if matches_keyword_at(chars, position, NATURAL_KEYWORD) {
        return match_natural_join(chars, position);
    }
    let prefix = JOIN_PREFIXES
        .iter()
        .find(|prefix| matches_keyword_at(chars, position, prefix.keyword));
    if let Some(prefix) = prefix {
        return match_prefixed_join(chars, position, prefix);
    }
    join_keyword_end(chars, position)
}

pub(super) fn matches_any_stop_keyword(chars: &[char], position: usize) -> bool {
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

pub(super) fn skip_whitespace(chars: &[char], mut position: usize) -> usize {
    while is_whitespace_at(chars, position) {
        position += 1;
    }
    position
}

pub(super) fn skip_quoted(chars: &[char], position: usize) -> usize {
    let quote = chars[position];
    let mut pos = position + 1;
    while !is_past_end(chars, pos) {
        if is_escape_before_char(chars, pos) {
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

pub(super) fn skip_backtick(chars: &[char], position: usize) -> usize {
    let mut pos = position + 1;
    while !is_past_end(chars, pos) {
        if chars[pos] != '`' {
            pos += 1;
            continue;
        }
        let is_escaped_backtick = has_char_at(chars, pos + 1, '`');
        if !is_escaped_backtick {
            return pos + 1;
        }
        pos += 2;
    }
    pos
}

pub(super) fn skip_parenthesized(chars: &[char], position: usize) -> usize {
    let mut depth = 1;
    let mut pos = position + 1;
    while depth > 0 {
        if is_past_end(chars, pos) {
            break;
        }
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
