pub const TARGET: &str = "mysql_traffic";

pub fn is_enabled() -> bool {
    tracing::enabled!(target: TARGET, tracing::Level::DEBUG)
}

pub fn log_outgoing_sql(sql: &str) {
    tracing::debug!(target: TARGET, %sql, "mysql outgoing query");
}

pub fn log_outgoing_sql_bound(sql: &str, binds: &[String]) {
    tracing::debug!(target: TARGET, %sql, ?binds, "mysql outgoing query (bound)");
}

pub fn log_outgoing_sql_with_values(sql: &str, values: &[mysql_async::Value]) {
    if !is_enabled() {
        return;
    }
    let binds: Vec<String> = values.iter().map(|value| value.as_sql(false)).collect();
    log_outgoing_sql_bound(sql, &binds);
}

pub fn log_mysql_async_row(row_index: usize, row: &mysql_async::Row) {
    if !is_enabled() {
        return;
    }
    let cells = crate::mysql::cell_values::decode_row(row);
    let formatted = row
        .columns_ref()
        .iter()
        .zip(cells.iter())
        .map(|(column, cell)| {
            let value_text = crate::mysql::cell_values::debug_text(cell);
            format!("{}={value_text}", column.name_str())
        })
        .collect::<Vec<_>>()
        .join(", ");
    tracing::debug!(target: TARGET, row_index, row = %formatted, "mysql row");
}

pub fn log_mysql_async_rows(rows: &[mysql_async::Row]) {
    log_mysql_async_row_count(rows.len());
    for (row_index, row) in rows.iter().enumerate() {
        log_mysql_async_row(row_index, row);
    }
}

pub fn log_mysql_async_row_count(row_count: usize) {
    if !is_enabled() {
        return;
    }
    tracing::debug!(target: TARGET, row_count, "mysql result rows (pre-serialize)");
}

pub fn log_mysql_async_result(rows_affected: u64, last_insert_id: Option<u64>) {
    tracing::debug!(
        target: TARGET,
        rows_affected,
        last_insert_id,
        "mysql execute result",
    );
}

pub fn log_mysql_async_error(error: &mysql_async::Error) {
    tracing::debug!(
        target: TARGET,
        error = %error,
        "mysql execute error",
    );
}
