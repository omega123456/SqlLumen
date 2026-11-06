//! Incremental row sinks for the streaming full export of a truncated result.
//!
//! Each sink takes the header once (at creation), then rows one at a time,
//! then finishes. CSV, JSON and SQL INSERT output is byte-identical to the
//! slice writers (`csv_writer`, `json_writer`, `sql_writer`) for the same
//! columns and rows, because both use the same per-row helpers. XLSX streams
//! through `rust_xlsxwriter`'s constant-memory mode: it buffers the first
//! [`XLSX_WIDTH_SAMPLE_ROWS`] rows to size the columns with the slice writer's
//! width rule, then writes rows straight through, and stops at the sheet row
//! limit (reported through [`RowSink::stopped_at_sheet_limit`]).

use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};

use rust_xlsxwriter::{Format, Workbook};

use super::{csv_writer, json_writer, sql_writer, xlsx_writer, ExportFormat};

/// Excel's sheet row limit, header row included.
pub const XLSX_SHEET_ROW_LIMIT: u32 = 1_048_576;

/// Rows buffered before an XLSX stream sizes its columns and starts writing.
pub const XLSX_WIDTH_SAMPLE_ROWS: usize = 1_000;

/// Table name used for SQL INSERT output when none is given (as the slice writer).
pub const DEFAULT_SQL_TABLE_NAME: &str = "exported_results";

/// What happened to a row handed to [`RowSink::write_row`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowWrite {
    /// The row was written (or buffered for the XLSX width sample).
    Written,
    /// The XLSX sheet is full; the row was not written and no further row will be.
    SheetLimitReached,
}

/// Totals reported once a sink has finished.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamSummary {
    pub rows_written: u64,
    /// Size of the finished file.
    pub bytes_written: u64,
    pub stopped_at_sheet_limit: bool,
}

/// A `Write` adapter that counts the bytes passed through it.
struct CountingWriter<W: Write> {
    inner: W,
    bytes: u64,
}

impl<W: Write> Write for CountingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let written = self.inner.write(buf)?;
        self.bytes += written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

type FileOut = CountingWriter<BufWriter<File>>;

/// Map an I/O (or CSV) error to the user-facing message for `context`.
fn io_err<E: std::fmt::Display>(context: &'static str) -> impl FnOnce(E) -> String {
    move |e| format!("{context}: {e}")
}

/// Map an XLSX writer error to a message.
fn xlsx_err(e: rust_xlsxwriter::XlsxError) -> String {
    format!("Failed to write XLSX: {e}")
}

fn create_file(path: &Path) -> Result<FileOut, String> {
    let file = File::create(path).map_err(io_err("Failed to create file"))?;
    Ok(CountingWriter {
        inner: BufWriter::new(file),
        bytes: 0,
    })
}

struct XlsxSink {
    workbook: Workbook,
    columns: Vec<String>,
    /// Rows held back until the width sample is complete (`None` once flushed).
    sample: Option<Vec<Vec<serde_json::Value>>>,
    /// Sheet row of the next row to write (1 after a header row, else 0).
    next_row: u32,
    /// Sheet row limit, header included (an injectable test seam).
    row_limit: u32,
    stopped: bool,
}

impl XlsxSink {
    fn new(columns: &[String], include_headers: bool, row_limit: u32) -> Result<Self, String> {
        let mut workbook = Workbook::new();
        let worksheet = workbook
            .add_worksheet_with_constant_memory()
            .map_err(xlsx_err)?;
        worksheet.set_name("Query Results").map_err(xlsx_err)?;
        let mut next_row = 0;
        if include_headers {
            let bold = Format::new().set_bold();
            for (col_idx, col_name) in columns.iter().enumerate() {
                worksheet
                    .write_string_with_format(0, col_idx as u16, col_name, &bold)
                    .map_err(xlsx_err)?;
            }
            worksheet.set_freeze_panes(1, 0).map_err(xlsx_err)?;
            next_row = 1;
        }
        Ok(Self {
            workbook,
            columns: columns.to_vec(),
            sample: Some(Vec::new()),
            next_row,
            row_limit,
            stopped: false,
        })
    }

