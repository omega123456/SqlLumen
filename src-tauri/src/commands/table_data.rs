use crate::commands::query_history_bridge::{resolve_connection_context, single_row_count};
#[cfg(not(coverage))]
use crate::commands::requests::ConnectionTabRequest;
use crate::commands::run_blocking_with_state;
use crate::db::history::NewHistoryEntry;
use crate::mysql::result_cache::{CacheKey, VersionedValue};
use crate::mysql::schema_queries::safe_identifier;
use crate::mysql::table_data;
#[cfg(not(coverage))]
use crate::mysql::table_data::{evict_table_data_impl, touch_table_data_impl};
use crate::state::AppState;

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
        if ch != '?' {
            result.push(ch);
            continue;
        }
        push_sql_param_literal(&mut result, param_iter.next());
    }
    result
}

fn push_sql_param_literal(result: &mut String, param: Option<&serde_json::Value>) {
    match param {
        None => result.push('?'),
        Some(serde_json::Value::Null) => result.push_str("NULL"),
        Some(serde_json::Value::Bool(true)) => result.push('1'),
        Some(serde_json::Value::Bool(false)) => result.push('0'),
        Some(serde_json::Value::Number(number)) => result.push_str(&number.to_string()),
        Some(serde_json::Value::String(text)) => {
            result.push('\'');
            result.push_str(&text.replace('\'', "''"));
            result.push('\'');
        }
        Some(other) => {
            result.push('\'');
            result.push_str(&other.to_string().replace('\'', "''"));
            result.push('\'');
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PageWindow {
    pub page_size: u32,
    pub offset: u64,
}

pub struct SelectSqlSpec<'a> {
    pub database: &'a str,
    pub table: &'a str,
    pub filter: &'a [table_data::FilterCondition],
    pub sort: &'a Option<table_data::SortInfo>,
    pub limit: Option<PageWindow>,
}

pub fn build_select_sql(spec: &SelectSqlSpec<'_>) -> Option<String> {
    let safe_db = safe_identifier(spec.database).ok()?;
    let safe_table = safe_identifier(spec.table).ok()?;

    let filter_clause = table_data::translate_filter_model(spec.filter);
    let where_sql = table_data::where_clause_sql(&filter_clause.sql);

    let order_sql = match spec.sort {
        Some(sort_spec) => {
            let safe_col = safe_identifier(&sort_spec.column).ok()?;
            let dir = table_data::sort_direction_keyword(&sort_spec.direction);
            format!(" ORDER BY {safe_col} {dir}")
        }
        None => String::new(),
    };

    let limit_sql = match spec.limit {
        Some(PageWindow { page_size, offset }) => format!(" LIMIT {page_size} OFFSET {offset}"),
        None => String::new(),
    };

    Some(format!(
        "SELECT * FROM {safe_db}.{safe_table}{where_sql}{order_sql}{limit_sql}"
    ))
}

#[tauri::command]
pub async fn fetch_table_data(
    state: tauri::State<'_, AppState>,
    payload: table_data::FetchTableDataRequest,
) -> Result<table_data::TableDataResponse, String> {
    let table_data::FetchTableDataRequest {
        connection_id,
        tab_id,
        database,
        table,
        page,
        page_size,
        sort_column,
        sort_direction,
        filter_model,
    } = payload;
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
    let expected_invalidation_version = state
        .table_data_cache
        .current_invalidation_version(&connection_id, &tab_id);

    let page_clamped = page.max(1);
    let offset = (page_clamped - 1) as u64 * page_size as u64;
    let filter_clause = table_data::translate_filter_model(&filter);
    let select_spec = SelectSqlSpec {
        database: &database,
        table: &table,
        filter: &filter,
        sort: &sort,
        limit: Some(PageWindow { page_size, offset }),
    };
    let raw_sql = build_select_sql(&select_spec).unwrap_or_else(|| {
        format!("SELECT * FROM `{database}`.`{table}` LIMIT {page_size} OFFSET {offset}")
    });
    let sql_text = interpolate_sql_params(&raw_sql, &filter_clause.params);

    let context = table_data::TableDataContext {
        pool: &pool,
        connection_id: &connection_id,
        metadata_cache: &state.metadata_cache,
    };
    let query = table_data::TableDataPageQuery {
        tab_id: tab_id.clone(),
        database,
        table,
        page,
        page_size,
        sort,
        filter_model: filter,
    };
    let result = table_data::fetch_table_data_impl(&context, &state.running_queries, &query).await;

    if let Ok(response) = &result {
        let write = VersionedValue {
            expected_invalidation_version,
            value: response.clone(),
        };
        let inserted = state
            .table_data_cache
            .insert_if_current(CacheKey::new(&connection_id, &tab_id), write);
        if !inserted {
            tracing::debug!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                "skipped table-data cache insert after explicit cleanup"
            );
        }
    }

    resolve_connection_context(&state, &connection_id).log_single_entry_if_resolved(
        &state.db,
        |conn_id, database_name| NewHistoryEntry {
            connection_id: conn_id,
            database_name,
            sql_text,
            duration_ms: Some(
                result
                    .as_ref()
                    .map(|result| result.execution_time_ms as i64)
                    .unwrap_or(0),
            ),
            row_count: None,
            affected_rows: None,
            success: result.is_ok(),
            error_message: result.as_ref().err().cloned(),
        },
    );

    result
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn touch_table_data(
    payload: ConnectionTabRequest,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    run_blocking_with_state(app, move |state| {
        touch_table_data_impl(state, &payload.connection_id, &payload.tab_id)
    })
    .await
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn evict_table_data(payload: ConnectionTabRequest, state: tauri::State<'_, AppState>) {
    evict_table_data_impl(&state, &payload.connection_id, &payload.tab_id);
}

#[tauri::command]
pub async fn restore_table_data_cache<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    payload: table_data::RestoreTableDataCacheRequest,
) -> Result<table_data::TableDataCacheRestoreResponse, String> {
    run_blocking_with_state(app, move |state| {
        table_data::restore_table_data_cache_impl(state, &payload)
    })
    .await
}

async fn sync_table_data_cache_after_write<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    payload: table_data::SyncTableDataCacheRequest,
) -> Result<table_data::TableDataCacheSyncResponse, String> {
    run_blocking_with_state(app, move |state| {
        table_data::sync_table_data_cache_after_write_impl(state, payload)
    })
    .await
}

#[tauri::command]
pub async fn sync_table_data_cache_after_insert<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    payload: table_data::SyncTableDataCacheRequest,
) -> Result<table_data::TableDataCacheSyncResponse, String> {
    sync_table_data_cache_after_write(app, payload).await
}

