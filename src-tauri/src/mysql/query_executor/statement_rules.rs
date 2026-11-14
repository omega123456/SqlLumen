use super::*;

pub fn row_limit_or_default(row_limit: Option<usize>) -> usize {
    row_limit.unwrap_or(DEFAULT_ROW_LIMIT)
}

pub fn requested_row_limit(row_limit: usize) -> usize {
    if row_limit == 0 {
        return DEFAULT_ROW_LIMIT;
    }
    row_limit
}

pub fn returns_result_set(stripped_sql: &str) -> bool {
    let keyword = get_first_keyword(stripped_sql);
    if keyword != "WITH" {
        return is_select_like(&keyword);
    }
    let main_keyword = find_with_main_keyword(stripped_sql);
    is_select_like(&main_keyword) || main_keyword.is_empty()
}

pub fn effective_row_limit(row_limit: usize, ceiling: usize) -> usize {
    requested_row_limit(row_limit).min(ceiling.max(1))
}

pub fn statement_blocked_reason(sql: &str, is_call: bool) -> Option<FullExportBlockedReason> {
    if is_call {
        return Some(FullExportBlockedReason::Call);
    }
    if has_locking_clause(sql) {
        return Some(FullExportBlockedReason::Locking);
    }
    None
}

pub fn is_select_like(keyword: &str) -> bool {
    matches!(keyword, "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN")
}

pub fn needs_auto_limit(sql: &str) -> bool {
    let stripped = strip_non_executable_comments(sql);
    let keyword = get_first_keyword(&stripped);

    match keyword.as_str() {
        "SELECT" => !has_top_level_limit(&stripped),
        "WITH" => {
            let main_kw = find_with_main_keyword(&stripped);
            main_kw == "SELECT" && !has_top_level_limit(&stripped)
        }
        _ => false,
    }
}

pub fn sql_with_auto_limit(sql: &str, auto_limit_applied: bool, limit: usize) -> String {
    if !auto_limit_applied {
        return sql.to_string();
    }
    inject_limit_into_select(sql, limit)
}

pub fn inject_limit_into_select(sql: &str, limit: usize) -> String {
    let trimmed = sql.trim_end_matches(';').trim_end();

    if has_into_outfile(trimmed) {
        return format!("{trimmed};");
    }

    if let Some(lock_start) = find_trailing_lock_clause(trimmed) {
        let before = trimmed[..lock_start].trim_end();
        let after = &trimmed[lock_start..];
        return format!("{before} LIMIT {limit} {after}");
    }

    format!("{trimmed} LIMIT {limit}")
}

pub(super) const SERVER_WIDE_VARIABLE_PREFIXES: [&str; 3] =
    ["@@GLOBAL.", "@@PERSIST.", "@@PERSIST_ONLY."];

pub const READ_ONLY_VIOLATION_MESSAGE: &str = "This connection is read-only. Only SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, USE, and SET (non-GLOBAL) statements are allowed.";

pub(super) fn is_blocked_by_read_only(state: &AppState, connection_id: &str, sql: &str) -> bool {
    state.registry.is_read_only(connection_id) && !is_read_only_allowed(sql)
}

pub fn is_read_only_allowed(sql: &str) -> bool {
    let stripped = strip_non_executable_comments(sql);
    let trimmed = stripped.trim();
    if trimmed.is_empty() {
        return true;
    }

    if has_multiple_statements(trimmed) {
        return false;
    }

    let keyword = get_first_keyword(trimmed);
    match keyword.as_str() {
        "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" | "USE" => true,
        "WITH" => {
            let main_kw = find_with_main_keyword(trimmed);
            main_kw.is_empty() || main_kw == "SELECT"
        }
        "SET" => {
            let words: Vec<&str> = trimmed.split_whitespace().collect();
            let Some(second_word) = words.get(1) else {
                return true;
            };
            let second = second_word.to_uppercase();

            if matches!(
                second.as_str(),
                "GLOBAL" | "PERSIST" | "PERSIST_ONLY" | "PASSWORD"
            ) {
                return false;
            }

            let second_upper = second.as_str();
            let sets_server_wide_variable = SERVER_WIDE_VARIABLE_PREFIXES
                .iter()
                .any(|prefix| second_upper.starts_with(prefix));
            if sets_server_wide_variable {
                return false;
            }

            true
        }
        _ => false,
    }
}

pub(super) const MAX_READ_FILE_BYTES: u64 = 50 * 1024 * 1024;

pub fn read_file_impl(path: &str) -> Result<String, String> {
    let file_path = std::path::Path::new(path);
    let metadata = std::fs::metadata(file_path)
        .map_err(|error| format!("Failed to read file metadata: {error}"))?;
    let file_size = metadata.len();
    if file_size > MAX_READ_FILE_BYTES {
        return Err("File exceeds the 50 MB limit".to_string());
    }
    let bytes =
        std::fs::read(file_path).map_err(|error| format!("Failed to read file: {error}"))?;
    String::from_utf8(bytes).map_err(|_| "File is not valid UTF-8".to_string())
}

pub fn write_file_impl(path: &str, content: &str) -> Result<(), String> {
    let file_path = std::path::Path::new(path);
    if let Some(parent) = file_path.parent() {
        if !crate::is_empty_path(parent) {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create directories: {error}"))?;
        }
    }
    std::fs::write(file_path, content).map_err(|error| format!("Failed to write file: {error}"))
}
