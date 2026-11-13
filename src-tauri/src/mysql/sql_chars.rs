const ESCAPE_CHAR: char = '\\';

pub fn is_quote_char(character: char) -> bool {
    matches!(character, '\'' | '"' | '`')
}

pub fn is_string_quote_char(character: char) -> bool {
    matches!(character, '\'' | '"')
}

pub fn is_line_break_char(character: char) -> bool {
    matches!(character, '\n' | '\r')
}

pub fn is_identifier_char(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

pub fn is_blank_identifier(name: &str) -> bool {
    name.trim().is_empty()
}

pub fn is_identifier_or_dollar_char(character: char) -> bool {
    is_identifier_char(character) || character == '$'
}

pub fn is_identifier_start_char(character: char) -> bool {
    character.is_alphabetic() || character == '_'
}

pub fn is_past_end(chars: &[char], position: usize) -> bool {
    position >= chars.len()
}

pub fn has_char_at(chars: &[char], position: usize, expected: char) -> bool {
    chars.get(position) == Some(&expected)
}

pub fn is_whitespace_at(chars: &[char], position: usize) -> bool {
    chars
        .get(position)
        .is_some_and(|character| character.is_whitespace())
}

pub fn is_ascii_whitespace_at(chars: &[char], position: usize) -> bool {
    chars
        .get(position)
        .is_some_and(|character| character.is_ascii_whitespace())
}

pub fn is_identifier_char_at(chars: &[char], position: usize) -> bool {
    chars
        .get(position)
        .is_some_and(|character| is_identifier_char(*character))
}

pub fn has_text_at(chars: &[char], position: usize, text: &str) -> bool {
    let text_chars: Vec<char> = text.chars().collect();
    chars.get(position..position + text_chars.len()) == Some(text_chars.as_slice())
}

pub fn has_text_at_ignore_ascii_case(chars: &[char], position: usize, text: &str) -> bool {
    let text_chars: Vec<char> = text.chars().collect();
    let Some(candidate) = chars.get(position..position + text_chars.len()) else {
        return false;
    };
    candidate
        .iter()
        .zip(&text_chars)
        .all(|(character, text_char)| character.eq_ignore_ascii_case(text_char))
}

pub fn is_escape_before_char(chars: &[char], position: usize) -> bool {
    has_char_at(chars, position, ESCAPE_CHAR) && position + 1 < chars.len()
}
