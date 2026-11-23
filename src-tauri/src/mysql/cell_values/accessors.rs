use std::fmt::Debug;
use std::sync::Arc;

use mysql_async::prelude::ColumnIndex;
use mysql_async::{Column, Value};

use super::{CellValue, decode_owned_values};

#[derive(Debug, Clone, PartialEq)]
pub struct DecodedRow {
    columns: Arc<[Column]>,
    cells: Vec<CellValue>,
}

impl DecodedRow {
    pub fn new(columns: Arc<[Column]>, values: Vec<Value>) -> Self {
        let cells = decode_owned_values(values, &columns);
        Self { columns, cells }
    }

    pub fn from_row(row: mysql_async::Row) -> Self {
        let columns = row.columns();
        Self::new(columns, row.unwrap())
    }

    pub fn cells(&self) -> &[CellValue] {
        &self.cells
    }

    pub fn into_cells(self) -> Vec<CellValue> {
        self.cells
    }

    pub fn columns(&self) -> &[Column] {
        &self.columns
    }

    pub fn column_name(&self, column_index: usize) -> String {
        self.columns
            .get(column_index)
            .map(|column| column.name_str().into_owned())
            .unwrap_or_default()
    }

    pub fn cell<I: ColumnIndex + Debug>(&self, index: I) -> Result<&CellValue, String> {
        self.cell_at(&index)
    }

    pub fn required_text<I: ColumnIndex + Debug>(&self, index: I) -> Result<String, String> {
        let text = cell_text(self.cell_at(&index)?);
        text.ok_or_else(|| format!("Column {index:?} is NULL; text was expected"))
    }

    pub fn optional_text<I: ColumnIndex + Debug>(
        &self,
        index: I,
    ) -> Result<Option<String>, String> {
        Ok(cell_text(self.cell_at(&index)?))
    }

    pub fn text_or_empty<I: ColumnIndex + Debug>(&self, index: I) -> String {
        match self.cell_at(&index) {
            Ok(cell) => cell_text(cell).unwrap_or_default(),
            Err(error) => {
                tracing::warn!(%error, "missing column read as empty text");
                String::new()
            }
        }
    }

    pub fn into_optional_bytes<I: ColumnIndex + Debug>(
        mut self,
        index: I,
    ) -> Result<Option<Vec<u8>>, String> {
        let position = self.position_of(&index)?;
        Ok(cell_bytes(self.cells.swap_remove(position)))
    }

    pub fn optional_signed<I: ColumnIndex + Debug>(&self, index: I) -> Result<Option<i64>, String> {
        let cell = self.cell_at(&index)?;
        if *cell == CellValue::Null {
            return Ok(None);
        }
        cell_signed(cell)
            .map(Some)
            .ok_or_else(|| format!("Column {index:?} is not a signed integer: {cell:?}"))
    }

    pub fn signed<I: ColumnIndex + Debug>(&self, index: I) -> Result<i64, String> {
        let cell = self.cell_at(&index)?;
        cell_signed(cell)
            .ok_or_else(|| format!("Column {index:?} is not a signed integer: {cell:?}"))
    }

    pub fn optional_unsigned<I: ColumnIndex + Debug>(
        &self,
        index: I,
    ) -> Result<Option<u64>, String> {
        let cell = self.cell_at(&index)?;
        if *cell == CellValue::Null {
            return Ok(None);
        }
        cell_unsigned(cell)
            .map(Some)
            .ok_or_else(|| format!("Column {index:?} is not an unsigned integer: {cell:?}"))
    }

    pub fn unsigned<I: ColumnIndex + Debug>(&self, index: I) -> Result<u64, String> {
        let cell = self.cell_at(&index)?;
        cell_unsigned(cell)
            .ok_or_else(|| format!("Column {index:?} is not an unsigned integer: {cell:?}"))
    }

    fn cell_at<I: ColumnIndex + Debug>(&self, index: &I) -> Result<&CellValue, String> {
        let position = self.position_of(index)?;
        Ok(&self.cells[position])
    }

    fn position_of<I: ColumnIndex + Debug>(&self, index: &I) -> Result<usize, String> {
        index
            .idx(&self.columns)
            .filter(|position| *position < self.cells.len())
            .ok_or_else(|| format!("Column {index:?} is not in the result row"))
    }
}

fn cell_text(cell: &CellValue) -> Option<String> {
    match cell {
        CellValue::Null => None,
        CellValue::Signed(number) => Some(number.to_string()),
        CellValue::Unsigned(number) | CellValue::Bit(number) => Some(number.to_string()),
        CellValue::Float(number) => Some(number.to_string()),
        CellValue::Decimal(text) | CellValue::Temporal(text) | CellValue::Text(text) => {
            Some(text.clone())
        }
        CellValue::Bytes(bytes) => Some(String::from_utf8_lossy(bytes).into_owned()),
    }
}

fn cell_bytes(cell: CellValue) -> Option<Vec<u8>> {
    match cell {
        CellValue::Bytes(bytes) => Some(bytes),
        other => cell_text(&other).map(String::into_bytes),
    }
}

fn cell_signed(cell: &CellValue) -> Option<i64> {
    match cell {
        CellValue::Signed(number) => Some(*number),
        CellValue::Unsigned(number) | CellValue::Bit(number) => i64::try_from(*number).ok(),
        CellValue::Decimal(text) | CellValue::Text(text) => text.parse().ok(),
        _ => None,
    }
}

fn cell_unsigned(cell: &CellValue) -> Option<u64> {
    match cell {
        CellValue::Unsigned(number) | CellValue::Bit(number) => Some(*number),
        CellValue::Signed(number) => u64::try_from(*number).ok(),
        CellValue::Decimal(text) | CellValue::Text(text) => text.parse().ok(),
        _ => None,
    }
}
