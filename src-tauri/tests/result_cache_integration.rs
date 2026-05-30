//! Integration tests for `ResultCache` core operations:
//! insert/get/remove, TTL, LRU tracking, multiple entries.

mod common;

use sqllumen_lib::mysql::query_executor::StoredResult;
use sqllumen_lib::mysql::result_cache::{MemorySnapshot, ResultCache, SysinfoMemorySnapshot};
use std::thread;
use std::time::Duration;

/// Helper: build a minimal `StoredResult` for testing.
fn stub_result(query_id: &str) -> StoredResult {
    StoredResult {
        query_id: query_id.to_string(),
        columns: vec![],
        rows: std::sync::Arc::new(vec![]),
        execution_time_ms: 0,
        affected_rows: 0,
        auto_limit_applied: false,
    }
}

#[test]
fn insert_and_get() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);

    let entry = cache
        .get("conn1", "tab1")
        .into_entry()
        .expect("should find entry");
    assert_eq!(entry.value.len(), 1);
    assert_eq!(entry.value[0].query_id, "q1");
}

#[test]
fn cache_miss_returns_never_stored() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    assert!(!cache.get("conn1", "tab1").is_available());
    assert!(matches!(
        cache.get("conn1", "tab1"),
        sqllumen_lib::mysql::result_cache::ResultCacheGet::NeverStored
    ));
}

#[test]
fn remove_invalidates_entry() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);
    cache.remove("conn1", "tab1");
    cache.run_pending_tasks();

    assert!(!cache.get("conn1", "tab1").is_available());
}

#[test]
fn set_ttl_updates_atomic() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    assert_eq!(cache.ttl_seconds(), 1800);
    cache.set_ttl(900);
    assert_eq!(cache.ttl_seconds(), 900);
}

#[test]
fn short_ttl_evicts_entry() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);
    assert!(cache.get("conn1", "tab1").is_available());

    // Wait for TTL to expire and run maintenance.
    thread::sleep(Duration::from_millis(1500));
    cache.run_pending_tasks();
    cache.flush_spill_jobs();

    // After TTL expiry, result should be spilled to disk and re-warmable,
    // so get() returns ReWarmed (still available).
    // The entry_count in moka may be 0, but get() re-warms from disk.
    let result = cache.get("conn1", "tab1");
    assert!(result.is_available());
}

#[test]
fn lru_ordering_reflects_access() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);
    cache.insert("conn1", "tab2", vec![stub_result("q2")]);
    cache.insert("conn1", "tab3", vec![stub_result("q3")]);

    // LRU order: tab1 (least recent), tab2, tab3 (most recent)
    let lru = cache.lru_snapshot();
    assert_eq!(lru.len(), 3);
    assert_eq!(lru[0], ("conn1".to_string(), "tab1".to_string()));
    assert_eq!(lru[2], ("conn1".to_string(), "tab3".to_string()));

    // Access tab1 — it should move to the back.
    cache.get("conn1", "tab1");
    let lru = cache.lru_snapshot();
    assert_eq!(lru[0], ("conn1".to_string(), "tab2".to_string()));
    assert_eq!(lru[2], ("conn1".to_string(), "tab1".to_string()));
}

#[test]
fn lru_remove_cleans_up() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);
    cache.insert("conn1", "tab2", vec![stub_result("q2")]);

    cache.remove("conn1", "tab1");

    let lru = cache.lru_snapshot();
    assert_eq!(lru.len(), 1);
    assert_eq!(lru[0], ("conn1".to_string(), "tab2".to_string()));
}

#[test]
fn multiple_entries_tracked_independently() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);
    cache.insert("conn2", "tab1", vec![stub_result("q2")]);

    let e1 = cache.get("conn1", "tab1").into_entry().expect("entry 1");
    let e2 = cache.get("conn2", "tab1").into_entry().expect("entry 2");
    assert_eq!(e1.value[0].query_id, "q1");
    assert_eq!(e2.value[0].query_id, "q2");

    // Remove one; the other survives.
    cache.remove("conn1", "tab1");
    cache.run_pending_tasks();
    assert!(!cache.get("conn1", "tab1").is_available());
    assert!(cache.get("conn2", "tab1").is_available());
}

#[test]
fn session_id_is_uuid_v4() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    let id = cache.session_id();
    assert_eq!(id.len(), 36); // UUID v4 standard format
    assert!(uuid::Uuid::parse_str(id).is_ok());
}

#[test]
fn spill_dir_returns_configured_path() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let expected = tmp.path().to_path_buf();
    let cache = ResultCache::new_for_test(1800, expected.clone());

    assert_eq!(cache.spill_dir(), &expected);
}

#[test]
fn insert_replaces_existing_entry() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);
    cache.insert("conn1", "tab1", vec![stub_result("q2")]);

    let entry = cache
        .get("conn1", "tab1")
        .into_entry()
        .expect("should find entry");
    assert_eq!(entry.value[0].query_id, "q2");
    cache.run_pending_tasks();
    assert_eq!(cache.entry_count(), 1);
}

