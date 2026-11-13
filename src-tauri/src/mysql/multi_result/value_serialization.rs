use super::*;

/// Map a `mysql_async::consts::ColumnType` to a human-readable display name
/// that matches the strings returned by `sqlx` for consistency.
///
/// Uses the column flags to distinguish UNSIGNED variants and BINARY types.
pub fn column_type_display_name(
    col_type: mysql_async::consts::ColumnType,
    flags: mysql_async::consts::ColumnFlags,
) -> String {
    use mysql_async::consts::ColumnType::*;

    let is_unsigned = flags.contains(mysql_async::consts::ColumnFlags::UNSIGNED_FLAG);
    let is_binary = flags.contains(mysql_async::consts::ColumnFlags::BINARY_FLAG);

    match col_type {
        MYSQL_TYPE_TINY if is_unsigned => "TINYINT UNSIGNED".to_string(),
        MYSQL_TYPE_TINY => "TINYINT".to_string(),
        MYSQL_TYPE_SHORT if is_unsigned => "SMALLINT UNSIGNED".to_string(),
        MYSQL_TYPE_SHORT => "SMALLINT".to_string(),
        MYSQL_TYPE_INT24 if is_unsigned => "MEDIUMINT UNSIGNED".to_string(),
        MYSQL_TYPE_INT24 => "MEDIUMINT".to_string(),
        MYSQL_TYPE_LONG if is_unsigned => "INT UNSIGNED".to_string(),
        MYSQL_TYPE_LONG => "INT".to_string(),
        MYSQL_TYPE_LONGLONG if is_unsigned => "BIGINT UNSIGNED".to_string(),
        MYSQL_TYPE_LONGLONG => "BIGINT".to_string(),
        MYSQL_TYPE_FLOAT => "FLOAT".to_string(),
        MYSQL_TYPE_DOUBLE => "DOUBLE".to_string(),
        MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => "DECIMAL".to_string(),
        MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE => "DATE".to_string(),
        MYSQL_TYPE_DATETIME | MYSQL_TYPE_DATETIME2 => "DATETIME".to_string(),
        MYSQL_TYPE_TIMESTAMP | MYSQL_TYPE_TIMESTAMP2 => "TIMESTAMP".to_string(),
        MYSQL_TYPE_TIME | MYSQL_TYPE_TIME2 => "TIME".to_string(),
        MYSQL_TYPE_YEAR => "YEAR".to_string(),
        MYSQL_TYPE_BIT => "BIT".to_string(),
        MYSQL_TYPE_JSON => "JSON".to_string(),
        MYSQL_TYPE_ENUM => "ENUM".to_string(),
        MYSQL_TYPE_SET => "SET".to_string(),
        MYSQL_TYPE_TINY_BLOB if is_binary => "TINYBLOB".to_string(),
        MYSQL_TYPE_TINY_BLOB => "TINYTEXT".to_string(),
        MYSQL_TYPE_BLOB if is_binary => "BLOB".to_string(),
        MYSQL_TYPE_BLOB => "TEXT".to_string(),
        MYSQL_TYPE_MEDIUM_BLOB if is_binary => "MEDIUMBLOB".to_string(),
        MYSQL_TYPE_MEDIUM_BLOB => "MEDIUMTEXT".to_string(),
        MYSQL_TYPE_LONG_BLOB if is_binary => "LONGBLOB".to_string(),
        MYSQL_TYPE_LONG_BLOB => "LONGTEXT".to_string(),
        MYSQL_TYPE_STRING if is_binary => "BINARY".to_string(),
        MYSQL_TYPE_STRING => "CHAR".to_string(),
        MYSQL_TYPE_VAR_STRING if is_binary => "VARBINARY".to_string(),
        MYSQL_TYPE_VAR_STRING => "VARCHAR".to_string(),
        MYSQL_TYPE_GEOMETRY => "GEOMETRY".to_string(),
        MYSQL_TYPE_NULL => "NULL".to_string(),
        _ => format!("{:?}", col_type),
    }
}

