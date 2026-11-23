use crate::timestamps::stored_timestamp_now;
use std::time::Instant;

use super::super::super::storage;
use super::super::super::types::{BuildConfig, FkEdge, FkInput, TableDdlInput};
use super::super::chunk_generation::foreign_key_edges;
use super::super::mysql_fetch::{TableKey, fetch_create_table};
use super::super::{GeneratedChunks, GeneratedFkChunk, GeneratedTableChunk, generate_all_chunks};
use super::embedding::{EmbeddedBatch, request_embeddings, store_inserted_batch};
use super::full_build::build_index;
use super::pending_chunk::{
    PendingChunk, chunk_keys, count_foreign_key_chunks, count_table_chunks,
};
use super::{BuildContext, EMBED_BATCH_SIZE, IndexBuildResources, elapsed_millis};

const REBUILD_CANCELLED: &str = "Rebuild cancelled";

fn ensure_rebuild_not_cancelled(context: &BuildContext<'_>) -> Result<(), String> {
    if context.is_cancelled() {
        return Err(REBUILD_CANCELLED.to_string());
    }
    Ok(())
}

fn delete_targeted_tables(context: &BuildContext<'_>, tables: &[TableKey]) -> Result<(), String> {
    let conn = context.lock_index_db()?;
    for (db_name, table_name) in tables {
        let target_table = storage::IndexedTableRef {
            connection_id: context.connection_id(),
            db_name,
            table_name,
        };
        storage::delete_chunks_by_table(&conn, &target_table).map_err(|error| {
            format!("Failed to delete chunks for {db_name}.{table_name}: {error}")
        })?;
        storage::delete_signature(&conn, &target_table).map_err(|error| {
            format!("Failed to delete signature for {db_name}.{table_name}: {error}")
        })?;
    }
    Ok(())
}

async fn fetch_table_ddl(context: &BuildContext<'_>, table: &TableKey) -> Option<TableDdlInput> {
    let (db_name, table_name) = table;
    match fetch_create_table(context.resources.mysql_pool, db_name, table_name).await {
        Ok(create_table_sql) => Some(TableDdlInput {
            db_name: db_name.clone(),
            table_name: table_name.clone(),
            create_table_sql,
        }),
        Err(error) => {
            tracing::warn!(
                db_name = %db_name,
                table_name = %table_name,
                error = %error,
                "Table not found during rebuild (likely dropped), skipping"
            );
            None
        }
    }
}

async fn refetch_table_ddls(
    context: &BuildContext<'_>,
    tables: &[TableKey],
) -> Result<Vec<TableDdlInput>, String> {
    let mut ddl_inputs = Vec::new();
    for table in tables {
        ensure_rebuild_not_cancelled(context)?;
        ddl_inputs.extend(fetch_table_ddl(context, table).await);
    }
    Ok(ddl_inputs)
}

fn is_foreign_key_of_table(foreign_key: &FkInput, table_chunk: &GeneratedTableChunk) -> bool {
    foreign_key.db_name == table_chunk.db_name && foreign_key.table_name == table_chunk.table_name
}

fn edges_of_table(
    connection_id: &str,
    foreign_key_chunks: &[GeneratedFkChunk],
    table_chunk: &GeneratedTableChunk,
) -> Vec<FkEdge> {
    foreign_key_chunks
        .iter()
        .filter(|(_, _, _, foreign_key)| is_foreign_key_of_table(foreign_key, table_chunk))
        .flat_map(|(_, _, _, foreign_key)| foreign_key_edges(connection_id, foreign_key))
        .collect()
}

fn store_rebuilt_foreign_key_edges(
    context: &BuildContext<'_>,
    generated: &GeneratedChunks,
) -> Result<(), String> {
    let conn = context.lock_index_db()?;
    for table_chunk in &generated.table_chunks {
        let edges = edges_of_table(
            context.connection_id(),
            &generated.foreign_key_chunks,
            table_chunk,
        );
        let source_table = storage::IndexedTableRef {
            connection_id: context.connection_id(),
            db_name: &table_chunk.db_name,
            table_name: &table_chunk.table_name,
        };
        storage::replace_fk_edges_for_table(&conn, &source_table, &edges).map_err(|error| {
            format!(
                "Failed to store FK edges for {}.{}: {error}",
                table_chunk.db_name, table_chunk.table_name
            )
        })?;
    }
    Ok(())
}

