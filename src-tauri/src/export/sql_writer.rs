use std::io::{self, Write};

/// Escape a SQL identifier by doubling any embedded backtick characters.
///
/// For example, `foo`bar` becomes `foo``bar`, which is safe inside `` `…` `` delimiters.
fn escape_identifier(name: &str) -> String {
    name.replace('`', "``")
}

/// Escape a SQL string value: double single-quotes and escape backslashes.
fn escape_string_value(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "''")
}

/// Write query results as SQL INSERT statements to the given writer.
///
/// Format (one statement per row):
/// ```sql
/// INSERT INTO `table_name` (`col1`, `col2`) VALUES ('value1', 123);
/// ```
///
/// - `columns`: column names for the INSERT column list
/// - `rows`: data rows (each row is a `Vec<serde_json::Value>`)
/// - `_include_headers`: ignored for SQL (column names always appear in INSERT)
/// - `table_name`: the table name used in the INSERT statement (must not be empty)
///
/// Value escaping:
/// - String: wrapped in single quotes, backslashes escaped, single quotes doubled
/// - Number: written as-is
/// - Boolean: written as 1 or 0
/// - NULL: written as SQL `NULL` keyword (no quotes)
///
/// Identifier escaping:
/// - Table name and column names have backtick characters doubled inside `` `…` `` delimiters
pub fn write_sql<W: Write>(
    writer: &mut W,
    columns: &[String],
    rows: &[Vec<serde_json::Value>],
    _include_headers: bool,
    table_name: &str,
) -> io::Result<()> {
    if table_name.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "table_name must not be empty",
        ));
    }

    let escaped_table = escape_identifier(table_name);
    let col_list: String = columns
        .iter()
        .map(|c| format!("`{}`", escape_identifier(c)))
        .collect::<Vec<_>>()
        .join(", ");

    for row in rows {
        write!(
            writer,
            "INSERT INTO `{escaped_table}` ({col_list}) VALUES ("
        )?;
        for (i, val) in row.iter().enumerate() {
            if i > 0 {
                write!(writer, ", ")?;
            }
            match val {
                serde_json::Value::Null => write!(writer, "NULL")?,
                serde_json::Value::String(s) => {
                    let escaped = escape_string_value(s);
                    write!(writer, "'{escaped}'")?;
                }
                serde_json::Value::Number(n) => write!(writer, "{n}")?,
                serde_json::Value::Bool(b) => {
                    write!(writer, "{}", if *b { 1 } else { 0 })?;
                }
                _ => {
                    let s = val.to_string();
                    let escaped = escape_string_value(&s);
                    write!(writer, "'{escaped}'")?;
                }
            }
        }
        writeln!(writer, ");")?;
    }

    Ok(())
}
