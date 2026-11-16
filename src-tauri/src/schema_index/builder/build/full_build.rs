use crate::timestamps::stored_timestamp_now;
use std::collections::{HashMap, HashSet};
use std::time::Instant;

use super::super::super::storage;
use super::super::super::types::{
    BuildConfig, BuildResult, FkEdge, IndexStatus, ProgressCallback, TableDdlInput,
};
use super::super::chunk_generation::foreign_key_edges;
use super::super::{
    diff_chunks, generate_all_chunks_with_row_counts, split_identifier_segments, ChunkDiff,
    GeneratedChunks, GeneratedFkChunk, GeneratedTableChunk,
};
use super::embedding::{request_embeddings, store_upserted_batch, EmbeddedBatch};
use super::pending_chunk::{
    chunk_keys, count_foreign_key_chunks, count_table_chunks, PendingChunk,
};
use super::progress::{EmbeddingProgressStart, EmbeddingProgressTracker};
use super::schema_snapshot::{
    read_schema_objects, read_table_ddls, SchemaObjects, TableSignatures,
};
use super::vector_storage::{prepare_vector_storage, VectorStorageTarget};
use super::{elapsed_millis, BuildContext, IndexBuildResources, BUILD_CANCELLED, EMBED_BATCH_SIZE};

struct StagedChunks {
    pending: Vec<PendingChunk>,
    table_chunk_count: usize,
}

struct EmbeddingOutcome {
    progress_tracker: EmbeddingProgressTracker,
    total_to_embed: usize,
}

struct EmbeddingPlan<'a> {
    chunks_to_embed: Vec<&'a PendingChunk>,
    obsolete_removed: usize,
}

#[derive(Clone, Copy)]
struct BatchPosition<'a> {
    chunks: &'a [&'a PendingChunk],
    batch_start: usize,
    total_to_embed: usize,
}

async fn prepare_index_storage(context: &BuildContext<'_>) -> Result<(), String> {
    tracing::debug!(
        profile_id = %context.connection_id(),
        "schema_index build_index: checking model / vec0 schema (handle_model_change)"
    );
    let target = VectorStorageTarget {
        config: context.config,
        sqlite_conn: context.resources.sqlite_conn,
    };
    prepare_vector_storage(target, context.resources.http_client).await?;
    tracing::debug!(
        profile_id = %context.connection_id(),
        "schema_index build_index: model and vector storage ready"
    );
    mark_index_building(context)?;
    tracing::debug!(
        profile_id = %context.connection_id(),
        status_at = %stored_timestamp_now(),
        "schema_index build_index: SQLite index status set to building"
    );
    Ok(())
}

fn mark_index_building(context: &BuildContext<'_>) -> Result<(), String> {
    let conn = context.lock_index_db()?;
    storage::update_index_status(&conn, context.connection_id(), &IndexStatus::Building)
        .map_err(|error| format!("Failed to set building status: {error}"))
}

fn store_foreign_key_edges(
    context: &BuildContext<'_>,
    foreign_key_chunks: &[GeneratedFkChunk],
) -> Result<(), String> {
    let all_foreign_key_edges: Vec<FkEdge> = foreign_key_chunks
        .iter()
        .flat_map(|(_, _, _, foreign_key)| foreign_key_edges(context.connection_id(), foreign_key))
        .collect();
    let conn = context.lock_index_db()?;
    storage::replace_fk_edges_for_connection(&conn, context.connection_id(), &all_foreign_key_edges)
        .map_err(|error| format!("Failed to store FK edges: {error}"))
}

fn segment_document_frequencies(table_chunks: &[GeneratedTableChunk]) -> Vec<(String, usize)> {
    let mut segment_counts: HashMap<String, usize> = HashMap::new();
    for table_chunk in table_chunks {
        let unique_segments: HashSet<String> = split_identifier_segments(&table_chunk.table_name)
            .into_iter()
            .collect();
        for segment in unique_segments {
            *segment_counts.entry(segment).or_insert(0) += 1;
        }
    }
    segment_counts.into_iter().collect()
}

