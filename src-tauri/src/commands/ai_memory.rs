use std::time::Instant;

use super::helpers::resolve_session_profile;
use crate::ai_memory::{read_embedding_config, storage, types::AiMemory, types::MemoryScope};
#[cfg(not(coverage))]
use crate::ai_memory::{reembed, search};
use crate::db::{connection_groups, connections};
use crate::schema_index::embeddings;
use crate::state::AppState;

#[cfg(not(coverage))]
use tauri::{Emitter, State};

// ── Scope/owner resolution ──────────────────────────────────────────────────

/// Resolve the owner id required for a save/list at the given scope, starting
/// from the runtime session.
///
/// - Connection scope → the session's connection profile id.
/// - Group scope → the connection's `group_id` (descriptive error if the
///   connection has no group).
/// - Global scope → `None` (no owner).
pub fn resolve_save_owner(
    state: &AppState,
    session_id: &str,
    scope: MemoryScope,
) -> Result<Option<String>, String> {
    let profile_id = resolve_session_profile(state, session_id)?;

    match scope {
        MemoryScope::Connection => Ok(Some(profile_id)),
        MemoryScope::Global => Ok(None),
        MemoryScope::Group => {
            let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
            let record = connections::get_connection(&conn, &profile_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Connection '{profile_id}' not found"))?;
            record
                .group_id
                .ok_or_else(|| {
                    tracing::warn!(
                        connection_id = %profile_id,
                        "save_memory: group scope requested but connection has no group"
                    );
                    format!(
                        "Connection '{}' is not in a group — cannot save a group-scoped memory",
                        record.name
                    )
                })
                .map(Some)
        }
    }
}

// ── save_memory ─────────────────────────────────────────────────────────────

/// Synchronous part of save_memory: resolve owner, read embedding config,
/// insert the row. Returns the inserted memory plus the data the async embed
/// step needs (`owner_id`, endpoint, model).
pub fn save_memory_impl(
    state: &AppState,
    session_id: &str,
    content: &str,
    scope: MemoryScope,
) -> Result<(AiMemory, Option<String>, String, String), String> {
    let owner_id = resolve_save_owner(state, session_id, scope)?;

    let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;

    // Read embedding config — fail early if not configured.
    let (endpoint, model) = read_embedding_config(&conn)?;

    let id = storage::insert_memory_scoped(&conn, scope, owner_id.as_deref(), content)?;

    let memory = storage::get_memory_by_id_scoped(&conn, scope, id)?
        .ok_or_else(|| "Failed to read back inserted memory".to_string())?;

    Ok((memory, owner_id, endpoint, model))
}

/// Complete save_memory with the async embedding step.
pub async fn save_memory_full(
    state: &AppState,
    session_id: &str,
    content: &str,
    scope: MemoryScope,
) -> Result<AiMemory, String> {
    tracing::debug!(
        session_id,
        scope = scope.as_str(),
        content_len = content.len(),
        "save_memory: start"
    );

    let (memory, owner_id, endpoint, model) = save_memory_impl(state, session_id, content, scope)?;

    tracing::debug!(
        memory_id = memory.id,
        scope = scope.as_str(),
        model = %model,
        "save_memory: row inserted — detecting dimension and embedding content"
    );

    let started = Instant::now();

    let embed_result = async {
        let dim = embeddings::detect_embedding_dimension(&state.http_client, &endpoint, &model)
            .await
            .map_err(|e| e.to_string())?;

        let table_name = {
            let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
            storage::ensure_vec_table_for_scope(&conn, scope, owner_id.as_deref(), dim)?
        };

        let vecs = embeddings::embed_texts(
            &state.http_client,
            &endpoint,
            &model,
            vec![content.to_string()],
            None,
        )
        .await
        .map_err(|e| e.to_string())?;

        if vecs.len() != 1 {
            return Err(format!(
                "Expected 1 embedding from embed_texts, got {}",
                vecs.len()
            ));
        }

        let embedding = vecs.into_iter().next().unwrap();
        let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
        storage::insert_memory_vector(&conn, &table_name, memory.id, &embedding)
            .map_err(|e| e.to_string())?;

        Ok::<(), String>(())
    }
    .await;

    if let Err(e) = embed_result {
        tracing::error!(memory_id = memory.id, scope = scope.as_str(), error = %e, "save_memory: embedding failed — cleaning up row");
        // Best-effort cleanup: remove the orphaned memory row.
        if let Ok(conn) = state.db.lock() {
            let _ = storage::delete_memory_scoped(&conn, scope, memory.id);
        }
        return Err(e);
    }

    tracing::debug!(
        memory_id = memory.id,
        scope = scope.as_str(),
        model = %model,
        elapsed_ms = started.elapsed().as_millis() as u64,
        "save_memory: vector stored — done"
    );

    Ok(memory)
}

// ── Granular list commands ──────────────────────────────────────────────────

pub fn list_global_memories_impl(state: &AppState) -> Result<Vec<AiMemory>, String> {
    tracing::debug!("list_global_memories: start");
    let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
    let memories = storage::list_global_memories(&conn).map_err(|e| e.to_string())?;
    tracing::debug!(count = memories.len(), "list_global_memories: done");
    Ok(memories)
}

pub fn list_group_memories_impl(state: &AppState, group_id: &str) -> Result<Vec<AiMemory>, String> {
    tracing::debug!(group_id, "list_group_memories: start");
    let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
    let memories = storage::list_group_memories(&conn, group_id).map_err(|e| e.to_string())?;
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
    let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
    let memories = storage::list_memories(&conn, connection_id).map_err(|e| e.to_string())?;
    tracing::debug!(
        connection_id,
        count = memories.len(),
        "list_connection_memories: done"
    );
    Ok(memories)
}

// ── delete_memory ───────────────────────────────────────────────────────────

pub fn delete_memory_impl(
    state: &AppState,
    scope: MemoryScope,
    memory_id: i64,
) -> Result<(), String> {
    tracing::debug!(scope = scope.as_str(), memory_id, "delete_memory: start");
    let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;

    let memory = storage::get_memory_by_id_scoped(&conn, scope, memory_id)?.ok_or_else(|| {
        tracing::error!(
            scope = scope.as_str(),
            memory_id,
            "delete_memory: not found"
        );
        format!("Memory with id {memory_id} not found")
    })?;

    // Determine the owner id for the vec table from the row itself.
    let owner_id = match scope {
        MemoryScope::Connection => memory.connection_id.clone(),
        MemoryScope::Group => memory.group_id.clone(),
        MemoryScope::Global => None,
    };

    storage::delete_memory_vector_scoped(&conn, scope, owner_id.as_deref(), memory_id)?;
    storage::delete_memory_scoped(&conn, scope, memory_id)?;

    tracing::debug!(
        scope = scope.as_str(),
        memory_id,
        "delete_memory: row and vector removed"
    );
    Ok(())
}

// ── move_memory ─────────────────────────────────────────────────────────────

/// Synchronous prelude for move: validate the target owner exists, read the
/// source memory content, and read embedding config. Returns the data the
/// async embed step needs.
#[allow(clippy::too_many_arguments)]
pub fn move_memory_prepare(
    state: &AppState,
    memory_id: i64,
    from_scope: MemoryScope,
    to_scope: MemoryScope,
    to_group_id: Option<&str>,
    to_connection_id: Option<&str>,
) -> Result<(String, Option<String>, String, String), String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;

    let source = storage::get_memory_by_id_scoped(&conn, from_scope, memory_id)?
        .ok_or_else(|| format!("Memory with id {memory_id} not found at source scope"))?;

    // Resolve + validate the target owner.
    let to_owner_id: Option<String> = match to_scope {
        MemoryScope::Global => None,
        MemoryScope::Group => {
            let gid = to_group_id.ok_or_else(|| "group target requires toGroupId".to_string())?;
            connection_groups::get_group(&conn, gid)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Group '{gid}' not found"))?;
            Some(gid.to_string())
        }
        MemoryScope::Connection => {
            let cid = to_connection_id
                .ok_or_else(|| "connection target requires toConnectionId".to_string())?;
            connections::get_connection(&conn, cid)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Connection '{cid}' not found"))?;
            Some(cid.to_string())
        }
    };

    let (endpoint, model) = read_embedding_config(&conn)?;

    Ok((source.content, to_owner_id, endpoint, model))
}

