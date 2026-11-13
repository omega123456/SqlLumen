#[cfg(not(coverage))]
use super::*;

pub(super) fn is_binary_data_type(data_type: &str) -> bool {
    let upper = data_type.to_uppercase();
    matches!(
        upper.as_str(),
        "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BINARY" | "VARBINARY"
    )
}

pub fn format_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];
    let mut value = bytes as f64 / 1024.0;
    let mut unit_index = 0;
    let last_unit_index = UNITS.len() - 1;
    while unit_index < last_unit_index {
        if value < 1024.0 {
            break;
        }
        value /= 1024.0;
        unit_index += 1;
    }
    let rounded = (value * 10.0).round() / 10.0;
    format!("{} {}", format_rounded_size(rounded), UNITS[unit_index])
}

pub(super) fn format_rounded_size(rounded: f64) -> String {
    let is_whole_number = rounded.fract().abs() < f64::EPSILON;
    if is_whole_number {
        return format!("{}", rounded as i64);
    }
    format!("{rounded:.1}")
}

pub fn parse_enum_values(column_type: &str) -> Option<Vec<String>> {
    parse_quoted_type_values(column_type, "enum")
}

pub fn parse_set_values(column_type: &str) -> Option<Vec<String>> {
    parse_quoted_type_values(column_type, "set")
}

