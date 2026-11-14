use super::*;

pub fn list_global_memories_impl(state: &AppState) -> Result<Vec<AiMemory>, String> {
    tracing::debug!("list_global_memories: start");
    let conn = state
        .db
        .lock()
        .map_err(|error| format!("DB lock: {error}"))?;
    let memories = storage::list_global_memories(&conn).map_err(|error| error.to_string())?;
    tracing::debug!(count = memories.len(), "list_global_memories: done");
    Ok(memories)
}

pub fn list_group_memories_impl(state: &AppState, group_id: &str) -> Result<Vec<AiMemory>, String> {
    tracing::debug!(group_id, "list_group_memories: start");
    let conn = state
        .db
        .lock()
        .map_err(|error| format!("DB lock: {error}"))?;
    let memories =
        storage::list_group_memories(&conn, group_id).map_err(|error| error.to_string())?;
    tracing::debug!(
        group_id,
        count = memories.len(),
        "list_group_memories: done"
    );
    Ok(memories)
}

pub fn list_connection_memories_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<AiMemory>, String> {
    tracing::debug!(connection_id, "list_connection_memories: start");
    let conn = state
        .db
        .lock()
        .map_err(|error| format!("DB lock: {error}"))?;
    let memories =
        storage::list_memories(&conn, connection_id).map_err(|error| error.to_string())?;
    tracing::debug!(
        connection_id,
        count = memories.len(),
        "list_connection_memories: done"
    );
    Ok(memories)
}

pub fn delete_memory_impl(state: &AppState, request: &DeleteMemoryRequest) -> Result<(), String> {
    let scope = request.scope;
    let memory_id = request.memory_id;
    tracing::debug!(scope = scope.as_str(), memory_id, "delete_memory: start");
    let conn = state
        .db
        .lock()
        .map_err(|error| format!("DB lock: {error}"))?;

    let memory = storage::get_memory_by_id_scoped(&conn, scope, memory_id)?.ok_or_else(|| {
        tracing::error!(
            scope = scope.as_str(),
            memory_id,
            "delete_memory: not found"
        );
        format!("Memory with id {memory_id} not found")
    })?;

    let owner_id = match scope {
        MemoryScope::Connection => memory.connection_id.clone(),
        MemoryScope::Group => memory.group_id.clone(),
        MemoryScope::Global => None,
    };

    let owner = MemoryOwner {
        scope,
        owner_id: owner_id.as_deref(),
    };
    storage::delete_memory_vector_scoped(&conn, owner, memory_id)?;
    storage::delete_memory_scoped(&conn, scope, memory_id)?;

    tracing::debug!(
        scope = scope.as_str(),
        memory_id,
        "delete_memory: row and vector removed"
    );
    Ok(())
}

pub fn move_memory_prepare(
    state: &AppState,
    request: &MoveMemoryRequest,
) -> Result<MemoryMovePlan, String> {
    let memory_id = request.memory_id;
    let from_scope = request.from_scope;
    let to_scope = request.to_scope;
    let to_group_id = request.to_group_id.as_deref();
    let to_connection_id = request.to_connection_id.as_deref();
    let conn = state
        .db
        .lock()
        .map_err(|error| format!("DB lock: {error}"))?;

    let source = storage::get_memory_by_id_scoped(&conn, from_scope, memory_id)?
        .ok_or_else(|| format!("Memory with id {memory_id} not found at source scope"))?;

    let to_owner_id: Option<String> = match to_scope {
        MemoryScope::Global => None,
        MemoryScope::Group => {
            let gid = to_group_id.ok_or_else(|| "group target requires toGroupId".to_string())?;
            connection_groups::get_group(&conn, gid)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| format!("Group '{gid}' not found"))?;
            Some(gid.to_string())
        }
        MemoryScope::Connection => {
            let cid = to_connection_id
                .ok_or_else(|| "connection target requires toConnectionId".to_string())?;
            connections::get_connection(&conn, cid)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| format!("Connection '{cid}' not found"))?;
            Some(cid.to_string())
        }
    };

    let embedding = read_embedding_config(&conn)?;

    Ok(MemoryMovePlan {
        content: source.content,
        to_owner_id,
        embedding,
    })
}

pub async fn move_memory_full(
    state: &AppState,
    request: &MoveMemoryRequest,
) -> Result<AiMemory, String> {
    let memory_id = request.memory_id;
    let from_scope = request.from_scope;
    let to_scope = request.to_scope;
    tracing::debug!(
        memory_id,
        from = from_scope.as_str(),
        to = to_scope.as_str(),
        "move_memory: start"
    );

    let MemoryMovePlan {
        content,
        to_owner_id,
        embedding: EmbeddingConfig { endpoint, model },
    } = move_memory_prepare(state, request)?;

    let dim = embeddings::detect_embedding_dimension(&state.http_client, &endpoint, &model)
        .await
        .map_err(|error| error.to_string())?;
    let _ = dim;

    let embedding_model = embeddings::EmbeddingModel {
        base_url: &endpoint,
        model: &model,
    };
    let input = EmbeddingInput::texts(vec![content.clone()]);
    let vecs = embeddings::embed_texts(&state.http_client, embedding_model, input)
        .await
        .map_err(|error| error.to_string())?;

    let embedding = vecs
        .into_iter()
        .next()
        .ok_or_else(|| "Empty embedding response".to_string())?;

    let new_memory = {
        let mut conn = state
            .db
            .lock()
            .map_err(|error| format!("DB lock: {error}"))?;
        let memory_move = MemoryMove {
            memory_id,
            from: MemoryOwner {
                scope: from_scope,
                owner_id: request.from_owner_id(),
            },
            to: MemoryOwner {
                scope: to_scope,
                owner_id: to_owner_id.as_deref(),
            },
            embedding: &embedding,
        };
        storage::move_memory(&mut conn, &memory_move)?
    };

    tracing::debug!(
        memory_id,
        new_id = new_memory.id,
        to = to_scope.as_str(),
        "move_memory: done"
    );

    Ok(new_memory)
}