/// Complete move_memory: re-embed the (unchanged) source content into the
/// target vec table, then transfer the row + vector via the storage helper.
#[allow(clippy::too_many_arguments)]
pub async fn move_memory_full(
    state: &AppState,
    memory_id: i64,
    from_scope: MemoryScope,
    to_scope: MemoryScope,
    from_owner_id: Option<String>,
    to_group_id: Option<String>,
    to_connection_id: Option<String>,
) -> Result<AiMemory, String> {
    tracing::debug!(
        memory_id,
        from = from_scope.as_str(),
        to = to_scope.as_str(),
        "move_memory: start"
    );

    let (content, to_owner_id, endpoint, model) = move_memory_prepare(
        state,
        memory_id,
        from_scope,
        to_scope,
        to_group_id.as_deref(),
        to_connection_id.as_deref(),
    )?;

    let dim = embeddings::detect_embedding_dimension(&state.http_client, &endpoint, &model)
        .await
        .map_err(|e| e.to_string())?;
    let _ = dim; // dimension is implied by the embedding length; kept for parity/logging.

    let vecs = embeddings::embed_texts(
        &state.http_client,
        &endpoint,
        &model,
        vec![content.clone()],
        None,
    )
    .await
    .map_err(|e| e.to_string())?;

    let embedding = vecs
        .into_iter()
        .next()
        .ok_or_else(|| "Empty embedding response".to_string())?;

    let new_memory = {
        let mut conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
        storage::move_memory(
            &mut conn,
            from_scope,
            from_owner_id.as_deref(),
            memory_id,
            to_scope,
            to_owner_id.as_deref(),
            &embedding,
        )?
    };

    tracing::debug!(
        memory_id,
        new_id = new_memory.id,
        to = to_scope.as_str(),
        "move_memory: done"
    );

    Ok(new_memory)
}

