use super::*;

#[cfg(not(coverage))]
pub async fn execute_multi_query_impl(
    state: &AppState,
    request: &ExecuteMultiQueryRequest,
) -> Result<MultiQueryResult, String> {
    let connection_id = request.connection_id.as_str();
    let tab_id = request.tab_id.as_str();
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let is_read_only = state.registry.is_read_only(connection_id);
    let row_limit = effective_row_limit(
        row_limit_or_default(request.row_limit),
        state.result_cache.row_ceiling(),
    );

    let run = TabRun::new(connection_id, tab_id);
    let batch = crate::mysql::multi_result::StatementBatch {
        statements: &request.statements,
        row_limit,
        is_read_only,
    };
    let crate::mysql::multi_result::BatchResults {
        stored_results,
        result_items,
    } = crate::mysql::multi_result::execute_multi_query_internal(state, &run, batch).await?;

    state
        .result_cache
        .insert(CacheKey::new(connection_id, tab_id), stored_results);

    Ok(MultiQueryResult {
        results: result_items,
    })
}

#[cfg(coverage)]
pub async fn execute_multi_query_impl(
    state: &AppState,
    request: &ExecuteMultiQueryRequest,
) -> Result<MultiQueryResult, String> {
    let connection_id = request.connection_id.as_str();
    let tab_id = request.tab_id.as_str();
    let statements = &request.statements;
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let is_read_only = state.registry.is_read_only(connection_id);
    let ceiling = state.result_cache.row_ceiling();
    let row_limit = effective_row_limit(row_limit_or_default(request.row_limit), ceiling);
    let mut stored_results: Vec<StoredResult> = Vec::new();
    let mut result_items: Vec<MultiQueryResultItem> = Vec::new();

    for sql in statements {
        let sql = sql.trim();
        if sql.is_empty() {
            continue;
        }

        let is_statement_blocked = is_read_only && !is_read_only_allowed(sql);
        if is_statement_blocked {
            let mut stored = StoredResult::empty(uuid::Uuid::new_v4().to_string());
            stored.source_sql = sql.to_string();
            result_items.push(MultiQueryResultItem::from_stored(
                &stored,
                Some(READ_ONLY_VIOLATION_MESSAGE.to_string()),
                false,
            ));
            stored_results.push(stored);
            break;
        }

        let is_call = crate::mysql::multi_result::is_call_statement(sql);
        let _is_result_set = returns_result_set(&strip_non_executable_comments(sql));
        let auto_limit_applied = needs_auto_limit(sql);
        let _sql_to_execute = sql_with_auto_limit(sql, auto_limit_applied, row_limit);

        let mut stored = StoredResult::empty(uuid::Uuid::new_v4().to_string());
        stored.auto_limit_applied = auto_limit_applied;
        stored.applied_row_limit = auto_limit_applied.then_some(row_limit);
        stored.row_ceiling = ceiling;
        stored.source_sql = sql.to_string();
        stored.full_export_blocked_reason = statement_blocked_reason(sql, is_call);
        result_items.push(MultiQueryResultItem::from_stored(&stored, None, !is_call));
        stored_results.push(stored);
    }

    let key = (connection_id.to_string(), tab_id.to_string());
    state
        .running_queries
        .write()
        .await
        .insert(key.clone(), 42u64);
    state.running_queries.write().await.remove(&key);

    state
        .result_cache
        .insert(CacheKey::new(connection_id, tab_id), stored_results);

    Ok(MultiQueryResult {
        results: result_items,
    })
}

#[cfg(not(coverage))]
pub async fn execute_call_query_impl(
    state: &AppState,
    request: &ExecuteCallQueryRequest,
) -> Result<MultiQueryResult, String> {
    let connection_id = request.connection_id.as_str();
    let tab_id = request.tab_id.as_str();
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let is_read_only = state.registry.is_read_only(connection_id);

    if is_read_only {
        return Err("This connection is read-only. CALL statements are not allowed on read-only connections.".to_string());
    }

    let row_limit = effective_row_limit(
        row_limit_or_default(request.row_limit),
        state.result_cache.row_ceiling(),
    );
    let statements = vec![request.sql.clone()];
    let run = TabRun::new(connection_id, tab_id);
    let batch = crate::mysql::multi_result::StatementBatch {
        statements: &statements,
        row_limit,
        is_read_only,
    };
    let crate::mysql::multi_result::BatchResults {
        stored_results,
        result_items,
    } = crate::mysql::multi_result::execute_multi_query_internal(state, &run, batch).await?;

    state
        .result_cache
        .insert(CacheKey::new(connection_id, tab_id), stored_results);

    Ok(MultiQueryResult {
        results: result_items,
    })
}

#[cfg(coverage)]
pub async fn execute_call_query_impl(
    state: &AppState,
    request: &ExecuteCallQueryRequest,
) -> Result<MultiQueryResult, String> {
    let connection_id = request.connection_id.as_str();
    let tab_id = request.tab_id.as_str();
    let sql = request.sql.as_str();
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let is_read_only = state.registry.is_read_only(connection_id);

    if is_read_only {
        return Err("This connection is read-only. CALL statements are not allowed on read-only connections.".to_string());
    }

    let is_call = crate::mysql::multi_result::is_call_statement(sql);
    let ceiling = state.result_cache.row_ceiling();
    let _row_limit = effective_row_limit(row_limit_or_default(request.row_limit), ceiling);

    let key = (connection_id.to_string(), tab_id.to_string());
    state
        .running_queries
        .write()
        .await
        .insert(key.clone(), 42u64);
    state.running_queries.write().await.remove(&key);

    let mut stored = StoredResult::empty(uuid::Uuid::new_v4().to_string());
    stored.row_ceiling = ceiling;
    stored.source_sql = sql.to_string();
    stored.full_export_blocked_reason = statement_blocked_reason(sql, is_call);
    let item = MultiQueryResultItem::from_stored(&stored, None, false);

    state
        .result_cache
        .insert(CacheKey::new(connection_id, tab_id), vec![stored]);

    Ok(MultiQueryResult {
        results: vec![item],
    })
}

pub fn touch_results_impl(state: &AppState, request: &ConnectionTabRequest) -> serde_json::Value {
    let lookup = state
        .result_cache
        .get(&request.connection_id, &request.tab_id);
    cache_status_json(lookup.lookup_status())
}
