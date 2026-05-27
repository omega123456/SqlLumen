//! Command-layer settings `_impl` functions (`commands/settings.rs`).

mod common;

use sqllumen_lib::commands::settings::{get_all_settings_impl, get_setting_impl, set_setting_impl};
use sqllumen_lib::mysql::registry::ConnectionRegistry;
use sqllumen_lib::mysql::table_data_cache::TableDataCache;
use sqllumen_lib::state::AppState;
use std::sync::{Arc, Mutex};

#[test]
fn test_get_setting_impl_returns_none_for_missing() {
    let state = common::test_app_state();
    let result = get_setting_impl(&state, "nonexistent").expect("should not error");
    assert_eq!(result, None);
}

#[test]
fn test_set_and_get_setting_impl() {
    let state = common::test_app_state();
    set_setting_impl(&state, "theme", "dark").expect("should set");
    let result = get_setting_impl(&state, "theme").expect("should get");
    assert_eq!(result, Some("dark".to_string()));
}

#[test]
fn test_set_setting_impl_upserts() {
    let state = common::test_app_state();
    set_setting_impl(&state, "theme", "light").expect("should set");
    set_setting_impl(&state, "theme", "dark").expect("should upsert");
    let result = get_setting_impl(&state, "theme").expect("should get");
    assert_eq!(result, Some("dark".to_string()));
}

#[test]
fn test_get_all_settings_impl_empty() {
    let state = common::test_app_state();
    let all = get_all_settings_impl(&state).expect("should get all");
    assert!(all.is_empty());
}

#[test]
fn test_get_all_settings_impl_with_values() {
    let state = common::test_app_state();
    set_setting_impl(&state, "theme", "dark").expect("set theme");
    set_setting_impl(&state, "font", "mono").expect("set font");
    let all = get_all_settings_impl(&state).expect("should get all");
    assert_eq!(all.len(), 2);
    assert_eq!(all.get("theme"), Some(&"dark".to_string()));
    assert_eq!(all.get("font"), Some(&"mono".to_string()));
}

#[test]
fn test_set_setting_impl_handles_log_level_key() {
    let state = common::test_app_state();

    set_setting_impl(
        &state,
        sqllumen_lib::logging::LOG_LEVEL_SETTING_KEY,
        "debug",
    )
    .expect("should set log level");

    let result = get_setting_impl(&state, sqllumen_lib::logging::LOG_LEVEL_SETTING_KEY)
        .expect("should get log level");
    assert_eq!(result, Some("debug".to_string()));
}

#[test]
fn test_settings_impls_surface_poisoned_db_lock_errors() {
    common::ensure_fake_backend_once();
    let poisoned_db = Arc::new(Mutex::new(common::test_db()));
    let poison_handle = Arc::clone(&poisoned_db);

    let join = std::thread::spawn(move || {
        let _guard = poison_handle.lock().expect("poison lock should succeed");
        panic!("poison sqlite mutex");
    });
    assert!(join.join().is_err(), "thread should panic to poison mutex");

    let state = AppState {
        db: poisoned_db,
        registry: ConnectionRegistry::new(),
        app_handle: None,
        result_cache: std::sync::Arc::new(
            sqllumen_lib::mysql::result_cache::ResultCache::new_for_test(
                1800,
                std::env::temp_dir().join("sqllumen-test-settings-results"),
            ),
        ),
        table_data_cache: std::sync::Arc::new(TableDataCache::new_for_test(
            1800,
            std::env::temp_dir().join("sqllumen-test-settings-table-data"),
        )),
        metadata_cache: sqllumen_lib::mysql::metadata_cache::MetadataCache::new(),
        log_filter_reload: Mutex::new(None),
        running_queries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        dump_jobs: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        import_jobs: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        ai_requests: Arc::new(Mutex::new(std::collections::HashMap::new())),
        index_build_tokens: Arc::new(Mutex::new(std::collections::HashMap::new())),
        session_profile_map: Arc::new(Mutex::new(std::collections::HashMap::new())),
        session_ref_counts: Arc::new(Mutex::new(std::collections::HashMap::new())),
        http_client: reqwest::Client::new(),
        embedding_cache: sqllumen_lib::schema_index::embeddings_cache::EmbeddingCache::new(),
    };

    let get_error = get_setting_impl(&state, "theme").expect_err("get should fail");
    assert!(
        get_error.contains("poison"),
        "unexpected error: {get_error}"
    );

    let set_error = set_setting_impl(&state, "theme", "dark").expect_err("set should fail");
    assert!(
        set_error.contains("poison"),
        "unexpected error: {set_error}"
    );

    let get_all_error = get_all_settings_impl(&state).expect_err("get_all should fail");
    assert!(
        get_all_error.contains("poison"),
        "unexpected error: {get_all_error}"
    );
}

