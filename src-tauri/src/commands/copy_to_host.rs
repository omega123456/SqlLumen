//! Tauri commands for the "Copy to Another Host" feature.
//!
//! Phase 1 implements only object enumeration (`list_copyable_objects`): given a
//! source connection and database, it returns the copyable schema objects grouped
//! into the five supported categories — Tables, Procedures, Functions, Triggers,
//! and Events. Views and system schemas are always excluded.
//!
//! The thin `#[tauri::command]` wrapper cannot be unit-tested (it requires the
//! Tauri runtime), so it is guarded by the same `#[cfg(not(coverage))]` real
//! wrapper + `#[cfg(coverage)]` stub idiom used in `commands/sql_dump.rs`.

use serde::{Deserialize, Serialize};

use crate::export::copy_to_host::{
    new_running_progress, validate_selection_for_options, CopyToHostParams,
};
use crate::mysql::query_log;
use crate::mysql::schema_queries::decode_mysql_text_cell_named;
use crate::state::{AppState, CopyJobProgress};

/// A table available to copy, with its estimated row count.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyableTable {
    pub name: String,
    pub estimated_rows: u64,
}

/// The grouped set of copyable objects for a source database.
///
/// Views are intentionally excluded everywhere; this feature copies only base
/// tables, stored procedures, functions, triggers, and events.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyableObjects {
    pub tables: Vec<CopyableTable>,
    pub procedures: Vec<String>,
    pub functions: Vec<String>,
    pub triggers: Vec<String>,
    pub events: Vec<String>,
}

/// System schemas that are never offered for copy.
pub const SYSTEM_SCHEMAS: [&str; 4] = ["information_schema", "performance_schema", "mysql", "sys"];

/// `true` if the given schema name is a MySQL system schema (case-insensitive).
pub fn is_system_schema(schema: &str) -> bool {
    let lower = schema.to_ascii_lowercase();
    SYSTEM_SCHEMAS.contains(&lower.as_str())
}

/// `true` if the given `information_schema.TABLES.TABLE_TYPE` denotes a base table.
///
/// Views report `TABLE_TYPE = 'VIEW'` (and other non-base types contain `VIEW`);
/// base tables report `'BASE TABLE'`. Anything containing `VIEW` is excluded.
pub fn is_base_table(table_type: &str) -> bool {
    !table_type.to_ascii_uppercase().contains("VIEW")
}

/// Build a [`CopyableTable`] list from decoded `(table_name, table_type, estimated_rows)`
/// triples, excluding views and clamping negative row estimates to zero.
///
/// Pure shaping helper so the grouping/filtering logic is testable without a live
/// MySQL pool (the `_impl` only decodes rows and delegates here).
pub fn build_copyable_tables(rows: &[(String, String, i64)]) -> Vec<CopyableTable> {
    rows.iter()
        .filter(|(name, table_type, _)| !name.is_empty() && is_base_table(table_type))
        .map(|(name, _, estimated_rows)| CopyableTable {
            name: name.clone(),
            estimated_rows: (*estimated_rows).max(0) as u64,
        })
        .collect()
}

/// Split decoded `(routine_name, routine_type)` pairs into `(procedures, functions)`.
///
/// `ROUTINE_TYPE` is `PROCEDURE` or `FUNCTION` (case-insensitive); unknown types are
/// ignored. Pure shaping helper.
pub fn split_routines(rows: &[(String, String)]) -> (Vec<String>, Vec<String>) {
    let mut procedures = Vec::new();
    let mut functions = Vec::new();
    for (name, routine_type) in rows {
        if name.is_empty() {
            continue;
        }
        match routine_type.to_ascii_uppercase().as_str() {
            "PROCEDURE" => procedures.push(name.clone()),
            "FUNCTION" => functions.push(name.clone()),
            _ => {}
        }
    }
    (procedures, functions)
}

/// Collect non-empty names from decoded single-column rows (triggers / events).
/// Pure shaping helper.
pub fn collect_names(rows: &[String]) -> Vec<String> {
    rows.iter()
        .filter(|name| !name.is_empty())
        .cloned()
        .collect()
}

