//! Table data pages stored as result-cache slots (`fetch_table_page`): the stored
//! slot, window reads, cell updates and row removal on a table slot, the guards
//! that keep query-only commands off table pages, and slot replacement ordering.

use std::collections::HashMap;

use serde_json::{Value, json};
use sqllumen_lib::commands::export::{ExportResultsRequest, export_results_impl};
use sqllumen_lib::commands::requests::ConnectionTabRequest;
use sqllumen_lib::export::result_export::validate_full_export;
use sqllumen_lib::export::{ExportFormat, ExportOptions};
use sqllumen_lib::mysql::query_executor::{
    StoredResult, StoredResultOrigin, UpdateResultCellRequest, evict_results_impl,
    reexecute_single_result_impl, update_result_cell_impl,
};
use sqllumen_lib::mysql::result_cache::{CacheKey, VersionedValue};
use sqllumen_lib::mysql::result_view::{
    FetchResultWindowRequest, RemoveResultRowsRequest, ResultSlotKey, SetResultViewRequest,
    TABLE_PAGE_REFUSED_MESSAGE, fetch_result_window_impl, remove_result_rows_impl,
    set_result_view_impl,
};
use sqllumen_lib::mysql::table_data::{
    PrimaryKeyInfo, TABLE_PAGE_RESULT_INDEX, TableDataColumnMeta, TableDataResponse,
    TablePageSlotSource, clamp_table_page_size, table_page_stored_result,
};
use sqllumen_lib::state::AppState;

use crate::common;
use crate::common::mock_session::{register_mock_pool, unreachable_pool};

const CONN: &str = "conn-table";
const TAB: &str = "table-tab-1";
const QUERY_ID: &str = "table-page-q1";

fn table_column(name: &str, data_type: &str) -> TableDataColumnMeta {
    TableDataColumnMeta {
        name: name.to_string(),
        data_type: data_type.to_string(),
        is_boolean_alias: false,
        enum_values: None,
        set_values: None,
        is_nullable: true,
        is_primary_key: name == "id",
        is_unique_key: false,
        has_default: false,
        column_default: None,
        is_binary: data_type == "blob",
        is_auto_increment: false,
        is_generated: false,
    }
}

fn users_page() -> TableDataResponse {
    TableDataResponse {
        columns: vec![
            table_column("id", "int"),
            table_column("name", "varchar"),
            table_column("avatar", "blob"),
        ],
        rows: common::shared_rows(vec![
            vec![json!(1), json!("Ada"), json!("[BLOB - 4 KB]")],
            vec![json!(2), json!("Linus"), Value::Null],
        ]),
        current_page: 1,
        page_size: 50,
        primary_key: Some(PrimaryKeyInfo {
            key_columns: vec!["id".to_string()],
            has_auto_increment: true,
            is_unique_key_fallback: false,
        }),
        execution_time_ms: 3,
    }
}

fn stored_users_page(row_ceiling: usize) -> StoredResult {
    table_page_stored_result(TablePageSlotSource {
        response: &users_page(),
        query_id: QUERY_ID.to_string(),
        row_ceiling,
    })
}

fn state_with_table_page() -> AppState {
    let state = common::test_app_state();
    state
        .result_cache
        .insert(CacheKey::new(CONN, TAB), vec![stored_users_page(1_000)]);
    state
}

fn table_slot_key() -> ResultSlotKey {
    ResultSlotKey {
        connection_id: CONN.to_string(),
        tab_id: TAB.to_string(),
        result_index: TABLE_PAGE_RESULT_INDEX,
        query_id: QUERY_ID.to_string(),
    }
}

fn window_rows(state: &AppState, view_version: u64) -> Vec<Vec<Value>> {
    let window = fetch_result_window_impl(
        state,
        &FetchResultWindowRequest {
            slot: table_slot_key(),
            view_version,
            offset: 0,
            limit: 10,
        },
    )
    .expect("window over the table slot");
    window.rows.iter().map(|row| row.to_vec()).collect()
}

#[test]
fn a_table_page_slot_keeps_the_page_rows_and_serves_windows() {
    let response = users_page();
    let stored = table_page_stored_result(TablePageSlotSource {
        response: &response,
        query_id: QUERY_ID.to_string(),
        row_ceiling: 1_000,
    });
    assert_eq!(stored.origin, StoredResultOrigin::TablePage);
    assert_eq!(stored.row_ceiling, 1_000);
    assert_eq!(stored.columns[2].name, "avatar");
    assert!(
        std::sync::Arc::ptr_eq(&response.rows, &stored.rows),
        "the page moves into the slot without a copy"
    );

    let state = state_with_table_page();
    assert_eq!(
        window_rows(&state, 1),
        vec![
            vec![json!(1), json!("Ada"), json!("[BLOB - 4 KB]")],
            vec![json!(2), json!("Linus"), Value::Null],
        ]
    );
}

