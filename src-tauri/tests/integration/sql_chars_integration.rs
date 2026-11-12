use sqllumen_lib::mysql::sql_chars::{
    has_char_at, is_ascii_whitespace_at, is_escape_before_char, is_identifier_char,
    is_identifier_char_at, is_identifier_or_dollar_char, is_identifier_start_char,
    is_line_break_char, is_quote_char, is_string_quote_char, is_whitespace_at,
};

fn chars_of(text: &str) -> Vec<char> {
    text.chars().collect()
}

#[test]
fn quote_chars_cover_string_and_identifier_quotes() {
    for quote in ['\'', '"', '`'] {
        assert!(is_quote_char(quote), "{quote}");
    }
    assert!(!is_quote_char('a'));
}

#[test]
fn string_quote_chars_exclude_the_backtick() {
    assert!(is_string_quote_char('\''));
    assert!(is_string_quote_char('"'));
    assert!(!is_string_quote_char('`'));
}

#[test]
fn line_break_chars_are_newline_and_carriage_return() {
    assert!(is_line_break_char('\n'));
    assert!(is_line_break_char('\r'));
    assert!(!is_line_break_char(' '));
}

#[test]
fn identifier_chars_are_alphanumerics_and_underscore() {
    for character in ['a', 'Z', '7', '_', 'é'] {
        assert!(is_identifier_char(character), "{character}");
    }
    for character in ['$', ' ', '.', '`'] {
        assert!(!is_identifier_char(character), "{character}");
    }
}

#[test]
fn dollar_is_an_identifier_char_only_in_the_dollar_variant() {
    assert!(is_identifier_or_dollar_char('$'));
    assert!(is_identifier_or_dollar_char('a'));
    assert!(!is_identifier_or_dollar_char('-'));
}

#[test]
fn identifier_start_chars_exclude_digits() {
    assert!(is_identifier_start_char('a'));
    assert!(is_identifier_start_char('_'));
    assert!(!is_identifier_start_char('1'));
}

#[test]
fn has_char_at_is_false_past_the_end() {
    let chars = chars_of("a,");
    assert!(has_char_at(&chars, 1, ','));
    assert!(!has_char_at(&chars, 0, ','));
    assert!(!has_char_at(&chars, 2, ','));
}

#[test]
fn whitespace_at_is_false_past_the_end() {
    let chars = chars_of(" a");
    assert!(is_whitespace_at(&chars, 0));
    assert!(!is_whitespace_at(&chars, 1));
    assert!(!is_whitespace_at(&chars, 2));
}

#[test]
fn ascii_whitespace_at_is_false_for_other_chars_and_past_the_end() {
    let chars = chars_of("\ta");
    assert!(is_ascii_whitespace_at(&chars, 0));
    assert!(!is_ascii_whitespace_at(&chars, 1));
    assert!(!is_ascii_whitespace_at(&chars, 2));
}

#[test]
fn identifier_char_at_is_false_past_the_end() {
    let chars = chars_of("a ");
    assert!(is_identifier_char_at(&chars, 0));
    assert!(!is_identifier_char_at(&chars, 1));
    assert!(!is_identifier_char_at(&chars, 2));
}

#[test]
fn escape_before_char_needs_a_following_char() {
    assert!(is_escape_before_char(&chars_of("\\n"), 0));
    assert!(!is_escape_before_char(&chars_of("a\\"), 1));
    assert!(!is_escape_before_char(&chars_of("ab"), 0));
}
