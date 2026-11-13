use crate::commands::query_history_bridge::{
    log_history_batch, run_with_history, HistoryRecord, HistoryStatement,
};
use crate::commands::requests::{DatabaseRequest, SchemaObjectRequest, TableRequest};
use crate::mysql::metadata_cache::{
    evict_metadata_cache_for_connection, evict_metadata_cache_for_database,
    evict_metadata_cache_for_tables, TableEviction,
};
#[cfg(not(coverage))]
use crate::mysql::query_log;
use crate::mysql::schema_queries::{
    self, CharsetInfo, CollationInfo, ColumnInfo, DatabaseDetails, ForeignKeyInfo,
    SchemaInfoResponse,
};
use crate::state::AppState;
use serde::Deserialize;
use std::time::Instant;
#[cfg(not(coverage))]
use tauri::State;

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
fn get_pool(state: &AppState, connection_id: &str) -> Result<sqlx::MySqlPool, String> {
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
    pool: &sqlx::MySqlPool,
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
pub async fn list_databases_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<String>, String> {
    let pool = get_pool(state, connection_id)?;
    schema_queries::query_list_databases(&pool).await
}

#[cfg(coverage)]
pub async fn list_databases_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<String>, String> {
    if state.registry.get_pool(connection_id).is_none() {
        return Err(format!("Connection '{connection_id}' is not open"));
    }
    Ok(vec![])
}

#[cfg(not(coverage))]
pub async fn list_schema_objects_impl(
    state: &AppState,
    request: &ListSchemaObjectsRequest,
) -> Result<Vec<String>, String> {
    let pool = get_pool(state, &request.connection_id)?;
    schema_queries::query_list_schema_objects(&pool, &request.database, &request.object_type).await
}

#[cfg(coverage)]
pub async fn list_schema_objects_impl(
    _state: &AppState,
    request: &ListSchemaObjectsRequest,
) -> Result<Vec<String>, String> {
    let object_type = request.object_type.as_str();
    match object_type {
        "table" | "view" | "procedure" | "function" | "trigger" | "event" => Ok(vec![]),
        _ => Err(format!("Unknown object type: '{object_type}'")),
    }
}

#[cfg(not(coverage))]
pub async fn list_columns_impl(
    state: &AppState,
    request: &TableRequest,
) -> Result<Vec<ColumnInfo>, String> {
    let pool = get_pool(state, &request.connection_id)?;
    schema_queries::query_list_columns(&pool, &request.database, &request.table).await
}

#[cfg(coverage)]
pub async fn list_columns_impl(
    _state: &AppState,
    _request: &TableRequest,
) -> Result<Vec<ColumnInfo>, String> {
    Ok(vec![])
}

#[cfg(not(coverage))]
pub async fn get_table_foreign_keys_impl(
    state: &AppState,
    request: &TableRequest,
) -> Result<Vec<ForeignKeyInfo>, String> {
    let pool = get_pool(state, &request.connection_id)?;
    schema_queries::query_foreign_keys(&pool, &request.database, &request.table).await
}

#[cfg(coverage)]
pub async fn get_table_foreign_keys_impl(
    _state: &AppState,
    _request: &TableRequest,
) -> Result<Vec<ForeignKeyInfo>, String> {
    Ok(vec![])
}

#[cfg(not(coverage))]
pub async fn get_schema_info_impl(
    state: &AppState,
    request: &SchemaObjectRequest,
) -> Result<SchemaInfoResponse, String> {
    let pool = get_pool(state, &request.connection_id)?;
    schema_queries::query_schema_info(&pool, request.object_ref()).await
}

#[cfg(coverage)]
pub async fn get_schema_info_impl(
    _state: &AppState,
    _request: &SchemaObjectRequest,
) -> Result<SchemaInfoResponse, String> {
    Ok(SchemaInfoResponse {
        columns: vec![],
        indexes: vec![],
        foreign_keys: vec![],
        ddl: String::new(),
        metadata: None,
    })
}

#[cfg(not(coverage))]
pub async fn get_database_details_impl(
    state: &AppState,
    request: &DatabaseRequest,
) -> Result<DatabaseDetails, String> {
    let pool = get_pool(state, &request.connection_id)?;
    schema_queries::query_database_details(&pool, &request.database).await
}

#[cfg(coverage)]
pub async fn get_database_details_impl(
    _state: &AppState,
    request: &DatabaseRequest,
) -> Result<DatabaseDetails, String> {
    Ok(DatabaseDetails {
        name: request.database.clone(),
        default_character_set: String::new(),
        default_collation: String::new(),
    })
}

#[cfg(not(coverage))]
pub async fn list_charsets_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<CharsetInfo>, String> {
    let pool = get_pool(state, connection_id)?;
    schema_queries::query_list_charsets(&pool).await
}

#[cfg(coverage)]
pub async fn list_charsets_impl(
    _state: &AppState,
    _connection_id: &str,
) -> Result<Vec<CharsetInfo>, String> {
    Ok(vec![])
}

#[cfg(not(coverage))]
pub async fn list_collations_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<CollationInfo>, String> {
    let pool = get_pool(state, connection_id)?;
    schema_queries::query_list_collations(&pool).await
}

#[cfg(coverage)]
pub async fn list_collations_impl(
    _state: &AppState,
    _connection_id: &str,
) -> Result<Vec<CollationInfo>, String> {
    Ok(vec![])
}

#[cfg(not(coverage))]
async fn execute_schema_statement(pool: &sqlx::MySqlPool, sql: &str) -> Result<(), sqlx::Error> {
    query_log::log_outgoing_sql(sql);
    let result = sqlx::query(sqlx::AssertSqlSafe(sql)).execute(pool).await?;
    query_log::log_execute_result(&result);
    Ok(())
}

#[cfg(not(coverage))]
pub async fn create_database_impl(
    state: &AppState,
    request: &DatabaseEncodingRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let pool = get_pool(state, &request.connection_id)?;
    let encoding_clause = build_encoding_clause(&pool, request).await?;
    let name = &request.name;
    let safe_name = schema_queries::safe_identifier(name)?;
    let sql = format!("CREATE DATABASE {safe_name}{encoding_clause}");
    execute_schema_statement(&pool, &sql)
        .await
        .map_err(|error| format!("Failed to create database '{name}': {error}"))
}

#[cfg(coverage)]
pub async fn create_database_impl(
    state: &AppState,
    request: &DatabaseEncodingRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let _ = schema_queries::safe_identifier(&request.name)?;
    validate_encoding_identifiers(request)?;
    Ok(())
}

#[cfg(not(coverage))]
pub async fn drop_database_impl(
    state: &AppState,
    request: &DropDatabaseRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let pool = get_pool(state, &request.connection_id)?;
    let name = &request.name;
    let safe_name = schema_queries::safe_identifier(name)?;
    let sql = format!("DROP DATABASE {safe_name}");
    execute_schema_statement(&pool, &sql)
        .await
        .map_err(|error| format!("Failed to drop database '{name}': {error}"))
}

#[cfg(coverage)]
pub async fn drop_database_impl(
    state: &AppState,
    request: &DropDatabaseRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let _ = schema_queries::safe_identifier(&request.name)?;
    Ok(())
}

#[cfg(not(coverage))]
pub async fn alter_database_impl(
    state: &AppState,
    request: &DatabaseEncodingRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let pool = get_pool(state, &request.connection_id)?;
    let encoding_clause = build_encoding_clause(&pool, request).await?;
    let name = &request.name;
    let safe_name = schema_queries::safe_identifier(name)?;
    let sql = format!("ALTER DATABASE {safe_name}{encoding_clause}");
    execute_schema_statement(&pool, &sql)
        .await
        .map_err(|error| format!("Failed to alter database '{name}': {error}"))
}

#[cfg(coverage)]
pub async fn alter_database_impl(
    state: &AppState,
    request: &DatabaseEncodingRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let _ = schema_queries::safe_identifier(&request.name)?;
    validate_encoding_identifiers(request)?;
    Ok(())
}

#[cfg(not(coverage))]
pub async fn rename_database_impl(
    state: &AppState,
    request: &RenameDatabaseRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let pool = get_pool(state, &request.connection_id)?;
    let old_name = &request.old_name;
    let new_name = &request.new_name;

    schema_queries::check_rename_safe(&pool, old_name).await?;

    let safe_old = schema_queries::safe_identifier(old_name)?;
    let safe_new = schema_queries::safe_identifier(new_name)?;

    let tables = schema_queries::query_table_names(&pool, old_name).await?;

    let create_sql = format!("CREATE DATABASE {safe_new}");
    execute_schema_statement(&pool, &create_sql)
        .await
        .map_err(|error| format!("Failed to create target database '{new_name}': {error}"))?;

    if !tables.is_empty() {
        let mut rename_pairs = Vec::with_capacity(tables.len());
        for table in &tables {
            let safe_table = schema_queries::safe_identifier(table)?;
            rename_pairs.push(format!(
                "{safe_old}.{safe_table} TO {safe_new}.{safe_table}"
            ));
        }
        let sql = format!("RENAME TABLE {}", rename_pairs.join(", "));
        execute_schema_statement(&pool, &sql)
            .await
            .map_err(|error| {
                format!("Failed to move tables from '{old_name}' to '{new_name}': {error}")
            })?;
    }

    let drop_sql = format!("DROP DATABASE {safe_old}");
    execute_schema_statement(&pool, &drop_sql)
        .await
        .map_err(|error| format!("Failed to drop source database '{old_name}': {error}"))
}

#[cfg(coverage)]
pub async fn rename_database_impl(
    state: &AppState,
    request: &RenameDatabaseRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let _ = schema_queries::safe_identifier(&request.old_name)?;
    let _ = schema_queries::safe_identifier(&request.new_name)?;
    Ok(())
}

#[cfg(not(coverage))]
pub async fn drop_table_impl(state: &AppState, request: &TableRequest) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let pool = get_pool(state, &request.connection_id)?;
    let database = &request.database;
    let table = &request.table;
    let safe_db = schema_queries::safe_identifier(database)?;
    let safe_table = schema_queries::safe_identifier(table)?;
    let sql = format!("DROP TABLE {safe_db}.{safe_table}");
    execute_schema_statement(&pool, &sql)
        .await
        .map_err(|error| format!("Failed to drop table '{database}'.'{table}': {error}"))
}

