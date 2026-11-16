use crate::commands::query_history_bridge::{
    log_history_batch, run_with_history, HistoryRecord, HistoryStatement,
};
use crate::commands::requests::{DatabaseRequest, SchemaObjectRequest, TableRequest};
use crate::mysql::metadata_cache::{
    evict_metadata_cache_for_connection, evict_metadata_cache_for_database,
    evict_metadata_cache_for_tables, TableEviction,
};
#[cfg(not(coverage))]
use crate::mysql::pool::BackgroundPool;
use crate::mysql::schema_queries::{
    self, CharsetInfo, CollationInfo, ColumnInfo, DatabaseDetails, ForeignKeyInfo,
    SchemaInfoResponse,
};
use crate::state::AppState;
use serde::Deserialize;
use std::time::Instant;
#[cfg(not(coverage))]
use tauri::State;

mod schema_reads;
mod schema_writes;
mod with_history;
pub use schema_reads::*;
pub use schema_writes::*;
pub use with_history::*;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSchemaObjectsRequest {
    pub connection_id: String,
    pub database: String,
    pub object_type: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseEncodingRequest {
    pub connection_id: String,
    pub name: String,
    pub charset: Option<String>,
    pub collation: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropDatabaseRequest {
    pub connection_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameDatabaseRequest {
    pub connection_id: String,
    pub old_name: String,
    pub new_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameTableRequest {
    pub connection_id: String,
    pub database: String,
    pub old_name: String,
    pub new_name: String,
}

fn encoding_history_sql(statement_prefix: &str, request: &DatabaseEncodingRequest) -> String {
    let name = &request.name;
    let mut sql_text = format!("{statement_prefix} `{name}`");
    if let Some(charset) = &request.charset {
        sql_text.push_str(&format!(" CHARACTER SET `{charset}`"));
    }
    if let Some(collation) = &request.collation {
        sql_text.push_str(&format!(" COLLATE `{collation}`"));
    }
    sql_text
}

#[cfg(not(coverage))]
fn get_pool(state: &AppState, connection_id: &str) -> Result<BackgroundPool, String> {
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' is not open"))
}

fn check_not_read_only(state: &AppState, connection_id: &str) -> Result<(), String> {
    if state.registry.is_read_only(connection_id) {
        return Err("Operation not permitted: connection is read-only".to_string());
    }
    Ok(())
}

#[cfg(not(coverage))]
async fn build_encoding_clause(
    pool: &BackgroundPool,
    request: &DatabaseEncodingRequest,
) -> Result<String, String> {
    let charset = request.charset.as_deref();
    let collation = request.collation.as_deref();
    if let Some(cs) = charset {
        schema_queries::validate_charset(pool, cs).await?;
    }
    if let Some(coll) = collation {
        schema_queries::validate_collation(pool, coll, charset).await?;
    }

    let mut clause = String::new();
    if let Some(cs) = charset {
        let safe_cs = schema_queries::safe_identifier(cs)?;
        clause.push_str(&format!(" CHARACTER SET {safe_cs}"));
    }
    if let Some(coll) = collation {
        let safe_coll = schema_queries::safe_identifier(coll)?;
        clause.push_str(&format!(" COLLATE {safe_coll}"));
    }
    Ok(clause)
}

#[cfg(coverage)]
fn validate_encoding_identifiers(request: &DatabaseEncodingRequest) -> Result<(), String> {
    if let Some(cs) = request.charset.as_deref() {
        let _ = schema_queries::safe_identifier(cs)?;
    }
    if let Some(coll) = request.collation.as_deref() {
        let _ = schema_queries::safe_identifier(coll)?;
    }
    Ok(())
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_databases(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    list_databases_impl(&state, &connection_id).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_schema_objects(
    payload: ListSchemaObjectsRequest,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    list_schema_objects_impl(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_columns(
    payload: TableRequest,
    state: State<'_, AppState>,
) -> Result<Vec<ColumnInfo>, String> {
    list_columns_impl(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_table_foreign_keys(
    payload: TableRequest,
    state: State<'_, AppState>,
) -> Result<Vec<ForeignKeyInfo>, String> {
    get_table_foreign_keys_impl(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_schema_info(
    payload: SchemaObjectRequest,
    state: State<'_, AppState>,
) -> Result<SchemaInfoResponse, String> {
    get_schema_info_with_history(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn create_database(
    payload: DatabaseEncodingRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    create_database_with_history(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn drop_database(
    payload: DropDatabaseRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    drop_database_with_history(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn alter_database(
    payload: DatabaseEncodingRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    alter_database_with_history(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn rename_database(
    payload: RenameDatabaseRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    rename_database_with_history(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn drop_table(payload: TableRequest, state: State<'_, AppState>) -> Result<(), String> {
    drop_table_with_history(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn truncate_table(
    payload: TableRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    truncate_table_with_history(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn rename_table(
    payload: RenameTableRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    rename_table_with_history(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_database_details(
    payload: DatabaseRequest,
    state: State<'_, AppState>,
) -> Result<DatabaseDetails, String> {
    get_database_details_impl(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_charsets(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<CharsetInfo>, String> {
    list_charsets_impl(&state, &connection_id).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_collations(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<CollationInfo>, String> {
    list_collations_impl(&state, &connection_id).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn invalidate_metadata_cache(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    invalidate_metadata_cache_impl(&state, &connection_id)
}