#[tauri::command]
pub async fn sync_table_data_cache_after_update<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    payload: table_data::SyncTableDataCacheRequest,
) -> Result<table_data::TableDataCacheSyncResponse, String> {
    sync_table_data_cache_after_write(app, payload).await
}

#[tauri::command]
pub async fn sync_table_data_cache_after_delete<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    payload: table_data::SyncTableDataCacheRequest,
) -> Result<table_data::TableDataCacheSyncResponse, String> {
    sync_table_data_cache_after_write(app, payload).await
}

fn log_row_write(state: &AppState, session_id: &str, write: RowWriteHistory) {
    resolve_connection_context(state, session_id).log_single_entry_if_resolved(
        &state.db,
        |conn_id, database_name| NewHistoryEntry {
            connection_id: conn_id,
            database_name,
            sql_text: write.sql_text,
            duration_ms: Some(write.duration_ms),
            row_count: Some(0),
            affected_rows: Some(single_row_count(write.error_message.is_none())),
            success: write.error_message.is_none(),
            error_message: write.error_message,
        },
    );
}

struct RowWriteHistory {
    sql_text: String,
    duration_ms: i64,
    error_message: Option<String>,
}

impl RowWriteHistory {
    fn new<T>(
        sql_text: String,
        started_at: std::time::Instant,
        result: &Result<T, String>,
    ) -> Self {
        Self {
            sql_text,
            duration_ms: started_at.elapsed().as_millis() as i64,
            error_message: result.as_ref().err().cloned(),
        }
    }
}

