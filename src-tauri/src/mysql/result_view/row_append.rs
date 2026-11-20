use super::*;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendResultRowRequest {
    #[serde(flatten)]
    pub slot: ResultSlotKey,
    pub base_view_version: u64,
    pub row: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendResultRowResult {
    pub base_index: u32,
    pub view_version: u64,
    pub view_row_count: usize,
    pub total_rows: usize,
    pub window: ResultWindow,
}

fn row_ceiling_reached(row_ceiling: usize) -> String {
    format!("{ROW_CEILING_REACHED_PREFIX} ceiling={row_ceiling}")
}

fn appended_view(slot: &StoredResult, base_index: u32) -> Option<Arc<Vec<u32>>> {
    let view = slot.view.as_ref()?;
    let mut extended = Vec::with_capacity(view.len() + 1);
    extended.extend_from_slice(view);
    extended.push(base_index);
    Some(Arc::new(extended))
}

fn append_row_to_slot(slot: &mut StoredResult, row: SharedRow) -> AppendResultRowResult {
    let base_index = slot.rows.len() as u32;
    let mut rows = Vec::with_capacity(slot.rows.len() + 1);
    rows.extend(slot.rows.iter().cloned());
    rows.push(row);
    slot.rows = Arc::new(rows);
    slot.view = appended_view(slot, base_index);
    slot.view_version += 1;
    let view_row_count = view_len(slot);
    AppendResultRowResult {
        base_index,
        view_version: slot.view_version,
        view_row_count,
        total_rows: slot.live_row_count(),
        window: slice_window(slot, view_row_count - 1, 1),
    }
}

pub fn append_result_row_impl(
    state: &AppState,
    request: &AppendResultRowRequest,
) -> Result<AppendResultRowResult, String> {
    let slot_key = &request.slot;
    let expected_invalidation_version = state
        .result_cache
        .current_invalidation_version(&slot_key.connection_id, &slot_key.tab_id);
    let slot = read_slot(state, slot_key)?;
    if slot.view_version != request.base_view_version {
        return Err(superseded(slot.view_version));
    }
    if slot.rows.len() >= slot.row_ceiling {
        return Err(row_ceiling_reached(slot.row_ceiling));
    }
    let row: SharedRow = Arc::from(request.row.as_slice());

    let target = SlotWriteTarget {
        connection_id: &slot_key.connection_id,
        tab_id: &slot_key.tab_id,
        expected_invalidation_version,
        index: slot_key.result_index,
        expected_query_id: Some(&slot_key.query_id),
        base_view_version: Some(request.base_view_version),
    };
    let outcome = state
        .result_cache
        .modify_slot_in_place_if_current(&target, |slot| Ok(append_row_to_slot(slot, row)))?;
    map_slot_write(outcome).inspect_err(|error| {
        tracing::debug!(
            connection_id = %slot_key.connection_id,
            tab_id = %slot_key.tab_id,
            error = %error,
            "append_result_row write refused"
        );
    })
}
