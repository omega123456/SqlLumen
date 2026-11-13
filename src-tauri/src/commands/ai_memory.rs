use std::time::Instant;

use super::helpers::resolve_session_profile;
use crate::ai_memory::reembed::ReembedTarget;
use crate::ai_memory::types::{
    AiMemory, MemoryMove, MemoryOwner, MemoryReembedProgress, MemoryScope, MemoryVector,
};
use crate::ai_memory::{read_embedding_config, storage, EmbeddingConfig};
use crate::ai_memory::{reembed, search};
use crate::db::{connection_groups, connections};
use crate::schema_index::embeddings::{self, EmbeddingInput};
use crate::state::AppState;
use serde::Deserialize;

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
            let conn = state
                .db
                .lock()
                .map_err(|error| format!("DB lock: {error}"))?;
            let record = connections::get_connection(&conn, &profile_id)
                .map_err(|error| error.to_string())?
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMemoryRequest {
    pub session_id: String,
    pub content: String,
    pub scope: MemoryScope,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteMemoryRequest {
    pub scope: MemoryScope,
    pub memory_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveMemoryRequest {
    pub memory_id: i64,
    pub from_scope: MemoryScope,
    pub to_scope: MemoryScope,
    pub from_group_id: Option<String>,
    pub from_connection_id: Option<String>,
    pub to_group_id: Option<String>,
    pub to_connection_id: Option<String>,
}

impl MoveMemoryRequest {
    pub fn from_owner_id(&self) -> Option<&str> {
        match self.from_scope {
            MemoryScope::Connection => self.from_connection_id.as_deref(),
            MemoryScope::Group => self.from_group_id.as_deref(),
            MemoryScope::Global => None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMemoriesRequest {
    pub session_id: String,
    pub query: String,
    pub limit: usize,
}

#[derive(Debug)]
pub struct SavedMemory {
    pub memory: AiMemory,
    pub owner_id: Option<String>,
    pub embedding: EmbeddingConfig,
}

#[derive(Debug)]
pub struct MemoryMovePlan {
    pub content: String,
    pub to_owner_id: Option<String>,
    pub embedding: EmbeddingConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchOwners {
    pub connection_id: String,
    pub group_id: Option<String>,
}

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

    let SavedMemory {
        memory,
        owner_id,
        embedding: EmbeddingConfig { endpoint, model },
    } = save_memory_impl(state, request)?;

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
            .map_err(|error| error.to_string())?;

        let table_name = {
            let conn = state
                .db
                .lock()
                .map_err(|error| format!("DB lock: {error}"))?;
            let owner = MemoryOwner {
                scope,
                owner_id: owner_id.as_deref(),
            };
            storage::ensure_vec_table_for_scope(&conn, owner, dim)?
        };

        let embedding_model = embeddings::EmbeddingModel {
            base_url: &endpoint,
            model: &model,
        };
        let input = EmbeddingInput::texts(vec![content.to_string()]);
        let vecs = embeddings::embed_texts(&state.http_client, embedding_model, input)
            .await
            .map_err(|error| error.to_string())?;

        let embedding_count = vecs.len();
        if embedding_count != 1 {
            return Err(format!(
                "Expected 1 embedding from embed_texts, got {embedding_count}"
            ));
        }

        let embedding = vecs.into_iter().next().unwrap();
        let conn = state
            .db
            .lock()
            .map_err(|error| format!("DB lock: {error}"))?;
        let vector = MemoryVector {
            memory_id: memory.id,
            embedding: &embedding,
        };
        storage::insert_memory_vector(&conn, &table_name, &vector)
            .map_err(|error| error.to_string())?;

        Ok::<(), String>(())
    }
    .await;

    if let Err(error) = embed_result {
        tracing::error!(memory_id = memory.id, scope = scope.as_str(), error = %error, "save_memory: embedding failed — cleaning up row");
        // Best-effort cleanup: remove the orphaned memory row.
        if let Ok(conn) = state.db.lock() {
            let _ = storage::delete_memory_scoped(&conn, scope, memory.id);
        }
        return Err(error);
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

// ── delete_memory ───────────────────────────────────────────────────────────

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

    // Determine the owner id for the vec table from the row itself.
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

// ── move_memory ─────────────────────────────────────────────────────────────

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

    // Resolve + validate the target owner.
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
    let _ = dim; // dimension is implied by the embedding length; kept for parity/logging.

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

// ── search_memories ─────────────────────────────────────────────────────────

pub fn resolve_search_owners(state: &AppState, session_id: &str) -> Result<SearchOwners, String> {
    let profile_id = resolve_session_profile(state, session_id)?;
    let conn = state
        .db
        .lock()
        .map_err(|error| format!("DB lock: {error}"))?;
    let group_id = connections::get_connection(&conn, &profile_id)
        .map_err(|error| error.to_string())?
        .and_then(|record| record.group_id);
    Ok(SearchOwners {
        connection_id: profile_id,
        group_id,
    })
}

// ── reembed_all ─────────────────────────────────────────────────────────────

pub fn reembed_targets(state: &AppState) -> Result<Vec<ReembedTarget>, String> {
    let conn = state
        .db
        .lock()
        .map_err(|error| format!("DB lock: {error}"))?;

    let mut targets: Vec<ReembedTarget> = Vec::new();

    targets.push(ReembedTarget {
        scope: MemoryScope::Global,
        owner_id: None,
        owner_key: "global".to_string(),
    });

    for group in connection_groups::list_groups(&conn).map_err(|error| error.to_string())? {
        let owner_key = format!("group_{}", group.id);
        targets.push(ReembedTarget {
            scope: MemoryScope::Group,
            owner_id: Some(group.id),
            owner_key,
        });
    }

    for record in connections::list_connections(&conn).map_err(|error| error.to_string())? {
        targets.push(ReembedTarget {
            scope: MemoryScope::Connection,
            owner_id: Some(record.id.clone()),
            owner_key: record.id,
        });
    }

    Ok(targets)
}

// ── Tauri command wrappers ──────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub async fn save_memory(
    payload: SaveMemoryRequest,
    state: State<'_, AppState>,
) -> Result<AiMemory, String> {
    save_memory_full(&state, &payload).await
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
pub fn delete_memory(payload: DeleteMemoryRequest, state: State<AppState>) -> Result<(), String> {
    delete_memory_impl(&state, &payload)
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn move_memory(
    payload: MoveMemoryRequest,
    state: State<'_, AppState>,
) -> Result<AiMemory, String> {
    move_memory_full(&state, &payload).await
}

pub async fn search_session_memories(
    state: &AppState,
    request: &SearchMemoriesRequest,
) -> Result<Vec<AiMemory>, String> {
    let owners = resolve_search_owners(state, &request.session_id)?;
    let memory_search = search::MemorySearch {
        connection_id: &owners.connection_id,
        group_id: owners.group_id.as_deref(),
        query: &request.query,
        limit: request.limit,
    };
    search::search_memories_impl(state, &memory_search).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn search_memories(
    payload: SearchMemoriesRequest,
    state: State<'_, AppState>,
) -> Result<Vec<AiMemory>, String> {
    search_session_memories(&state, &payload).await
}

pub async fn reembed_all_scopes<F>(state: &AppState, report_progress: F) -> Result<(), String>
where
    F: Fn(MemoryReembedProgress) + Clone + Send + 'static,
{
    for target in reembed_targets(state)? {
        reembed::reembed_scope_impl(state, target, report_progress.clone()).await?;
    }
    Ok(())
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn reembed_all_memories(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    reembed_all_scopes(&state, move |progress| {
        let _ = app_handle.emit("ai-memory-reembed-progress", &progress);
    })
    .await
}