fn writable_pool(state: &AppState, connection_id: &str) -> Result<sqlx::MySqlPool, String> {
    if state.registry.is_read_only(connection_id) {
        return Err("Connection is read-only".to_string());
    }
    connection_pool(state, connection_id)
}

fn connection_pool(state: &AppState, connection_id: &str) -> Result<sqlx::MySqlPool, String> {
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))
}

fn update_row_history_sql(request: &table_data::UpdateTableRowRequest) -> String {
    let database = &request.database;
    let table = &request.table;
    let mut sorted_update_keys: Vec<&String> = request.updated_values.keys().collect();
    sorted_update_keys.sort();
    let set_cols: Vec<String> = sorted_update_keys
        .iter()
        .map(|column_name| format!("`{column_name}` = ?"))
        .collect();
    let where_cols: Vec<String> = request
        .primary_key_columns
        .iter()
        .map(|column_name| format!("`{column_name}` = ?"))
        .collect();
    let raw_sql = format!(
        "UPDATE `{database}`.`{table}` SET {} WHERE {}",
        set_cols.join(", "),
        where_cols.join(" AND ")
    );
    let mut history_params: Vec<serde_json::Value> = sorted_update_keys
        .iter()
        .map(|column_name| request.updated_values[*column_name].clone())
        .collect();
    for primary_key_column in &request.primary_key_columns {
        history_params.push(
            request
                .original_primary_key_values
                .get(primary_key_column)
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        );
    }
    interpolate_sql_params(&raw_sql, &history_params)
}

#[tauri::command]
pub async fn update_table_row(
    state: tauri::State<'_, AppState>,
    payload: table_data::UpdateTableRowRequest,
) -> Result<(), String> {
    let pool = writable_pool(&state, &payload.connection_id)?;
    let sql_text = update_row_history_sql(&payload);

    let started_at = std::time::Instant::now();
    let result = table_data::update_table_row_impl(&pool, &payload).await;

    let write = RowWriteHistory::new(sql_text, started_at, &result);
    log_row_write(&state, &payload.connection_id, write);

    result
}

fn insert_row_history_sql(request: &table_data::InsertTableRowRequest) -> String {
    let database = &request.database;
    let table = &request.table;
    let mut sorted_keys: Vec<&String> = request.values.keys().collect();
    sorted_keys.sort();
    let col_names: Vec<String> = sorted_keys
        .iter()
        .map(|column_name| format!("`{column_name}`"))
        .collect();
    let placeholders: Vec<&str> = vec!["?"; col_names.len()];
    let raw_sql = format!(
        "INSERT INTO `{database}`.`{table}` ({}) VALUES ({})",
        col_names.join(", "),
        placeholders.join(", ")
    );
    let history_params: Vec<serde_json::Value> = sorted_keys
        .iter()
        .map(|column_name| request.values[*column_name].clone())
        .collect();
    interpolate_sql_params(&raw_sql, &history_params)
}

#[tauri::command]
pub async fn insert_table_row(
    state: tauri::State<'_, AppState>,
    payload: table_data::InsertTableRowRequest,
) -> Result<Vec<(String, serde_json::Value)>, String> {
    let pool = writable_pool(&state, &payload.connection_id)?;
    let sql_text = insert_row_history_sql(&payload);

    let started_at = std::time::Instant::now();
    let result = table_data::insert_table_row_impl(&pool, &state.metadata_cache, &payload).await;

    let write = RowWriteHistory::new(sql_text, started_at, &result);
    log_row_write(&state, &payload.connection_id, write);

    result
}

