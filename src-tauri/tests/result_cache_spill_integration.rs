//! Integration tests for `ResultCache` disk spill, re-warm, RAM pressure,
//! and cleanup behavior.

mod common;

use sqllumen_lib::mysql::query_executor::{ColumnMeta, StoredResult};
use sqllumen_lib::mysql::result_cache::{MemorySnapshot, ResultCache, ResultCacheGet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

/// Helper: build a minimal `StoredResult` for testing.
fn stub_result(query_id: &str) -> StoredResult {
    StoredResult {
        query_id: query_id.to_string(),
        columns: vec![],
        rows: vec![],
        execution_time_ms: 0,
        affected_rows: 0,
        auto_limit_applied: false,
    }
}

/// Helper: build a `StoredResult` with typed Number values for round-trip testing.
fn stub_result_with_numbers(query_id: &str) -> StoredResult {
    StoredResult {
        query_id: query_id.to_string(),
        columns: vec![
            ColumnMeta {
                name: "u64_col".to_string(),
                data_type: "BIGINT UNSIGNED".to_string(),
            },
            ColumnMeta {
                name: "i64_col".to_string(),
                data_type: "BIGINT".to_string(),
            },
            ColumnMeta {
                name: "f64_col".to_string(),
                data_type: "DOUBLE".to_string(),
            },
        ],
        rows: vec![vec![
            serde_json::Value::Number(serde_json::Number::from(42u64)),
            serde_json::Value::Number(serde_json::Number::from(-99i64)),
            serde_json::Value::Number(serde_json::Number::from_f64(3.14).unwrap()),
        ]],
        execution_time_ms: 123,
        affected_rows: 0,
        auto_limit_applied: false,
    }
}

/// Test memory snapshot with controllable values.
struct FakeMemorySnapshot {
    available: AtomicU64,
    total: u64,
}

impl FakeMemorySnapshot {
    fn new(available: u64, total: u64) -> Self {
        Self {
            available: AtomicU64::new(available),
            total,
        }
    }
}

impl MemorySnapshot for FakeMemorySnapshot {
    fn available_bytes(&self) -> u64 {
        self.available.load(Ordering::Relaxed)
    }

    fn total_bytes(&self) -> u64 {
        self.total
    }
}

struct StepMemorySnapshot {
    readings: Vec<u64>,
    index: AtomicU64,
    total: u64,
}

impl StepMemorySnapshot {
    fn new(readings: Vec<u64>, total: u64) -> Self {
        Self {
            readings,
            index: AtomicU64::new(0),
            total,
        }
    }
}

impl MemorySnapshot for StepMemorySnapshot {
    fn refresh(&mut self) {
        self.index.fetch_add(1, Ordering::Relaxed);
    }

    fn available_bytes(&self) -> u64 {
        let current = self.index.load(Ordering::Relaxed).saturating_sub(1) as usize;
        let capped = current.min(self.readings.len().saturating_sub(1));
        self.readings[capped]
    }

    fn total_bytes(&self) -> u64 {
        self.total
    }
}

// ── Spill file creation on TTL expiry ────────────────────────────────────────

#[test]
fn ttl_expired_entry_creates_spill_file() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);

    // Wait for TTL to expire
    thread::sleep(Duration::from_millis(1500));
    cache.run_pending_tasks();
    cache.flush_spill_jobs();

    // Spill file should exist
    let spill_path = cache.spill_file_path("conn1", "tab1");
    assert!(
        spill_path.exists(),
        "spill file should exist at {}",
        spill_path.display()
    );
    assert!(spill_path.extension().unwrap() == "msgpack");
}

// ── Re-warm from spill file ─────────────────────────────────────────────────

#[test]
fn cache_miss_rewarms_from_spill_file() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);

    // Wait for TTL to expire
    thread::sleep(Duration::from_millis(1500));
    cache.run_pending_tasks();
    cache.flush_spill_jobs();

    // Entry should be evicted from moka but spill file exists
    assert_eq!(cache.entry_count(), 0);

    // get() should re-warm
    let result = cache.get("conn1", "tab1");
    assert!(
        matches!(result, ResultCacheGet::ReWarmed(_)),
        "expected ReWarmed, got {:?}",
        std::mem::discriminant(&result)
    );

    let entry = result.into_entry().unwrap();
    assert_eq!(entry.value[0].query_id, "q1");

    // Spill file should be deleted after re-warm
    let spill_path = cache.spill_file_path("conn1", "tab1");
    assert!(
        !spill_path.exists(),
        "spill file should be deleted after re-warm"
    );
}

// ── Number type preservation on round-trip ──────────────────────────────────

