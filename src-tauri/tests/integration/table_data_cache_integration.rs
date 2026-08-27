//! Integration tests for table-data cache insert, spill, touch, and eviction behavior.

use crate::common;

use sqllumen_lib::mysql::query_executor::StoredResult;
use sqllumen_lib::mysql::result_cache::{MemorySnapshot, ResultCache};
use sqllumen_lib::mysql::table_data::{
    evict_table_data_impl, restore_table_data_cache_impl, sync_table_data_cache_after_delete_impl,
    sync_table_data_cache_after_insert_impl, sync_table_data_cache_after_update_impl,
    touch_table_data_impl, PrimaryKeyInfo, TableDataColumnMeta, TableDataResponse,
};
use sqllumen_lib::mysql::table_data_cache::TableDataCache;
use sqllumen_lib::state::AppState;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

fn sample_response(id: i64) -> TableDataResponse {
    TableDataResponse {
        columns: vec![
            TableDataColumnMeta {
                name: "id".to_string(),
                data_type: "BIGINT".to_string(),
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
            },
            TableDataColumnMeta {
                name: "score".to_string(),
                data_type: "DOUBLE".to_string(),
                is_boolean_alias: false,
                enum_values: None,
                set_values: None,
                is_nullable: false,
                is_primary_key: false,
                is_unique_key: false,
                has_default: false,
                column_default: None,
                is_binary: false,
                is_auto_increment: false,
            },
        ],
        rows: vec![vec![
            serde_json::Value::Number(serde_json::Number::from(id)),
            serde_json::Value::Number(serde_json::Number::from_f64(3.14).unwrap()),
        ]],
        current_page: 1,
        page_size: 50,
        primary_key: Some(PrimaryKeyInfo {
            key_columns: vec!["id".to_string()],
            has_auto_increment: true,
            is_unique_key_fallback: false,
        }),
        execution_time_ms: 12,
    }
}

fn stub_result(query_id: &str) -> StoredResult {
    StoredResult {
        query_id: query_id.to_string(),
        columns: vec![],
        rows: std::sync::Arc::new(vec![]),
        execution_time_ms: 0,
        total_time_ms: 0,
        affected_rows: 0,
        auto_limit_applied: false,
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

#[test]
fn insert_and_get_round_trips_table_data_response() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = TableDataCache::new_for_test(1800, tmp.path().to_path_buf());

    cache.insert("conn-1", "tab-1", sample_response(42));

    let entry = cache
        .get("conn-1", "tab-1")
        .into_entry()
        .expect("cache entry should be present");
    assert_eq!(
        entry.value.rows,
        vec![vec![
            serde_json::json!(42),
            serde_json::Value::Number(serde_json::Number::from_f64(3.14).unwrap()),
        ]]
    );
    assert_eq!(entry.value.columns[0].name, "id");
}

#[test]
fn touch_reports_available_for_cached_entry_and_expired_after_remove() {
    let state = common::test_app_state();

    state
        .table_data_cache
        .insert("conn-1", "tab-1", sample_response(7));
    assert_eq!(
        touch_table_data_impl(&state, "conn-1", "tab-1"),
        serde_json::json!({ "status": "available" })
    );

    state.table_data_cache.remove("conn-1", "tab-1");
    state.table_data_cache.run_pending_tasks();

    assert_eq!(
        touch_table_data_impl(&state, "conn-1", "tab-1"),
        serde_json::json!({ "status": "expired" })
    );
}

#[test]
fn touch_rewarms_spilled_entry_from_disk() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = TableDataCache::new_for_test(1, tmp.path().to_path_buf());

    cache.insert("conn-1", "tab-1", sample_response(99));
    thread::sleep(Duration::from_millis(1500));
    cache.run_pending_tasks();
    cache.flush_spill_jobs();

    let state = AppState {
        table_data_cache: Arc::new(cache),
        ..common::test_app_state()
    };

    assert_eq!(
        touch_table_data_impl(&state, "conn-1", "tab-1"),
        serde_json::json!({ "status": "available" })
    );

    let entry = state
        .table_data_cache
        .get("conn-1", "tab-1")
        .into_entry()
        .expect("re-warmed entry should be available");
    assert_eq!(
        entry.value.rows,
        vec![vec![
            serde_json::json!(99),
            serde_json::Value::Number(serde_json::Number::from_f64(3.14).unwrap()),
        ]]
    );
    assert_eq!(entry.value.columns[1].name, "score");
}

