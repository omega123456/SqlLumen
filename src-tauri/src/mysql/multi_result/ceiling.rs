pub struct DecodeContext<'a> {
    pub ceiling: usize,
    pub connection_id: &'a str,
    pub thread_id: u64,
    pub pool: Option<sqlx::MySqlPool>,
}

pub(super) const CEILING_KILL_ACQUIRE_TIMEOUT: std::time::Duration =
    std::time::Duration::from_secs(1);

pub(super) struct SelectStatement<'a> {
    pub(super) sql: &'a str,
    pub(super) auto_limit_applied: bool,
    pub(super) row_limit_used: usize,
}

#[derive(Clone, Copy)]
pub(super) struct RowBufferLimits {
    pub(super) capacity_hint: usize,
    pub(super) ceiling: usize,
}

pub(super) struct DecodedRows {
    pub(super) rows: Vec<crate::mysql::query_executor::SharedRow>,
    pub(super) overflowed: bool,
}

pub(super) const ER_QUERY_INTERRUPTED: u16 = 1317;

pub(crate) fn is_query_interrupted(error: &mysql_async::Error) -> bool {
    matches!(error, mysql_async::Error::Server(server_err) if server_err.code == ER_QUERY_INTERRUPTED)
}

pub(super) async fn kill_for_ceiling(context: &DecodeContext<'_>) -> bool {
    let Some(pool) = context.pool.as_ref() else {
        tracing::warn!(
            connection_id = context.connection_id,
            thread_id = context.thread_id,
            "row ceiling reached but no pool is available for KILL QUERY; draining instead"
        );
        return false;
    };
    let mut conn = match tokio::time::timeout(CEILING_KILL_ACQUIRE_TIMEOUT, pool.acquire()).await {
        Ok(Ok(conn)) => conn,
        Ok(Err(error)) => {
            tracing::warn!(
                connection_id = context.connection_id,
                thread_id = context.thread_id,
                %error,
                "row ceiling reached but a pool connection for KILL QUERY failed; draining instead"
            );
            return false;
        }
        Err(_) => {
            tracing::warn!(
                connection_id = context.connection_id,
                thread_id = context.thread_id,
                "row ceiling reached but no pool connection for KILL QUERY within 1 s; draining instead"
            );
            return false;
        }
    };
    let kill_sql = format!("KILL QUERY {}", context.thread_id);
    tracing::debug!(
        connection_id = context.connection_id,
        thread_id = context.thread_id,
        ceiling = context.ceiling,
        "row ceiling reached: issuing KILL QUERY"
    );
    crate::mysql::query_log::log_outgoing_sql(&kill_sql);
    match sqlx::query(sqlx::AssertSqlSafe(kill_sql.as_str()))
        .execute(&mut *conn)
        .await
    {
        Ok(result) => {
            crate::mysql::query_log::log_execute_result(&result);
            true
        }
        Err(error) => {
            crate::mysql::query_log::log_execute_error(&error);
            tracing::warn!(
                connection_id = context.connection_id,
                thread_id = context.thread_id,
                %error,
                "row ceiling KILL QUERY failed; draining the rest of the result instead"
            );
            false
        }
    }
}

pub(super) async fn drain_after_ceiling<P>(
    result: &mut mysql_async::QueryResult<'_, '_, P>,
    context: &DecodeContext<'_>,
) -> bool
where
    P: mysql_async::prelude::Protocol,
{
    loop {
        match result.next().await {
            Ok(Some(_)) => continue,
            Ok(None) => return false,
            Err(error) if is_query_interrupted(&error) => {
                tracing::debug!(
                    connection_id = context.connection_id,
                    "row ceiling: stream ended by KILL QUERY (1317)"
                );
                return true;
            }
            Err(error) => {
                crate::mysql::query_log::log_mysql_async_error(&error);
                tracing::warn!(
                    connection_id = context.connection_id,
                    ?error,
                    "row ceiling: error while draining a truncated result; keeping stored rows"
                );
                return false;
            }
        }
    }
}

pub(crate) async fn absorb_late_kill(conn: &mut mysql_async::Conn, connection_id: &str) {
    use mysql_async::prelude::Queryable;

    let sql = "DO 0";
    crate::mysql::query_log::log_outgoing_sql(sql);
    match conn.query_drop(sql).await {
        Ok(()) => {}
        Err(error) if is_query_interrupted(&error) => {
            tracing::debug!(
                connection_id,
                "a late KILL QUERY was absorbed before the next statement"
            );
        }
        Err(error) => {
            crate::mysql::query_log::log_mysql_async_error(&error);
            tracing::warn!(
                connection_id,
                ?error,
                "could not absorb a possibly late KILL QUERY"
            );
        }
    }
}

pub(super) async fn capture_session_database(
    conn: &mut mysql_async::Conn,
    connection_id: &str,
) -> Option<crate::mysql::query_executor::RunDatabase> {
    use crate::mysql::query_executor::RunDatabase;
    use mysql_async::prelude::Queryable;

    let sql = "SELECT DATABASE()";
    crate::mysql::query_log::log_outgoing_sql(sql);
    match conn.query_first::<Option<String>, _>(sql).await {
        Ok(Some(Some(database))) => Some(RunDatabase::Named(database)),
        Ok(_) => Some(RunDatabase::NoDatabase),
        Err(error) => {
            crate::mysql::query_log::log_mysql_async_error(&error);
            tracing::warn!(
                connection_id,
                ?error,
                "could not record the database of a truncated result; full export disabled for it"
            );
            None
        }
    }
}
