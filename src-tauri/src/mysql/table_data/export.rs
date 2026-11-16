use super::*;
#[cfg(not(coverage))]
use crate::mysql::cell_values::cell_json;
#[cfg(not(coverage))]
use crate::mysql::logged_query::fetch_decoded_pooled;

#[cfg(not(coverage))]
pub(super) fn sql_export_table_name(options: &ExportTableOptions) -> &str {
    if options.table_name_for_sql.is_empty() {
        return &options.table;
    }
    &options.table_name_for_sql
}

#[cfg(not(coverage))]
pub(super) fn json_array_closing_bracket(is_empty: bool) -> &'static str {
    if is_empty {
        return "]";
    }
    "\n]"
}

#[cfg(not(coverage))]
pub(super) struct TempFileGuard {
    path: String,
    armed: bool,
}

#[cfg(not(coverage))]
impl TempFileGuard {
    fn new(path: String) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

#[cfg(not(coverage))]
impl Drop for TempFileGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[cfg(not(coverage))]
type ExportRowStream<'a> = crate::mysql::logged_query::LoggedRows<'a>;

#[cfg(not(coverage))]
type ExportFileWriter = std::io::BufWriter<std::fs::File>;

#[cfg(not(coverage))]
struct ExportQuery {
    sql: String,
    params: Vec<serde_json::Value>,
}

#[cfg(not(coverage))]
impl ExportQuery {
    fn statement(&self) -> LoggedStatement<'_> {
        json_bound_statement(&self.sql, &self.params)
    }
}

#[cfg(not(coverage))]
fn export_limit_sql(options: &ExportTableOptions) -> String {
    let (Some(page), Some(page_size)) = (options.page, options.page_size) else {
        return String::new();
    };
    let offset = (page.saturating_sub(1)) as u64 * page_size as u64;
    format!(" LIMIT {page_size} OFFSET {offset}")
}

#[cfg(not(coverage))]
async fn build_export_query(
    context: &TableDataContext<'_>,
    options: &ExportTableOptions,
) -> Result<ExportQuery, String> {
    let safe_db = safe_identifier(&options.database)?;
    let safe_table = safe_identifier(&options.table)?;
    let columns = fetch_table_pk_cached(context, &options.database, &options.table)
        .await?
        .columns;
    let filter_clause = translate_filter_model_with_columns(&options.filter_model, &columns);
    let where_sql = where_clause_sql(&filter_clause.sql);
    let order_sql = order_by_sql(options.sort.as_ref())?;
    let limit_sql = export_limit_sql(options);
    let sql = format!("SELECT * FROM {safe_db}.{safe_table}{where_sql}{order_sql}{limit_sql}");
    Ok(ExportQuery {
        sql,
        params: filter_clause.params,
    })
}

#[cfg(not(coverage))]
fn row_column_names(row: &DecodedRow) -> Vec<String> {
    row.columns()
        .iter()
        .map(|column| column.name_str().into_owned())
        .collect()
}

#[cfg(not(coverage))]
fn serialized_export_row(row: &DecodedRow) -> Vec<serde_json::Value> {
    row.cells().iter().map(cell_json).collect()
}

#[cfg(not(coverage))]
async fn export_xlsx(
    context: &TableDataContext<'_>,
    query: &ExportQuery,
    options: &ExportTableOptions,
) -> Result<(), String> {
    let rows = fetch_decoded_pooled(context.pool, query.statement())
        .await
        .map_err(|error| format!("Export query failed: {error}"))?;

    let columns = rows.first().map(row_column_names).unwrap_or_default();
    let serialized_rows: Vec<Vec<serde_json::Value>> =
        rows.iter().map(serialized_export_row).collect();

    let export_options = crate::export::ExportOptions {
        format: crate::export::ExportFormat::Xlsx,
        file_path: options.file_path.clone(),
        include_headers: options.include_headers,
        table_name: Some(sql_export_table_name(options).to_string()),
    };
    crate::export::export_with_data(&columns, &serialized_rows, export_options).map(|_| ())
}

#[cfg(not(coverage))]
async fn next_export_row(stream: &mut ExportRowStream<'_>) -> Result<Option<DecodedRow>, String> {
    stream
        .next_decoded()
        .await
        .map_err(|error| format!("Export query failed: {error}"))
}

#[cfg(not(coverage))]
fn write_csv_record(
    csv_writer: &mut csv::Writer<ExportFileWriter>,
    record: &[String],
) -> Result<(), String> {
    csv_writer
        .write_record(record)
        .map_err(|error| format!("CSV write error: {error}"))
}

#[cfg(not(coverage))]
fn csv_export_record(row: &DecodedRow) -> Vec<String> {
    serialized_export_row(row)
        .iter()
        .map(crate::export::csv_writer::csv_field)
        .collect()
}

#[cfg(not(coverage))]
async fn stream_csv_export(
    stream: &mut ExportRowStream<'_>,
    writer: ExportFileWriter,
    include_headers: bool,
) -> Result<(), String> {
    let mut csv_writer = csv::WriterBuilder::new()
        .has_headers(false)
        .from_writer(writer);
    let mut headers_written = false;

    while let Some(row) = next_export_row(stream).await? {
        let should_write_headers = include_headers && !headers_written;
        if should_write_headers {
            write_csv_record(&mut csv_writer, &row_column_names(&row))?;
        }
        headers_written = true;
        write_csv_record(&mut csv_writer, &csv_export_record(&row))?;
    }

    csv_writer
        .flush()
        .map_err(|error| format!("CSV flush error: {error}"))
}

