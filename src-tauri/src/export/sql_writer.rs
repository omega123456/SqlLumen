use crate::export::ExportRows;
use std::io::{self, Write};

/// Escape a SQL identifier by doubling any embedded backtick characters.
///
/// For example, `foo`bar` becomes `foo``bar`, which is safe inside `` `…` `` delimiters.
fn escape_identifier(name: &str) -> String {
    name.replace('`', "``")
}

/// Escape a SQL string value: double single-quotes and escape backslashes.
fn escape_string_value(text: &str) -> String {
    text.replace('\\', "\\\\").replace('\'', "''")
}

pub fn write_sql<W: Write, R: AsRef<[serde_json::Value]>>(
    writer: &mut W,
    table: &ExportRows<'_, R>,
    table_name: &str,
) -> io::Result<()> {
    if table_name.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "table_name must not be empty",
        ));
    }

    let prefix = sql_insert_prefix(table_name, table.columns);
    for row in table.rows.iter().map(AsRef::as_ref) {
        write_sql_row(writer, &prefix, row)?;
    }

    Ok(())
}

/// The shared `INSERT INTO … VALUES (` prefix of every row, with escaped identifiers.
pub fn sql_insert_prefix(table_name: &str, columns: &[String]) -> String {
    let escaped_table = escape_identifier(table_name);
    let col_list: String = columns
        .iter()
        .map(|column| format!("`{}`", escape_identifier(column)))
        .collect::<Vec<_>>()
        .join(", ");
    format!("INSERT INTO `{escaped_table}` ({col_list}) VALUES (")
}

/// Write one `INSERT` statement (see [`write_sql`] for the value escaping).
/// Shared by the slice writer and the streaming writer.
pub fn write_sql_row<W: Write>(
    writer: &mut W,
    prefix: &str,
    row: &[serde_json::Value],
) -> io::Result<()> {
    writer.write_all(prefix.as_bytes())?;
    for (column_index, value) in row.iter().enumerate() {
        if column_index > 0 {
            write!(writer, ", ")?;
        }
        match value {
            serde_json::Value::Null => write!(writer, "NULL")?,
            serde_json::Value::String(text) => {
                let escaped = escape_string_value(text);
                write!(writer, "'{escaped}'")?;
            }
            serde_json::Value::Number(number) => write!(writer, "{number}")?,
            serde_json::Value::Bool(true) => write!(writer, "1")?,
            serde_json::Value::Bool(false) => write!(writer, "0")?,
            _ => {
                let text = value.to_string();
                let escaped = escape_string_value(&text);
                write!(writer, "'{escaped}'")?;
            }
        }
    }
    writeln!(writer, ");")
}
