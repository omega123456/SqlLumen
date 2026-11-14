use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};

use rust_xlsxwriter::{Format, Workbook};

use super::{csv_writer, json_writer, sql_writer, xlsx_writer, ExportFormat};

pub const XLSX_SHEET_ROW_LIMIT: u32 = 1_048_576;

pub const XLSX_WIDTH_SAMPLE_ROWS: usize = 1_000;

pub const DEFAULT_SQL_TABLE_NAME: &str = "exported_results";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowWrite {
    Written,
    SheetLimitReached,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamSummary {
    pub rows_written: u64,
    pub bytes_written: u64,
    pub stopped_at_sheet_limit: bool,
}

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

fn io_err<E: std::fmt::Display>(context: &'static str) -> impl FnOnce(E) -> String {
    move |error| format!("{context}: {error}")
}

fn xlsx_err(error: rust_xlsxwriter::XlsxError) -> String {
    format!("Failed to write XLSX: {error}")
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
    sample: Option<Vec<Vec<serde_json::Value>>>,
    next_row: u32,
    row_limit: u32,
    stopped: bool,
}

fn write_xlsx_header_row(
    worksheet: &mut rust_xlsxwriter::Worksheet,
    columns: &[String],
) -> Result<(), String> {
    let bold = Format::new().set_bold();
    for (column_index, col_name) in columns.iter().enumerate() {
        worksheet
            .write_string_with_format(0, column_index as u16, col_name, &bold)
            .map_err(xlsx_err)?;
    }
    worksheet.set_freeze_panes(1, 0).map_err(xlsx_err)?;
    Ok(())
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
            write_xlsx_header_row(worksheet, columns)?;
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
        let is_sheet_full = self.stopped || self.next_row + buffered >= self.row_limit;
        if is_sheet_full {
            self.stopped = true;
            return Ok(RowWrite::SheetLimitReached);
        }
        let Some(sample) = self.sample.as_mut() else {
            self.write_sheet_row(row)?;
            return Ok(RowWrite::Written);
        };
        sample.push(row.to_vec());
        let is_sample_complete = sample.len() >= XLSX_WIDTH_SAMPLE_ROWS;
        if is_sample_complete {
            self.flush_sample()?;
        }
        Ok(RowWrite::Written)
    }

    fn flush_sample(&mut self) -> Result<(), String> {
        let Some(sample) = self.sample.take() else {
            return Ok(());
        };
        let worksheet = self.workbook.worksheet_from_index(0).map_err(xlsx_err)?;
        for (column_index, col_name) in self.columns.iter().enumerate() {
            let width = xlsx_writer::xlsx_column_width(
                col_name,
                sample.iter().map(|row| row.get(column_index)),
            );
            worksheet
                .set_column_width(column_index as u16, width)
                .map_err(xlsx_err)?;
        }
        for row in &sample {
            self.write_sheet_row(row)?;
        }
        Ok(())
    }

    fn write_sheet_row(&mut self, row: &[serde_json::Value]) -> Result<(), String> {
        let worksheet = self.workbook.worksheet_from_index(0).map_err(xlsx_err)?;
        for (column_index, value) in row.iter().enumerate() {
            let position = xlsx_writer::CellPosition {
                row: self.next_row,
                col: column_index as u16,
            };
            xlsx_writer::write_xlsx_cell(worksheet, position, value)?;
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

fn create_csv_sink(
    path: &Path,
    columns: &[String],
    include_headers: bool,
) -> Result<SinkKind, String> {
    let mut wtr = csv::WriterBuilder::new()
        .has_headers(false)
        .from_writer(create_file(path)?);
    if include_headers {
        wtr.write_record(columns)
            .map_err(io_err("Failed to write CSV"))?;
    }
    Ok(SinkKind::Csv(Box::new(wtr)))
}

fn create_sql_sink(spec: &RowSinkSpec<'_>) -> Result<SinkKind, String> {
    let table_name = spec.table_name.unwrap_or(DEFAULT_SQL_TABLE_NAME);
    if table_name.is_empty() {
        return Err("Failed to write SQL: table_name must not be empty".to_string());
    }
    Ok(SinkKind::Sql {
        out: create_file(spec.path)?,
        prefix: sql_writer::sql_insert_prefix(table_name, spec.columns),
    })
}

pub struct RowSink {
    kind: SinkKind,
    path: PathBuf,
    rows_written: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct RowSinkSpec<'a> {
    pub format: &'a ExportFormat,
    pub path: &'a Path,
    pub columns: &'a [String],
    pub include_headers: bool,
    pub table_name: Option<&'a str>,
}

impl RowSink {
    pub fn create(spec: &RowSinkSpec<'_>) -> Result<Self, String> {
        Self::create_with_sheet_row_limit(spec, XLSX_SHEET_ROW_LIMIT)
    }

    pub fn create_with_sheet_row_limit(
        spec: &RowSinkSpec<'_>,
        sheet_row_limit: u32,
    ) -> Result<Self, String> {
        let RowSinkSpec {
            format,
            path,
            columns,
            include_headers,
            ..
        } = *spec;
        let kind = match format {
            ExportFormat::Csv => create_csv_sink(path, columns, include_headers)?,
            ExportFormat::Json => SinkKind::Json {
                out: create_file(path)?,
                columns: columns.to_vec(),
            },
            ExportFormat::SqlInsert => create_sql_sink(spec)?,
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

    pub fn rows_written(&self) -> u64 {
        self.rows_written
    }

    pub fn bytes_written(&self) -> u64 {
        match &self.kind {
            SinkKind::Csv(wtr) => wtr.get_ref().bytes,
            SinkKind::Json { out, .. } | SinkKind::Sql { out, .. } => out.bytes,
            SinkKind::Xlsx(_) => 0,
        }
    }

    pub fn stopped_at_sheet_limit(&self) -> bool {
        matches!(&self.kind, SinkKind::Xlsx(sink) if sink.stopped)
    }

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
                out.write_all(json_array_tail(rows_written))
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

fn json_array_tail(rows_written: u64) -> &'static [u8] {
    if rows_written == 0 {
        return b"[]";
    }
    b"\n]"
}

fn json_row_prefix(first: bool) -> &'static [u8] {
    if first {
        return b"[\n  ";
    }
    b",\n  "
}

fn write_json_row<W: Write>(
    out: &mut W,
    first: bool,
    object: &serde_json::Value,
) -> io::Result<()> {
    let pretty = serde_json::to_vec_pretty(object).map_err(io::Error::other)?;
    out.write_all(json_row_prefix(first))?;
    let mut lines = pretty.split(|&byte| byte == b'\n');
    if let Some(line) = lines.next() {
        out.write_all(line)?;
    }
    for line in lines {
        out.write_all(b"\n  ")?;
        out.write_all(line)?;
    }
    Ok(())
}
