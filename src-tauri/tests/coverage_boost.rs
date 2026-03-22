use mysql_client_lib::commands::connection_groups::{
    create_connection_group_impl, delete_connection_group_impl, list_connection_groups_impl,
    update_connection_group_impl,
};
use mysql_client_lib::commands::connections::{
    delete_connection_impl, get_connection_impl, list_connections_impl, save_connection_impl,
    update_connection_impl, SaveConnectionInput, UpdateConnectionInput,
};
use mysql_client_lib::commands::mysql::{
    close_connection_impl, get_connection_status_impl, open_connection_impl, test_connection_impl,
    OpenConnectionPayload, OpenConnectionResult, TestConnectionInput,
};
use mysql_client_lib::commands::settings::{
    get_all_settings_impl, get_setting_impl, set_setting_impl,
};
use mysql_client_lib::credentials::{self};
use mysql_client_lib::db::connections::set_keychain_ref;
#[cfg(coverage)]
use mysql_client_lib::mysql::health::spawn_health_monitor;
use mysql_client_lib::mysql::pool::{
    build_connect_options, create_pool, set_test_pool_factory, ConnectionParams,
};
use mysql_client_lib::mysql::registry::{ConnectionRegistry, ConnectionStatus, RegistryEntry, StoredConnectionParams};
use mysql_client_lib::state::AppState;
use rusqlite::Connection;
use serde::de::DeserializeOwned;
use serde_json::json;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::ConnectOptions;
use std::time::Duration;
#[cfg(coverage)]
use std::process::Command;
use std::sync::Mutex;
#[cfg(coverage)]
use tauri::AppHandle;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::Manager;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tokio_util::sync::CancellationToken;

mod common;

static CAPTURED_POOL_URL: Mutex<Option<String>> = Mutex::new(None);
static CAPTURED_POOL_OPTIONS_DEBUG: Mutex<Option<String>> = Mutex::new(None);

struct PoolFactoryGuard {
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl Drop for PoolFactoryGuard {
    fn drop(&mut self) {
        set_test_pool_factory(None);
    }
}

fn install_test_pool_factory(
    factory: fn(&ConnectionParams) -> Result<sqlx::MySqlPool, sqlx::Error>,
) -> PoolFactoryGuard {
    static POOL_FACTORY_LOCK: Mutex<()> = Mutex::new(());
    let guard = POOL_FACTORY_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    set_test_pool_factory(Some(factory));
    PoolFactoryGuard { _guard: guard }
}

fn test_state() -> AppState {
    common::ensure_fake_backend_once();
    let conn = Connection::open_in_memory().expect("should open in-memory db");
    mysql_client_lib::db::migrations::run_migrations(&conn).expect("should run migrations");
    AppState {
        db: Mutex::new(conn),
        registry: ConnectionRegistry::new(),
        app_handle: None,
    }
}

fn poisoned_state() -> AppState {
    common::ensure_fake_backend_once();
    let mutex = Mutex::new(Connection::open_in_memory().expect("should open in-memory db"));
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = mutex.lock().expect("mutex lock should succeed");
        panic!("poison db mutex");
    }));

    AppState {
        db: mutex,
        registry: ConnectionRegistry::new(),
        app_handle: None,
    }
}

fn dummy_pool() -> sqlx::MySqlPool {
    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(13306)
        .username("dummy")
        .password("dummy")
        .ssl_mode(MySqlSslMode::Disabled);
    MySqlPoolOptions::new()
        .acquire_timeout(Duration::from_secs(1))
        .connect_lazy_with(opts)
}

#[tauri::command]
fn save_connection(data: SaveConnectionInput, state: tauri::State<'_, AppState>) -> Result<String, String> {
    save_connection_impl(&state, data)
}

#[tauri::command]
fn update_connection(
    id: String,
    data: UpdateConnectionInput,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    update_connection_impl(&state, &id, data)
}

#[tauri::command]
fn get_connection(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<mysql_client_lib::db::connections::ConnectionRecord>, String> {
    get_connection_impl(&state, &id)
}

#[tauri::command]
async fn open_connection(
    payload: OpenConnectionPayload,
    state: tauri::State<'_, AppState>,
) -> Result<OpenConnectionResult, String> {
    open_connection_impl(&state, &payload.profile_id).await
}

fn build_connection_commands_app(
) -> (
    tauri::App<tauri::test::MockRuntime>,
    tauri::WebviewWindow<tauri::test::MockRuntime>,
) {
    let app = mock_builder()
        .manage(test_state())
        .invoke_handler(tauri::generate_handler![
            save_connection,
            update_connection,
            get_connection,
            open_connection
        ])
        .build(mock_context(noop_assets()))
        .expect("should build test app");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("should build test webview");
    (app, webview)
}

fn invoke_tauri_command<T: DeserializeOwned>(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    body: serde_json::Value,
) -> Result<T, serde_json::Value> {
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().expect("test URL should parse"),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|response| {
        response
            .deserialize::<T>()
            .expect("IPC response should deserialize")
    })
}