/// Enumerate the copyable objects (tables, procedures, functions, triggers, events)
/// for `database` on the source `connection_id`.
///
/// Views and system schemas are excluded. Every query is logged via the shared
/// `query_log` helpers.
pub async fn list_copyable_objects_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
) -> Result<CopyableObjects, String> {
    if is_system_schema(database) {
        return Err(format!(
            "Database '{database}' is a system schema and cannot be copied"
        ));
    }

    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found in registry"))?;

    // ── Tables (base tables only; views excluded) ──────────────────────────
    let tables_query = "\
        SELECT TABLE_NAME, TABLE_TYPE, CAST(TABLE_ROWS AS SIGNED) AS TABLE_ROWS \
        FROM information_schema.TABLES \
        WHERE TABLE_SCHEMA = ? \
          AND TABLE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
          AND TABLE_TYPE = 'BASE TABLE' \
        ORDER BY TABLE_NAME";
    query_log::log_outgoing_sql(tables_query);
    let table_rows = sqlx::query(tables_query)
        .bind(database)
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            query_log::log_execute_error(&e);
            format!("Failed to list tables: {e}")
        })?;
    let decoded_tables: Vec<(String, String, i64)> = table_rows
        .iter()
        .map(|row| {
            let name = decode_mysql_text_cell_named(row, "TABLE_NAME").unwrap_or_default();
            let table_type = decode_mysql_text_cell_named(row, "TABLE_TYPE").unwrap_or_default();
            let estimated_rows: i64 = sqlx::Row::try_get(row, "TABLE_ROWS").unwrap_or(0);
            (name, table_type, estimated_rows)
        })
        .collect();
    let tables = build_copyable_tables(&decoded_tables);

    // ── Routines (procedures + functions) ──────────────────────────────────
    let routines_query = "\
        SELECT ROUTINE_NAME, ROUTINE_TYPE \
        FROM information_schema.ROUTINES \
        WHERE ROUTINE_SCHEMA = ? \
          AND ROUTINE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
        ORDER BY ROUTINE_NAME";
    query_log::log_outgoing_sql(routines_query);
    let routine_rows = sqlx::query(routines_query)
        .bind(database)
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            query_log::log_execute_error(&e);
            format!("Failed to list routines: {e}")
        })?;
    let decoded_routines: Vec<(String, String)> = routine_rows
        .iter()
        .map(|row| {
            let name = decode_mysql_text_cell_named(row, "ROUTINE_NAME").unwrap_or_default();
            let routine_type =
                decode_mysql_text_cell_named(row, "ROUTINE_TYPE").unwrap_or_default();
            (name, routine_type)
        })
        .collect();
    let (procedures, functions) = split_routines(&decoded_routines);

    // ── Triggers ───────────────────────────────────────────────────────────
    let triggers_query = "\
        SELECT TRIGGER_NAME \
        FROM information_schema.TRIGGERS \
        WHERE TRIGGER_SCHEMA = ? \
          AND TRIGGER_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
        ORDER BY TRIGGER_NAME";
    query_log::log_outgoing_sql(triggers_query);
    let trigger_rows = sqlx::query(triggers_query)
        .bind(database)
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            query_log::log_execute_error(&e);
            format!("Failed to list triggers: {e}")
        })?;
    let decoded_triggers: Vec<String> = trigger_rows
        .iter()
        .map(|row| decode_mysql_text_cell_named(row, "TRIGGER_NAME").unwrap_or_default())
        .collect();
    let triggers = collect_names(&decoded_triggers);

    // ── Events ─────────────────────────────────────────────────────────────
    let events_query = "\
        SELECT EVENT_NAME \
        FROM information_schema.EVENTS \
        WHERE EVENT_SCHEMA = ? \
          AND EVENT_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
        ORDER BY EVENT_NAME";
    query_log::log_outgoing_sql(events_query);
    let event_rows = sqlx::query(events_query)
        .bind(database)
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            query_log::log_execute_error(&e);
            format!("Failed to list events: {e}")
        })?;
    let decoded_events: Vec<String> = event_rows
        .iter()
        .map(|row| decode_mysql_text_cell_named(row, "EVENT_NAME").unwrap_or_default())
        .collect();
    let events = collect_names(&decoded_events);

    Ok(CopyableObjects {
        tables,
        procedures,
        functions,
        triggers,
        events,
    })
}

// ---------------------------------------------------------------------------
// Start / progress / cancel
// ---------------------------------------------------------------------------

/// Normalize a host string for same-host comparison: trim surrounding
/// whitespace and lower-case it (host names are case-insensitive). Pure helper
/// so the comparison rule is unit-testable.
pub fn normalize_host(host: &str) -> String {
    host.trim().to_ascii_lowercase()
}

