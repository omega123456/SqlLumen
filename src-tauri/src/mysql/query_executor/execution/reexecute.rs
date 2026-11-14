use super::*;

pub(super) fn capture_reexecute_target(
    state: &AppState,
    request: &ReexecuteSingleResultRequest,
) -> Result<String, String> {
    let tab_id = request.tab_id.as_str();
    let result_index = request.result_index;
    let cache_result = state.result_cache.get(&request.connection_id, tab_id);
    if cache_result.is_expired() {
        return Err(crate::mysql::result_view::RESULTS_EXPIRED_MESSAGE.to_string());
    }
    let entry = cache_result
        .into_entry()
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;
    let result_vec = &entry.value;
    let result_count = result_vec.len();
    if result_index >= result_count {
        return Err(format!(
            "Result index {result_index} out of range (total: {result_count})"
        ));
    }
    Ok(result_vec[result_index].query_id.clone())
}

pub(super) struct ReexecutedSlot<'a> {
    pub(super) request: &'a ReexecuteSingleResultRequest,
    pub(super) expected_query_id: String,
    pub(super) stored: StoredResult,
}

pub(super) fn replace_reexecuted_slot(
    state: &AppState,
    replacement: ReexecutedSlot<'_>,
) -> Result<(), String> {
    let ReexecutedSlot {
        request,
        expected_query_id,
        stored,
    } = replacement;
    let connection_id = request.connection_id.as_str();
    let tab_id = request.tab_id.as_str();
    let result_index = request.result_index;
    let entry = match state.result_cache.get(connection_id, tab_id).into_entry() {
        Some(found) => found,
        None => {
            tracing::warn!(
                tab_id,
                result_index,
                "reexecute_single_result: tab results disappeared after await — discarding stale result"
            );
            return Err(
                "Tab results no longer exist — a newer query may have replaced them".to_string(),
            );
        }
    };
    let mut result_vec = entry.value.clone();
    let result_count = result_vec.len();
    if result_index >= result_count {
        tracing::warn!(
            tab_id,
            result_index,
            result_vec_len = result_count,
            "reexecute_single_result: result_index out of range after await — discarding stale result"
        );
        return Err(format!(
            "Result index {result_index} out of range after re-execution (total: {result_count}) — a newer query may have replaced the results"
        ));
    }
    let actual_query_id = &result_vec[result_index].query_id;
    if *actual_query_id != expected_query_id {
        tracing::warn!(
            tab_id,
            result_index,
            expected_query_id = %expected_query_id,
            actual_query_id = %actual_query_id,
            "reexecute_single_result: query_id mismatch after await — discarding stale result"
        );
        return Err("Result was replaced by a newer query during re-execution".to_string());
    }
    result_vec[result_index] = stored;
    state
        .result_cache
        .insert(CacheKey::new(connection_id, tab_id), result_vec);
    Ok(())
}

#[cfg(not(coverage))]
pub async fn reexecute_single_result_impl(
    state: &AppState,
    request: &ReexecuteSingleResultRequest,
) -> Result<MultiQueryResultItem, String> {
    let connection_id = request.connection_id.as_str();
    let sql = request.sql.as_str();
    if !state.has_open_connection(connection_id) {
        return Err(format!("Connection '{connection_id}' not found"));
    }

    if is_blocked_by_read_only(state, connection_id, sql) {
        return Err(READ_ONLY_VIOLATION_MESSAGE.to_string());
    }

    let expected_query_id = capture_reexecute_target(state, request)?;

    let row_limit = effective_row_limit(
        row_limit_or_default(request.row_limit),
        state.result_cache.row_ceiling(),
    );
    let run = TabRun::new(connection_id, &request.tab_id);
    let statement = crate::mysql::multi_result::SessionStatement { sql, row_limit };
    let stored = crate::mysql::multi_result::execute_single_on_session(state, &run, statement)
        .await?
        .stored;
    let stored =
        crate::mysql::result_view::apply_initial_view(stored, request.view_spec.clone()).await?;
    let item = MultiQueryResultItem::from_stored(&stored, None, true);

    let replacement = ReexecutedSlot {
        request,
        expected_query_id,
        stored,
    };
    replace_reexecuted_slot(state, replacement)?;

    Ok(item)
}

#[cfg(coverage)]
pub async fn reexecute_single_result_impl(
    state: &AppState,
    request: &ReexecuteSingleResultRequest,
) -> Result<MultiQueryResultItem, String> {
    let connection_id = request.connection_id.as_str();
    let tab_id = request.tab_id.as_str();
    let result_index = request.result_index;
    let sql = request.sql.as_str();
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    if is_blocked_by_read_only(state, connection_id, sql) {
        return Err(READ_ONLY_VIOLATION_MESSAGE.to_string());
    }

    let ceiling = state.result_cache.row_ceiling();
    let row_limit = effective_row_limit(row_limit_or_default(request.row_limit), ceiling);
    let auto_limit_applied = needs_auto_limit(sql);
    let _is_result = returns_result_set(&strip_non_executable_comments(sql));
    let _sql_to_execute = sql_with_auto_limit(sql, auto_limit_applied, row_limit);

    let expected_query_id = capture_reexecute_target(state, request)?;

    let previous = state
        .result_cache
        .get(connection_id, tab_id)
        .into_entry()
        .and_then(|entry| entry.value.get(result_index).cloned());
    let mut stored = StoredResult::empty(Uuid::new_v4().to_string());
    if let Some(previous) = previous {
        stored.columns = previous.columns;
        stored.rows = previous.rows;
    }
    stored.auto_limit_applied = auto_limit_applied;
    stored.applied_row_limit = auto_limit_applied.then_some(row_limit);
    stored.row_ceiling = ceiling;
    stored.source_sql = sql.to_string();
    stored.full_export_blocked_reason = statement_blocked_reason(sql, false);
    let stored =
        crate::mysql::result_view::apply_initial_view(stored, request.view_spec.clone()).await?;
    let item = MultiQueryResultItem::from_stored(&stored, None, true);

    let replacement = ReexecutedSlot {
        request,
        expected_query_id,
        stored,
    };
    replace_reexecuted_slot(state, replacement)?;

    Ok(item)
}