fn delete_row_history_sql(request: &table_data::DeleteTableRowRequest) -> String {
    let database = &request.database;
    let table = &request.table;
    let where_cols: Vec<String> = request
        .primary_key_columns
        .iter()
        .map(|column_name| format!("`{column_name}` = ?"))
        .collect();
    let raw_sql = format!(
        "DELETE FROM `{database}`.`{table}` WHERE {}",
        where_cols.join(" AND ")
    );
    let history_params: Vec<serde_json::Value> = request
        .primary_key_columns
        .iter()
        .map(|column_name| {
            request
                .primary_key_values
                .get(column_name)
                .cloned()
                .unwrap_or(serde_json::Value::Null)
        })
        .collect();
    interpolate_sql_params(&raw_sql, &history_params)
}

#[tauri::command]
pub async fn delete_table_row(
    state: tauri::State<'_, AppState>,
    payload: table_data::DeleteTableRowRequest,
) -> Result<(), String> {
    let pool = writable_pool(&state, &payload.connection_id)?;
    let sql_text = delete_row_history_sql(&payload);

    let started_at = std::time::Instant::now();
    let result = table_data::delete_table_row_impl(&pool, &payload).await;

    let write = RowWriteHistory::new(sql_text, started_at, &result);
    log_row_write(&state, &payload.connection_id, write);

    result
}

#[tauri::command]
pub async fn fetch_blob_value(
    state: tauri::State<'_, AppState>,
    payload: table_data::FetchBlobValueRequest,
) -> Result<table_data::BlobValueResponse, String> {
    let pool = connection_pool(&state, &payload.connection_id)?;
    table_data::fetch_blob_value_impl(&pool, &payload).await
}

#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<String, String> {
    table_data::read_file_bytes_impl(&path)
}

#[tauri::command]
pub fn write_file_bytes(payload: table_data::WriteFileBytesRequest) -> Result<(), String> {
    table_data::write_file_bytes_impl(&payload.path, &payload.base64)
}

#[tauri::command]
pub async fn export_table_data(
    state: tauri::State<'_, AppState>,
    payload: table_data::ExportTableDataRequest,
) -> Result<(), String> {
    let table_data::ExportTableDataRequest {
        connection_id,
        database,
        table,
        format,
        file_path,
        include_headers,
        table_name_for_sql,
        filter_model,
        sort_column,
        sort_direction,
        page,
        page_size,
    } = payload;
    let pool = state
        .registry
        .get_pool(&connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let sort = match (sort_column, sort_direction) {
        (Some(column), Some(direction)) => Some(table_data::SortInfo { column, direction }),
        _ => None,
    };

    let filter = filter_model.unwrap_or_default();

    // Build descriptive SQL for history — includes LIMIT if page/page_size are provided
    let limit_for_sql = match (page, page_size) {
        (Some(page_number), Some(page_size)) => Some(PageWindow {
            page_size,
            offset: (page_number.saturating_sub(1)) as u64 * page_size as u64,
        }),
        _ => None,
    };
    let filter_clause = table_data::translate_filter_model(&filter);
    let select_spec = SelectSqlSpec {
        database: &database,
        table: &table,
        filter: &filter,
        sort: &sort,
        limit: limit_for_sql,
    };
    let raw_sql = build_select_sql(&select_spec).unwrap_or_else(|| {
        format!("SELECT * FROM `{database}`.`{table}` /* export to {format} */")
    });
    let sql_text = interpolate_sql_params(&raw_sql, &filter_clause.params);

    let options = table_data::ExportTableOptions {
        database,
        table,
        format,
        file_path,
        include_headers,
        table_name_for_sql,
        filter_model: filter,
        sort,
        page,
        page_size,
    };

    let context = table_data::TableDataContext {
        pool: &pool,
        connection_id: &connection_id,
        metadata_cache: &state.metadata_cache,
    };
    let start = std::time::Instant::now();
    let result = table_data::export_table_data_impl(&context, &options).await;

    let duration_ms = start.elapsed().as_millis() as i64;

    resolve_connection_context(&state, &connection_id).log_single_entry_if_resolved(
        &state.db,
        |conn_id, database_name| NewHistoryEntry {
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
