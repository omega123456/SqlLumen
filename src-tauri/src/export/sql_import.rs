//! SQL script import engine — parses .sql files into individual statements
//! (handling DELIMITER directives, comments, string literals, backticks)
//! and executes them sequentially against a MySQL connection pool.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

use crate::commands::query_history_bridge;
use crate::db::history::NewHistoryEntry;
use crate::mysql::sql_chars::{
    has_char_at, is_ascii_whitespace_at, is_escape_before_char, is_line_break_char,
};
use crate::state::{ImportError, ImportJobProgress, ImportJobStatus};

/// Parse a SQL script into individual statements, respecting:
/// - DELIMITER directives (e.g. `DELIMITER //`)
/// - Single-line comments (`--` and `#`)
/// - Multi-line comments (`/* ... */`)
/// - String literals (`'...'` and `"..."`) with escape handling
/// - Backtick-quoted identifiers
///
/// Returns a `Vec<String>` of non-empty, trimmed statements (without trailing delimiter).
pub fn parse_sql_statements(input: &str) -> Vec<String> {
    let mut statements: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut delimiter = ";".to_string();

    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut position = 0;

    while position < len {
        let ch = chars[position];

        // --- Check for DELIMITER directive at the start of a line (or start of input) ---
        let is_delimiter_keyword = is_at_line_start(&chars, position)
            && remaining_starts_with_ci(&chars, position, "DELIMITER");
        if is_delimiter_keyword {
            let after = position + "DELIMITER".len();
            if is_ascii_whitespace_at(&chars, after) {
                // Flush any pending statement
                let trimmed = current.trim().to_string();
                if !trimmed.is_empty() {
                    statements.push(trimmed);
                }
                current.clear();

                // Skip whitespace after DELIMITER keyword
                let mut scan_position = after;
                while is_inline_whitespace_at(&chars, scan_position) {
                    scan_position += 1;
                }

                // Read the new delimiter until end of line
                let mut new_delim = String::new();
                while is_within_line(&chars, scan_position) {
                    new_delim.push(chars[scan_position]);
                    scan_position += 1;
                }

                let new_delim = new_delim.trim().to_string();
                if !new_delim.is_empty() {
                    delimiter = new_delim;
                }

                // Skip the newline
                position = scan_position;
                if has_char_at(&chars, position, '\r') {
                    position += 1;
                }
                if has_char_at(&chars, position, '\n') {
                    position += 1;
                }
                continue;
            }
        }

        // --- Single-line comment: -- (followed by space or end) ---
        let starts_dash_comment = ch == '-' && has_char_at(&chars, position + 1, '-');
        if starts_dash_comment {
            // MySQL requires space after -- for comment, but we're lenient
            // Skip to end of line
            while is_before_newline(&chars, position) {
                position += 1;
            }
            // Keep the newline in current to preserve formatting
            if position < len {
                current.push(chars[position]);
                position += 1;
            }
            continue;
        }

        // --- Single-line comment: # ---
        if ch == '#' {
            while is_before_newline(&chars, position) {
                position += 1;
            }
            if position < len {
                current.push(chars[position]);
                position += 1;
            }
            continue;
        }

        // --- Multi-line comment: /* ... */ ---
        // MySQL conditional comments /*!...*/ are preserved as executable SQL.
        let starts_block_comment = ch == '/' && has_char_at(&chars, position + 1, '*');
        if starts_block_comment {
            let is_conditional_comment = position + 2 < len && chars[position + 2] == '!';
            if is_conditional_comment {
                let body_start = position + "/*!".len();
                let close = find_block_comment_close(&chars, body_start);
                current.extend(&chars[body_start..close]);
                position = (close + "*/".len()).min(len);
                continue;
            }
            let close = find_block_comment_close(&chars, position + "/*".len());
            position = (close + "*/".len()).min(len);
            // Add a space to prevent token concatenation
            current.push(' ');
            continue;
        }

        // --- String literal: single-quoted ---
        if ch == '\'' {
            current.push(ch);
            position += 1;
            while position < len {
                let character = chars[position];
                current.push(character);
                if is_escape_before_char(&chars, position) {
                    // Escaped character
                    position += 1;
                    current.push(chars[position]);
                    position += 1;
                    continue;
                }
                if character == '\'' {
                    // Check for escaped quote ''
                    if has_char_at(&chars, position + 1, '\'') {
                        position += 1;
                        current.push(chars[position]);
                        position += 1;
                        continue;
                    }
                    position += 1;
                    break;
                }
                position += 1;
            }
            continue;
        }

        // --- String literal: double-quoted ---
        if ch == '"' {
            current.push(ch);
            position += 1;
            while position < len {
                let character = chars[position];
                current.push(character);
                if is_escape_before_char(&chars, position) {
                    position += 1;
                    current.push(chars[position]);
                    position += 1;
                    continue;
                }
                if character == '"' {
                    if has_char_at(&chars, position + 1, '"') {
                        position += 1;
                        current.push(chars[position]);
                        position += 1;
                        continue;
                    }
                    position += 1;
                    break;
                }
                position += 1;
            }
            continue;
        }

        // --- Backtick-quoted identifier ---
        if ch == '`' {
            current.push(ch);
            position += 1;
            while position < len {
                let character = chars[position];
                current.push(character);
                if character == '`' {
                    // Check for escaped backtick ``
                    if has_char_at(&chars, position + 1, '`') {
                        position += 1;
                        current.push(chars[position]);
                        position += 1;
                        continue;
                    }
                    position += 1;
                    break;
                }
                position += 1;
            }
            continue;
        }

        // --- Check for delimiter match ---
        if remaining_starts_with(&chars, position, &delimiter) {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                statements.push(trimmed);
            }
            current.clear();
            position += delimiter.len();
            continue;
        }

        // --- Default: append character ---
        current.push(ch);
        position += 1;
    }

    // Flush any remaining statement
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        statements.push(trimmed);
    }

    statements
}

