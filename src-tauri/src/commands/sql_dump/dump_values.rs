use super::*;
use crate::mysql::cell_values::CellValue;

pub fn serialize_dump_value(cell: &CellValue) -> SqlDumpValue {
    match cell {
        CellValue::Null => SqlDumpValue::Null,
        CellValue::Signed(number) => SqlDumpValue::Int(*number),
        CellValue::Unsigned(number) | CellValue::Bit(number) => SqlDumpValue::UInt(*number),
        CellValue::Float(number) => SqlDumpValue::Float(*number),
        CellValue::Decimal(text) => SqlDumpValue::Decimal(text.clone()),
        CellValue::Temporal(text) | CellValue::Text(text) => {
            SqlDumpValue::QuotedString(text.clone())
        }
        CellValue::Bytes(bytes) => SqlDumpValue::HexBytes(bytes.clone()),
    }
}

pub fn serialize_dump_row(row: &DecodedRow) -> Vec<SqlDumpValue> {
    row.cells().iter().map(serialize_dump_value).collect()
}