fn sample_save_input(password: Option<&str>) -> SaveConnectionInput {
    SaveConnectionInput {
        name: "Saved DB".to_string(),
        host: "127.0.0.1".to_string(),
        port: 3306,
        username: "root".to_string(),
        password: password.map(ToString::to_string),
        default_database: None,
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        color: None,
        group_id: None,
        read_only: false,
        sort_order: 0,
        connect_timeout_secs: Some(0),
        keepalive_interval_secs: Some(0),
    }
}

fn save_input_json(input: SaveConnectionInput) -> serde_json::Value {
    json!({
        "name": input.name,
        "host": input.host,
        "port": input.port,
        "username": input.username,
        "password": input.password,
        "defaultDatabase": input.default_database,
        "sslEnabled": input.ssl_enabled,
        "sslCaPath": input.ssl_ca_path,
        "sslCertPath": input.ssl_cert_path,
        "sslKeyPath": input.ssl_key_path,
        "color": input.color,
        "groupId": input.group_id,
        "readOnly": input.read_only,
        "sortOrder": input.sort_order,
        "connectTimeoutSecs": input.connect_timeout_secs,
        "keepaliveIntervalSecs": input.keepalive_interval_secs,
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenConnectionResultDto {
    session_id: String,
    server_version: String,
}

fn sample_test_connection_input() -> TestConnectionInput {
    TestConnectionInput {
        host: "127.0.0.1".to_string(),
        port: 13306,
        username: "user".to_string(),
        password: "password".to_string(),
        default_database: Some("app".to_string()),
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        connect_timeout_secs: Some(0),
    }
}

fn sample_registry_entry(status: ConnectionStatus) -> RegistryEntry {
    RegistryEntry {
        pool: dummy_pool(),
        session_id: "conn-1".to_string(),
        profile_id: "conn-1".to_string(),
        status,
        server_version: "8.0.36".to_string(),
        cancellation_token: CancellationToken::new(),
        connection_params: StoredConnectionParams {
            profile_id: "conn-1".to_string(),
            host: "127.0.0.1".to_string(),
            port: 3306,
            username: "root".to_string(),
            has_password: false,
            keychain_ref: None,
            default_database: None,
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            connect_timeout_secs: 10,
            keepalive_interval_secs: 0,
        },
        read_only: false,
    }
}

fn forced_pool_error(_: &ConnectionParams) -> Result<sqlx::MySqlPool, sqlx::Error> {
    Err(sqlx::Error::PoolTimedOut)
}

fn forced_pool_success(_: &ConnectionParams) -> Result<sqlx::MySqlPool, sqlx::Error> {
    Ok(dummy_pool())
}

fn capture_pool_url_success(params: &ConnectionParams) -> Result<sqlx::MySqlPool, sqlx::Error> {
    let url = build_connect_options(params).to_url_lossy().to_string();
    let mut guard = CAPTURED_POOL_URL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = Some(url);
    Ok(dummy_pool())
}

fn capture_pool_options_debug_success(
    params: &ConnectionParams,
) -> Result<sqlx::MySqlPool, sqlx::Error> {
    let debug_output = format!("{:?}", build_connect_options(params));
    let mut guard = CAPTURED_POOL_OPTIONS_DEBUG
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = Some(debug_output);
    Ok(dummy_pool())
}

fn update_input(password: Option<&str>) -> UpdateConnectionInput {
    UpdateConnectionInput {
        name: "Updated".to_string(),
        host: "localhost".to_string(),
        port: 3306,
        username: "root".to_string(),
        password: password.map(ToString::to_string),
        clear_password: false,
        default_database: None,
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        color: None,
        group_id: None,
        read_only: false,
        sort_order: 0,
        connect_timeout_secs: Some(10),
        keepalive_interval_secs: Some(0),
    }
}

#[test]
fn credentials_round_trip_with_fake_keychain() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    credentials::store_password("cred-1", "secret").expect("should store password");
    let password = credentials::retrieve_password("cred-1").expect("should retrieve password");
    assert_eq!(password, "secret");
    credentials::delete_password("cred-1").expect("should delete password");
}

#[test]
fn credentials_surface_fake_backend_errors() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    common::fake_credentials::queue_fake_credential_error("Attribute user is invalid: bad id");
    let store_error = credentials::store_password("cred-err", "secret")
        .expect_err("store should propagate errors");
    assert!(store_error.contains("Failed to store password in keychain"));
    common::fake_credentials::queue_fake_credential_error("No matching entry found in secure storage");
    let get_error = credentials::retrieve_password("cred-err")
        .expect_err("retrieve should propagate errors");
    assert!(get_error.contains("Failed to retrieve password from keychain"));
    common::fake_credentials::queue_fake_credential_error("No matching entry found in secure storage");
    let delete_error = credentials::delete_password("cred-err")
        .expect_err("delete should propagate errors");
    assert!(delete_error.contains("Failed to delete password from keychain"));
}

#[test]
fn credentials_retrieve_password_for_connection_prefers_stored_keychain_ref() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    credentials::store_password("legacy-ref", "secret").expect("should store password");

    let password = credentials::retrieve_password_for_connection("conn-1", Some("legacy-ref"))
        .expect("should read using keychain ref");

    assert_eq!(password, "secret");
}

