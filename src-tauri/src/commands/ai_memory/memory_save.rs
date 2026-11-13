use super::*;

pub fn save_memory_impl(
    state: &AppState,
    request: &SaveMemoryRequest,
) -> Result<SavedMemory, String> {
    let scope = request.scope;
    let owner_id = resolve_save_owner(state, &request.session_id, scope)?;

    let conn = state
        .db
        .lock()
        .map_err(|error| format!("DB lock: {error}"))?;

    let embedding = read_embedding_config(&conn)?;

    let owner = MemoryOwner {
        scope,
        owner_id: owner_id.as_deref(),
    };
    let id = storage::insert_memory_scoped(&conn, owner, &request.content)?;

    let memory = storage::get_memory_by_id_scoped(&conn, scope, id)?
        .ok_or_else(|| "Failed to read back inserted memory".to_string())?;

    Ok(SavedMemory {
        memory,
        owner_id,
        embedding,
    })
}

pub(super) fn lock_memory_db(
    state: &AppState,
) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, String> {
    state.db.lock().map_err(|error| format!("DB lock: {error}"))
}

pub(super) fn single_embedding(vecs: Vec<Vec<f32>>) -> Result<Vec<f32>, String> {
    let embedding_count = vecs.len();
    let mut embeddings = vecs.into_iter();
    match (embeddings.next(), embeddings.next()) {
        (Some(embedding), None) => Ok(embedding),
        _ => Err(format!(
            "Expected 1 embedding from embed_texts, got {embedding_count}"
        )),
    }
}

pub(super) async fn embed_saved_memory(
    state: &AppState,
    saved: &SavedMemory,
    content: &str,
) -> Result<(), String> {
    let EmbeddingConfig { endpoint, model } = &saved.embedding;
    let dim = embeddings::detect_embedding_dimension(&state.http_client, endpoint, model)
        .await
        .map_err(|error| error.to_string())?;

    let table_name = {
        let conn = lock_memory_db(state)?;
        let owner = MemoryOwner {
            scope: saved.memory.scope,
            owner_id: saved.owner_id.as_deref(),
        };
        storage::ensure_vec_table_for_scope(&conn, owner, dim)?
    };

    let embedding_model = embeddings::EmbeddingModel {
        base_url: endpoint,
        model,
    };
    let input = EmbeddingInput::texts(vec![content.to_string()]);
    let vecs = embeddings::embed_texts(&state.http_client, embedding_model, input)
        .await
        .map_err(|error| error.to_string())?;
    let embedding = single_embedding(vecs)?;

    let conn = lock_memory_db(state)?;
    let vector = MemoryVector {
        memory_id: saved.memory.id,
        embedding: &embedding,
    };
    storage::insert_memory_vector(&conn, &table_name, &vector).map_err(|error| error.to_string())
}

pub(super) fn discard_unembedded_memory(state: &AppState, memory: &AiMemory) {
    // Best-effort cleanup: remove the orphaned memory row.
    if let Ok(conn) = state.db.lock() {
        let _ = storage::delete_memory_scoped(&conn, memory.scope, memory.id);
    }
}

pub async fn save_memory_full(
    state: &AppState,
    request: &SaveMemoryRequest,
) -> Result<AiMemory, String> {
    let scope = request.scope;
    let content = request.content.as_str();
    tracing::debug!(
        session_id = %request.session_id,
        scope = scope.as_str(),
        content_len = content.len(),
        "save_memory: start"
    );

    let saved = save_memory_impl(state, request)?;
    let memory_id = saved.memory.id;
    tracing::debug!(
        memory_id,
        scope = scope.as_str(),
        model = %saved.embedding.model,
        "save_memory: row inserted — detecting dimension and embedding content"
    );

    let started = Instant::now();
    if let Err(error) = embed_saved_memory(state, &saved, content).await {
        tracing::error!(memory_id, scope = scope.as_str(), error = %error, "save_memory: embedding failed — cleaning up row");
        discard_unembedded_memory(state, &saved.memory);
        return Err(error);
    }

    tracing::debug!(
        memory_id,
        scope = scope.as_str(),
        model = %saved.embedding.model,
        elapsed_ms = started.elapsed().as_millis() as u64,
        "save_memory: vector stored — done"
    );

    Ok(saved.memory)
}
