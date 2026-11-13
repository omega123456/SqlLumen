use super::*;

#[cfg(not(coverage))]
pub(super) fn bind_json_number<'q>(
    query: sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments>,
    number: &serde_json::Number,
) -> sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments> {
    if let Some(integer) = number.as_i64() {
        return query.bind(integer);
    }
    if let Some(unsigned) = number.as_u64() {
        return query.bind(unsigned);
    }
    if let Some(float) = number.as_f64() {
        return query.bind(float);
    }
    query.bind(number.to_string())
}

#[cfg(not(coverage))]
pub(super) fn bind_json_value<'q>(
    query: sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments>,
    value: &serde_json::Value,
) -> sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments> {
    match value {
        serde_json::Value::Null => query.bind(Option::<String>::None),
        serde_json::Value::String(text) => query.bind(text.clone()),
        serde_json::Value::Number(number) => bind_json_number(query, number),
        serde_json::Value::Bool(boolean) => query.bind(*boolean as i64),
        serde_json::Value::Object(_) => match decode_blob_envelope(value) {
            Some(Ok(BlobBind::Bytes(bytes))) => query.bind(bytes),
            Some(Ok(BlobBind::Empty)) => query.bind(Vec::<u8>::new()),
            Some(Ok(BlobBind::Null)) => query.bind(Option::<Vec<u8>>::None),
            Some(Err(error)) => {
                tracing::error!(error = %error, "Malformed blob envelope reached bind stage; binding NULL");
                query.bind(Option::<Vec<u8>>::None)
            }
            None => query.bind(value.to_string()),
        },
        _ => query.bind(value.to_string()),
    }
}

#[cfg(not(coverage))]
pub(super) fn is_auto_increment_key_column(
    column: &TableDataColumnMeta,
    key_columns: &[String],
) -> bool {
    key_columns.contains(&column.name) && column.is_auto_increment
}

#[cfg(not(coverage))]
pub(super) fn ensure_single_row_affected(
    result: &sqlx::mysql::MySqlQueryResult,
) -> Result<(), String> {
    let rows_affected = result.rows_affected();
    if rows_affected != 1 {
        return Err(format!("Expected 1 row affected, got {rows_affected}"));
    }
    Ok(())
}

#[cfg(not(coverage))]
pub async fn update_table_row_impl(
    pool: &sqlx::MySqlPool,
    request: &UpdateTableRowRequest,
) -> Result<(), String> {
    let primary_key_columns = &request.primary_key_columns;
    let original_primary_key_values = &request.original_primary_key_values;
    let updated_values = &request.updated_values;
    if primary_key_columns.is_empty() {
        return Err("Cannot update: no primary key columns specified".to_string());
    }
    if updated_values.is_empty() {
        return Err("No values to update".to_string());
    }
    validate_blob_envelopes(updated_values)?;

    let safe_db = safe_identifier(&request.database)?;
    let safe_table = safe_identifier(&request.table)?;

    let mut set_parts = Vec::new();
    let mut set_params: Vec<serde_json::Value> = Vec::new();

    let mut update_keys: Vec<&String> = updated_values.keys().collect();
    update_keys.sort();

    for col in &update_keys {
        let safe_col = safe_identifier(col)?;
        set_parts.push(format!("{safe_col} = ?"));
        set_params.push(updated_values[*col].clone());
    }

    let mut where_parts = Vec::new();
    let mut where_params: Vec<serde_json::Value> = Vec::new();
    for primary_key_column in primary_key_columns {
        let safe_col = safe_identifier(primary_key_column)?;
        where_parts.push(format!("{safe_col} = ?"));
        where_params.push(
            original_primary_key_values
                .get(primary_key_column)
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        );
    }

    let sql = format!(
        "UPDATE {safe_db}.{safe_table} SET {} WHERE {}",
        set_parts.join(", "),
        where_parts.join(" AND ")
    );

    let mut all_params = set_params;
    all_params.extend(where_params);

    log_table_data_sql(&sql, &all_params);
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()));
    for param in &all_params {
        query = bind_json_value(query, param);
    }

    let result = query
        .execute(pool)
        .await
        .map_err(|error| format!("Update failed: {error}"))?;
    crate::mysql::query_log::log_execute_result(&result);

    ensure_single_row_affected(&result)
}