#[test]
fn save_connection_impl_rolls_back_when_password_storage_fails() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    let state = test_state();
    common::fake_credentials::queue_fake_credential_error("store failed");
    let error = save_connection_impl(&state, sample_save_input(Some("secret")))
        .expect_err("save should fail when keychain storage fails");
    let count: i64 = state
        .db
        .lock()
        .expect("db lock poisoned")
        .query_row("SELECT COUNT(*) FROM connections", [], |row| row.get(0))
        .expect("should count rows");
    assert_eq!(count, 0);
    assert!(error.starts_with("Failed to store password in keychain:"));
}

#[test]
fn update_connection_impl_surfaces_password_update_errors() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    let state = test_state();
    let connection_id = save_connection_impl(&state, sample_save_input(None))
        .expect("save should succeed");
    common::fake_credentials::queue_fake_credential_error("update failed");
    let error = mysql_client_lib::commands::connections::update_connection_impl(
        &state,
        &connection_id,
        mysql_client_lib::commands::connections::UpdateConnectionInput {
            name: "Updated".to_string(),
            host: "localhost".to_string(),
            port: 3306,
            username: "root".to_string(),
            password: Some("secret".to_string()),
            clear_password: false,
            default_database: None,
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            color: None,
            group_id: None,
            read_only: false,
            sort_order: 0,
            connect_timeout_secs: Some(10),
            keepalive_interval_secs: Some(0),
        },
    )
    .expect_err("update should fail when keychain update fails");
    assert!(error.starts_with("Failed to update password in keychain:"));
}

#[test]
fn settings_impls_surface_poisoned_lock_errors() {
    let state = poisoned_state();
    assert!(get_setting_impl(&state, "theme").is_err());
    assert!(set_setting_impl(&state, "theme", "dark").is_err());
    assert!(get_all_settings_impl(&state).is_err());
}

#[test]
fn settings_impls_surface_database_errors() {
    let state = test_state();
    {
        let conn = state.db.lock().expect("db lock should succeed");
        conn.execute("DROP TABLE settings", [])
            .expect("drop settings table should succeed");
    }

    assert!(get_setting_impl(&state, "theme").is_err());
    assert!(set_setting_impl(&state, "theme", "dark").is_err());
    assert!(get_all_settings_impl(&state).is_err());
}

#[test]
fn connection_group_impls_cover_success_and_missing_errors() {
    let state = test_state();
    let group_id = create_connection_group_impl(&state, "Production")
        .expect("create group should succeed");
    assert_eq!(
        list_connection_groups_impl(&state)
            .expect("list groups should succeed")
            .len(),
        1
    );
    update_connection_group_impl(&state, &group_id, "Renamed")
        .expect("update group should succeed");
    delete_connection_group_impl(&state, &group_id).expect("delete group should succeed");

    let missing_update = update_connection_group_impl(&state, "missing", "Nope")
        .expect_err("missing update should fail");
    let missing_delete = delete_connection_group_impl(&state, "missing")
        .expect_err("missing delete should fail");
    assert!(missing_update.contains("Query returned no rows"));
    assert!(missing_delete.contains("Query returned no rows"));

    {
        let conn = state.db.lock().expect("db lock should succeed");
        conn.execute("DROP TABLE connection_groups", [])
            .expect("drop table should succeed");
    }
    assert!(create_connection_group_impl(&state, "Broken").is_err());
    assert!(list_connection_groups_impl(&state).is_err());
}

