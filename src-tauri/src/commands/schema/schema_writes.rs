use super::*;

#[cfg(not(coverage))]
pub(super) async fn execute_schema_statement(
    pool: &BackgroundPool,
    sql: &str,
) -> Result<(), mysql_async::Error> {
    use crate::mysql::logged_query::{LoggedStatement, execute_pooled};

    execute_pooled(pool, LoggedStatement::text(sql)).await?;
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
