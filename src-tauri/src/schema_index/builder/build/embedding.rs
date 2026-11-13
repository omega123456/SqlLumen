use rusqlite::Connection;

use super::super::super::embeddings;
use super::super::super::storage;
use super::super::super::types::{BuildConfig, ChunkEmbeddingUpdate};
use super::pending_chunk::PendingChunk;
use super::{BuildContext, SQLITE_COMMIT_BATCH};

#[derive(Clone, Copy)]
pub(super) struct EmbeddedBatch<'a> {
    pub(super) chunks: &'a [&'a PendingChunk],
    pub(super) embeddings: &'a [Vec<f32>],
}

#[derive(Clone, Copy)]
struct EmbeddedChunk<'a> {
    chunk: &'a PendingChunk,
    embedding: &'a [f32],
}

pub(super) async fn request_embeddings(
    context: &BuildContext<'_>,
    batch: &[&PendingChunk],
) -> Result<Vec<Vec<f32>>, String> {
    let embedding_model = embeddings::EmbeddingModel {
        base_url: &context.config.endpoint,
        model: &context.config.model_id,
    };
    let texts = batch.iter().map(|chunk| chunk.embedding_text()).collect();
    let input = embeddings::EmbeddingInput::texts(texts);
    embeddings::embed_texts(context.resources.http_client, embedding_model, input)
        .await
        .map_err(|error| format!("Embedding failed: {error}"))
}

fn execute_transaction_statement(conn: &Connection, statement: &str) -> Result<(), String> {
    conn.execute_batch(statement)
        .map_err(|error| format!("{statement}: {error}"))
}

fn upsert_embedded_chunk(
    conn: &Connection,
    config: &BuildConfig,
    embedded: EmbeddedChunk<'_>,
) -> Result<(), String> {
    let EmbeddedChunk { chunk, embedding } = embedded;
    let existing = storage::get_chunk_by_key(conn, &config.connection_id, &chunk.chunk_key)
        .map_err(|error| format!("Failed to lookup chunk: {error}"))?;
    let Some(existing_chunk) = existing else {
        return insert_embedded_chunk(conn, config, embedded);
    };
    let update = ChunkEmbeddingUpdate {
        chunk_id: existing_chunk.id,
        ddl_text: &chunk.ddl_text,
        ddl_hash: &chunk.ddl_hash,
        model_id: &config.model_id,
        embedding,
        text_for_embedding: chunk.text_for_embedding.as_deref(),
        row_count_approx: chunk.row_count_approx,
    };
    storage::update_chunk_embedding(conn, &config.connection_id, &update)
        .map_err(|error| format!("Failed to update chunk: {error}"))
}

fn insert_embedded_chunk(
    conn: &Connection,
    config: &BuildConfig,
    embedded: EmbeddedChunk<'_>,
) -> Result<(), String> {
    let insert = embedded
        .chunk
        .to_insert(config, embedded.embedding.to_vec());
    storage::insert_chunk(conn, &insert)
        .map(|_| ())
        .map_err(|error| format!("Failed to insert chunk: {error}"))
}

fn embedded_chunk<'a>(batch: EmbeddedBatch<'a>, chunk_index: usize) -> EmbeddedChunk<'a> {
    EmbeddedChunk {
        chunk: batch.chunks[chunk_index],
        embedding: &batch.embeddings[chunk_index],
    }
}

pub(super) fn store_upserted_batch(
    context: &BuildContext<'_>,
    batch: EmbeddedBatch<'_>,
) -> Result<(), String> {
    let conn = context.lock_index_db()?;
    let mut statements_in_transaction = 0;
    execute_transaction_statement(&conn, "BEGIN")?;
    for chunk_index in 0..batch.chunks.len() {
        upsert_embedded_chunk(&conn, context.config, embedded_chunk(batch, chunk_index))?;
        statements_in_transaction += 1;
        if statements_in_transaction >= SQLITE_COMMIT_BATCH {
            execute_transaction_statement(&conn, "COMMIT")?;
            execute_transaction_statement(&conn, "BEGIN")?;
            statements_in_transaction = 0;
        }
    }
    execute_transaction_statement(&conn, "COMMIT")
}

pub(super) fn store_inserted_batch(
    context: &BuildContext<'_>,
    batch: EmbeddedBatch<'_>,
) -> Result<(), String> {
    let conn = context.lock_index_db()?;
    execute_transaction_statement(&conn, "BEGIN")?;
    for chunk_index in 0..batch.chunks.len() {
        insert_embedded_chunk(&conn, context.config, embedded_chunk(batch, chunk_index))?;
    }
    execute_transaction_statement(&conn, "COMMIT")
}
