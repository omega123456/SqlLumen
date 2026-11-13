use super::*;

pub(super) const DELIMITER_KEYWORD: &str = "DELIMITER";
pub(super) const DEFAULT_DELIMITER: &str = ";";
pub(super) const BLOCK_COMMENT_OPEN: &str = "/*";
pub(super) const CONDITIONAL_COMMENT_OPEN: &str = "/*!";
pub(super) const BLOCK_COMMENT_CLOSE: &str = "*/";

#[derive(Clone, Copy)]
pub(super) struct QuoteStyle {
    pub(super) character: char,
    pub(super) allows_backslash_escape: bool,
}

pub(super) const QUOTE_STYLES: [QuoteStyle; 3] = [
    QuoteStyle {
        character: '\'',
        allows_backslash_escape: true,
    },
    QuoteStyle {
        character: '"',
        allows_backslash_escape: true,
    },
    QuoteStyle {
        character: '`',
        allows_backslash_escape: false,
    },
];

pub(super) struct SqlScriptParser {
    pub(super) chars: Vec<char>,
    pub(super) position: usize,
    pub(super) current: String,
    pub(super) delimiter: String,
    pub(super) statements: Vec<String>,
}

impl SqlScriptParser {
    pub(super) fn new(input: &str) -> Self {
        Self {
            chars: input.chars().collect(),
            position: 0,
            current: String::new(),
            delimiter: DEFAULT_DELIMITER.to_string(),
            statements: Vec::new(),
        }
    }

    pub(super) fn has_more(&self) -> bool {
        self.position < self.chars.len()
    }

    pub(super) fn current_char(&self) -> char {
        self.chars[self.position]
    }

    pub(super) fn push_current_char(&mut self) {
        self.current.push(self.chars[self.position]);
        self.position += 1;
    }

    pub(super) fn skip_char(&mut self, expected: char) {
        if has_char_at(&self.chars, self.position, expected) {
            self.position += 1;
        }
    }

    pub(super) fn flush_statement(&mut self) {
        let trimmed = self.current.trim().to_string();
        if !trimmed.is_empty() {
            self.statements.push(trimmed);
        }
        self.current.clear();
    }

    pub(super) fn step(&mut self) {
        if self.try_delimiter_directive() {
            return;
        }
        if self.try_line_comment() {
            return;
        }
        if self.try_block_comment() {
            return;
        }
        if self.try_quoted_text() {
            return;
        }
        if self.try_statement_delimiter() {
            return;
        }
        self.push_current_char();
    }

    pub(super) fn try_delimiter_directive(&mut self) -> bool {
        let is_delimiter_keyword = is_at_line_start(&self.chars, self.position)
            && has_text_at_ignore_ascii_case(&self.chars, self.position, DELIMITER_KEYWORD);
        if !is_delimiter_keyword {
            return false;
        }
        let after = self.position + DELIMITER_KEYWORD.len();
        if !is_ascii_whitespace_at(&self.chars, after) {
            return false;
        }
        self.flush_statement();

        let mut scan_position = after;
        while is_inline_whitespace_at(&self.chars, scan_position) {
            scan_position += 1;
        }
        let mut new_delim = String::new();
        while is_within_line(&self.chars, scan_position) {
            new_delim.push(self.chars[scan_position]);
            scan_position += 1;
        }
        let new_delim = new_delim.trim();
        if !new_delim.is_empty() {
            self.delimiter = new_delim.to_string();
        }

        self.position = scan_position;
        self.skip_char('\r');
        self.skip_char('\n');
        true
    }

    pub(super) fn try_line_comment(&mut self) -> bool {
        let character = self.current_char();
        // MySQL requires a space after `--`, but the parser is lenient.
        let starts_dash_comment =
            character == '-' && has_char_at(&self.chars, self.position + 1, '-');
        let starts_line_comment = starts_dash_comment || character == '#';
        if !starts_line_comment {
            return false;
        }
        while is_before_newline(&self.chars, self.position) {
            self.position += 1;
        }
        // Keep the newline in the statement to preserve formatting.
        if self.has_more() {
            self.push_current_char();
        }
        true
    }

