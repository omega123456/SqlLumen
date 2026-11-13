use crate::commands::query_history_bridge::{
    log_history_record, resolve_connection_context, run_with_history, single_row_count,
    HistoryRecord, HistoryStatement,
};
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

const FIRST_PAGE: u32 = 1;

fn sort_info_from(
    sort_column: Option<String>,
    sort_direction: Option<String>,
) -> Option<table_data::SortInfo> {
    let (Some(column), Some(direction)) = (sort_column, sort_direction) else {
        return None;
    };
    Some(table_data::SortInfo { column, direction })
}

fn page_offset(page: u32, page_size: u32) -> u64 {
    u64::from(page.saturating_sub(FIRST_PAGE)) * u64::from(page_size)
}

fn history_sql_for(spec: &SelectSqlSpec<'_>, fallback_sql: impl FnOnce() -> String) -> String {
    let raw_sql = build_select_sql(spec).unwrap_or_else(fallback_sql);
    let filter_clause = table_data::translate_filter_model(spec.filter);
    interpolate_sql_params(&raw_sql, &filter_clause.params)
}

fn fetch_history_sql(query: &table_data::TableDataPageQuery) -> String {
    let page_size = query.page_size;
    let offset = page_offset(query.page.max(FIRST_PAGE), page_size);
    let spec = SelectSqlSpec {
        database: &query.database,
        table: &query.table,
        filter: &query.filter_model,
        sort: &query.sort,
        limit: Some(PageWindow { page_size, offset }),
    };
    history_sql_for(&spec, || {
        let database = &query.database;
        let table = &query.table;
        format!("SELECT * FROM `{database}`.`{table}` LIMIT {page_size} OFFSET {offset}")
    })
}

struct FetchedPageCacheWrite<'a> {
    connection_id: &'a str,
    tab_id: &'a str,
    expected_invalidation_version: u64,
}

fn cache_fetched_page(
    state: &AppState,
    target: &FetchedPageCacheWrite<'_>,
    response: &table_data::TableDataResponse,
) {
    let write = VersionedValue {
        expected_invalidation_version: target.expected_invalidation_version,
        value: response.clone(),
    };
    let key = CacheKey::new(target.connection_id, target.tab_id);
    let inserted = state.table_data_cache.insert_if_current(key, write);
    if !inserted {
        tracing::debug!(
            connection_id = %target.connection_id,
            tab_id = %target.tab_id,
            "skipped table-data cache insert after explicit cleanup"
        );
    }
}

fn log_fetch_history(
    state: &AppState,
    statement: HistoryStatement<'_>,
    result: &Result<table_data::TableDataResponse, String>,
) {
    let duration_ms = result
        .as_ref()
        .map(|response| response.execution_time_ms as i64)
        .unwrap_or(0);
    resolve_connection_context(state, statement.session_id).log_single_entry_if_resolved(
        &state.db,
        |conn_id, database_name| NewHistoryEntry {
            connection_id: conn_id,
            database_name,
            sql_text: statement.sql_text,
            duration_ms: Some(duration_ms),
            row_count: None,
            affected_rows: None,
            success: result.is_ok(),
            error_message: result.as_ref().err().cloned(),
        },
    );
}

fn page_query_from(request: table_data::FetchTableDataRequest) -> table_data::TableDataPageQuery {
    table_data::TableDataPageQuery {
        tab_id: request.tab_id,
        database: request.database,
        table: request.table,
        page: request.page,
        page_size: request.page_size,
        sort: sort_info_from(request.sort_column, request.sort_direction),
        filter_model: request.filter_model.unwrap_or_default(),
    }
}

pub async fn fetch_table_data_with_cache(
    state: &AppState,
    request: table_data::FetchTableDataRequest,
) -> Result<table_data::TableDataResponse, String> {
    if request.page_size == 0 {
        return Err("page_size must be at least 1".to_string());
    }
    let connection_id = request.connection_id.clone();
    let pool = connection_pool(state, &connection_id)?;
    let query = page_query_from(request);
    let cache_target = FetchedPageCacheWrite {
        connection_id: &connection_id,
        tab_id: &query.tab_id,
        expected_invalidation_version: state
            .table_data_cache
            .current_invalidation_version(&connection_id, &query.tab_id),
    };
    let context = table_data::TableDataContext {
        pool: &pool,
        connection_id: &connection_id,
        metadata_cache: &state.metadata_cache,
    };
    let result = table_data::fetch_table_data_impl(&context, &state.running_queries, &query).await;

    if let Ok(response) = &result {
        cache_fetched_page(state, &cache_target, response);
    }
    let statement = HistoryStatement {
        session_id: &connection_id,
        sql_text: fetch_history_sql(&query),
    };
    log_fetch_history(state, statement, &result);
    result
}