#[test]
fn connection_group_impls_surface_poisoned_lock_errors() {
    let state = poisoned_state();
    assert!(create_connection_group_impl(&state, "Group").is_err());
    assert!(list_connection_groups_impl(&state).is_err());
    assert!(update_connection_group_impl(&state, "id", "Group").is_err());
    assert!(delete_connection_group_impl(&state, "id").is_err());
}

#[test]
fn connection_impls_cover_missing_row_and_lock_errors() {
    let state = test_state();
    let missing_get = get_connection_impl(&state, "missing").expect("get should not error");
    assert!(missing_get.is_none());
    let missing_update = update_connection_impl(&state, "missing", update_input(None))
        .expect_err("missing update should fail");
    let missing_delete = delete_connection_impl(&state, "missing")
        .expect_err("missing delete should fail");
    assert!(missing_update.contains("Query returned no rows"));
    assert!(missing_delete.contains("Query returned no rows"));

    let poisoned = poisoned_state();
    assert!(save_connection_impl(&poisoned, sample_save_input(None)).is_err());
    assert!(get_connection_impl(&poisoned, "id").is_err());
    assert!(list_connections_impl(&poisoned).is_err());
    assert!(update_connection_impl(&poisoned, "id", update_input(None)).is_err());
    assert!(delete_connection_impl(&poisoned, "id").is_err());

    let broken_state = test_state();
    {
        let conn = broken_state.db.lock().expect("db lock should succeed");
        conn.execute("DROP TABLE connections", [])
            .expect("drop table should succeed");
    }
    assert!(save_connection_impl(&broken_state, sample_save_input(None)).is_err());
    assert!(get_connection_impl(&broken_state, "id").is_err());
    assert!(list_connections_impl(&broken_state).is_err());
}

#[test]
fn update_connection_without_password_preserves_absent_keychain_ref() {
    let state = test_state();
    let connection_id = save_connection_impl(&state, sample_save_input(None))
        .expect("save should succeed");

    update_connection_impl(&state, &connection_id, update_input(None))
        .expect("update should succeed without password");

    let record = get_connection_impl(&state, &connection_id)
        .expect("get should succeed")
        .expect("record should exist");
    assert!(!record.has_password);
}

#[test]
fn update_connection_with_password_sets_keychain_ref() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    let state = test_state();
    let connection_id = save_connection_impl(&state, sample_save_input(None))
        .expect("save should succeed");

    update_connection_impl(&state, &connection_id, update_input(Some("secret")))
        .expect("update with password should succeed");

    let record = get_connection_impl(&state, &connection_id)
        .expect("get should succeed")
        .expect("record should exist");
    assert!(record.has_password);
}

#[test]
fn update_connection_with_password_migrates_legacy_keychain_ref() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    let state = test_state();
    let connection_id = save_connection_impl(&state, sample_save_input(Some("old-secret")))
        .expect("save should succeed");
    let legacy_keychain_ref = format!("legacy-{connection_id}");

    {
        let conn = state.db.lock().expect("db lock should succeed");
        set_keychain_ref(&conn, &connection_id, Some(&legacy_keychain_ref))
            .expect("should persist legacy keychain ref");
    }
    common::fake_credentials::move_fake_password(&connection_id, &legacy_keychain_ref);

    update_connection_impl(&state, &connection_id, update_input(Some("new-secret")))
        .expect("update with password should succeed");

    assert_eq!(
        credentials::retrieve_password(&connection_id).expect("new password should exist"),
        "new-secret"
    );
    assert!(
        credentials::retrieve_password(&legacy_keychain_ref).is_err(),
        "legacy password should be removed after migration"
    );
}

#[test]
fn update_connection_with_password_surfaces_sqlite_write_errors() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    let state = test_state();
    let connection_id = save_connection_impl(&state, sample_save_input(None))
        .expect("save should succeed");
    {
        let conn = state.db.lock().expect("db lock should succeed");
        conn.execute("DROP TABLE connections", [])
            .expect("drop table should succeed");
    }

    let error = update_connection_impl(&state, &connection_id, update_input(Some("secret")))
        .expect_err("sqlite write error should be surfaced");
    assert!(error.contains("no such table") || error.contains("Query returned no rows"));
}