#[cfg(coverage)]
pub async fn update_table_row_impl(
    _pool: &sqlx::MySqlPool,
    _request: &UpdateTableRowRequest,
) -> Result<(), String> {
    Ok(())
}

#[cfg(not(coverage))]
fn bind_json_params<'q>(
    sql: &'q str,
    params: &'q [serde_json::Value],
) -> sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments> {
    params
        .iter()
        .fold(sqlx::query(sqlx::AssertSqlSafe(sql)), bind_json_value)
}

#[cfg(not(coverage))]
struct BoundStatement {
    sql: String,
    params: Vec<serde_json::Value>,
}

#[cfg(not(coverage))]
fn build_insert_statement(
    safe_target: &str,
    values: &HashMap<String, serde_json::Value>,
) -> Result<BoundStatement, String> {
    let mut col_names: Vec<&String> = values.keys().collect();
    col_names.sort();
    if col_names.is_empty() {
        return Err("No values to insert".to_string());
    }
    let safe_cols = col_names
        .iter()
        .map(|col| safe_identifier(col))
        .collect::<Result<Vec<_>, String>>()?;
    let placeholders = vec!["?"; col_names.len()];
    Ok(BoundStatement {
        sql: format!(
            "INSERT INTO {safe_target} ({}) VALUES ({})",
            safe_cols.join(", "),
            placeholders.join(", ")
        ),
        params: col_names.iter().map(|col| values[*col].clone()).collect(),
    })
}

#[cfg(not(coverage))]
struct RowFilter {
    where_parts: Vec<String>,
    params: Vec<serde_json::Value>,
}

#[cfg(not(coverage))]
fn inserted_row_filter(
    primary_key_info: &PrimaryKeyInfo,
    values: &HashMap<String, serde_json::Value>,
    auto_increment_id: Option<u64>,
) -> Result<RowFilter, String> {
    let key_columns = &primary_key_info.key_columns;
    let where_parts = key_columns
        .iter()
        .map(|primary_key_column| {
            safe_identifier(primary_key_column).map(|safe_col| format!("{safe_col} = ?"))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let params = key_columns
        .iter()
        .map(|primary_key_column| {
            inserted_primary_key_value(values, primary_key_column, auto_increment_id)
        })
        .collect();
    Ok(RowFilter {
        where_parts,
        params,
    })
}

#[cfg(not(coverage))]
struct InsertedRowColumns<'a> {
    columns: &'a [TableDataColumnMeta],
    primary_key_column_set: &'a std::collections::HashSet<&'a str>,
}

#[cfg(not(coverage))]
fn serialize_inserted_cell(
    row: &sqlx::mysql::MySqlRow,
    column_index: usize,
    row_columns: &InsertedRowColumns<'_>,
) -> (String, serde_json::Value) {
    let col_name = row.column(column_index).name().to_string();
    let col_meta = row_columns.columns.get(column_index);
    let encoding = CellEncoding {
        is_binary: col_meta.is_some_and(|column| column.is_binary),
        is_primary_key: col_meta.is_some_and(|column| {
            row_columns
                .primary_key_column_set
                .contains(column.name.as_str())
        }),
    };
    (col_name, serialize_table_value(row, column_index, encoding))
}

#[cfg(not(coverage))]
pub async fn insert_table_row_impl(
    pool: &sqlx::MySqlPool,
    metadata_cache: &MetadataCache,
    request: &InsertTableRowRequest,
) -> Result<Vec<(String, serde_json::Value)>, String> {
    let values = &request.values;
    let primary_key_info = &request.primary_key_info;
    validate_blob_envelopes(values)?;
    let safe_db = safe_identifier(&request.database)?;
    let safe_table = safe_identifier(&request.table)?;
    let context = TableDataContext {
        pool,
        connection_id: &request.connection_id,
        metadata_cache,
    };
    let columns = fetch_table_pk_cached(&context, &request.database, &request.table)
        .await?
        .columns;
    let primary_key_column_set: std::collections::HashSet<&str> = primary_key_info
        .key_columns
        .iter()
        .map(|column_name| column_name.as_str())
        .collect();
    let projection = build_table_data_projection(&columns, &primary_key_column_set)?;

    let insert = build_insert_statement(&format!("{safe_db}.{safe_table}"), values)?;
    log_table_data_sql(&insert.sql, &insert.params);
    let insert_result = bind_json_params(&insert.sql, &insert.params)
        .execute(pool)
        .await
        .map_err(|error| format!("Insert failed: {error}"))?;
    crate::mysql::query_log::log_execute_result(&insert_result);

    let auto_increment_id = primary_key_info
        .has_auto_increment
        .then_some(insert_result.last_insert_id());
    let filter = inserted_row_filter(primary_key_info, values, auto_increment_id)?;
    let refetch_sql = format!(
        "SELECT {projection} FROM {safe_db}.{safe_table} WHERE {}",
        filter.where_parts.join(" AND ")
    );
    log_table_data_sql(&refetch_sql, &filter.params);
    let refetch_row = bind_json_params(&refetch_sql, &filter.params)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("Failed to re-fetch inserted row: {error}"))?;
    let Some(row) = refetch_row else {
        return Ok(vec![]);
    };
    crate::mysql::query_log::log_mysql_row(&row);

    let row_columns = InsertedRowColumns {
        columns: &columns,
        primary_key_column_set: &primary_key_column_set,
    };
    Ok((0..row.columns().len())
        .map(|column_index| serialize_inserted_cell(&row, column_index, &row_columns))
        .collect())
}