    fn write_row(&mut self, row: &[serde_json::Value]) -> Result<RowWrite, String> {
        let buffered = self.sample.as_ref().map_or(0, Vec::len) as u32;
        if self.stopped || self.next_row + buffered >= self.row_limit {
            self.stopped = true;
            return Ok(RowWrite::SheetLimitReached);
        }
        if let Some(sample) = self.sample.as_mut() {
            sample.push(row.to_vec());
            if sample.len() >= XLSX_WIDTH_SAMPLE_ROWS {
                self.flush_sample()?;
            }
            return Ok(RowWrite::Written);
        }
        self.write_sheet_row(row)?;
        Ok(RowWrite::Written)
    }

    /// Size the columns from the buffered sample, then write the sample rows.
    fn flush_sample(&mut self) -> Result<(), String> {
        let Some(sample) = self.sample.take() else {
            return Ok(());
        };
        let worksheet = self.workbook.worksheet_from_index(0).map_err(xlsx_err)?;
        for (col_idx, col_name) in self.columns.iter().enumerate() {
            let width =
                xlsx_writer::xlsx_column_width(col_name, sample.iter().map(|row| row.get(col_idx)));
            worksheet
                .set_column_width(col_idx as u16, width)
                .map_err(xlsx_err)?;
        }
        for row in &sample {
            self.write_sheet_row(row)?;
        }
        Ok(())
    }

    fn write_sheet_row(&mut self, row: &[serde_json::Value]) -> Result<(), String> {
        let worksheet = self.workbook.worksheet_from_index(0).map_err(xlsx_err)?;
        for (col_idx, val) in row.iter().enumerate() {
            xlsx_writer::write_xlsx_cell(worksheet, self.next_row, col_idx as u16, val)?;
        }
        self.next_row += 1;
        Ok(())
    }

    fn finish(mut self, path: &Path) -> Result<(), String> {
        self.flush_sample()?;
        self.workbook.save(path).map_err(xlsx_err)
    }
}

enum SinkKind {
    Csv(Box<csv::Writer<FileOut>>),
    Json { out: FileOut, columns: Vec<String> },
    Sql { out: FileOut, prefix: String },
    Xlsx(Box<XlsxSink>),
}

/// An incremental writer for one export file.
pub struct RowSink {
    kind: SinkKind,
    path: PathBuf,
    rows_written: u64,
}

impl RowSink {
    /// Create the file at `path` and write the header (CSV with headers, XLSX
    /// with headers). JSON and SQL ignore `include_headers`, as the slice
    /// writers do. `table_name` is only used for SQL INSERT output.
    pub fn create(
        format: &ExportFormat,
        path: &Path,
        columns: &[String],
        include_headers: bool,
        table_name: Option<&str>,
    ) -> Result<Self, String> {
        Self::create_with_sheet_row_limit(
            format,
            path,
            columns,
            include_headers,
            table_name,
            XLSX_SHEET_ROW_LIMIT,
        )
    }

    /// [`RowSink::create`] with an explicit XLSX sheet row limit (header
    /// included). Tests use it to reach the limit with a handful of rows.
    pub fn create_with_sheet_row_limit(
        format: &ExportFormat,
        path: &Path,
        columns: &[String],
        include_headers: bool,
        table_name: Option<&str>,
        sheet_row_limit: u32,
    ) -> Result<Self, String> {
        let kind = match format {
            ExportFormat::Csv => {
                let mut wtr = csv::WriterBuilder::new()
                    .has_headers(false)
                    .from_writer(create_file(path)?);
                if include_headers {
                    wtr.write_record(columns)
                        .map_err(io_err("Failed to write CSV"))?;
                }
                SinkKind::Csv(Box::new(wtr))
            }
            ExportFormat::Json => SinkKind::Json {
                out: create_file(path)?,
                columns: columns.to_vec(),
            },
            ExportFormat::SqlInsert => {
                let table_name = table_name.unwrap_or(DEFAULT_SQL_TABLE_NAME);
                if table_name.is_empty() {
                    return Err("Failed to write SQL: table_name must not be empty".to_string());
                }
                SinkKind::Sql {
                    out: create_file(path)?,
                    prefix: sql_writer::sql_insert_prefix(table_name, columns),
                }
            }
            ExportFormat::Xlsx => SinkKind::Xlsx(Box::new(XlsxSink::new(
                columns,
                include_headers,
                sheet_row_limit,
            )?)),
        };
        Ok(Self {
            kind,
            path: path.to_path_buf(),
            rows_written: 0,
        })
    }

