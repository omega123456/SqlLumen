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
    col_types: &[(
        mysql_async::consts::ColumnType,
        mysql_async::consts::ColumnFlags,
    )],
    limits: RowBufferLimits,
) -> Result<DecodedRows, String>
where
    P: mysql_async::prelude::Protocol,
{
    let RowBufferLimits {
        capacity_hint,
        ceiling,
    } = limits;
    let mut serialized_rows = Vec::with_capacity(capacity_hint.min(ceiling));
    let mut overflowed = false;
    while let Some(row) = result
        .next()
        .await
        .map_err(|error| map_mysql_error(&error))?
    {
        let stored_row_count = serialized_rows.len();
        if stored_row_count >= ceiling {
            overflowed = true;
            break;
        }
        crate::mysql::query_log::log_mysql_async_row(stored_row_count, &row);
        serialized_rows.push(serialize_row(&row, col_types));
    }
    crate::mysql::query_log::log_mysql_async_row_count(serialized_rows.len());
    Ok(DecodedRows {
        rows: serialized_rows,
        overflowed,
    })
}

pub(super) async fn drain_result_set<P>(result: &mut mysql_async::QueryResult<'_, '_, P>)
where
    P: mysql_async::prelude::Protocol,
{
    if let Err(error) = result.for_each(|_| {}).await {
        tracing::debug!(error = %error, "ignoring error while draining result set");
    }
}

pub(crate) fn serialize_row(
    row: &mysql_async::Row,
    col_types: &[(
        mysql_async::consts::ColumnType,
        mysql_async::consts::ColumnFlags,
    )],
) -> crate::mysql::query_executor::SharedRow {
    col_types
        .iter()
        .enumerate()
        .map(
            |(column_index, &(col_type, flags))| match row.as_ref(column_index) {
                Some(value) => serialize_mysql_value(value, col_type, flags),
                None => serde_json::Value::Null,
            },
        )
        .collect()
}
