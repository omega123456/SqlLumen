use super::*;

/// Execute multiple SQL statements sequentially on the connection's shared editor session.
///
/// Returns a tuple of `(Vec<StoredResult>, Vec<MultiQueryResultItem>)`.
/// Stops on first error (which is included as the last result item).
///
/// Thread ID is registered with `state.running_queries` before execution starts
/// and removed on completion. `row_limit` is the (already clamped) auto-LIMIT;
/// decoding is capped by the cache's row ceiling.
pub async fn execute_multi_query_internal(
    state: &crate::state::AppState,
    run: &crate::mysql::session::TabRun,
    batch: StatementBatch<'_>,
) -> Result<BatchResults, String> {
    use crate::mysql::query_executor::{is_read_only_allowed, READ_ONLY_VIOLATION_MESSAGE};

    let connection_id = run.connection_id.as_str();
    let mut guard = crate::mysql::session::acquire_for_run(state, run).await?;
    let session = guard.as_mut().expect("acquire always yields a session");
    let key = run.running_query_key();

    let context = DecodeContext {
        ceiling: state.result_cache.row_ceiling(),
        connection_id,
        thread_id: session.thread_id,
        pool: state.registry.get_pool(connection_id),
    };
    let row_limit_used = crate::mysql::query_executor::requested_row_limit(batch.row_limit);
    let mut results = BatchResults::default();

    for sql in batch.statements {
        let sql = sql.trim();
        if sql.is_empty() {
            continue;
        }

        let is_statement_blocked = batch.is_read_only && !is_read_only_allowed(sql);
        if is_statement_blocked {
            results.push_error(sql, READ_ONLY_VIOLATION_MESSAGE.to_string());
            break;
        }

        let statement = SessionStatement {
            sql,
            row_limit: row_limit_used,
        };
        let stmt_result = execute_batch_statement(&mut session.conn, statement, &context).await;

        match stmt_result {
            Ok(outcomes) => outcomes
                .into_iter()
                .for_each(|outcome| results.push(outcome)),
            Err(error_msg) => {
                results.push_error(sql, error_msg);
                break;
            }
        }
    }

    state.running_queries.write().await.remove(&key);

    Ok(results)
}

/// Execute one non-CALL statement on the connection's shared editor session,
/// registering the session thread ID for cancellation while it runs.
/// `row_limit` is the (already clamped) auto-LIMIT.
pub async fn execute_single_on_session(
    state: &crate::state::AppState,
    run: &crate::mysql::session::TabRun,
    statement: SessionStatement<'_>,
) -> Result<StatementOutcome, String> {
    let connection_id = run.connection_id.as_str();
    let mut guard = crate::mysql::session::acquire_for_run(state, run).await?;
    let session = guard.as_mut().expect("acquire always yields a session");
    let key = run.running_query_key();

    let context = DecodeContext {
        ceiling: state.result_cache.row_ceiling(),
        connection_id,
        thread_id: session.thread_id,
        pool: state.registry.get_pool(connection_id),
    };
    let result = execute_statement(&mut session.conn, statement, &context).await;

    state.running_queries.write().await.remove(&key);

    result
}

/// Execute a SELECT-like or DML/DDL statement (anything but CALL).
pub(super) async fn execute_batch_statement(
    conn: &mut mysql_async::Conn,
    statement: SessionStatement<'_>,
    context: &DecodeContext<'_>,
) -> Result<Vec<StatementOutcome>, String> {
    if is_call_statement(statement.sql) {
        return execute_call_statement(conn, statement.sql, context).await;
    }
    execute_statement(conn, statement, context)
        .await
        .map(|outcome| vec![outcome])
}

pub(super) async fn execute_statement(
    conn: &mut mysql_async::Conn,
    statement: SessionStatement<'_>,
    context: &DecodeContext<'_>,
) -> Result<StatementOutcome, String> {
    use crate::mysql::query_executor::{
        needs_auto_limit, returns_result_set, strip_non_executable_comments,
    };

    let sql = statement.sql;
    let is_result_set = returns_result_set(&strip_non_executable_comments(sql));
    if !is_result_set {
        return execute_single_dml_statement(conn, sql, context).await;
    }
    let select = SelectStatement {
        sql,
        auto_limit_applied: needs_auto_limit(sql),
        row_limit_used: statement.row_limit,
    };
    execute_single_select_statement(conn, &select, context).await
}