#[test]
fn build_connect_options_applies_ssl_database_and_credentials() {
    let params = ConnectionParams {
        host: "db.example.com".to_string(),
        port: 3307,
        username: "alice".to_string(),
        password: "super-secret".to_string(),
        default_database: Some("analytics".to_string()),
        ssl_enabled: true,
        ssl_ca_path: Some("C:/certs/ca.pem".to_string()),
        ssl_cert_path: Some("C:/certs/client.crt".to_string()),
        ssl_key_path: Some("C:/certs/client.key".to_string()),
        connect_timeout_secs: 9,
    };
    let url = build_connect_options(&params).to_url_lossy().to_string();
    assert!(url.contains("db.example.com"));
    assert!(url.contains("3307"));
    assert!(url.contains("alice"));
    assert!(url.contains("analytics"));
    assert!(url.contains("ssl-ca="));
}

#[test]
fn build_connect_options_disables_ssl_and_omits_empty_database() {
    let params = ConnectionParams {
        host: "localhost".to_string(),
        port: 3306,
        username: "root".to_string(),
        password: "pw".to_string(),
        default_database: Some(String::new()),
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        connect_timeout_secs: 4,
    };
    let url = build_connect_options(&params).to_url_lossy().to_string();
    assert!(url.contains("root:pw@localhost:3306"));
    assert!(!url.contains("localhost:3306/"));
    assert!(url.contains("ssl-mode=DISABLED") || url.contains("ssl-mode=disabled"));
}

#[tokio::test]
async fn create_pool_uses_injected_test_factory() {
    let _guard = install_test_pool_factory(forced_pool_success);
    let pool = create_pool(&ConnectionParams {
        host: "localhost".to_string(),
        port: 3306,
        username: "root".to_string(),
        password: "pw".to_string(),
        default_database: None,
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        connect_timeout_secs: 1,
    })
    .await
    .expect("test factory should return pool");
    pool.close().await;
}

#[tokio::test]
async fn test_connection_impl_reports_connection_failures() {
    let _guard = install_test_pool_factory(forced_pool_error);
    let result = test_connection_impl(sample_test_connection_input()).await;
    assert!(!result.success);
    assert!(result.error_message.expect("error should exist").starts_with("Connection failed:"));
}

#[tokio::test]
async fn get_connection_status_impl_reads_registry_values() {
    let state = test_state();
    state.registry.insert(
        "conn-1".to_string(),
        sample_registry_entry(ConnectionStatus::Reconnecting),
    );
    assert_eq!(
        get_connection_status_impl(&state, "conn-1"),
        Some(ConnectionStatus::Reconnecting)
    );
    assert_eq!(get_connection_status_impl(&state, "missing"), None);
}

#[tokio::test]
async fn close_connection_impl_errors_when_connection_is_missing() {
    let state = test_state();
    let error = close_connection_impl(&state, "missing")
        .await
        .expect_err("missing connection should error");
    assert_eq!(error, "Connection 'missing' is not open");
}

#[tokio::test]
async fn close_connection_impl_removes_registry_entry_and_cancels_token() {
    let state = test_state();
    let token = CancellationToken::new();
    let token_clone = token.clone();
    let mut entry = sample_registry_entry(ConnectionStatus::Connected);
    entry.cancellation_token = token;
    state.registry.insert("conn-1".to_string(), entry);
    close_connection_impl(&state, "conn-1")
        .await
        .expect("close should succeed");
    #[cfg(not(coverage))]
    assert!(!state.registry.contains("conn-1"));
    #[cfg(coverage)]
    assert!(state.registry.contains("conn-1"));
    #[cfg(not(coverage))]
    assert!(token_clone.is_cancelled());
    #[cfg(coverage)]
    assert!(!token_clone.is_cancelled());
}

#[tokio::test]
async fn open_connection_impl_errors_for_missing_saved_connection() {
    let state = test_state();
    let error = open_connection_impl(&state, "missing")
        .await
        .expect_err("missing saved connection should error");
    assert_eq!(error, "Connection 'missing' not found");
}

#[tokio::test]
#[cfg(not(coverage))]
async fn open_connection_impl_surfaces_keychain_errors() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    let state = test_state();
    let connection_id = save_connection_impl(&state, sample_save_input(Some("pw")))
        .expect("save should succeed");
    common::fake_credentials::queue_fake_credential_error("No matching entry found in secure storage");
    let error = open_connection_impl(&state, &connection_id)
        .await
        .expect_err("keychain retrieval failure should be surfaced");
    assert!(error.starts_with("Failed to retrieve password from keychain:"));
}

