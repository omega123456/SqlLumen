use chrono::Utc;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::time::Instant;

use super::super::super::storage;
use super::super::super::types::{BuildPhase, BuildProgress, TableDdlInput};
use super::super::mysql_fetch::{
    fetch_all_user_routines, fetch_all_user_tables, fetch_all_user_views,
    fetch_create_tables_parallel, fetch_row_counts, DdlFetchProgress, DdlSource, TableKey,
};
use super::super::table_signatures::fetch_all_table_signatures;
use super::super::SignatureDecision;
use super::super::{decide_signature_action, is_signature_unchanged, table_chunk_key};
use super::pending_chunk::{RoutineDefinition, ViewDefinition};
use super::{elapsed_millis, ensure_not_cancelled, BuildContext, BUILD_CANCELLED};

pub(super) struct TableSignatures {
    pub(super) current: HashMap<TableKey, String>,
    pub(super) stored: HashMap<TableKey, String>,
}

pub(super) struct TableDdls {
    pub(super) tables_total: usize,
    pub(super) signatures: TableSignatures,
    pub(super) ddl_inputs: Vec<TableDdlInput>,
}

pub(super) struct SchemaObjects {
    pub(super) row_counts: HashMap<TableKey, i64>,
    pub(super) views: Vec<ViewDefinition>,
    pub(super) routines: Vec<RoutineDefinition>,
}

#[derive(Default)]
struct TablePartition {
    reused_ddls: Vec<TableDdlInput>,
    to_fetch: Vec<TableKey>,
}

struct ReuseLookup<'a> {
    conn: &'a Connection,
    connection_id: &'a str,
    signatures: &'a TableSignatures,
}

fn loading_schema_progress(
    context: &BuildContext<'_>,
    tables_done: usize,
    tables_total: usize,
) -> BuildProgress {
    BuildProgress {
        profile_id: context.config.connection_id.clone(),
        phase: BuildPhase::LoadingSchema,
        tables_done,
        tables_total,
    }
}

fn ensure_not_cancelled_before_enumeration(context: &BuildContext<'_>) -> Result<(), String> {
    if !context.is_cancelled() {
        return Ok(());
    }
    tracing::warn!(
        profile_id = %context.connection_id(),
        at = %Utc::now().to_rfc3339(),
        "schema_index build_index: cancelled before MySQL enumeration"
    );
    Err(BUILD_CANCELLED.to_string())
}

async fn enumerate_tables(context: &BuildContext<'_>) -> Result<Vec<TableKey>, String> {
    let enumeration_started = Instant::now();
    let all_tables = fetch_all_user_tables(context.resources.mysql_pool).await?;
    let distinct_databases: HashSet<&str> = all_tables
        .iter()
        .map(|(db_name, _)| db_name.as_str())
        .collect();
    tracing::info!(
        profile_id = %context.connection_id(),
        database_count = distinct_databases.len(),
        tables_total = all_tables.len(),
        elapsed_ms = elapsed_millis(enumeration_started),
        "schema_index build_index: enumerated user databases from MySQL"
    );
    Ok(all_tables)
}

async fn read_table_signatures(context: &BuildContext<'_>) -> Result<TableSignatures, String> {
    let signatures_started = Instant::now();
    let current = fetch_all_table_signatures(context.resources.mysql_pool).await?;
    tracing::info!(
        profile_id = %context.connection_id(),
        signature_count = current.len(),
        elapsed_ms = elapsed_millis(signatures_started),
        "schema_index build_index: bulk-fetched per-table schema signatures"
    );
    ensure_not_cancelled(context)?;
    let conn = context.lock_index_db()?;
    let stored = storage::get_signatures_for_connection(&conn, context.connection_id())
        .map_err(|error| format!("Failed to load stored signatures: {error}"))?;
    Ok(TableSignatures { current, stored })
}

