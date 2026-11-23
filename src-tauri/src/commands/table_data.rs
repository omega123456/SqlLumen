use crate::commands::query_history_bridge::{
    HistoryRecord, HistoryStatement, log_history_record, resolve_connection_context,
    run_with_history, single_row_count,
};
use crate::db::history::NewHistoryEntry;
use crate::mysql::result_cache::{CacheKey, VersionedValue};
use crate::mysql::schema_queries::safe_identifier;
use crate::mysql::table_data;
use crate::state::AppState;

mod export_history;
mod page_fetch;
mod row_writes;
pub use export_history::*;
pub use page_fetch::*;
pub use row_writes::*;

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
