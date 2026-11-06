use rust_xlsxwriter::{Format, Workbook, Worksheet};

/// Write query results as an Excel (.xlsx) file.
///
/// - `file_path`: destination path for the .xlsx file
/// - `columns`: column names for the optional header row
/// - `rows`: data rows (each row is a slice of `serde_json::Value`)
/// - `include_headers`: whether to write a bold header row and freeze the top row
///
/// Returns the file size in bytes after writing.
/// NULL values produce empty cells.
/// Column widths are auto-sized based on header + data content (capped at 50 chars).
pub fn write_xlsx<R: AsRef<[serde_json::Value]>>(
    file_path: &str,
    columns: &[String],
    rows: &[R],
    include_headers: bool,
) -> Result<u64, String> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name("Query Results")
        .map_err(|e| e.to_string())?;

    let bold = Format::new().set_bold();
    let mut current_row: u32 = 0;

    if include_headers {
        for (col_idx, col_name) in columns.iter().enumerate() {
            worksheet
                .write_string_with_format(current_row, col_idx as u16, col_name, &bold)
                .map_err(|e| e.to_string())?;
        }
        worksheet
            .set_freeze_panes(1, 0)
            .map_err(|e| e.to_string())?;
        current_row += 1;
    }

    for row in rows.iter().map(AsRef::as_ref) {
        for (col_idx, val) in row.iter().enumerate() {
            write_xlsx_cell(worksheet, current_row, col_idx as u16, val)?;
        }
        current_row += 1;
    }

    // Auto-size column widths based on header + data content (capped at 50 chars)
    let col_widths: Vec<f64> = columns
        .iter()
        .enumerate()
        .map(|(col_idx, col_name)| {
            xlsx_column_width(col_name, rows.iter().map(|row| row.as_ref().get(col_idx)))
        })
        .collect();

    for (col_idx, width) in col_widths.iter().enumerate() {
        worksheet
            .set_column_width(col_idx as u16, *width)
            .map_err(|e| e.to_string())?;
    }

    workbook.save(file_path).map_err(|e| e.to_string())?;

    let metadata = std::fs::metadata(file_path).map_err(|e| e.to_string())?;
    Ok(metadata.len())
}

/// Write one cell: NULL leaves the cell empty, numbers are numeric when they
/// fit an `f64`, booleans are booleans and everything else is a string.
/// Shared by the slice writer and the streaming writer.
pub fn write_xlsx_cell(
    worksheet: &mut Worksheet,
    row: u32,
    col: u16,
    val: &serde_json::Value,
) -> Result<(), String> {
    match val {
        serde_json::Value::Null => {} // empty cell
        serde_json::Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                worksheet
                    .write_number(row, col, f)
                    .map_err(|e| e.to_string())?;
            } else {
                worksheet
                    .write_string(row, col, n.to_string())
                    .map_err(|e| e.to_string())?;
            }
        }
        serde_json::Value::String(s) => {
            worksheet
                .write_string(row, col, s)
                .map_err(|e| e.to_string())?;
        }
        serde_json::Value::Bool(b) => {
            worksheet
                .write_boolean(row, col, *b)
                .map_err(|e| e.to_string())?;
        }
        _ => {
            worksheet
                .write_string(row, col, val.to_string())
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Column width rule: the longest of the header and the given cells, plus 2
/// characters of padding, capped at 50. Shared by the slice writer (all rows)
/// and the streaming writer (its first-rows sample).
pub fn xlsx_column_width<'a>(
    header: &str,
    cells: impl Iterator<Item = Option<&'a serde_json::Value>>,
) -> f64 {
    let max_data_len = cells.fold(0usize, |acc, cell| {
        let cell_len = match cell {
            Some(serde_json::Value::Null) | None => 0,
            Some(serde_json::Value::String(s)) => s.len(),
            Some(val) => val.to_string().len(),
        };
        acc.max(cell_len)
    });
    let max_len = header.len().max(max_data_len);
    ((max_len as f64) + 2.0).min(50.0)
}
