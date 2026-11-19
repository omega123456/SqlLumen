use std::borrow::Cow;
use std::cmp::Ordering;
use std::collections::BTreeSet;
use std::sync::Arc;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::mysql::cell_values::minus_sign;
use crate::mysql::query_executor::{compare_json_values, ColumnMeta, SharedRow, StoredResult};
use crate::mysql::result_cache::{CachedResultEntry, SlotWrite, SlotWriteTarget};
use crate::state::AppState;

mod filters;
mod js_coercion;
mod row_append;
mod slot_commands;
mod view_building;
pub use filters::*;
pub use js_coercion::*;
pub use row_append::*;
pub use slot_commands::*;
pub use view_building::*;

pub const INITIAL_VIEW_VERSION: u64 = 1;
pub const FIRST_WINDOW_ROWS: usize = 1_000;
pub const MAX_WINDOW_ROWS: usize = 2_000;

pub const RESULTS_EXPIRED_MESSAGE: &str =
    "results_expired: Results for this tab have expired. Re-run the query to see results.";
pub const STALE_QUERY_MESSAGE: &str =
    "Results were refreshed by a newer query. Re-run the query to continue.";
pub const VIEW_SUPERSEDED_PREFIX: &str = "view_superseded:";
pub const VIEW_STALE_PREFIX: &str = "view_stale:";
pub const TABLE_PAGE_REFUSED_MESSAGE: &str =
    "table_page_refused: This command applies to query results only, not to table data pages.";
pub const ROW_CEILING_REACHED_PREFIX: &str = "row_ceiling_reached:";

pub fn ensure_query_result(stored: &StoredResult) -> Result<(), String> {
    if stored.is_table_page() {
        return Err(TABLE_PAGE_REFUSED_MESSAGE.to_string());
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewSort {
    pub column: String,
    pub direction: SortDirection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewFilterCondition {
    pub column: String,
    pub operator: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultViewSpec {
    #[serde(default)]
    pub sort: Option<ViewSort>,
    #[serde(default)]
    pub filters: Vec<ViewFilterCondition>,
}

impl ResultViewSpec {
    pub fn is_empty(&self) -> bool {
        self.sort.is_none() && self.filters.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResultWindow {
    pub offset: usize,
    pub rows: Vec<SharedRow>,
    pub base_indices: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetResultViewResult {
    pub view_version: u64,
    pub view_row_count: usize,
    pub total_rows: usize,
    pub first_window: ResultWindow,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResultWindowResult {
    pub offset: usize,
    pub rows: Vec<SharedRow>,
    pub base_indices: Vec<u32>,
    pub view_row_count: usize,
    pub view_version: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveResultRowsResult {
    pub view_version: u64,
    pub view_row_count: usize,
    pub total_rows: usize,
}
