use std::io::{self, Write};

/// Write query results as a JSON array of objects to the given writer.
///
/// Output format: `[{"col1": val1, "col2": val2}, ...]`
///
/// - `columns`: column names used as object keys
/// - `rows`: data rows (each row is a slice of `serde_json::Value`)
/// - `_include_headers`: ignored for JSON (keys always included)
///
/// NULL values are written as JSON `null`.
pub fn write_json<W: Write, R: AsRef<[serde_json::Value]>>(
    writer: &mut W,
    columns: &[String],
    rows: &[R],
    _include_headers: bool,
) -> io::Result<()> {
    let mut array = Vec::with_capacity(rows.len());

    for row in rows.iter().map(AsRef::as_ref) {
        array.push(json_row_object(columns, row));
    }

    serde_json::to_writer_pretty(writer, &array).map_err(io::Error::other)
}

/// One row as a JSON object keyed by column name (missing cells are `null`).
/// Shared by the slice writer and the streaming writer.
pub fn json_row_object(columns: &[String], row: &[serde_json::Value]) -> serde_json::Value {
    let mut obj = serde_json::Map::new();
    for (i, col) in columns.iter().enumerate() {
        let value = row.get(i).cloned().unwrap_or(serde_json::Value::Null);
        obj.insert(col.clone(), value);
    }
    serde_json::Value::Object(obj)
}