fn store_segment_frequencies(
    context: &BuildContext<'_>,
    table_chunks: &[GeneratedTableChunk],
) -> Result<(), String> {
    let entries = segment_document_frequencies(table_chunks);
    let conn = context.lock_index_db()?;
    storage::replace_segment_df_for_connection(&conn, context.connection_id(), &entries)
        .map_err(|error| format!("Failed to store segment DF: {error}"))
}

fn stage_chunks(
    context: &BuildContext<'_>,
    ddl_inputs: &[TableDdlInput],
    schema_objects: &SchemaObjects,
) -> Result<StagedChunks, String> {
    let GeneratedChunks {
        table_chunks,
        foreign_key_chunks,
    } = generate_all_chunks_with_row_counts(ddl_inputs, &schema_objects.row_counts);
    tracing::debug!(
        profile_id = %context.connection_id(),
        table_chunk_rows = table_chunks.len(),
        fk_chunk_rows = foreign_key_chunks.len(),
        "schema_index build_index: generated table and FK chunk texts (DDL normalized, hashes computed)"
    );
    store_foreign_key_edges(context, &foreign_key_chunks)?;
    store_segment_frequencies(context, &table_chunks)?;

    let table_chunk_count = table_chunks.len();
    let mut pending: Vec<PendingChunk> = table_chunks
        .into_iter()
        .map(PendingChunk::from_table_chunk)
        .collect();
    pending.extend(schema_objects.views.iter().map(PendingChunk::from_view));
    pending.extend(
        schema_objects
            .routines
            .iter()
            .map(PendingChunk::from_routine),
    );
    Ok(StagedChunks {
        pending,
        table_chunk_count,
    })
}

fn delete_obsolete_chunks(
    context: &BuildContext<'_>,
    obsolete_keys: &[String],
) -> Result<(), String> {
    if obsolete_keys.is_empty() {
        return Ok(());
    }
    tracing::info!(
        profile_id = %context.connection_id(),
        remove_count = obsolete_keys.len(),
        at = %stored_timestamp_now(),
        "schema_index build_index: deleting obsolete chunk keys no longer present in schema"
    );
    tracing::debug!(
        profile_id = %context.connection_id(),
        obsolete_chunk_keys = ?obsolete_keys,
        "schema_index build_index: obsolete chunk keys to delete"
    );
    let conn = context.lock_index_db()?;
    for key in obsolete_keys {
        storage::delete_chunk_by_key(&conn, context.connection_id(), key)
            .map_err(|error| format!("Failed to delete chunk {key}: {error}"))?;
    }
    Ok(())
}

fn plan_embedding<'a>(
    context: &BuildContext<'_>,
    pending: &'a [PendingChunk],
) -> Result<EmbeddingPlan<'a>, String> {
    let stored_hashes = {
        let conn = context.lock_index_db()?;
        storage::get_chunk_hashes(&conn, context.connection_id())
            .map_err(|error| format!("Failed to get chunk hashes: {error}"))?
    };
    let new_for_diff: Vec<(String, String, String)> =
        pending.iter().map(PendingChunk::diff_entry).collect();
    let ChunkDiff {
        needs_embed,
        to_delete,
    } = diff_chunks(&stored_hashes, &new_for_diff);
    delete_obsolete_chunks(context, &to_delete)?;
    let chunks_to_embed = pending
        .iter()
        .filter(|chunk| needs_embed.contains(&chunk.chunk_key))
        .collect();
    Ok(EmbeddingPlan {
        chunks_to_embed,
        obsolete_removed: to_delete.len(),
    })
}

