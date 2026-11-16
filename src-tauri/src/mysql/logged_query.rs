use mysql_async::{Conn, Row, Value};

use crate::mysql::cell_values::DecodedRow;
use crate::mysql::pool::BackgroundPool;
#[cfg(not(coverage))]
use crate::mysql::query_log;

#[cfg(coverage)]
pub const UNAVAILABLE_IN_COVERAGE_MESSAGE: &str =
    "MySQL statements are not executed in coverage builds";

#[derive(Debug, Clone, PartialEq)]
pub struct BoundStatement<'a> {
    pub sql: &'a str,
    pub values: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LoggedStatement<'a> {
    Text(&'a str),
    Bound(BoundStatement<'a>),
}

impl<'a> LoggedStatement<'a> {
    pub fn text(sql: &'a str) -> Self {
        Self::Text(sql)
    }

    pub fn bound(sql: &'a str, values: Vec<Value>) -> Self {
        Self::Bound(BoundStatement { sql, values })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExecuteOutcome {
    pub affected_rows: u64,
    pub last_insert_id: Option<u64>,
}

#[cfg(not(coverage))]
fn log_statement(statement: &LoggedStatement<'_>) {
    match statement {
        LoggedStatement::Text(sql) => query_log::log_outgoing_sql(sql),
        LoggedStatement::Bound(bound) => {
            query_log::log_outgoing_sql_with_values(bound.sql, &bound.values)
        }
    }
}

#[cfg(not(coverage))]
fn log_failure<T>(outcome: Result<T, mysql_async::Error>) -> Result<T, mysql_async::Error> {
    outcome.inspect_err(query_log::log_mysql_async_error)
}

#[cfg(not(coverage))]
pub async fn fetch_all(
    conn: &mut Conn,
    statement: LoggedStatement<'_>,
) -> Result<Vec<Row>, mysql_async::Error> {
    use mysql_async::prelude::Queryable;

    log_statement(&statement);
    let fetched = match statement {
        LoggedStatement::Text(sql) => conn.query::<Row, _>(sql).await,
        LoggedStatement::Bound(bound) => conn.exec::<Row, _, _>(bound.sql, bound.values).await,
    };
    let rows = log_failure(fetched)?;
    query_log::log_mysql_async_rows(&rows);
    Ok(rows)
}

#[cfg(not(coverage))]
pub async fn fetch_first(
    conn: &mut Conn,
    statement: LoggedStatement<'_>,
) -> Result<Option<Row>, mysql_async::Error> {
    use mysql_async::prelude::Queryable;

    log_statement(&statement);
    let fetched = match statement {
        LoggedStatement::Text(sql) => conn.query_first::<Row, _>(sql).await,
        LoggedStatement::Bound(bound) => {
            conn.exec_first::<Row, _, _>(bound.sql, bound.values).await
        }
    };
    let first_row = log_failure(fetched)?;
    query_log::log_mysql_async_rows(first_row.as_slice());
    Ok(first_row)
}

#[cfg(not(coverage))]
pub async fn execute(
    conn: &mut Conn,
    statement: LoggedStatement<'_>,
) -> Result<ExecuteOutcome, mysql_async::Error> {
    use mysql_async::prelude::Queryable;

    log_statement(&statement);
    let executed = match statement {
        LoggedStatement::Text(sql) => conn.query_drop(sql).await,
        LoggedStatement::Bound(bound) => conn.exec_drop(bound.sql, bound.values).await,
    };
    log_failure(executed)?;
    let outcome = ExecuteOutcome {
        affected_rows: conn.affected_rows(),
        last_insert_id: conn.last_insert_id(),
    };
    query_log::log_mysql_async_result(outcome.affected_rows, outcome.last_insert_id);
    Ok(outcome)
}

#[cfg(not(coverage))]
pub struct LoggedRowStream<'a, P: mysql_async::prelude::Protocol> {
    result: mysql_async::QueryResult<'a, 'static, P>,
    rows_read: usize,
}

#[cfg(coverage)]
pub struct LoggedRowStream<'a, P: mysql_async::prelude::Protocol> {
    _never_started: std::marker::PhantomData<(&'a mut Conn, P)>,
}

#[cfg(not(coverage))]
impl<P: mysql_async::prelude::Protocol> LoggedRowStream<'_, P> {
    pub fn columns(&self) -> &[mysql_async::Column] {
        self.result.columns_ref()
    }

    pub fn rows_read(&self) -> usize {
        self.rows_read
    }

    pub async fn next_row(&mut self) -> Result<Option<Row>, mysql_async::Error> {
        let next = log_failure(self.result.next().await)?;
        if let Some(row) = &next {
            query_log::log_mysql_async_row(self.rows_read, row);
            self.rows_read += 1;
        }
        Ok(next)
    }

    pub fn finish(self) -> usize {
        query_log::log_mysql_async_row_count(self.rows_read);
        self.rows_read
    }
}

#[cfg(not(coverage))]
pub async fn stream_text<'a>(
    conn: &'a mut Conn,
    sql: &str,
) -> Result<LoggedRowStream<'a, mysql_async::TextProtocol>, mysql_async::Error> {
    use mysql_async::prelude::Queryable;

    query_log::log_outgoing_sql(sql);
    let result = log_failure(conn.query_iter(sql.to_owned()).await)?;
    Ok(LoggedRowStream {
        result,
        rows_read: 0,
    })
}

