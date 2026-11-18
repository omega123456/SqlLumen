use crate::common;
use sqllumen_lib::mysql::pool::SslSettings;

use sqllumen_lib::commands::session::select_database_impl;
use sqllumen_lib::commands::session::set_test_select_database_hook;
use sqllumen_lib::credentials;
use sqllumen_lib::mysql::pool::{set_test_pool_factory, BackgroundPool, ConnectionParams};
use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
use sqllumen_lib::state::AppState;
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

static SELECT_DATABASE_HOOK_LOCK: Mutex<()> = Mutex::new(());
static POOL_FACTORY_LOCK: Mutex<()> = Mutex::new(());

fn retrieve_password_prefix() -> String {
    format!(
        "Failed to retrieve password in {}:",
        credentials::secure_storage_display_name()
    )
}

fn dummy_pool() -> BackgroundPool {
    common::mock_session::unreachable_pool()
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
                ssl: SslSettings::default(),
                connect_timeout_secs: 10,
                keepalive_interval_secs: 0,
                session_password: None,
            },
            read_only: false,
        },
    );
}

fn register_connection_with_password(state: &AppState, connection_id: &str, profile_id: &str) {
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
                keychain_ref: Some(profile_id.to_string()),
                default_database: Some("ecommerce_db".to_string()),
                ssl: SslSettings::default(),
                connect_timeout_secs: 10,
                keepalive_interval_secs: 0,
                session_password: None,
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
    factory: fn(&ConnectionParams) -> Result<BackgroundPool, String>,
) -> PoolFactoryGuard {
    let guard = POOL_FACTORY_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    set_test_pool_factory(Some(factory));
    PoolFactoryGuard { _guard: guard }
}

fn forced_pool_success(_: &ConnectionParams) -> Result<BackgroundPool, String> {
    Ok(dummy_pool())
}

fn forced_pool_error(_: &ConnectionParams) -> Result<BackgroundPool, String> {
    Err("connecting to MySQL timed out after 1 s".to_string())
}

#[tokio::test]
async fn select_database_updates_registry_default_database() {
    let state = test_state();
    register_connection(&state, "conn-1");

    let _guard = install_test_hook();

    select_database_impl(
        &state,
        &sqllumen_lib::commands::session::SelectDatabaseRequest {
            connection_id: "conn-1".to_string(),
            database_name: "analytics_db".to_string(),
        },
    )
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

    let err = select_database_impl(
        &state,
        &sqllumen_lib::commands::session::SelectDatabaseRequest {
            connection_id: "missing".to_string(),
            database_name: "analytics_db".to_string(),
        },
    )
    .await
    .expect_err("missing connection should error");
    assert!(err.contains("not found"));
}

#[tokio::test]
async fn select_database_rejects_empty_database_name() {
    let state = test_state();
    register_connection(&state, "conn-1");

    let err = select_database_impl(
        &state,
        &sqllumen_lib::commands::session::SelectDatabaseRequest {
            connection_id: "conn-1".to_string(),
            database_name: "".to_string(),
        },
    )
    .await
    .expect_err("empty database should error");
    assert!(err.contains("empty"));
}

#[tokio::test]
async fn select_database_hook_errors_do_not_update_registry_default_database() {
    let state = test_state();
    register_connection(&state, "conn-1");

    let _guard = install_failing_test_hook();

    let err = select_database_impl(
        &state,
        &sqllumen_lib::commands::session::SelectDatabaseRequest {
            connection_id: "conn-1".to_string(),
            database_name: "analytics_db".to_string(),
        },
    )
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
    register_connection_with_password(&state, "conn-1", "profile-select-success");
    sqllumen_lib::credentials::store_password("profile-select-success", "secret")
        .expect("password should be stored");

    select_database_impl(
        &state,
        &sqllumen_lib::commands::session::SelectDatabaseRequest {
            connection_id: "conn-1".to_string(),
            database_name: "analytics_db".to_string(),
        },
    )
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
    register_connection_with_password(&state, "conn-1", "profile-select-failure");
    sqllumen_lib::credentials::store_password("profile-select-failure", "secret")
        .expect("password should be stored");

    let err = select_database_impl(
        &state,
        &sqllumen_lib::commands::session::SelectDatabaseRequest {
            connection_id: "conn-1".to_string(),
            database_name: "analytics_db".to_string(),
        },
    )
    .await
    .expect_err("pool error should surface");
    assert!(err.contains("Failed to select database 'analytics_db'"));

    let params = state
        .registry
        .get_connection_params("conn-1")
        .expect("connection params should exist");
    assert_eq!(params.default_database.as_deref(), Some("ecommerce_db"));
}

