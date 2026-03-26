mod common;

use mysql_client_lib::commands::session::select_database_impl;
use mysql_client_lib::commands::session::set_test_select_database_hook;
use mysql_client_lib::mysql::pool::{set_test_pool_factory, ConnectionParams};
use mysql_client_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
use mysql_client_lib::state::AppState;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

static SELECT_DATABASE_HOOK_LOCK: Mutex<()> = Mutex::new(());
static POOL_FACTORY_LOCK: Mutex<()> = Mutex::new(());

fn dummy_pool() -> sqlx::MySqlPool {
    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(13306)
        .username("dummy")
        .password("dummy");
    MySqlPoolOptions::new().connect_lazy_with(opts)
}

fn test_state() -> AppState {
    common::test_app_state()
}

fn register_connection(state: &AppState, connection_id: &str) {
    state.registry.insert(
        connection_id.to_string(),
        RegistryEntry {
            pool: dummy_pool(),
            session_id: connection_id.to_string(),
            profile_id: "profile-1".to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: StoredConnectionParams {
                profile_id: "profile-1".to_string(),
                host: "127.0.0.1".to_string(),
                port: 13306,
                username: "dummy".to_string(),
                has_password: false,
                keychain_ref: None,
                default_database: Some("ecommerce_db".to_string()),
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
}

fn register_connection_with_password(
    state: &AppState,
    connection_id: &str,
    profile_id: &str,
    keychain_ref: Option<&str>,
) {
    state.registry.insert(
        connection_id.to_string(),
        RegistryEntry {
            pool: dummy_pool(),
            session_id: connection_id.to_string(),
            profile_id: profile_id.to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: StoredConnectionParams {
                profile_id: profile_id.to_string(),
                host: "127.0.0.1".to_string(),
                port: 13306,
                username: "dummy".to_string(),
                has_password: true,
                keychain_ref: keychain_ref.map(ToString::to_string),
                default_database: Some("ecommerce_db".to_string()),
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
}

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
    let guard = POOL_FACTORY_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    set_test_pool_factory(Some(factory));
    PoolFactoryGuard { _guard: guard }
}

fn forced_pool_success(_: &ConnectionParams) -> Result<sqlx::MySqlPool, sqlx::Error> {
    Ok(dummy_pool())
}

fn forced_pool_error(_: &ConnectionParams) -> Result<sqlx::MySqlPool, sqlx::Error> {
    Err(sqlx::Error::PoolTimedOut)
}

#[tokio::test]
async fn select_database_updates_registry_default_database() {
    let state = test_state();
    register_connection(&state, "conn-1");

    let _guard = install_test_hook();

    select_database_impl(&state, "conn-1", "analytics_db")
        .await
        .expect("select database should succeed");

    let params = state
        .registry
        .get_connection_params("conn-1")
        .expect("connection params should exist");
    assert_eq!(params.default_database.as_deref(), Some("analytics_db"));
}

#[tokio::test]
async fn select_database_rejects_missing_connection() {
    let state = test_state();

    let err = select_database_impl(&state, "missing", "analytics_db")
        .await
        .expect_err("missing connection should error");
    assert!(err.contains("not found"));
}

#[tokio::test]
async fn select_database_rejects_empty_database_name() {
    let state = test_state();
    register_connection(&state, "conn-1");

    let err = select_database_impl(&state, "conn-1", "")
        .await
        .expect_err("empty database should error");
    assert!(err.contains("empty"));
}

#[tokio::test]
async fn select_database_hook_errors_do_not_update_registry_default_database() {
    let state = test_state();
    register_connection(&state, "conn-1");

    let _guard = install_failing_test_hook();

    let err = select_database_impl(&state, "conn-1", "analytics_db")
        .await
        .expect_err("hook failure should be surfaced");
    assert!(err.contains("hook failed"));

    let params = state
        .registry
        .get_connection_params("conn-1")
        .expect("connection params should exist");
    assert_eq!(params.default_database.as_deref(), Some("ecommerce_db"));
}

#[tokio::test]
async fn select_database_reconnects_with_password_and_updates_registry_without_hook() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    let _pool_guard = install_test_pool_factory(forced_pool_success);
    let state = test_state();
    register_connection_with_password(&state, "conn-1", "profile-select-success", None);
    mysql_client_lib::credentials::store_password("profile-select-success", "secret")
        .expect("password should be stored");

    select_database_impl(&state, "conn-1", "analytics_db")
        .await
        .expect("select database should succeed");

    let params = state
        .registry
        .get_connection_params("conn-1")
        .expect("connection params should exist");
    assert_eq!(params.default_database.as_deref(), Some("analytics_db"));
}

#[tokio::test]
async fn select_database_surfaces_pool_errors_after_password_lookup() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    let _pool_guard = install_test_pool_factory(forced_pool_error);
    let state = test_state();
    register_connection_with_password(
        &state,
        "conn-1",
        "profile-select-failure",
        Some("legacy-select-ref"),
    );
    mysql_client_lib::credentials::store_password("legacy-select-ref", "secret")
        .expect("password should be stored");

    let err = select_database_impl(&state, "conn-1", "analytics_db")
        .await
        .expect_err("pool error should surface");
    assert!(err.contains("Failed to select database 'analytics_db'"));

    let params = state
        .registry
        .get_connection_params("conn-1")
        .expect("connection params should exist");
    assert_eq!(params.default_database.as_deref(), Some("ecommerce_db"));
}

fn install_test_hook() -> HookGuard {
    let guard = SELECT_DATABASE_HOOK_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    set_test_select_database_hook(Some(|_, _| Ok(())));
    HookGuard { _guard: guard }
}

fn install_failing_test_hook() -> HookGuard {
    let guard = SELECT_DATABASE_HOOK_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    set_test_select_database_hook(Some(|_, _| Err("hook failed".to_string())));
    HookGuard { _guard: guard }
}

struct HookGuard {
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl Drop for HookGuard {
    fn drop(&mut self) {
        set_test_select_database_hook(None);
    }
}