#[test]
fn cell_updates_and_row_removal_apply_to_a_table_slot() {
    let state = state_with_table_page();
    let mut updates = HashMap::new();
    updates.insert(1, json!("Grace"));
    update_result_cell_impl(
        &state,
        UpdateResultCellRequest {
            connection_id: CONN.to_string(),
            tab_id: TAB.to_string(),
            row_index: 0,
            updates,
            result_index: Some(TABLE_PAGE_RESULT_INDEX),
            query_id: QUERY_ID.to_string(),
        },
    )
    .expect("cell update on a table slot");

    let removed = remove_result_rows_impl(
        &state,
        &RemoveResultRowsRequest {
            slot: table_slot_key(),
            base_view_version: 1,
            base_indices: vec![1],
        },
    )
    .expect("row removal on a table slot");
    assert_eq!(removed.view_row_count, 1);
    assert_eq!(
        window_rows(&state, removed.view_version),
        vec![vec![json!(1), json!("Grace"), json!("[BLOB - 4 KB]")]]
    );
}

#[tokio::test]
async fn query_only_commands_refuse_a_table_page_slot() {
    let state = state_with_table_page();
    register_mock_pool(&state, CONN, unreachable_pool());

    let view = set_result_view_impl(
        &state,
        &SetResultViewRequest {
            slot: table_slot_key(),
            base_view_version: 1,
            view_spec: Default::default(),
        },
    );
    assert_eq!(view.err().as_deref(), Some(TABLE_PAGE_REFUSED_MESSAGE));

    let export = export_results_impl(
        &state,
        ExportResultsRequest {
            connection_id: CONN.to_string(),
            tab_id: TAB.to_string(),
            options: ExportOptions {
                format: ExportFormat::Csv,
                file_path: std::env::temp_dir()
                    .join("sqllumen-table-page-export.csv")
                    .display()
                    .to_string(),
                include_headers: true,
                table_name: None,
            },
            result_index: Some(TABLE_PAGE_RESULT_INDEX),
        },
    );
    assert_eq!(export.err().as_deref(), Some(TABLE_PAGE_REFUSED_MESSAGE));

    let full_export = validate_full_export(&state, &table_slot_key());
    assert_eq!(
        full_export.err().as_deref(),
        Some(TABLE_PAGE_REFUSED_MESSAGE)
    );

    let rerun = reexecute_single_result_impl(
        &state,
        &sqllumen_lib::mysql::query_executor::ReexecuteSingleResultRequest {
            connection_id: CONN.to_string(),
            tab_id: TAB.to_string(),
            result_index: TABLE_PAGE_RESULT_INDEX,
            sql: "SELECT 1".to_string(),
            row_limit: None,
            view_spec: None,
        },
    )
    .await;
    assert_eq!(rerun.err().as_deref(), Some(TABLE_PAGE_REFUSED_MESSAGE));
}

#[test]
fn a_late_table_page_is_refused_after_the_slot_was_evicted() {
    let state = common::test_app_state();
    let captured = state.result_cache.begin_slot_replacement(CONN, TAB);
    evict_results_impl(
        &state,
        &ConnectionTabRequest {
            connection_id: CONN.to_string(),
            tab_id: TAB.to_string(),
        },
    );
    let write = VersionedValue {
        expected_invalidation_version: captured,
        value: vec![stored_users_page(1_000)],
    };
    assert!(
        !state
            .result_cache
            .insert_if_current(CacheKey::new(CONN, TAB), write)
    );
    assert!(!state.result_cache.get(CONN, TAB).is_available());
}

#[test]
fn the_table_page_size_is_clamped_to_the_row_ceiling() {
    assert_eq!(clamp_table_page_size(5_000, 1_000), 1_000);
    assert_eq!(clamp_table_page_size(500, 1_000), 500);
    assert_eq!(clamp_table_page_size(500, usize::MAX), 500);
}

#[cfg(not(coverage))]
mod page_fetch {
    use super::*;
    use crate::common::blob_step_helpers::connect_mock_pool;
    use crate::common::mock_mysql_server::{
        MockCell, MockColumnDef, MockMySqlServer, MockQueryStep,
    };
    use crate::common::table_page_steps::{
        info_schema_columns_step, nullable_column_row, primary_key_step,
    };
    use opensrv_mysql::{ColumnFlags, ColumnType};
    use sqllumen_lib::commands::table_data::{
        TABLE_PAGE_SUPERSEDED_MESSAGE, fetch_table_page_impl,
    };
    use sqllumen_lib::mysql::table_data::FetchTableDataRequest;

    const BINARY_KEY: &[u8] = &[
        0x12, 0x34, 0x56, 0x78, 0x90, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0xba, 0x09, 0x87, 0x65, 0x43,
        0x21,
    ];