#[tokio::test]
async fn select_database_errors_when_password_lookup_fails() {
    let _guard = common::fake_credentials::isolate_fake_keychain();
    let state = test_state();
    register_connection_with_password(&state, "conn-1", "profile-select-failure");
    common::fake_credentials::queue_fake_credential_error("missing secret");

    let err = select_database_impl(
        &state,
        &sqllumen_lib::commands::session::SelectDatabaseRequest {
            connection_id: "conn-1".to_string(),
            database_name: "analytics_db".to_string(),
        },
    )
    .await
    .expect_err("password lookup failure should be surfaced");
    assert!(err.contains(&retrieve_password_prefix()));

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

#[cfg(not(coverage))]
mod pool_swap {
    use super::*;
    use crate::common::mock_mysql_server::{MockMySqlServer, MockQueryKind};
    use crate::common::mock_session::{
        mock_connection_params, mock_pool, register_mock_connection,
    };
    use sqllumen_lib::mysql::health::attempt_reconnect_once_for_test;
    use sqllumen_lib::mysql::logged_query::{fetch_first, LoggedStatement};

    const SWAP_CONNECTION_ID: &str = "conn-swap";

    async fn open_mock_connection() -> (MockMySqlServer, AppState) {
        let server = MockMySqlServer::start_script(vec![]).await;
        let state = test_state();
        let params = mock_connection_params(SWAP_CONNECTION_ID, server.port);
        register_mock_connection(&state, mock_pool(server.port), params);
        (server, state)
    }

    async fn checkout_from_current_pool(state: &AppState) -> mysql_async::Conn {
        state
            .registry
            .get_pool(SWAP_CONNECTION_ID)
            .expect("pool registered")
            .checkout()
            .await
            .expect("checkout from the current pool")
    }

    async fn run_probe(conn: &mut mysql_async::Conn) {
        fetch_first(conn, LoggedStatement::text("SELECT 1"))
            .await
            .expect("the held checkout still runs queries");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn select_database_swaps_in_a_new_pool_while_an_old_checkout_keeps_working() {
        set_test_pool_factory(None);
        let (server, state) = open_mock_connection().await;
        let mut old_checkout = checkout_from_current_pool(&state).await;

        select_database_impl(
            &state,
            &sqllumen_lib::commands::session::SelectDatabaseRequest {
                connection_id: SWAP_CONNECTION_ID.to_string(),
                database_name: "analytics_db".to_string(),
            },
        )
        .await
        .expect("select database succeeds");

        run_probe(&mut old_checkout).await;
        let new_pool_connected_with_database = server
            .recorded_queries()
            .iter()
            .any(|query| query.kind == MockQueryKind::InitDb && query.sql == "USE analytics_db");
        assert!(
            new_pool_connected_with_database,
            "{:?}",
            server.recorded_queries()
        );
        let params = state
            .registry
            .get_connection_params(SWAP_CONNECTION_ID)
            .expect("connection params");
        assert_eq!(params.default_database.as_deref(), Some("analytics_db"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn health_reconnect_swaps_in_a_new_pool_while_an_old_checkout_keeps_working() {
        set_test_pool_factory(None);
        let (server, state) = open_mock_connection().await;
        let mut old_checkout = checkout_from_current_pool(&state).await;
        let connections_before = server.connection_count();

        attempt_reconnect_once_for_test(&state, SWAP_CONNECTION_ID)
            .await
            .expect("reconnect succeeds");

        run_probe(&mut old_checkout).await;
        assert!(server.connection_count() > connections_before);
        let mut new_checkout = checkout_from_current_pool(&state).await;
        run_probe(&mut new_checkout).await;
    }
}
