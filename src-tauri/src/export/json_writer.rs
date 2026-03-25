use std::io::{self, Write};

/// Write query results as a JSON array of objects to the given writer.
///
/// Output format: `[{"col1": val1, "col2": val2}, ...]`
///
/// - `columns`: column names used as object keys
/// - `rows`: data rows (each row is a `Vec<serde_json::Value>`)
/// - `_include_headers`: ignored for JSON (keys always included)
///
/// NULL values are written as JSON `null`.
pub fn write_json<W: Write>(
    writer: &mut W,
    columns: &[String],
    rows: &[Vec<serde_json::Value>],
    _include_headers: bool,
) -> io::Result<()> {
    let mut array = Vec::with_capacity(rows.len());

    for row in rows {
        let mut obj = serde_json::Map::new();
        for (i, col) in columns.iter().enumerate() {
            let value = row.get(i).cloned().unwrap_or(serde_json::Value::Null);
            obj.insert(col.clone(), value);
        }
        array.push(serde_json::Value::Object(obj));
    }

    serde_json::to_writer_pretty(writer, &array)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))
}