#[tauri::command]
pub async fn fetch_table_data(
    state: tauri::State<'_, AppState>,
    payload: table_data::FetchTableDataRequest,
) -> Result<table_data::TableDataResponse, String> {
    fetch_table_data_with_cache(&state, payload).await
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

async fn run_row_write_with_history<T>(
    state: &AppState,
    statement: HistoryStatement<'_>,
    write: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let started_at = std::time::Instant::now();
    let result = write.await;
    let affected_rows = single_row_count(result.is_ok());
    let record = HistoryRecord::for_outcome(statement.sql_text, started_at, &result)
        .with_affected_rows(affected_rows);
    log_history_record(state, statement.session_id, record);
    result
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

pub async fn update_table_row_with_history(
    state: &AppState,
    request: &table_data::UpdateTableRowRequest,
) -> Result<(), String> {
    let pool = writable_pool(state, &request.connection_id)?;
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: update_row_history_sql(request),
    };
    let write = table_data::update_table_row_impl(&pool, request);
    run_row_write_with_history(state, statement, write).await
}

#[tauri::command]
pub async fn update_table_row(
    state: tauri::State<'_, AppState>,
    payload: table_data::UpdateTableRowRequest,
) -> Result<(), String> {
    update_table_row_with_history(&state, &payload).await
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

pub async fn insert_table_row_with_history(
    state: &AppState,
    request: &table_data::InsertTableRowRequest,
) -> Result<Vec<(String, serde_json::Value)>, String> {
    let pool = writable_pool(state, &request.connection_id)?;
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: insert_row_history_sql(request),
    };
    let write = table_data::insert_table_row_impl(&pool, &state.metadata_cache, request);
    run_row_write_with_history(state, statement, write).await
}

#[tauri::command]
pub async fn insert_table_row(
    state: tauri::State<'_, AppState>,
    payload: table_data::InsertTableRowRequest,
) -> Result<Vec<(String, serde_json::Value)>, String> {
    insert_table_row_with_history(&state, &payload).await
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

pub async fn delete_table_row_with_history(
    state: &AppState,
    request: &table_data::DeleteTableRowRequest,
) -> Result<(), String> {
    let pool = writable_pool(state, &request.connection_id)?;
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: delete_row_history_sql(request),
    };
    let write = table_data::delete_table_row_impl(&pool, request);
    run_row_write_with_history(state, statement, write).await
}

#[tauri::command]
pub async fn delete_table_row(
    state: tauri::State<'_, AppState>,
    payload: table_data::DeleteTableRowRequest,
) -> Result<(), String> {
    delete_table_row_with_history(&state, &payload).await
}

pub async fn fetch_blob_value_on_connection(
    state: &AppState,
    request: &table_data::FetchBlobValueRequest,
) -> Result<table_data::BlobValueResponse, String> {
    let pool = connection_pool(state, &request.connection_id)?;
    table_data::fetch_blob_value_impl(&pool, request).await
}

#[tauri::command]
pub async fn fetch_blob_value(
    state: tauri::State<'_, AppState>,
    payload: table_data::FetchBlobValueRequest,
) -> Result<table_data::BlobValueResponse, String> {
    fetch_blob_value_on_connection(&state, &payload).await
}

#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<String, String> {
    table_data::read_file_bytes_impl(&path)
}

#[tauri::command]
pub fn write_file_bytes(payload: table_data::WriteFileBytesRequest) -> Result<(), String> {
    table_data::write_file_bytes_impl(&payload.path, &payload.base64)
}

fn export_page_window(page: Option<u32>, page_size: Option<u32>) -> Option<PageWindow> {
    let (Some(page_number), Some(page_size)) = (page, page_size) else {
        return None;
    };
    Some(PageWindow {
        page_size,
        offset: page_offset(page_number, page_size),
    })
}

fn export_history_sql(options: &table_data::ExportTableOptions) -> String {
    let spec = SelectSqlSpec {
        database: &options.database,
        table: &options.table,
        filter: &options.filter_model,
        sort: &options.sort,
        limit: export_page_window(options.page, options.page_size),
    };
    history_sql_for(&spec, || {
        let database = &options.database;
        let table = &options.table;
        let format = &options.format;
        format!("SELECT * FROM `{database}`.`{table}` /* export to {format} */")
    })
}

fn export_options_from(
    request: table_data::ExportTableDataRequest,
) -> table_data::ExportTableOptions {
    table_data::ExportTableOptions {
        database: request.database,
        table: request.table,
        format: request.format,
        file_path: request.file_path,
        include_headers: request.include_headers,
        table_name_for_sql: request.table_name_for_sql,
        filter_model: request.filter_model.unwrap_or_default(),
        sort: sort_info_from(request.sort_column, request.sort_direction),
        page: request.page,
        page_size: request.page_size,
    }
}

pub async fn export_table_data_with_history(
    state: &AppState,
    request: table_data::ExportTableDataRequest,
) -> Result<(), String> {
    let connection_id = request.connection_id.clone();
    let pool = connection_pool(state, &connection_id)?;
    let options = export_options_from(request);
    let statement = HistoryStatement {
        session_id: &connection_id,
        sql_text: export_history_sql(&options),
    };
    let context = table_data::TableDataContext {
        pool: &pool,
        connection_id: &connection_id,
        metadata_cache: &state.metadata_cache,
    };
    let export = table_data::export_table_data_impl(&context, &options);
    run_with_history(state, statement, export).await
}

#[tauri::command]
pub async fn export_table_data(
    state: tauri::State<'_, AppState>,
    payload: table_data::ExportTableDataRequest,
) -> Result<(), String> {
    export_table_data_with_history(&state, payload).await
}