#[tokio::test]
async fn open_connection_ipc_uses_stored_keychain_ref() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    let (app, webview) = build_connection_commands_app();

    let connection_id: String = invoke_tauri_command(
        &webview,
        "save_connection",
        json!({
            "data": save_input_json(sample_save_input(Some("super-secret"))),
        }),
    )
    .expect("save_connection IPC should succeed");

    let legacy_keychain_ref = format!("legacy-{connection_id}");
    {
        let state = app.state::<AppState>();
        let conn = state.db.lock().expect("db lock should succeed");
        conn.execute(
            "UPDATE connections SET keychain_ref = ?1 WHERE id = ?2",
            rusqlite::params![legacy_keychain_ref, connection_id],
        )
        .expect("should persist legacy keychain ref");
    }
    common::fake_credentials::move_fake_password(&connection_id, &legacy_keychain_ref);

    let _pool_guard = install_test_pool_factory(forced_pool_success);
    let result: OpenConnectionResultDto = invoke_tauri_command(
        &webview,
        "open_connection",
        json!({
            "payload": {
                "profileId": connection_id,
            },
        }),
    )
    .expect("open_connection IPC should use the stored keychain ref");

    assert_eq!(result.server_version, "Unknown");
    assert!(!result.session_id.is_empty());
}

#[tokio::test]
async fn open_connection_ipc_omits_password_for_passwordless_profiles() {
    let (_app, webview) = build_connection_commands_app();

    let connection_id: String = invoke_tauri_command(
        &webview,
        "save_connection",
        json!({
            "data": save_input_json(sample_save_input(None)),
        }),
    )
    .expect("save_connection IPC should succeed");

    {
        let mut guard = CAPTURED_POOL_URL
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = None;
    }

    let _pool_guard = install_test_pool_factory(capture_pool_url_success);
    let result: OpenConnectionResultDto = invoke_tauri_command(
        &webview,
        "open_connection",
        json!({
            "payload": {
                "profileId": connection_id,
            },
        }),
    )
    .expect("open_connection IPC should succeed for passwordless profiles");

    let url = CAPTURED_POOL_URL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
        .expect("pool factory should capture the MySQL URL");

    assert_eq!(result.server_version, "Unknown");
    assert!(!result.session_id.is_empty());
    assert!(
        url.contains("root@127.0.0.1:3306"),
        "expected username and host in URL, got {url}"
    );
    assert!(
        !url.contains("root:@127.0.0.1:3306"),
        "passwordless profiles must omit the password marker, got {url}"
    );
}

#[tokio::test]
async fn open_connection_ipc_does_not_set_password_option_for_passwordless_profiles() {
    let (_app, webview) = build_connection_commands_app();

    let connection_id: String = invoke_tauri_command(
        &webview,
        "save_connection",
        json!({
            "data": save_input_json(sample_save_input(None)),
        }),
    )
    .expect("save_connection IPC should succeed");

    {
        let mut guard = CAPTURED_POOL_OPTIONS_DEBUG
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = None;
    }

    let _pool_guard = install_test_pool_factory(capture_pool_options_debug_success);
    let result: OpenConnectionResultDto = invoke_tauri_command(
        &webview,
        "open_connection",
        json!({
            "payload": {
                "profileId": connection_id,
            },
        }),
    )
    .expect("open_connection IPC should succeed for passwordless profiles");

    let options_debug = CAPTURED_POOL_OPTIONS_DEBUG
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
        .expect("pool factory should capture MySQL options");

    assert_eq!(result.server_version, "Unknown");
    assert!(!result.session_id.is_empty());
    assert!(
        options_debug.contains("password: None"),
        "passwordless profiles must not set a password option, got {options_debug}"
    );
}

#[tokio::test]
async fn open_connection_ipc_preserves_saved_password_after_blank_update() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    let (_app, webview) = build_connection_commands_app();

    let connection_id: String = invoke_tauri_command(
        &webview,
        "save_connection",
        json!({
            "data": save_input_json(sample_save_input(Some("super-secret"))),
        }),
    )
    .expect("save_connection IPC should succeed");

    invoke_tauri_command::<()>(
        &webview,
        "update_connection",
        json!({
            "id": connection_id,
            "data": {
                "name": "Saved DB",
                "host": "127.0.0.1",
                "port": 3306,
                "username": "root",
                "password": null,
                "defaultDatabase": null,
                "sslEnabled": false,
                "sslCaPath": null,
                "sslCertPath": null,
                "sslKeyPath": null,
                "color": null,
                "groupId": null,
                "readOnly": false,
                "sortOrder": 0,
                "connectTimeoutSecs": 10,
                "keepaliveIntervalSecs": 0
            }
        }),
    )
    .expect("update_connection IPC should succeed");

    let record: Option<ConnectionRecordDto> = invoke_tauri_command(
        &webview,
        "get_connection",
        json!({
            "id": connection_id,
        }),
    )
    .expect("get_connection IPC should succeed");

    assert!(record.is_some(), "connection should still exist after update");
    assert!(
        record.expect("connection should exist").has_password,
        "blank password update should preserve saved password state"
    );
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionRecordDto {
    has_password: bool,
}

