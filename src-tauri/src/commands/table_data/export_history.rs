use super::*;

pub(super) fn export_page_window(page: Option<u32>, page_size: Option<u32>) -> Option<PageWindow> {
    let (Some(page_number), Some(page_size)) = (page, page_size) else {
        return None;
    };
    Some(PageWindow {
        page_size,
        offset: page_offset(page_number, page_size),
    })
}

pub(super) fn export_history_sql(options: &table_data::ExportTableOptions) -> String {
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

pub(super) fn export_options_from(
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
