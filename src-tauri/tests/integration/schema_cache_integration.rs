//! Schema metadata cache snapshot persistence helpers.

use crate::common;

use sqllumen_lib::commands::schema_cache::{
    load_schema_cache_snapshot_impl, save_schema_cache_snapshot_impl,
};
use sqllumen_lib::db::schema_cache;
use sqllumen_lib::mysql::registry::ConnectionRegistry;
use sqllumen_lib::mysql::table_data_cache::TableDataCache;
use sqllumen_lib::state::AppState;
use std::sync::{Arc, Mutex};

fn test_app_state() -> AppState {
    common::test_app_state()
}

#[test]
fn load_schema_cache_snapshot_returns_none_when_missing() {
    let conn = common::test_db();

    let snapshot = schema_cache::load_schema_cache_snapshot(&conn, "missing-profile")
        .expect("load should succeed");

    assert_eq!(snapshot, None);
}

#[test]
fn save_and_load_schema_cache_snapshot_round_trips_json() {
    let conn = common::test_db();
    let json = r#"{"databases":["app"],"tables":{"app":[{"name":"users"}]},"columns":{},"routines":{},"foreignKeys":{},"indexes":{}}"#;

    schema_cache::save_schema_cache_snapshot(&conn, "profile-1", json).expect("save should work");
    let loaded =
        schema_cache::load_schema_cache_snapshot(&conn, "profile-1").expect("load should work");

    assert_eq!(loaded, Some(json.to_string()));
}

#[test]
fn save_schema_cache_snapshot_upserts_existing_profile() {
    let conn = common::test_db();

    schema_cache::save_schema_cache_snapshot(&conn, "profile-1", r#"{"databases":["old"]}"#)
        .expect("initial save should work");
    schema_cache::save_schema_cache_snapshot(&conn, "profile-1", r#"{"databases":["new"]}"#)
        .expect("upsert should work");

    let loaded =
        schema_cache::load_schema_cache_snapshot(&conn, "profile-1").expect("load should work");
    assert_eq!(loaded, Some(r#"{"databases":["new"]}"#.to_string()));
}

#[test]
fn load_schema_cache_snapshot_impl_returns_none_when_missing() {
    let state = test_app_state();

    let snapshot = load_schema_cache_snapshot_impl(&state, "missing-profile")
        .expect("load impl should succeed");

    assert_eq!(snapshot, None);
}

#[test]
fn save_and_load_schema_cache_snapshot_impl_round_trip() {
    let state = test_app_state();
    let json = r#"{"databases":["app"],"tables":{"app":[{"name":"users"}]},"columns":{},"routines":{},"foreignKeys":{},"indexes":{}}"#;

    save_schema_cache_snapshot_impl(&state, "profile-1", json).expect("save impl should work");

    let loaded =
        load_schema_cache_snapshot_impl(&state, "profile-1").expect("load impl should work");

    assert_eq!(loaded, Some(json.to_string()));
}

#[test]
fn save_schema_cache_snapshot_impl_upserts_existing_profile() {
    let state = test_app_state();

    save_schema_cache_snapshot_impl(&state, "profile-1", r#"{"databases":["old"]}"#)
        .expect("initial save impl should work");
    save_schema_cache_snapshot_impl(&state, "profile-1", r#"{"databases":["new"]}"#)
        .expect("upsert save impl should work");

    let loaded =
        load_schema_cache_snapshot_impl(&state, "profile-1").expect("load impl should work");

    assert_eq!(loaded, Some(r#"{"databases":["new"]}"#.to_string()));
}

#[test]
fn save_schema_cache_snapshot_impl_surfaces_repository_errors() {
    let state = test_app_state();
    {
        let conn = state.db.lock().expect("db lock should succeed");
        conn.execute("DROP TABLE schema_cache_snapshots", [])
            .expect("drop table should succeed");
    }

    let error = save_schema_cache_snapshot_impl(&state, "profile-1", r#"{"databases":[]}"#)
        .expect_err("save impl should propagate db errors");

    assert!(
        error.contains("no such table") || error.contains("no such table: schema_cache"),
        "unexpected error: {error}"
    );
}

#[test]
fn load_schema_cache_snapshot_impl_surfaces_repository_errors() {
    let state = test_app_state();
    {
        let conn = state.db.lock().expect("db lock should succeed");
        conn.execute("DROP TABLE schema_cache_snapshots", [])
            .expect("drop table should succeed");
    }

    let error = load_schema_cache_snapshot_impl(&state, "profile-1")
        .expect_err("load impl should propagate db errors");

    assert!(
        error.contains("no such table") || error.contains("no such table: schema_cache"),
        "unexpected error: {error}"
    );
}

#[test]
fn schema_cache_impls_surface_poisoned_db_lock_errors() {
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
        logs_db: Arc::new(Mutex::new(common::test_db())),
        registry: ConnectionRegistry::new(),
        app_handle: None,
        result_cache: std::sync::Arc::new(
            sqllumen_lib::mysql::result_cache::ResultCache::new_for_test(
                1800,
                std::env::temp_dir().join("sqllumen-test-schcache-results"),
            ),
        ),
        table_data_cache: std::sync::Arc::new(TableDataCache::new_for_test(
            1800,
            std::env::temp_dir().join("sqllumen-test-schcache-table-data"),
        )),
        metadata_cache: sqllumen_lib::mysql::metadata_cache::MetadataCache::new(),
        log_filter_reload: Mutex::new(None),
        running_queries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        dump_jobs: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        import_jobs: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        copy_jobs: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        ai_requests: Arc::new(Mutex::new(std::collections::HashMap::new())),
        index_build_tokens: Arc::new(Mutex::new(std::collections::HashMap::new())),
        session_profile_map: Arc::new(Mutex::new(std::collections::HashMap::new())),
        session_ref_counts: Arc::new(Mutex::new(std::collections::HashMap::new())),
        http_client: sqllumen_lib::http_client(),
        embedding_cache: sqllumen_lib::schema_index::embeddings_cache::EmbeddingCache::new(),
    };

    let load_error = load_schema_cache_snapshot_impl(&state, "profile-1")
        .expect_err("load impl should fail on poisoned mutex");
    assert!(
        load_error.contains("poison"),
        "unexpected poisoned lock error: {load_error}"
    );

    let save_error = save_schema_cache_snapshot_impl(&state, "profile-1", r#"{"databases":[]}"#)
        .expect_err("save impl should fail on poisoned mutex");
    assert!(
        save_error.contains("poison"),
        "unexpected poisoned lock error: {save_error}"
    );
}
