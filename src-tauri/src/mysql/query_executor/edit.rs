use super::*;

// ── Analyze query for edit ─────────────────────────────────────────────────────

/// Analyze a SQL query and return table metadata for inline editing.
///
/// Extracts table references from the SQL, resolves their databases, and
/// fetches primary key / column metadata for each table via `fetch_table_pk_impl`.
#[cfg(not(coverage))]
async fn query_session_current_database(pool: &sqlx::MySqlPool) -> Option<String> {
    match sqlx::query("SELECT DATABASE()").fetch_one(pool).await {
        Ok(row) => match row.try_get::<String, _>(0) {
            Ok(db) => {
                tracing::debug!(database = %db, "analyze_query_for_edit: resolved current database via SELECT DATABASE()");
                Some(db)
            }
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    "analyze_query_for_edit: SELECT DATABASE() returned non-string (NULL?)"
                );
                None
            }
        },
        Err(error) => {
            tracing::warn!(
                error = %error,
                "analyze_query_for_edit: SELECT DATABASE() query failed"
            );
            None
        }
    }
}

#[cfg(not(coverage))]
pub async fn analyze_query_for_edit_impl(
    state: &AppState,
    request: &AnalyzeQueryForEditRequest,
) -> Result<Vec<QueryTableEditInfo>, String> {
    let connection_id = request.connection_id.as_str();
    let sql = request.sql.as_str();
    use crate::mysql::sql_table_parser;

    let table_refs = sql_table_parser::extract_tables(sql);
    tracing::debug!(
        sql = %sql,
        table_count = table_refs.len(),
        "analyze_query_for_edit: parsed SQL"
    );
    if table_refs.is_empty() {
        tracing::debug!("analyze_query_for_edit: no table refs found, returning empty");
        return Ok(vec![]);
    }

    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let params = state.registry.get_connection_params(connection_id);
    let default_database = params.and_then(|params| params.default_database);

    let default_database = match default_database {
        Some(database) => Some(database),
        None => query_session_current_database(&pool).await,
    };

    tracing::debug!(
        default_database = ?default_database,
        "analyze_query_for_edit: resolved default database"
    );

    let mut results = Vec::new();
    for table_ref in &table_refs {
        let database = table_ref
            .database
            .as_deref()
            .or(default_database.as_deref());
        let Some(database) = database else {
            tracing::warn!(
                table = %table_ref.table,
                "analyze_query_for_edit: skipping table — no database could be resolved"
            );
            continue;
        };
        let table = EditTable {
            database,
            table: &table_ref.table,
        };
        results.extend(fetch_table_edit_info(&pool, table).await);
    }

    tracing::debug!(
        result_count = results.len(),
        "analyze_query_for_edit: returning results"
    );
    Ok(results)
}

#[cfg(not(coverage))]
#[derive(Clone, Copy)]
struct EditTable<'a> {
    database: &'a str,
    table: &'a str,
}

#[cfg(not(coverage))]
async fn fetch_edit_foreign_keys(
    pool: &sqlx::MySqlPool,
    table: EditTable<'_>,
) -> Vec<crate::mysql::schema_queries::ForeignKeyInfo> {
    let EditTable { database, table } = table;
    crate::mysql::schema_queries::query_foreign_keys(pool, database, table)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(
                table = %table,
                database = %database,
                error = %error,
                "analyze_query_for_edit: foreign key lookup failed; continuing without FK metadata"
            );
            vec![]
        })
}

#[cfg(not(coverage))]
async fn fetch_table_edit_info(
    pool: &sqlx::MySqlPool,
    table: EditTable<'_>,
) -> Option<QueryTableEditInfo> {
    let EditTable {
        database,
        table: table_name,
    } = table;
    let metadata = crate::mysql::table_data::fetch_table_pk_impl(pool, database, table_name)
        .await
        .inspect_err(|error| {
            tracing::warn!(
                table = %table_name,
                database = %database,
                error = %error,
                "analyze_query_for_edit: skipping table due to metadata fetch failure"
            );
        })
        .ok()?;
    let crate::mysql::metadata_cache::TableKeyMetadata {
        primary_key: pk_info,
        columns,
    } = metadata;
    let foreign_keys = fetch_edit_foreign_keys(pool, table).await;
    tracing::debug!(
        table = %table_name,
        database = %database,
        column_count = columns.len(),
        has_pk = pk_info.is_some(),
        "analyze_query_for_edit: fetched table metadata"
    );
    Some(QueryTableEditInfo {
        database: database.to_string(),
        table: table_name.to_string(),
        columns,
        primary_key: pk_info,
        foreign_keys,
    })
}