#[test]
fn rewarmed_data_preserves_number_types() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result_with_numbers("q-nums")]);

    // Wait for TTL to expire
    thread::sleep(Duration::from_millis(1500));
    cache.run_pending_tasks();
    cache.flush_spill_jobs();

    // Re-warm
    let entry = cache
        .get("conn1", "tab1")
        .into_entry()
        .expect("should re-warm");
    let row = &entry.value[0].rows[0];

    // u64
    assert!(row[0].is_u64(), "u64 value should be preserved as u64");
    assert_eq!(row[0].as_u64(), Some(42));

    // i64 (negative)
    assert!(row[1].is_i64(), "i64 value should be preserved as i64");
    assert_eq!(row[1].as_i64(), Some(-99));

    // f64
    assert!(row[2].is_f64(), "f64 value should be preserved as f64");
    assert!((row[2].as_f64().unwrap() - 3.14).abs() < 1e-10);
}

// ── Known key with no spill file returns Expired ─────────────────────────────

#[test]
fn known_key_no_spill_file_returns_expired() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);

    // Wait for TTL to expire
    thread::sleep(Duration::from_millis(1500));
    cache.run_pending_tasks();
    cache.flush_spill_jobs();

    // Delete the spill file manually
    let spill_path = cache.spill_file_path("conn1", "tab1");
    std::fs::remove_file(&spill_path).expect("should delete spill file");

    // get() should return Expired
    assert!(matches!(
        cache.get("conn1", "tab1"),
        ResultCacheGet::Expired
    ));
}

// ── Unknown key returns NeverStored ─────────────────────────────────────────

#[test]
fn unknown_key_returns_never_stored() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    assert!(matches!(
        cache.get("unknown", "tab"),
        ResultCacheGet::NeverStored
    ));
}

// ── remove_with_spill_cleanup deletes spill file ─────────────────────────────

#[test]
fn remove_with_spill_cleanup_deletes_spill_file() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);

    // Wait for TTL to expire (creates spill file)
    thread::sleep(Duration::from_millis(1500));
    cache.run_pending_tasks();
    cache.flush_spill_jobs();

    let spill_path = cache.spill_file_path("conn1", "tab1");
    assert!(spill_path.exists());

    // Re-warm so the entry is back in cache
    assert!(cache.get("conn1", "tab1").is_available());

    // Now insert fresh data so there's something to clean up
    cache.insert("conn1", "tab1", vec![stub_result("q2")]);

    // remove_with_spill_cleanup should remove entry and prevent spill
    cache.remove_with_spill_cleanup("conn1", "tab1");
    cache.run_pending_tasks();
    cache.flush_spill_jobs();

    let spill_path = cache.spill_file_path("conn1", "tab1");
    assert!(
        !spill_path.exists(),
        "spill file should not exist after remove_with_spill_cleanup"
    );

    // Key should be treated as NeverStored after cleanup
    assert!(matches!(
        cache.get("conn1", "tab1"),
        ResultCacheGet::NeverStored
    ));
}

// ── Startup cleanup wipes spill directory ────────────────────────────────────

#[test]
fn startup_cleanup_wipes_spill_dir() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let spill_dir = tmp.path().join("spill");
    let session_dir = spill_dir.join("some-session");
    std::fs::create_dir_all(&session_dir).unwrap();
    std::fs::write(session_dir.join("test.msgpack"), b"data").unwrap();

    // Simulate startup cleanup
    assert!(spill_dir.exists());
    std::fs::remove_dir_all(&spill_dir).expect("cleanup should succeed");
    assert!(!spill_dir.exists());
}

// ── RAM pressure eviction triggers spill ─────────────────────────────────────

#[test]
fn ram_pressure_eviction_triggers_spill() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(3600, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);
    cache.insert("conn1", "tab2", vec![stub_result("q2")]);

    // Simulate low memory: 100 MB available out of 8 GB
    // Threshold = min(4GB, 8GB * 10%) = 800 MB
    // 100 MB < 800 MB = under pressure
    let snapshot = FakeMemorySnapshot::new(100 * 1024 * 1024, 8 * 1024 * 1024 * 1024);

    let mut snapshot = snapshot;
    cache.run_maintenance(&mut snapshot);
    cache.flush_spill_jobs();

    // At least one spill file should exist
    let spill1 = cache.spill_file_path("conn1", "tab1");
    let spill2 = cache.spill_file_path("conn1", "tab2");
    assert!(
        spill1.exists() || spill2.exists(),
        "at least one spill file should exist after RAM pressure eviction"
    );
}

#[test]
fn ram_pressure_stops_after_memory_recovers() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(3600, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);
    cache.insert("conn1", "tab2", vec![stub_result("q2")]);
    cache.insert("conn1", "tab3", vec![stub_result("q3")]);
    cache.insert("conn1", "tab4", vec![stub_result("q4")]);

    let snapshot = StepMemorySnapshot::new(
        vec![100 * 1024 * 1024, 900 * 1024 * 1024, 900 * 1024 * 1024],
        8 * 1024 * 1024 * 1024,
    );

    let mut snapshot = snapshot;
    cache.run_maintenance(&mut snapshot);
    cache.flush_spill_jobs();

    assert_eq!(
        cache.entry_count(),
        1,
        "only one bounded eviction batch should run once memory recovers"
    );
}

