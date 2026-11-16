use mysql_async::consts::{ColumnFlags, ColumnType};
use mysql_async::{Column, Value};

mod accessors;
mod json;
mod temporal;

pub use accessors::*;
pub use json::*;
pub use temporal::{BinaryDate, BinaryTime, MAX_FRACTIONAL_SECOND_DIGITS};

const MYSQL_FLOAT_SIGNIFICANT_DIGITS: usize = 6;
const NOT_FIXED_DECIMALS: u8 = 31;
const BINARY_CHARACTER_SET_ID: u16 = 63;
const BITS_PER_BYTE: u32 = 8;

#[derive(Debug, Clone, PartialEq)]
pub enum CellValue {
    Null,
    Signed(i64),
    Unsigned(u64),
    Float(f64),
    Decimal(String),
    Bit(u64),
    Temporal(String),
    Text(String),
    Bytes(Vec<u8>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ColumnKind {
    Bit,
    Integer,
    Float,
    Decimal,
    Temporal,
    BinaryString,
    Text,
}

fn column_kind(column: &Column) -> ColumnKind {
    use mysql_async::consts::ColumnType::*;

    match column.column_type() {
        MYSQL_TYPE_BIT => ColumnKind::Bit,
        MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT | MYSQL_TYPE_INT24 | MYSQL_TYPE_LONG
        | MYSQL_TYPE_LONGLONG | MYSQL_TYPE_YEAR => ColumnKind::Integer,
        MYSQL_TYPE_FLOAT | MYSQL_TYPE_DOUBLE => ColumnKind::Float,
        MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => ColumnKind::Decimal,
        MYSQL_TYPE_DATE
        | MYSQL_TYPE_NEWDATE
        | MYSQL_TYPE_DATETIME
        | MYSQL_TYPE_DATETIME2
        | MYSQL_TYPE_TIMESTAMP
        | MYSQL_TYPE_TIMESTAMP2
        | MYSQL_TYPE_TIME
        | MYSQL_TYPE_TIME2 => ColumnKind::Temporal,
        MYSQL_TYPE_TINY_BLOB
        | MYSQL_TYPE_BLOB
        | MYSQL_TYPE_MEDIUM_BLOB
        | MYSQL_TYPE_LONG_BLOB
        | MYSQL_TYPE_STRING
        | MYSQL_TYPE_VAR_STRING
        | MYSQL_TYPE_GEOMETRY
            if has_binary_character_set(column) =>
        {
            ColumnKind::BinaryString
        }
        _ => ColumnKind::Text,
    }
}

fn has_binary_character_set(column: &Column) -> bool {
    column.character_set() == BINARY_CHARACTER_SET_ID
}

fn has_unsigned_flag(column: &Column) -> bool {
    column.flags().contains(ColumnFlags::UNSIGNED_FLAG)
}

fn is_date_only_column(column: &Column) -> bool {
    matches!(
        column.column_type(),
        ColumnType::MYSQL_TYPE_DATE | ColumnType::MYSQL_TYPE_NEWDATE
    )
}

pub fn decode_cell(value: &Value, column: &Column) -> CellValue {
    decode_owned_cell(value.clone(), column)
}

pub fn decode_owned_cell(value: Value, column: &Column) -> CellValue {
    match value {
        Value::NULL => CellValue::Null,
        Value::Bytes(bytes) => decode_text_protocol_bytes(bytes, column),
        Value::Int(number) => CellValue::Signed(number),
        Value::UInt(number) => CellValue::Unsigned(number),
        Value::Float(number) => CellValue::Float(float_for_column(number, column)),
        Value::Double(number) => CellValue::Float(number),
        Value::Date(year, month, day, hour, minute, second, microsecond) => {
            let date = BinaryDate {
                year,
                month,
                day,
                hour,
                minute,
                second,
                microsecond,
            };
            CellValue::Temporal(temporal::date_text(&date, column))
        }
        Value::Time(is_negative, days, hours, minutes, seconds, microseconds) => {
            let time = BinaryTime {
                is_negative,
                days,
                hours,
                minutes,
                seconds,
                microseconds,
            };
            CellValue::Temporal(temporal::time_text(&time, column))
        }
    }
}

pub fn decode_row(row: &mysql_async::Row) -> Vec<CellValue> {
    row.columns_ref()
        .iter()
        .enumerate()
        .map(|(column_index, column)| match row.as_ref(column_index) {
            Some(value) => decode_cell(value, column),
            None => CellValue::Null,
        })
        .collect()
}

pub fn decode_owned_values(values: Vec<Value>, columns: &[Column]) -> Vec<CellValue> {
    values
        .into_iter()
        .zip(columns.iter())
        .map(|(value, column)| decode_owned_cell(value, column))
        .collect()
}

fn decode_text_protocol_bytes(bytes: Vec<u8>, column: &Column) -> CellValue {
    match column_kind(column) {
        ColumnKind::Bit => CellValue::Bit(big_endian_bits(&bytes)),
        ColumnKind::Integer => integer_from_text(bytes, column),
        ColumnKind::Float => float_from_text(bytes),
        ColumnKind::Decimal => CellValue::Decimal(lossy_text(bytes)),
        ColumnKind::Temporal => CellValue::Temporal(lossy_text(bytes)),
        ColumnKind::BinaryString => CellValue::Bytes(bytes),
        ColumnKind::Text => CellValue::Text(lossy_text(bytes)),
    }
}

fn lossy_text(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes)
        .unwrap_or_else(|invalid| String::from_utf8_lossy(invalid.as_bytes()).into_owned())
}

fn big_endian_bits(bytes: &[u8]) -> u64 {
    bytes
        .iter()
        .fold(0, |value, byte| (value << BITS_PER_BYTE) | u64::from(*byte))
}

fn integer_from_text(bytes: Vec<u8>, column: &Column) -> CellValue {
    let text = lossy_text(bytes);
    parsed_integer(&text, column).unwrap_or(CellValue::Text(text))
}

fn parsed_integer(text: &str, column: &Column) -> Option<CellValue> {
    let unsigned = text.parse::<u64>().ok().map(CellValue::Unsigned);
    let signed = text.parse::<i64>().ok().map(CellValue::Signed);
    if has_unsigned_flag(column) {
        return unsigned.or(signed);
    }
    signed.or(unsigned)
}

fn float_from_text(bytes: Vec<u8>) -> CellValue {
    let text = lossy_text(bytes);
    match text.parse::<f64>() {
        Ok(number) => CellValue::Float(number),
        Err(_) => CellValue::Text(text),
    }
}

fn float_for_column(number: f32, column: &Column) -> f64 {
    let decimals = column.decimals();
    if decimals < NOT_FIXED_DECIMALS {
        return float_with_fixed_decimals(number, usize::from(decimals));
    }
    float_as_mysql_prints_it(number)
}

/// MySQL's text protocol prints FLOAT(M,D) with exactly D fractional digits via `my_fcvt`.
fn float_with_fixed_decimals(number: f32, decimals: usize) -> f64 {
    let rounded = format!("{number:.decimals$}");
    rounded.parse().unwrap_or(f64::from(number))
}

/// MySQL's text protocol prints FLOAT with `FLT_DIG` (6) significant digits via `my_gcvt`.
pub fn float_as_mysql_prints_it(number: f32) -> f64 {
    let fractional_digits = MYSQL_FLOAT_SIGNIFICANT_DIGITS - 1;
    let rounded = format!("{number:.fractional_digits$e}");
    rounded.parse().unwrap_or(f64::from(number))
}

pub fn minus_sign(is_negative: bool) -> &'static str {
    if is_negative {
        return "-";
    }
    ""
}

