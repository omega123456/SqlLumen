use crate::common;
use serde::de::DeserializeOwned;
use serde_json::json;
use sqllumen_lib::commands::ai_memory::{reembed_all_scopes, search_session_memories};
use sqllumen_lib::commands::sql_dump::{
    start_sql_dump_on_connection, start_sql_import_on_connection,
};
use sqllumen_lib::commands::table_data::{
    delete_table_row_with_history, export_table_data_with_history, fetch_blob_value_on_connection,
    fetch_table_rows, insert_table_row_with_history, update_table_row_with_history,
};
use sqllumen_lib::mysql::pool::SslSettings;
use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
use sqllumen_lib::state::AppState;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

const SESSION_ID: &str = "history-session";
const PROFILE_ID: &str = "history-profile";
const MISSING_SESSION_ID: &str = "missing";
const UNREACHABLE_MYSQL_PORT: u16 = 13306;

fn dummy_lazy_pool() -> sqllumen_lib::mysql::pool::BackgroundPool {
    crate::common::mock_session::unreachable_pool()
}

fn dummy_stored_params() -> StoredConnectionParams {
    StoredConnectionParams {
        profile_id: PROFILE_ID.to_string(),
        host: "127.0.0.1".to_string(),
        port: UNREACHABLE_MYSQL_PORT,
        username: "dummy".to_string(),
        has_password: true,
        keychain_ref: Some("dummy".to_string()),
        default_database: Some("app".to_string()),
        ssl: SslSettings::default(),
        connect_timeout_secs: 10,
        keepalive_interval_secs: 60,
        session_password: None,
    }
}

fn register_session(state: &AppState, read_only: bool) {
    let entry = RegistryEntry {
        pool: dummy_lazy_pool(),
        session_id: SESSION_ID.to_string(),
        profile_id: PROFILE_ID.to_string(),
        status: ConnectionStatus::Connected,
        server_version: "8.0.0".to_string(),
        cancellation_token: CancellationToken::new(),
        connection_params: dummy_stored_params(),
        read_only,
    };
    state.registry.insert(SESSION_ID.to_string(), entry);
}

fn read_only_state() -> AppState {
    let state = common::test_app_state();
    register_session(&state, true);
    state
}

fn request<T: DeserializeOwned>(value: serde_json::Value) -> T {
    serde_json::from_value(value).expect("request JSON should deserialize")
}

fn update_row_request(session_id: &str) -> serde_json::Value {
    json!({
        "connectionId": session_id,
        "database": "app",
        "table": "users",
        "primaryKeyColumns": ["id"],
        "originalPrimaryKeyValues": { "id": 1 },
        "updatedValues": { "name": "Ada" },
    })
}

fn insert_row_request(session_id: &str) -> serde_json::Value {
    json!({
        "connectionId": session_id,
        "database": "app",
        "table": "users",
        "values": { "name": "Ada" },
        "primaryKeyInfo": {
            "keyColumns": ["id"],
            "hasAutoIncrement": true,
            "isUniqueKeyFallback": false,
        },
    })
}

fn delete_row_request(session_id: &str) -> serde_json::Value {
    json!({
        "connectionId": session_id,
        "database": "app",
        "table": "users",
        "primaryKeyColumns": ["id"],
        "primaryKeyValues": { "id": 1 },
    })
}

fn fetch_page_request(session_id: &str, page_size: u32) -> serde_json::Value {
    json!({
        "connectionId": session_id,
        "tabId": "tab-1",
        "database": "app",
        "table": "users",
        "page": 1,
        "pageSize": page_size,
        "sortColumn": "name",
        "sortDirection": "asc",
        "filterModel": [{ "column": "name", "operator": "==", "value": "Ada" }],
    })
}

#[tokio::test]
async fn row_writes_reject_read_only_and_missing_connections() {
    let state = read_only_state();

    let update_request = request(update_row_request(SESSION_ID));
    let update = update_table_row_with_history(&state, &update_request).await;
    assert_eq!(update.unwrap_err(), "Connection is read-only");

    let insert_request = request(insert_row_request(SESSION_ID));
    let insert = insert_table_row_with_history(&state, &insert_request).await;
    assert_eq!(insert.unwrap_err(), "Connection is read-only");

    let delete_request = request(delete_row_request(SESSION_ID));
    let delete = delete_table_row_with_history(&state, &delete_request).await;
    assert_eq!(delete.unwrap_err(), "Connection is read-only");

    let missing_request = request(update_row_request(MISSING_SESSION_ID));
    let missing_update = update_table_row_with_history(&state, &missing_request).await;
    assert_eq!(
        missing_update.unwrap_err(),
        "Connection 'missing' not found"
    );
}

