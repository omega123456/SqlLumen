//! The shared logged-query helpers against the in-process fake MySQL server: rows, first
//! row, execute and streams in both protocols, over a held connection or a pool, with the
//! SQL, binds, rows, results and errors visible in the captured `mysql_traffic` log.

use mysql_async::Value;
use sqllumen_lib::mysql::logged_query::{BoundStatement, ExecuteOutcome, LoggedStatement};

use crate::common::mock_session::unreachable_pool;

#[test]
fn statements_are_text_unless_values_are_bound() {
    assert_eq!(
        LoggedStatement::text("SELECT 1"),
        LoggedStatement::Text("SELECT 1")
    );
    let bound = LoggedStatement::bound("SELECT ?", vec![Value::Int(1)]);
    let expected = LoggedStatement::Bound(BoundStatement {
        sql: "SELECT ?",
        values: vec![Value::Int(1)],
    });
    assert_eq!(bound, expected);
    let outcome = ExecuteOutcome {
        affected_rows: 1,
        last_insert_id: None,
    };
    assert_eq!(outcome.affected_rows, 1);
}

#[cfg(coverage)]
mod coverage_stubs {
    use super::*;
    use crate::common::mock_mysql_server::MockMySqlServer;
    use crate::common::mock_session::mock_connection;
    use sqllumen_lib::mysql::logged_query::{
        execute, execute_pooled, fetch_all, fetch_all_pooled, fetch_decoded, fetch_first,
        fetch_first_decoded, fetch_first_pooled, stream, stream_bound, stream_text,
        UNAVAILABLE_IN_COVERAGE_MESSAGE,
    };

    fn is_unavailable(error: &mysql_async::Error) -> bool {
        error.to_string().contains(UNAVAILABLE_IN_COVERAGE_MESSAGE)
    }

    fn bound_statement() -> BoundStatement<'static> {
        BoundStatement {
            sql: "SELECT ?",
            values: vec![Value::Int(1)],
        }
    }

    #[tokio::test]
    async fn pooled_helpers_are_stubbed_out() {
        let pool = unreachable_pool();
        let all = fetch_all_pooled(&pool, LoggedStatement::text("SELECT 1")).await;
        assert!(all.is_err_and(|error| is_unavailable(&error)));
        let first = fetch_first_pooled(&pool, LoggedStatement::text("SELECT 1")).await;
        assert!(first.is_err_and(|error| is_unavailable(&error)));
        let executed = execute_pooled(&pool, LoggedStatement::text("DO 0")).await;
        assert!(executed.is_err_and(|error| is_unavailable(&error)));
        assert!(pool.checkout().await.is_err());
    }

    #[tokio::test]
    async fn held_connection_helpers_are_stubbed_out() {
        let server = MockMySqlServer::start_script(Vec::new()).await;
        let mut conn = mock_connection(server.port).await;

        let all = fetch_all(&mut conn, LoggedStatement::text("SELECT 1")).await;
        assert!(all.is_err_and(|error| is_unavailable(&error)));
        let first = fetch_first(&mut conn, LoggedStatement::text("SELECT 1")).await;
        assert!(first.is_err_and(|error| is_unavailable(&error)));
        let executed = execute(&mut conn, LoggedStatement::text("DO 0")).await;
        assert!(executed.is_err_and(|error| is_unavailable(&error)));
        let decoded = fetch_decoded(&mut conn, LoggedStatement::text("SELECT 1")).await;
        assert!(decoded.is_err_and(|error| is_unavailable(&error)));
        let first_decoded = fetch_first_decoded(&mut conn, LoggedStatement::text("SELECT 1")).await;
        assert!(first_decoded.is_err_and(|error| is_unavailable(&error)));
    }

    #[tokio::test]
    async fn held_connection_streams_are_stubbed_out() {
        let server = MockMySqlServer::start_script(Vec::new()).await;
        let mut conn = mock_connection(server.port).await;

        let text_rows = stream_text(&mut conn, "SELECT 1").await;
        assert!(text_rows.is_err_and(|error| is_unavailable(&error)));
        let bound_rows = stream_bound(&mut conn, bound_statement()).await;
        assert!(bound_rows.is_err_and(|error| is_unavailable(&error)));
        let text_statement_rows = stream(&mut conn, LoggedStatement::text("SELECT 1")).await;
        assert!(text_statement_rows.is_err_and(|error| is_unavailable(&error)));
        let bound_statement_rows =
            stream(&mut conn, LoggedStatement::Bound(bound_statement())).await;
        assert!(bound_statement_rows.is_err_and(|error| is_unavailable(&error)));
    }
}