fn log_embedding_plan(context: &BuildContext<'_>, plan: &EmbeddingPlan<'_>, total_current: usize) {
    let chunks_to_embed = &plan.chunks_to_embed;
    let total_to_embed = chunks_to_embed.len();
    tracing::info!(
        profile_id = %context.connection_id(),
        staged_at = %stored_timestamp_now(),
        total_chunks_current = total_current,
        staged_for_embedding = total_to_embed,
        staged_table_chunks = count_table_chunks(chunks_to_embed),
        staged_foreign_key_chunks = count_foreign_key_chunks(chunks_to_embed),
        unchanged_chunks_skipped = total_current.saturating_sub(total_to_embed),
        obsolete_chunks_removed = plan.obsolete_removed,
        "schema_index build_index: diff complete — staged chunks for embedding (new or hash-changed); skipped unchanged"
    );
    let should_log_chunk_keys = tracing::enabled!(tracing::Level::DEBUG) && total_to_embed > 0;
    if !should_log_chunk_keys {
        return;
    }
    let keys_preview: Vec<(&str, &str)> = chunks_to_embed
        .iter()
        .map(|chunk| (chunk.chunk_key.as_str(), chunk.chunk_type.as_str()))
        .collect();
    tracing::debug!(
        profile_id = %context.connection_id(),
        staged_chunk_keys = ?keys_preview,
        "schema_index build_index: full list of chunk keys staged for this build"
    );
}

fn unchanged_table_count(staged: &StagedChunks, chunks_to_embed: &[&PendingChunk]) -> usize {
    let table_keys_to_embed: HashSet<&str> = chunks_to_embed
        .iter()
        .filter(|chunk| chunk.is_table())
        .map(|chunk| chunk.chunk_key.as_str())
        .collect();
    staged.table_chunk_count - table_keys_to_embed.len()
}

async fn embed_and_store_batch(
    context: &BuildContext<'_>,
    position: BatchPosition<'_>,
) -> Result<(), String> {
    let BatchPosition {
        chunks,
        batch_start,
        total_to_embed,
    } = position;
    if context.is_cancelled() {
        tracing::warn!(
            profile_id = %context.connection_id(),
            at = %stored_timestamp_now(),
            progress_chunks = batch_start,
            total_chunks = total_to_embed,
            "schema_index build_index: cancelled during embedding"
        );
        return Err(BUILD_CANCELLED.to_string());
    }
    tracing::info!(
        profile_id = %context.connection_id(),
        batch_start,
        batch_end = batch_start + chunks.len(),
        batch_len = chunks.len(),
        at = %stored_timestamp_now(),
        "schema_index build_index: calling embedding API for batch"
    );
    tracing::debug!(
        profile_id = %context.connection_id(),
        chunk_keys = ?chunk_keys(chunks),
        "schema_index build_index: batch chunk keys (no DDL text logged)"
    );

    let embed_started = Instant::now();
    let embeddings = request_embeddings(context, chunks).await?;
    tracing::debug!(
        profile_id = %context.connection_id(),
        batch_start,
        elapsed_ms = elapsed_millis(embed_started),
        vectors_returned = embeddings.len(),
        vector_dims = embeddings.first().map(|embedding| embedding.len()).unwrap_or(0),
        "schema_index build_index: embedding API batch finished"
    );

    store_upserted_batch(
        context,
        EmbeddedBatch {
            chunks,
            embeddings: &embeddings,
        },
    )?;
    tracing::debug!(
        profile_id = %context.connection_id(),
        batch_start,
        at = %stored_timestamp_now(),
        "schema_index build_index: SQLite transaction committed for embedding batch"
    );
    Ok(())
}

async fn embed_changed_chunks(
    context: &BuildContext<'_>,
    staged: &StagedChunks,
    tables_total: usize,
) -> Result<EmbeddingOutcome, String> {
    let plan = plan_embedding(context, &staged.pending)?;
    log_embedding_plan(context, &plan, staged.pending.len());
    let chunks_to_embed = plan.chunks_to_embed;
    let total_to_embed = chunks_to_embed.len();

    let mut progress_tracker = EmbeddingProgressTracker::new(EmbeddingProgressStart {
        profile_id: context.config.connection_id.clone(),
        unchanged_tables: unchanged_table_count(staged, &chunks_to_embed),
        tables_total,
        total_embed_batches: total_to_embed.div_ceil(EMBED_BATCH_SIZE),
    });
    context.report(progress_tracker.start());

    for (batch_index, chunks) in chunks_to_embed.chunks(EMBED_BATCH_SIZE).enumerate() {
        let position = BatchPosition {
            chunks,
            batch_start: batch_index * EMBED_BATCH_SIZE,
            total_to_embed,
        };
        embed_and_store_batch(context, position).await?;
        context.report(progress_tracker.record_batch(count_table_chunks(chunks)));
    }
    Ok(EmbeddingOutcome {
        progress_tracker,
        total_to_embed,
    })
}

