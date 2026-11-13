use crate::export::ExportRows;
use rust_xlsxwriter::{Format, Workbook, Worksheet};

#[derive(Debug, Clone, Copy)]
pub struct CellPosition {
    pub row: u32,
    pub col: u16,
}

pub fn write_xlsx<R: AsRef<[serde_json::Value]>>(
    file_path: &str,
    table: &ExportRows<'_, R>,
    include_headers: bool,
) -> Result<u64, String> {
    let columns = table.columns;
    let rows = table.rows;
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name("Query Results")
        .map_err(|error| error.to_string())?;

    let bold = Format::new().set_bold();
    let mut current_row: u32 = 0;

    if include_headers {
        for (column_index, col_name) in columns.iter().enumerate() {
            worksheet
                .write_string_with_format(current_row, column_index as u16, col_name, &bold)
                .map_err(|error| error.to_string())?;
        }
        worksheet
            .set_freeze_panes(1, 0)
            .map_err(|error| error.to_string())?;
        current_row += 1;
    }

    for row in rows.iter().map(AsRef::as_ref) {
        for (column_index, value) in row.iter().enumerate() {
            let position = CellPosition {
                row: current_row,
                col: column_index as u16,
            };
            write_xlsx_cell(worksheet, position, value)?;
        }
        current_row += 1;
    }

    // Auto-size column widths based on header + data content (capped at 50 chars)
    let col_widths: Vec<f64> = columns
        .iter()
        .enumerate()
        .map(|(column_index, col_name)| {
            xlsx_column_width(
                col_name,
                rows.iter().map(|row| row.as_ref().get(column_index)),
            )
        })
        .collect();

    for (column_index, width) in col_widths.iter().enumerate() {
        worksheet
            .set_column_width(column_index as u16, *width)
            .map_err(|error| error.to_string())?;
    }

    workbook
        .save(file_path)
        .map_err(|error| error.to_string())?;

    let metadata = std::fs::metadata(file_path).map_err(|error| error.to_string())?;
    Ok(metadata.len())
}

/// Write one cell: NULL leaves the cell empty, numbers are numeric when they
/// fit an `f64`, booleans are booleans and everything else is a string.
/// Shared by the slice writer and the streaming writer.
pub fn write_xlsx_cell(
    worksheet: &mut Worksheet,
    position: CellPosition,
    value: &serde_json::Value,
) -> Result<(), String> {
    let CellPosition { row, col } = position;
    match value {
        serde_json::Value::Null => {} // empty cell
        serde_json::Value::Number(number) => match number.as_f64() {
            Some(float) => {
                worksheet
                    .write_number(row, col, float)
                    .map_err(|error| error.to_string())?;
            }
            None => {
                worksheet
                    .write_string(row, col, number.to_string())
                    .map_err(|error| error.to_string())?;
            }
        },
        serde_json::Value::String(text) => {
            worksheet
                .write_string(row, col, text)
                .map_err(|error| error.to_string())?;
        }
        serde_json::Value::Bool(boolean) => {
            worksheet
                .write_boolean(row, col, *boolean)
                .map_err(|error| error.to_string())?;
        }
        _ => {
            worksheet
                .write_string(row, col, value.to_string())
                .map_err(|error| error.to_string())?;
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
            Some(serde_json::Value::String(text)) => text.len(),
            Some(value) => value.to_string().len(),
        };
        acc.max(cell_len)
    });
    let max_len = header.len().max(max_data_len);
    ((max_len as f64) + 2.0).min(50.0)
}
