use std::collections::HashMap;
use std::time::Instant;
use tokio_util::sync::CancellationToken;

use super::super::types::{BuildPhase, BuildProgress, ProgressCallback, TableDdlInput};
use super::SHOW_CREATE_TABLE_CONCURRENCY;

const SYSTEM_SCHEMAS: &[&str] = &["information_schema", "mysql", "performance_schema", "sys"];

pub(super) type TableKey = (String, String);

#[derive(Clone, Copy)]
pub(super) struct DdlSource<'a> {
    pub(super) pool: &'a sqlx::MySqlPool,
    pub(super) cancellation: &'a CancellationToken,
}

#[derive(Clone, Copy)]
pub(super) struct DdlFetchProgress<'a> {
    pub(super) profile_id: &'a str,
    pub(super) on_progress: Option<&'a ProgressCallback>,
    pub(super) initial_done: usize,
    pub(super) total: usize,
}

pub(super) fn is_system_schema(schema: &str) -> bool {
    SYSTEM_SCHEMAS.contains(&schema.to_lowercase().as_str())
}

pub(super) fn decode_number(row: &sqlx::mysql::MySqlRow, index: usize) -> i64 {
    use sqlx::Row;
    row.try_get::<i64, _>(index)
        .or_else(|_| row.try_get::<u64, _>(index).map(|value| value as i64))
        .unwrap_or(0)
}

fn show_create_routine_keyword(routine_type: &str) -> &'static str {
    let is_procedure = routine_type.to_uppercase() == "PROCEDURE";
    if is_procedure {
        return "PROCEDURE";
    }
    "FUNCTION"
}

pub(super) async fn fetch_all_user_tables(pool: &sqlx::MySqlPool) -> Result<Vec<TableKey>, String> {
    let rows = sqlx::query(
        "SELECT TABLE_SCHEMA, TABLE_NAME \
         FROM information_schema.TABLES \
         WHERE TABLE_TYPE = 'BASE TABLE' \
           AND TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys') \
         ORDER BY TABLE_SCHEMA, TABLE_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to enumerate user tables: {error}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let schema = decode_string(row, 0).map_err(|error| format!("schema: {error}"))?;
        let table = decode_string(row, 1).map_err(|error| format!("table: {error}"))?;
        if is_system_schema(&schema) {
            continue;
        }
        out.push((schema, table));
    }
    Ok(out)
}

pub(super) fn decode_string(
    row: &sqlx::mysql::MySqlRow,
    index: usize,
) -> Result<String, sqlx::Error> {
    use sqlx::Row;
    row.try_get::<String, _>(index).or_else(|_| {
        row.try_get::<Vec<u8>, _>(index)
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
    })
}

pub(super) async fn fetch_row_counts(
    pool: &sqlx::MySqlPool,
) -> Result<HashMap<(String, String), i64>, String> {
    let rows = sqlx::query(
        "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_ROWS \
         FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys') \
           AND TABLE_TYPE = 'BASE TABLE'",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to fetch row counts: {error}"))?;

    let mut out = HashMap::with_capacity(rows.len());
    for row in &rows {
        let schema = decode_string(row, 0).map_err(|error| format!("schema: {error}"))?;
        if is_system_schema(&schema) {
            continue;
        }
        let table = decode_string(row, 1).map_err(|error| format!("table: {error}"))?;
        out.insert((schema, table), decode_number(row, 2));
    }
    Ok(out)
}

pub(super) async fn fetch_all_user_views(
    pool: &sqlx::MySqlPool,
) -> Result<Vec<(String, String, String)>, String> {
    use crate::mysql::schema_queries::safe_identifier;

    let rows = sqlx::query(
        "SELECT TABLE_SCHEMA, TABLE_NAME \
         FROM information_schema.TABLES \
         WHERE TABLE_TYPE = 'VIEW' \
           AND TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys') \
         ORDER BY TABLE_SCHEMA, TABLE_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to enumerate user views: {error}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let schema = decode_string(row, 0).map_err(|error| format!("schema: {error}"))?;
        if is_system_schema(&schema) {
            continue;
        }
        let view_name = decode_string(row, 1).map_err(|error| format!("view: {error}"))?;

        let safe_db = safe_identifier(&schema)
            .map_err(|error| format!("Invalid db name {schema}: {error}"))?;
        let safe_view = safe_identifier(&view_name)
            .map_err(|error| format!("Invalid view name {view_name}: {error}"))?;
        let sql = format!("SHOW CREATE VIEW {safe_db}.{safe_view}");

        match sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
            .fetch_optional(pool)
            .await
        {
            Ok(Some(ddl_row)) => {
                let ddl = decode_string(&ddl_row, 1).unwrap_or_default();
                out.push((schema, view_name, ddl));
            }
            Ok(None) => {
                tracing::warn!(
                    view = %view_name,
                    db = %schema,
                    "SHOW CREATE VIEW returned no rows, skipping"
                );
            }
            Err(error) => {
                tracing::warn!(
                    view = %view_name,
                    db = %schema,
                    error = %error,
                    "SHOW CREATE VIEW failed, skipping"
                );
            }
        }
    }
    Ok(out)
}

pub(super) async fn fetch_all_user_routines(
    pool: &sqlx::MySqlPool,
) -> Result<Vec<(String, String, String, String)>, String> {
    use crate::mysql::schema_queries::safe_identifier;

    let rows = sqlx::query(
        "SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE \
         FROM information_schema.ROUTINES \
         WHERE ROUTINE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys') \
         ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to enumerate user routines: {error}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let schema = decode_string(row, 0).map_err(|error| format!("schema: {error}"))?;
        if is_system_schema(&schema) {
            continue;
        }
        let routine_name = decode_string(row, 1).map_err(|error| format!("routine: {error}"))?;
        let routine_type = decode_string(row, 2).map_err(|error| format!("type: {error}"))?;

        let safe_db = safe_identifier(&schema)
            .map_err(|error| format!("Invalid db name {schema}: {error}"))?;
        let safe_name = safe_identifier(&routine_name)
            .map_err(|error| format!("Invalid routine name {routine_name}: {error}"))?;

        let show_keyword = show_create_routine_keyword(&routine_type);
        let show_cmd = format!("SHOW CREATE {show_keyword} {safe_db}.{safe_name}");

        match sqlx::query(sqlx::AssertSqlSafe(show_cmd.as_str()))
            .fetch_optional(pool)
            .await
        {
            Ok(Some(ddl_row)) => {
                let ddl = decode_string(&ddl_row, 2).unwrap_or_default();
                out.push((schema, routine_name, routine_type.to_uppercase(), ddl));
            }
            Ok(None) => {
                tracing::warn!(
                    routine = %routine_name,
                    db = %schema,
                    "SHOW CREATE {routine_type} returned no rows, skipping"
                );
            }
            Err(error) => {
                tracing::warn!(
                    routine = %routine_name,
                    db = %schema,
                    error = %error,
                    "SHOW CREATE {routine_type} failed, skipping"
                );
            }
        }
    }
    Ok(out)
}

pub(super) async fn fetch_create_table(
    pool: &sqlx::MySqlPool,
    database: &str,
    table: &str,
) -> Result<String, String> {
    use crate::mysql::schema_queries::safe_identifier;

    let safe_db = safe_identifier(database)?;
    let safe_table = safe_identifier(table)?;
    let sql = format!("SHOW CREATE TABLE {safe_db}.{safe_table}");
    let row = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("SHOW CREATE TABLE {database}.{table} failed: {error}"))?
        .ok_or_else(|| format!("Table {database}.{table} not found"))?;

    let ddl = decode_string(&row, 1).unwrap_or_default();

    Ok(ddl)
}

