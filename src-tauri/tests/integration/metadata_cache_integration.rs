use crate::common;

use sqllumen_lib::mysql::metadata_cache::MetadataCache;
use sqllumen_lib::mysql::metadata_cache::{
    evict_metadata_cache_for_connection, evict_metadata_cache_for_database,
    evict_metadata_cache_for_tables, MetadataCacheInvalidatedPayload,
};
use sqllumen_lib::mysql::table_data::{PrimaryKeyInfo, TableDataColumnMeta};
use std::sync::Arc;
use std::thread;

fn sample_columns() -> Vec<TableDataColumnMeta> {
    vec![TableDataColumnMeta {
        name: "id".to_string(),
        data_type: "int".to_string(),
        is_boolean_alias: false,
        enum_values: None,
        set_values: None,
        is_nullable: false,
        is_primary_key: true,
        is_unique_key: true,
        has_default: false,
        column_default: None,
        is_binary: false,
        is_auto_increment: true,
    }]
}

fn sample_primary_key() -> PrimaryKeyInfo {
    PrimaryKeyInfo {
        key_columns: vec!["id".to_string()],
        has_auto_increment: true,
        is_unique_key_fallback: false,
    }
}

#[test]
fn insert_then_get_returns_cached_metadata() {
    let cache = MetadataCache::new();
    let primary_key = sample_primary_key();
    let columns = sample_columns();

    cache.insert(
        "conn-1",
        "app_db",
        "users",
        Some(primary_key.clone()),
        columns.clone(),
    );

    assert_eq!(
        cache.get("conn-1", "app_db", "users"),
        Some((Some(primary_key), columns))
    );
}

#[test]
fn get_returns_none_on_cache_miss() {
    let cache = MetadataCache::new();

    assert_eq!(cache.get("conn-1", "app_db", "users"), None);
}

#[test]
fn default_is_empty_like_new() {
    let cache = MetadataCache::default();

    assert_eq!(cache.get("conn-1", "app_db", "users"), None);
}

#[test]
fn evict_table_removes_only_requested_entry() {
    let cache = MetadataCache::new();
    cache.insert(
        "conn-1",
        "app_db",
        "users",
        Some(sample_primary_key()),
        sample_columns(),
    );
    cache.insert(
        "conn-1",
        "app_db",
        "orders",
        Some(sample_primary_key()),
        sample_columns(),
    );

    assert!(cache.evict_table("conn-1", "app_db", "users"));
    assert_eq!(cache.get("conn-1", "app_db", "users"), None);
    assert!(cache.get("conn-1", "app_db", "orders").is_some());
}

#[test]
fn evict_connection_removes_all_entries_for_that_connection() {
    let cache = MetadataCache::new();
    cache.insert(
        "conn-1",
        "app_db",
        "users",
        Some(sample_primary_key()),
        sample_columns(),
    );
    cache.insert(
        "conn-1",
        "app_db",
        "orders",
        Some(sample_primary_key()),
        sample_columns(),
    );
    cache.insert(
        "conn-2",
        "app_db",
        "users",
        Some(sample_primary_key()),
        sample_columns(),
    );

    assert_eq!(cache.evict_connection("conn-1"), 2);
    assert_eq!(cache.get("conn-1", "app_db", "users"), None);
    assert_eq!(cache.get("conn-1", "app_db", "orders"), None);
    assert!(cache.get("conn-2", "app_db", "users").is_some());
}

#[test]
fn evict_all_clears_entire_cache() {
    let cache = MetadataCache::new();
    cache.insert(
        "conn-1",
        "app_db",
        "users",
        Some(sample_primary_key()),
        sample_columns(),
    );
    cache.insert(
        "conn-2",
        "analytics",
        "events",
        Some(sample_primary_key()),
        sample_columns(),
    );

    assert_eq!(cache.evict_all(), 2);
    assert_eq!(cache.get("conn-1", "app_db", "users"), None);
    assert_eq!(cache.get("conn-2", "analytics", "events"), None);
}