    /// Write one row. Once an XLSX sheet is full every call returns
    /// [`RowWrite::SheetLimitReached`] and nothing more is written.
    pub fn write_row(&mut self, row: &[serde_json::Value]) -> Result<RowWrite, String> {
        let first = self.rows_written == 0;
        let outcome = match &mut self.kind {
            SinkKind::Csv(wtr) => {
                wtr.write_record(csv_writer::csv_record(row))
                    .map_err(io_err("Failed to write CSV"))?;
                RowWrite::Written
            }
            SinkKind::Json { out, columns } => {
                write_json_row(out, first, &json_writer::json_row_object(columns, row))
                    .map_err(io_err("Failed to write JSON"))?;
                RowWrite::Written
            }
            SinkKind::Sql { out, prefix } => {
                sql_writer::write_sql_row(out, prefix, row)
                    .map_err(io_err("Failed to write SQL"))?;
                RowWrite::Written
            }
            SinkKind::Xlsx(sink) => sink.write_row(row)?,
        };
        if outcome == RowWrite::Written {
            self.rows_written += 1;
        }
        Ok(outcome)
    }

    /// Rows written (or buffered) so far.
    pub fn rows_written(&self) -> u64 {
        self.rows_written
    }

    /// Bytes handed to the file so far. XLSX reports 0 until it is saved.
    pub fn bytes_written(&self) -> u64 {
        match &self.kind {
            SinkKind::Csv(wtr) => wtr.get_ref().bytes,
            SinkKind::Json { out, .. } | SinkKind::Sql { out, .. } => out.bytes,
            SinkKind::Xlsx(_) => 0,
        }
    }

    /// True once an XLSX sheet hit its row limit.
    pub fn stopped_at_sheet_limit(&self) -> bool {
        matches!(&self.kind, SinkKind::Xlsx(sink) if sink.stopped)
    }

    /// Finish the file (closing JSON, saving XLSX) and report its size.
    pub fn finish(self) -> Result<StreamSummary, String> {
        let stopped_at_sheet_limit = self.stopped_at_sheet_limit();
        let rows_written = self.rows_written;
        match self.kind {
            SinkKind::Csv(wtr) => {
                let mut out = wtr
                    .into_inner()
                    .map_err(csv::IntoInnerError::into_error)
                    .map_err(io_err("Failed to write CSV"))?;
                out.flush().map_err(io_err("Failed to flush file"))?;
            }
            SinkKind::Json { mut out, .. } => {
                let tail: &[u8] = if rows_written == 0 { b"[]" } else { b"\n]" };
                out.write_all(tail)
                    .and_then(|()| out.flush())
                    .map_err(io_err("Failed to write JSON"))?;
            }
            SinkKind::Sql { mut out, .. } => {
                out.flush().map_err(io_err("Failed to flush file"))?;
            }
            SinkKind::Xlsx(sink) => sink.finish(&self.path)?,
        }
        let bytes_written = std::fs::metadata(&self.path)
            .map_err(io_err("Failed to read file size"))?
            .len();
        Ok(StreamSummary {
            rows_written,
            bytes_written,
            stopped_at_sheet_limit,
        })
    }
}

/// Write one element of the top-level JSON array exactly as
/// `serde_json::to_writer_pretty` lays it out inside an array: `[` and a
/// newline before the first element, `,` and a newline between elements, and
/// every line of the element indented by two spaces. Serialized strings never
/// contain raw newlines, so indenting after each newline is exact.
fn write_json_row<W: Write>(
    out: &mut W,
    first: bool,
    object: &serde_json::Value,
) -> io::Result<()> {
    let pretty = serde_json::to_vec_pretty(object).map_err(io::Error::other)?;
    out.write_all(if first { b"[\n  " } else { b",\n  " })?;
    let mut lines = pretty.split(|&b| b == b'\n');
    if let Some(line) = lines.next() {
        out.write_all(line)?;
    }
    for line in lines {
        out.write_all(b"\n  ")?;
        out.write_all(line)?;
    }
    Ok(())
}