#[cfg(not(coverage))]
pub async fn query_multi_result<'a>(
    conn: &'a mut Conn,
    sql: &str,
) -> Result<mysql_async::QueryResult<'a, 'static, mysql_async::TextProtocol>, mysql_async::Error> {
    use mysql_async::prelude::Queryable;

    query_log::log_outgoing_sql(sql);
    log_failure(conn.query_iter(sql.to_owned()).await)
}

#[cfg(not(coverage))]
pub async fn stream_bound<'a>(
    conn: &'a mut Conn,
    statement: BoundStatement<'_>,
) -> Result<LoggedRowStream<'a, mysql_async::BinaryProtocol>, mysql_async::Error> {
    use mysql_async::prelude::Queryable;

    query_log::log_outgoing_sql_with_values(statement.sql, &statement.values);
    let result = log_failure(conn.exec_iter(statement.sql, statement.values).await)?;
    Ok(LoggedRowStream {
        result,
        rows_read: 0,
    })
}

pub enum LoggedRows<'a> {
    Text(LoggedRowStream<'a, mysql_async::TextProtocol>),
    Bound(LoggedRowStream<'a, mysql_async::BinaryProtocol>),
}

#[cfg(not(coverage))]
impl LoggedRows<'_> {
    pub fn columns(&self) -> &[mysql_async::Column] {
        match self {
            Self::Text(rows) => rows.columns(),
            Self::Bound(rows) => rows.columns(),
        }
    }

    pub async fn next_row(&mut self) -> Result<Option<Row>, mysql_async::Error> {
        match self {
            Self::Text(rows) => rows.next_row().await,
            Self::Bound(rows) => rows.next_row().await,
        }
    }

    pub async fn next_decoded(&mut self) -> Result<Option<DecodedRow>, mysql_async::Error> {
        let next = self.next_row().await?;
        Ok(next.map(DecodedRow::from_row))
    }

    pub fn finish(self) -> usize {
        match self {
            Self::Text(rows) => rows.finish(),
            Self::Bound(rows) => rows.finish(),
        }
    }
}

#[cfg(not(coverage))]
async fn next_streamed_row(
    mut rows: LoggedRows<'_>,
) -> Result<Option<(DecodedRow, LoggedRows<'_>)>, mysql_async::Error> {
    let Some(row) = rows.next_decoded().await? else {
        rows.finish();
        return Ok(None);
    };
    Ok(Some((row, rows)))
}

#[cfg(not(coverage))]
pub fn decoded_row_stream(
    rows: LoggedRows<'_>,
) -> impl futures::Stream<Item = Result<DecodedRow, mysql_async::Error>> + '_ {
    futures::stream::try_unfold(rows, next_streamed_row)
}

pub async fn stream<'a>(
    conn: &'a mut Conn,
    statement: LoggedStatement<'_>,
) -> Result<LoggedRows<'a>, mysql_async::Error> {
    match statement {
        LoggedStatement::Text(sql) => stream_text(conn, sql).await.map(LoggedRows::Text),
        LoggedStatement::Bound(bound) => stream_bound(conn, bound).await.map(LoggedRows::Bound),
    }
}

#[cfg(not(coverage))]
async fn checkout_logged(pool: &BackgroundPool) -> Result<Conn, mysql_async::Error> {
    log_failure(pool.checkout().await)
}

#[cfg(not(coverage))]
pub async fn fetch_all_pooled(
    pool: &BackgroundPool,
    statement: LoggedStatement<'_>,
) -> Result<Vec<Row>, mysql_async::Error> {
    let mut conn = checkout_logged(pool).await?;
    fetch_all(&mut conn, statement).await
}

#[cfg(not(coverage))]
pub async fn fetch_first_pooled(
    pool: &BackgroundPool,
    statement: LoggedStatement<'_>,
) -> Result<Option<Row>, mysql_async::Error> {
    let mut conn = checkout_logged(pool).await?;
    fetch_first(&mut conn, statement).await
}

