//! Views over cached query-editor results: sort, filter, tombstones and windows.
//!
//! The Rust result cache is the single source of truth for a result's rows, row
//! order, row membership and row identity. Base rows (`StoredResult::rows`)
//! never move; a **view** is a permutation of base-row indices that encodes the
//! current sort, filter and tombstone exclusion. `None` is the identity view
//! (no sort, no filter, no tombstones) and costs no memory.
//!
//! The webview only ever sees **windows** of the view: a slice of rows plus the
//! parallel base indices that identify them.
//!
//! View writes are compare-and-swap: every request carries the view version
//! the frontend last saw, the view is built outside the cache lock, and the
//! write-back (under the in-place lock) only succeeds when the slot's version
//! still equals that base version. Otherwise it is refused with
//! `view_superseded: current=<n>`.
//!
//! Filter evaluation mirrors the previous JavaScript engine exactly (JS
//! `String()` / `Number()` coercion, TINYINT normalization), except that
//! `LIKE` is MySQL-like: `%` and `_` also match newlines.

use std::borrow::Cow;
use std::cmp::Ordering;
use std::collections::BTreeSet;
use std::sync::Arc;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::mysql::multi_result::minus_sign;
use crate::mysql::query_executor::{compare_json_values, ColumnMeta, SharedRow, StoredResult};
use crate::mysql::result_cache::{CachedResultEntry, SlotWrite, SlotWriteTarget};
use crate::state::AppState;

mod filters;
mod js_coercion;
mod slot_commands;
mod view_building;
pub use filters::*;
pub use js_coercion::*;
pub use slot_commands::*;
pub use view_building::*;

/// View version of a freshly stored result.
pub const INITIAL_VIEW_VERSION: u64 = 1;
/// Rows in the first window returned by every execute path.
pub const FIRST_WINDOW_ROWS: usize = 1_000;
/// Maximum rows per window or by-index request.
pub const MAX_WINDOW_ROWS: usize = 2_000;

/// Error returned when a tab's cached results expired (routed by the frontend).
pub const RESULTS_EXPIRED_MESSAGE: &str =
    "results_expired: Results for this tab have expired. Re-run the query to see results.";
/// Error returned when a request names a query id the slot no longer holds.
pub const STALE_QUERY_MESSAGE: &str =
    "Results were refreshed by a newer query. Re-run the query to continue.";
/// Prefix of the compare-and-swap refusal (`view_superseded: current=<n>`).
pub const VIEW_SUPERSEDED_PREFIX: &str = "view_superseded:";
/// Prefix of a window request against an old view version.
pub const VIEW_STALE_PREFIX: &str = "view_stale:";

/// Sort direction of a view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Asc,
    Desc,
}

/// The sort part of a view spec.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewSort {
    pub column: String,
    pub direction: SortDirection,
}

/// One filter condition (the frontend `FilterCondition` shape).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewFilterCondition {
    pub column: String,
    pub operator: String,
    #[serde(default)]
    pub value: String,
}

/// A complete view spec: optional sort plus filter conditions.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultViewSpec {
    #[serde(default)]
    pub sort: Option<ViewSort>,
    #[serde(default)]
    pub filters: Vec<ViewFilterCondition>,
}

impl ResultViewSpec {
    /// True when the spec neither sorts nor filters.
    pub fn is_empty(&self) -> bool {
        self.sort.is_none() && self.filters.is_empty()
    }
}

/// A slice of a result's current view.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResultWindow {
    /// View position of the first row.
    pub offset: usize,
    /// The rows, shared by pointer with the cache.
    pub rows: Vec<SharedRow>,
    /// Base-row index of each row (parallel to `rows`).
    pub base_indices: Vec<u32>,
}

/// Response for `set_result_view`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetResultViewResult {
    pub view_version: u64,
    pub view_row_count: usize,
    pub total_rows: usize,
    pub first_window: ResultWindow,
}

/// Response for `fetch_result_window`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResultWindowResult {
    pub offset: usize,
    pub rows: Vec<SharedRow>,
    pub base_indices: Vec<u32>,
    pub view_row_count: usize,
    pub view_version: u64,
}

/// Response for `remove_result_rows`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveResultRowsResult {
    pub view_version: u64,
    pub view_row_count: usize,
    pub total_rows: usize,
}
