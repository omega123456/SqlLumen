use super::*;

pub(super) const FIRST_PAGE: u32 = 1;

pub(super) fn sort_info_from(
    sort_column: Option<String>,
    sort_direction: Option<String>,
) -> Option<table_data::SortInfo> {
    let (Some(column), Some(direction)) = (sort_column, sort_direction) else {
        return None;
    };
    Some(table_data::SortInfo { column, direction })
}

pub(super) fn page_offset(page: u32, page_size: u32) -> u64 {
    u64::from(page.saturating_sub(FIRST_PAGE)) * u64::from(page_size)
}

pub(super) fn history_sql_for(
    spec: &SelectSqlSpec<'_>,
    fallback_sql: impl FnOnce() -> String,
) -> String {
    let raw_sql = build_select_sql(spec).unwrap_or_else(fallback_sql);
    let filter_clause = table_data::translate_filter_model(spec.filter);
    interpolate_sql_params(&raw_sql, &filter_clause.params)
}

pub(super) fn fetch_history_sql(query: &table_data::TableDataPageQuery) -> String {
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

pub(super) fn log_fetch_history(
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

pub(super) fn page_query_from(
    request: table_data::FetchTableDataRequest,
) -> table_data::TableDataPageQuery {
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

pub async fn fetch_table_rows(
    state: &AppState,
    request: table_data::FetchTableDataRequest,
) -> Result<table_data::TableDataResponse, String> {
    if request.page_size == 0 {
        return Err("page_size must be at least 1".to_string());
    }
    let connection_id = request.connection_id.clone();
    let pool = connection_pool(state, &connection_id)?;
    let query = page_query_from(request);
    let context = table_data::TableDataContext {
        pool: &pool,
        connection_id: &connection_id,
        metadata_cache: &state.metadata_cache,
    };
    let result = table_data::fetch_table_data_impl(&context, &state.running_queries, &query).await;
    let statement = HistoryStatement {
        session_id: &connection_id,
        sql_text: fetch_history_sql(&query),
    };
    log_fetch_history(state, statement, &result);
    result
}

pub const TABLE_PAGE_SUPERSEDED_MESSAGE: &str =
    "table_page_superseded: A newer page fetch or a cleanup replaced this table page.";

struct TablePageStoreTarget<'a> {
    connection_id: &'a str,
    tab_id: &'a str,
    expected_invalidation_version: u64,
}

fn store_table_page(
    state: &AppState,
    target: &TablePageStoreTarget<'_>,
    response: table_data::TableDataResponse,
) -> Result<table_data::TablePageResult, String> {
    let stored = table_data::table_page_stored_result(table_data::TablePageSlotSource {
        response: &response,
        query_id: uuid::Uuid::new_v4().to_string(),
        row_ceiling: state.result_cache.row_ceiling(),
    });
    let page = table_data::table_page_result(response, &stored);
    let write = VersionedValue {
        expected_invalidation_version: target.expected_invalidation_version,
        value: vec![stored],
    };
    let key = CacheKey::new(target.connection_id, target.tab_id);
    if state.result_cache.insert_if_current(key, write) {
        return Ok(page);
    }
    tracing::debug!(
        connection_id = %target.connection_id,
        tab_id = %target.tab_id,
        "table page not stored: slot replaced or cleaned up during the fetch"
    );
    Err(TABLE_PAGE_SUPERSEDED_MESSAGE.to_string())
}

pub async fn fetch_table_page_impl(
    state: &AppState,
    request: table_data::FetchTableDataRequest,
) -> Result<table_data::TablePageResult, String> {
    if request.page_size == 0 {
        return Err("page_size must be at least 1".to_string());
    }
    let connection_id = request.connection_id.clone();
    let pool = connection_pool(state, &connection_id)?;
    let mut query = page_query_from(request);
    query.page_size =
        table_data::clamp_table_page_size(query.page_size, state.result_cache.row_ceiling());
    let store_target = TablePageStoreTarget {
        connection_id: &connection_id,
        tab_id: &query.tab_id,
        expected_invalidation_version: state
            .result_cache
            .begin_slot_replacement(&connection_id, &query.tab_id),
    };
    let context = table_data::TableDataContext {
        pool: &pool,
        connection_id: &connection_id,
        metadata_cache: &state.metadata_cache,
    };
    let result = table_data::fetch_table_data_impl(&context, &state.running_queries, &query).await;
    let statement = HistoryStatement {
        session_id: &connection_id,
        sql_text: fetch_history_sql(&query),
    };
    log_fetch_history(state, statement, &result);
    store_table_page(state, &store_target, result?)
}

#[tauri::command]
pub async fn fetch_table_page(
    state: tauri::State<'_, AppState>,
    payload: table_data::FetchTableDataRequest,
) -> Result<table_data::TablePageResult, String> {
    fetch_table_page_impl(&state, payload).await
}

#[tauri::command]
pub async fn fetch_table_data(
    state: tauri::State<'_, AppState>,
    payload: table_data::FetchTableDataRequest,
) -> Result<table_data::TableDataResponse, String> {
    fetch_table_rows(&state, payload).await
}