/// `true` when the two hosts refer to the same server for the purpose of the
/// same-host copy guard.
pub fn is_same_host(source_host: &str, target_host: &str) -> bool {
    normalize_host(source_host) == normalize_host(target_host)
}

/// Resolve the source and target host strings for the same-host validation.
///
/// The source is a runtime **session id** (its host lives in the registry's
/// stored connection params); the target is a saved **profile id** (its host is
/// read from the SQLite connection store). Returns `(source_host, target_host)`.
fn resolve_hosts(state: &AppState, params: &CopyToHostParams) -> Result<(String, String), String> {
    let source_host = state
        .registry
        .get_connection_params(&params.source_connection_id)
        .map(|p| p.host)
        .ok_or_else(|| {
            format!(
                "Source connection '{}' not found",
                params.source_connection_id
            )
        })?;

    let target_host = {
        let conn = state
            .db
            .lock()
            .map_err(|e| format!("Failed to lock database: {e}"))?;
        match crate::db::connections::get_connection(&conn, &params.target_connection_id) {
            Ok(Some(record)) => record.host,
            Ok(None) => {
                return Err(format!(
                    "Target connection '{}' not found",
                    params.target_connection_id
                ))
            }
            Err(error) => return Err(error.to_string()),
        }
    };

    Ok((source_host, target_host))
}

fn validate_target_connection_is_writable(
    state: &AppState,
    target_connection_id: &str,
) -> Result<(), String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {e}"))?;
    let target = crate::db::connections::get_connection(&conn, target_connection_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("Target connection '{target_connection_id}' not found"))?;

    if target.read_only {
        return Err(format!(
            "Target connection '{}' is read-only and cannot be used for Copy to Another Host",
            target.name
        ));
    }

    Ok(())
}

/// Validate params, register a new job in `copy_jobs`, spawn the engine task,
/// and return the new job id.
///
/// Same-host copy is rejected eagerly here based on a literal host-string
/// comparison; aliased addresses (e.g. `localhost` vs `127.0.0.1`) bypass it.
/// The target must live on a *different* host than the source.
pub fn start_copy_to_host_impl(
    state: &AppState,
    params: CopyToHostParams,
) -> Result<String, String> {
    if is_system_schema(&params.source_database) {
        return Err(format!(
            "Source database '{}' is a system schema and cannot be copied",
            params.source_database
        ));
    }

    if is_system_schema(&params.target_database) {
        return Err(format!(
            "Target database '{}' is a system schema and cannot be used for copy",
            params.target_database
        ));
    }

    validate_selection_for_options(&params.objects, &params.options)?;
    validate_target_connection_is_writable(state, &params.target_connection_id)?;

    let (source_host, target_host) = resolve_hosts(state, &params)?;
    if is_same_host(&source_host, &target_host) {
        return Err(format!(
            "Source and target are on the same host ('{source_host}'). \
             Copy to Another Host requires a different target host."
        ));
    }
    let job_id = uuid::Uuid::new_v4().to_string();
    let objects_total = params.objects.total();
    let progress = new_running_progress(job_id.clone(), objects_total);

    {
        let mut jobs = state
            .copy_jobs
            .write()
            .map_err(|e| format!("Failed to lock copy jobs: {e}"))?;
        cleanup_stale_copy_jobs(&mut jobs);
        jobs.insert(job_id.clone(), progress);
    }

    spawn_copy_job(state, params, job_id.clone());

    Ok(job_id)
}

/// Return the stored progress for `job_id`. Errors if the job is unknown.
pub fn get_copy_progress_impl(state: &AppState, job_id: &str) -> Result<CopyJobProgress, String> {
    let mut jobs = state
        .copy_jobs
        .write()
        .map_err(|e| format!("Failed to lock copy jobs: {e}"))?;
    // Lazy cleanup of stale terminal entries, mirroring the dump job model.
    cleanup_stale_copy_jobs(&mut jobs);
    jobs.get(job_id)
        .cloned()
        .ok_or_else(|| format!("Copy job '{job_id}' not found"))
}

/// Request cancellation of `job_id` by setting its `cancel_requested` flag. The
/// engine observes the flag at the next safe checkpoint. Errors if unknown.
pub fn cancel_copy_impl(state: &AppState, job_id: &str) -> Result<(), String> {
    let mut jobs = state
        .copy_jobs
        .write()
        .map_err(|e| format!("Failed to lock copy jobs: {e}"))?;
    match jobs.get_mut(job_id) {
        Some(progress) => {
            progress.cancel_requested = true;
            Ok(())
        }
        None => Err(format!("Copy job '{job_id}' not found")),
    }
}

