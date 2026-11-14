use super::*;

fn is_block_comment_start(character: char, next_character: Option<char>) -> bool {
    character == '/' && next_character == Some('*')
}

fn is_dash_comment_start(character: char, next_character: Option<char>) -> bool {
    character == '-' && next_character == Some('-')
}

fn is_executable_or_hint_marker(character: char) -> bool {
    matches!(character, '!' | '+')
}

fn is_whitespace_or_control(character: char) -> bool {
    character.is_whitespace() || character.is_control()
}

fn is_statement_terminator_padding(character: char) -> bool {
    character == ';' || character.is_whitespace()
}

pub fn strip_non_executable_comments(sql: &str) -> String {
    let mut result = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();

    while let Some(ch) = chars.next() {
        let next_char = chars.peek().copied();
        if is_block_comment_start(ch, next_char) {
            chars.next();
            copy_or_drop_block_comment(&mut chars, &mut result);
            continue;
        }
        if is_dash_comment_start(ch, next_char) {
            chars.next();
            drop_line_comment(&mut chars, &mut result);
            continue;
        }
        if ch == '#' {
            drop_line_comment(&mut chars, &mut result);
            continue;
        }
        if matches!(ch, '\'' | '"' | '`') {
            copy_quoted_literal(ch, &mut chars, &mut result);
            continue;
        }
        result.push(ch);
    }

    result
}

type SqlChars<'a> = std::iter::Peekable<std::str::Chars<'a>>;

fn copy_or_drop_block_comment(chars: &mut SqlChars<'_>, result: &mut String) {
    let is_executable_or_hint = chars
        .peek()
        .is_some_and(|&character| is_executable_or_hint_marker(character));
    if !is_executable_or_hint {
        skip_past_block_comment_end(chars);
        result.push(' ');
        return;
    }
    result.push('/');
    result.push('*');
    while let Some(character) = chars.next() {
        let closes_comment = character == '*' && chars.peek() == Some(&'/');
        if closes_comment {
            chars.next();
            result.push_str("*/");
            return;
        }
        result.push(character);
    }
}

fn skip_past_block_comment_end(chars: &mut SqlChars<'_>) {
    while let Some(character) = chars.next() {
        let closes_comment = character == '*' && chars.peek() == Some(&'/');
        if closes_comment {
            chars.next();
            return;
        }
    }
}

fn drop_line_comment(chars: &mut SqlChars<'_>, result: &mut String) {
    while chars.next_if(|&character| character != '\n').is_some() {}
    if chars.next_if_eq(&'\n').is_some() {
        result.push('\n');
    }
}

fn copy_quoted_literal(quote: char, chars: &mut SqlChars<'_>, result: &mut String) {
    result.push(quote);
    while let Some(character) = chars.next() {
        result.push(character);
        if character == '\\' {
            result.extend(chars.next());
            continue;
        }
        if character == quote {
            return;
        }
    }
}

pub fn get_first_keyword(sql: &str) -> String {
    let trimmed = sql.trim();

    if let Some(inner) = trimmed.strip_prefix("/*!") {
        let after_version = inner.trim_start_matches(|character: char| character.is_ascii_digit());
        let after_ws = after_version.trim_start();
        let first_word: String = after_ws
            .chars()
            .take_while(|character| is_identifier_char(*character))
            .collect();
        if !first_word.is_empty() {
            return first_word.to_uppercase();
        }
    }

    trimmed
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_uppercase()
        .trim_end_matches(';')
        .to_uppercase()
}

const WITH_KEYWORD: &str = "WITH";
const LIMIT_KEYWORD: &str = "LIMIT";
const CTE_MAIN_KEYWORDS: [&str; 5] = ["SELECT", "INSERT", "UPDATE", "DELETE", "REPLACE"];

fn skip_quoted_literal(chars: &[char], position: usize) -> usize {
    let quote = chars[position];
    let mut position = position + 1;
    while position < chars.len() {
        if is_escape_before_char(chars, position) {
            position += 2;
            continue;
        }
        if chars[position] == quote {
            return position + 1;
        }
        position += 1;
    }
    position
}

struct TopLevelScan<'a> {
    chars: &'a [char],
    position: usize,
    depth: i32,
}

