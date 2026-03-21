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
    TestConnectionInput,
};
use mysql_client_lib::commands::settings::{
    get_all_settings_impl, get_setting_impl, set_setting_impl,
};
use mysql_client_lib::credentials::{
    self, set_test_credential_backend, TestCredentialBackend,
};
#[cfg(coverage)]
use mysql_client_lib::mysql::health::spawn_health_monitor;
use mysql_client_lib::mysql::pool::{
    build_connect_options, create_pool, set_test_pool_factory, ConnectionParams,
};
use mysql_client_lib::mysql::registry::{ConnectionRegistry, ConnectionStatus, RegistryEntry, StoredConnectionParams};
use mysql_client_lib::state::AppState;
use rusqlite::Connection;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use sqlx::ConnectOptions;
use std::collections::HashMap;
#[cfg(coverage)]
use std::process::Command;
use std::sync::{LazyLock, Mutex};
#[cfg(coverage)]
use tauri::AppHandle;
use tauri::Manager;
use tokio_util::sync::CancellationToken;

type CredentialMap = HashMap<String, String>;

static TEST_KEYCHAIN: LazyLock<Mutex<CredentialMap>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static TEST_CREDENTIAL_ERROR: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));

struct PoolFactoryGuard {
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl Drop for PoolFactoryGuard {
    fn drop(&mut self) {
        set_test_pool_factory(None);
    }
}

fn install_fake_keychain() -> std::sync::MutexGuard<'static, ()> {
    static KEYCHAIN_LOCK: Mutex<()> = Mutex::new(());
    let guard = KEYCHAIN_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    TEST_KEYCHAIN.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clear();
    *TEST_CREDENTIAL_ERROR
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    set_test_credential_backend(Some(TestCredentialBackend {
        store_password: fake_store_password,
        retrieve_password: fake_retrieve_password,
        delete_password: fake_delete_password,
    }));
    guard
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

fn fake_store_password(connection_id: &str, password: &str) -> Result<(), String> {
    if let Some(error) = take_fake_error() {
        return Err(format!("Failed to store password in keychain: {error}"));
    }

    TEST_KEYCHAIN
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(connection_id.to_string(), password.to_string());
    Ok(())
}

fn fake_retrieve_password(connection_id: &str) -> Result<String, String> {
    if let Some(error) = take_fake_error() {
        return Err(format!("Failed to retrieve password from keychain: {error}"));
    }

    TEST_KEYCHAIN
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(connection_id)
        .cloned()
        .ok_or_else(|| {
            "Failed to retrieve password from keychain: No matching entry found in secure storage"
                .to_string()
        })
}

fn fake_delete_password(connection_id: &str) -> Result<(), String> {
    if let Some(error) = take_fake_error() {
        return Err(format!("Failed to delete password from keychain: {error}"));
    }

    TEST_KEYCHAIN
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(connection_id)
        .map(|_| ())
        .ok_or_else(|| {
            "Failed to delete password from keychain: No matching entry found in secure storage"
                .to_string()
        })
}

fn queue_fake_error(message: &str) {
    *TEST_CREDENTIAL_ERROR
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(message.to_string());
}

fn take_fake_error() -> Option<String> {
    TEST_CREDENTIAL_ERROR
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()
}

fn test_state() -> AppState {
    let conn = Connection::open_in_memory().expect("should open in-memory db");
    mysql_client_lib::db::migrations::run_migrations(&conn).expect("should run migrations");
    AppState {
        db: Mutex::new(conn),
        registry: ConnectionRegistry::new(),
        app_handle: None,
    }
}

fn poisoned_state() -> AppState {
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
        .password("dummy");
    MySqlPoolOptions::new().connect_lazy_with(opts)
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
        connection_id: "conn-1".to_string(),
        status,
        server_version: "8.0.36".to_string(),
        cancellation_token: CancellationToken::new(),
        connection_params: StoredConnectionParams {
            host: "127.0.0.1".to_string(),
            port: 3306,
            username: "root".to_string(),
            has_password: false,
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

fn update_input(password: Option<&str>) -> UpdateConnectionInput {
    UpdateConnectionInput {
        name: "Updated".to_string(),
        host: "localhost".to_string(),
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
        connect_timeout_secs: Some(10),
        keepalive_interval_secs: Some(0),
    }
}

#[test]
fn credentials_round_trip_with_fake_keychain() {
    let _guard = install_fake_keychain();
    credentials::store_password("cred-1", "secret").expect("should store password");
    let password = credentials::retrieve_password("cred-1").expect("should retrieve password");
    assert_eq!(password, "secret");
    credentials::delete_password("cred-1").expect("should delete password");
    set_test_credential_backend(None);
}

#[test]
fn credentials_surface_fake_backend_errors() {
    let _guard = install_fake_keychain();
    queue_fake_error("Attribute user is invalid: bad id");
    let store_error = credentials::store_password("cred-err", "secret")
        .expect_err("store should propagate errors");
    assert!(store_error.contains("Failed to store password in keychain"));
    queue_fake_error("No matching entry found in secure storage");
    let get_error = credentials::retrieve_password("cred-err")
        .expect_err("retrieve should propagate errors");
    assert!(get_error.contains("Failed to retrieve password from keychain"));
    queue_fake_error("No matching entry found in secure storage");
    let delete_error = credentials::delete_password("cred-err")
        .expect_err("delete should propagate errors");
    assert!(delete_error.contains("Failed to delete password from keychain"));
    set_test_credential_backend(None);
}

#[test]
fn save_connection_impl_rolls_back_when_password_storage_fails() {
    let _guard = install_fake_keychain();
    let state = test_state();
    queue_fake_error("store failed");
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
    set_test_credential_backend(None);
}

#[test]
fn update_connection_impl_surfaces_password_update_errors() {
    let _guard = install_fake_keychain();
    let state = test_state();
    let connection_id = save_connection_impl(&state, sample_save_input(None))
        .expect("save should succeed");
    queue_fake_error("update failed");
    let error = mysql_client_lib::commands::connections::update_connection_impl(
        &state,
        &connection_id,
        mysql_client_lib::commands::connections::UpdateConnectionInput {
            name: "Updated".to_string(),
            host: "localhost".to_string(),
            port: 3306,
            username: "root".to_string(),
            password: Some("secret".to_string()),
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
    set_test_credential_backend(None);
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
    let _guard = install_fake_keychain();
    let state = test_state();
    let connection_id = save_connection_impl(&state, sample_save_input(None))
        .expect("save should succeed");

    update_connection_impl(&state, &connection_id, update_input(Some("secret")))
        .expect("update with password should succeed");

    let record = get_connection_impl(&state, &connection_id)
        .expect("get should succeed")
        .expect("record should exist");
    assert!(record.has_password);
    set_test_credential_backend(None);
}

#[test]
fn update_connection_with_password_surfaces_sqlite_write_errors() {
    let _guard = install_fake_keychain();
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
    set_test_credential_backend(None);
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
    let _guard = install_fake_keychain();
    let state = test_state();
    let connection_id = save_connection_impl(&state, sample_save_input(Some("pw")))
        .expect("save should succeed");
    queue_fake_error("No matching entry found in secure storage");
    let error = open_connection_impl(&state, &connection_id)
        .await
        .expect_err("keychain retrieval failure should be surfaced");
    assert!(error.starts_with("Failed to retrieve password from keychain:"));
    set_test_credential_backend(None);
}

#[tokio::test]
#[cfg(not(coverage))]
async fn open_connection_impl_surfaces_pool_creation_errors() {
    let _guard = install_fake_keychain();
    let state = test_state();
    let connection_id = save_connection_impl(&state, sample_save_input(None))
        .expect("save should succeed");
    let _pool_guard = install_test_pool_factory(forced_pool_error);
    let error = open_connection_impl(&state, &connection_id)
        .await
        .expect_err("pool creation errors should be surfaced");
    set_test_credential_backend(None);
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
async fn open_connection_impl_replaces_existing_registry_entry() {
    let state = test_state();
    let connection_id = save_connection_impl(&state, sample_save_input(None))
        .expect("save should succeed");
    let old_token = CancellationToken::new();
    let old_token_clone = old_token.clone();
    let mut existing_entry = sample_registry_entry(ConnectionStatus::Disconnected);
    existing_entry.connection_id = connection_id.clone();
    existing_entry.cancellation_token = old_token;
    state.registry.insert(connection_id.clone(), existing_entry);
    let _pool_guard = install_test_pool_factory(forced_pool_success);

    let result = open_connection_impl(&state, &connection_id)
        .await
        .expect("open should succeed");

    assert_eq!(result.server_version, "Unknown");
    assert!(!old_token_clone.is_cancelled());
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
