//! Thin `#[tauri::command]` wrappers for table data operations.
//!
//! Each wrapper extracts the MySQL pool from `AppState`, performs read-only
//! checks for mutating operations, and delegates to the corresponding `*_impl`
//! function in `crate::mysql::table_data`.

use crate::commands::query_history_bridge::{log_single_entry, resolve_connection_context};
use crate::db::history::NewHistoryEntry;
use crate::mysql::schema_queries::safe_identifier;
use crate::mysql::table_data;
use crate::state::AppState;
use std::collections::HashMap;

/// Replaces `?` placeholders in a SQL string with their formatted values for display in history.
/// Values are formatted as:
///   - null/None → NULL
///   - strings → 'value' (single-quoted, with internal single quotes escaped as '')
///   - numbers → the number as-is
///   - booleans → 1 / 0
///   - everything else → 'value' (via Display)
pub fn interpolate_sql_params(sql: &str, params: &[serde_json::Value]) -> String {
    let mut result = String::with_capacity(sql.len() + params.len() * 8);
    let mut param_iter = params.iter();
    for ch in sql.chars() {
        if ch == '?' {
            match param_iter.next() {
                None => result.push('?'),
                Some(serde_json::Value::Null) => result.push_str("NULL"),
                Some(serde_json::Value::Bool(b)) => result.push_str(if *b { "1" } else { "0" }),
                Some(serde_json::Value::Number(n)) => result.push_str(&n.to_string()),
                Some(serde_json::Value::String(s)) => {
                    result.push('\'');
                    result.push_str(&s.replace('\'', "''"));
                    result.push('\'');
                }
                Some(other) => {
                    result.push('\'');
                    result.push_str(&other.to_string().replace('\'', "''"));
                    result.push('\'');
                }
            }
        } else {
            result.push(ch);
        }
    }
    result
}

/// Build a descriptive SELECT SQL string for history logging.
/// This reconstructs the data query using the same identifier-quoting logic
/// as the `*_impl` functions, but runs in the command wrapper so we can log
/// the SQL without changing impl signatures.
pub fn build_select_sql(
    database: &str,
    table: &str,
    filter: &[table_data::FilterCondition],
    sort: &Option<table_data::SortInfo>,
    limit: Option<(u32, u64)>,
) -> Option<String> {
    let safe_db = safe_identifier(database).ok()?;
    let safe_table = safe_identifier(table).ok()?;

    let filter_clause = table_data::translate_filter_model(filter);
    let where_sql = if filter_clause.sql.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", filter_clause.sql)
    };

    let order_sql = match sort {
        Some(s) => {
            let safe_col = safe_identifier(&s.column).ok()?;
            let dir = if s.direction == "desc" { "DESC" } else { "ASC" };
            format!(" ORDER BY {safe_col} {dir}")
        }
        None => String::new(),
    };

    let limit_sql = match limit {
        Some((page_size, offset)) => format!(" LIMIT {page_size} OFFSET {offset}"),
        None => String::new(),
    };

    Some(format!(
        "SELECT * FROM {safe_db}.{safe_table}{where_sql}{order_sql}{limit_sql}"
    ))
}

