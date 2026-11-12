//! Debug logging for SQL sent to MySQL and raw rows before app serialization.

use sqlx::mysql::MySqlRow;
use sqlx::{Column, Row, TypeInfo, Value, ValueRef};

pub const TARGET: &str = "mysql_traffic";

/// Whether debug-level logging for `TARGET` is currently enabled. Callers should use this to
/// skip expensive row formatting / buffering work when nothing will consume it.
pub fn is_enabled() -> bool {
    tracing::enabled!(target: TARGET, tracing::Level::DEBUG)
}

pub fn log_outgoing_sql(sql: &str) {
    tracing::debug!(target: TARGET, %sql, "mysql outgoing query");
}

/// Log a parameterized statement with bound values (for visibility into what the client sends).
pub fn log_outgoing_sql_bound(sql: &str, binds: &[String]) {
    tracing::debug!(target: TARGET, %sql, ?binds, "mysql outgoing query (bound)");
}

/// Secondary client call for metadata (e.g. sqlx `describe`), not a separate MySQL text protocol query string.
pub fn log_sqlx_describe(sql: &str) {
    tracing::debug!(target: TARGET, %sql, "mysql sqlx describe (column metadata)");
}

fn format_cell(row: &MySqlRow, column_index: usize) -> String {
    let type_name = row.column(column_index).type_info().name().to_uppercase();
    let raw_value = match row.try_get_raw(column_index) {
        Ok(value) => value,
        Err(error) => return format!("<decode_error: {error}>"),
    };

    if raw_value.is_null() {
        return "None".to_string();
    }

    if crate::mysql::sqlx_type_names::is_sqlx_integer_type_name(&type_name) {
        if let Ok(value) = row.try_get::<Option<i64>, _>(column_index) {
            return format!("{value:?}");
        }
        if let Ok(value) = row.try_get::<Option<u64>, _>(column_index) {
            return format!("{value:?}");
        }
        if let Ok(value) = row.try_get::<Option<String>, _>(column_index) {
            return format!("{value:?}");
        }
    }

    if type_name.contains("FLOAT") || type_name.contains("DOUBLE") {
        if let Ok(value) = row.try_get::<Option<f64>, _>(column_index) {
            return format!("{value:?}");
        }
    }

    if type_name.contains("DECIMAL") || type_name.contains("NUMERIC") {
        if let Ok(value) = row.try_get::<Option<String>, _>(column_index) {
            return format!("{value:?}");
        }
        if let Some(value) = decode_unchecked_string(row, column_index)
            .or_else(|| decode_raw_string(raw_value.clone()))
        {
            return format!("Some({value:?})");
        }
    }

    if matches!(
        type_name.as_str(),
        "DATE" | "DATETIME" | "TIMESTAMP" | "TIME" | "NEWDATE"
    ) {
        if let Some(value) = decode_temporal_debug_value(raw_value) {
            return format!("Some({value:?})");
        }
    }

    if type_name.contains("BLOB") || type_name == "BINARY" || type_name == "VARBINARY" {
        if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(column_index) {
            return format!(
                "bytes(len={})",
                value.as_ref().map(|bytes| bytes.len()).unwrap_or(0)
            );
        }
    }

    match row.try_get::<Option<String>, _>(column_index) {
        Ok(value) => format!("{value:?}"),
        Err(error) => format!("<decode_error: {error}>"),
    }
}