#[cfg(not(coverage))]
mod against_the_fake_server {
    use super::*;
    use crate::common::log_capture::LogCaptureGuard;
    use crate::common::mock_mysql_server::{
        MockCell, MockMySqlServer, MockQueryStep, MockScript, MockStreamRows, MockStreamStep,
    };
    use crate::common::mock_session::integer_column;
    use crate::common::mock_session::mock_pool;
    use mysql_async::prelude::Protocol;
    use opensrv_mysql::ErrorKind;
    use sqllumen_lib::mysql::cell_values::DecodedRow;
    use sqllumen_lib::mysql::connection_options::{connect_within_timeout, mysql_opts};
    use sqllumen_lib::mysql::logged_query::{
        execute, execute_pooled, fetch_all, fetch_all_pooled, fetch_first, fetch_first_pooled,
        stream_bound, stream_text, LoggedRowStream,
    };
    use sqllumen_lib::mysql::pool::{ConnectionParams, SslSettings};
    use std::time::Duration;

    const CONNECT_TIMEOUT: Duration = Duration::from_secs(1);
    const SELECT_ROWS: &str = "SELECT n FROM numbers";
    const SELECT_BOUND: &str = "SELECT n FROM numbers WHERE n > ?";
    const UPDATE_ROWS: &str = "UPDATE numbers SET n = n + 1";
    const DELETE_BOUND: &str = "DELETE FROM numbers WHERE n = ?";
    const MISSING_TABLE: &str = "SELECT n FROM missing";
    const STREAMED: &str = "SELECT n FROM streamed";
    const MISSING_TABLE_MESSAGE: &[u8] = b"Table 'missing' doesn't exist";
    const TERMINAL_STYLING_PATTERN: &str = "\x1b\\[[0-9;]*m";

    fn numbers_row(index: usize) -> Vec<MockCell> {
        vec![MockCell::I64(
            i64::try_from(index).expect("small index") + 1,
        )]
    }

    fn script() -> MockScript {
        let rows = vec![vec![MockCell::I64(1)], vec![MockCell::I64(2)]];
        MockScript {
            steps: vec![
                MockQueryStep::with_rows(SELECT_ROWS, vec![integer_column("n")], rows.clone()),
                MockQueryStep::with_rows(SELECT_BOUND, vec![integer_column("n")], rows),
                MockQueryStep::ok_affected(UPDATE_ROWS, 3),
                MockQueryStep::ok_affected(DELETE_BOUND, 1),
                MockQueryStep {
                    error: Some((ErrorKind::ER_NO_SUCH_TABLE, MISSING_TABLE_MESSAGE)),
                    ..MockQueryStep::with_rows(MISSING_TABLE, Vec::new(), Vec::new())
                },
            ],
            stream_steps: vec![MockStreamStep::new(
                STREAMED,
                vec![integer_column("n")],
                MockStreamRows {
                    count: 3,
                    make_row: numbers_row,
                },
            )],
            ..MockScript::default()
        }
    }

    fn params(port: u16) -> ConnectionParams {
        ConnectionParams {
            host: "127.0.0.1".to_string(),
            port,
            username: "root".to_string(),
            password: String::new(),
            default_database: None,
            ssl: SslSettings::default(),
            connect_timeout_secs: 1,
        }
    }

    async fn connect(server: &MockMySqlServer) -> mysql_async::Conn {
        let opts = mysql_opts(&params(server.port)).expect("options should build");
        connect_within_timeout(opts, CONNECT_TIMEOUT)
            .await
            .expect("should connect to the fake server")
    }