fn next_top_level_position(scan: &mut TopLevelScan<'_>) -> Option<usize> {
    let chars = scan.chars;
    while scan.position < chars.len() {
        let character = chars[scan.position];
        if is_quote_char(character) {
            scan.position = skip_quoted_literal(chars, scan.position);
            continue;
        }
        if character == '(' {
            scan.depth += 1;
        }
        if character == ')' {
            scan.depth = (scan.depth - 1).max(0);
        }
        let is_parenthesis = character == '(' || character == ')';
        if !is_parenthesis && scan.depth == 0 {
            return Some(scan.position);
        }
        scan.position += 1;
    }
    None
}

fn identifier_end(chars: &[char], start: usize) -> usize {
    let mut position = start;
    while is_identifier_char_at(chars, position) {
        position += 1;
    }
    position
}

pub fn find_with_main_keyword(sql: &str) -> String {
    let chars: Vec<char> = sql.chars().collect();
    let mut position = 0;
    while is_whitespace_at(&chars, position) {
        position += 1;
    }
    let remaining: String = chars[position..].iter().collect();
    let starts_with_with_keyword = remaining.to_uppercase().starts_with(WITH_KEYWORD);
    if !starts_with_with_keyword {
        return String::new();
    }

    let mut scan = TopLevelScan {
        chars: &chars,
        position: position + WITH_KEYWORD.len(),
        depth: 0,
    };
    while let Some(word_start) = next_top_level_position(&mut scan) {
        if !chars[word_start].is_alphabetic() {
            scan.position += 1;
            continue;
        }
        scan.position = identifier_end(&chars, word_start);
        let upper_word = chars[word_start..scan.position]
            .iter()
            .collect::<String>()
            .to_uppercase();
        if CTE_MAIN_KEYWORDS.contains(&upper_word.as_str()) {
            return upper_word;
        }
    }
    String::new()
}

fn is_limit_keyword_at(chars: &[char], position: usize) -> bool {
    let keyword_end = position + LIMIT_KEYWORD.len();
    let Some(candidate) = chars.get(position..keyword_end) else {
        return false;
    };
    let is_limit_word = candidate
        .iter()
        .collect::<String>()
        .eq_ignore_ascii_case(LIMIT_KEYWORD);
    let is_word_start = position == 0 || !is_identifier_char(chars[position - 1]);
    let is_word_end = !is_identifier_char_at(chars, keyword_end);
    is_limit_word && is_word_start && is_word_end
}

pub fn has_top_level_limit(sql: &str) -> bool {
    let chars: Vec<char> = sql.chars().collect();
    let mut scan = TopLevelScan {
        chars: &chars,
        position: 0,
        depth: 0,
    };
    while let Some(position) = next_top_level_position(&mut scan) {
        if is_limit_keyword_at(&chars, position) {
            return true;
        }
        scan.position += 1;
    }
    false
}

pub fn has_multiple_statements(sql: &str) -> bool {
    let stripped = strip_non_executable_comments(sql);
    let mut quote: Option<char> = None;
    let mut chars = stripped.char_indices();
    while let Some((position, ch)) = chars.next() {
        match quote {
            Some(_) if ch == '\\' => {
                chars.next();
            }
            Some(open_quote) if ch == open_quote => quote = None,
            Some(_) => {}
            None if matches!(ch, '\'' | '"' | '`') => quote = Some(ch),
            None if ch == ';' => {
                return !stripped[position + 1..]
                    .trim_matches(is_statement_terminator_padding)
                    .is_empty();
            }
            None => {}
        }
    }
    false
}

pub(super) fn has_into_outfile(sql: &str) -> bool {
    let upper = sql.to_uppercase();
    upper.contains("INTO OUTFILE")
}

pub(super) fn find_trailing_lock_clause(sql: &str) -> Option<usize> {
    let upper = sql.trim_end().to_uppercase();
    let patterns = ["FOR UPDATE", "FOR SHARE", "LOCK IN SHARE MODE"];
    for pat in &patterns {
        if upper.ends_with(pat) {
            return Some(sql.trim_end().len() - pat.len());
        }
    }
    None
}

pub fn has_locking_clause(sql: &str) -> bool {
    let tokens = LockingClauseTokenizer::new(sql).tokenize();
    (0..tokens.len()).any(|token_index| is_locking_clause_at(&tokens, token_index))
}