fn log_staged_rebuild(context: &BuildContext<'_>, embed_items: &[&PendingChunk]) {
    tracing::info!(
        profile_id = %context.connection_id(),
        staged_at = %stored_timestamp_now(),
        chunks_to_embed = embed_items.len(),
        staged_table_chunks = count_table_chunks(embed_items),
        staged_fk_chunks = count_foreign_key_chunks(embed_items),
        "schema_index rebuild_tables: staged all chunks for targeted tables before embedding"
    );
}

async fn embed_and_insert_batch(
    context: &BuildContext<'_>,
    chunks: &[&PendingChunk],
    batch_start: usize,
) -> Result<(), String> {
    ensure_rebuild_not_cancelled(context)?;
    tracing::info!(
        profile_id = %context.connection_id(),
        batch_start,
        batch_end = batch_start + chunks.len(),
        batch_len = chunks.len(),
        at = %stored_timestamp_now(),
        "schema_index rebuild_tables: calling embedding API for batch"
    );
    tracing::debug!(
        profile_id = %context.connection_id(),
        chunk_keys = ?chunk_keys(chunks),
        "schema_index rebuild_tables: batch chunk keys"
    );

    let embed_started = Instant::now();
    let embeddings = request_embeddings(context, chunks).await?;
    tracing::debug!(
        profile_id = %context.connection_id(),
        batch_start,
        elapsed_ms = elapsed_millis(embed_started),
        vectors_returned = embeddings.len(),
        "schema_index rebuild_tables: embedding API batch finished"
    );
    store_inserted_batch(
        context,
        EmbeddedBatch {
            chunks,
            embeddings: &embeddings,
        },
    )
}

async fn embed_rebuilt_chunks(
    context: &BuildContext<'_>,
    table_chunks: Vec<GeneratedTableChunk>,
) -> Result<(), String> {
    let pending: Vec<PendingChunk> = table_chunks
        .into_iter()
        .map(PendingChunk::from_table_chunk)
        .collect();
    let embed_items: Vec<&PendingChunk> = pending.iter().collect();
    log_staged_rebuild(context, &embed_items);
    for (batch_index, chunks) in embed_items.chunks(EMBED_BATCH_SIZE).enumerate() {
        embed_and_insert_batch(context, chunks, batch_index * EMBED_BATCH_SIZE).await?;
    }
    Ok(())
}

pub async fn rebuild_tables(
    config: &BuildConfig,
    tables: &[(String, String)],
    resources: &IndexBuildResources<'_>,
) -> Result<(), String> {
    let context = BuildContext {
        config,
        resources: *resources,
        on_progress: None,
    };
    tracing::info!(
        profile_id = %config.connection_id,
        model_id = %config.model_id,
        started_at = %stored_timestamp_now(),
        table_targets = tables.len(),
        "schema_index rebuild_tables: started (partial table rebuild)"
    );

    delete_targeted_tables(&context, tables)?;
    tracing::debug!(
        profile_id = %config.connection_id,
        "schema_index rebuild_tables: removed existing chunks and signatures for targeted tables"
    );

    let ddl_inputs = refetch_table_ddls(&context, tables).await?;
    let generated = generate_all_chunks(&ddl_inputs);
    store_rebuilt_foreign_key_edges(&context, &generated)?;
    embed_rebuilt_chunks(&context, generated.table_chunks).await?;

    tracing::info!(
        profile_id = %config.connection_id,
        at = %stored_timestamp_now(),
        "schema_index rebuild_tables: partial inserts done; running full incremental build_index to restore cross-table FK chunks"
    );
    build_index(config, resources, None).await?;
    tracing::info!(
        profile_id = %config.connection_id,
        finished_at = %stored_timestamp_now(),
        "schema_index rebuild_tables: finished (including follow-up build_index)"
    );
    Ok(())
}