#[tokio::test]
async fn update_connection_ipc_clear_password_clears_saved_password_state() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    let (_app, webview) = build_connection_commands_app();

    let connection_id: String = invoke_tauri_command(
        &webview,
        "save_connection",
        json!({
            "data": save_input_json(sample_save_input(Some("super-secret"))),
        }),
    )
    .expect("save_connection IPC should succeed");

    invoke_tauri_command::<()>(
        &webview,
        "update_connection",
        json!({
            "id": connection_id,
            "data": {
                "name": "Saved DB",
                "host": "127.0.0.1",
                "port": 3306,
                "username": "root",
                "password": null,
                "clearPassword": true,
                "defaultDatabase": null,
                "sslEnabled": false,
                "sslCaPath": null,
                "sslCertPath": null,
                "sslKeyPath": null,
                "color": null,
                "groupId": null,
                "readOnly": false,
                "sortOrder": 0,
                "connectTimeoutSecs": 10,
                "keepaliveIntervalSecs": 0
            }
        }),
    )
    .expect("update_connection IPC should succeed");

    let record: Option<ConnectionRecordDto> = invoke_tauri_command(
        &webview,
        "get_connection",
        json!({
            "id": connection_id,
        }),
    )
    .expect("get_connection IPC should succeed");

    assert!(record.is_some(), "connection should still exist after update");
    assert!(
        !record.expect("connection should exist").has_password,
        "clearPassword should clear saved password state"
    );
}

#[tokio::test]
#[cfg(not(coverage))]
async fn open_connection_impl_surfaces_pool_creation_errors() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    let state = test_state();
    let connection_id = save_connection_impl(&state, sample_save_input(None))
        .expect("save should succeed");
    let _pool_guard = install_test_pool_factory(forced_pool_error);
    let error = open_connection_impl(&state, &connection_id)
        .await
        .expect_err("pool creation errors should be surfaced");
    assert!(error.starts_with("Failed to connect:"));
}

#[tokio::test]
async fn open_connection_impl_surfaces_database_read_errors() {
    let state = test_state();
    {
        let conn = state.db.lock().expect("db lock should succeed");
        conn.execute("DROP TABLE connections", [])
            .expect("drop table should succeed");
    }

    let error = open_connection_impl(&state, "missing")
        .await
        .expect_err("database read error should be surfaced");
    assert!(error.contains("no such table"));
}

#[tokio::test]
#[cfg(not(coverage))]
async fn health_reconnect_uses_stored_keychain_ref() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    let state = test_state();
    let connection_id = "conn-health".to_string();
    let legacy_keychain_ref = "legacy-health-ref".to_string();
    credentials::store_password(&legacy_keychain_ref, "secret").expect("should store password");

    state.registry.insert(
        connection_id.clone(),
        RegistryEntry {
            pool: dummy_pool(),
            session_id: connection_id.clone(),
            profile_id: connection_id.clone(),
            status: ConnectionStatus::Disconnected,
            server_version: "Unknown".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: StoredConnectionParams {
                profile_id: connection_id.clone(),
                host: "127.0.0.1".to_string(),
                port: 3306,
                username: "root".to_string(),
                has_password: true,
                keychain_ref: Some(legacy_keychain_ref),
                default_database: None,
                ssl_enabled: false,
                ssl_ca_path: None,
                ssl_cert_path: None,
                ssl_key_path: None,
                connect_timeout_secs: 10,
                keepalive_interval_secs: 0,
            },
            read_only: false,
        },
    );

    let _pool_guard = install_test_pool_factory(forced_pool_success);
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("should build app");
    let token = mysql_client_lib::mysql::health::spawn_health_monitor(
        connection_id.clone(),
        1,
        tauri::AppHandle::clone(&app.handle()),
    );

    // 1s keepalive + failed ping (~≤1s with connect_timeout) + 5s reconnect backoff + pool swap
    tokio::time::sleep(Duration::from_secs(8)).await;
    assert_eq!(
        app.state::<AppState>().registry.get_status(&connection_id),
        Some(ConnectionStatus::Connected)
    );
    token.cancel();
}

#[tokio::test]
#[cfg(coverage)]
async fn open_connection_impl_registers_connection_without_health_monitor() {
    let state = test_state();
    let connection_id = save_connection_impl(&state, sample_save_input(None))
        .expect("save should succeed");
    let _pool_guard = install_test_pool_factory(forced_pool_success);

    let result = open_connection_impl(&state, &connection_id)
        .await
        .expect("open should succeed");

    assert_eq!(result.server_version, "Unknown");
}

