//! `start_sql_dump_impl` end to end against the in-process mock MySQL server:
//! structure, typed row values, views, empty tables and failures.

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

fn typed_column(name: &'static str, coltype: ColumnType, colflags: ColumnFlags) -> MockColumnDef {
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

async fn wait_for_dump(state: &AppState, job_id: &str) -> DumpJobProgress {
    let deadline = Instant::now() + JOB_DEADLINE;
    loop {
        let progress = get_dump_progress_impl(state, job_id).expect("job exists");
        let is_settled = progress.status != DumpJobStatus::Running || Instant::now() >= deadline;
        if is_settled {
            return progress;
        }
        tokio::time::sleep(JOB_POLL_INTERVAL).await;
    }
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

    let job_id = start_sql_dump_impl(&state, dump_input(&target, entries), mock_pool(server.port))
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
