use crate::db::settings;
use crate::state::AppState;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::MutexGuard;
#[cfg(not(coverage))]
use tauri::State;

/// Setting key for the hard ceiling on rows kept per query-editor result.
pub const RESULTS_MAX_ROWS_KEY: &str = "results.maxRows";
/// Default `results.maxRows`.
pub const RESULTS_MAX_ROWS_DEFAULT: usize = crate::mysql::result_cache::DEFAULT_ROW_CEILING;
/// Smallest accepted `results.maxRows`.
pub const RESULTS_MAX_ROWS_MIN: usize = 1_000;
/// Largest accepted `results.maxRows`.
pub const RESULTS_MAX_ROWS_MAX: usize = 1_000_000;

/// Parse a `results.maxRows` value and clamp it to the accepted range.
/// Returns `None` for values that aren't whole numbers.
pub fn parse_results_max_rows(value: &str) -> Option<usize> {
    let parsed = value.trim().parse::<u64>().ok()?;
    let clamped = parsed.clamp(RESULTS_MAX_ROWS_MIN as u64, RESULTS_MAX_ROWS_MAX as u64);
    Some(clamped as usize)
}

/// Startup helper: read `results.maxRows` from SQLite, clamped, falling back to
/// the default when it is unset, unreadable or not a whole number.
pub fn load_results_max_rows(conn: &Connection) -> usize {
    match settings::get_setting(conn, RESULTS_MAX_ROWS_KEY) {
        Ok(Some(value)) => parse_results_max_rows(&value).unwrap_or_else(|| {
            tracing::warn!(
                key = RESULTS_MAX_ROWS_KEY,
                value = %value,
                "ignoring unparseable results.maxRows value; using the default"
            );
            RESULTS_MAX_ROWS_DEFAULT
        }),
        Ok(None) => RESULTS_MAX_ROWS_DEFAULT,
        Err(error) => {
            tracing::warn!(
                key = RESULTS_MAX_ROWS_KEY,
                %error,
                "failed to read results.maxRows; using the default"
            );
            RESULTS_MAX_ROWS_DEFAULT
        }
    }
}

// --- Testable implementations (take &AppState instead of State<AppState>) ---

fn lock_db(state: &AppState) -> Result<MutexGuard<'_, Connection>, String> {
    match state.db.lock() {
        Ok(conn) => Ok(conn),
        Err(error) => Err(error.to_string()),
    }
}

pub fn get_setting_impl(state: &AppState, key: &str) -> Result<Option<String>, String> {
    let conn = lock_db(state)?;
    match settings::get_setting(&conn, key) {
        Ok(value) => Ok(value),
        Err(error) => Err(error.to_string()),
    }
}

pub fn set_setting_impl(state: &AppState, key: &str, value: &str) -> Result<(), String> {
    let conn = lock_db(state)?;
    match settings::set_setting(&conn, key, value) {
        Ok(()) => {
            if key == crate::logging::LOG_LEVEL_SETTING_KEY {
                if let Ok(guard) = state.log_filter_reload.lock() {
                    crate::logging::reload_log_level_from_setting_value(guard.as_ref(), value);
                }
            }
            if key == "results.cacheTTL" {
                match value.parse::<u64>() {
                    Ok(secs) => {
                        state.result_cache.set_ttl(secs);
                        state.table_data_cache.set_ttl(secs);
                    }
                    Err(e) => {
                        tracing::warn!(
                            key,
                            value,
                            error = %e,
                            "ignoring unparseable results.cacheTTL value"
                        );
                    }
                }
            }
            if key == RESULTS_MAX_ROWS_KEY {
                match parse_results_max_rows(value) {
                    Some(rows) => state.result_cache.set_row_ceiling(rows),
                    None => {
                        tracing::warn!(key, value, "ignoring unparseable results.maxRows value");
                    }
                }
            }
            Ok(())
        }
        Err(error) => Err(error.to_string()),
    }
}

pub fn get_all_settings_impl(state: &AppState) -> Result<HashMap<String, String>, String> {
    let conn = lock_db(state)?;
    match settings::get_all_settings(&conn) {
        Ok(values) => Ok(values),
        Err(error) => Err(error.to_string()),
    }
}

// --- Thin Tauri command wrappers ---

#[cfg(not(coverage))]
#[tauri::command]
pub fn get_setting(key: String, state: State<AppState>) -> Result<Option<String>, String> {
    get_setting_impl(&state, &key)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn set_setting(key: String, value: String, state: State<AppState>) -> Result<(), String> {
    set_setting_impl(&state, &key, &value)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn get_all_settings(state: State<AppState>) -> Result<HashMap<String, String>, String> {
    get_all_settings_impl(&state)
}