#[cfg(coverage)]
pub async fn drop_table_impl(state: &AppState, request: &TableRequest) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let _ = schema_queries::safe_identifier(&request.database)?;
    let _ = schema_queries::safe_identifier(&request.table)?;
    Ok(())
}

#[cfg(not(coverage))]
pub async fn truncate_table_impl(state: &AppState, request: &TableRequest) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let pool = get_pool(state, &request.connection_id)?;
    let database = &request.database;
    let table = &request.table;
    let safe_db = schema_queries::safe_identifier(database)?;
    let safe_table = schema_queries::safe_identifier(table)?;
    let sql = format!("TRUNCATE TABLE {safe_db}.{safe_table}");
    execute_schema_statement(&pool, &sql)
        .await
        .map_err(|error| format!("Failed to truncate table '{database}'.'{table}': {error}"))
}

#[cfg(coverage)]
pub async fn truncate_table_impl(state: &AppState, request: &TableRequest) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let _ = schema_queries::safe_identifier(&request.database)?;
    let _ = schema_queries::safe_identifier(&request.table)?;
    Ok(())
}

#[cfg(not(coverage))]
pub async fn rename_table_impl(
    state: &AppState,
    request: &RenameTableRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let pool = get_pool(state, &request.connection_id)?;
    let old_name = &request.old_name;
    let new_name = &request.new_name;
    let safe_db = schema_queries::safe_identifier(&request.database)?;
    let safe_old = schema_queries::safe_identifier(old_name)?;
    let safe_new = schema_queries::safe_identifier(new_name)?;
    let sql = format!("RENAME TABLE {safe_db}.{safe_old} TO {safe_db}.{safe_new}");
    execute_schema_statement(&pool, &sql)
        .await
        .map_err(|error| format!("Failed to rename table '{old_name}' to '{new_name}': {error}"))
}