    fn binary_key_columns_step() -> MockQueryStep {
        info_schema_columns_step(vec![
            vec![
                MockCell::Bytes(b"uuid"),
                MockCell::Bytes(b"binary"),
                MockCell::Bytes(b"binary(16)"),
                MockCell::Bytes(b"NO"),
                MockCell::Bytes(b"PRI"),
                MockCell::Null,
                MockCell::Bytes(b""),
            ],
            nullable_column_row(b"avatar", b"blob", b"blob"),
        ])
    }

    fn binary_key_page_step(query: &'static str) -> MockQueryStep {
        MockQueryStep::with_rows(
            query,
            vec![
                MockColumnDef {
                    name: "uuid",
                    coltype: ColumnType::MYSQL_TYPE_BLOB,
                    colflags: ColumnFlags::BINARY_FLAG | ColumnFlags::PRI_KEY_FLAG,
                },
                MockColumnDef {
                    name: "avatar",
                    coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                    colflags: ColumnFlags::UNSIGNED_FLAG,
                },
            ],
            vec![vec![MockCell::Bytes(BINARY_KEY), MockCell::U64(4096)]],
        )
    }

    fn page_request(page_size: u32) -> FetchTableDataRequest {
        FetchTableDataRequest {
            connection_id: CONN.to_string(),
            tab_id: TAB.to_string(),
            database: "app_db".to_string(),
            table: "assets".to_string(),
            page: 1,
            page_size,
            sort_column: None,
            sort_direction: None,
            filter_model: None,
        }
    }

    async fn state_with_mock_table(page_query: &'static str) -> (AppState, MockMySqlServer) {
        let server = MockMySqlServer::start_script(vec![
            binary_key_columns_step(),
            primary_key_step(b"uuid"),
            binary_key_page_step(page_query),
        ])
        .await;
        let state = common::test_app_state();
        register_mock_pool(&state, CONN, connect_mock_pool(&server).await);
        (state, server)
    }

    fn expected_page_row() -> Vec<Value> {
        vec![
            json!("0x1234567890ABCDEFFEDCBA0987654321"),
            json!("[BLOB - 4 KB]"),
        ]
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_page_stores_placeholder_and_binary_key_cells_unchanged() {
        let (state, _server) = state_with_mock_table(
            "SELECT `uuid`, OCTET_LENGTH(`avatar`) AS `avatar` FROM `app_db`.`assets` LIMIT 50 OFFSET 0",
        )
        .await;
        let page = fetch_table_page_impl(&state, page_request(50))
            .await
            .expect("table page");
        assert_eq!(page.page_size, 50);
        assert_eq!(page.view_row_count, 1);
        assert_eq!(page.total_rows, 1);
        assert_eq!(page.first_window.rows[0].to_vec(), expected_page_row());
        assert_eq!(page.primary_key.expect("key").key_columns, vec!["uuid"]);

        let entry = state
            .result_cache
            .get(CONN, TAB)
            .into_entry()
            .expect("slot");
        let stored = &entry.value[TABLE_PAGE_RESULT_INDEX];
        assert_eq!(stored.query_id, page.query_id);
        assert!(stored.is_table_page());
        assert_eq!(stored.rows[0].to_vec(), expected_page_row());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_table_page_clamps_the_page_size_to_the_row_ceiling() {
        let (state, _server) = state_with_mock_table(
            "SELECT `uuid`, OCTET_LENGTH(`avatar`) AS `avatar` FROM `app_db`.`assets` LIMIT 1000 OFFSET 0",
        )
        .await;
        state.result_cache.set_row_ceiling(1_000);
        let page = fetch_table_page_impl(&state, page_request(5_000))
            .await
            .expect("clamped page");
        assert_eq!(page.page_size, 1_000);
        assert_eq!(page.row_ceiling, 1_000);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_overlapped_earlier_page_fetch_is_refused_and_the_later_one_is_kept() {
        let (state, _server) = state_with_mock_table(
            "SELECT `uuid`, OCTET_LENGTH(`avatar`) AS `avatar` FROM `app_db`.`assets` LIMIT 50 OFFSET 0",
        )
        .await;
        let (earlier, later) = tokio::join!(
            fetch_table_page_impl(&state, page_request(50)),
            fetch_table_page_impl(&state, page_request(50))
        );
        assert_eq!(
            earlier.err().as_deref(),
            Some(TABLE_PAGE_SUPERSEDED_MESSAGE)
        );
        let later = later.expect("later page is stored");
        let entry = state
            .result_cache
            .get(CONN, TAB)
            .into_entry()
            .expect("slot");
        assert_eq!(
            entry.value[TABLE_PAGE_RESULT_INDEX].query_id,
            later.query_id
        );
    }
}
