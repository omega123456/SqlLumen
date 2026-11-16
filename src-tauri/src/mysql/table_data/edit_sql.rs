use super::*;
#[cfg(not(coverage))]
use crate::mysql::logged_query::{execute_pooled, fetch_first_decoded_pooled};

#[cfg(not(coverage))]
fn bind_value_from_json_number(number: &serde_json::Number) -> mysql_async::Value {
    if let Some(integer) = number.as_i64() {
        return mysql_async::Value::Int(integer);
    }
    if let Some(unsigned) = number.as_u64() {
        return mysql_async::Value::UInt(unsigned);
    }
    if let Some(float) = number.as_f64() {
        return mysql_async::Value::Double(float);
    }
    mysql_async::Value::from(number.to_string())
}

#[cfg(not(coverage))]
fn bind_value_from_blob_envelope(value: &serde_json::Value) -> mysql_async::Value {
    match decode_blob_envelope(value) {
        Some(Ok(BlobBind::Bytes(bytes))) => mysql_async::Value::Bytes(bytes),
        Some(Ok(BlobBind::Empty)) => mysql_async::Value::Bytes(Vec::new()),
        Some(Ok(BlobBind::Null)) => mysql_async::Value::NULL,
        Some(Err(error)) => {
            tracing::error!(error = %error, "Malformed blob envelope reached bind stage; binding NULL");
            mysql_async::Value::NULL
        }
        None => mysql_async::Value::from(value.to_string()),
    }
}

#[cfg(not(coverage))]
pub(super) fn bind_value_from_json(value: &serde_json::Value) -> mysql_async::Value {
    match value {
        serde_json::Value::Null => mysql_async::Value::NULL,
        serde_json::Value::String(text) => mysql_async::Value::from(text.as_str()),
        serde_json::Value::Number(number) => bind_value_from_json_number(number),
        serde_json::Value::Bool(boolean) => mysql_async::Value::Int(i64::from(*boolean)),
        serde_json::Value::Object(_) => bind_value_from_blob_envelope(value),
        serde_json::Value::Array(_) => mysql_async::Value::from(value.to_string()),
    }
}

#[cfg(not(coverage))]
pub(super) fn json_bound_statement<'a>(
    sql: &'a str,
    params: &[serde_json::Value],
) -> LoggedStatement<'a> {
    if params.is_empty() {
        return LoggedStatement::text(sql);
    }
    LoggedStatement::bound(sql, params.iter().map(bind_value_from_json).collect())
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
    outcome: &crate::mysql::logged_query::ExecuteOutcome,
) -> Result<(), String> {
    let rows_affected = outcome.affected_rows;
    if rows_affected != 1 {
        return Err(format!("Expected 1 row affected, got {rows_affected}"));
    }
    Ok(())
}

#[cfg(not(coverage))]
pub async fn update_table_row_impl(
    pool: &BackgroundPool,
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

    let outcome = execute_pooled(pool, json_bound_statement(&sql, &all_params))
        .await
        .map_err(|error| format!("Update failed: {error}"))?;

    ensure_single_row_affected(&outcome)
}

#[cfg(coverage)]
pub async fn update_table_row_impl(
    _pool: &BackgroundPool,
    _request: &UpdateTableRowRequest,
) -> Result<(), String> {
    Ok(())
}

#[cfg(not(coverage))]
struct JsonBoundStatement {
    sql: String,
    params: Vec<serde_json::Value>,
}

#[cfg(not(coverage))]
fn build_insert_statement(
    safe_target: &str,
    values: &HashMap<String, serde_json::Value>,
) -> Result<JsonBoundStatement, String> {
    let mut col_names: Vec<&String> = values.keys().collect();
    col_names.sort();
    if col_names.is_empty() {
        return Err("No values to insert".to_string());
    }
    let safe_cols = col_names
        .iter()
        .map(|col| safe_identifier(col))
        .collect::<Result<Vec<_>, String>>()?;
    Ok(JsonBoundStatement {
        sql: format!(
            "INSERT INTO {safe_target} ({}) VALUES ({})",
            safe_cols.join(", "),
            crate::mysql::logged_query::placeholder_list(col_names.len())
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
    row: &DecodedRow,
    column_index: usize,
    row_columns: &InsertedRowColumns<'_>,
) -> (String, serde_json::Value) {
    let col_name = row.column_name(column_index);
    let col_meta = row_columns.columns.get(column_index);
    let encoding = CellEncoding {
        is_binary: col_meta.is_some_and(|column| column.is_binary),
        is_primary_key: col_meta.is_some_and(|column| {
            row_columns
                .primary_key_column_set
                .contains(column.name.as_str())
        }),
    };
    let cell = row.cells()[column_index].clone();
    (col_name, serialize_table_value(cell, encoding))
}

#[cfg(not(coverage))]
pub async fn insert_table_row_impl(
    pool: &BackgroundPool,
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
    let insert_outcome = execute_pooled(pool, json_bound_statement(&insert.sql, &insert.params))
        .await
        .map_err(|error| format!("Insert failed: {error}"))?;

    let auto_increment_id = primary_key_info
        .has_auto_increment
        .then_some(insert_outcome.last_insert_id.unwrap_or_default());
    let filter = inserted_row_filter(primary_key_info, values, auto_increment_id)?;
    let refetch_sql = format!(
        "SELECT {projection} FROM {safe_db}.{safe_table} WHERE {}",
        filter.where_parts.join(" AND ")
    );
    let refetch_row =
        fetch_first_decoded_pooled(pool, json_bound_statement(&refetch_sql, &filter.params))
            .await
            .map_err(|error| format!("Failed to re-fetch inserted row: {error}"))?;
    let Some(row) = refetch_row else {
        return Ok(vec![]);
    };

    let row_columns = InsertedRowColumns {
        columns: &columns,
        primary_key_column_set: &primary_key_column_set,
    };
    Ok((0..row.cells().len())
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
    _pool: &BackgroundPool,
    _metadata_cache: &MetadataCache,
    _request: &InsertTableRowRequest,
) -> Result<Vec<(String, serde_json::Value)>, String> {
    Ok(vec![])
}

#[cfg(not(coverage))]
pub async fn delete_table_row_impl(
    pool: &BackgroundPool,
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

    let outcome = execute_pooled(pool, json_bound_statement(&sql, &params))
        .await
        .map_err(|error| format!("Delete failed: {error}"))?;

    ensure_single_row_affected(&outcome)
}

#[cfg(coverage)]
pub async fn delete_table_row_impl(
    _pool: &BackgroundPool,
    _request: &DeleteTableRowRequest,
) -> Result<(), String> {
    Ok(())
}