const FETCH_PROGRESS_LOG_INTERVAL: usize = 10;

#[derive(Clone, Copy)]
struct FetchCounter<'a> {
    completed: &'a std::sync::atomic::AtomicUsize,
    total_to_fetch: usize,
    profile_id: &'a str,
}

async fn fetch_counted_create_table(
    pool: &sqlx::MySqlPool,
    target: TableKey,
    counter: FetchCounter<'_>,
) -> Result<TableDdlInput, String> {
    let (db, tbl) = target;
    let per_started = Instant::now();
    let ddl = fetch_create_table(pool, &db, &tbl).await?;
    let done = counter
        .completed
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        + 1;
    let should_log_progress =
        done.is_multiple_of(FETCH_PROGRESS_LOG_INTERVAL) || done == counter.total_to_fetch;
    if should_log_progress {
        tracing::debug!(
            profile_id = %counter.profile_id,
            fetched = done,
            total = counter.total_to_fetch,
            last_elapsed_ms = per_started.elapsed().as_millis() as u64,
            "schema_index build_index: SHOW CREATE TABLE progress"
        );
    }
    Ok(TableDdlInput {
        db_name: db,
        table_name: tbl,
        create_table_sql: ddl,
    })
}

pub(super) async fn fetch_create_tables_parallel(
    source: DdlSource<'_>,
    targets: Vec<(String, String)>,
    progress: DdlFetchProgress<'_>,
) -> Result<Vec<TableDdlInput>, String> {
    let DdlSource { pool, cancellation } = source;
    let DdlFetchProgress {
        profile_id,
        on_progress,
        initial_done,
        total,
    } = progress;
    use futures::stream::{self, StreamExt};
    use std::sync::atomic::{AtomicUsize, Ordering};

    let total_to_fetch = targets.len();
    let completed = AtomicUsize::new(0);
    let phase_started = Instant::now();

    let counter = FetchCounter {
        completed: &completed,
        total_to_fetch,
        profile_id,
    };
    let report_progress = |_: &Result<TableDdlInput, String>| {
        let Some(cb) = on_progress else {
            return;
        };
        let done = completed.load(Ordering::Relaxed);
        cb(BuildProgress {
            profile_id: profile_id.to_string(),
            phase: BuildPhase::LoadingSchema,
            tables_done: initial_done + done,
            tables_total: total,
        });
    };
    let results: Vec<Result<TableDdlInput, String>> = stream::iter(targets)
        .map(|target| fetch_counted_create_table(pool, target, counter))
        .buffer_unordered(SHOW_CREATE_TABLE_CONCURRENCY)
        .inspect(report_progress)
        .collect()
        .await;

    if cancellation.is_cancelled() {
        return Err("Build cancelled".to_string());
    }

    let mut out = Vec::with_capacity(results.len());
    for result in results {
        out.push(result?);
    }

    tracing::info!(
        profile_id = %profile_id,
        fetched = out.len(),
        elapsed_ms = phase_started.elapsed().as_millis() as u64,
        concurrency = SHOW_CREATE_TABLE_CONCURRENCY,
        "schema_index build_index: parallel SHOW CREATE TABLE phase complete"
    );

    Ok(out)
}
