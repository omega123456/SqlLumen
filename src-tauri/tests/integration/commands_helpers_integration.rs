use crate::common;

use sqllumen_lib::commands::helpers::resolve_session_profile;
use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use tokio_util::sync::CancellationToken;

fn dummy_lazy_pool() -> sqlx::MySqlPool {
    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(13306)
        .username("dummy")
        .password("dummy");
    MySqlPoolOptions::new().connect_lazy_with(opts)
}

fn dummy_stored_params() -> StoredConnectionParams {
    StoredConnectionParams {
        profile_id: "profile-registry".to_string(),
        host: "127.0.0.1".to_string(),
        port: 13306,
        username: "dummy".to_string(),
        has_password: false,
        keychain_ref: None,
        default_database: None,
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        connect_timeout_secs: 10,
        keepalive_interval_secs: 60,
    }
}

#[test]
fn resolve_session_profile_returns_mapping_from_session_profile_map() {
    let state = common::test_app_state();
    state
        .session_profile_map
        .lock()
        .expect("session_profile_map lock")
        .insert("sess-1".to_string(), "profile-1".to_string());

    let resolved = resolve_session_profile(&state, "sess-1").expect("profile should resolve");
    assert_eq!(resolved, "profile-1");
}

#[test]
fn resolve_session_profile_returns_not_found_when_session_missing() {
    let state = common::test_app_state();
    let error = resolve_session_profile(&state, "missing-session").expect_err("must fail");
    assert!(
        error.contains("not found"),
        "expected missing-session error, got: {error}"
    );
}

#[tokio::test]
async fn resolve_session_profile_falls_back_to_registry_profile_id() {
    let state = common::test_app_state();
    state.registry.insert(
        "sess-2".to_string(),
        RegistryEntry {
            pool: dummy_lazy_pool(),
            session_id: "sess-2".to_string(),
            profile_id: "profile-from-registry".to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: dummy_stored_params(),
            read_only: false,
        },
    );

    let resolved = resolve_session_profile(&state, "sess-2").expect("profile should resolve");
    assert_eq!(resolved, "profile-from-registry");
}

#[tokio::test]
async fn resolve_session_profile_ignores_poisoned_map_and_falls_back_to_registry() {
    let state = common::test_app_state();
    state.registry.insert(
        "sess-3".to_string(),
        RegistryEntry {
            pool: dummy_lazy_pool(),
            session_id: "sess-3".to_string(),
            profile_id: "profile-after-poison".to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: dummy_stored_params(),
            read_only: false,
        },
    );

    std::thread::scope(|scope| {
        let map = &state.session_profile_map;
        let handle = scope.spawn(move || {
            let _guard = map.lock().expect("poison lock should succeed");
            panic!("poison session_profile_map");
        });
        assert!(
            handle.join().is_err(),
            "thread should panic to poison mutex"
        );
    });

    let resolved = resolve_session_profile(&state, "sess-3").expect("profile should resolve");
    assert_eq!(resolved, "profile-after-poison");
}
