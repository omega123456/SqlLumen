//! Thin `#[tauri::command]` wrappers for table data operations.
//!
//! Each wrapper extracts the MySQL pool from `AppState`, performs read-only
//! checks for mutating operations, and delegates to the corresponding `*_impl`
//! function in `crate::mysql::table_data`.

use crate::mysql::table_data;
use crate::state::AppState;
use std::collections::HashMap;

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

    table_data::fetch_table_data_impl(
        &pool,
        &database,
        &table,
        page,
        page_size,
        sort,
        filter,
        &connection_id,
    )
    .await
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

    table_data::update_table_row_impl(
        &pool,
        &database,
        &table,
        &primary_key_columns,
        &original_pk_values,
        &updated_values,
    )
    .await
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

    table_data::insert_table_row_impl(&pool, &database, &table, &values, &pk_info).await
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

    table_data::delete_table_row_impl(&pool, &database, &table, &pk_columns, &pk_values).await
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

    let options = table_data::ExportTableOptions {
        connection_id,
        database,
        table,
        format,
        file_path,
        include_headers,
        table_name_for_sql,
        filter_model: filter_model.unwrap_or_default(),
        sort,
    };

    table_data::export_table_data_impl(&pool, &options).await
}
