//! SQL dump generation engine for exporting databases/tables as SQL dump files.
//!
//! Produces mysqldump-compatible output with:
//! - Header/footer comments with metadata
//! - `SHOW CREATE TABLE`/`SHOW CREATE VIEW` output
//! - Batched multi-row INSERT statements (up to 1000 rows per statement)
//! - Proper identifier and value escaping
//! - Type-aware value serialization preserving leading zeros, binary data, etc.

use std::io::{self, Write};

/// Maximum number of rows per INSERT statement for batched inserts.
pub const INSERT_BATCH_SIZE: usize = 1000;

/// Represents a cell value in a SQL dump with enough type information
/// to serialize it correctly in INSERT statements.
///
/// Unlike `serde_json::Value`, this preserves the distinction between
/// numeric types, quoted strings, binary data, and decimal precision.
#[derive(Debug, Clone, PartialEq)]
pub enum SqlDumpValue {
    /// SQL NULL.
    Null,
    /// Signed integer (TINYINT, SMALLINT, MEDIUMINT, INT, BIGINT).
    /// Emitted as an unquoted number.
    Int(i64),
    /// Unsigned integer (BIGINT UNSIGNED, etc.).
    /// Emitted as an unquoted number.
    UInt(u64),
    /// Floating-point value (FLOAT, DOUBLE).
    /// Emitted as an unquoted number.
    Float(f64),
    /// Exact numeric string for DECIMAL/NUMERIC.
    /// Emitted unquoted to preserve the exact representation from MySQL.
    Decimal(String),
    /// Quoted string value (VARCHAR, TEXT, DATE/TIME, ENUM, SET, JSON, etc.).
    /// Emitted as a properly SQL-escaped, single-quoted string.
    QuotedString(String),
    /// Binary data (BLOB, BINARY, VARBINARY).
    /// Emitted as a hex literal: `0xABCDEF`.
    HexBytes(Vec<u8>),
    /// Boolean value from BIT(1).
    /// Emitted as `1` or `0`.
    Bool(bool),
}

/// Options controlling what gets included in the SQL dump.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpOptions {
    /// Whether to include table structure (CREATE TABLE/VIEW).
    pub include_structure: bool,
    /// Whether to include data (INSERT statements).
    pub include_data: bool,
    /// Whether to include DROP TABLE IF EXISTS before CREATE.
    pub include_drop: bool,
    /// Whether to wrap in a transaction (SET AUTOCOMMIT=0, COMMIT).
    pub use_transaction: bool,
}

impl Default for DumpOptions {
    fn default() -> Self {
        Self {
            include_structure: true,
            include_data: true,
            include_drop: true,
            use_transaction: true,
        }
    }
}

/// Escape a SQL identifier by doubling any embedded backtick characters.
pub fn escape_identifier(name: &str) -> String {
    name.replace('`', "``")
}

/// Escape a SQL string value for use inside single quotes.
///
/// Handles: single quotes, backslashes, null bytes, newlines, and carriage returns.
pub fn escape_string_value(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '\'' => out.push_str("''"),
            '\\' => out.push_str("\\\\"),
            '\0' => out.push_str("\\0"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            _ => out.push(ch),
        }
    }
    out
}

/// Write the SQL dump file header.
pub fn write_header<W: Write>(
    writer: &mut W,
    database_name: &str,
    server_version: &str,
) -> io::Result<()> {
    writeln!(writer, "-- SQL Dump")?;
    writeln!(writer, "--")?;
    writeln!(writer, "-- Host: localhost    Database: {}", database_name)?;
    writeln!(writer, "-- Server version: {}", server_version)?;
    writeln!(
        writer,
        "-- ------------------------------------------------------"
    )?;
    writeln!(writer)?;
    writeln!(
        writer,
        "/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;"
    )?;
    writeln!(
        writer,
        "/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;"
    )?;
    writeln!(
        writer,
        "/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;"
    )?;
    writeln!(writer, "/*!40101 SET NAMES utf8mb4 */;")?;
    writeln!(writer)?;
    Ok(())
}

/// Write the SQL dump file footer.
pub fn write_footer<W: Write>(writer: &mut W) -> io::Result<()> {
    writeln!(writer)?;
    writeln!(
        writer,
        "/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;"
    )?;
    writeln!(
        writer,
        "/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;"
    )?;
    writeln!(
        writer,
        "/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;"
    )?;
    Ok(())
}

