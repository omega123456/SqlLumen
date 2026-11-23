use super::*;
use crate::mysql::query_executor::{
    ColumnMeta, StoredResult, StoredResultOrigin, StoredResultParts,
};
use crate::mysql::result_view::{ResultWindow, first_window, view_len};

pub const TABLE_PAGE_RESULT_INDEX: usize = 0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TablePageResult {
    pub query_id: String,
    pub columns: Vec<TableDataColumnMeta>,
    pub primary_key: Option<PrimaryKeyInfo>,
    pub current_page: u32,
    pub page_size: u32,
    pub execution_time_ms: u64,
    pub view_row_count: usize,
    pub view_version: u64,
    pub total_rows: usize,
    pub row_ceiling: usize,
    pub first_window: ResultWindow,
}

pub struct TablePageSlotSource<'a> {
    pub response: &'a TableDataResponse,
    pub query_id: String,
    pub row_ceiling: usize,
}

fn result_columns_of(columns: &[TableDataColumnMeta]) -> Vec<ColumnMeta> {
    columns
        .iter()
        .map(|column| ColumnMeta {
            name: column.name.clone(),
            data_type: column.data_type.clone(),
        })
        .collect()
}

pub fn table_page_stored_result(source: TablePageSlotSource<'_>) -> StoredResult {
    let TablePageSlotSource {
        response,
        query_id,
        row_ceiling,
    } = source;
    let mut stored = StoredResult::new(StoredResultParts {
        query_id,
        columns: result_columns_of(&response.columns),
        rows: Arc::clone(&response.rows),
        execution_time_ms: response.execution_time_ms,
        total_time_ms: response.execution_time_ms,
        affected_rows: 0,
        auto_limit_applied: false,
    });
    stored.row_ceiling = row_ceiling;
    stored.origin = StoredResultOrigin::TablePage;
    stored
}

pub fn table_page_result(response: TableDataResponse, stored: &StoredResult) -> TablePageResult {
    TablePageResult {
        query_id: stored.query_id.clone(),
        columns: response.columns,
        primary_key: response.primary_key,
        current_page: response.current_page,
        page_size: response.page_size,
        execution_time_ms: response.execution_time_ms,
        view_row_count: view_len(stored),
        view_version: stored.view_version,
        total_rows: stored.live_row_count(),
        row_ceiling: stored.row_ceiling,
        first_window: first_window(stored),
    }
}

pub fn clamp_table_page_size(page_size: u32, row_ceiling: usize) -> u32 {
    let ceiling = u32::try_from(row_ceiling).unwrap_or(u32::MAX);
    page_size.min(ceiling)
}