#[cfg(coverage)]
pub async fn rename_table_impl(
    state: &AppState,
    request: &RenameTableRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let _ = schema_queries::safe_identifier(&request.database)?;
    let _ = schema_queries::safe_identifier(&request.old_name)?;
    let _ = schema_queries::safe_identifier(&request.new_name)?;
    Ok(())
}

pub fn invalidate_metadata_cache_impl(state: &AppState, connection_id: &str) -> Result<(), String> {
    if !state.has_open_connection(connection_id) {
        return Err(format!("Connection '{connection_id}' is not open"));
    }

    evict_metadata_cache_for_connection(state, connection_id);
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

fn schema_info_history_sql(request: &SchemaObjectRequest) -> String {
    let type_upper = request.object_type.to_uppercase();
    let database = &request.database;
    let object_name = &request.object_name;
    format!(
        "/* schema info */ SELECT ... FROM INFORMATION_SCHEMA FOR {type_upper} `{database}`.`{object_name}`"
    )
}

fn evict_tables_after_success(
    state: &AppState,
    connection_id: &str,
    affected_tables: &[(Option<String>, String)],
) {
    let eviction = TableEviction {
        connection_id,
        affected_tables,
        default_database: None,
    };
    evict_metadata_cache_for_tables(state, &eviction);
}

pub async fn get_schema_info_with_history(
    state: &AppState,
    request: &SchemaObjectRequest,
) -> Result<SchemaInfoResponse, String> {
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: schema_info_history_sql(request),
    };
    run_with_history(state, statement, get_schema_info_impl(state, request)).await
}

