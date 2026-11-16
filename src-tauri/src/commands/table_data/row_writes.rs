use super::*;

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

pub(super) async fn sync_table_data_cache_after_write<R: tauri::Runtime>(
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

pub(super) async fn run_row_write_with_history<T>(
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

pub(super) fn writable_pool(
    state: &AppState,
    connection_id: &str,
) -> Result<crate::mysql::pool::BackgroundPool, String> {
    if state.registry.is_read_only(connection_id) {
        return Err("Connection is read-only".to_string());
    }
    connection_pool(state, connection_id)
}

pub(super) fn connection_pool(
    state: &AppState,
    connection_id: &str,
) -> Result<crate::mysql::pool::BackgroundPool, String> {
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))
}

pub(super) fn update_row_history_sql(request: &table_data::UpdateTableRowRequest) -> String {
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

pub(super) fn insert_row_history_sql(request: &table_data::InsertTableRowRequest) -> String {
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

pub(super) fn delete_row_history_sql(request: &table_data::DeleteTableRowRequest) -> String {
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