/// Serialize raw bytes from a Bytes value, using context from the column type.
///
/// This handles the dispatch logic for `mysql_async::Value::Bytes(...)` which is
/// used for strings, DECIMAL, BIT, BLOB/BINARY types, and — over the text
/// protocol — every numeric and temporal column.
pub fn serialize_bytes_value(
    bytes: &[u8],
    col_type: mysql_async::consts::ColumnType,
    flags: mysql_async::consts::ColumnFlags,
) -> serde_json::Value {
    use mysql_async::consts::ColumnType::*;

    let is_binary = flags.contains(mysql_async::consts::ColumnFlags::BINARY_FLAG);

    match col_type {
        // BIT: convert bytes to u64 integer
        MYSQL_TYPE_BIT => {
            let mut value: u64 = 0;
            for &byte in bytes {
                value = (value << 8) | (byte as u64);
            }
            json_from_u64(value)
        }

        // Text protocol sends numbers as ASCII — parse them so they serialize the
        // same as binary-protocol `Int`/`UInt`/`Double` values.
        MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT | MYSQL_TYPE_INT24 | MYSQL_TYPE_LONG
        | MYSQL_TYPE_LONGLONG | MYSQL_TYPE_YEAR => {
            let text = String::from_utf8_lossy(bytes);
            let parsed = text
                .parse::<i64>()
                .map(mysql_async::Value::Int)
                .or_else(|_| text.parse::<u64>().map(mysql_async::Value::UInt));
            match parsed {
                Ok(value) => serialize_mysql_value(&value, col_type, flags),
                Err(_) => serde_json::Value::String(text.into_owned()),
            }
        }
        MYSQL_TYPE_FLOAT | MYSQL_TYPE_DOUBLE => {
            let text = String::from_utf8_lossy(bytes);
            match text.parse::<f64>() {
                Ok(float) => {
                    serialize_mysql_value(&mysql_async::Value::Double(float), col_type, flags)
                }
                Err(_) => serde_json::Value::String(text.into_owned()),
            }
        }

        // DECIMAL/NUMERIC: string to preserve precision
        MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => {
            let text = String::from_utf8_lossy(bytes);
            serde_json::Value::String(text.into_owned())
        }

        // BLOB/BINARY types: base64-encode if binary flag is set
        MYSQL_TYPE_TINY_BLOB
        | MYSQL_TYPE_BLOB
        | MYSQL_TYPE_MEDIUM_BLOB
        | MYSQL_TYPE_LONG_BLOB
        | MYSQL_TYPE_STRING
        | MYSQL_TYPE_VAR_STRING
            if is_binary =>
        {
            serde_json::Value::String(BASE64_STANDARD.encode(bytes))
        }

        // JSON type — return as string (it's already JSON text, but we wrap it)
        MYSQL_TYPE_JSON => serde_json::Value::String(String::from_utf8_lossy(bytes).into_owned()),

        // All other Bytes values (VARCHAR, TEXT, ENUM, SET, etc.) — UTF-8 string
        _ => serde_json::Value::String(String::from_utf8_lossy(bytes).into_owned()),
    }
}

/// Serialize a single `mysql_async::Value` to a `serde_json::Value`,
/// matching the output format of the existing sqlx `serialize_value` function.
pub fn serialize_mysql_value(
    value: &mysql_async::Value,
    col_type: mysql_async::consts::ColumnType,
    flags: mysql_async::consts::ColumnFlags,
) -> serde_json::Value {
    match value {
        mysql_async::Value::NULL => serde_json::Value::Null,

        mysql_async::Value::Bytes(bytes) => serialize_bytes_value(bytes, col_type, flags),

        mysql_async::Value::Int(number) => json_from_i64(*number),

        mysql_async::Value::UInt(number) => json_from_u64(*number),

        mysql_async::Value::Float(float) => serde_json::Number::from_f64(*float as f64)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),

        mysql_async::Value::Double(float) => serde_json::Number::from_f64(*float)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),

        mysql_async::Value::Date(year, month, day, 0, 0, 0, 0) => {
            serde_json::Value::String(format!("{:04}-{:02}-{:02}", year, month, day))
        }

        mysql_async::Value::Date(year, month, day, hour, min, sec, 0) => {
            serde_json::Value::String(format!(
                "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
                year, month, day, hour, min, sec
            ))
        }

        mysql_async::Value::Date(year, month, day, hour, min, sec, micro) => {
            serde_json::Value::String(format!(
                "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:06}",
                year, month, day, hour, min, sec, micro
            ))
        }

        mysql_async::Value::Time(is_negative, days, hours, minutes, seconds, 0) => {
            let sign = minus_sign(*is_negative);
            let total_hours = *days * 24 + (*hours as u32);
            serde_json::Value::String(format!("{sign}{total_hours:02}:{minutes:02}:{seconds:02}"))
        }

        mysql_async::Value::Time(is_negative, days, hours, minutes, seconds, micro) => {
            let sign = minus_sign(*is_negative);
            let total_hours = *days * 24 + (*hours as u32);
            serde_json::Value::String(format!(
                "{sign}{total_hours:02}:{minutes:02}:{seconds:02}.{micro:06}"
            ))
        }
    }
}

pub fn minus_sign(is_negative: bool) -> &'static str {
    if is_negative {
        return "-";
    }
    ""
}
