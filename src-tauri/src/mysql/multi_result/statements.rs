use super::*;

pub(super) type ColumnTypeAndFlags = (
    mysql_async::consts::ColumnType,
    mysql_async::consts::ColumnFlags,
);

pub(super) struct ResultColumns {
    pub(super) metas: Vec<crate::mysql::query_executor::ColumnMeta>,
    pub(super) types: Vec<ColumnTypeAndFlags>,
}

pub(super) fn result_columns(columns_ref: &[mysql_async::Column]) -> ResultColumns {
    use crate::mysql::query_executor::ColumnMeta;

    ResultColumns {
        metas: columns_ref
            .iter()
            .map(|column| ColumnMeta {
                name: column.name_str().to_string(),
                data_type: column_type_display_name(column.column_type(), column.flags()),
            })
            .collect(),
        types: columns_ref
            .iter()
            .map(|column| (column.column_type(), column.flags()))
            .collect(),
    }
}

pub(super) async fn stop_rows_after_ceiling<P>(
    result: &mut mysql_async::QueryResult<'_, '_, P>,
    context: &DecodeContext<'_>,
) -> bool
where
    P: mysql_async::prelude::Protocol,
{
    // If the KILL can't be sent, the drain still reads (and discards) the rest.
    let kill_sent = kill_for_ceiling(context).await;
    let interrupted = drain_after_ceiling(result, context).await;
    // The stream ended on its own after the KILL was sent: the KILL may still be pending.
    kill_sent && !interrupted
}

pub(super) async fn attach_run_database(
    conn: &mut mysql_async::Conn,
    context: &DecodeContext<'_>,
    stored: &mut crate::mysql::query_executor::StoredResult,
) {
    use crate::mysql::query_executor::FullExportBlockedReason;

    let needs_run_database = stored.truncated && stored.full_export_blocked_reason.is_none();
    if !needs_run_database {
        return;
    }
    match capture_session_database(conn, context.connection_id).await {
        Some(database) => stored.run_database = database,
        None => stored.full_export_blocked_reason = Some(FullExportBlockedReason::UnknownDatabase),
    }
}

pub(super) async fn execute_single_select_statement(
    conn: &mut mysql_async::Conn,
    statement: &SelectStatement<'_>,
    context: &DecodeContext<'_>,
) -> Result<StatementOutcome, String> {
    use crate::mysql::query_executor::{
        sql_with_auto_limit, statement_blocked_reason, StoredResult, StoredResultParts,
    };
    use mysql_async::prelude::Queryable;

    let SelectStatement {
        sql,
        auto_limit_applied,
        row_limit_used,
    } = *statement;

    let sql_to_execute = sql_with_auto_limit(sql, auto_limit_applied, row_limit_used);

    let start = std::time::Instant::now();
    crate::mysql::query_log::log_outgoing_sql(&sql_to_execute);
    let mut result = conn
        .query_iter(&sql_to_execute)
        .await
        .map_err(|error| map_mysql_error(&error))?;

    // Result header is available — record execution time before row transfer.
    let execution_time_ms = start.elapsed().as_millis() as u64;
    let columns = result_columns(result.columns_ref());
    let limits = RowBufferLimits {
        capacity_hint: row_capacity_hint(auto_limit_applied, row_limit_used),
        ceiling: context.ceiling,
    };
    let decoded = stream_serialized_rows(&mut result, &columns.types, limits).await?;
    let late_kill_possible =
        decoded.overflowed && stop_rows_after_ceiling(&mut result, context).await;

    // Drop remaining result sets (if any unexpected ones)
    drop(result);
    if late_kill_possible {
        absorb_late_kill(conn, context.connection_id).await;
    }

    // All rows streamed and serialized — record total time.
    let total_time_ms = start.elapsed().as_millis() as u64;
    let mut stored = StoredResult::new(StoredResultParts {
        query_id: uuid::Uuid::new_v4().to_string(),
        columns: columns.metas,
        rows: Arc::new(decoded.rows),
        execution_time_ms,
        total_time_ms,
        affected_rows: 0,
        auto_limit_applied,
    });
    stored.truncated = decoded.overflowed;
    stored.row_ceiling = context.ceiling;
    stored.applied_row_limit = auto_limit_applied.then_some(row_limit_used);
    stored.source_sql = sql.to_string();
    stored.full_export_blocked_reason = statement_blocked_reason(sql, false);
    attach_run_database(conn, context, &mut stored).await;

    Ok(StatementOutcome::from_stored(stored, true))
}

pub(super) async fn execute_single_dml_statement(
    conn: &mut mysql_async::Conn,
    sql: &str,
    context: &DecodeContext<'_>,
) -> Result<StatementOutcome, String> {
    use crate::mysql::query_executor::{StoredResult, StoredResultParts};
    use mysql_async::prelude::Queryable;

    let start = std::time::Instant::now();
    crate::mysql::query_log::log_outgoing_sql(sql);
    let mut result = conn
        .query_iter(sql)
        .await
        .map_err(|error| map_mysql_error(&error))?;

    // Statement executed (header available) — record execution time.
    let execution_time_ms = start.elapsed().as_millis() as u64;

    let affected = result.affected_rows();
    crate::mysql::query_log::log_mysql_async_result(affected, result.last_insert_id());
    // Drain remaining result
    drain_result_set(&mut result).await;

    // No row-transfer phase for DML; total time is measured after draining.
    let total_time_ms = start.elapsed().as_millis() as u64;
    let query_id = uuid::Uuid::new_v4().to_string();

    let mut stored = StoredResult::new(StoredResultParts {
        query_id,
        columns: vec![],
        rows: Arc::new(vec![]),
        execution_time_ms,
        total_time_ms,
        affected_rows: affected,
        auto_limit_applied: false,
    });
    stored.row_ceiling = context.ceiling;
    stored.source_sql = sql.to_string();
    Ok(StatementOutcome::from_stored(stored, true))
}

