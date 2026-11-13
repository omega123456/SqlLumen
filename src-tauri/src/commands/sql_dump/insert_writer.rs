use super::*;

pub(super) struct TableInsertWriter<'a> {
    table_name: &'a str,
    escaped_table: String,
    col_list: String,
    job: DumpJob<'a>,
    header_written: bool,
    total_rows: u64,
    pending_rows: Vec<Vec<SqlDumpValue>>,
}

impl<'a> TableInsertWriter<'a> {
    pub(super) fn new(table_name: &'a str, columns: &[String], job: DumpJob<'a>) -> Self {
        let col_list = columns
            .iter()
            .map(|column| format!("`{}`", sql_dump::escape_identifier(column)))
            .collect::<Vec<_>>()
            .join(", ");
        Self {
            table_name,
            escaped_table: sql_dump::escape_identifier(table_name),
            col_list,
            job,
            header_written: false,
            total_rows: 0,
            pending_rows: Vec::with_capacity(INSERT_BATCH_SIZE),
        }
    }

    pub(super) fn push_row(&mut self, values: Vec<SqlDumpValue>) -> bool {
        self.pending_rows.push(values);
        self.pending_rows.len() >= INSERT_BATCH_SIZE
    }

    pub(super) fn flush_pending<W: Write + Seek>(&mut self, file: &mut W) -> Result<(), String> {
        if self.pending_rows.is_empty() {
            return Ok(());
        }
        let batch = std::mem::take(&mut self.pending_rows);
        self.flush_batch(file, &batch)
    }

    pub(super) fn flush_batch<W: Write + Seek>(
        &mut self,
        file: &mut W,
        batch: &[Vec<SqlDumpValue>],
    ) -> Result<(), String> {
        self.total_rows += batch.len() as u64;
        if !self.header_written {
            self.write_header(file)?;
        }

        let insert_target = sql_dump::InsertTarget {
            escaped_table: &self.escaped_table,
            col_list: &self.col_list,
        };
        sql_dump::write_insert_batch(file, &insert_target, batch)
            .map_err(|error| format!("Write error: {error}"))?;

        let pos = file
            .stream_position()
            .map_err(|error| format!("Seek error: {error}"))?;
        let total_rows = self.total_rows;
        self.job.update_progress(|progress| {
            progress.bytes_written = pos;
            progress.rows_exported = total_rows;
        });
        Ok(())
    }

    pub(super) fn write_header<W: Write>(&mut self, file: &mut W) -> Result<(), String> {
        writeln!(file, "--").map_err(|error| format!("Write error: {error}"))?;
        writeln!(
            file,
            "-- Data for `{}`",
            sql_dump::escape_identifier(self.table_name)
        )
        .map_err(|error| format!("Write error: {error}"))?;
        writeln!(file, "--").map_err(|error| format!("Write error: {error}"))?;
        writeln!(file).map_err(|error| format!("Write error: {error}"))?;
        writeln!(file, "LOCK TABLES `{}` WRITE;", self.escaped_table)
            .map_err(|error| format!("Write error: {error}"))?;
        self.header_written = true;
        Ok(())
    }
}

/// Stream rows from a `TryStream`, batch them, and write INSERT statements to the dump file.
///
/// This is the core streaming helper that replaces the old `fetch_all` + `write_data_inserts`
/// approach. It writes LOCK TABLE once before the first batch, calls
/// [`write_insert_batch`](sql_dump::write_insert_batch) per batch, and writes UNLOCK TABLE
/// once after the last batch. Progress is updated after each batch flush.
///
/// Generic over the row type `R` so that tests can use `Vec<SqlDumpValue>` directly
/// without constructing `MySqlRow`.
pub async fn stream_to_dump<R, S, F, W>(
    stream: S,
    target: DumpTarget<'_, W>,
    serialize: F,
) -> Result<(), String>
where
    S: futures::TryStream<Ok = R, Error = sqlx::Error> + Unpin,
    F: Fn(&R) -> Vec<SqlDumpValue>,
    W: Write + Seek,
{
    let DumpTarget {
        file,
        table_name,
        columns,
        job,
    } = target;
    if columns.is_empty() {
        return Ok(());
    }

    let mut insert_writer = TableInsertWriter::new(table_name, columns, job);
    let output = RowOutput {
        file: &mut *file,
        serialize,
    };
    let loop_result = write_stream_rows(stream, &mut insert_writer, output).await;

    // Always write UNLOCK if LOCK was written, regardless of success or error
    if insert_writer.header_written {
        writeln!(file, "UNLOCK TABLES;").map_err(write_error)?;
        writeln!(file).map_err(write_error)?;
    }

    loop_result
}

pub(super) struct RowOutput<'a, W, F> {
    file: &'a mut W,
    serialize: F,
}

pub(super) async fn write_stream_rows<R, S, F, W>(
    mut stream: S,
    insert_writer: &mut TableInsertWriter<'_>,
    output: RowOutput<'_, W, F>,
) -> Result<(), String>
where
    S: futures::TryStream<Ok = R, Error = sqlx::Error> + Unpin,
    F: Fn(&R) -> Vec<SqlDumpValue>,
    W: Write + Seek,
{
    let RowOutput { file, serialize } = output;
    loop {
        let row = stream
            .try_next()
            .await
            .map_err(|error| format!("Stream error for '{}': {error}", insert_writer.table_name))?;
        let Some(row) = row else {
            return insert_writer.flush_pending(file);
        };
        let is_batch_full = insert_writer.push_row(serialize(&row));
        if !is_batch_full {
            continue;
        }
        insert_writer.flush_pending(file)?;
        if insert_writer.job.is_cancel_requested() {
            return Ok(());
        }
    }
}