/// Duration after which terminal copy jobs are cleaned up (mirrors dump jobs).
const COPY_JOB_STALE_DURATION: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// Remove terminal copy jobs whose `completed_at` is older than the retention
/// window so finished entries don't accumulate.
pub fn cleanup_stale_copy_jobs(jobs: &mut std::collections::HashMap<String, CopyJobProgress>) {
    jobs.retain(|_, progress| {
        if let Some(completed_at) = progress.completed_at {
            match std::time::SystemTime::now().duration_since(completed_at) {
                Ok(age) => age < COPY_JOB_STALE_DURATION,
                Err(_) => true,
            }
        } else {
            true // Running jobs are always kept
        }
    });
}

/// Spawn the background copy engine task for an already-registered job.
///
/// The engine entry point [`run_copy`](crate::export::copy_to_host::run_copy)
/// borrows `&AppState`, which is not `'static`. The spawned task therefore
/// reacquires the managed `AppState` from the app handle (Tauri keeps it alive
/// for the whole app lifetime) and calls the engine with that reference.
///
/// When no app handle is available (e.g. in unit tests) the engine is *not*
/// spawned — the job entry is still registered so `start_copy_to_host_impl`
/// remains fully testable; only the live engine execution is skipped.
///
/// Excluded from coverage: it requires the Tauri async runtime and a real MySQL
/// pool. The registration/validation logic in `start_copy_to_host_impl` carries
/// the tested behavior.
#[cfg(not(coverage))]
fn spawn_copy_job(state: &AppState, params: CopyToHostParams, job_id: String) {
    use tauri::Manager;

    let Some(app_handle) = state.app_handle.clone() else {
        tracing::warn!(
            job_id = %job_id,
            "copy_to_host: no app handle available; engine task not spawned"
        );
        return;
    };

    let jobs = std::sync::Arc::clone(&state.copy_jobs);

    tauri::async_runtime::spawn(async move {
        let app_state = app_handle.state::<AppState>();
        crate::export::copy_to_host::run_copy(app_state.inner(), params, jobs, job_id).await;
    });
}

/// No-op stub for coverage builds (the engine needs a real pool).
#[cfg(coverage)]
fn spawn_copy_job(_state: &AppState, _params: CopyToHostParams, _job_id: String) {}

// ---------------------------------------------------------------------------
// Thin Tauri command wrappers
// ---------------------------------------------------------------------------

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_copyable_objects(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
) -> Result<CopyableObjects, String> {
    list_copyable_objects_impl(&state, &connection_id, &database).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn start_copy_to_host(
    state: tauri::State<'_, AppState>,
    params: CopyToHostParams,
) -> Result<String, String> {
    start_copy_to_host_impl(&state, params)
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_copy_progress(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<CopyJobProgress, String> {
    get_copy_progress_impl(&state, &job_id)
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn cancel_copy(state: tauri::State<'_, AppState>, job_id: String) -> Result<(), String> {
    cancel_copy_impl(&state, &job_id)
}

// Coverage stubs — the real wrappers require the Tauri runtime and are excluded
// from coverage; the tested logic lives in the matching `*_impl` functions.
#[cfg(coverage)]
#[tauri::command]
pub async fn list_copyable_objects(
    _state: tauri::State<'_, AppState>,
    _connection_id: String,
    _database: String,
) -> Result<CopyableObjects, String> {
    Ok(CopyableObjects::default())
}

#[cfg(coverage)]
#[tauri::command]
pub async fn start_copy_to_host(
    _state: tauri::State<'_, AppState>,
    _params: CopyToHostParams,
) -> Result<String, String> {
    Ok(String::new())
}

#[cfg(coverage)]
#[tauri::command]
pub async fn get_copy_progress(
    _state: tauri::State<'_, AppState>,
    _job_id: String,
) -> Result<CopyJobProgress, String> {
    Err("coverage stub".to_string())
}

#[cfg(coverage)]
#[tauri::command]
pub async fn cancel_copy(
    _state: tauri::State<'_, AppState>,
    _job_id: String,
) -> Result<(), String> {
    Err("coverage stub".to_string())
}