pub(super) struct CallRun<'a> {
    pub(super) sql: &'a str,
    pub(super) context: &'a DecodeContext<'a>,
    pub(super) start: std::time::Instant,
    pub(super) execution_time_ms: u64,
}

pub(super) enum CallResultSet {
    Rows(Box<StatementOutcome>),
    Affected(u64),
}

impl CallRun<'_> {
    pub(super) fn stored_outcome(&self, rows: CallRows) -> StatementOutcome {
        use crate::mysql::query_executor::{
            FullExportBlockedReason, StoredResult, StoredResultParts,
        };

        // Execution time is the shared header time; each set's total time is taken here.
        let mut stored = StoredResult::new(StoredResultParts {
            query_id: uuid::Uuid::new_v4().to_string(),
            columns: rows.columns,
            rows: Arc::new(rows.rows),
            execution_time_ms: self.execution_time_ms,
            total_time_ms: self.start.elapsed().as_millis() as u64,
            affected_rows: rows.affected_rows,
            auto_limit_applied: false,
        });
        stored.row_ceiling = self.context.ceiling;
        stored.source_sql = self.sql.to_string();
        stored.full_export_blocked_reason = Some(FullExportBlockedReason::Call);
        stored.truncated = rows.truncated;
        StatementOutcome::from_stored(stored, false)
    }
}

pub(super) struct CallRows {
    pub(super) columns: Vec<crate::mysql::query_executor::ColumnMeta>,
    pub(super) rows: Vec<crate::mysql::query_executor::SharedRow>,
    pub(super) affected_rows: u64,
    pub(super) truncated: bool,
}

pub(super) async fn drain_overflowed_call_set<P>(
    result: &mut mysql_async::QueryResult<'_, '_, P>,
    context: &DecodeContext<'_>,
) -> Result<(), String>
where
    P: mysql_async::prelude::Protocol,
{
    tracing::debug!(
        connection_id = context.connection_id,
        ceiling = context.ceiling,
        "row ceiling reached in a CALL result set: draining the rest of the set"
    );
    while result
        .next()
        .await
        .map_err(|error| map_mysql_error(&error))?
        .is_some()
    {}
    Ok(())
}

pub(super) async fn collect_call_result_set<P>(
    result: &mut mysql_async::QueryResult<'_, '_, P>,
    call: &CallRun<'_>,
) -> Result<CallResultSet, String>
where
    P: mysql_async::prelude::Protocol,
{
    let columns_ref = result.columns_ref();
    if columns_ref.is_empty() {
        // No columns — DML-like result or trailing OK packet.
        let affected = result.affected_rows();
        drain_result_set(result).await;
        return Ok(CallResultSet::Affected(affected));
    }
    let columns = result_columns(columns_ref);
    let limits = RowBufferLimits {
        capacity_hint: 0,
        ceiling: call.context.ceiling,
    };
    let decoded = stream_serialized_rows(result, &columns.types, limits).await?;
    if decoded.overflowed {
        drain_overflowed_call_set(result, call.context).await?;
    }
    let rows = CallRows {
        columns: columns.metas,
        rows: decoded.rows,
        affected_rows: 0,
        truncated: decoded.overflowed,
    };
    Ok(CallResultSet::Rows(Box::new(call.stored_outcome(rows))))
}

/// Execute a CALL statement and collect all returned result sets.
///
/// Returns one outcome per row-bearing result set, or a single synthetic
/// DML-style entry if the procedure produced no row results. A result set over
/// the ceiling is drained (never killed, so the procedure's writes are not
/// aborted) and marked truncated; later result sets are still read.
/// Row collection errors propagate via `?`.
pub(super) async fn execute_call_statement(
    conn: &mut mysql_async::Conn,
    sql: &str,
    context: &DecodeContext<'_>,
) -> Result<Vec<StatementOutcome>, String> {
    use mysql_async::prelude::Queryable;

    let start = std::time::Instant::now();
    crate::mysql::query_log::log_outgoing_sql(sql);
    let mut result = conn
        .query_iter(sql)
        .await
        .map_err(|error| map_mysql_error(&error))?;

    // The first result-set header is available — all result sets share this execution time.
    let call = CallRun {
        sql,
        context,
        start,
        execution_time_ms: start.elapsed().as_millis() as u64,
    };
    let mut outcomes: Vec<StatementOutcome> = Vec::new();
    let mut call_last_affected: u64 = 0;
    loop {
        match collect_call_result_set(&mut result, &call).await? {
            CallResultSet::Rows(outcome) => outcomes.push(*outcome),
            CallResultSet::Affected(affected) => call_last_affected = affected,
        }
        if result.is_empty() {
            break;
        }
    }

    // If no row-bearing result was seen, emit a single synthetic DML-style success entry.
    if outcomes.is_empty() {
        let rows = CallRows {
            columns: vec![],
            rows: vec![],
            affected_rows: call_last_affected,
            truncated: false,
        };
        outcomes.push(call.stored_outcome(rows));
    }

    Ok(outcomes)
}