const LOCKING_CLAUSE_KEYWORDS: [&[&str]; 3] = [
    &["FOR", "UPDATE"],
    &["FOR", "SHARE"],
    &["LOCK", "IN", "SHARE", "MODE"],
];

fn is_locking_clause_at(tokens: &[Option<String>], token_index: usize) -> bool {
    LOCKING_CLAUSE_KEYWORDS
        .iter()
        .any(|keywords| has_keywords_at(tokens, token_index, keywords))
}

fn has_keywords_at(tokens: &[Option<String>], start_index: usize, keywords: &[&str]) -> bool {
    keywords
        .iter()
        .enumerate()
        .all(|(offset, keyword)| is_keyword_token_at(tokens, start_index + offset, keyword))
}

fn is_keyword_token_at(tokens: &[Option<String>], token_index: usize, keyword: &str) -> bool {
    tokens.get(token_index).and_then(|token| token.as_deref()) == Some(keyword)
}

struct LockingClauseTokenizer<'a> {
    chars: SqlChars<'a>,
    word: String,
    tokens: Vec<Option<String>>,
}

impl<'a> LockingClauseTokenizer<'a> {
    fn new(sql: &'a str) -> Self {
        Self {
            chars: sql.chars().peekable(),
            word: String::new(),
            tokens: Vec::new(),
        }
    }

    fn tokenize(mut self) -> Vec<Option<String>> {
        while let Some(ch) = self.chars.next() {
            self.consume(ch);
        }
        self.flush_word();
        self.tokens
    }

    fn consume(&mut self, ch: char) {
        let next_char = self.chars.peek().copied();
        if matches!(ch, '\'' | '"' | '`') {
            self.break_keyword_sequence();
            self.skip_quoted(ch);
            return;
        }
        if ch == '#' {
            self.break_keyword_sequence();
            self.skip_line();
            return;
        }
        if is_dash_comment_start(ch, next_char) {
            self.break_keyword_sequence();
            self.skip_dash_dash_comment();
            return;
        }
        if is_block_comment_start(ch, next_char) {
            self.chars.next();
            self.break_keyword_sequence();
            self.skip_block_comment();
            return;
        }
        if is_identifier_or_dollar_char(ch) {
            self.word.push(ch);
            return;
        }
        self.flush_word();
        if !ch.is_whitespace() {
            self.tokens.push(None);
        }
    }

    fn flush_word(&mut self) {
        if self.word.is_empty() {
            return;
        }
        self.tokens.push(Some(self.word.to_ascii_uppercase()));
        self.word.clear();
    }

    fn break_keyword_sequence(&mut self) {
        self.flush_word();
        self.tokens.push(None);
    }

    fn skip_line(&mut self) {
        while self.chars.next_if(|&character| character != '\n').is_some() {}
    }

    fn skip_quoted(&mut self, quote: char) {
        skip_quoted_chars(&mut self.chars, quote);
    }

    fn skip_dash_dash_comment(&mut self) {
        let mut ahead = self.chars.clone();
        ahead.next();
        let starts_comment = ahead
            .peek()
            .is_none_or(|character| is_whitespace_or_control(*character));
        if starts_comment {
            self.skip_line();
        }
    }

    fn skip_block_comment(&mut self) {
        let is_executable_or_hint = self
            .chars
            .next_if(|&character| is_executable_or_hint_marker(character))
            .is_some();
        if is_executable_or_hint {
            return;
        }
        skip_past_comment_close(&mut self.chars);
    }
}

fn skip_quoted_chars(chars: &mut SqlChars<'_>, quote: char) {
    while let Some(character) = chars.next() {
        let is_backslash_escape = character == '\\' && quote != '`';
        if is_backslash_escape {
            chars.next();
            continue;
        }
        let closes_quote = character == quote && chars.next_if_eq(&quote).is_none();
        if closes_quote {
            return;
        }
    }
}

fn skip_past_comment_close(chars: &mut SqlChars<'_>) {
    let mut previous = '\0';
    for character in chars.by_ref() {
        let closes_block_comment = previous == '*' && character == '/';
        if closes_block_comment {
            return;
        }
        previous = character;
    }
}
