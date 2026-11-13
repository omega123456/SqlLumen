//! Table data operations: fetch paginated data, CRUD operations, and export.
//!
//! This module contains the business logic (`*_impl` functions) for browsing
//! and editing table data. Each function takes a `MySqlPool` directly (the
//! command wrappers in `commands::table_data` extract the pool from `AppState`).

use crate::mysql::cache_status::{cache_status_json, CacheStatus};
use crate::mysql::metadata_cache::{MetadataCache, MetadataTableKey, TableKeyMetadata};
use crate::mysql::result_cache::{CacheKey, VersionedValue};
use crate::mysql::schema_queries::safe_identifier;
#[cfg(not(coverage))]
use crate::mysql::sqlx_type_names::{
    is_sqlx_binary_type_name, is_sqlx_decimal_type_name, is_sqlx_float_type_name,
    is_sqlx_integer_type_name,
};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock as TokioRwLock;

#[cfg(not(coverage))]
use sqlx::mysql::types::MySqlTime;
#[cfg(not(coverage))]
use sqlx::mysql::MySqlValueRef;
#[cfg(not(coverage))]
use sqlx::Column;
#[cfg(not(coverage))]
use sqlx::Row;
#[cfg(not(coverage))]
use sqlx::TypeInfo;
#[cfg(not(coverage))]
use sqlx::Value;
#[cfg(not(coverage))]
use sqlx::ValueRef;

#[cfg(not(coverage))]
use crate::mysql::multi_result::{json_from_i64, json_from_u64};

mod blob_values;
mod cache_sync;
mod edit_sql;
mod export;
mod filters;
mod paging;
mod serialization;
pub use blob_values::*;
pub use cache_sync::*;
pub use edit_sql::*;
pub use export::*;
pub use filters::*;
pub use paging::*;
pub use serialization::*;

// ── Data structures ────────────────────────────────────────────────────────────

/// Column metadata for table data, including PK/UNIQUE and nullability info.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableDataColumnMeta {
    pub name: String,
    pub data_type: String,
    pub is_boolean_alias: bool,
    pub enum_values: Option<Vec<String>>,
    pub set_values: Option<Vec<String>>,
    pub is_nullable: bool,
    pub is_primary_key: bool,
    pub is_unique_key: bool,
    pub has_default: bool,
    pub column_default: Option<String>,
    pub is_binary: bool,
    pub is_auto_increment: bool,
}

/// Primary / unique key info for a table.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrimaryKeyInfo {
    pub key_columns: Vec<String>,
    pub has_auto_increment: bool,
    pub is_unique_key_fallback: bool,
}

/// Response from `fetch_blob_value`: the raw bytes of a single binary cell,
/// base64-encoded for transport, with a size guard.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlobValueResponse {
    /// Base64-encoded bytes, or `None` for SQL NULL or when `too_large` is set.
    pub base64: Option<String>,
    /// Stored byte count (always returned, even when `too_large`).
    pub byte_length: u64,
    /// `true` when the stored size exceeds the 10 MB cap; bytes are then omitted.
    pub too_large: bool,
}

/// Paginated response from `fetch_table_data`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableDataResponse {
    pub columns: Vec<TableDataColumnMeta>,
    /// Shared so caching or restoring a page clones a pointer, not the rows.
    pub rows: Arc<Vec<Vec<serde_json::Value>>>,
    pub current_page: u32,
    pub page_size: u32,
    pub primary_key: Option<PrimaryKeyInfo>,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCacheRestoreResponse {
    pub status: CacheStatus,
    pub data: Option<TableDataResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCacheSyncResponse {
    pub status: CacheStatus,
}

/// Sort specification for a single column.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortInfo {
    pub column: String,
    pub direction: String,
}

/// A single filter condition from the frontend filter dialog.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterCondition {
    pub column: String,
    pub operator: String,
    pub value: String,
}

/// A WHERE clause fragment with bound parameter values.
#[derive(Debug, Clone)]
pub struct FilterClause {
    pub sql: String,
    pub params: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchTableDataRequest {
    pub connection_id: String,
    pub tab_id: String,
    pub database: String,
    pub table: String,
    pub page: u32,
    pub page_size: u32,
    pub sort_column: Option<String>,
    pub sort_direction: Option<String>,
    pub filter_model: Option<Vec<FilterCondition>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTableDataCacheRequest {
    pub connection_id: String,
    pub tab_id: String,
    pub database: String,
    pub table: String,
    pub columns: Vec<TableDataColumnMeta>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub current_page: u32,
    pub page_size: u32,
    pub primary_key: Option<PrimaryKeyInfo>,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTableDataRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub format: String,
    pub file_path: String,
    pub include_headers: bool,
    pub table_name_for_sql: String,
    pub filter_model: Option<Vec<FilterCondition>>,
    pub sort_column: Option<String>,
    pub sort_direction: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreTableDataCacheRequest {
    pub connection_id: String,
    pub tab_id: String,
    pub database: String,
    pub table: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTableRowRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub primary_key_columns: Vec<String>,
    pub original_primary_key_values: HashMap<String, serde_json::Value>,
    pub updated_values: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertTableRowRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub values: HashMap<String, serde_json::Value>,
    pub primary_key_info: PrimaryKeyInfo,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTableRowRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub primary_key_columns: Vec<String>,
    pub primary_key_values: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchBlobValueRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub column: String,
    pub primary_key_pairs: Vec<(String, serde_json::Value)>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileBytesRequest {
    pub path: String,
    pub base64: String,
}

pub struct TableDataContext<'a> {
    pub pool: &'a sqlx::MySqlPool,
    pub connection_id: &'a str,
    pub metadata_cache: &'a MetadataCache,
}

#[derive(Debug, Clone)]
pub struct TableDataPageQuery {
    pub tab_id: String,
    pub database: String,
    pub table: String,
    pub page: u32,
    pub page_size: u32,
    pub sort: Option<SortInfo>,
    pub filter_model: Vec<FilterCondition>,
}

#[cfg(not(coverage))]
#[derive(Clone, Copy)]
struct CellEncoding {
    is_binary: bool,
    is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTableOptions {
    pub database: String,
    pub table: String,
    pub format: String,
    pub file_path: String,
    pub include_headers: bool,
    pub table_name_for_sql: String,
    pub filter_model: Vec<FilterCondition>,
    pub sort: Option<SortInfo>,
    /// When set, limits the export to a single page of results (current visible rows).
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

/// Base64-encode bytes for export serialization.
#[cfg(not(coverage))]
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