#[tokio::test]
async fn fetch_table_data_validates_page_size_and_connection() {
    let state = common::test_app_state();

    let zero_page = fetch_table_rows(&state, request(fetch_page_request(SESSION_ID, 0)));
    assert_eq!(zero_page.await.unwrap_err(), "page_size must be at least 1");

    let missing = fetch_table_rows(&state, request(fetch_page_request(MISSING_SESSION_ID, 50)));
    assert_eq!(missing.await.unwrap_err(), "Connection 'missing' not found");
}

#[tokio::test]
async fn export_and_blob_reads_require_an_open_connection() {
    let state = common::test_app_state();

    let export_request = request(json!({
        "connectionId": MISSING_SESSION_ID,
        "database": "app",
        "table": "users",
        "format": "csv",
        "filePath": "/tmp/never-written.csv",
        "includeHeaders": true,
        "tableNameForSql": "users",
        "filterModel": null,
        "sortColumn": null,
        "sortDirection": null,
        "page": 2,
        "pageSize": 100,
    }));
    let export = export_table_data_with_history(&state, export_request).await;
    assert_eq!(export.unwrap_err(), "Connection 'missing' not found");

    let blob_request = request(json!({
        "connectionId": MISSING_SESSION_ID,
        "database": "app",
        "table": "users",
        "column": "avatar",
        "primaryKeyPairs": [["id", 1]],
    }));
    let blob = fetch_blob_value_on_connection(&state, &blob_request).await;
    assert_eq!(blob.unwrap_err(), "Connection 'missing' not found");
}

#[tokio::test]
async fn sql_dump_and_import_require_a_writable_open_connection() {
    let state = read_only_state();

    let import_request = request(json!({
        "connectionId": SESSION_ID,
        "filePath": "/tmp/never-read.sql",
        "stopOnError": true,
    }));
    let import = start_sql_import_on_connection(&state, import_request).await;
    assert_eq!(
        import.unwrap_err(),
        "Cannot import SQL on a read-only connection"
    );

    let missing_import_request = request(json!({
        "connectionId": MISSING_SESSION_ID,
        "filePath": "/tmp/never-read.sql",
        "stopOnError": false,
    }));
    let missing_import = start_sql_import_on_connection(&state, missing_import_request).await;
    assert_eq!(
        missing_import.unwrap_err(),
        "Connection 'missing' not found"
    );

    let dump_request = request(json!({
        "connectionId": MISSING_SESSION_ID,
        "filePath": "/tmp/never-written.sql",
        "databases": ["app"],
        "tables": {},
        "options": {
            "includeStructure": true,
            "includeData": true,
            "includeDrop": false,
            "useTransaction": false,
        },
    }));
    let dump = start_sql_dump_on_connection(&state, dump_request).await;
    assert_eq!(dump.unwrap_err(), "Connection 'missing' not found");
}

