use super::*;

pub fn touch_table_data_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
) -> serde_json::Value {
    let lookup = state.table_data_cache.get(connection_id, tab_id);
    cache_status_json(lookup.lookup_status())
}

pub(super) struct TableCacheTarget<'a> {
    connection_id: &'a str,
    tab_id: &'a str,
    database: &'a str,
    table: &'a str,
}

impl TableCacheTarget<'_> {
    fn log_cache_miss(&self, message: &str) {
        tracing::debug!(
            connection_id = %self.connection_id,
            tab_id = %self.tab_id,
            database = %self.database,
            table = %self.table,
            "{message}"
        );
    }
}

pub fn restore_table_data_cache_impl(
    state: &AppState,
    request: &RestoreTableDataCacheRequest,
) -> TableDataCacheRestoreResponse {
    let target = TableCacheTarget {
        connection_id: &request.connection_id,
        tab_id: &request.tab_id,
        database: &request.database,
        table: &request.table,
    };
    let lookup = state
        .table_data_cache
        .get(&request.connection_id, &request.tab_id);
    let status = lookup.lookup_status();
    if let Some(entry) = lookup.into_entry() {
        return TableDataCacheRestoreResponse {
            status,
            data: Some(entry.value.clone()),
        };
    }
    target.log_cache_miss(restore_miss_message(status));
    TableDataCacheRestoreResponse { status, data: None }
}

pub(super) fn restore_miss_message(status: CacheStatus) -> &'static str {
    if status == CacheStatus::Expired {
        return "table-data cache restore missed: entry expired";
    }
    "table-data cache restore missed: entry missing"
}

pub(super) fn sync_miss_message(status: CacheStatus) -> &'static str {
    if status == CacheStatus::Expired {
        return "table-data cache sync skipped: entry expired";
    }
    "table-data cache sync skipped: entry missing"
}

pub(super) fn sync_table_data_cache_response(
    state: &AppState,
    target: &TableCacheTarget<'_>,
    response: TableDataResponse,
) -> TableDataCacheSyncResponse {
    let expected_invalidation_version = state
        .table_data_cache
        .current_invalidation_version(target.connection_id, target.tab_id);
    let lookup_status = state
        .table_data_cache
        .get(target.connection_id, target.tab_id)
        .lookup_status();
    if lookup_status != CacheStatus::Available {
        target.log_cache_miss(sync_miss_message(lookup_status));
        return TableDataCacheSyncResponse {
            status: lookup_status,
        };
    }
    let write = VersionedValue {
        expected_invalidation_version,
        value: response,
    };
    let was_written = state
        .table_data_cache
        .insert_if_current(CacheKey::new(target.connection_id, target.tab_id), write);
    if was_written {
        return TableDataCacheSyncResponse {
            status: CacheStatus::Synced,
        };
    }
    tracing::debug!(
        connection_id = %target.connection_id,
        tab_id = %target.tab_id,
        database = %target.database,
        table = %target.table,
        expected_invalidation_version,
        "table-data cache sync skipped: entry invalidated before write"
    );
    TableDataCacheSyncResponse {
        status: CacheStatus::Missing,
    }
}

pub fn sync_table_data_cache_after_write_impl(
    state: &AppState,
    request: SyncTableDataCacheRequest,
) -> TableDataCacheSyncResponse {
    let target = TableCacheTarget {
        connection_id: &request.connection_id,
        tab_id: &request.tab_id,
        database: &request.database,
        table: &request.table,
    };
    let response = TableDataResponse {
        columns: request.columns,
        rows: Arc::new(request.rows.into_iter().map(SharedRow::from).collect()),
        current_page: request.current_page,
        page_size: request.page_size,
        primary_key: request.primary_key,
        execution_time_ms: request.execution_time_ms,
    };
    sync_table_data_cache_response(state, &target, response)
}

pub fn evict_table_data_impl(state: &AppState, connection_id: &str, tab_id: &str) {
    state
        .table_data_cache
        .remove_with_spill_cleanup(connection_id, tab_id);
}
