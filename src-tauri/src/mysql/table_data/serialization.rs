#[cfg(not(coverage))]
use super::*;

pub(super) fn is_binary_data_type(data_type: &str) -> bool {
    let upper = data_type.to_uppercase();
    matches!(
        upper.as_str(),
        "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BINARY" | "VARBINARY"
    )
}

pub fn format_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];
    let mut value = bytes as f64 / 1024.0;
    let mut unit_index = 0;
    let last_unit_index = UNITS.len() - 1;
    while unit_index < last_unit_index {
        if value < 1024.0 {
            break;
        }
        value /= 1024.0;
        unit_index += 1;
    }
    let rounded = (value * 10.0).round() / 10.0;
    format!("{} {}", format_rounded_size(rounded), UNITS[unit_index])
}

pub(super) fn format_rounded_size(rounded: f64) -> String {
    let is_whole_number = rounded.fract().abs() < f64::EPSILON;
    if is_whole_number {
        return format!("{}", rounded as i64);
    }
    format!("{rounded:.1}")
}

pub fn parse_enum_values(column_type: &str) -> Option<Vec<String>> {
    parse_quoted_type_values(column_type, "enum")
}

pub fn parse_set_values(column_type: &str) -> Option<Vec<String>> {
    parse_quoted_type_values(column_type, "set")
}

pub(super) fn parse_quoted_type_values(column_type: &str, type_name: &str) -> Option<Vec<String>> {
    let trimmed = column_type.trim();
    let lower = trimmed.to_ascii_lowercase();
    let prefix = format!("{type_name}(");
    let is_parenthesised_type = lower.starts_with(&prefix) && trimmed.ends_with(')');
    if !is_parenthesised_type {
        return None;
    }

    let inner = &trimmed[prefix.len()..trimmed.len() - 1];
    let mut values = Vec::new();
    let mut current = String::new();
    let mut chars = inner.chars().peekable();
    let mut in_quote = false;

    while let Some(ch) = chars.next() {
        match ch {
            '\'' if !in_quote => in_quote = true,
            '\'' if matches!(chars.peek(), Some('\'')) => {
                current.push('\'');
                chars.next();
            }
            '\'' => in_quote = false,
            ',' if !in_quote => {
                values.push(current.clone());
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    if in_quote {
        return None;
    }

    values.push(current);
    Some(values)
}

#[cfg(not(coverage))]
pub(super) fn build_table_data_projection(
    columns: &[TableDataColumnMeta],
    primary_key_column_set: &std::collections::HashSet<&str>,
) -> Result<String, String> {
    let mut projection_parts = Vec::with_capacity(columns.len());

    for column in columns {
        let safe_col = safe_identifier(&column.name)?;
        let is_primary_key = primary_key_column_set.contains(column.name.as_str());
        let is_blob_placeholder = column.is_binary && !is_primary_key;
        projection_parts.push(projection_part(&safe_col, is_blob_placeholder));
    }

    Ok(projection_parts.join(", "))
}

#[cfg(not(coverage))]
pub(super) fn projection_part(safe_col: &str, is_blob_placeholder: bool) -> String {
    if is_blob_placeholder {
        return format!("OCTET_LENGTH({safe_col}) AS {safe_col}");
    }
    safe_col.to_string()
}

#[cfg(not(coverage))]
fn grid_cell_variant(encoding: CellEncoding) -> GridCellVariant {
    if !encoding.is_binary {
        return GridCellVariant::Value;
    }
    if encoding.is_primary_key {
        return GridCellVariant::BinaryPrimaryKey;
    }
    GridCellVariant::BlobPlaceholder
}

#[cfg(not(coverage))]
pub(super) fn serialize_table_value(cell: &CellValue, encoding: CellEncoding) -> serde_json::Value {
    grid_cell_json(cell, grid_cell_variant(encoding))
}
