use super::*;

pub(super) fn superseded(current: u64) -> String {
    format!("{VIEW_SUPERSEDED_PREFIX} current={current}")
}

pub(crate) struct SlotRef {
    pub(super) entry: Arc<CachedResultEntry>,
    pub(super) index: usize,
}

impl std::ops::Deref for SlotRef {
    type Target = StoredResult;

    fn deref(&self) -> &StoredResult {
        &self.entry.value[self.index]
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultSlotKey {
    pub connection_id: String,
    pub tab_id: String,
    pub result_index: usize,
    pub query_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetResultViewRequest {
    #[serde(flatten)]
    pub slot: ResultSlotKey,
    pub base_view_version: u64,
    pub view_spec: ResultViewSpec,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResultWindowRequest {
    #[serde(flatten)]
    pub slot: ResultSlotKey,
    pub view_version: u64,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveResultRowsRequest {
    #[serde(flatten)]
    pub slot: ResultSlotKey,
    pub base_view_version: u64,
    pub base_indices: Vec<u32>,
}

pub(super) fn read_slot(state: &AppState, key: &ResultSlotKey) -> Result<SlotRef, String> {
    let ResultSlotKey {
        connection_id,
        tab_id,
        result_index,
        query_id,
    } = key;
    let result_index = *result_index;
    let cache_result = state.result_cache.get(connection_id, tab_id);
    if cache_result.is_expired() {
        return Err(RESULTS_EXPIRED_MESSAGE.to_string());
    }
    let entry = cache_result
        .into_entry()
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;
    let slot = entry.value.get(result_index).ok_or_else(|| {
        format!(
            "Result index {result_index} out of range (total: {})",
            entry.value.len()
        )
    })?;
    if slot.query_id != *query_id {
        return Err(STALE_QUERY_MESSAGE.to_string());
    }
    Ok(SlotRef {
        entry,
        index: result_index,
    })
}

#[derive(Debug)]
pub struct PreparedView {
    pub(super) slot: ResultSlotKey,
    pub(super) base_view_version: u64,
    pub(super) expected_invalidation_version: u64,
    pub(super) view: Option<Arc<Vec<u32>>>,
    pub(super) effective_spec: ResultViewSpec,
}

pub fn prepare_result_view(
    state: &AppState,
    request: &SetResultViewRequest,
) -> Result<PreparedView, String> {
    let base_view_version = request.base_view_version;
    let expected_invalidation_version = state
        .result_cache
        .current_invalidation_version(&request.slot.connection_id, &request.slot.tab_id);
    let slot = read_slot(state, &request.slot)?;
    ensure_query_result(&slot)?;
    if slot.view_version != base_view_version {
        return Err(superseded(slot.view_version));
    }
    let resolved = resolve_spec(&request.view_spec, &slot.columns, SpecMode::Strict)?;
    let view = build_view(&slot.rows, &slot.tombstones, &resolved);
    Ok(PreparedView {
        slot: request.slot.clone(),
        base_view_version,
        expected_invalidation_version,
        view,
        effective_spec: resolved.effective,
    })
}

pub(super) fn map_slot_write<T>(outcome: SlotWrite<T>) -> Result<T, String> {
    match outcome {
        SlotWrite::Applied(value) => Ok(value),
        SlotWrite::ViewSuperseded { current } => Err(superseded(current)),
        SlotWrite::QueryIdMismatch | SlotWrite::Invalidated => Err(STALE_QUERY_MESSAGE.to_string()),
    }
}

pub fn commit_result_view(
    state: &AppState,
    prepared: PreparedView,
) -> Result<SetResultViewResult, String> {
    let PreparedView {
        slot: slot_key,
        base_view_version,
        expected_invalidation_version,
        view,
        effective_spec,
    } = prepared;
    let connection_id = &slot_key.connection_id;
    let tab_id = &slot_key.tab_id;
    let target = SlotWriteTarget {
        connection_id,
        tab_id,
        expected_invalidation_version,
        index: slot_key.result_index,
        expected_query_id: Some(&slot_key.query_id),
        base_view_version: Some(base_view_version),
    };
    let outcome = state
        .result_cache
        .modify_slot_in_place_if_current(&target, |slot| {
            slot.view = view;
            slot.view_spec = effective_spec;
            slot.view_version += 1;
            Ok(slot.clone())
        })?;
    let slot = map_slot_write(outcome).inspect_err(|error| {
        tracing::debug!(connection_id = %connection_id, tab_id = %tab_id, error = %error, "set_result_view write refused");
    })?;
    Ok(SetResultViewResult {
        view_version: slot.view_version,
        view_row_count: view_len(&slot),
        total_rows: slot.live_row_count(),
        first_window: first_window(&slot),
    })
}

pub fn set_result_view_impl(
    state: &AppState,
    request: &SetResultViewRequest,
) -> Result<SetResultViewResult, String> {
    let prepared = prepare_result_view(state, request)?;
    commit_result_view(state, prepared)
}

pub fn fetch_result_window_impl(
    state: &AppState,
    request: &FetchResultWindowRequest,
) -> Result<FetchResultWindowResult, String> {
    let view_version = request.view_version;
    let slot = read_slot(state, &request.slot)?;
    if slot.view_version != view_version {
        return Err(format!(
            "{VIEW_STALE_PREFIX} requested={view_version} current={}",
            slot.view_version
        ));
    }
    let window = slice_window(&slot, request.offset, request.limit);
    Ok(FetchResultWindowResult {
        offset: window.offset,
        rows: window.rows,
        base_indices: window.base_indices,
        view_row_count: view_len(&slot),
        view_version: slot.view_version,
    })
}

pub fn remove_result_rows_impl(
    state: &AppState,
    request: &RemoveResultRowsRequest,
) -> Result<RemoveResultRowsResult, String> {
    let slot_key = &request.slot;
    let base_view_version = request.base_view_version;
    let base_indices = &request.base_indices;
    let expected_invalidation_version = state
        .result_cache
        .current_invalidation_version(&slot_key.connection_id, &slot_key.tab_id);
    let slot = read_slot(state, slot_key)?;
    if slot.view_version != base_view_version {
        return Err(superseded(slot.view_version));
    }

    let row_count = slot.rows.len() as u32;
    let mut tombstones = (*slot.tombstones).clone();
    tombstones.extend(
        base_indices
            .iter()
            .copied()
            .filter(|&row_index| row_index < row_count),
    );
    let view: Vec<u32> = match &slot.view {
        Some(view) => view
            .iter()
            .copied()
            .filter(|row_index| !tombstones.contains(row_index))
            .collect(),
        None => (0..row_count)
            .filter(|row_index| !tombstones.contains(row_index))
            .collect(),
    };
    let tombstones = Arc::new(tombstones);
    let view = Arc::new(view);

    let target = SlotWriteTarget {
        connection_id: &slot_key.connection_id,
        tab_id: &slot_key.tab_id,
        expected_invalidation_version,
        index: slot_key.result_index,
        expected_query_id: Some(&slot_key.query_id),
        base_view_version: Some(base_view_version),
    };
    let outcome = state
        .result_cache
        .modify_slot_in_place_if_current(&target, |slot| {
            slot.tombstones = tombstones;
            slot.view = Some(view);
            slot.view_version += 1;
            Ok(RemoveResultRowsResult {
                view_version: slot.view_version,
                view_row_count: view_len(slot),
                total_rows: slot.live_row_count(),
            })
        })?;
    map_slot_write(outcome)
}