// ── search_memories ─────────────────────────────────────────────────────────

/// Resolve the (connection id, optional group id) for a session — used by the
/// merged search.
pub fn resolve_search_owners(
    state: &AppState,
    session_id: &str,
) -> Result<(String, Option<String>), String> {
    let profile_id = resolve_session_profile(state, session_id)?;
    let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
    let group_id = connections::get_connection(&conn, &profile_id)
        .map_err(|e| e.to_string())?
        .and_then(|record| record.group_id);
    Ok((profile_id, group_id))
}

// ── reembed_all ─────────────────────────────────────────────────────────────

/// Compute the (scope, owner_id, owner_key) re-embed targets across all levels:
/// global, every group, and every connection.
pub fn reembed_targets(
    state: &AppState,
) -> Result<Vec<(MemoryScope, Option<String>, String)>, String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;

    let mut targets: Vec<(MemoryScope, Option<String>, String)> = Vec::new();

    // Global (always).
    targets.push((MemoryScope::Global, None, "global".to_string()));

    // Every group.
    for group in connection_groups::list_groups(&conn).map_err(|e| e.to_string())? {
        let owner_key = format!("group_{}", group.id);
        targets.push((MemoryScope::Group, Some(group.id), owner_key));
    }

    // Every connection.
    for record in connections::list_connections(&conn).map_err(|e| e.to_string())? {
        targets.push((MemoryScope::Connection, Some(record.id.clone()), record.id));
    }

    Ok(targets)
}

// ── Tauri command wrappers ──────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub async fn save_memory(
    session_id: String,
    content: String,
    scope: MemoryScope,
    state: State<'_, AppState>,
) -> Result<AiMemory, String> {
    save_memory_full(&state, &session_id, &content, scope).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn list_global_memories(state: State<AppState>) -> Result<Vec<AiMemory>, String> {
    list_global_memories_impl(&state)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn list_group_memories(
    group_id: String,
    state: State<AppState>,
) -> Result<Vec<AiMemory>, String> {
    list_group_memories_impl(&state, &group_id)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn list_connection_memories(
    connection_id: String,
    state: State<AppState>,
) -> Result<Vec<AiMemory>, String> {
    list_connection_memories_impl(&state, &connection_id)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn delete_memory(
    scope: MemoryScope,
    memory_id: i64,
    state: State<AppState>,
) -> Result<(), String> {
    delete_memory_impl(&state, scope, memory_id)
}

#[cfg(not(coverage))]
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn move_memory(
    memory_id: i64,
    from_scope: MemoryScope,
    to_scope: MemoryScope,
    from_group_id: Option<String>,
    from_connection_id: Option<String>,
    to_group_id: Option<String>,
    to_connection_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<AiMemory, String> {
    // The source owner is whichever of from_group_id / from_connection_id matches
    // the source scope; global has no owner.
    let from_owner_id = match from_scope {
        MemoryScope::Connection => from_connection_id,
        MemoryScope::Group => from_group_id,
        MemoryScope::Global => None,
    };
    move_memory_full(
        &state,
        memory_id,
        from_scope,
        to_scope,
        from_owner_id,
        to_group_id,
        to_connection_id,
    )
    .await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn search_memories(
    session_id: String,
    query: String,
    k: usize,
    state: State<'_, AppState>,
) -> Result<Vec<AiMemory>, String> {
    let (connection_id, group_id) = resolve_search_owners(&state, &session_id)?;
    search::search_memories_impl(&state, &connection_id, group_id.as_deref(), &query, k).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn reembed_all_memories(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let targets = reembed_targets(&state)?;

    for (scope, owner_id, owner_key) in targets {
        let app = app_handle.clone();
        reembed::reembed_scope_impl(&state, scope, owner_id, &owner_key, move |progress| {
            let _ = app.emit("ai-memory-reembed-progress", &progress);
        })
        .await?;
    }

    Ok(())
}