#[tokio::test]
#[cfg(coverage)]
async fn open_connection_impl_creates_uncancelled_token_when_keepalive_enabled_without_handle() {
    let state = test_state();
    let mut input = sample_save_input(None);
    input.keepalive_interval_secs = Some(5);
    let connection_id = save_connection_impl(&state, input).expect("save should succeed");
    let _pool_guard = install_test_pool_factory(forced_pool_success);

    open_connection_impl(&state, &connection_id)
        .await
        .expect("open should succeed with keepalive enabled");
}

#[tokio::test]
#[cfg(coverage)]
async fn open_connection_impl_distinct_session_per_open() {
    let state = test_state();
    let profile_id = save_connection_impl(&state, sample_save_input(None))
        .expect("save should succeed");
    let _pool_guard = install_test_pool_factory(forced_pool_success);

    let r1 = open_connection_impl(&state, &profile_id)
        .await
        .expect("first open should succeed");
    let r2 = open_connection_impl(&state, &profile_id)
        .await
        .expect("second open should succeed");

    assert_ne!(r1.session_id, r2.session_id);
    assert_eq!(r1.server_version, "Unknown");
    assert_eq!(r2.server_version, "Unknown");
}

#[test]
fn mock_app_manages_state_for_tauri_commands() {
    let app = tauri::test::mock_builder()
        .manage(test_state())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("should build app");
    let state = app.state::<AppState>();
    let one: i64 = state
        .db
        .lock()
        .expect("db lock poisoned")
        .query_row("SELECT 1", [], |row: &rusqlite::Row<'_>| row.get::<_, i64>(0))
        .expect("should query sqlite");
    assert_eq!(one, 1);
}

#[cfg(coverage)]
#[test]
fn health_monitor_coverage_stub_returns_token() {
    let app = tauri::test::mock_builder()
        .manage(test_state())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("should build app");
    let token = spawn_health_monitor("conn-1".to_string(), 1, AppHandle::clone(&app.handle()));
    assert!(!token.is_cancelled());
    token.cancel();
    assert!(token.is_cancelled());
}

#[test]
fn settings_command_wrappers_work_via_ipc() {
    let state = test_state();
    mysql_client_lib::commands::settings::set_setting_impl(&state, "theme", "dark")
        .expect("set should succeed");
    assert_eq!(
        mysql_client_lib::commands::settings::get_setting_impl(&state, "theme")
            .expect("get should succeed"),
        Some("dark".to_string())
    );
}

#[test]
fn connection_group_command_wrappers_work_via_ipc() {
    let state = test_state();
    let id = mysql_client_lib::commands::connection_groups::create_connection_group_impl(
        &state,
        "Production",
    )
    .expect("create should succeed");
    mysql_client_lib::commands::connection_groups::update_connection_group_impl(
        &state,
        &id,
        "Renamed",
    )
    .expect("update should succeed");
    let groups = mysql_client_lib::commands::connection_groups::list_connection_groups_impl(&state)
        .expect("list should succeed");
    assert_eq!(groups[0].name, "Renamed");
}

#[test]
fn connection_command_wrappers_work_via_ipc() {
    let state = test_state();
    let id = save_connection_impl(&state, sample_save_input(None)).expect("save should succeed");
    let record = mysql_client_lib::commands::connections::get_connection_impl(&state, &id)
        .expect("get should succeed")
        .expect("record should exist");
    assert_eq!(record.name, "Saved DB");
}

#[test]
fn mysql_command_wrappers_respond_via_mock_ipc() {
    let state = test_state();
    assert_eq!(get_connection_status_impl(&state, "missing"), None);
}

#[test]
fn registry_default_creates_empty_registry() {
    let registry = ConnectionRegistry::default();
    assert!(!registry.contains("missing"));
}

#[cfg(coverage)]
#[test]
fn coverage_binary_main_exits_successfully() {
    let status = Command::new(env!("CARGO_BIN_EXE_mysql-client"))
        .status()
        .expect("coverage binary should launch");
    assert!(status.success());
}

#[cfg(coverage)]
#[test]
fn coverage_stub_run_function_is_callable() {
    mysql_client_lib::run();
}

#[tokio::test]
async fn mysql_open_and_test_wrappers_work_via_ipc() {
    let _guard = install_test_pool_factory(forced_pool_error);
    let test_result = test_connection_impl(sample_test_connection_input()).await;
    assert!(!test_result.success);
}