/// Write the structure (CREATE TABLE/VIEW) section for an object.
///
/// `create_statement` is the raw output from `SHOW CREATE TABLE`/`SHOW CREATE VIEW`.
pub fn write_structure<W: Write>(
    writer: &mut W,
    object_name: &str,
    create_statement: &str,
    include_drop: bool,
    is_view: bool,
) -> io::Result<()> {
    let escaped_name = escape_identifier(object_name);
    writeln!(writer, "--")?;
    let obj_type = if is_view { "View" } else { "Table structure" };
    writeln!(writer, "-- {} for `{}`", obj_type, escaped_name)?;
    writeln!(writer, "--")?;
    writeln!(writer)?;

    if include_drop {
        if is_view {
            writeln!(writer, "DROP VIEW IF EXISTS `{}`;", escaped_name)?;
        } else {
            writeln!(writer, "DROP TABLE IF EXISTS `{}`;", escaped_name)?;
        }
    }

    writeln!(
        writer,
        "{};",
        create_statement.trim_end().trim_end_matches(';')
    )?;
    writeln!(writer)?;
    Ok(())
}

/// Write batched INSERT statements for a table's data.
///
/// Rows are written in batches of up to `INSERT_BATCH_SIZE` rows per INSERT statement
/// using multi-row VALUES syntax for efficiency.
pub fn write_data_inserts<W: Write>(
    writer: &mut W,
    table_name: &str,
    columns: &[String],
    rows: &[Vec<SqlDumpValue>],
) -> io::Result<u64> {
    if rows.is_empty() || columns.is_empty() {
        return Ok(0);
    }

    let escaped_table = escape_identifier(table_name);
    let col_list: String = columns
        .iter()
        .map(|c| format!("`{}`", escape_identifier(c)))
        .collect::<Vec<_>>()
        .join(", ");

    writeln!(writer, "--")?;
    writeln!(writer, "-- Data for `{}`", escape_identifier(table_name))?;
    writeln!(writer, "--")?;
    writeln!(writer)?;

    writeln!(writer, "LOCK TABLES `{}` WRITE;", escaped_table)?;

    let mut total_rows: u64 = 0;

    for chunk in rows.chunks(INSERT_BATCH_SIZE) {
        write!(
            writer,
            "INSERT INTO `{}` ({}) VALUES",
            escaped_table, col_list
        )?;

        for (row_idx, row) in chunk.iter().enumerate() {
            if row_idx > 0 {
                write!(writer, ",")?;
            }
            write!(writer, "\n(")?;
            for (col_idx, val) in row.iter().enumerate() {
                if col_idx > 0 {
                    write!(writer, ", ")?;
                }
                write_value(writer, val)?;
            }
            write!(writer, ")")?;
            total_rows += 1;
        }
        writeln!(writer, ";")?;
    }

    writeln!(writer, "UNLOCK TABLES;")?;
    writeln!(writer)?;

    Ok(total_rows)
}

/// Write a single SQL dump value with correct quoting and escaping.
fn write_value<W: Write>(writer: &mut W, val: &SqlDumpValue) -> io::Result<()> {
    match val {
        SqlDumpValue::Null => write!(writer, "NULL"),
        SqlDumpValue::Int(n) => write!(writer, "{}", n),
        SqlDumpValue::UInt(n) => write!(writer, "{}", n),
        SqlDumpValue::Float(f) => {
            if f.is_nan() || f.is_infinite() {
                write!(writer, "NULL")
            } else {
                write!(writer, "{}", f)
            }
        }
        SqlDumpValue::Decimal(s) => write!(writer, "{}", s),
        SqlDumpValue::QuotedString(s) => {
            let escaped = escape_string_value(s);
            write!(writer, "'{}'", escaped)
        }
        SqlDumpValue::HexBytes(bytes) => {
            if bytes.is_empty() {
                write!(writer, "0x")
            } else {
                write!(writer, "0x")?;
                for b in bytes {
                    write!(writer, "{:02X}", b)?;
                }
                Ok(())
            }
        }
        SqlDumpValue::Bool(b) => write!(writer, "{}", if *b { 1 } else { 0 }),
    }
}

/// Write transaction wrappers (SET AUTOCOMMIT=0 at start, COMMIT at end).
pub fn write_transaction_start<W: Write>(writer: &mut W) -> io::Result<()> {
    writeln!(writer, "SET AUTOCOMMIT = 0;")?;
    writeln!(writer, "SET FOREIGN_KEY_CHECKS = 0;")?;
    writeln!(writer)?;
    Ok(())
}

/// Write transaction end markers.
pub fn write_transaction_end<W: Write>(writer: &mut W) -> io::Result<()> {
    writeln!(writer)?;
    writeln!(writer, "SET FOREIGN_KEY_CHECKS = 1;")?;
    writeln!(writer, "COMMIT;")?;
    Ok(())
}