#[test]
fn test_set_setting_impl_ignores_poisoned_log_reload_mutex() {
    common::ensure_fake_backend_once();
    let state = AppState {
        db: Arc::new(Mutex::new(common::test_db())),
        registry: ConnectionRegistry::new(),
        app_handle: None,
        result_cache: std::sync::Arc::new(
            sqllumen_lib::mysql::result_cache::ResultCache::new_for_test(
                1800,
                std::env::temp_dir().join("sqllumen-test-settings-results"),
            ),
        ),
        table_data_cache: std::sync::Arc::new(TableDataCache::new_for_test(
            1800,
            std::env::temp_dir().join("sqllumen-test-settings-table-data"),
        )),
        metadata_cache: sqllumen_lib::mysql::metadata_cache::MetadataCache::new(),
        log_filter_reload: Mutex::new(None),
        running_queries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        dump_jobs: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        import_jobs: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        ai_requests: Arc::new(Mutex::new(std::collections::HashMap::new())),
        index_build_tokens: Arc::new(Mutex::new(std::collections::HashMap::new())),
        session_profile_map: Arc::new(Mutex::new(std::collections::HashMap::new())),
        session_ref_counts: Arc::new(Mutex::new(std::collections::HashMap::new())),
        http_client: reqwest::Client::new(),
        embedding_cache: sqllumen_lib::schema_index::embeddings_cache::EmbeddingCache::new(),
    };

    std::thread::scope(|scope| {
        let reload_mutex = &state.log_filter_reload;
        let handle = scope.spawn(move || {
            let _guard = reload_mutex.lock().expect("poison lock should succeed");
            panic!("poison log reload mutex");
        });
        assert!(
            handle.join().is_err(),
            "thread should panic to poison mutex"
        );
    });

    let result = set_setting_impl(&state, sqllumen_lib::logging::LOG_LEVEL_SETTING_KEY, "info");
    assert!(result.is_ok(), "set should ignore poisoned reload path");
}

#[test]
fn test_set_setting_impl_updates_result_cache_ttl() {
    let state = common::test_app_state();

    assert_eq!(state.result_cache.ttl_seconds(), 1800);
    assert_eq!(state.table_data_cache.ttl_seconds(), 1800);

    set_setting_impl(&state, "results.cacheTTL", "900").expect("should set ttl");

    assert_eq!(state.result_cache.ttl_seconds(), 900);
    assert_eq!(state.table_data_cache.ttl_seconds(), 900);
    let persisted = get_setting_impl(&state, "results.cacheTTL").expect("should get ttl");
    assert_eq!(persisted, Some("900".to_string()));
}

#[test]
fn test_set_setting_impl_ignores_unparseable_result_cache_ttl() {
    let state = common::test_app_state();

    assert_eq!(state.result_cache.ttl_seconds(), 1800);
    assert_eq!(state.table_data_cache.ttl_seconds(), 1800);

    set_setting_impl(&state, "results.cacheTTL", "not-a-number")
        .expect("should persist invalid ttl string");

    assert_eq!(state.result_cache.ttl_seconds(), 1800);
    assert_eq!(state.table_data_cache.ttl_seconds(), 1800);
    let persisted = get_setting_impl(&state, "results.cacheTTL").expect("should get ttl");
    assert_eq!(persisted, Some("not-a-number".to_string()));
}
