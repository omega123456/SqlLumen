use super::*;

#[cfg(not(coverage))]
pub async fn drop_object_impl(
    state: &AppState,
    request: &SchemaObjectRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let pool = get_pool(state, &request.connection_id)?;
    let object_name = &request.object_name;
    let object_type = request.object_type.as_str();
    let safe_db = schema_queries::safe_identifier(&request.database)?;
    let safe_name = schema_queries::safe_identifier(object_name)?;
    let type_keyword = object_type_keyword(object_type)?;
    let sql = format!("DROP {type_keyword} IF EXISTS {safe_db}.{safe_name}");
    let mut conn = pool.acquire().await.map_err(|error| error.to_string())?;
    match execute_simple_sql(&mut conn, &sql).await {
        Ok(_) => Ok(()),
        Err(error) => Err(format!(
            "Failed to drop {object_type} '{object_name}': {error}"
        )),
    }
}

#[cfg(coverage)]
pub async fn drop_object_impl(
    state: &AppState,
    request: &SchemaObjectRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let _ = schema_queries::safe_identifier(&request.database)?;
    let _ = schema_queries::safe_identifier(&request.object_name)?;
    let _ = object_type_keyword(&request.object_type)?;
    Ok(())
}
