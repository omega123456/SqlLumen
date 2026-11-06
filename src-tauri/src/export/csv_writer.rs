use csv::WriterBuilder;
use std::io::{self, Write};

/// Write query results as CSV to the given writer.
///
/// - `columns`: column names for the header row
/// - `rows`: data rows (each row is a slice of `serde_json::Value`)
/// - `include_headers`: whether to emit a header row
///
/// NULL values are written as empty fields (no content between commas).
/// Quoting and escaping are handled automatically by the `csv` crate.
pub fn write_csv<W: Write, R: AsRef<[serde_json::Value]>>(
    writer: &mut W,
    columns: &[String],
    rows: &[R],
    include_headers: bool,
) -> io::Result<()> {
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
    row.iter()
        .map(|v| match v {
            serde_json::Value::Null => String::new(), // empty field for NULL
            serde_json::Value::Bool(b) => {
                if *b {
                    "1".to_string()
                } else {
                    "0".to_string()
                }
            }
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .collect()
}
