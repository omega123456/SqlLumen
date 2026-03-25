use rust_xlsxwriter::{Format, Workbook};

/// Write query results as an Excel (.xlsx) file.
///
/// - `file_path`: destination path for the .xlsx file
/// - `columns`: column names for the optional header row
/// - `rows`: data rows (each row is a `Vec<serde_json::Value>`)
/// - `include_headers`: whether to write a bold header row and freeze the top row
///
/// Returns the file size in bytes after writing.
/// NULL values produce empty cells.
/// Column widths are auto-sized based on header + data content (capped at 50 chars).
pub fn write_xlsx(
    file_path: &str,
    columns: &[String],
    rows: &[Vec<serde_json::Value>],
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

    for row in rows {
        for (col_idx, val) in row.iter().enumerate() {
            let col = col_idx as u16;
            match val {
                serde_json::Value::Null => {} // empty cell
                serde_json::Value::Number(n) => {
                    if let Some(f) = n.as_f64() {
                        worksheet
                            .write_number(current_row, col, f)
                            .map_err(|e| e.to_string())?;
                    } else {
                        worksheet
                            .write_string(current_row, col, &n.to_string())
                            .map_err(|e| e.to_string())?;
                    }
                }
                serde_json::Value::String(s) => {
                    worksheet
                        .write_string(current_row, col, s)
                        .map_err(|e| e.to_string())?;
                }
                serde_json::Value::Bool(b) => {
                    worksheet
                        .write_boolean(current_row, col, *b)
                        .map_err(|e| e.to_string())?;
                }
                _ => {
                    worksheet
                        .write_string(current_row, col, &val.to_string())
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        current_row += 1;
    }

    // Auto-size column widths based on header + data content (capped at 50 chars)
    let col_widths: Vec<f64> = columns
        .iter()
        .enumerate()
        .map(|(col_idx, col_name)| {
            let header_len = col_name.len();
            let max_data_len = rows.iter().fold(0usize, |acc, row| {
                let cell_len = match row.get(col_idx) {
                    Some(serde_json::Value::Null) | None => 0,
                    Some(serde_json::Value::String(s)) => s.len(),
                    Some(val) => val.to_string().len(),
                };
                acc.max(cell_len)
            });
            let max_len = header_len.max(max_data_len);
            // Add 2 chars padding, cap at 50
            ((max_len as f64) + 2.0).min(50.0)
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
