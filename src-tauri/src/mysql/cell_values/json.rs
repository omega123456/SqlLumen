use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

use super::CellValue;

pub const JS_SAFE_INTEGER_MAX: i64 = 9_007_199_254_740_991;
const JS_SAFE_UNSIGNED_INTEGER_MAX: u64 = JS_SAFE_INTEGER_MAX.unsigned_abs();

const BLOB_PLACEHOLDER_PREFIX: &str = "[BLOB - ";
const BLOB_PLACEHOLDER_SUFFIX: &str = "]";
const BINARY_PRIMARY_KEY_PREFIX: &str = "0x";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GridCellVariant {
    Value,
    BlobPlaceholder,
    BinaryPrimaryKey,
}

pub fn json_from_i64(number: i64) -> serde_json::Value {
    let is_safe_integer = (-JS_SAFE_INTEGER_MAX..=JS_SAFE_INTEGER_MAX).contains(&number);
    if is_safe_integer {
        return serde_json::Value::from(number);
    }
    serde_json::Value::String(number.to_string())
}

pub fn json_from_u64(number: u64) -> serde_json::Value {
    if number > JS_SAFE_UNSIGNED_INTEGER_MAX {
        return serde_json::Value::String(number.to_string());
    }
    serde_json::Value::from(number)
}

fn json_from_f64(number: f64) -> serde_json::Value {
    serde_json::Number::from_f64(number)
        .map(serde_json::Value::Number)
        .unwrap_or(serde_json::Value::Null)
}

pub fn cell_json(cell: &CellValue) -> serde_json::Value {
    into_cell_json(cell.clone())
}

pub fn into_cell_json(cell: CellValue) -> serde_json::Value {
    match cell {
        CellValue::Null => serde_json::Value::Null,
        CellValue::Signed(number) => json_from_i64(number),
        CellValue::Unsigned(number) | CellValue::Bit(number) => json_from_u64(number),
        CellValue::Float(number) => json_from_f64(number),
        CellValue::Decimal(text) | CellValue::Temporal(text) | CellValue::Text(text) => {
            serde_json::Value::String(text)
        }
        CellValue::Bytes(bytes) => serde_json::Value::String(BASE64_STANDARD.encode(bytes)),
    }
}

pub fn grid_cell_json(cell: CellValue, variant: GridCellVariant) -> serde_json::Value {
    match variant {
        GridCellVariant::Value => into_cell_json(cell),
        GridCellVariant::BlobPlaceholder => blob_placeholder_json(&cell),
        GridCellVariant::BinaryPrimaryKey => binary_primary_key_json(&cell),
    }
}

fn blob_placeholder_json(byte_length: &CellValue) -> serde_json::Value {
    let byte_count = match byte_length {
        CellValue::Unsigned(count) => Some(*count),
        CellValue::Signed(count) => u64::try_from(*count).ok(),
        _ => None,
    };
    byte_count
        .map(blob_placeholder_text)
        .map(serde_json::Value::String)
        .unwrap_or(serde_json::Value::Null)
}

pub fn blob_placeholder_text(byte_count: u64) -> String {
    let size = crate::mysql::table_data::format_bytes(byte_count);
    [
        BLOB_PLACEHOLDER_PREFIX,
        size.as_str(),
        BLOB_PLACEHOLDER_SUFFIX,
    ]
    .concat()
}

fn binary_primary_key_json(cell: &CellValue) -> serde_json::Value {
    let key_bytes = match cell {
        CellValue::Bytes(bytes) => bytes.as_slice(),
        CellValue::Text(text) => text.as_bytes(),
        _ => return serde_json::Value::Null,
    };
    let hex_digits = hex::encode_upper(key_bytes);
    serde_json::Value::String([BINARY_PRIMARY_KEY_PREFIX, hex_digits.as_str()].concat())
}

pub fn row_json(row: mysql_async::Row) -> Vec<serde_json::Value> {
    let columns = row.columns();
    super::decode_owned_values(row.unwrap(), &columns)
        .into_iter()
        .map(into_cell_json)
        .collect()
}