pub fn debug_text(cell: &CellValue) -> String {
    match cell {
        CellValue::Null => "None".to_string(),
        CellValue::Signed(number) => format!("Some({number})"),
        CellValue::Unsigned(number) | CellValue::Bit(number) => format!("Some({number})"),
        CellValue::Float(number) => format!("Some({number})"),
        CellValue::Decimal(text) | CellValue::Temporal(text) | CellValue::Text(text) => {
            format!("Some({text:?})")
        }
        CellValue::Bytes(bytes) => format!("bytes(len={})", bytes.len()),
    }
}

pub fn column_type_display_name(column: &Column) -> String {
    use mysql_async::consts::ColumnType::*;

    let is_unsigned = has_unsigned_flag(column);
    let is_binary = has_binary_character_set(column);
    let column_type = column.column_type();

    let name = match column_type {
        MYSQL_TYPE_TINY if is_unsigned => "TINYINT UNSIGNED",
        MYSQL_TYPE_TINY => "TINYINT",
        MYSQL_TYPE_SHORT if is_unsigned => "SMALLINT UNSIGNED",
        MYSQL_TYPE_SHORT => "SMALLINT",
        MYSQL_TYPE_INT24 if is_unsigned => "MEDIUMINT UNSIGNED",
        MYSQL_TYPE_INT24 => "MEDIUMINT",
        MYSQL_TYPE_LONG if is_unsigned => "INT UNSIGNED",
        MYSQL_TYPE_LONG => "INT",
        MYSQL_TYPE_LONGLONG if is_unsigned => "BIGINT UNSIGNED",
        MYSQL_TYPE_LONGLONG => "BIGINT",
        MYSQL_TYPE_FLOAT => "FLOAT",
        MYSQL_TYPE_DOUBLE => "DOUBLE",
        MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => "DECIMAL",
        MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE => "DATE",
        MYSQL_TYPE_DATETIME | MYSQL_TYPE_DATETIME2 => "DATETIME",
        MYSQL_TYPE_TIMESTAMP | MYSQL_TYPE_TIMESTAMP2 => "TIMESTAMP",
        MYSQL_TYPE_TIME | MYSQL_TYPE_TIME2 => "TIME",
        MYSQL_TYPE_YEAR => "YEAR",
        MYSQL_TYPE_BIT => "BIT",
        MYSQL_TYPE_JSON => "JSON",
        MYSQL_TYPE_ENUM => "ENUM",
        MYSQL_TYPE_SET => "SET",
        MYSQL_TYPE_TINY_BLOB if is_binary => "TINYBLOB",
        MYSQL_TYPE_TINY_BLOB => "TINYTEXT",
        MYSQL_TYPE_BLOB if is_binary => "BLOB",
        MYSQL_TYPE_BLOB => "TEXT",
        MYSQL_TYPE_MEDIUM_BLOB if is_binary => "MEDIUMBLOB",
        MYSQL_TYPE_MEDIUM_BLOB => "MEDIUMTEXT",
        MYSQL_TYPE_LONG_BLOB if is_binary => "LONGBLOB",
        MYSQL_TYPE_LONG_BLOB => "LONGTEXT",
        MYSQL_TYPE_STRING if is_binary => "BINARY",
        MYSQL_TYPE_STRING => "CHAR",
        MYSQL_TYPE_VAR_STRING if is_binary => "VARBINARY",
        MYSQL_TYPE_VAR_STRING => "VARCHAR",
        MYSQL_TYPE_GEOMETRY => "GEOMETRY",
        MYSQL_TYPE_NULL => "NULL",
        _ => return format!("{column_type:?}"),
    };
    name.to_string()
}
