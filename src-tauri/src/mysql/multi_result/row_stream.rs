use super::*;

pub(super) const ROW_CAPACITY_HINT_MAX: usize = 10_000;

pub(super) fn row_capacity_hint(auto_limit_applied: bool, row_limit_used: usize) -> usize {
    if !auto_limit_applied {
        return 0;
    }
    row_limit_used.min(ROW_CAPACITY_HINT_MAX)
}

pub(super) async fn stream_serialized_rows<P>(
    result: &mut mysql_async::QueryResult<'_, '_, P>,
    columns: &[crate::mysql::query_executor::ColumnMeta],
    limits: RowBufferLimits<'_>,
) -> Result<DecodedRows, String>
where
    P: mysql_async::prelude::Protocol,
{
    let mut decoded = DecodedRows::with_capacity(limits.capacity_hint.min(limits.ceiling));
    decoded.open_run_file(columns, limits.run);
    while decoded.keeps_reading() {
        let next_row = result
            .next()
            .await
            .map_err(|error| map_mysql_error(&error))?;
        let Some(row) = next_row else {
            break;
        };
        if limits.stops_at(decoded.rows.len()) {
            decoded.overflowed = true;
            decoded.ended_early = true;
            break;
        }
        decoded.accept(row, limits);
    }
    decoded.close_run_file(limits.run);
    crate::mysql::query_log::log_mysql_async_row_count(decoded.rows_read);
    Ok(decoded)
}

impl DecodedRows {
    fn with_capacity(capacity: usize) -> Self {
        Self {
            rows: Vec::with_capacity(capacity),
            overflowed: false,
            ended_early: false,
            rows_read: 0,
            write_error: None,
        }
    }

    fn keeps_reading(&self) -> bool {
        self.write_error.is_none()
    }

    fn open_run_file(
        &mut self,
        columns: &[crate::mysql::query_executor::ColumnMeta],
        run: Option<RunTarget<'_>>,
    ) {
        let Some(target) = run else {
            return;
        };
        let opened = target.session.open_result(target.set_number, columns);
        self.record_write_result(opened);
    }

    fn accept(&mut self, row: mysql_async::Row, limits: RowBufferLimits<'_>) {
        self.rows_read += 1;
        let cached_row_count = self.rows.len();
        let is_cached = cached_row_count < limits.ceiling;
        if is_cached {
            crate::mysql::query_log::log_mysql_async_row(cached_row_count, &row);
        }
        let serialized = serialize_row(row);
        self.write_to_run_file(&serialized, limits.run);
        if is_cached {
            self.rows.push(serialized);
            return;
        }
        self.overflowed = true;
    }

    fn write_to_run_file(
        &mut self,
        row: &crate::mysql::query_executor::SharedRow,
        run: Option<RunTarget<'_>>,
    ) {
        let Some(target) = run else {
            return;
        };
        let written = target.session.write_row(row);
        self.record_write_result(written);
    }

    fn record_write_result(&mut self, written: Result<(), String>) {
        let Err(message) = written else {
            return;
        };
        self.write_error = Some(message);
        self.ended_early = true;
    }

    fn close_run_file(&self, run: Option<RunTarget<'_>>) {
        let Some(target) = run else {
            return;
        };
        target.session.close_result(self.keeps_reading());
    }

    pub(super) fn exported_row_count(&self, run: Option<RunTarget<'_>>) -> Option<usize> {
        run.map(|_| self.rows_read)
    }
}

pub(super) async fn drain_result_set<P>(result: &mut mysql_async::QueryResult<'_, '_, P>)
where
    P: mysql_async::prelude::Protocol,
{
    if let Err(error) = result.for_each(|_| {}).await {
        tracing::debug!(error = %error, "ignoring error while draining result set");
    }
}

pub(crate) fn serialize_row(row: mysql_async::Row) -> crate::mysql::query_executor::SharedRow {
    crate::mysql::cell_values::row_json(row).into()
}
