//! `finish_dump_file` on its own, then `start_sql_dump_impl` end to end against the
//! in-process mock MySQL server: structure, typed row values, views, empty tables and
//! failures. Only the file-finishing tests run in coverage builds, where the dump job's
//! checkout is a stub that fails.

use std::io::Write;

use sqllumen_lib::commands::sql_dump::{finish_dump_file, DumpLoopOutcome, DumpStop};

const FOOTER_LAST_LINE: &str = "/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;";
const LOOP_FAILURE: &str = "Failed to write data for 'orders': disk full";

struct FinishedDump {
    outcome: Result<DumpLoopOutcome, String>,
    contents: String,
}

fn finish_new_file(use_transaction: bool, loop_result: Result<(), DumpStop>) -> FinishedDump {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("finished.sql");
    let mut file = std::fs::File::create(&path).expect("create dump file");
    writeln!(file, "USE `app`;").expect("write dump body");
    let outcome = finish_dump_file(&mut file, use_transaction, loop_result);
    FinishedDump {
        outcome,
        contents: std::fs::read_to_string(&path).expect("read dump file"),
    }
}

fn finish_read_only_file(use_transaction: bool) -> Result<DumpLoopOutcome, String> {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("read-only.sql");
    std::fs::write(&path, "").expect("create dump file");
    let mut file = std::fs::File::open(&path).expect("open dump file read-only");
    finish_dump_file(&mut file, use_transaction, Ok(()))
}

#[test]
fn a_finished_loop_commits_and_writes_the_footer() {
    let finished = finish_new_file(true, Ok(()));

    assert_eq!(finished.outcome, Ok(DumpLoopOutcome::Finished));
    assert!(
        finished.contents.contains("COMMIT;"),
        "{}",
        finished.contents
    );
    assert!(finished.contents.trim_end().ends_with(FOOTER_LAST_LINE));
}

#[test]
fn a_cancelled_loop_is_reported_and_still_gets_the_footer() {
    let finished = finish_new_file(false, Err(DumpStop::Cancelled));

    assert_eq!(finished.outcome, Ok(DumpLoopOutcome::Cancelled));
    assert!(
        !finished.contents.contains("COMMIT;"),
        "{}",
        finished.contents
    );
    assert!(finished.contents.trim_end().ends_with(FOOTER_LAST_LINE));
}

#[test]
fn a_failed_loop_returns_its_error_after_finishing_the_file() {
    let finished = finish_new_file(true, Err(DumpStop::from(LOOP_FAILURE.to_string())));

    assert_eq!(finished.outcome, Err(LOOP_FAILURE.to_string()));
    assert!(
        finished.contents.contains("COMMIT;"),
        "{}",
        finished.contents
    );
    assert!(finished.contents.trim_end().ends_with(FOOTER_LAST_LINE));
}

#[test]
fn an_unwritable_file_reports_the_first_finishing_write_that_failed() {
    let transaction_error = finish_read_only_file(true).expect_err("the write fails");
    let footer_error = finish_read_only_file(false).expect_err("the write fails");

    assert!(
        transaction_error.starts_with("Failed to write transaction end"),
        "{transaction_error}"
    );
    assert!(
        footer_error.starts_with("Failed to write footer"),
        "{footer_error}"
    );
}

#[cfg(not(coverage))]
mod against_the_mock_server {
    use std::collections::HashMap;
    use std::time::{Duration, Instant};

    use opensrv_mysql::{ColumnFlags, ColumnType, ErrorKind};
    use sqllumen_lib::commands::sql_dump::{
        get_dump_progress_impl, start_sql_dump_impl, DumpObjectType, DumpTableEntry, StartDumpInput,
    };
    use sqllumen_lib::export::sql_dump::DumpOptions;
    use sqllumen_lib::state::{AppState, DumpJobProgress, DumpJobStatus};

    use crate::common;
    use crate::common::mock_mysql_server::{
        MockCell, MockColumnDef, MockMySqlServer, MockQueryStep, MockTimeValue,
    };
    use crate::common::mock_session::{mock_pool, text_column};

    const JOB_DEADLINE: Duration = Duration::from_secs(5);
    const JOB_POLL_INTERVAL: Duration = Duration::from_millis(10);
    const TIMEOUT_DEADLINE: Duration = Duration::from_millis(1500);

    fn table_entry(name: &str, object_type: DumpObjectType) -> DumpTableEntry {
        DumpTableEntry {
            name: name.to_string(),
            object_type,
        }
    }

