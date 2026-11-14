use crate::commands::helpers::lock_db;
use crate::db::settings;
use crate::state::AppState;
use rusqlite::Connection;
use serde::Deserialize;
use std::collections::HashMap;
#[cfg(not(coverage))]
use tauri::State;

pub const RESULTS_MAX_ROWS_KEY: &str = "results.maxRows";
const CACHE_TTL_KEY: &str = "results.cacheTTL";
pub const RESULTS_MAX_ROWS_DEFAULT: usize = crate::mysql::result_cache::DEFAULT_ROW_CEILING;
pub const RESULTS_MAX_ROWS_MIN: usize = 1_000;
pub const RESULTS_MAX_ROWS_MAX: usize = 1_000_000;

pub fn parse_results_max_rows(value: &str) -> Option<usize> {
    let parsed = value.trim().parse::<u64>().ok()?;
    let clamped = parsed.clamp(RESULTS_MAX_ROWS_MIN as u64, RESULTS_MAX_ROWS_MAX as u64);
    Some(clamped as usize)
}

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

pub fn get_setting_impl(state: &AppState, key: &str) -> Result<Option<String>, String> {
    let conn = lock_db(state)?;
    match settings::get_setting(&conn, key) {
        Ok(value) => Ok(value),
        Err(error) => Err(error.to_string()),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSettingRequest {
    pub key: String,
    pub value: String,
}

fn apply_log_level_setting(state: &AppState, value: &str) {
    if let Ok(guard) = state.log_filter_reload.lock() {
        crate::logging::reload_log_level_from_setting_value(guard.as_ref(), value);
    }
}

fn apply_cache_ttl_setting(state: &AppState, value: &str) {
    match value.parse::<u64>() {
        Ok(secs) => {
            state.result_cache.set_ttl(secs);
            state.table_data_cache.set_ttl(secs);
        }
        Err(error) => {
            tracing::warn!(
                key = CACHE_TTL_KEY,
                value,
                error = %error,
                "ignoring unparseable results.cacheTTL value"
            );
        }
    }
}

fn apply_results_max_rows_setting(state: &AppState, value: &str) {
    match parse_results_max_rows(value) {
        Some(rows) => state.result_cache.set_row_ceiling(rows),
        None => {
            tracing::warn!(
                key = RESULTS_MAX_ROWS_KEY,
                value,
                "ignoring unparseable results.maxRows value"
            );
        }
    }
}

fn apply_runtime_setting(state: &AppState, request: &SetSettingRequest) {
    let value = request.value.as_str();
    match request.key.as_str() {
        crate::logging::LOG_LEVEL_SETTING_KEY => apply_log_level_setting(state, value),
        CACHE_TTL_KEY => apply_cache_ttl_setting(state, value),
        RESULTS_MAX_ROWS_KEY => apply_results_max_rows_setting(state, value),
        _ => {}
    }
}

pub fn set_setting_impl(state: &AppState, request: &SetSettingRequest) -> Result<(), String> {
    let conn = lock_db(state)?;
    settings::set_setting(&conn, &request.key, &request.value)
        .map_err(|error| error.to_string())?;
    apply_runtime_setting(state, request);
    Ok(())
}

pub fn get_all_settings_impl(state: &AppState) -> Result<HashMap<String, String>, String> {
    let conn = lock_db(state)?;
    match settings::get_all_settings(&conn) {
        Ok(values) => Ok(values),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn get_setting(key: String, state: State<AppState>) -> Result<Option<String>, String> {
    get_setting_impl(&state, &key)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn set_setting(payload: SetSettingRequest, state: State<AppState>) -> Result<(), String> {
    set_setting_impl(&state, &payload)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn get_all_settings(state: State<AppState>) -> Result<HashMap<String, String>, String> {
    get_all_settings_impl(&state)
}
