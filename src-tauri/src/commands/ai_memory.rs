use std::time::Instant;

use super::helpers::resolve_session_profile;
use crate::ai_memory::{read_embedding_config, storage, types::AiMemory};
#[cfg(not(coverage))]
use crate::ai_memory::{reembed, search};
use crate::schema_index::embeddings;
use crate::state::AppState;

#[cfg(not(coverage))]
use tauri::{Emitter, State};

// ── Testable _impl functions ────────────────────────────────────────────────

pub fn save_memory_impl(
    state: &AppState,
    session_id: &str,
    content: &str,
) -> Result<(AiMemory, String, String, String), String> {
    let profile_id = resolve_session_profile(state, session_id)?;
    let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;

    // Read embedding config — fail early if not configured
    let (endpoint, model) = read_embedding_config(&conn)?;

    // Insert memory row
    let id = storage::insert_memory(&conn, &profile_id, content).map_err(|e| e.to_string())?;

    let memory = storage::get_memory_by_id(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Failed to read back inserted memory".to_string())?;

    Ok((memory, profile_id, endpoint, model))
}

/// Complete save_memory with async embedding step.
pub async fn save_memory_full(
    state: &AppState,
    session_id: &str,
    content: &str,
) -> Result<AiMemory, String> {
    tracing::debug!(
        session_id,
        content_len = content.len(),
        "save_memory: start"
    );

    let (memory, profile_id, endpoint, model) = save_memory_impl(state, session_id, content)?;

    tracing::debug!(
        memory_id = memory.id,
        connection_id = %profile_id,
        model = %model,
        "save_memory: row inserted — detecting dimension and embedding content"
    );

    let started = Instant::now();

    // Embed and store vector (config already validated above)
    let embed_result = async {
        let dim = embeddings::detect_embedding_dimension(&state.http_client, &endpoint, &model)
            .await
            .map_err(|e| e.to_string())?;

        tracing::debug!(
            memory_id = memory.id,
            connection_id = %profile_id,
            model = %model,
            dim,
            "save_memory: dimension detected — calling embed_texts"
        );

        let table_name = {
            let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
            storage::ensure_vec_table(&conn, &profile_id, dim).map_err(|e| e.to_string())?
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
        tracing::error!(memory_id = memory.id, connection_id = %profile_id, error = %e, "save_memory: embedding failed — cleaning up row");
        // Best-effort cleanup: remove the orphaned memory row
        if let Ok(conn) = state.db.lock() {
            let _ = storage::delete_memory(&conn, memory.id);
        }
        return Err(e);
    }

    tracing::debug!(
        memory_id = memory.id,
        connection_id = %profile_id,
        model = %model,
        elapsed_ms = started.elapsed().as_millis() as u64,
        "save_memory: vector stored — done"
    );

    Ok(memory)
}

pub fn list_memories_impl(state: &AppState, connection_id: &str) -> Result<Vec<AiMemory>, String> {
    tracing::debug!(connection_id, "list_memories: start");
    let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
    let memories = storage::list_memories(&conn, connection_id).map_err(|e| e.to_string())?;
    tracing::debug!(connection_id, count = memories.len(), "list_memories: done");
    Ok(memories)
}

pub fn delete_memory_impl(state: &AppState, memory_id: i64) -> Result<(), String> {
    tracing::debug!(memory_id, "delete_memory: start");
    let conn = state.db.lock().map_err(|e| format!("DB lock: {e}"))?;
    // Look up memory to get connection_id for vec table
    let memory = storage::get_memory_by_id(&conn, memory_id)
        .map_err(|e| {
            tracing::error!(memory_id, %e, "delete_memory: failed to look up memory");
            e.to_string()
        })?
        .ok_or_else(|| {
            let msg = format!("Memory with id {memory_id} not found");
            tracing::error!(memory_id, "delete_memory: not found");
            msg
        })?;

    storage::delete_memory_vector(&conn, &memory.connection_id, memory_id)
        .map_err(|e| e.to_string())?;
    storage::delete_memory(&conn, memory_id).map_err(|e| e.to_string())?;

    tracing::debug!(memory_id, connection_id = %memory.connection_id, "delete_memory: row and vector removed");
    Ok(())
}

// ── Tauri command wrappers ──────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tauri::command]
pub async fn save_memory(
    session_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<AiMemory, String> {
    save_memory_full(&state, &session_id, &content).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn list_memories(
    connection_id: String,
    state: State<AppState>,
) -> Result<Vec<AiMemory>, String> {
    list_memories_impl(&state, &connection_id)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn delete_memory(memory_id: i64, state: State<AppState>) -> Result<(), String> {
    delete_memory_impl(&state, memory_id)
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn search_memories(
    session_id: String,
    query: String,
    k: usize,
    state: State<'_, AppState>,
) -> Result<Vec<AiMemory>, String> {
    let profile_id = resolve_session_profile(&state, &session_id)?;
    search::search_memories_impl(&state, &profile_id, &query, k).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn reembed_memories(
    connection_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let app = app_handle.clone();
    reembed::reembed_memories_impl(&state, &connection_id, move |progress| {
        let _ = app.emit("ai-memory-reembed-progress", &progress);
    })
    .await
}
