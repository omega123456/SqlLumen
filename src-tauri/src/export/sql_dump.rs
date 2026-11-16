use std::io::{self, Write};

pub const INSERT_BATCH_SIZE: usize = 1000;

#[derive(Debug, Clone, PartialEq)]
pub enum SqlDumpValue {
    Null,
    Int(i64),
    UInt(u64),
    Float(f64),
    Decimal(String),
    QuotedString(String),
    HexBytes(Vec<u8>),
    Bool(bool),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpOptions {
    pub include_structure: bool,
    pub include_data: bool,
    pub include_drop: bool,
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

pub fn escape_identifier(name: &str) -> String {
    name.replace('`', "``")
}

pub fn escape_string_value(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    for ch in text.chars() {
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
    write_utc_time_zone_header(writer)?;
    writeln!(writer)?;
    Ok(())
}

pub fn write_utc_time_zone_header<W: Write>(writer: &mut W) -> io::Result<()> {
    writeln!(writer, "/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;")?;
    writeln!(writer, "/*!40103 SET TIME_ZONE='+00:00' */;")
}

pub fn write_time_zone_restore_footer<W: Write>(writer: &mut W) -> io::Result<()> {
    writeln!(writer, "/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;")
}

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
    write_time_zone_restore_footer(writer)
}

pub fn dump_object_keyword(is_view: bool) -> &'static str {
    if is_view {
        return "VIEW";
    }
    "TABLE"
}

fn structure_comment_label(is_view: bool) -> &'static str {
    if is_view {
        return "View";
    }
    "Table structure"
}

#[derive(Debug, Clone, Copy)]
pub struct DumpStructure<'a> {
    pub table_name: &'a str,
    pub create_sql: &'a str,
    pub include_drop: bool,
    pub is_view: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct InsertTarget<'a> {
    pub escaped_table: &'a str,
    pub col_list: &'a str,
}

#[derive(Debug, Clone, Copy)]
pub struct DumpTableRows<'a> {
    pub table_name: &'a str,
    pub columns: &'a [String],
    pub rows: &'a [Vec<SqlDumpValue>],
}

pub fn write_structure<W: Write>(writer: &mut W, structure: &DumpStructure<'_>) -> io::Result<()> {
    let DumpStructure {
        table_name: object_name,
        create_sql: create_statement,
        include_drop,
        is_view,
    } = *structure;
    let escaped_name = escape_identifier(object_name);
    writeln!(writer, "--")?;
    let obj_type = structure_comment_label(is_view);
    writeln!(writer, "-- {} for `{}`", obj_type, escaped_name)?;
    writeln!(writer, "--")?;
    writeln!(writer)?;

    if include_drop {
        let object_keyword = dump_object_keyword(is_view);
        writeln!(
            writer,
            "DROP {object_keyword} IF EXISTS `{}`;",
            escaped_name
        )?;
    }

    writeln!(
        writer,
        "{};",
        create_statement.trim_end().trim_end_matches(';')
    )?;
    writeln!(writer)?;
    Ok(())
}

pub fn write_insert_batch<W: Write>(
    writer: &mut W,
    target: &InsertTarget<'_>,
    batch: &[Vec<SqlDumpValue>],
) -> io::Result<u64> {
    let InsertTarget {
        escaped_table,
        col_list,
    } = *target;
    if batch.is_empty() {
        return Ok(0);
    }

    write!(
        writer,
        "INSERT INTO `{}` ({}) VALUES",
        escaped_table, col_list
    )?;

    let mut count: u64 = 0;
    for (row_index, row) in batch.iter().enumerate() {
        if row_index > 0 {
            write!(writer, ",")?;
        }
        write!(writer, "\n(")?;
        write_row_values(writer, row)?;
        write!(writer, ")")?;
        count += 1;
    }
    writeln!(writer, ";")?;

    Ok(count)
}

fn write_row_values<W: Write>(writer: &mut W, row: &[SqlDumpValue]) -> io::Result<()> {
    for (column_index, value) in row.iter().enumerate() {
        if column_index > 0 {
            write!(writer, ", ")?;
        }
        write_value(writer, value)?;
    }
    Ok(())
}

pub fn write_data_inserts<W: Write>(writer: &mut W, table: &DumpTableRows<'_>) -> io::Result<u64> {
    let DumpTableRows {
        table_name,
        columns,
        rows,
    } = *table;
    let has_nothing_to_insert = rows.is_empty() || columns.is_empty();
    if has_nothing_to_insert {
        return Ok(0);
    }

    let escaped_table = escape_identifier(table_name);
    let col_list: String = columns
        .iter()
        .map(|column| format!("`{}`", escape_identifier(column)))
        .collect::<Vec<_>>()
        .join(", ");

    writeln!(writer, "--")?;
    writeln!(writer, "-- Data for `{}`", escape_identifier(table_name))?;
    writeln!(writer, "--")?;
    writeln!(writer)?;

    writeln!(writer, "LOCK TABLES `{}` WRITE;", escaped_table)?;

    let mut total_rows: u64 = 0;

    for chunk in rows.chunks(INSERT_BATCH_SIZE) {
        let target = InsertTarget {
            escaped_table: &escaped_table,
            col_list: &col_list,
        };
        total_rows += write_insert_batch(writer, &target, chunk)?;
    }

    writeln!(writer, "UNLOCK TABLES;")?;
    writeln!(writer)?;

    Ok(total_rows)
}

pub fn value_to_literal(value: &SqlDumpValue) -> String {
    match value {
        SqlDumpValue::Null => "NULL".to_string(),
        SqlDumpValue::Int(number) => number.to_string(),
        SqlDumpValue::UInt(number) => number.to_string(),
        SqlDumpValue::Float(float) if !float.is_finite() => "NULL".to_string(),
        SqlDumpValue::Float(float) => float.to_string(),
        SqlDumpValue::Decimal(text) => text.clone(),
        SqlDumpValue::QuotedString(text) => format!("'{}'", escape_string_value(text)),
        SqlDumpValue::HexBytes(bytes) => {
            let mut out = String::with_capacity(2 + bytes.len() * 2);
            out.push_str("0x");
            for byte in bytes {
                use std::fmt::Write as _;
                let _ = write!(out, "{:02X}", byte);
            }
            out
        }
        SqlDumpValue::Bool(true) => "1".to_string(),
        SqlDumpValue::Bool(false) => "0".to_string(),
    }
}

pub fn value_byte_len(value: &SqlDumpValue) -> usize {
    value_to_literal(value).len()
}

fn write_value<W: Write>(writer: &mut W, value: &SqlDumpValue) -> io::Result<()> {
    write!(writer, "{}", value_to_literal(value))
}

pub fn write_transaction_start<W: Write>(writer: &mut W) -> io::Result<()> {
    writeln!(writer, "SET AUTOCOMMIT = 0;")?;
    writeln!(writer, "SET FOREIGN_KEY_CHECKS = 0;")?;
    writeln!(writer)?;
    Ok(())
}

pub fn write_transaction_end<W: Write>(writer: &mut W) -> io::Result<()> {
    writeln!(writer)?;
    writeln!(writer, "SET FOREIGN_KEY_CHECKS = 1;")?;
    writeln!(writer, "COMMIT;")?;
    Ok(())
}