    async fn streamed_numbers<P: Protocol>(rows: &mut LoggedRowStream<'_, P>) -> Vec<i64> {
        let mut numbers = Vec::new();
        while let Some(row) = rows.next_row().await.expect("rows should stream") {
            numbers.push(DecodedRow::from_row(&row).signed("n").expect("integer n"));
        }
        numbers
    }

    fn plain_logs(logs: &LogCaptureGuard) -> String {
        let terminal_styling = regex::Regex::new(TERMINAL_STYLING_PATTERN).expect("valid pattern");
        terminal_styling
            .replace_all(&logs.contents(), "")
            .into_owned()
    }

    fn first_numbers(rows: &[mysql_async::Row]) -> Vec<i64> {
        rows.iter()
            .map(|row| {
                DecodedRow::from_row(row)
                    .signed(0)
                    .expect("n should be an integer")
            })
            .collect()
    }

    #[tokio::test]
    async fn fetch_all_logs_the_text_sql_and_every_row() {
        let server = MockMySqlServer::start_with(script()).await;
        let mut conn = connect(&server).await;
        let logs = LogCaptureGuard::start();

        let rows = fetch_all(&mut conn, LoggedStatement::text(SELECT_ROWS))
            .await
            .expect("rows should be fetched");

        assert_eq!(first_numbers(&rows), vec![1, 2]);
        let captured = plain_logs(&logs);
        assert!(captured.contains("mysql outgoing query"), "{captured}");
        assert!(captured.contains(SELECT_ROWS), "{captured}");
        assert!(captured.contains("n=Some(1)"), "{captured}");
        assert!(captured.contains("n=Some(2)"), "{captured}");
        assert!(captured.contains("row_count=2"), "{captured}");
    }

    #[tokio::test]
    async fn fetch_all_bound_logs_the_bind_values() {
        let server = MockMySqlServer::start_with(script()).await;
        let mut conn = connect(&server).await;
        let logs = LogCaptureGuard::start();

        let statement = LoggedStatement::bound(SELECT_BOUND, vec![Value::Int(0)]);
        let rows = fetch_all(&mut conn, statement).await.expect("bound rows");

        assert_eq!(first_numbers(&rows), vec![1, 2]);
        let captured = plain_logs(&logs);
        assert!(
            captured.contains("mysql outgoing query (bound)"),
            "{captured}"
        );
        assert!(captured.contains("binds=[\"0\"]"), "{captured}");
        assert!(captured.contains("n=Some(2)"), "{captured}");
    }

    #[tokio::test]
    async fn fetch_first_returns_and_logs_one_row_in_both_protocols() {
        let server = MockMySqlServer::start_with(script()).await;
        let mut conn = connect(&server).await;
        let logs = LogCaptureGuard::start();

        let text_row = fetch_first(&mut conn, LoggedStatement::text(SELECT_ROWS))
            .await
            .expect("first text row");
        let statement = LoggedStatement::bound(SELECT_BOUND, vec![Value::Int(0)]);
        let bound_row = fetch_first(&mut conn, statement)
            .await
            .expect("first bound row");

        assert_eq!(first_numbers(text_row.as_slice()), vec![1]);
        assert_eq!(first_numbers(bound_row.as_slice()), vec![1]);
        let captured = plain_logs(&logs);
        assert!(captured.contains("row_count=1"), "{captured}");
        assert!(captured.contains("n=Some(1)"), "{captured}");
    }

    #[tokio::test]
    async fn execute_reports_and_logs_affected_rows_in_both_protocols() {
        let server = MockMySqlServer::start_with(script()).await;
        let mut conn = connect(&server).await;
        let logs = LogCaptureGuard::start();

        let updated = execute(&mut conn, LoggedStatement::text(UPDATE_ROWS))
            .await
            .expect("update should run");
        let statement = LoggedStatement::bound(DELETE_BOUND, vec![Value::Int(4)]);
        let deleted = execute(&mut conn, statement)
            .await
            .expect("delete should run");

        assert_eq!(updated.affected_rows, 3);
        assert_eq!(deleted.affected_rows, 1);
        let captured = plain_logs(&logs);
        assert!(captured.contains("mysql execute result"), "{captured}");
        assert!(captured.contains("rows_affected=3"), "{captured}");
        assert!(captured.contains("binds=[\"4\"]"), "{captured}");
    }

