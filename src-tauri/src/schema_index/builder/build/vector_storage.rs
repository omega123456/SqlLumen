use std::sync::Mutex;

use super::super::super::embeddings;
use super::super::super::storage;
use super::super::super::types::{BuildConfig, IndexMeta, IndexStatus};
use super::lock_index_db;

#[derive(Clone, Copy)]
pub(super) struct VectorStorageTarget<'a> {
    pub(super) config: &'a BuildConfig,
    pub(super) sqlite_conn: &'a Mutex<rusqlite::Connection>,
}

fn current_vec_schema_version() -> i64 {
    storage::VEC_SCHEMA_VERSION as i64
}

fn is_stale_vec_schema(meta: &IndexMeta) -> bool {
    meta.vec_schema_version != Some(current_vec_schema_version())
}

fn building_meta(config: &BuildConfig, dimension: usize) -> IndexMeta {
    IndexMeta {
        connection_id: config.connection_id.clone(),
        model_id: config.model_id.clone(),
        embedding_dimension: dimension as i64,
        last_build_at: None,
        status: IndexStatus::Building,
        vec_schema_version: Some(current_vec_schema_version()),
    }
}

fn load_index_meta(target: VectorStorageTarget<'_>) -> Result<Option<IndexMeta>, String> {
    let conn = lock_index_db(target.sqlite_conn)?;
    storage::get_index_meta(&conn, &target.config.connection_id)
        .map_err(|error| format!("Failed to get index meta: {error}"))
}

async fn detect_dimension(
    config: &BuildConfig,
    http_client: &reqwest::Client,
) -> Result<usize, String> {
    embeddings::detect_embedding_dimension(http_client, &config.endpoint, &config.model_id)
        .await
        .map_err(|error| format!("Failed to detect embedding dimension: {error}"))
}

fn create_vector_storage_locked(
    conn: &rusqlite::Connection,
    config: &BuildConfig,
    dimension: usize,
) -> Result<(), String> {
    storage::create_vec_table(conn, &config.connection_id, dimension)
        .map_err(|error| format!("Failed to create vec table: {error}"))?;
    storage::upsert_index_meta(conn, &building_meta(config, dimension))
        .map_err(|error| format!("Failed to upsert index meta: {error}"))
}

fn create_vector_storage(target: VectorStorageTarget<'_>, dimension: usize) -> Result<(), String> {
    let conn = lock_index_db(target.sqlite_conn)?;
    create_vector_storage_locked(&conn, target.config, dimension)
}

fn recreate_vector_storage(
    target: VectorStorageTarget<'_>,
    dimension: usize,
) -> Result<(), String> {
    let conn = lock_index_db(target.sqlite_conn)?;
    delete_chunks_then_drop_vec_table(&conn, &target.config.connection_id)?;
    create_vector_storage_locked(&conn, target.config, dimension)
}

fn delete_chunks_then_drop_vec_table(
    conn: &rusqlite::Connection,
    connection_id: &str,
) -> Result<(), String> {
    storage::delete_all_chunks(conn, connection_id)
        .map_err(|error| format!("Failed to delete chunks: {error}"))?;
    storage::drop_vec_table(conn, connection_id)
        .map_err(|error| format!("Failed to drop vec table: {error}"))
}

/// Handle model change: if the stored model differs from config, drop the vec table,
/// clear all chunks, detect new dimension, and recreate.
pub(super) async fn prepare_vector_storage(
    target: VectorStorageTarget<'_>,
    http_client: &reqwest::Client,
) -> Result<(), String> {
    let config = target.config;
    let Some(meta) = load_index_meta(target)? else {
        let dimension = detect_dimension(config, http_client).await?;
        return create_vector_storage(target, dimension);
    };

    if meta.model_id != config.model_id {
        tracing::info!(
            old_model = %meta.model_id,
            new_model = %config.model_id,
            "Schema index model changed, rebuilding"
        );
        let dimension = detect_dimension(config, http_client).await?;
        return recreate_vector_storage(target, dimension);
    }

    if is_stale_vec_schema(&meta) {
        tracing::info!(
            old_version = ?meta.vec_schema_version,
            new_version = storage::VEC_SCHEMA_VERSION,
            "Vec0 table schema version changed, rebuilding"
        );
        return recreate_vector_storage(target, meta.embedding_dimension as usize);
    }

    tracing::debug!(
        profile_id = %config.connection_id,
        model_id = %config.model_id,
        "schema_index handle_model_change: same model and vec schema — incremental path"
    );
    Ok(())
}