pub async fn create_database_with_history(
    state: &AppState,
    request: &DatabaseEncodingRequest,
) -> Result<(), String> {
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: encoding_history_sql("CREATE DATABASE", request),
    };
    run_with_history(state, statement, create_database_impl(state, request)).await
}

pub async fn alter_database_with_history(
    state: &AppState,
    request: &DatabaseEncodingRequest,
) -> Result<(), String> {
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: encoding_history_sql("ALTER DATABASE", request),
    };
    run_with_history(state, statement, alter_database_impl(state, request)).await
}

pub async fn drop_database_with_history(
    state: &AppState,
    request: &DropDatabaseRequest,
) -> Result<(), String> {
    let name = &request.name;
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: format!("DROP DATABASE `{name}`"),
    };
    run_with_history(state, statement, drop_database_impl(state, request)).await?;
    evict_metadata_cache_for_database(state, &request.connection_id, name);
    Ok(())
}

fn rename_database_history_statements(request: &RenameDatabaseRequest) -> Vec<String> {
    let old_name = &request.old_name;
    let new_name = &request.new_name;
    vec![
        format!("CREATE DATABASE `{new_name}`"),
        format!("RENAME TABLE ... (from `{old_name}` to `{new_name}`)"),
        format!("DROP DATABASE `{old_name}`"),
    ]
}

pub async fn rename_database_with_history(
    state: &AppState,
    request: &RenameDatabaseRequest,
) -> Result<(), String> {
    let started_at = Instant::now();
    let result = rename_database_impl(state, request).await;
    let batch_record = HistoryRecord::for_outcome(String::new(), started_at, &result);
    let records = rename_database_history_statements(request)
        .into_iter()
        .map(|sql_text| batch_record.for_statement(sql_text))
        .collect();
    log_history_batch(state, &request.connection_id, records);
    result
}

pub async fn drop_table_with_history(
    state: &AppState,
    request: &TableRequest,
) -> Result<(), String> {
    let database = &request.database;
    let table = &request.table;
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: format!("DROP TABLE `{database}`.`{table}`"),
    };
    run_with_history(state, statement, drop_table_impl(state, request)).await?;
    let affected_tables = [(Some(database.clone()), table.clone())];
    evict_tables_after_success(state, &request.connection_id, &affected_tables);
    Ok(())
}

pub async fn truncate_table_with_history(
    state: &AppState,
    request: &TableRequest,
) -> Result<(), String> {
    let database = &request.database;
    let table = &request.table;
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: format!("TRUNCATE TABLE `{database}`.`{table}`"),
    };
    run_with_history(state, statement, truncate_table_impl(state, request)).await
}

pub async fn rename_table_with_history(
    state: &AppState,
    request: &RenameTableRequest,
) -> Result<(), String> {
    let database = &request.database;
    let old_name = &request.old_name;
    let new_name = &request.new_name;
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: format!("RENAME TABLE `{database}`.`{old_name}` TO `{database}`.`{new_name}`"),
    };
    run_with_history(state, statement, rename_table_impl(state, request)).await?;
    let affected_tables = [
        (Some(database.clone()), old_name.clone()),
        (Some(database.clone()), new_name.clone()),
    ];
    evict_tables_after_success(state, &request.connection_id, &affected_tables);
    Ok(())
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
