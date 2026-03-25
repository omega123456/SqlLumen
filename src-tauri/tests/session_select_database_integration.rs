mod common;

use mysql_client_lib::commands::session::select_database_impl;
use mysql_client_lib::commands::session::set_test_select_database_hook;
use mysql_client_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
use mysql_client_lib::state::AppState;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

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

fn install_test_hook() -> HookGuard {
    static LOCK: Mutex<()> = Mutex::new(());
    let guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    set_test_select_database_hook(Some(|_, _| Ok(())));
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
