use csv::WriterBuilder;
use std::io::{self, Write};

/// Write query results as CSV to the given writer.
///
/// - `columns`: column names for the header row
/// - `rows`: data rows (each row is a `Vec<serde_json::Value>`)
/// - `include_headers`: whether to emit a header row
///
/// NULL values are written as empty fields (no content between commas).
/// Quoting and escaping are handled automatically by the `csv` crate.
pub fn write_csv<W: Write>(
    writer: &mut W,
    columns: &[String],
    rows: &[Vec<serde_json::Value>],
    include_headers: bool,
) -> io::Result<()> {
    let mut wtr = WriterBuilder::new()
        .has_headers(false) // we handle headers manually to control NULL behavior
        .from_writer(writer);

    if include_headers {
        wtr.write_record(columns)?;
    }

    for row in rows {
        let record: Vec<String> = row
            .iter()
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
            .collect();
        wtr.write_record(&record)?;
    }

    wtr.flush()?;
    Ok(())
}
