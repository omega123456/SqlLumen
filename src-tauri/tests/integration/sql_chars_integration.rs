use sqllumen_lib::mysql::sql_chars::{
    has_char_at, has_text_at, has_text_at_ignore_ascii_case, is_ascii_whitespace_at,
    is_blank_identifier, is_escape_before_char, is_identifier_char, is_identifier_char_at,
    is_identifier_or_dollar_char, is_identifier_start_char, is_line_break_char, is_past_end,
    is_quote_char, is_string_quote_char, is_whitespace_at,
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

#[test]
fn blank_identifiers_are_empty_or_whitespace_only() {
    assert!(is_blank_identifier(""));
    assert!(is_blank_identifier("  \t"));
    assert!(!is_blank_identifier(" id "));
}

#[test]
fn past_end_starts_at_the_char_count() {
    let chars = chars_of("ab");
    assert!(!is_past_end(&chars, 1));
    assert!(is_past_end(&chars, 2));
    assert!(is_past_end(&chars, 3));
}

#[test]
fn text_at_matches_exactly_and_is_false_when_it_runs_past_the_end() {
    let chars = chars_of("a $$ b");
    assert!(has_text_at(&chars, 2, "$$"));
    assert!(!has_text_at(&chars, 1, "$$"));
    assert!(!has_text_at(&chars, 5, "b c"));
    assert!(!has_text_at(&chars, 9, "b"));
}

#[test]
fn text_at_ignore_ascii_case_matches_any_case_and_is_false_past_the_end() {
    let chars = chars_of("delimiter //");
    assert!(has_text_at_ignore_ascii_case(&chars, 0, "DELIMITER"));
    assert!(!has_text_at_ignore_ascii_case(&chars, 1, "DELIMITER"));
    assert!(!has_text_at_ignore_ascii_case(&chars, 10, "///"));
    assert!(!has_text_at_ignore_ascii_case(&chars, 20, "/"));
}