/// Execute a SQL import job asynchronously.
///
/// Reads statements from the given file, executes them sequentially against
/// the MySQL pool, and updates the shared progress map.  Emits `tracing`
/// spans for observability and logs a single summary history entry at the end.
///
/// # Arguments
/// * `pool` — MySQL connection pool
/// * `file_path` — Path to the .sql file
/// * `stop_on_error` — If true, stop executing after the first error
/// * `job_id` — Unique job identifier
/// * `import_jobs` — Shared progress map (lives on `AppState`)
/// * `db` — SQLite handle for history logging
/// * `connection_id` — Resolved profile/connection id for history logging
pub fn execute_sql_import(
    pool: &sqlx::MySqlPool,
    file_path: &str,
    stop_on_error: bool,
    job_id: &str,
    import_jobs: &Arc<RwLock<HashMap<String, ImportJobProgress>>>,
    db: &Arc<Mutex<rusqlite::Connection>>,
    connection_id: &str,
) -> Result<(), String> {
    let rt = tokio::runtime::Handle::try_current()
        .map_err(|error| format!("No tokio runtime: {error}"))?;

    let start_time = std::time::Instant::now();

    // Extract filename for logging
    let filename = std::path::Path::new(file_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(file_path);

    // Read the file
    let content = std::fs::read_to_string(file_path)
        .map_err(|error| format!("Failed to read file '{}': {error}", file_path))?;

    // Parse statements
    let statements = parse_sql_statements(&content);

    tracing::info!(
        job_id = %job_id,
        connection_id = %connection_id,
        filename = %filename,
        total_statements = statements.len(),
        "SQL import started"
    );

    // Update total count
    {
        let mut jobs = import_jobs
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(progress) = jobs.get_mut(job_id) {
            progress.statements_total = statements.len();
        }
    }

    let mut tally = ImportTally::default();
    let mut statement_history_entries: Vec<NewHistoryEntry> = Vec::new();

    for (index, sql) in statements.iter().enumerate() {
        // Check for cancellation
        {
            let jobs = import_jobs
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(progress) = jobs.get(job_id) {
                if progress.cancel_requested {
                    // Mark as cancelled and return
                    drop(jobs);
                    let mut jobs = import_jobs
                        .write()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    if let Some(progress) = jobs.get_mut(job_id) {
                        progress.status = ImportJobStatus::Cancelled;
                        progress.completed_at = Some(std::time::SystemTime::now());
                    }

                    let elapsed_ms = start_time.elapsed().as_millis() as i64;
                    tracing::info!(
                        job_id = %job_id,
                        connection_id = %connection_id,
                        statements_executed = tally.statements_executed,
                        error_count = tally.error_count,
                        elapsed_ms = elapsed_ms,
                        "SQL import cancelled"
                    );

                    query_history_bridge::log_batch_entries(
                        db,
                        std::mem::take(&mut statement_history_entries),
                    );
                    log_import_history(
                        db,
                        ImportHistorySummary {
                            connection_id,
                            filename,
                            tally,
                            elapsed_ms,
                            cancelled: true,
                        },
                    );

                    return Ok(());
                }
            }
        }

        let sql_preview = statement_preview(sql, LOG_PREVIEW_CHARS, "…");
        tracing::debug!(
            job_id = %job_id,
            statement_index = index,
            sql_preview = %sql_preview,
            "Executing import statement"
        );

        // Execute the statement
        let stmt_start = std::time::Instant::now();
        let result = rt.block_on(async {
            sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
                .execute(pool)
                .await
        });
        let stmt_elapsed_ms = stmt_start.elapsed().as_millis() as i64;

        // Update progress
        {
            let mut jobs = import_jobs
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(progress) = jobs.get_mut(job_id) {
                progress.statements_done = index + 1;
                tally.statements_executed += 1;

                match &result {
                    Ok(query_result) => {
                        tally.total_rows_affected += query_result.rows_affected();
                        statement_history_entries.push(NewHistoryEntry {
                            connection_id: connection_id.to_string(),
                            database_name: None,
                            sql_text: sql.clone(),
                            duration_ms: Some(stmt_elapsed_ms),
                            row_count: Some(0),
                            affected_rows: Some(query_result.rows_affected() as i64),
                            success: true,
                            error_message: None,
                        });
                    }
                    Err(error) => {
                        let error_text = error.to_string();
                        tracing::warn!(
                            job_id = %job_id,
                            statement_index = index,
                            error = %error_text,
                            sql_preview = %sql_preview,
                            "Import statement failed"
                        );

                        tally.error_count += 1;
                        tally.last_error_message = Some(error_text.clone());

                        let preview = statement_preview(sql, ERROR_PREVIEW_CHARS, "...");
                        progress.errors.push(ImportError {
                            statement_index: index,
                            sql_preview: preview,
                            error_message: error_text,
                        });

                        if stop_on_error {
                            progress.status = ImportJobStatus::Failed;
                            progress.completed_at = Some(std::time::SystemTime::now());

                            let elapsed_ms = start_time.elapsed().as_millis() as i64;
                            tracing::info!(
                                job_id = %job_id,
                                connection_id = %connection_id,
                                statements_executed = tally.statements_executed,
                                error_count = tally.error_count,
                                elapsed_ms = elapsed_ms,
                                "SQL import stopped on error"
                            );

                            query_history_bridge::log_batch_entries(
                                db,
                                std::mem::take(&mut statement_history_entries),
                            );
                            log_import_history(
                                db,
                                ImportHistorySummary {
                                    connection_id,
                                    filename,
                                    tally,
                                    elapsed_ms,
                                    cancelled: false,
                                },
                            );

                            return Ok(());
                        }
                    }
                }
            }
        }
    }

    let elapsed_ms = start_time.elapsed().as_millis() as i64;

    tracing::info!(
        job_id = %job_id,
        connection_id = %connection_id,
        statements_executed = tally.statements_executed,
        error_count = tally.error_count,
        total_rows_affected = tally.total_rows_affected,
        elapsed_ms = elapsed_ms,
        "SQL import completed"
    );

    // Mark as completed
    {
        let mut jobs = import_jobs
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(progress) = jobs.get_mut(job_id) {
            if progress.status == ImportJobStatus::Running {
                progress.status = ImportJobStatus::Completed;
                progress.completed_at = Some(std::time::SystemTime::now());
            }
        }
    }

    query_history_bridge::log_batch_entries(db, std::mem::take(&mut statement_history_entries));
    log_import_history(
        db,
        ImportHistorySummary {
            connection_id,
            filename,
            tally,
            elapsed_ms,
            cancelled: false,
        },
    );

    Ok(())
}

#[derive(Default)]
struct ImportTally {
    statements_executed: usize,
    error_count: usize,
    total_rows_affected: u64,
    last_error_message: Option<String>,
}

struct ImportHistorySummary<'a> {
    connection_id: &'a str,
    filename: &'a str,
    tally: ImportTally,
    elapsed_ms: i64,
    cancelled: bool,
}