    pub(super) fn try_block_comment(&mut self) -> bool {
        let starts_block_comment =
            self.current_char() == '/' && has_char_at(&self.chars, self.position + 1, '*');
        if !starts_block_comment {
            return false;
        }
        let char_count = self.chars.len();
        // MySQL conditional comments /*!...*/ are preserved as executable SQL.
        let is_conditional_comment = has_char_at(&self.chars, self.position + 2, '!');
        if is_conditional_comment {
            let body_start = self.position + CONDITIONAL_COMMENT_OPEN.len();
            let close = find_block_comment_close(&self.chars, body_start);
            self.current.extend(&self.chars[body_start..close]);
            self.position = (close + BLOCK_COMMENT_CLOSE.len()).min(char_count);
            return true;
        }
        let close = find_block_comment_close(&self.chars, self.position + BLOCK_COMMENT_OPEN.len());
        self.position = (close + BLOCK_COMMENT_CLOSE.len()).min(char_count);
        // Add a space to prevent token concatenation
        self.current.push(' ');
        true
    }

    pub(super) fn try_quoted_text(&mut self) -> bool {
        let character = self.current_char();
        let Some(quote) = QUOTE_STYLES
            .into_iter()
            .find(|style| style.character == character)
        else {
            return false;
        };
        self.push_current_char();
        while self.has_more() && self.consume_quoted_char(quote) {}
        true
    }

    pub(super) fn consume_quoted_char(&mut self, quote: QuoteStyle) -> bool {
        let character = self.current_char();
        let is_escaped =
            quote.allows_backslash_escape && is_escape_before_char(&self.chars, self.position);
        self.push_current_char();
        if is_escaped {
            self.push_current_char();
            return true;
        }
        if character != quote.character {
            return true;
        }
        let is_doubled_quote = has_char_at(&self.chars, self.position, quote.character);
        if is_doubled_quote {
            self.push_current_char();
            return true;
        }
        false
    }

    pub(super) fn try_statement_delimiter(&mut self) -> bool {
        if !has_text_at(&self.chars, self.position, &self.delimiter) {
            return false;
        }
        self.flush_statement();
        self.position += self.delimiter.len();
        true
    }

    pub(super) fn finish(mut self) -> Vec<String> {
        self.flush_statement();
        self.statements
    }
}

/// Parse a SQL script into individual statements, respecting:
/// - DELIMITER directives (e.g. `DELIMITER //`)
/// - Single-line comments (`--` and `#`)
/// - Multi-line comments (`/* ... */`)
/// - String literals (`'...'` and `"..."`) with escape handling
/// - Backtick-quoted identifiers
///
/// Returns a `Vec<String>` of non-empty, trimmed statements (without trailing delimiter).
pub fn parse_sql_statements(input: &str) -> Vec<String> {
    let mut parser = SqlScriptParser::new(input);
    while parser.has_more() {
        parser.step();
    }
    parser.finish()
}

/// Check if position `i` is at the start of a line (or start of input).
pub(super) fn is_within_line(chars: &[char], position: usize) -> bool {
    chars
        .get(position)
        .is_some_and(|character| !is_line_break_char(*character))
}

pub(super) fn is_inline_whitespace_at(chars: &[char], position: usize) -> bool {
    is_within_line(chars, position) && is_ascii_whitespace_at(chars, position)
}

pub(super) fn is_before_newline(chars: &[char], position: usize) -> bool {
    chars
        .get(position)
        .is_some_and(|character| *character != '\n')
}

pub(super) fn is_at_line_start(chars: &[char], position: usize) -> bool {
    if position == 0 {
        return true;
    }
    // Check if the previous non-whitespace-on-same-line is a newline
    let mut scan_position = position;
    while scan_position > 0 {
        scan_position -= 1;
        if is_line_break_char(chars[scan_position]) {
            return true;
        }
        if !is_ascii_whitespace_at(chars, scan_position) {
            return false;
        }
    }
    // Reached start of input with only whitespace before
    true
}

pub(super) fn find_block_comment_close(chars: &[char], start: usize) -> usize {
    let char_count = chars.len();
    let mut position = start;
    while position < char_count {
        let closes_comment =
            has_char_at(chars, position, '*') && has_char_at(chars, position + 1, '/');
        if closes_comment {
            return position;
        }
        position += 1;
    }
    char_count
}