#[test]
fn restore_returns_memory_hit_data() {
    let state = common::test_app_state();
    let expected = sample_response(42);
    state
        .table_data_cache
        .insert("conn-1", "tab-1", expected.clone());

    let result = restore_table_data_cache_impl(&state, "conn-1", "tab-1", "app_db", "users");

    assert_eq!(result.status, "available");
    assert_eq!(result.data, Some(expected));
}

#[test]
fn restore_rewarms_spilled_entry_from_disk() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = TableDataCache::new_for_test(1, tmp.path().to_path_buf());

    cache.insert("conn-1", "tab-1", sample_response(88));
    thread::sleep(Duration::from_millis(1500));
    cache.run_pending_tasks();
    cache.flush_spill_jobs();

    let state = AppState {
        table_data_cache: Arc::new(cache),
        ..common::test_app_state()
    };

    let result = restore_table_data_cache_impl(&state, "conn-1", "tab-1", "app_db", "users");

    assert_eq!(result.status, "available");
    assert_eq!(result.data, Some(sample_response(88)));
}

#[test]
fn restore_reports_missing_when_key_was_never_cached() {
    let state = common::test_app_state();

    let result = restore_table_data_cache_impl(&state, "conn-1", "tab-missing", "app_db", "users");

    assert_eq!(result.status, "missing");
    assert_eq!(result.data, None);
}

#[test]
fn restore_reports_expired_when_cached_entry_and_spill_are_gone() {
    let state = common::test_app_state();
    state
        .table_data_cache
        .insert("conn-1", "tab-1", sample_response(7));
    state.table_data_cache.remove("conn-1", "tab-1");
    state.table_data_cache.run_pending_tasks();

    let result = restore_table_data_cache_impl(&state, "conn-1", "tab-1", "app_db", "users");

    assert_eq!(result.status, "expired");
    assert_eq!(result.data, None);
}

#[test]
fn evict_removes_entry_and_spill_file() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = TableDataCache::new_for_test(1, tmp.path().to_path_buf());

    cache.insert("conn-1", "tab-1", sample_response(5));
    thread::sleep(Duration::from_millis(1500));
    cache.run_pending_tasks();
    cache.flush_spill_jobs();
    assert!(cache.spill_file_path("conn-1", "tab-1").exists());

    let state = AppState {
        table_data_cache: Arc::new(cache),
        ..common::test_app_state()
    };

    evict_table_data_impl(&state, "conn-1", "tab-1");

    assert_eq!(
        touch_table_data_impl(&state, "conn-1", "tab-1"),
        serde_json::json!({ "status": "missing" })
    );
    assert!(!state
        .table_data_cache
        .spill_file_path("conn-1", "tab-1")
        .exists());
}

#[test]
fn explicit_cleanup_blocks_late_table_data_reinsert() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cache = TableDataCache::new_for_test(1800, tmp.path().to_path_buf());

    let expected_version = cache.current_invalidation_version("conn-1", "tab-1");
    cache.remove_with_spill_cleanup("conn-1", "tab-1");

    let inserted =
        cache.insert_if_current("conn-1", "tab-1", expected_version, sample_response(11));

    assert!(
        !inserted,
        "late write should be dropped after explicit cleanup"
    );
    assert!(
        cache.get("conn-1", "tab-1").into_entry().is_none(),
        "no cache entry should be recreated after cleanup"
    );
}

#[test]
fn sync_after_cleanup_does_not_recreate_table_data_cache_entry() {
    let state = common::test_app_state();
    state
        .table_data_cache
        .insert("conn-1", "tab-1", sample_response(1));
    state
        .table_data_cache
        .remove_with_spill_cleanup("conn-1", "tab-1");

    let response = sample_response(9);
    let synced = sync_table_data_cache_after_insert_impl(
        &state,
        "conn-1",
        "tab-1",
        "app_db",
        "users",
        response.columns.clone(),
        response.rows.clone(),
        response.current_page,
        response.page_size,
        response.primary_key.clone(),
        response.execution_time_ms,
    );

    assert_eq!(synced.status, "missing");
    assert_eq!(
        touch_table_data_impl(&state, "conn-1", "tab-1"),
        serde_json::json!({ "status": "missing" })
    );
    assert!(
        restore_table_data_cache_impl(&state, "conn-1", "tab-1", "app_db", "users")
            .data
            .is_none(),
        "late sync should not recreate table-data cache after cleanup"
    );
}