fn import_status_label(cancelled: bool, error_count: usize) -> &'static str {
    if cancelled {
        return "cancelled";
    }
    if error_count > 0 {
        return "with errors";
    }
    "OK"
}

/// Log a single summary history entry for a SQL import job.
fn log_import_history(db: &Arc<Mutex<rusqlite::Connection>>, summary: ImportHistorySummary<'_>) {
    let tally = summary.tally;
    let success = tally.error_count == 0 && !summary.cancelled;
    let status_label = import_status_label(summary.cancelled, tally.error_count);
    let sql_text = format!(
        "/* SQL Import: {} — {} statements, {} errors, {} */",
        summary.filename, tally.statements_executed, tally.error_count, status_label
    );

    query_history_bridge::log_single_entry(
        db,
        NewHistoryEntry {
            connection_id: summary.connection_id.to_string(),
            database_name: None,
            sql_text,
            duration_ms: Some(summary.elapsed_ms),
            row_count: Some(0),
            affected_rows: Some(tally.total_rows_affected as i64),
            success,
            error_message: tally.last_error_message,
        },
    );
}

// ── Helpers ──────────────────────────────────────────────────────────────

/// Check if position `i` is at the start of a line (or start of input).
fn is_within_line(chars: &[char], position: usize) -> bool {
    chars
        .get(position)
        .is_some_and(|character| !is_line_break_char(*character))
}

