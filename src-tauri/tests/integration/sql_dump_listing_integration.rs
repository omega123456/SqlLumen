//! `list_exportable_objects_impl` against the in-process mock MySQL server.

use opensrv_mysql::ErrorKind;
use sqllumen_lib::commands::sql_dump::{list_exportable_objects_impl, DumpObjectType};

use crate::common;
use crate::common::mock_mysql_server::{MockCell, MockMySqlServer, MockQueryStep};
use crate::common::mock_session::{integer_column, mock_pool, register_mock_pool, text_column};

const EXPORTABLE_OBJECTS_QUERY: &str = "SELECT s.SCHEMA_NAME, t.TABLE_NAME, t.TABLE_TYPE, t.TABLE_ROWS FROM information_schema.SCHEMATA s LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME WHERE s.SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') ORDER BY s.SCHEMA_NAME, t.TABLE_NAME";

fn exportable_row(schema: &'static [u8], table: MockCell, table_type: MockCell) -> Vec<MockCell> {
    vec![MockCell::Bytes(schema), table, table_type, MockCell::I64(7)]
}

fn exportable_objects_step() -> MockQueryStep {
    MockQueryStep::with_rows(
        EXPORTABLE_OBJECTS_QUERY,
        vec![
            text_column("SCHEMA_NAME"),
            text_column("TABLE_NAME"),
            text_column("TABLE_TYPE"),
            integer_column("TABLE_ROWS"),
        ],
        vec![
            exportable_row(
                b"app",
                MockCell::Bytes(b"orders"),
                MockCell::Bytes(b"BASE TABLE"),
            ),
            exportable_row(
                b"app",
                MockCell::Bytes(b"order_totals"),
                MockCell::Bytes(b"VIEW"),
            ),
            exportable_row(b"empty_db", MockCell::Null, MockCell::Null),
        ],
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn listing_groups_tables_and_views_by_database() {
    let server = MockMySqlServer::start_script(vec![exportable_objects_step()]).await;
    let state = common::test_app_state();
    register_mock_pool(&state, "conn-dump", mock_pool(server.port));

    let databases = list_exportable_objects_impl(&state, "conn-dump")
        .await
        .expect("listing should succeed");

    assert_eq!(databases.len(), 2);
    assert_eq!(databases[0].name, "app");
    assert_eq!(databases[0].tables.len(), 2);
    assert_eq!(databases[0].tables[0].name, "orders");
    assert_eq!(databases[0].tables[0].object_type, DumpObjectType::Table);
    assert_eq!(databases[0].tables[0].estimated_rows, 7);
    assert_eq!(databases[0].tables[1].object_type, DumpObjectType::View);
    assert_eq!(databases[1].name, "empty_db");
    assert!(databases[1].tables.is_empty());
}

#[tokio::test]
async fn listing_rejects_an_unknown_connection() {
    let state = common::test_app_state();
    let error = list_exportable_objects_impl(&state, "missing")
        .await
        .expect_err("unknown connection");
    assert!(error.contains("not found in registry"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn listing_surfaces_query_failures() {
    let failing_listing = MockQueryStep {
        error: Some((ErrorKind::ER_WRONG_VALUE, b"boom")),
        ..exportable_objects_step()
    };
    let server = MockMySqlServer::start_script(vec![failing_listing]).await;
    let state = common::test_app_state();
    register_mock_pool(&state, "conn-dump", mock_pool(server.port));

    let error = list_exportable_objects_impl(&state, "conn-dump")
        .await
        .expect_err("failing listing query");
    assert!(error.contains("Failed to list exportable objects"));
}
