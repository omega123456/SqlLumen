use super::*;

pub fn serialize_dump_value(row: &sqlx::mysql::MySqlRow, column_index: usize) -> SqlDumpValue {
    let raw_value = match row.try_get_raw(column_index) {
        Ok(value) => value,
        Err(_) => return SqlDumpValue::Null,
    };

    if raw_value.is_null() {
        return SqlDumpValue::Null;
    }

    let type_name = raw_value.type_info().name().to_uppercase();
    let cell = DumpCell {
        row,
        column_index,
        raw_value: &raw_value,
        type_name: &type_name,
    };
    if let Some(value) = cell.typed_numeric_value() {
        return value;
    }
    if cell.is_hex_dumped_type() {
        return cell.hex_bytes_value();
    }
    if let Some(value) = cell.temporal_value() {
        return value;
    }
    cell.quoted_string_value()
}

pub(super) struct DumpCell<'a, 'r> {
    row: &'a sqlx::mysql::MySqlRow,
    column_index: usize,
    raw_value: &'a MySqlValueRef<'r>,
    type_name: &'a str,
}

impl DumpCell<'_, '_> {
    pub(super) fn typed<T>(&self) -> Option<T>
    where
        T: for<'value> sqlx::Decode<'value, sqlx::MySql> + sqlx::Type<sqlx::MySql>,
    {
        self.row
            .try_get::<Option<T>, _>(self.column_index)
            .ok()
            .flatten()
    }

    pub(super) fn decoded_text(&self) -> Option<String> {
        decode_dump_string(self.row, self.column_index, self.raw_value)
    }

    pub(super) fn typed_numeric_value(&self) -> Option<SqlDumpValue> {
        use crate::mysql::sqlx_type_names as type_names;

        if type_names::is_sqlx_integer_type_name(self.type_name) {
            return self.integer_value();
        }
        if type_names::is_sqlx_float_type_name(self.type_name) {
            return self.typed::<f64>().map(SqlDumpValue::Float);
        }
        if type_names::is_sqlx_decimal_type_name(self.type_name) {
            return self.decimal_value();
        }
        if self.type_name == "BIT" {
            return self.bit_value();
        }
        None
    }

    pub(super) fn integer_value(&self) -> Option<SqlDumpValue> {
        if let Some(value) = self.typed::<i64>() {
            return Some(SqlDumpValue::Int(value));
        }
        if let Some(value) = self.typed::<u64>() {
            return Some(SqlDumpValue::UInt(value));
        }
        self.decoded_text().map(SqlDumpValue::Decimal)
    }

    pub(super) fn decimal_value(&self) -> Option<SqlDumpValue> {
        self.typed::<String>()
            .or_else(|| self.decoded_text())
            .map(SqlDumpValue::Decimal)
    }

    pub(super) fn bit_value(&self) -> Option<SqlDumpValue> {
        if let Some(value) = self.typed::<u64>() {
            return Some(SqlDumpValue::UInt(value));
        }
        let bytes = self.typed::<Vec<u8>>()?;
        let value = bytes.iter().fold(0u64, |accumulated, byte| {
            (accumulated << BITS_PER_BYTE) | u64::from(*byte)
        });
        Some(SqlDumpValue::UInt(value))
    }

    pub(super) fn is_hex_dumped_type(&self) -> bool {
        crate::mysql::sqlx_type_names::is_sqlx_binary_type_name(self.type_name)
            || self.type_name == "GEOMETRY"
    }

    pub(super) fn hex_bytes_value(&self) -> SqlDumpValue {
        if let Some(bytes) = self.typed::<Vec<u8>>() {
            return SqlDumpValue::HexBytes(bytes);
        }
        tracing::warn!(
            column_index = self.column_index,
            column_type = %self.type_name,
            "Unrepresentable binary value in SQL dump, emitting NULL"
        );
        SqlDumpValue::Null
    }

    pub(super) fn temporal_value(&self) -> Option<SqlDumpValue> {
        let is_temporal = matches!(
            self.type_name,
            "DATE" | "DATETIME" | "TIMESTAMP" | "TIME" | "NEWDATE"
        );
        if !is_temporal {
            return None;
        }
        serialize_dump_temporal(self.raw_value.clone()).map(SqlDumpValue::QuotedString)
    }

    pub(super) fn quoted_string_value(&self) -> SqlDumpValue {
        match self.row.try_get::<Option<String>, _>(self.column_index) {
            Ok(Some(text)) => return SqlDumpValue::QuotedString(text),
            Ok(None) => return SqlDumpValue::Null,
            Err(_) => {}
        }
        if let Some(text) = self.decoded_text() {
            return SqlDumpValue::QuotedString(text);
        }
        tracing::warn!(
            column_index = self.column_index,
            column_type = %self.type_name,
            "Undecodable value in SQL dump, emitting NULL"
        );
        SqlDumpValue::Null
    }
}

pub(super) fn decode_dump_string(
    row: &sqlx::mysql::MySqlRow,
    column_index: usize,
    raw: &MySqlValueRef<'_>,
) -> Option<String> {
    if let Ok(Some(text)) = row.try_get_unchecked::<Option<String>, _>(column_index) {
        return Some(text);
    }
    if let Ok(Some(bytes)) = row.try_get_unchecked::<Option<Vec<u8>>, _>(column_index) {
        return Some(String::from_utf8_lossy(&bytes).into_owned());
    }
    let owned = sqlx::ValueRef::to_owned(raw);
    if let Ok(text) = owned.try_decode::<String>() {
        return Some(text);
    }
    let owned = sqlx::ValueRef::to_owned(raw);
    owned
        .try_decode::<Vec<u8>>()
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

pub(super) fn serialize_dump_temporal(value: MySqlValueRef<'_>) -> Option<String> {
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
        return Some(crate::mysql::query_log::format_mysql_time(value));
    }

    sqlx::ValueRef::to_owned(&value).try_decode::<String>().ok()
}