fn is_inline_whitespace_at(chars: &[char], position: usize) -> bool {
    is_within_line(chars, position) && is_ascii_whitespace_at(chars, position)
}

fn is_before_newline(chars: &[char], position: usize) -> bool {
    chars
        .get(position)
        .is_some_and(|character| *character != '\n')
}

fn is_at_line_start(chars: &[char], position: usize) -> bool {
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
        if !chars[scan_position].is_ascii_whitespace() {
            return false;
        }
    }
    // Reached start of input with only whitespace before
    true
}

/// Case-insensitive prefix match at position `i`.
fn remaining_starts_with_ci(chars: &[char], position: usize, pattern: &str) -> bool {
    let pat_chars: Vec<char> = pattern.chars().collect();
    if position + pat_chars.len() > chars.len() {
        return false;
    }
    for (offset, pc) in pat_chars.iter().enumerate() {
        if !chars[position + offset].eq_ignore_ascii_case(pc) {
            return false;
        }
    }
    true
}

/// Exact prefix match at position `i`.
fn remaining_starts_with(chars: &[char], position: usize, pattern: &str) -> bool {
    let pat_chars: Vec<char> = pattern.chars().collect();
    if position + pat_chars.len() > chars.len() {
        return false;
    }
    for (offset, pc) in pat_chars.iter().enumerate() {
        if chars[position + offset] != *pc {
            return false;
        }
    }
    true
}

const LOG_PREVIEW_CHARS: usize = 80;
const ERROR_PREVIEW_CHARS: usize = 120;

fn statement_preview(sql: &str, max_len: usize, ellipsis: &str) -> String {
    if sql.len() <= max_len {
        return sql.to_string();
    }
    format!("{}{ellipsis}", &sql[..max_len])
}

fn find_block_comment_close(chars: &[char], start: usize) -> usize {
    let mut position = start;
    while position < chars.len() {
        let closes_comment =
            chars[position] == '*' && position + 1 < chars.len() && chars[position + 1] == '/';
        if closes_comment {
            return position;
        }
        position += 1;
    }
    chars.len()
}