#[test]
fn concurrent_access_is_safe() {
    let cache = Arc::new(MetadataCache::new());
    let mut handles = Vec::new();

    for index in 0..8 {
        let cache = Arc::clone(&cache);
        handles.push(thread::spawn(move || {
            let table_name = format!("users_{index}");
            cache.insert(
                "conn-1",
                "app_db",
                &table_name,
                Some(sample_primary_key()),
                sample_columns(),
            );

            assert!(cache.get("conn-1", "app_db", &table_name).is_some());
        }));
    }

    for handle in handles {
        handle.join().expect("thread should complete");
    }

    for index in 0..8 {
        assert!(cache
            .get("conn-1", "app_db", &format!("users_{index}"))
            .is_some());
    }
}

#[test]
fn evict_metadata_cache_for_tables_uses_default_database_for_unqualified_names() {
    let state = common::test_app_state();
    state.metadata_cache.insert(
        "conn-1",
        "app_db",
        "users",
        Some(sample_primary_key()),
        sample_columns(),
    );
    state.metadata_cache.insert(
        "conn-1",
        "other_db",
        "users",
        Some(sample_primary_key()),
        sample_columns(),
    );

    let payload = evict_metadata_cache_for_tables(
        &state,
        "conn-1",
        &[(None, "users".to_string())],
        Some("app_db"),
    );

    assert_eq!(
        payload,
        MetadataCacheInvalidatedPayload {
            connection_id: "conn-1".to_string(),
            scope: "tables".to_string(),
            tables: vec!["app_db.users".to_string()],
        }
    );
    assert!(state
        .metadata_cache
        .get("conn-1", "app_db", "users")
        .is_none());
    assert!(state
        .metadata_cache
        .get("conn-1", "other_db", "users")
        .is_some());
}

#[test]
fn evict_metadata_cache_for_tables_falls_back_to_connection_when_database_is_unknown() {
    let state = common::test_app_state();
    state.metadata_cache.insert(
        "conn-1",
        "app_db",
        "users",
        Some(sample_primary_key()),
        sample_columns(),
    );
    state.metadata_cache.insert(
        "conn-1",
        "analytics",
        "events",
        Some(sample_primary_key()),
        sample_columns(),
    );

    let payload =
        evict_metadata_cache_for_tables(&state, "conn-1", &[(None, "users".to_string())], None);

    assert_eq!(
        payload,
        MetadataCacheInvalidatedPayload {
            connection_id: "conn-1".to_string(),
            scope: "connection".to_string(),
            tables: vec![],
        }
    );
    assert!(state
        .metadata_cache
        .get("conn-1", "app_db", "users")
        .is_none());
    assert!(state
        .metadata_cache
        .get("conn-1", "analytics", "events")
        .is_none());
}

#[test]
fn evict_metadata_cache_for_database_removes_only_matching_database() {
    let state = common::test_app_state();
    state.metadata_cache.insert(
        "conn-1",
        "app_db",
        "users",
        Some(sample_primary_key()),
        sample_columns(),
    );
    state.metadata_cache.insert(
        "conn-1",
        "analytics",
        "events",
        Some(sample_primary_key()),
        sample_columns(),
    );

    let payload = evict_metadata_cache_for_database(&state, "conn-1", "app_db");

    assert_eq!(
        payload,
        MetadataCacheInvalidatedPayload {
            connection_id: "conn-1".to_string(),
            scope: "tables".to_string(),
            tables: vec!["app_db.users".to_string()],
        }
    );
    assert!(state
        .metadata_cache
        .get("conn-1", "app_db", "users")
        .is_none());
    assert!(state
        .metadata_cache
        .get("conn-1", "analytics", "events")
        .is_some());
}

#[test]
fn evict_metadata_cache_for_connection_removes_all_entries_for_connection() {
    let state = common::test_app_state();
    state.metadata_cache.insert(
        "conn-1",
        "app_db",
        "users",
        Some(sample_primary_key()),
        sample_columns(),
    );
    state.metadata_cache.insert(
        "conn-2",
        "app_db",
        "users",
        Some(sample_primary_key()),
        sample_columns(),
    );

    let payload = evict_metadata_cache_for_connection(&state, "conn-1");

    assert_eq!(
        payload,
        MetadataCacheInvalidatedPayload {
            connection_id: "conn-1".to_string(),
            scope: "connection".to_string(),
            tables: vec![],
        }
    );
    assert!(state
        .metadata_cache
        .get("conn-1", "app_db", "users")
        .is_none());
    assert!(state
        .metadata_cache
        .get("conn-2", "app_db", "users")
        .is_some());
}
