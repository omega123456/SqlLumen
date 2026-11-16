pub struct DecodeContext<'a> {
    pub ceiling: usize,
    pub connection_id: &'a str,
    pub thread_id: u64,
    pub pool: Option<crate::mysql::pool::BackgroundPool>,
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
    tracing::debug!(
        connection_id = context.connection_id,
        thread_id = context.thread_id,
        ceiling = context.ceiling,
        "row ceiling reached: issuing KILL QUERY"
    );
    let kill = crate::mysql::pool::KillQuery {
        thread_id: context.thread_id,
        checkout_timeout: CEILING_KILL_ACQUIRE_TIMEOUT,
    };
    let Err(failure) = pool.kill_query(kill).await else {
        return true;
    };
    tracing::warn!(
        connection_id = context.connection_id,
        thread_id = context.thread_id,
        %failure,
        "row ceiling KILL QUERY failed; draining the rest of the result instead"
    );
    false
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

const LATE_KILL_ABSORBING_SQL: &str = "DO 0";

pub(crate) async fn absorb_late_kill(conn: &mut mysql_async::Conn, connection_id: &str) {
    use crate::mysql::logged_query::{execute, LoggedStatement};

    let absorbing_statement = LoggedStatement::text(LATE_KILL_ABSORBING_SQL);
    match execute(conn, absorbing_statement).await {
        Ok(_) => {}
        Err(error) if is_query_interrupted(&error) => {
            tracing::debug!(
                connection_id,
                "a late KILL QUERY was absorbed before the next statement"
            );
        }
        Err(error) => {
            tracing::warn!(
                connection_id,
                ?error,
                "could not absorb a possibly late KILL QUERY"
            );
        }
    }
}

pub(crate) async fn read_session_database(
    conn: &mut mysql_async::Conn,
) -> Result<crate::mysql::query_executor::RunDatabase, String> {
    use crate::mysql::logged_query::{fetch_first, LoggedStatement};

    match fetch_first(conn, LoggedStatement::text("SELECT DATABASE()")).await {
        Ok(first_row) => first_row_database(first_row),
        Err(error) => Err(error.to_string()),
    }
}

pub(super) async fn capture_session_database(
    conn: &mut mysql_async::Conn,
    connection_id: &str,
) -> Option<crate::mysql::query_executor::RunDatabase> {
    read_session_database(conn)
        .await
        .inspect_err(|error| {
            tracing::warn!(
                connection_id,
                %error,
                "could not record the database of a truncated result; full export disabled for it"
            );
        })
        .ok()
}

fn first_row_database(
    first_row: Option<mysql_async::Row>,
) -> Result<crate::mysql::query_executor::RunDatabase, String> {
    use crate::mysql::query_executor::RunDatabase;

    let Some(row) = first_row else {
        return Ok(RunDatabase::NoDatabase);
    };
    let database = crate::mysql::cell_values::DecodedRow::from_row(row).optional_text(0)?;
    Ok(database.map_or(RunDatabase::NoDatabase, RunDatabase::Named))
}