#[tauri::command]
pub async fn fetch_table_data(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    table: String,
    page: u32,
    page_size: u32,
    sort_column: Option<String>,
    sort_direction: Option<String>,
    filter_model: Option<Vec<table_data::FilterCondition>>,
) -> Result<table_data::TableDataResponse, String> {
    if page_size == 0 {
        return Err("page_size must be at least 1".to_string());
    }

    let pool = state
        .registry
        .get_pool(&connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let sort = match (sort_column, sort_direction) {
        (Some(column), Some(direction)) => Some(table_data::SortInfo { column, direction }),
        _ => None,
    };

    let filter = filter_model.unwrap_or_default();

    let page_clamped = if page < 1 { 1 } else { page };
    let offset = (page_clamped - 1) as u64 * page_size as u64;
    let filter_clause = table_data::translate_filter_model(&filter);
    let raw_sql = build_select_sql(&database, &table, &filter, &sort, Some((page_size, offset)))
        .unwrap_or_else(|| {
            format!("SELECT * FROM `{database}`.`{table}` LIMIT {page_size} OFFSET {offset}")
        });
    let sql_text = interpolate_sql_params(&raw_sql, &filter_clause.params);

    let result = table_data::fetch_table_data_impl(
        &pool,
        &database,
        &table,
        page,
        page_size,
        sort,
        filter,
        &connection_id,
    )
    .await;

    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);

    log_single_entry(
        &state.db,
        NewHistoryEntry {
            connection_id: conn_id,
            database_name,
            sql_text,
            duration_ms: Some(
                result
                    .as_ref()
                    .map(|r| r.execution_time_ms as i64)
                    .unwrap_or(0),
            ),
            row_count: Some(
                result
                    .as_ref()
                    .map(|r| r.total_rows as i64)
                    .unwrap_or(0),
            ),
            affected_rows: Some(0),
            success: result.is_ok(),
            error_message: result.as_ref().err().cloned(),
        },
    );

    result
}

#[tauri::command]
pub async fn update_table_row(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    table: String,
    primary_key_columns: Vec<String>,
    original_pk_values: HashMap<String, serde_json::Value>,
    updated_values: HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    if state.registry.is_read_only(&connection_id) {
        return Err("Connection is read-only".to_string());
    }

    let pool = state
        .registry
        .get_pool(&connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Build a descriptive SQL text for history
    let mut sorted_update_keys: Vec<&String> = updated_values.keys().collect();
    sorted_update_keys.sort();
    let set_cols: Vec<String> = sorted_update_keys
        .iter()
        .map(|k| format!("`{k}` = ?"))
        .collect();
    let where_cols: Vec<String> = primary_key_columns
        .iter()
        .map(|k| format!("`{k}` = ?"))
        .collect();
    let raw_sql = format!(
        "UPDATE `{database}`.`{table}` SET {} WHERE {}",
        set_cols.join(", "),
        where_cols.join(" AND ")
    );
    // Collect params in the same order: SET values (sorted) then WHERE values (pk order)
    let mut history_params: Vec<serde_json::Value> = sorted_update_keys
        .iter()
        .map(|k| updated_values[*k].clone())
        .collect();
    for pk_col in &primary_key_columns {
        history_params.push(
            original_pk_values
                .get(pk_col)
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        );
    }
    let sql_text = interpolate_sql_params(&raw_sql, &history_params);

    let start = std::time::Instant::now();
    let result = table_data::update_table_row_impl(
        &pool,
        &database,
        &table,
        &primary_key_columns,
        &original_pk_values,
        &updated_values,
    )
    .await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);

    log_single_entry(
        &state.db,
        NewHistoryEntry {
            connection_id: conn_id,
            database_name,
            sql_text,
            duration_ms: Some(duration_ms),
            row_count: Some(0),
            affected_rows: Some(if result.is_ok() { 1 } else { 0 }),
            success: result.is_ok(),
            error_message: result.as_ref().err().cloned(),
        },
    );

    result
}

#[tauri::command]
pub async fn insert_table_row(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    table: String,
    values: HashMap<String, serde_json::Value>,
    pk_info: table_data::PrimaryKeyInfo,
) -> Result<Vec<(String, serde_json::Value)>, String> {
    if state.registry.is_read_only(&connection_id) {
        return Err("Connection is read-only".to_string());
    }

    let pool = state
        .registry
        .get_pool(&connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Build a descriptive SQL text for history
    let mut sorted_keys: Vec<&String> = values.keys().collect();
    sorted_keys.sort();
    let col_names: Vec<String> = sorted_keys
        .iter()
        .map(|k| format!("`{k}`"))
        .collect();
    let placeholders: Vec<&str> = vec!["?"; col_names.len()];
    let raw_sql = format!(
        "INSERT INTO `{database}`.`{table}` ({}) VALUES ({})",
        col_names.join(", "),
        placeholders.join(", ")
    );
    let history_params: Vec<serde_json::Value> = sorted_keys
        .iter()
        .map(|k| values[*k].clone())
        .collect();
    let sql_text = interpolate_sql_params(&raw_sql, &history_params);

    let start = std::time::Instant::now();
    let result =
        table_data::insert_table_row_impl(&pool, &database, &table, &values, &pk_info).await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);

    log_single_entry(
        &state.db,
        NewHistoryEntry {
            connection_id: conn_id,
            database_name,
            sql_text,
            duration_ms: Some(duration_ms),
            row_count: Some(0),
            affected_rows: Some(if result.is_ok() { 1 } else { 0 }),
            success: result.is_ok(),
            error_message: result.as_ref().err().cloned(),
        },
    );

    result
}

