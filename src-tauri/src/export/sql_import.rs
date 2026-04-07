//! SQL script import engine — parses .sql files into individual statements
//! (handling DELIMITER directives, comments, string literals, backticks)
//! and executes them sequentially against a MySQL connection pool.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

use crate::commands::query_history_bridge;
use crate::db::history::NewHistoryEntry;
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
    let mut i = 0;

    while i < len {
        let ch = chars[i];

        // --- Check for DELIMITER directive at the start of a line (or start of input) ---
        if is_at_line_start(&chars, i) && remaining_starts_with_ci(&chars, i, "DELIMITER") {
            let after = i + "DELIMITER".len();
            if after < len && chars[after].is_ascii_whitespace() {
                // Flush any pending statement
                let trimmed = current.trim().to_string();
                if !trimmed.is_empty() {
                    statements.push(trimmed);
                }
                current.clear();

                // Skip whitespace after DELIMITER keyword
                let mut j = after;
                while j < len && chars[j] != '\n' && chars[j] != '\r' && chars[j].is_ascii_whitespace() {
                    j += 1;
                }

                // Read the new delimiter until end of line
                let mut new_delim = String::new();
                while j < len && chars[j] != '\n' && chars[j] != '\r' {
                    new_delim.push(chars[j]);
                    j += 1;
                }

                let new_delim = new_delim.trim().to_string();
                if !new_delim.is_empty() {
                    delimiter = new_delim;
                }

                // Skip the newline
                i = j;
                if i < len && chars[i] == '\r' {
                    i += 1;
                }
                if i < len && chars[i] == '\n' {
                    i += 1;
                }
                continue;
            }
        }

        // --- Single-line comment: -- (followed by space or end) ---
        if ch == '-' && i + 1 < len && chars[i + 1] == '-' {
            // MySQL requires space after -- for comment, but we're lenient
            // Skip to end of line
            while i < len && chars[i] != '\n' {
                i += 1;
            }
            // Keep the newline in current to preserve formatting
            if i < len {
                current.push(chars[i]);
                i += 1;
            }
            continue;
        }

        // --- Single-line comment: # ---
        if ch == '#' {
            while i < len && chars[i] != '\n' {
                i += 1;
            }
            if i < len {
                current.push(chars[i]);
                i += 1;
            }
            continue;
        }

        // --- Multi-line comment: /* ... */ ---
        // MySQL conditional comments /*!...*/ are preserved as executable SQL.
        if ch == '/' && i + 1 < len && chars[i + 1] == '*' {
            if i + 2 < len && chars[i + 2] == '!' {
                // Conditional comment /*!...*/ — treat content as executable SQL
                i += 3; // skip /*!
                while i < len {
                    if chars[i] == '*' && i + 1 < len && chars[i + 1] == '/' {
                        i += 2;
                        break;
                    }
                    current.push(chars[i]);
                    i += 1;
                }
            } else {
                // Regular block comment — skip entirely
                i += 2; // skip /*
                while i < len {
                    if chars[i] == '*' && i + 1 < len && chars[i + 1] == '/' {
                        i += 2;
                        break;
                    }
                    i += 1;
                }
                // Add a space to prevent token concatenation
                current.push(' ');
            }
            continue;
        }

        // --- String literal: single-quoted ---
        if ch == '\'' {
            current.push(ch);
            i += 1;
            while i < len {
                let c = chars[i];
                current.push(c);
                if c == '\\' && i + 1 < len {
                    // Escaped character
                    i += 1;
                    current.push(chars[i]);
                    i += 1;
                    continue;
                }
                if c == '\'' {
                    // Check for escaped quote ''
                    if i + 1 < len && chars[i + 1] == '\'' {
                        i += 1;
                        current.push(chars[i]);
                        i += 1;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // --- String literal: double-quoted ---
        if ch == '"' {
            current.push(ch);
            i += 1;
            while i < len {
                let c = chars[i];
                current.push(c);
                if c == '\\' && i + 1 < len {
                    i += 1;
                    current.push(chars[i]);
                    i += 1;
                    continue;
                }
                if c == '"' {
                    if i + 1 < len && chars[i + 1] == '"' {
                        i += 1;
                        current.push(chars[i]);
                        i += 1;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // --- Backtick-quoted identifier ---
        if ch == '`' {
            current.push(ch);
            i += 1;
            while i < len {
                let c = chars[i];
                current.push(c);
                if c == '`' {
                    // Check for escaped backtick ``
                    if i + 1 < len && chars[i + 1] == '`' {
                        i += 1;
                        current.push(chars[i]);
                        i += 1;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // --- Check for delimiter match ---
        if remaining_starts_with(&chars, i, &delimiter) {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                statements.push(trimmed);
            }
            current.clear();
            i += delimiter.len();
            continue;
        }

        // --- Default: append character ---
        current.push(ch);
        i += 1;
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
        .map_err(|e| format!("No tokio runtime: {e}"))?;

    let start_time = std::time::Instant::now();

    // Extract filename for logging
    let filename = std::path::Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(file_path);

    // Read the file
    let content = std::fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read file '{}': {e}", file_path))?;

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
        let mut jobs = import_jobs.write().unwrap_or_else(|p| p.into_inner());
        if let Some(progress) = jobs.get_mut(job_id) {
            progress.statements_total = statements.len();
        }
    }

    let mut statements_executed: usize = 0;
    let mut error_count: usize = 0;
    let mut total_rows_affected: u64 = 0;
    let mut last_error_message: Option<String> = None;
    let mut statement_history_entries: Vec<NewHistoryEntry> = Vec::new();

    for (idx, sql) in statements.iter().enumerate() {
        // Check for cancellation
        {
            let jobs = import_jobs.read().unwrap_or_else(|p| p.into_inner());
            if let Some(progress) = jobs.get(job_id) {
                if progress.cancel_requested {
                    // Mark as cancelled and return
                    drop(jobs);
                    let mut jobs = import_jobs.write().unwrap_or_else(|p| p.into_inner());
                    if let Some(progress) = jobs.get_mut(job_id) {
                        progress.status = ImportJobStatus::Cancelled;
                        progress.completed_at = Some(std::time::Instant::now());
                    }

                    let elapsed_ms = start_time.elapsed().as_millis() as i64;
                    tracing::info!(
                        job_id = %job_id,
                        connection_id = %connection_id,
                        statements_executed = statements_executed,
                        error_count = error_count,
                        elapsed_ms = elapsed_ms,
                        "SQL import cancelled"
                    );

                    query_history_bridge::log_batch_entries(
                        db,
                        std::mem::take(&mut statement_history_entries),
                    );
                    log_import_history(
                        db,
                        connection_id,
                        filename,
                        statements_executed,
                        error_count,
                        total_rows_affected,
                        elapsed_ms,
                        last_error_message,
                        true, // cancelled
                    );

                    return Ok(());
                }
            }
        }

        let sql_preview: String = if sql.len() > 80 {
            format!("{}…", &sql[..80])
        } else {
            sql.clone()
        };
        tracing::debug!(
            job_id = %job_id,
            statement_index = idx,
            sql_preview = %sql_preview,
            "Executing import statement"
        );

        // Execute the statement
        let stmt_start = std::time::Instant::now();
        let result = rt.block_on(async {
            sqlx::query(sql)
                .execute(pool)
                .await
        });
        let stmt_elapsed_ms = stmt_start.elapsed().as_millis() as i64;

        // Update progress
        {
            let mut jobs = import_jobs.write().unwrap_or_else(|p| p.into_inner());
            if let Some(progress) = jobs.get_mut(job_id) {
                progress.statements_done = idx + 1;
                statements_executed += 1;

                match &result {
                    Ok(query_result) => {
                        total_rows_affected += query_result.rows_affected();
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
                    Err(err) => {
                        let err_str = err.to_string();
                        tracing::warn!(
                            job_id = %job_id,
                            statement_index = idx,
                            error = %err_str,
                            sql_preview = %sql_preview,
                            "Import statement failed"
                        );

                        error_count += 1;
                        last_error_message = Some(err_str.clone());

                        let preview = if sql.len() > 120 {
                            format!("{}...", &sql[..120])
                        } else {
                            sql.clone()
                        };
                        progress.errors.push(ImportError {
                            statement_index: idx,
                            sql_preview: preview,
                            error_message: err_str,
                        });

                        if stop_on_error {
                            progress.status = ImportJobStatus::Failed;
                            progress.completed_at = Some(std::time::Instant::now());

                            let elapsed_ms = start_time.elapsed().as_millis() as i64;
                            tracing::info!(
                                job_id = %job_id,
                                connection_id = %connection_id,
                                statements_executed = statements_executed,
                                error_count = error_count,
                                elapsed_ms = elapsed_ms,
                                "SQL import stopped on error"
                            );

                            query_history_bridge::log_batch_entries(
                                db,
                                std::mem::take(&mut statement_history_entries),
                            );
                            log_import_history(
                                db,
                                connection_id,
                                filename,
                                statements_executed,
                                error_count,
                                total_rows_affected,
                                elapsed_ms,
                                last_error_message,
                                false, // not cancelled
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
        statements_executed = statements_executed,
        error_count = error_count,
        total_rows_affected = total_rows_affected,
        elapsed_ms = elapsed_ms,
        "SQL import completed"
    );

    // Mark as completed
    {
        let mut jobs = import_jobs.write().unwrap_or_else(|p| p.into_inner());
        if let Some(progress) = jobs.get_mut(job_id) {
            if progress.status == ImportJobStatus::Running {
                if progress.errors.is_empty() {
                    progress.status = ImportJobStatus::Completed;
                } else {
                    // Completed with errors (not stop_on_error mode)
                    progress.status = ImportJobStatus::Completed;
                }
                progress.completed_at = Some(std::time::Instant::now());
            }
        }
    }

    query_history_bridge::log_batch_entries(
        db,
        std::mem::take(&mut statement_history_entries),
    );
    log_import_history(
        db,
        connection_id,
        filename,
        statements_executed,
        error_count,
        total_rows_affected,
        elapsed_ms,
        last_error_message,
        false, // not cancelled
    );

    Ok(())
}

/// Log a single summary history entry for a SQL import job.
fn log_import_history(
    db: &Arc<Mutex<rusqlite::Connection>>,
    connection_id: &str,
    filename: &str,
    statements_executed: usize,
    error_count: usize,
    total_rows_affected: u64,
    elapsed_ms: i64,
    last_error_message: Option<String>,
    cancelled: bool,
) {
    let success = error_count == 0 && !cancelled;
    let status_label = if cancelled {
        "cancelled"
    } else if error_count > 0 {
        "with errors"
    } else {
        "OK"
    };
    let sql_text = format!(
        "/* SQL Import: {} — {} statements, {} errors, {} */",
        filename, statements_executed, error_count, status_label
    );

    query_history_bridge::log_single_entry(
        db,
        NewHistoryEntry {
            connection_id: connection_id.to_string(),
            database_name: None,
            sql_text,
            duration_ms: Some(elapsed_ms),
            row_count: Some(0),
            affected_rows: Some(total_rows_affected as i64),
            success,
            error_message: last_error_message,
        },
    );
}

// ── Helpers ──────────────────────────────────────────────────────────────

/// Check if position `i` is at the start of a line (or start of input).
fn is_at_line_start(chars: &[char], i: usize) -> bool {
    if i == 0 {
        return true;
    }
    // Check if the previous non-whitespace-on-same-line is a newline
    let mut j = i;
    while j > 0 {
        j -= 1;
        if chars[j] == '\n' || chars[j] == '\r' {
            return true;
        }
        if !chars[j].is_ascii_whitespace() {
            return false;
        }
    }
    // Reached start of input with only whitespace before
    true
}

/// Case-insensitive prefix match at position `i`.
fn remaining_starts_with_ci(chars: &[char], i: usize, pattern: &str) -> bool {
    let pat_chars: Vec<char> = pattern.chars().collect();
    if i + pat_chars.len() > chars.len() {
        return false;
    }
    for (k, pc) in pat_chars.iter().enumerate() {
        if !chars[i + k].eq_ignore_ascii_case(pc) {
            return false;
        }
    }
    true
}

/// Exact prefix match at position `i`.
fn remaining_starts_with(chars: &[char], i: usize, pattern: &str) -> bool {
    let pat_chars: Vec<char> = pattern.chars().collect();
    if i + pat_chars.len() > chars.len() {
        return false;
    }
    for (k, pc) in pat_chars.iter().enumerate() {
        if chars[i + k] != *pc {
            return false;
        }
    }
    true
}
