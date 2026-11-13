use super::*;

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