#[tokio::test]
async fn memory_search_requires_a_known_session() {
    let state = common::test_app_state();
    let search_request = request(json!({
        "sessionId": MISSING_SESSION_ID,
        "query": "orders",
        "limit": 5,
    }));
    assert!(
        search_session_memories(&state, &search_request)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn reembed_all_scopes_reports_progress_for_an_empty_store() {
    let state = common::test_app_state();
    let phases = Arc::new(Mutex::new(Vec::new()));
    let recorded_phases = Arc::clone(&phases);

    reembed_all_scopes(&state, move |progress| {
        recorded_phases.lock().unwrap().push(progress.phase);
    })
    .await
    .expect("re-embedding an empty store should succeed");

    assert_eq!(*phases.lock().unwrap(), vec!["embedding", "done"]);
}

#[cfg(coverage)]
mod coverage_stubs {
    use super::*;
    use sqllumen_lib::commands::object_editor::{
        drop_object_with_history, get_object_body_with_history, save_object_with_history,
    };
    use sqllumen_lib::commands::schema::{
        alter_database_with_history, create_database_with_history, drop_database_with_history,
        drop_table_with_history, get_schema_info_with_history, rename_database_with_history,
        rename_table_with_history, truncate_table_with_history,
    };
    use sqllumen_lib::commands::table_designer::{
        apply_table_ddl_with_history, load_table_for_designer_with_history,
    };
    use std::time::Duration;

    const HISTORY_POLL_ATTEMPTS: usize = 100;
    const HISTORY_POLL_INTERVAL: Duration = Duration::from_millis(10);

    fn writable_state() -> AppState {
        let state = common::test_app_state();
        register_session(&state, false);
        state
    }

    fn logged_history_count(state: &AppState) -> i64 {
        let conn = state.db.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM query_history", [], |row| row.get(0))
            .unwrap()
    }

    async fn wait_for_history_rows(state: &AppState, expected_rows: i64) {
        for _ in 0..HISTORY_POLL_ATTEMPTS {
            if logged_history_count(state) >= expected_rows {
                return;
            }
            tokio::time::sleep(HISTORY_POLL_INTERVAL).await;
        }
        panic!("expected {expected_rows} history rows");
    }

    #[tokio::test]
    async fn schema_wrappers_run_and_log_history() {
        let state = writable_state();
        let encoding = request(json!({
            "connectionId": SESSION_ID,
            "name": "shop",
            "charset": "utf8mb4",
            "collation": "utf8mb4_unicode_ci",
        }));
        create_database_with_history(&state, &encoding)
            .await
            .unwrap();
        alter_database_with_history(&state, &encoding)
            .await
            .unwrap();

        let drop_database = request(json!({ "connectionId": SESSION_ID, "name": "shop" }));
        drop_database_with_history(&state, &drop_database)
            .await
            .unwrap();

        let rename_database = request(json!({
            "connectionId": SESSION_ID,
            "oldName": "shop",
            "newName": "store",
        }));
        rename_database_with_history(&state, &rename_database)
            .await
            .unwrap();

        let table = request(json!({
            "connectionId": SESSION_ID,
            "database": "shop",
            "table": "orders",
        }));
        truncate_table_with_history(&state, &table).await.unwrap();
        drop_table_with_history(&state, &table).await.unwrap();

        let rename_table = request(json!({
            "connectionId": SESSION_ID,
            "database": "shop",
            "oldName": "orders",
            "newName": "purchases",
        }));
        rename_table_with_history(&state, &rename_table)
            .await
            .unwrap();

        let schema_object = request(json!({
            "connectionId": SESSION_ID,
            "database": "shop",
            "objectName": "orders",
            "objectType": "table",
        }));
        get_schema_info_with_history(&state, &schema_object)
            .await
            .unwrap();

        wait_for_history_rows(&state, 10).await;
    }

    #[tokio::test]
    async fn schema_wrappers_return_read_only_errors() {
        let state = read_only_state();
        let drop_database = request(json!({ "connectionId": SESSION_ID, "name": "shop" }));
        assert!(
            drop_database_with_history(&state, &drop_database)
                .await
                .is_err()
        );

        let table = request(json!({
            "connectionId": SESSION_ID,
            "database": "shop",
            "table": "orders",
        }));
        assert!(drop_table_with_history(&state, &table).await.is_err());
    }

    #[tokio::test]
    async fn object_editor_wrappers_run_and_log_history() {
        let state = writable_state();
        let view = request(json!({
            "connectionId": SESSION_ID,
            "database": "shop",
            "objectName": "v",
            "objectType": "view",
        }));
        let body = get_object_body_with_history(&state, &view).await.unwrap();
        assert!(body.contains("VIEW"));
        drop_object_with_history(&state, &view).await.unwrap();

        let save_request = request(json!({
            "connectionId": SESSION_ID,
            "database": "shop",
            "objectName": "v",
            "objectType": "view",
            "body": "CREATE VIEW `v` AS SELECT 1",
            "mode": "create",
        }));
        let saved = save_object_with_history(&state, save_request)
            .await
            .unwrap();
        assert!(saved.success);

        let invalid_request = request(json!({
            "connectionId": SESSION_ID,
            "database": "shop",
            "objectName": "v",
            "objectType": "procedure",
            "body": "CREATE VIEW `v` AS SELECT 1",
            "mode": "create",
        }));
        assert!(
            save_object_with_history(&state, invalid_request)
                .await
                .is_err()
        );

        wait_for_history_rows(&state, 4).await;
    }

    #[tokio::test]
    async fn table_designer_wrappers_run_and_log_history() {
        let state = writable_state();
        let load = request(json!({
            "connectionId": SESSION_ID,
            "database": "shop",
            "tableName": "orders",
        }));
        let schema = load_table_for_designer_with_history(&state, &load)
            .await
            .unwrap();
        assert_eq!(schema.table_name, "orders");

        let apply = request(json!({
            "connectionId": SESSION_ID,
            "database": "shop",
            "ddl": "ALTER TABLE `orders` ADD COLUMN `note` TEXT",
        }));
        apply_table_ddl_with_history(&state, &apply).await.unwrap();

        let empty_ddl = request(json!({
            "connectionId": SESSION_ID,
            "database": "shop",
            "ddl": "  ",
        }));
        assert!(
            apply_table_ddl_with_history(&state, &empty_ddl)
                .await
                .is_err()
        );

        wait_for_history_rows(&state, 3).await;
    }
}
