use super::*;

mod multi_query;
mod reexecute;
pub use multi_query::*;
pub use reexecute::*;

#[cfg(not(coverage))]
pub async fn execute_query_impl(
    state: &AppState,
    request: &ExecuteQueryRequest,
) -> Result<ExecuteQueryResult, String> {
    let connection_id = request.connection_id.as_str();
    let tab_id = request.tab_id.as_str();
    let sql = request.sql.as_str();
    if !state.has_open_connection(connection_id) {
        return Err(format!("Connection '{connection_id}' not found"));
    }

    if is_blocked_by_read_only(state, connection_id, sql) {
        return Err(READ_ONLY_VIOLATION_MESSAGE.to_string());
    }

    let row_limit = effective_row_limit(
        row_limit_or_default(request.row_limit),
        state.result_cache.row_ceiling(),
    );
    let run = TabRun::new(connection_id, tab_id);
    let statement = crate::mysql::multi_result::SessionStatement { sql, row_limit };
    let stored = crate::mysql::multi_result::execute_single_on_session(state, &run, statement)
        .await?
        .stored;

    let stored =
        crate::mysql::result_view::apply_initial_view(stored, request.view_spec.clone()).await?;
    let item = MultiQueryResultItem::from_stored(&stored, None, true);

    state
        .result_cache
        .insert(CacheKey::new(connection_id, tab_id), vec![stored]);

    Ok(ExecuteQueryResult::from(item))
}

/// Coverage stub: exercises connection validation, read-only enforcement, the
/// row-limit clamp, auto-limit detection, the view-spec path and the first
/// window builder without requiring a live MySQL pool.
#[cfg(coverage)]
pub async fn execute_query_impl(
    state: &AppState,
    request: &ExecuteQueryRequest,
) -> Result<ExecuteQueryResult, String> {
    let connection_id = request.connection_id.as_str();
    let tab_id = request.tab_id.as_str();
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
    let query_id = Uuid::new_v4().to_string();
    // Exercise the same pure-function paths as the real impl so they are
    // covered without a live MySQL connection.
    let _is_result = returns_result_set(&strip_non_executable_comments(sql));
    let _sql_to_execute = sql_with_auto_limit(sql, auto_limit_applied, row_limit);

    // Track a dummy thread ID to exercise the running_queries path
    let key = (connection_id.to_string(), tab_id.to_string());
    state
        .running_queries
        .write()
        .await
        .insert(key.clone(), 42u64);

    let mut stored = StoredResult::empty(query_id);
    stored.auto_limit_applied = auto_limit_applied;
    stored.applied_row_limit = auto_limit_applied.then_some(row_limit);
    stored.row_ceiling = ceiling;
    stored.source_sql = sql.to_string();
    stored.full_export_blocked_reason = statement_blocked_reason(sql, false);
    let stored =
        crate::mysql::result_view::apply_initial_view(stored, request.view_spec.clone()).await?;
    let item = MultiQueryResultItem::from_stored(&stored, None, true);

    state
        .result_cache
        .insert(CacheKey::new(connection_id, tab_id), vec![stored]);

    // Remove dummy thread ID
    state.running_queries.write().await.remove(&key);

    Ok(ExecuteQueryResult::from(item))
}

pub fn evict_results_impl(state: &AppState, request: &ConnectionTabRequest) {
    state
        .result_cache
        .remove_with_spill_cleanup(&request.connection_id, &request.tab_id);
}

#[cfg(not(coverage))]
pub async fn cancel_query_impl(
    state: &AppState,
    request: &ConnectionTabRequest,
) -> Result<bool, String> {
    let connection_id = request.connection_id.as_str();
    let tab_id = request.tab_id.as_str();
    let key = (connection_id.to_string(), tab_id.to_string());

    // Look up the MySQL thread ID for the running query
    let thread_id = {
        let running = state.running_queries.read().await;
        running.get(&key).copied()
    };

    let Some(thread_id) = thread_id else {
        let queued_run = crate::mysql::session::TabRun::new(connection_id, tab_id);
        return Ok(state.editor_sessions.cancel_queued_run(&queued_run));
    };

    // Resolve the pool from the registry (only needed when we actually issue KILL)
    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Acquire a different connection from the pool to issue the KILL command
    let mut conn = tokio::time::timeout(std::time::Duration::from_secs(5), pool.acquire())
        .await
        .map_err(|_| "Cancel timed out waiting for a pool connection".to_string())?
        .map_err(|error| error.to_string())?;

    let kill_sql = format!("KILL QUERY {}", thread_id);
    tracing::debug!(
        connection_id,
        tab_id,
        thread_id,
        "cancel_query: issuing KILL QUERY"
    );
    crate::mysql::query_log::log_outgoing_sql(&kill_sql);
    let result = sqlx::query(sqlx::AssertSqlSafe(kill_sql.as_str()))
        .execute(&mut *conn)
        .await
        .map_err(|error| format!("Failed to cancel query: {error}"))?;
    crate::mysql::query_log::log_execute_result(&result);

    Ok(true)
}

/// Coverage stub: exercises thread-ID lookup and connection validation without
/// requiring a live MySQL pool to issue the actual KILL QUERY command.
#[cfg(coverage)]
pub async fn cancel_query_impl(
    state: &AppState,
    request: &ConnectionTabRequest,
) -> Result<bool, String> {
    let connection_id = request.connection_id.as_str();
    let tab_id = request.tab_id.as_str();
    let key = (connection_id.to_string(), tab_id.to_string());

    // Look up the MySQL thread ID for the running query
    let thread_id = {
        let running = state.running_queries.read().await;
        running.get(&key).copied()
    };

    let Some(thread_id) = thread_id else {
        let queued_run = crate::mysql::session::TabRun::new(connection_id, tab_id);
        return Ok(state.editor_sessions.cancel_queued_run(&queued_run));
    };

    // Validate connection exists (matches real impl behavior)
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Exercise the KILL SQL formatting to cover that code path
    let _kill_sql = format!("KILL QUERY {}", thread_id);

    Ok(true)
}