#[tauri::command]
pub async fn delete_table_row(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    table: String,
    pk_columns: Vec<String>,
    pk_values: HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    if state.registry.is_read_only(&connection_id) {
        return Err("Connection is read-only".to_string());
    }

    let pool = state
        .registry
        .get_pool(&connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Build a descriptive SQL text for history
    let where_cols: Vec<String> = pk_columns
        .iter()
        .map(|k| format!("`{k}` = ?"))
        .collect();
    let raw_sql = format!(
        "DELETE FROM `{database}`.`{table}` WHERE {}",
        where_cols.join(" AND ")
    );
    let history_params: Vec<serde_json::Value> = pk_columns
        .iter()
        .map(|k| {
            pk_values
                .get(k)
                .cloned()
                .unwrap_or(serde_json::Value::Null)
        })
        .collect();
    let sql_text = interpolate_sql_params(&raw_sql, &history_params);

    let start = std::time::Instant::now();
    let result =
        table_data::delete_table_row_impl(&pool, &database, &table, &pk_columns, &pk_values)
            .await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);

    log_single_entry(
        &state.db,
        NewHistoryEntry {
            connection_id: conn_id,
            database_name,
            sql_text,
            duration_ms: Some(duration_ms),
            row_count: Some(0),
            affected_rows: Some(if result.is_ok() { 1 } else { 0 }),
            success: result.is_ok(),
            error_message: result.as_ref().err().cloned(),
        },
    );

    result
}

#[tauri::command]
pub async fn export_table_data(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    table: String,
    format: String,
    file_path: String,
    include_headers: bool,
    table_name_for_sql: String,
    filter_model: Option<Vec<table_data::FilterCondition>>,
    sort_column: Option<String>,
    sort_direction: Option<String>,
) -> Result<(), String> {
    let pool = state
        .registry
        .get_pool(&connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let sort = match (sort_column, sort_direction) {
        (Some(column), Some(direction)) => Some(table_data::SortInfo { column, direction }),
        _ => None,
    };

    let filter = filter_model.unwrap_or_default();

    // Build descriptive SQL for history (export = SELECT without LIMIT)
    let filter_clause = table_data::translate_filter_model(&filter);
    let raw_sql = build_select_sql(&database, &table, &filter, &sort, None).unwrap_or_else(
        || format!("SELECT * FROM `{database}`.`{table}` /* export to {format} */"),
    );
    let sql_text = interpolate_sql_params(&raw_sql, &filter_clause.params);

    let options = table_data::ExportTableOptions {
        connection_id: connection_id.clone(),
        database,
        table,
        format,
        file_path,
        include_headers,
        table_name_for_sql,
        filter_model: filter,
        sort,
    };

    let start = std::time::Instant::now();
    let result = table_data::export_table_data_impl(&pool, &options).await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);

    log_single_entry(
        &state.db,
        NewHistoryEntry {
            connection_id: conn_id,
            database_name,
            sql_text,
            duration_ms: Some(duration_ms),
            row_count: Some(0),
            affected_rows: Some(0),
            success: result.is_ok(),
            error_message: result.as_ref().err().cloned(),
        },
    );

    result
}