    fn dump_input(file_path: &std::path::Path, entries: Vec<DumpTableEntry>) -> StartDumpInput {
        StartDumpInput {
            connection_id: "conn-dump".to_string(),
            file_path: file_path.to_string_lossy().into_owned(),
            databases: vec!["app".to_string(), "unselected".to_string()],
            tables: HashMap::from([("app".to_string(), entries)]),
            options: DumpOptions {
                include_structure: true,
                include_data: true,
                include_drop: true,
                use_transaction: true,
            },
        }
    }

    fn is_still_running_before(progress: &DumpJobProgress, deadline: Instant) -> bool {
        progress.status == DumpJobStatus::Running && Instant::now() < deadline
    }

    async fn wait_for_dump(state: &AppState, job_id: &str) -> DumpJobProgress {
        let deadline = Instant::now() + JOB_DEADLINE;
        let mut progress = get_dump_progress_impl(state, job_id).expect("job exists");
        while is_still_running_before(&progress, deadline) {
            tokio::time::sleep(JOB_POLL_INTERVAL).await;
            progress = get_dump_progress_impl(state, job_id).expect("job exists");
        }
        progress
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_silent_server_fails_the_dump_with_the_checkout_timeout() {
        let listener = common::silent_listener::SilentListener::start().await;
        let state = common::test_app_state();
        let dir = tempfile::tempdir().expect("temp dir");
        let input = dump_input(
            &dir.path().join("silent.sql"),
            vec![table_entry("flags", DumpObjectType::Table)],
        );
        let started = Instant::now();

        let job_id = start_sql_dump_impl(&state, input, mock_pool(listener.port))
            .await
            .expect("the job id is returned before any connection is made");
        let progress = wait_for_dump(&state, &job_id).await;

        assert!(
            started.elapsed() < TIMEOUT_DEADLINE,
            "{:?}",
            started.elapsed()
        );
        assert_eq!(progress.status, DumpJobStatus::Failed);
        let error = progress.error_message.expect("error message");
        assert!(error.contains("timed out"), "{error}");
    }

    fn typed_column(
        name: &'static str,
        coltype: ColumnType,
        colflags: ColumnFlags,
    ) -> MockColumnDef {
        MockColumnDef {
            name,
            coltype,
            colflags,
        }
    }

    fn show_create_step(query: &'static str, create_sql: &'static [u8]) -> MockQueryStep {
        MockQueryStep::with_rows(
            query,
            vec![text_column("Name"), text_column("Create")],
            vec![vec![
                MockCell::Bytes(b"object"),
                MockCell::Bytes(create_sql),
            ]],
        )
    }

    fn connection_id_step() -> MockQueryStep {
        MockQueryStep::with_rows(
            "SELECT CONNECTION_ID()",
            vec![typed_column(
                "CONNECTION_ID()",
                ColumnType::MYSQL_TYPE_LONGLONG,
                ColumnFlags::UNSIGNED_FLAG,
            )],
            vec![vec![MockCell::U64(77)]],
        )
    }

    fn typed_order_columns() -> Vec<MockColumnDef> {
        vec![
            typed_column("id", ColumnType::MYSQL_TYPE_LONGLONG, ColumnFlags::empty()),
            typed_column(
                "big",
                ColumnType::MYSQL_TYPE_LONGLONG,
                ColumnFlags::UNSIGNED_FLAG,
            ),
            typed_column("price", ColumnType::MYSQL_TYPE_DOUBLE, ColumnFlags::empty()),
            typed_column(
                "amount",
                ColumnType::MYSQL_TYPE_NEWDECIMAL,
                ColumnFlags::empty(),
            ),
            typed_column(
                "payload",
                ColumnType::MYSQL_TYPE_BLOB,
                ColumnFlags::BINARY_FLAG,
            ),
            typed_column(
                "created",
                ColumnType::MYSQL_TYPE_DATETIME,
                ColumnFlags::empty(),
            ),
            typed_column("waited", ColumnType::MYSQL_TYPE_TIME, ColumnFlags::empty()),
            text_column("label"),
            text_column("note"),
        ]
    }

    fn created_at() -> chrono::NaiveDateTime {
        chrono::NaiveDateTime::parse_from_str("2025-03-04 05:06:07", "%Y-%m-%d %H:%M:%S")
            .expect("valid datetime")
    }

    fn typed_order_row() -> Vec<MockCell> {
        vec![
            MockCell::I64(1),
            MockCell::U64(18_446_744_073_709_551_615),
            MockCell::F64(2.5),
            MockCell::Bytes(b"12.50"),
            MockCell::Bytes(b"\x01\xff"),
            MockCell::DateTime(created_at()),
            MockCell::Time(MockTimeValue {
                negative: false,
                hours: 1,
                minutes: 2,
                seconds: 3,
                microseconds: 0,
            }),
            MockCell::Bytes(b"O'Brien"),
            MockCell::Null,
        ]
    }

    fn orders_rows_step() -> MockQueryStep {
        MockQueryStep::with_rows(
            "SELECT * FROM `app`.`orders`",
            typed_order_columns(),
            vec![typed_order_row()],
        )
    }

    fn empty_audit_rows_step() -> MockQueryStep {
        MockQueryStep::with_rows(
            "SELECT * FROM `app`.`audit`",
            vec![text_column("entry")],
            vec![],
        )
    }

    fn dump_steps() -> Vec<MockQueryStep> {
        vec![
            show_create_step(
                "SHOW CREATE TABLE `app`.`orders`",
                b"CREATE TABLE `orders` (`id` bigint)",
            ),
            show_create_step(
                "SHOW CREATE TABLE `app`.`audit`",
                b"CREATE TABLE `audit` (`entry` text)",
            ),
            show_create_step(
                "SHOW CREATE VIEW `app`.`order_totals`",
                b"CREATE VIEW `order_totals` AS SELECT 1",
            ),
            connection_id_step(),
            orders_rows_step(),
            empty_audit_rows_step(),
        ]
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dump_writes_structure_typed_rows_and_views() {
        let server = MockMySqlServer::start_script(dump_steps()).await;
        let state = common::test_app_state();
        let dir = tempfile::tempdir().expect("temp dir");
        let target = dir.path().join("dump.sql");
        let entries = vec![
            table_entry("orders", DumpObjectType::Table),
            table_entry("audit", DumpObjectType::Table),
            table_entry("order_totals", DumpObjectType::View),
        ];

        let job_id =
            start_sql_dump_impl(&state, dump_input(&target, entries), mock_pool(server.port))
                .await
                .expect("dump starts");
        let progress = wait_for_dump(&state, &job_id).await;

        assert_eq!(progress.status, DumpJobStatus::Completed, "{progress:?}");
        assert_eq!(progress.tables_done, 3);
        assert!(progress.bytes_written > 0);
        let dump = std::fs::read_to_string(&target).expect("dump file");
        assert!(dump.contains("8.0.36-mock"));
        assert!(dump.contains("USE `app`;"));
        assert!(dump.contains("CREATE TABLE `orders` (`id` bigint)"));
        assert!(dump.contains("CREATE VIEW `order_totals` AS SELECT 1"));
        assert!(dump.contains("18446744073709551615"));
        assert!(dump.contains("12.50"));
        assert!(dump.contains("0x01FF"));
        assert!(dump.contains("2025-03-04 05:06:07"));
        assert!(dump.contains("O''Brien"));
        assert!(dump.contains("NULL"));
        assert!(dump.contains("COMMIT"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dump_without_transaction_or_data_writes_structure_only() {
        let server = MockMySqlServer::start_script(dump_steps()).await;
        let state = common::test_app_state();
        let dir = tempfile::tempdir().expect("temp dir");
        let target = dir.path().join("structure.sql");
        let mut input = dump_input(&target, vec![table_entry("orders", DumpObjectType::Table)]);
        input.options = DumpOptions {
            include_structure: true,
            include_data: false,
            include_drop: false,
            use_transaction: false,
        };

        let job_id = start_sql_dump_impl(&state, input, mock_pool(server.port))
            .await
            .expect("dump starts");
        let progress = wait_for_dump(&state, &job_id).await;

        assert_eq!(progress.status, DumpJobStatus::Completed, "{progress:?}");
        let dump = std::fs::read_to_string(&target).expect("dump file");
        assert!(dump.contains("CREATE TABLE `orders`"));
        assert!(!dump.contains("INSERT INTO"));
        assert!(!dump.contains("DROP TABLE"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_failing_show_create_fails_the_job_with_its_error() {
        let failing_create = MockQueryStep {
            error: Some((ErrorKind::ER_NO_SUCH_TABLE, b"no such table")),
            ..show_create_step("SHOW CREATE TABLE `app`.`orders`", b"")
        };
        let server = MockMySqlServer::start_script(vec![failing_create]).await;
        let state = common::test_app_state();
        let dir = tempfile::tempdir().expect("temp dir");
        let target = dir.path().join("failed.sql");
        let input = dump_input(&target, vec![table_entry("orders", DumpObjectType::Table)]);

        let job_id = start_sql_dump_impl(&state, input, mock_pool(server.port))
            .await
            .expect("dump starts");
        let progress = wait_for_dump(&state, &job_id).await;

        assert_eq!(progress.status, DumpJobStatus::Failed);
        let error = progress.error_message.expect("error message");
        assert!(
            error.contains("Failed to get CREATE TABLE for 'orders'"),
            "{error}"
        );
        let dump = std::fs::read_to_string(&target).expect("dump file still finalized");
        assert!(dump.contains("COMMIT"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_unwritable_target_fails_the_job() {
        let server = MockMySqlServer::start_script(dump_steps()).await;
        let state = common::test_app_state();
        let dir = tempfile::tempdir().expect("temp dir");
        let target = dir.path().join("missing-dir").join("dump.sql");
        let input = dump_input(&target, vec![table_entry("orders", DumpObjectType::Table)]);

        let job_id = start_sql_dump_impl(&state, input, mock_pool(server.port))
            .await
            .expect("dump starts");
        let progress = wait_for_dump(&state, &job_id).await;

        assert_eq!(progress.status, DumpJobStatus::Failed);
        let error = progress.error_message.expect("error message");
        assert!(error.contains("Failed to create file"), "{error}");
    }

    const TRANSFER_TIME_ZONE_SQL: &str = "SET time_zone='+00:00'";
    fn flags_steps() -> Vec<MockQueryStep> {
        vec![
            show_create_step(
                "SHOW CREATE TABLE `app`.`flags`",
                b"CREATE TABLE `flags` (`flag` tinyint(1))",
            ),
            connection_id_step(),
            MockQueryStep::with_rows(
                "SELECT * FROM `app`.`flags`",
                vec![typed_column(
                    "flag",
                    ColumnType::MYSQL_TYPE_TINY,
                    ColumnFlags::empty(),
                )],
                vec![vec![MockCell::I8(7)]],
            ),
        ]
    }

    async fn run_flags_dump(server: &MockMySqlServer, target: &std::path::Path) -> DumpJobProgress {
        let state = common::test_app_state();
        let input = dump_input(target, vec![table_entry("flags", DumpObjectType::Table)]);
        let job_id = start_sql_dump_impl(&state, input, mock_pool(server.port))
            .await
            .expect("dump starts");
        wait_for_dump(&state, &job_id).await
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dump_runs_on_one_connection_that_sets_utc_before_any_data_statement() {
        let server = MockMySqlServer::start_script(flags_steps()).await;
        let dir = tempfile::tempdir().expect("temp dir");
        let progress = run_flags_dump(&server, &dir.path().join("utc.sql")).await;
        assert_eq!(progress.status, DumpJobStatus::Completed, "{progress:?}");

        let data_connection = server
            .connection_that_sent("SELECT * FROM `app`.`flags`")
            .expect("data statement was recorded");
        let statements: Vec<String> = server
            .queries_on_connection(data_connection)
            .into_iter()
            .map(|query| query.sql)
            .collect();
        let position_of = |sql: &str| statements.iter().position(|statement| statement == sql);
        let utc_position = position_of(TRANSFER_TIME_ZONE_SQL).expect("UTC was set");
        let first_data_position = position_of("SELECT VERSION()").expect("version read");
        assert!(utc_position < first_data_position, "{statements:?}");
        let dump_statements = [
            "SHOW CREATE TABLE `app`.`flags`",
            "SELECT * FROM `app`.`flags`",
        ];
        let sent_every_dump_statement = dump_statements
            .iter()
            .all(|dump_statement| position_of(dump_statement).is_some());
        assert!(sent_every_dump_statement, "{statements:?}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dump_header_and_footer_carry_the_time_zone_lines() {
        let server = MockMySqlServer::start_script(flags_steps()).await;
        let dir = tempfile::tempdir().expect("temp dir");
        let target = dir.path().join("zones.sql");
        let progress = run_flags_dump(&server, &target).await;
        assert_eq!(progress.status, DumpJobStatus::Completed, "{progress:?}");

        let dump = std::fs::read_to_string(&target).expect("dump file");
        let header_end = dump.find("USE `app`;").expect("database section");
        let header = &dump[..header_end];
        assert!(header.contains("/*!40101 SET NAMES utf8mb4 */;\n/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;\n/*!40103 SET TIME_ZONE='+00:00' */;\n"), "{header}");
        let footer = &dump[header_end..];
        assert!(footer.ends_with("/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;\n/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;\n"), "{footer}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dump_writes_a_tinyint_one_value_of_seven_unquoted() {
        let server = MockMySqlServer::start_script(flags_steps()).await;
        let dir = tempfile::tempdir().expect("temp dir");
        let target = dir.path().join("tinyint.sql");
        let progress = run_flags_dump(&server, &target).await;
        assert_eq!(progress.status, DumpJobStatus::Completed, "{progress:?}");

        let dump = std::fs::read_to_string(&target).expect("dump file");
        assert!(
            dump.contains("INSERT INTO `flags` (`flag`) VALUES\n(7);"),
            "{dump}"
        );
    }
}
