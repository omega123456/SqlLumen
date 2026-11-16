//! `list_copyable_objects_impl` against the in-process mock MySQL server.

use opensrv_mysql::ErrorKind;
use sqllumen_lib::commands::copy_to_host::list_copyable_objects_impl;
use sqllumen_lib::commands::requests::DatabaseRequest;

use crate::common;
use crate::common::mock_mysql_server::{MockCell, MockMySqlServer, MockQueryStep};
use crate::common::mock_session::{integer_column, mock_pool, register_mock_pool, text_column};

const CONNECTION_ID: &str = "conn-copy";
const TABLES_QUERY: &str = "SELECT TABLE_NAME, TABLE_TYPE, CAST(TABLE_ROWS AS SIGNED) AS TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME";
#[cfg(not(coverage))]
const ROUTINES_QUERY: &str = "SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') ORDER BY ROUTINE_NAME";
#[cfg(not(coverage))]
const TRIGGERS_QUERY: &str = "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND TRIGGER_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') ORDER BY TRIGGER_NAME";
#[cfg(not(coverage))]
const EVENTS_QUERY: &str = "SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? AND EVENT_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') ORDER BY EVENT_NAME";

fn tables_step() -> MockQueryStep {
    MockQueryStep::with_rows(
        TABLES_QUERY,
        vec![
            text_column("TABLE_NAME"),
            text_column("TABLE_TYPE"),
            integer_column("TABLE_ROWS"),
        ],
        vec![vec![
            MockCell::Bytes(b"orders"),
            MockCell::Bytes(b"BASE TABLE"),
            MockCell::I64(12),
        ]],
    )
}

#[cfg(not(coverage))]
fn routines_step() -> MockQueryStep {
    MockQueryStep::with_rows(
        ROUTINES_QUERY,
        vec![text_column("ROUTINE_NAME"), text_column("ROUTINE_TYPE")],
        vec![
            vec![MockCell::Bytes(b"archive"), MockCell::Bytes(b"PROCEDURE")],
            vec![MockCell::Bytes(b"total"), MockCell::Bytes(b"FUNCTION")],
        ],
    )
}

#[cfg(not(coverage))]
fn single_name_step(
    query: &'static str,
    column: &'static str,
    name: &'static [u8],
) -> MockQueryStep {
    MockQueryStep::with_rows(
        query,
        vec![text_column(column)],
        vec![vec![MockCell::Bytes(name)]],
    )
}

fn database_request(database: &str) -> DatabaseRequest {
    DatabaseRequest {
        connection_id: CONNECTION_ID.to_string(),
        database: database.to_string(),
    }
}

#[cfg(not(coverage))]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn listing_collects_tables_routines_triggers_and_events() {
    let server = MockMySqlServer::start_script(vec![
        tables_step(),
        routines_step(),
        single_name_step(TRIGGERS_QUERY, "TRIGGER_NAME", b"audit_orders"),
        single_name_step(EVENTS_QUERY, "EVENT_NAME", b"nightly"),
    ])
    .await;
    let state = common::test_app_state();
    register_mock_pool(&state, CONNECTION_ID, mock_pool(server.port));

    let objects = list_copyable_objects_impl(&state, &database_request("app"))
        .await
        .expect("listing succeeds");

    assert_eq!(objects.tables.len(), 1);
    assert_eq!(objects.tables[0].name, "orders");
    assert_eq!(objects.procedures, vec!["archive".to_string()]);
    assert_eq!(objects.functions, vec!["total".to_string()]);
    assert_eq!(objects.triggers, vec!["audit_orders".to_string()]);
    assert_eq!(objects.events, vec!["nightly".to_string()]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failing_query_names_the_object_kind() {
    let failing_tables = MockQueryStep {
        error: Some((ErrorKind::ER_DBACCESS_DENIED_ERROR, b"denied")),
        ..tables_step()
    };
    let server = MockMySqlServer::start_script(vec![failing_tables]).await;
    let state = common::test_app_state();
    register_mock_pool(&state, CONNECTION_ID, mock_pool(server.port));

    let error = list_copyable_objects_impl(&state, &database_request("app"))
        .await
        .expect_err("listing fails");

    assert!(error.contains("Failed to list tables"), "{error}");
}

#[tokio::test]
async fn system_schemas_and_unknown_connections_are_refused() {
    let state = common::test_app_state();

    let system_error = list_copyable_objects_impl(&state, &database_request("mysql"))
        .await
        .expect_err("system schema");
    let missing_error = list_copyable_objects_impl(&state, &database_request("app"))
        .await
        .expect_err("unknown connection");

    assert!(system_error.contains("system schema"));
    assert!(missing_error.contains("not found in registry"));
}