#[test]
fn shared_maintenance_refresh_can_spare_table_data_cache_after_result_eviction() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let spill_root = tmp.path().to_path_buf();
    let result_cache = ResultCache::new_for_test_with_ram_pressure_idle(
        1800,
        spill_root.clone(),
        Duration::from_millis(1),
    );
    let table_data_cache = TableDataCache::new_for_test_with_ram_pressure_idle(
        1800,
        spill_root,
        Duration::from_millis(1),
    );

    result_cache.insert("conn-1", "results-tab", vec![stub_result("query-1")]);
    table_data_cache.insert("conn-1", "table-tab", sample_response(21));
    thread::sleep(Duration::from_millis(5));

    let total = 64_u64 * 1024 * 1024 * 1024;
    let low_available = 512_u64 * 1024 * 1024;
    let recovered_available = 12_u64 * 1024 * 1024 * 1024;
    let mut snapshot = StepMemorySnapshot::new(vec![low_available, recovered_available], total);

    result_cache.run_maintenance(&mut snapshot);
    table_data_cache.run_maintenance(&mut snapshot);
    result_cache.flush_spill_jobs();
    table_data_cache.flush_spill_jobs();

    assert!(
        result_cache
            .spill_file_path("conn-1", "results-tab")
            .exists(),
        "result cache entry should spill under RAM pressure"
    );
    assert!(
        table_data_cache
            .get("conn-1", "table-tab")
            .into_entry()
            .is_some(),
        "table-data cache entry should remain after refreshed memory recovers"
    );
}

#[test]
fn cache_sync_updates_rows_after_insert_update_and_delete() {
    let state = common::test_app_state();
    state
        .table_data_cache
        .insert("conn-1", "tab-1", sample_response(1));

    let columns = sample_response(1).columns;
    let primary_key = sample_response(1).primary_key;

    let inserted = sync_table_data_cache_after_insert_impl(
        &state,
        "conn-1",
        "tab-1",
        "app_db",
        "users",
        columns.clone(),
        vec![
            vec![serde_json::json!(1), serde_json::json!(3.14)],
            vec![serde_json::json!(2), serde_json::json!(9.5)],
        ],
        1,
        50,
        primary_key.clone(),
        20,
    );
    assert_eq!(inserted.status, "synced");

    let after_insert = restore_table_data_cache_impl(&state, "conn-1", "tab-1", "app_db", "users")
        .data
        .expect("insert sync should keep data available");
    assert_eq!(after_insert.rows.len(), 2);
    assert_eq!(
        after_insert.rows[1],
        vec![serde_json::json!(2), serde_json::json!(9.5)]
    );

    let updated = sync_table_data_cache_after_update_impl(
        &state,
        "conn-1",
        "tab-1",
        "app_db",
        "users",
        columns.clone(),
        vec![
            vec![serde_json::json!(1), serde_json::json!(4.2)],
            vec![serde_json::json!(2), serde_json::json!(9.5)],
        ],
        1,
        50,
        primary_key.clone(),
        25,
    );
    assert_eq!(updated.status, "synced");

    let after_update = restore_table_data_cache_impl(&state, "conn-1", "tab-1", "app_db", "users")
        .data
        .expect("update sync should keep data available");
    assert_eq!(
        after_update.rows[0],
        vec![serde_json::json!(1), serde_json::json!(4.2)]
    );
    assert_eq!(after_update.execution_time_ms, 25);

    let deleted = sync_table_data_cache_after_delete_impl(
        &state,
        "conn-1",
        "tab-1",
        "app_db",
        "users",
        columns,
        vec![vec![serde_json::json!(2), serde_json::json!(9.5)]],
        1,
        50,
        primary_key,
        30,
    );
    assert_eq!(deleted.status, "synced");

    let after_delete = restore_table_data_cache_impl(&state, "conn-1", "tab-1", "app_db", "users")
        .data
        .expect("delete sync should keep data available");
    assert_eq!(
        after_delete.rows,
        vec![vec![serde_json::json!(2), serde_json::json!(9.5)]]
    );
    assert_eq!(after_delete.execution_time_ms, 30);
}