#[cfg(not(coverage))]
pub(super) fn inserted_primary_key_value(
    values: &HashMap<String, serde_json::Value>,
    column: &str,
    auto_increment_id: Option<u64>,
) -> serde_json::Value {
    let provided_value = values.get(column).filter(|value| !value.is_null());
    match (provided_value, auto_increment_id) {
        (Some(value), _) => value.clone(),
        (None, Some(last_id)) => serde_json::Value::from(last_id),
        (None, None) => serde_json::Value::Null,
    }
}

#[cfg(coverage)]
pub async fn insert_table_row_impl(
    _pool: &sqlx::MySqlPool,
    _metadata_cache: &MetadataCache,
    _request: &InsertTableRowRequest,
) -> Result<Vec<(String, serde_json::Value)>, String> {
    Ok(vec![])
}

#[cfg(not(coverage))]
pub async fn delete_table_row_impl(
    pool: &sqlx::MySqlPool,
    request: &DeleteTableRowRequest,
) -> Result<(), String> {
    let primary_key_columns = &request.primary_key_columns;
    let primary_key_values = &request.primary_key_values;
    if primary_key_columns.is_empty() {
        return Err("Cannot delete: no primary key columns specified".to_string());
    }

    let safe_db = safe_identifier(&request.database)?;
    let safe_table = safe_identifier(&request.table)?;

    let mut where_parts = Vec::new();
    let mut params: Vec<serde_json::Value> = Vec::new();

    for primary_key_column in primary_key_columns {
        let safe_col = safe_identifier(primary_key_column)?;
        where_parts.push(format!("{safe_col} = ?"));
        params.push(
            primary_key_values
                .get(primary_key_column)
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        );
    }

    let sql = format!(
        "DELETE FROM {safe_db}.{safe_table} WHERE {}",
        where_parts.join(" AND ")
    );

    log_table_data_sql(&sql, &params);
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()));
    for param in &params {
        query = bind_json_value(query, param);
    }

    let result = query
        .execute(pool)
        .await
        .map_err(|error| format!("Delete failed: {error}"))?;
    crate::mysql::query_log::log_execute_result(&result);

    ensure_single_row_affected(&result)
}

#[cfg(coverage)]
pub async fn delete_table_row_impl(
    _pool: &sqlx::MySqlPool,
    _request: &DeleteTableRowRequest,
) -> Result<(), String> {
    Ok(())
}