    #[tokio::test]
    async fn server_errors_are_returned_and_logged() {
        let server = MockMySqlServer::start_with(script()).await;
        let mut conn = connect(&server).await;
        let logs = LogCaptureGuard::start();

        let error = fetch_all(&mut conn, LoggedStatement::text(MISSING_TABLE))
            .await
            .expect_err("a missing table is a server error");

        assert!(!error.is_fatal(), "{error}");
        let captured = plain_logs(&logs);
        assert!(captured.contains("mysql execute error"), "{captured}");
        assert!(captured.contains("doesn't exist"), "{captured}");
    }

    #[tokio::test]
    async fn text_streams_log_each_row_and_the_final_count() {
        let server = MockMySqlServer::start_with(script()).await;
        let mut conn = connect(&server).await;
        let logs = LogCaptureGuard::start();

        let mut rows = stream_text(&mut conn, STREAMED)
            .await
            .expect("stream should start");
        assert_eq!(rows.columns().len(), 1);
        let numbers = streamed_numbers(&mut rows).await;
        assert_eq!(rows.rows_read(), 3);
        assert_eq!(rows.finish(), 3);

        assert_eq!(numbers, vec![1, 2, 3]);
        let captured = plain_logs(&logs);
        assert!(captured.contains(STREAMED), "{captured}");
        assert!(captured.contains("n=Some(3)"), "{captured}");
        assert!(captured.contains("row_count=3"), "{captured}");
    }

    #[tokio::test]
    async fn bound_streams_log_binds_and_rows() {
        let server = MockMySqlServer::start_with(script()).await;
        let mut conn = connect(&server).await;
        let logs = LogCaptureGuard::start();

        let statement = BoundStatement {
            sql: SELECT_BOUND,
            values: vec![Value::Int(0)],
        };
        let mut rows = stream_bound(&mut conn, statement)
            .await
            .expect("bound stream");
        let numbers = streamed_numbers(&mut rows).await;
        rows.finish();

        assert_eq!(numbers, vec![1, 2]);
        let captured = plain_logs(&logs);
        assert!(captured.contains("binds=[\"0\"]"), "{captured}");
        assert!(captured.contains("row_count=2"), "{captured}");
    }

    #[tokio::test]
    async fn stream_start_errors_are_returned_and_logged() {
        let server = MockMySqlServer::start_with(script()).await;
        let mut conn = connect(&server).await;
        let logs = LogCaptureGuard::start();

        let started = stream_text(&mut conn, MISSING_TABLE).await;

        assert!(started.is_err());
        assert!(plain_logs(&logs).contains("mysql execute error"));
    }

    #[tokio::test]
    async fn pooled_helpers_check_out_and_log() {
        let server = MockMySqlServer::start_with(script()).await;
        let pool = mock_pool(server.port);
        let logs = LogCaptureGuard::start();

        let rows = fetch_all_pooled(&pool, LoggedStatement::text(SELECT_ROWS)).await;
        let first = fetch_first_pooled(&pool, LoggedStatement::text(SELECT_ROWS)).await;
        let updated = execute_pooled(&pool, LoggedStatement::text(UPDATE_ROWS)).await;

        assert_eq!(first_numbers(&rows.expect("pooled rows")), vec![1, 2]);
        assert_eq!(
            first_numbers(first.expect("pooled first").as_slice()),
            vec![1]
        );
        assert_eq!(updated.expect("pooled update").affected_rows, 3);
        assert!(plain_logs(&logs).contains("rows_affected=3"));
        pool.disconnect().await.expect("pool should disconnect");
    }

    #[tokio::test]
    async fn pool_checkout_failures_are_returned_and_logged() {
        let logs = LogCaptureGuard::start();

        let error = fetch_all_pooled(&unreachable_pool(), LoggedStatement::text(SELECT_ROWS))
            .await
            .expect_err("nothing listens on the unreachable port");

        let captured = plain_logs(&logs);
        assert!(captured.contains("mysql execute error"), "{captured}");
        assert!(captured.contains(&error.to_string()), "{captured}");
    }
}