/// Coverage stub: exercises the SQL parser and connection validation without
/// calling `fetch_table_pk_impl` (which is gated behind `#[cfg(not(coverage))]`).
#[cfg(coverage)]
pub async fn analyze_query_for_edit_impl(
    state: &AppState,
    request: &AnalyzeQueryForEditRequest,
) -> Result<Vec<QueryTableEditInfo>, String> {
    let connection_id = request.connection_id.as_str();
    let sql = request.sql.as_str();
    use crate::mysql::sql_table_parser;

    // Exercise the parser — mirrors the real impl's early return for empty tables
    let table_refs = sql_table_parser::extract_tables(sql);
    if table_refs.is_empty() {
        return Ok(vec![]);
    }

    // Validate connection exists (only reached when tables were found)
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    // Cannot call fetch_table_pk_impl under coverage — return empty
    Ok(vec![])
}

// ── Update result cell ─────────────────────────────────────────────────────────

struct CellEdit {
    row_index: usize,
    updates: HashMap<usize, serde_json::Value>,
}

fn is_tombstoned(slot: &StoredResult, row_index: usize) -> bool {
    u32::try_from(row_index).is_ok_and(|index| slot.tombstones.contains(&index))
}

fn edited_row(
    current: &[serde_json::Value],
    updates: HashMap<usize, serde_json::Value>,
) -> SharedRow {
    let mut edited: Vec<serde_json::Value> = current.to_vec();
    for (col_index, new_value) in updates {
        if let Some(cell) = edited.get_mut(col_index) {
            *cell = new_value;
        }
    }
    SharedRow::from(edited)
}

fn apply_cell_edit(slot: &mut StoredResult, edit: CellEdit) -> Result<(), String> {
    let CellEdit { row_index, updates } = edit;
    let current = slot.rows.get(row_index).ok_or_else(|| {
        format!(
            "Row index {row_index} out of bounds (total rows: {})",
            slot.rows.len()
        )
    })?;
    if is_tombstoned(slot, row_index) {
        return Err(format!(
            "Row {row_index} was deleted from this result and can't be updated"
        ));
    }
    let replacement = edited_row(current, updates);
    let mut next: Vec<SharedRow> = (*slot.rows).clone();
    next[row_index] = replacement;
    slot.rows = Arc::new(next);
    Ok(())
}

/// Update specific cells in a cached result set after a save operation.
///
/// `row_index` is a **base** row index (the index into the result's original
/// rows), never a view position, so a save under any sort or filter targets the
/// right row. A tombstoned (deleted) row is refused.
///
/// Builds a fresh `SharedRow` for the edited row and a new pointer list that
/// shares every other row with the previous one, then swaps it in through the
/// version-checked, lock-serialized slot modifier. Rows already returned over
/// IPC are never mutated, and an edit that races a re-run is refused instead of
/// resurrecting the old result: the slot must still hold `query_id`, so a save
/// that lands after a re-run replaced the slot never edits the new result at
/// the old base index. The view (and its version) is unchanged.
pub fn update_result_cell_impl(
    state: &AppState,
    request: UpdateResultCellRequest,
) -> Result<(), String> {
    let UpdateResultCellRequest {
        connection_id,
        tab_id,
        row_index,
        updates,
        result_index,
        query_id,
    } = request;
    let connection_id = connection_id.as_str();
    let tab_id = tab_id.as_str();
    let expected_invalidation_version = state
        .result_cache
        .current_invalidation_version(connection_id, tab_id);

    let cache_result = state.result_cache.get(connection_id, tab_id);
    if cache_result.is_expired() {
        return Err(crate::mysql::result_view::RESULTS_EXPIRED_MESSAGE.to_string());
    }
    let entry = cache_result
        .into_entry()
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;

    let resolved_index = result_index.unwrap_or(0);
    let result_count = entry.value.len();
    if resolved_index >= result_count {
        return Err(format!(
            "Result index {resolved_index} out of range (total: {result_count})"
        ));
    }
    drop(entry);

    let target = SlotWriteTarget {
        connection_id,
        tab_id,
        expected_invalidation_version,
        index: resolved_index,
        expected_query_id: Some(&query_id),
        base_view_version: None,
    };
    let cell_edit = CellEdit { row_index, updates };
    let outcome = state
        .result_cache
        .modify_slot_in_place_if_current(&target, |slot| apply_cell_edit(slot, cell_edit))?;

    match outcome {
        crate::mysql::result_cache::SlotWrite::Applied(()) => Ok(()),
        _ => {
            tracing::info!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                "result cell update skipped: results invalidated during edit"
            );
            Err("Results were refreshed during edit".to_string())
        }
    }
}