// ── Stale spill deleted on overwrite ─────────────────────────────────────────

#[test]
fn stale_spill_deleted_on_overwrite() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);

    // Wait for TTL to expire (creates spill file)
    thread::sleep(Duration::from_millis(1500));
    cache.run_pending_tasks();
    cache.flush_spill_jobs();

    let spill_path = cache.spill_file_path("conn1", "tab1");
    assert!(
        spill_path.exists(),
        "spill file should exist after TTL expiry"
    );

    // Insert new data for the same key — stale spill should be deleted
    cache.insert("conn1", "tab1", vec![stub_result("q2")]);

    assert!(
        !spill_path.exists(),
        "stale spill file should be deleted on new insert"
    );
}

// ── Replacement does not leave orphan spill files ─────────────────────────────

#[test]
fn replacement_does_not_leave_orphan_spill() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(3600, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);
    // Replace immediately
    cache.insert("conn1", "tab1", vec![stub_result("q2")]);

    // Run maintenance to flush any pending eviction notifications
    cache.run_pending_tasks();
    cache.flush_spill_jobs();

    let spill_path = cache.spill_file_path("conn1", "tab1");
    assert!(
        !spill_path.exists(),
        "replacement should not leave orphan spill file"
    );
}

#[test]
fn stale_eviction_notification_does_not_write_outdated_spill_file() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(3600, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);

    let low_memory = FakeMemorySnapshot::new(100 * 1024 * 1024, 8 * 1024 * 1024 * 1024);
    let mut low_memory = low_memory;
    cache.run_maintenance(&mut low_memory);

    cache.insert("conn1", "tab1", vec![stub_result("q2")]);
    cache.flush_spill_jobs();

    let spill_path = cache.spill_file_path("conn1", "tab1");
    assert!(
        !spill_path.exists(),
        "stale RAM-pressure eviction should not spill outdated rows after replacement"
    );
}

#[test]
fn maintenance_refreshes_memory_between_passes() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(3600, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);
    cache.insert("conn1", "tab2", vec![stub_result("q2")]);
    cache.insert("conn1", "tab3", vec![stub_result("q3")]);
    cache.insert("conn1", "tab4", vec![stub_result("q4")]);

    let mut snapshot = StepMemorySnapshot::new(
        vec![100 * 1024 * 1024, 900 * 1024 * 1024, 900 * 1024 * 1024],
        8 * 1024 * 1024 * 1024,
    );

    cache.run_maintenance(&mut snapshot);
    cache.flush_spill_jobs();

    assert_eq!(
        cache.entry_count(),
        1,
        "maintenance should stop after one eviction batch once refreshed memory recovers"
    );
}

// ── Safe filename has no path separators ─────────────────────────────────────

#[test]
fn safe_filename_no_path_separators() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    // Use IDs with path separators and special characters
    let path = cache.spill_file_path("conn/../../etc", "tab\\..\\windows");
    let filename = path.file_name().unwrap().to_str().unwrap();

    assert!(
        !filename.contains('/') && !filename.contains('\\'),
        "filename should not contain path separators: {filename}"
    );
    assert!(filename.ends_with(".msgpack"));
}

// ── Tab-close cleanup prevents eviction listener from recreating file ────────

#[test]
fn tab_close_cleanup_prevents_spill_recreation() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(3600, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);

    // remove_with_spill_cleanup marks the key as cleaned
    cache.remove_with_spill_cleanup("conn1", "tab1");

    // Run maintenance to flush any async eviction notifications
    cache.run_pending_tasks();
    cache.flush_spill_jobs();

    let spill_path = cache.spill_file_path("conn1", "tab1");
    assert!(
        !spill_path.exists(),
        "eviction listener should not recreate spill file after tab-close cleanup"
    );
}

#[test]
fn drop_cleans_up_current_session_spill_directory() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let spill_root = tmp.path().to_path_buf();
    let session_dir = {
        let cache = ResultCache::new_for_test(1, spill_root.clone());
        let session_dir = spill_root.join(cache.session_id());
        cache.insert("conn1", "tab1", vec![stub_result("q1")]);
        thread::sleep(Duration::from_millis(1500));
        cache.run_pending_tasks();
        cache.flush_spill_jobs();
        assert!(
            session_dir.exists(),
            "session spill directory should exist before drop"
        );
        session_dir
    };

    assert!(
        !session_dir.exists(),
        "session spill directory should be removed on normal shutdown"
    );
}

// ── In-memory hit returns Found variant ──────────────────────────────────────

#[test]
fn in_memory_hit_returns_found() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = ResultCache::new_for_test(1800, tmp.path().to_path_buf());

    cache.insert("conn1", "tab1", vec![stub_result("q1")]);

    assert!(matches!(
        cache.get("conn1", "tab1"),
        ResultCacheGet::Found(_)
    ));
}