pub(super) fn parse_quoted_type_values(column_type: &str, type_name: &str) -> Option<Vec<String>> {
    let trimmed = column_type.trim();
    let lower = trimmed.to_ascii_lowercase();
    let prefix = format!("{type_name}(");
    let is_parenthesised_type = lower.starts_with(&prefix) && trimmed.ends_with(')');
    if !is_parenthesised_type {
        return None;
    }

    let inner = &trimmed[prefix.len()..trimmed.len() - 1];
    let mut values = Vec::new();
    let mut current = String::new();
    let mut chars = inner.chars().peekable();
    let mut in_quote = false;

    while let Some(ch) = chars.next() {
        match ch {
            '\'' if !in_quote => in_quote = true,
            '\'' if matches!(chars.peek(), Some('\'')) => {
                current.push('\'');
                chars.next();
            }
            '\'' => in_quote = false,
            ',' if !in_quote => {
                values.push(current.clone());
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    if in_quote {
        return None;
    }

    values.push(current);
    Some(values)
}

#[cfg(not(coverage))]
pub(super) fn decode_text(row: &sqlx::mysql::MySqlRow, index: usize) -> String {
    match row.try_get::<String, _>(index) {
        Ok(text) => text,
        Err(_) => match row.try_get::<Vec<u8>, _>(index) {
            Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(_) => String::new(),
        },
    }
}

#[cfg(not(coverage))]
pub(super) fn decode_optional_text(row: &sqlx::mysql::MySqlRow, index: usize) -> Option<String> {
    match row.try_get::<Option<String>, _>(index) {
        Ok(text) => text,
        Err(_) => match row.try_get::<Option<Vec<u8>>, _>(index) {
            Ok(opt) => opt.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()),
            Err(_) => None,
        },
    }
}

#[cfg(not(coverage))]
pub(super) fn decode_unchecked_string(
    row: &sqlx::mysql::MySqlRow,
    column_index: usize,
) -> Option<String> {
    if let Ok(value) = row.try_get_unchecked::<Option<String>, _>(column_index) {
        return value;
    }

    row.try_get_unchecked::<Option<Vec<u8>>, _>(column_index)
        .ok()
        .flatten()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(not(coverage))]
pub(super) fn decode_raw_string(value: MySqlValueRef<'_>) -> Option<String> {
    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(text) = owned.try_decode::<String>() {
        return Some(text);
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    owned
        .try_decode::<Vec<u8>>()
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(not(coverage))]
pub(super) fn build_table_data_projection(
    columns: &[TableDataColumnMeta],
    primary_key_column_set: &std::collections::HashSet<&str>,
) -> Result<String, String> {
    let mut projection_parts = Vec::with_capacity(columns.len());

    for column in columns {
        let safe_col = safe_identifier(&column.name)?;
        let is_primary_key = primary_key_column_set.contains(column.name.as_str());
        let is_blob_placeholder = column.is_binary && !is_primary_key;
        projection_parts.push(projection_part(&safe_col, is_blob_placeholder));
    }

    Ok(projection_parts.join(", "))
}

#[cfg(not(coverage))]
pub(super) fn projection_part(safe_col: &str, is_blob_placeholder: bool) -> String {
    if is_blob_placeholder {
        return format!("OCTET_LENGTH({safe_col}) AS {safe_col}");
    }
    safe_col.to_string()
}

#[cfg(not(coverage))]
pub(super) fn serialize_temporal_value(value: MySqlValueRef<'_>) -> Option<serde_json::Value> {
    use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};

    let owned = sqlx::ValueRef::to_owned(&value);

    if let Ok(value) = owned.try_decode::<NaiveDateTime>() {
        return Some(serde_json::Value::String(value.to_string()));
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(value) = owned.try_decode::<DateTime<Utc>>() {
        return Some(serde_json::Value::String(value.naive_utc().to_string()));
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(value) = owned.try_decode::<NaiveDate>() {
        return Some(serde_json::Value::String(value.to_string()));
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(value) = owned.try_decode::<MySqlTime>() {
        return Some(serde_json::Value::String(
            crate::mysql::query_log::format_mysql_time(value),
        ));
    }

    sqlx::ValueRef::to_owned(&value)
        .try_decode::<String>()
        .ok()
        .map(serde_json::Value::String)
}

#[cfg(not(coverage))]
struct TypedCell<'a> {
    row: &'a sqlx::mysql::MySqlRow,
    column_index: usize,
    type_name: &'a str,
}

#[cfg(not(coverage))]
fn decoded_json<T>(
    cell: &TypedCell<'_>,
    to_json: impl Fn(T) -> serde_json::Value,
) -> Option<serde_json::Value>
where
    T: for<'value> sqlx::Decode<'value, sqlx::MySql> + sqlx::Type<sqlx::MySql>,
{
    let value = cell.row.try_get::<Option<T>, _>(cell.column_index).ok()?;
    Some(value.map(to_json).unwrap_or(serde_json::Value::Null))
}

#[cfg(not(coverage))]
fn json_from_f64(float: f64) -> serde_json::Value {
    serde_json::Number::from_f64(float)
        .map(serde_json::Value::Number)
        .unwrap_or(serde_json::Value::Null)
}

#[cfg(not(coverage))]
fn serialize_numeric_value(cell: &TypedCell<'_>) -> Option<serde_json::Value> {
    if is_sqlx_integer_type_name(cell.type_name) {
        return decoded_json(cell, json_from_i64).or_else(|| decoded_json(cell, json_from_u64));
    }
    if is_sqlx_float_type_name(cell.type_name) {
        return decoded_json(cell, json_from_f64);
    }
    if is_sqlx_decimal_type_name(cell.type_name) {
        return decoded_json(cell, serde_json::Value::String);
    }
    None
}

#[cfg(not(coverage))]
fn is_temporal_type_name(type_name: &str) -> bool {
    matches!(
        type_name,
        "DATE" | "DATETIME" | "TIMESTAMP" | "TIME" | "NEWDATE"
    )
}

#[cfg(not(coverage))]
pub(super) fn serialize_table_value(
    row: &sqlx::mysql::MySqlRow,
    column_index: usize,
    encoding: CellEncoding,
) -> serde_json::Value {
    let CellEncoding {
        is_binary,
        is_primary_key,
    } = encoding;
    let raw_value = match row.try_get_raw(column_index) {
        Ok(value) => value,
        Err(_) => return serde_json::Value::Null,
    };

    if raw_value.is_null() {
        return serde_json::Value::Null;
    }

    if is_binary && is_primary_key {
        return serialize_binary_primary_key(row, column_index);
    }
    if is_binary {
        return serialize_blob_placeholder(row, column_index);
    }

    let type_name = raw_value.type_info().name().to_uppercase();

    if type_name == "BIT" {
        return decode_bit_value(row, column_index);
    }

    let cell = TypedCell {
        row,
        column_index,
        type_name: &type_name,
    };
    if let Some(value) = serialize_numeric_value(&cell) {
        return value;
    }
    let temporal_value = is_temporal_type_name(&type_name)
        .then(|| serialize_temporal_value(raw_value.clone()))
        .flatten();
    if let Some(value) = temporal_value {
        return value;
    }

    match row.try_get::<Option<String>, _>(column_index) {
        Ok(Some(text)) => serde_json::Value::String(text),
        Ok(None) => serde_json::Value::Null,
        Err(_) => decode_unchecked_string(row, column_index)
            .or_else(|| decode_raw_string(raw_value))
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    }
}

#[cfg(not(coverage))]
pub(super) fn serialize_binary_primary_key(
    row: &sqlx::mysql::MySqlRow,
    column_index: usize,
) -> serde_json::Value {
    match row.try_get::<Option<Vec<u8>>, _>(column_index) {
        Ok(Some(bytes)) => serde_json::Value::String(format!("0x{}", hex::encode_upper(bytes))),
        Ok(None) | Err(_) => serde_json::Value::Null,
    }
}

#[cfg(not(coverage))]
pub(super) fn serialize_blob_placeholder(
    row: &sqlx::mysql::MySqlRow,
    column_index: usize,
) -> serde_json::Value {
    if let Ok(value) = row.try_get::<Option<u64>, _>(column_index) {
        return match value {
            Some(byte_len) => {
                serde_json::Value::String(format!("[BLOB - {}]", format_bytes(byte_len)))
            }
            None => serde_json::Value::Null,
        };
    }
    match row.try_get::<Option<i64>, _>(column_index) {
        Ok(Some(byte_len)) if byte_len >= 0 => {
            serde_json::Value::String(format!("[BLOB - {}]", format_bytes(byte_len as u64)))
        }
        Ok(_) | Err(_) => serde_json::Value::Null,
    }
}

#[cfg(not(coverage))]
pub(super) fn decode_bit_value(
    row: &sqlx::mysql::MySqlRow,
    column_index: usize,
) -> serde_json::Value {
    match row.try_get::<Option<u64>, _>(column_index) {
        Ok(Some(value)) => json_from_u64(value),
        Ok(None) => serde_json::Value::Null,
        Err(error) => {
            tracing::warn!(column_index = column_index, error = ?error, "Failed to decode BIT column as u64");
            serde_json::Value::Null
        }
    }
}

#[cfg(not(coverage))]
pub(super) fn serialize_export_value(
    row: &sqlx::mysql::MySqlRow,
    column_index: usize,
) -> serde_json::Value {
    let raw_value = match row.try_get_raw(column_index) {
        Ok(value) => value,
        Err(_) => return serde_json::Value::Null,
    };

    if raw_value.is_null() {
        return serde_json::Value::Null;
    }

    let type_name = raw_value.type_info().name().to_uppercase();

    if type_name == "BIT" {
        return decode_bit_value(row, column_index);
    }

    if is_sqlx_binary_type_name(&type_name) {
        if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(column_index) {
            return serde_json::Value::String(BASE64_STANDARD.encode(&bytes));
        }
        return serde_json::Value::Null;
    }

    if is_sqlx_integer_type_name(&type_name) {
        if let Ok(Some(value)) = row.try_get::<Option<i64>, _>(column_index) {
            return serde_json::Value::from(value);
        }
        if let Ok(Some(value)) = row.try_get::<Option<u64>, _>(column_index) {
            return serde_json::Value::from(value);
        }
    }

    if is_sqlx_float_type_name(&type_name) {
        if let Ok(Some(value)) = row.try_get::<Option<f64>, _>(column_index) {
            return serde_json::Number::from_f64(value)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null);
        }
    }

    if is_sqlx_decimal_type_name(&type_name) {
        if let Ok(Some(value)) = row.try_get::<Option<String>, _>(column_index) {
            return serde_json::Value::String(value);
        }
    }

    if matches!(
        type_name.as_str(),
        "DATE" | "DATETIME" | "TIMESTAMP" | "TIME" | "NEWDATE"
    ) {
        if let Some(value) = serialize_temporal_value(raw_value.clone()) {
            return value;
        }
    }

    match row.try_get::<Option<String>, _>(column_index) {
        Ok(Some(text)) => serde_json::Value::String(text),
        Ok(None) => serde_json::Value::Null,
        Err(_) => decode_unchecked_string(row, column_index)
            .or_else(|| decode_raw_string(raw_value))
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    }
}