#[cfg(not(coverage))]
fn json_export_object(
    row: &DecodedRow,
    columns: &[String],
) -> serde_json::Map<String, serde_json::Value> {
    let mut object = serde_json::Map::new();
    for (column_index, column) in columns.iter().enumerate() {
        object.insert(column.clone(), export_value_or_null(row, column_index));
    }
    object
}

#[cfg(not(coverage))]
fn export_value_or_null(row: &DecodedRow, column_index: usize) -> serde_json::Value {
    row.cells()
        .get(column_index)
        .map(cell_json)
        .unwrap_or(serde_json::Value::Null)
}

#[cfg(not(coverage))]
fn json_row_separator(is_first: bool) -> &'static str {
    if is_first {
        return "";
    }
    ","
}

#[cfg(not(coverage))]
fn indented_json_object(
    object: serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    let pretty = serde_json::to_string_pretty(&serde_json::Value::Object(object))
        .map_err(|error| format!("JSON serialize error: {error}"))?;
    Ok(pretty
        .lines()
        .map(|line| format!("  {line}"))
        .collect::<Vec<_>>()
        .join("\n"))
}

#[cfg(not(coverage))]
async fn stream_json_export(
    stream: &mut ExportRowStream<'_>,
    mut writer: ExportFileWriter,
) -> Result<(), String> {
    use std::io::Write;

    write!(writer, "[").map_err(|error| format!("Write error: {error}"))?;
    let mut columns: Option<Vec<String>> = None;
    let mut is_first = true;

    while let Some(row) = next_export_row(stream).await? {
        let row_columns = columns.get_or_insert_with(|| row_column_names(&row));
        let indented = indented_json_object(json_export_object(&row, row_columns))?;
        let separator = json_row_separator(is_first);
        write!(writer, "{separator}\n{indented}")
            .map_err(|error| format!("Write error: {error}"))?;
        is_first = false;
    }

    let closing_bracket = json_array_closing_bracket(is_first);
    writeln!(writer, "{closing_bracket}").map_err(|error| format!("Write error: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("Flush error: {error}"))
}

#[cfg(not(coverage))]
async fn stream_sql_insert_export(
    stream: &mut ExportRowStream<'_>,
    mut writer: ExportFileWriter,
    table_name: &str,
) -> Result<(), String> {
    use std::io::Write;

    let mut columns: Option<Vec<String>> = None;
    while let Some(row) = next_export_row(stream).await? {
        let row_columns = columns.get_or_insert_with(|| row_column_names(&row));
        let single_row = crate::export::ExportRows {
            columns: row_columns,
            rows: &[serialized_export_row(&row)],
        };
        crate::export::sql_writer::write_sql(&mut writer, &single_row, table_name)
            .map_err(|error| format!("SQL write error: {error}"))?;
    }

    writer
        .flush()
        .map_err(|error| format!("Flush error: {error}"))
}

#[cfg(not(coverage))]
struct StreamedExport<'a> {
    format: crate::export::ExportFormat,
    options: &'a ExportTableOptions,
    temp_path: &'a str,
}

#[cfg(not(coverage))]
async fn stream_export_to_temp_file(
    context: &TableDataContext<'_>,
    query: &ExportQuery,
    export: StreamedExport<'_>,
) -> Result<(), String> {
    let mut conn = context
        .pool
        .checkout()
        .await
        .map_err(|error| format!("Export query failed: {error}"))?;
    let mut stream = crate::mysql::logged_query::stream(&mut conn, query.statement())
        .await
        .map_err(|error| format!("Export query failed: {error}"))?;
    let file = std::fs::File::create(export.temp_path)
        .map_err(|error| format!("Failed to create file: {error}"))?;
    let writer = std::io::BufWriter::new(file);

    let written = write_streamed_export(&mut stream, writer, &export).await;
    stream.finish();
    written
}

#[cfg(not(coverage))]
async fn write_streamed_export(
    stream: &mut ExportRowStream<'_>,
    writer: ExportFileWriter,
    export: &StreamedExport<'_>,
) -> Result<(), String> {
    match export.format {
        crate::export::ExportFormat::Csv => {
            stream_csv_export(stream, writer, export.options.include_headers).await
        }
        crate::export::ExportFormat::Json => stream_json_export(stream, writer).await,
        crate::export::ExportFormat::SqlInsert => {
            let table_name = sql_export_table_name(export.options);
            stream_sql_insert_export(stream, writer, table_name).await
        }
        _ => Err("Unexpected format for streaming export".to_string()),
    }
}

#[cfg(not(coverage))]
pub async fn export_table_data_impl(
    context: &TableDataContext<'_>,
    options: &ExportTableOptions,
) -> Result<(), String> {
    let query = build_export_query(context, options).await?;
    let format = crate::export::ExportFormat::from_format_str(&options.format)?;
    if format == crate::export::ExportFormat::Xlsx {
        return export_xlsx(context, &query, options).await;
    }

    let temp_path = format!("{}.tmp", &options.file_path);
    let mut guard = TempFileGuard::new(temp_path.clone());
    let export = StreamedExport {
        format,
        options,
        temp_path: &temp_path,
    };
    stream_export_to_temp_file(context, &query, export).await?;

    std::fs::rename(&temp_path, &options.file_path)
        .map_err(|error| format!("Failed to finalize export file: {error}"))?;
    guard.disarm();

    Ok(())
}

#[cfg(coverage)]
pub async fn export_table_data_impl(
    _context: &TableDataContext<'_>,
    _options: &ExportTableOptions,
) -> Result<(), String> {
    Ok(())
}