fn persist_signatures(
    context: &BuildContext<'_>,
    signatures: &TableSignatures,
) -> Result<(), String> {
    let conn = context.lock_index_db()?;
    let signature_rows: Vec<(String, String, String)> = signatures
        .current
        .iter()
        .map(|((db_name, table_name), signature)| {
            (db_name.clone(), table_name.clone(), signature.clone())
        })
        .collect();
    conn.execute_batch("BEGIN")
        .map_err(|error| format!("BEGIN signatures: {error}"))?;
    storage::upsert_signatures(&conn, context.connection_id(), &signature_rows)
        .map_err(|error| format!("Failed to upsert signatures: {error}"))?;

    let stale_tables = signatures
        .stored
        .keys()
        .filter(|table| !signatures.current.contains_key(*table));
    for (db_name, table_name) in stale_tables {
        let stale_table = storage::IndexedTableRef {
            connection_id: context.connection_id(),
            db_name,
            table_name,
        };
        storage::delete_signature(&conn, &stale_table)
            .map_err(|error| format!("Failed to delete stale signature: {error}"))?;
    }
    conn.execute_batch("COMMIT")
        .map_err(|error| format!("COMMIT signatures: {error}"))
}

fn mark_index_ready(context: &BuildContext<'_>) -> Result<(), String> {
    let conn = context.lock_index_db()?;
    let meta = storage::get_index_meta(&conn, context.connection_id())
        .map_err(|error| format!("Failed to get index meta: {error}"))?;
    let Some(mut meta_update) = meta else {
        return Ok(());
    };
    meta_update.status = IndexStatus::Ready;
    meta_update.last_build_at = Some(stored_timestamp_now());
    storage::upsert_index_meta(&conn, &meta_update)
        .map_err(|error| format!("Failed to update index meta: {error}"))
}

fn report_finalizing_step(context: &BuildContext<'_>, tracker: &mut EmbeddingProgressTracker) {
    let Some(progress) = tracker.advance_finalizing() else {
        return;
    };
    context.report(progress);
}

pub async fn build_index(
    config: &BuildConfig,
    resources: &IndexBuildResources<'_>,
    on_progress: Option<&ProgressCallback>,
) -> Result<BuildResult, String> {
    let start = Instant::now();
    let context = BuildContext {
        config,
        resources: *resources,
        on_progress,
    };
    tracing::info!(
        profile_id = %config.connection_id,
        model_id = %config.model_id,
        started_at = %stored_timestamp_now(),
        "schema_index build_index: started (full / incremental)"
    );

    prepare_index_storage(&context).await?;
    let table_ddls = read_table_ddls(&context).await?;
    let schema_objects = read_schema_objects(&context).await?;
    let staged = stage_chunks(&context, &table_ddls.ddl_inputs, &schema_objects)?;
    let tables_total = table_ddls.tables_total;
    let EmbeddingOutcome {
        mut progress_tracker,
        total_to_embed,
    } = embed_changed_chunks(&context, &staged, tables_total).await?;

    persist_signatures(&context, &table_ddls.signatures)?;
    report_finalizing_step(&context, &mut progress_tracker);
    mark_index_ready(&context)?;
    report_finalizing_step(&context, &mut progress_tracker);

    let duration_ms = elapsed_millis(start);
    tracing::info!(
        profile_id = %config.connection_id,
        finished_at = %stored_timestamp_now(),
        tables_indexed = tables_total,
        duration_ms,
        chunks_embedded_this_run = total_to_embed,
        "schema_index build_index: completed — status will be set to ready"
    );
    Ok(BuildResult {
        profile_id: config.connection_id.clone(),
        tables_indexed: tables_total,
        duration_ms,
    })
}
