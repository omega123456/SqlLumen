//! Integration tests for `ResultCache` core operations:
//! insert/get/remove, TTL, LRU tracking, multiple entries.

use sqllumen_lib::mysql::query_executor::StoredResult;
use sqllumen_lib::mysql::result_cache::{
    MemorySnapshot, ResultCache, SlotWrite, SysinfoMemorySnapshot,
};
use std::thread;
use std::time::Duration;

/// Helper: build a minimal `StoredResult` for testing.
fn stub_result(query_id: &str) -> StoredResult {
    StoredResult::new(
        query_id.to_string(),
        vec![],
        std::sync::Arc::new(vec![]),
        0,
        0,
        0,
        false,
    )
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
        rows: crate::common::shared_rows(rows),
        ..stub_result(query_id)
    }
}

/// Swap the rows of one slot through the slot-level, version-checked modifier.
fn swap_rows(
    cache: &ResultCache,
    version: u64,
    idx: usize,
    rows: sqllumen_lib::mysql::query_executor::SharedRows,
) -> SlotWrite<()> {
    cache
        .modify_slot_in_place_if_current("conn1", "tab1", version, idx, None, None, |slot| {
            slot.rows = rows;
            Ok(())
        })
        .expect("closure succeeds")
}

#[test]
fn slot_write_matching_version_swaps_rows_in_place() {
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
    let new_rows =
        crate::common::shared_rows(vec![vec![serde_json::json!(1)], vec![serde_json::json!(2)]]);

    let outcome = swap_rows(&cache, version, 0, std::sync::Arc::clone(&new_rows));
    assert_eq!(outcome, SlotWrite::Applied(()), "matching version applies");

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
fn slot_write_on_a_stale_version_is_refused_and_keeps_the_new_result() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());
    cache.insert(
        "conn1",
        "tab1",
        vec![stub_result_with_rows(
            "q1",
            vec![vec![serde_json::json!(1)]],
        )],
    );
    let stale_version = cache.current_invalidation_version("conn1", "tab1");

    // A re-run lands between the edit's version read and its write-back.
    cache.remove_with_spill_cleanup("conn1", "tab1");
    cache.insert(
        "conn1",
        "tab1",
        vec![stub_result_with_rows(
            "q2",
            vec![vec![serde_json::json!(2)]],
        )],
    );

    let mut called = false;
    let outcome = cache.modify_slot_in_place_if_current(
        "conn1",
        "tab1",
        stale_version,
        0,
        None,
        None,
        |_| {
            called = true;
            Ok(())
        },
    );
    assert_eq!(outcome, Ok(SlotWrite::Invalidated));
    assert!(!called, "closure must not run on a stale version");

    let entry = cache.get("conn1", "tab1").into_entry().unwrap();
    assert_eq!(entry.value[0].query_id, "q2");
    assert_eq!(&*entry.value[0].rows[0], &[serde_json::json!(2)]);
}

#[test]
fn slot_write_closure_error_leaves_cache_unchanged() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());
    cache.insert(
        "conn1",
        "tab1",
        vec![stub_result_with_rows(
            "q1",
            vec![vec![serde_json::json!(1)]],
        )],
    );
    let version = cache.current_invalidation_version("conn1", "tab1");
    let before =
        std::sync::Arc::clone(&cache.get("conn1", "tab1").into_entry().unwrap().value[0].rows);

    let outcome = cache.modify_slot_in_place_if_current(
        "conn1",
        "tab1",
        version,
        0,
        None,
        None,
        |slot| -> Result<(), String> {
            slot.rows = std::sync::Arc::new(vec![]);
            Err("closure failed".to_string())
        },
    );
    assert_eq!(outcome, Err("closure failed".to_string()));

    let after = cache.get("conn1", "tab1").into_entry().unwrap();
    assert!(std::sync::Arc::ptr_eq(&after.value[0].rows, &before));
}

#[test]
fn slot_write_missing_entry_or_slot_is_refused() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    assert_eq!(
        swap_rows(&cache, 0, 0, std::sync::Arc::new(vec![])),
        SlotWrite::Invalidated,
        "missing entry"
    );

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);
    let version = cache.current_invalidation_version("conn1", "tab1");
    assert_eq!(
        swap_rows(&cache, version, 5, std::sync::Arc::new(vec![])),
        SlotWrite::Invalidated,
        "missing slot"
    );
}

#[test]
fn slot_write_concurrent_edits_do_not_lose_updates() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = std::sync::Arc::new(ResultCache::new_for_test(1800, tmp.path().to_path_buf()));
    let row_count = 8;
    cache.insert(
        "conn1",
        "tab1",
        vec![stub_result_with_rows(
            "q1",
            (0..row_count).map(|_| vec![serde_json::json!(0)]).collect(),
        )],
    );
    let version = cache.current_invalidation_version("conn1", "tab1");

    let handles: Vec<_> = (0..row_count)
        .map(|row| {
            let cache = std::sync::Arc::clone(&cache);
            thread::spawn(move || {
                cache
                    .modify_slot_in_place_if_current(
                        "conn1",
                        "tab1",
                        version,
                        0,
                        None,
                        None,
                        |slot| {
                            let mut next = (*slot.rows).clone();
                            next[row] = vec![serde_json::json!(row + 1)].into();
                            slot.rows = std::sync::Arc::new(next);
                            Ok(())
                        },
                    )
                    .expect("edit closure succeeds")
            })
        })
        .collect();
    for handle in handles {
        assert_eq!(
            handle.join().expect("thread"),
            SlotWrite::Applied(()),
            "every edit applies"
        );
    }

    let entry = cache.get("conn1", "tab1").into_entry().unwrap();
    for row in 0..row_count {
        assert_eq!(entry.value[0].rows[row][0], serde_json::json!(row + 1));
    }
}