#[cfg(not(coverage))]
pub async fn execute_pooled(
    pool: &BackgroundPool,
    statement: LoggedStatement<'_>,
) -> Result<ExecuteOutcome, mysql_async::Error> {
    let mut conn = checkout_logged(pool).await?;
    execute(&mut conn, statement).await
}

pub async fn fetch_decoded_pooled(
    pool: &BackgroundPool,
    statement: LoggedStatement<'_>,
) -> Result<Vec<DecodedRow>, mysql_async::Error> {
    let rows = fetch_all_pooled(pool, statement).await?;
    Ok(rows.into_iter().map(DecodedRow::from_row).collect())
}

pub async fn fetch_first_decoded_pooled(
    pool: &BackgroundPool,
    statement: LoggedStatement<'_>,
) -> Result<Option<DecodedRow>, mysql_async::Error> {
    let first_row = fetch_first_pooled(pool, statement).await?;
    Ok(first_row.map(DecodedRow::from_row))
}

pub async fn fetch_first_decoded(
    conn: &mut Conn,
    statement: LoggedStatement<'_>,
) -> Result<Option<DecodedRow>, mysql_async::Error> {
    let first_row = fetch_first(conn, statement).await?;
    Ok(first_row.map(DecodedRow::from_row))
}

pub async fn fetch_decoded(
    conn: &mut Conn,
    statement: LoggedStatement<'_>,
) -> Result<Vec<DecodedRow>, mysql_async::Error> {
    let rows = fetch_all(conn, statement).await?;
    Ok(rows.into_iter().map(DecodedRow::from_row).collect())
}

#[cfg(coverage)]
fn unavailable_in_coverage() -> mysql_async::Error {
    mysql_async::Error::Other(UNAVAILABLE_IN_COVERAGE_MESSAGE.into())
}

#[cfg(coverage)]
pub async fn fetch_all(
    conn: &mut Conn,
    statement: LoggedStatement<'_>,
) -> Result<Vec<Row>, mysql_async::Error> {
    let _ = (conn, statement);
    Err(unavailable_in_coverage())
}

#[cfg(coverage)]
pub async fn fetch_first(
    conn: &mut Conn,
    statement: LoggedStatement<'_>,
) -> Result<Option<Row>, mysql_async::Error> {
    let _ = (conn, statement);
    Err(unavailable_in_coverage())
}

#[cfg(coverage)]
pub async fn execute(
    conn: &mut Conn,
    statement: LoggedStatement<'_>,
) -> Result<ExecuteOutcome, mysql_async::Error> {
    let _ = (conn, statement);
    Err(unavailable_in_coverage())
}

#[cfg(coverage)]
pub async fn stream_text<'a>(
    conn: &'a mut Conn,
    sql: &str,
) -> Result<LoggedRowStream<'a, mysql_async::TextProtocol>, mysql_async::Error> {
    let _ = (conn, sql);
    Err(unavailable_in_coverage())
}

#[cfg(coverage)]
pub async fn query_multi_result<'a>(
    conn: &'a mut Conn,
    sql: &str,
) -> Result<mysql_async::QueryResult<'a, 'static, mysql_async::TextProtocol>, mysql_async::Error> {
    let _ = (conn, sql);
    Err(unavailable_in_coverage())
}

#[cfg(coverage)]
pub async fn stream_bound<'a>(
    conn: &'a mut Conn,
    statement: BoundStatement<'_>,
) -> Result<LoggedRowStream<'a, mysql_async::BinaryProtocol>, mysql_async::Error> {
    let _ = (conn, statement);
    Err(unavailable_in_coverage())
}

#[cfg(coverage)]
pub async fn fetch_all_pooled(
    pool: &BackgroundPool,
    statement: LoggedStatement<'_>,
) -> Result<Vec<Row>, mysql_async::Error> {
    let _ = (pool, statement);
    Err(unavailable_in_coverage())
}

#[cfg(coverage)]
pub async fn fetch_first_pooled(
    pool: &BackgroundPool,
    statement: LoggedStatement<'_>,
) -> Result<Option<Row>, mysql_async::Error> {
    let _ = (pool, statement);
    Err(unavailable_in_coverage())
}

#[cfg(coverage)]
pub async fn execute_pooled(
    pool: &BackgroundPool,
    statement: LoggedStatement<'_>,
) -> Result<ExecuteOutcome, mysql_async::Error> {
    let _ = (pool, statement);
    Err(unavailable_in_coverage())
}

const PLACEHOLDER: &str = "?";
const PLACEHOLDER_SEPARATOR: &str = ", ";

pub fn placeholder_list(placeholder_count: usize) -> String {
    vec![PLACEHOLDER; placeholder_count].join(PLACEHOLDER_SEPARATOR)
}

pub fn text_values(texts: &[String]) -> Vec<Value> {
    texts
        .iter()
        .map(|text| Value::from(text.as_str()))
        .collect()
}