fn decode_unchecked_string(row: &MySqlRow, column_index: usize) -> Option<String> {
    if let Ok(value) = row.try_get_unchecked::<Option<String>, _>(column_index) {
        return value;
    }

    row.try_get_unchecked::<Option<Vec<u8>>, _>(column_index)
        .ok()
        .flatten()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn decode_raw_string(value: sqlx::mysql::MySqlValueRef<'_>) -> Option<String> {
    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(text) = owned.try_decode::<String>() {
        return Some(text);
    }

    sqlx::ValueRef::to_owned(&value)
        .try_decode::<Vec<u8>>()
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn decode_temporal_debug_value(value: sqlx::mysql::MySqlValueRef<'_>) -> Option<String> {
    use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
    use sqlx::mysql::types::MySqlTime;

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(value) = owned.try_decode::<NaiveDateTime>() {
        return Some(value.to_string());
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(value) = owned.try_decode::<DateTime<Utc>>() {
        return Some(value.naive_utc().to_string());
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(value) = owned.try_decode::<NaiveDate>() {
        return Some(value.to_string());
    }

    let owned = sqlx::ValueRef::to_owned(&value);
    if let Ok(value) = owned.try_decode::<MySqlTime>() {
        return Some(format_mysql_time(value));
    }

    sqlx::ValueRef::to_owned(&value).try_decode::<String>().ok()
}

fn format_mysql_time(value: sqlx::mysql::types::MySqlTime) -> String {
    let sign = if value.sign().is_negative() { "-" } else { "" };
    let hours = value.hours();

    if value.microseconds() == 0 {
        format!(
            "{sign}{hours:02}:{:02}:{:02}",
            value.minutes(),
            value.seconds()
        )
    } else {
        format!(
            "{sign}{hours:02}:{:02}:{:02}.{:06}",
            value.minutes(),
            value.seconds(),
            value.microseconds()
        )
    }
}

fn format_mysql_row(row: &MySqlRow) -> String {
    let mut parts = Vec::new();
    for column_index in 0..row.len() {
        let name = row.column(column_index).name();
        let value = format_cell(row, column_index);
        parts.push(format!("{name}={value}"));
    }
    parts.join(", ")
}

pub fn log_mysql_rows(rows: &[MySqlRow]) {
    if !is_enabled() {
        return;
    }
    tracing::debug!(target: TARGET, row_count = rows.len(), "mysql result rows (pre-serialize)");
    for (row_index, row) in rows.iter().enumerate() {
        let formatted = format_mysql_row(row);
        tracing::debug!(target: TARGET, row_index = row_index, row = %formatted, "mysql row");
    }
}

/// Log a single row (e.g. `fetch_one` / `COUNT(*)`).
pub fn log_mysql_row(row: &MySqlRow) {
    log_mysql_rows(std::slice::from_ref(row));
}

pub fn log_execute_result(result: &sqlx::mysql::MySqlQueryResult) {
    tracing::debug!(
        target: TARGET,
        rows_affected = result.rows_affected(),
        last_insert_id = result.last_insert_id(),
        "mysql execute result",
    );
}

pub fn log_execute_error(error: &sqlx::Error) {
    tracing::debug!(
        target: TARGET,
        error = %error,
        "mysql execute error",
    );
}

/// Log one streamed `mysql_async` row (query editor session). Text-protocol
/// values arrive as raw bytes.
pub fn log_mysql_async_row(row_index: usize, row: &mysql_async::Row) {
    if !is_enabled() {
        return;
    }
    let formatted = row
        .columns_ref()
        .iter()
        .enumerate()
        .map(|(index, col)| {
            let formatted_value = match row.as_ref(index) {
                None | Some(mysql_async::Value::NULL) => "None".to_string(),
                Some(mysql_async::Value::Bytes(bytes)) => {
                    format!("Some({:?})", String::from_utf8_lossy(bytes))
                }
                Some(value) => format!("Some({value:?})"),
            };
            format!("{}={formatted_value}", col.name_str())
        })
        .collect::<Vec<_>>()
        .join(", ");
    tracing::debug!(target: TARGET, row_index, row = %formatted, "mysql row");
}

/// Log the row count of a fully streamed `mysql_async` result set.
pub fn log_mysql_async_row_count(row_count: usize) {
    if !is_enabled() {
        return;
    }
    tracing::debug!(target: TARGET, row_count, "mysql result rows (pre-serialize)");
}

pub fn log_mysql_async_result(rows_affected: u64, last_insert_id: Option<u64>) {
    tracing::debug!(
        target: TARGET,
        rows_affected,
        last_insert_id,
        "mysql execute result",
    );
}

pub fn log_mysql_async_error(error: &mysql_async::Error) {
    tracing::debug!(
        target: TARGET,
        error = %error,
        "mysql execute error",
    );
}
