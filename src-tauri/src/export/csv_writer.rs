use crate::export::ExportRows;
use csv::WriterBuilder;
use std::io::{self, Write};

pub fn write_csv<W: Write, R: AsRef<[serde_json::Value]>>(
    writer: &mut W,
    table: &ExportRows<'_, R>,
    include_headers: bool,
) -> io::Result<()> {
    let columns = table.columns;
    let rows = table.rows;
    let mut wtr = WriterBuilder::new()
        .has_headers(false) // we handle headers manually to control NULL behavior
        .from_writer(writer);

    if include_headers {
        wtr.write_record(columns)?;
    }

    for row in rows.iter().map(AsRef::as_ref) {
        wtr.write_record(csv_record(row))?;
    }

    wtr.flush()?;
    Ok(())
}

/// The CSV fields of one row: NULL is an empty field, booleans are `1`/`0`,
/// strings are written as-is and other values use their JSON text. Shared by
/// the slice writer and the streaming writer so their output is identical.
pub fn csv_record(row: &[serde_json::Value]) -> Vec<String> {
    row.iter().map(csv_field).collect()
}

pub fn csv_field(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::Bool(true) => "1".to_string(),
        serde_json::Value::Bool(false) => "0".to_string(),
        serde_json::Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}