#[test]
fn sysinfo_snapshot_reports_sane_available_memory() {
    let mut snapshot = SysinfoMemorySnapshot::new();
    snapshot.refresh();

    let total = snapshot.total_bytes();
    let available = snapshot.available_bytes();

    // A real machine always has some total RAM and some reclaimable RAM.
    assert!(total > 0, "total memory should be reported");
    assert!(available > 0, "available memory should be reported");
    // Available can never exceed total.
    assert!(
        available <= total,
        "available ({available}) must not exceed total ({total})"
    );
    // Regression guard: on macOS the previous implementation undercounted
    // reclaimable (inactive) pages so badly that available looked like a tiny
    // sliver of total, firing false RAM-pressure on idle machines. Reclaimable
    // memory should be a meaningful fraction of total (>1%).
    assert!(
        available > total / 100,
        "available ({available}) is implausibly small vs total ({total})"
    );
}

#[test]
fn generation_increments_on_insert() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);
    let g1 = cache.get("conn1", "tab1").into_entry().unwrap().generation;

    cache.insert("conn1", "tab1", vec![stub_result("q2")]);
    let g2 = cache.get("conn1", "tab1").into_entry().unwrap().generation;

    assert!(g2 > g1);
}

/// Helper: build a `StoredResult` with the given rows.
fn stub_result_with_rows(query_id: &str, rows: Vec<Vec<serde_json::Value>>) -> StoredResult {
    StoredResult {
        query_id: query_id.to_string(),
        rows: std::sync::Arc::new(rows),
        ..stub_result(query_id)
    }
}

#[test]
fn update_rows_in_place_matching_version_swaps_rows() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    cache.insert(
        "conn1",
        "tab1",
        vec![
            stub_result_with_rows("q1", vec![vec![serde_json::json!(2)]]),
            stub_result_with_rows("q-sibling", vec![vec![serde_json::json!("sib")]]),
        ],
    );

    let version = cache.current_invalidation_version("conn1", "tab1");
    let new_rows = std::sync::Arc::new(vec![vec![serde_json::json!(1)], vec![serde_json::json!(2)]]);

    let applied = cache.update_rows_in_place_if_current(
        "conn1",
        "tab1",
        version,
        0,
        std::sync::Arc::clone(&new_rows),
    );
    assert!(applied, "matching version should apply the swap");

    let entry = cache.get("conn1", "tab1").into_entry().expect("entry");
    // Target slot rows were swapped.
    assert_eq!(entry.value[0].rows.as_ref(), new_rows.as_ref());
    // Sibling slot untouched.
    assert_eq!(entry.value[1].query_id, "q-sibling");
    assert_eq!(entry.value[1].rows.len(), 1);
    // Version unchanged (no generation bump / invalidation churn).
    assert_eq!(cache.current_invalidation_version("conn1", "tab1"), version);
}

#[test]
fn update_rows_in_place_mismatched_version_is_noop() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    cache.insert(
        "conn1",
        "tab1",
        vec![stub_result_with_rows("q1", vec![vec![serde_json::json!(2)]])],
    );
    let stale_version = cache.current_invalidation_version("conn1", "tab1");

    // Simulate a query re-run / invalidation during the sort: bump the version
    // and re-insert fresh results.
    cache.remove_with_spill_cleanup("conn1", "tab1");
    cache.insert(
        "conn1",
        "tab1",
        vec![stub_result_with_rows("q2", vec![vec![serde_json::json!(99)]])],
    );

    let new_rows = std::sync::Arc::new(vec![vec![serde_json::json!(1)]]);
    let applied =
        cache.update_rows_in_place_if_current("conn1", "tab1", stale_version, 0, new_rows);
    assert!(!applied, "stale version should be a no-op");

    // The fresh results must be untouched.
    let entry = cache.get("conn1", "tab1").into_entry().expect("entry");
    assert_eq!(entry.value[0].query_id, "q2");
    assert_eq!(entry.value[0].rows.as_ref(), &vec![vec![serde_json::json!(99)]]);
}

#[test]
fn update_rows_in_place_out_of_range_idx_returns_false() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);
    let version = cache.current_invalidation_version("conn1", "tab1");

    let applied = cache.update_rows_in_place_if_current(
        "conn1",
        "tab1",
        version,
        5,
        std::sync::Arc::new(vec![]),
    );
    assert!(!applied, "out-of-range slot index should be a no-op");
}

#[test]
fn update_rows_in_place_missing_entry_returns_false() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    let applied = cache.update_rows_in_place_if_current(
        "conn-missing",
        "tab-missing",
        0,
        0,
        std::sync::Arc::new(vec![]),
    );
    assert!(!applied, "missing entry should be a no-op");
}