fn reusable_table_ddl(
    lookup: &ReuseLookup<'_>,
    table: &TableKey,
) -> Result<Option<TableDdlInput>, String> {
    let (db_name, table_name) = table;
    let current = lookup.signatures.current.get(table).map(String::as_str);
    let stored = lookup.signatures.stored.get(table).map(String::as_str);
    if !is_signature_unchanged(current, stored) {
        return Ok(None);
    }
    let chunk_key = table_chunk_key(db_name, table_name);
    let existing_chunk =
        storage::get_chunk_by_key(lookup.conn, lookup.connection_id, &chunk_key)
            .map_err(|error| format!("Failed to look up existing chunk {chunk_key}: {error}"))?;
    let decision = decide_signature_action(current, stored, existing_chunk.is_some());
    if decision == SignatureDecision::Refetch {
        return Ok(None);
    }
    Ok(existing_chunk.map(|chunk| TableDdlInput {
        db_name: db_name.clone(),
        table_name: table_name.clone(),
        create_table_sql: chunk.ddl_text,
    }))
}

fn partition_tables(
    context: &BuildContext<'_>,
    all_tables: &[TableKey],
    signatures: &TableSignatures,
) -> Result<TablePartition, String> {
    let conn = context.lock_index_db()?;
    let lookup = ReuseLookup {
        conn: &conn,
        connection_id: context.connection_id(),
        signatures,
    };
    let mut partition = TablePartition::default();
    for table in all_tables {
        match reusable_table_ddl(&lookup, table)? {
            Some(ddl_input) => partition.reused_ddls.push(ddl_input),
            None => partition.to_fetch.push(table.clone()),
        }
    }
    Ok(partition)
}

async fn fetch_changed_ddls(
    context: &BuildContext<'_>,
    partition: TablePartition,
    tables_total: usize,
) -> Result<Vec<TableDdlInput>, String> {
    let TablePartition {
        reused_ddls,
        to_fetch,
    } = partition;
    if to_fetch.is_empty() {
        return Ok(reused_ddls);
    }
    let source = DdlSource {
        pool: context.resources.mysql_pool,
        cancellation: context.resources.cancellation,
    };
    let progress = DdlFetchProgress {
        profile_id: context.connection_id(),
        on_progress: context.on_progress,
        initial_done: reused_ddls.len(),
        total: tables_total,
    };
    let fetched_ddls = fetch_create_tables_parallel(source, to_fetch, progress).await?;
    let mut all_ddl_inputs = Vec::with_capacity(tables_total);
    all_ddl_inputs.extend(reused_ddls);
    all_ddl_inputs.extend(fetched_ddls);
    Ok(all_ddl_inputs)
}

pub(super) async fn read_table_ddls(context: &BuildContext<'_>) -> Result<TableDdls, String> {
    ensure_not_cancelled_before_enumeration(context)?;
    let all_tables = enumerate_tables(context).await?;
    let tables_total = all_tables.len();
    context.report(loading_schema_progress(context, 0, 0));
    ensure_not_cancelled(context)?;

    let signatures = read_table_signatures(context).await?;
    let partition = partition_tables(context, &all_tables, &signatures)?;
    tracing::info!(
        profile_id = %context.connection_id(),
        reused_ddls = partition.reused_ddls.len(),
        to_fetch = partition.to_fetch.len(),
        total_tables = tables_total,
        "schema_index build_index: signature short-circuit partitioned tables"
    );
    let reused_count = partition.reused_ddls.len();
    context.report(loading_schema_progress(context, reused_count, tables_total));

    let ddl_inputs = fetch_changed_ddls(context, partition, tables_total).await?;
    tracing::info!(
        profile_id = %context.connection_id(),
        tables_total,
        "schema_index build_index: fetched SHOW CREATE TABLE for all tables"
    );
    Ok(TableDdls {
        tables_total,
        signatures,
        ddl_inputs,
    })
}

pub(super) async fn read_schema_objects(
    context: &BuildContext<'_>,
) -> Result<SchemaObjects, String> {
    let pool = context.resources.mysql_pool;
    let row_counts = fetch_row_counts(pool).await?;
    tracing::debug!(
        profile_id = %context.connection_id(),
        row_count_entries = row_counts.len(),
        "schema_index build_index: fetched approximate row counts from information_schema"
    );

    let (views_result, routines_result) =
        tokio::join!(fetch_all_user_views(pool), fetch_all_user_routines(pool));
    let views = views_result?;
    let routines = routines_result?;
    tracing::info!(
        profile_id = %context.connection_id(),
        views = views.len(),
        routines = routines.len(),
        "schema_index build_index: enumerated views and routines"
    );
    Ok(SchemaObjects {
        row_counts,
        views,
        routines,
    })
}
