use crate::export::ExportRows;
use std::io::{self, Write};

pub fn write_json<W: Write, R: AsRef<[serde_json::Value]>>(
    writer: &mut W,
    table: &ExportRows<'_, R>,
) -> io::Result<()> {
    let mut array = Vec::with_capacity(table.rows.len());

    for row in table.rows.iter().map(AsRef::as_ref) {
        array.push(json_row_object(table.columns, row));
    }

    serde_json::to_writer_pretty(writer, &array).map_err(io::Error::other)
}

pub fn json_row_object(columns: &[String], row: &[serde_json::Value]) -> serde_json::Value {
    let mut obj = serde_json::Map::new();
    for (column_index, col) in columns.iter().enumerate() {
        let value = row
            .get(column_index)
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        obj.insert(col.clone(), value);
    }
    serde_json::Value::Object(obj)
}
