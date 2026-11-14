use super::*;

pub(super) fn index_status(status: &str) -> IndexStatusResponse {
    IndexStatusResponse {
        status: status.to_string(),
        tables_done: None,
        tables_total: None,
        error: None,
    }
}

pub(super) fn resolve_status_profile(
    state: &AppState,
    session_id: &str,
) -> Result<Option<String>, String> {
    let mapped_profile = state
        .session_profile_map
        .lock()
        .map_err(lock_error)?
        .get(session_id)
        .cloned();
    Ok(mapped_profile.or_else(|| state.registry.get_profile_id(session_id)))
}

pub(super) fn configured_embedding_model(state: &AppState) -> Result<Option<String>, String> {
    let embedding_model = read_setting(&state.db, EMBEDDING_MODEL_SETTING)?;
    if embedding_model.is_empty() {
        return Ok(None);
    }
    let endpoint = read_embedding_endpoint(&state.db)?;
    if endpoint.is_empty() {
        return Ok(None);
    }
    Ok(Some(embedding_model))
}

pub(super) fn stored_index_status(
    state: &AppState,
    profile_id: &str,
    embedding_model: &str,
) -> Result<IndexStatusResponse, String> {
    let conn = state.db.lock().map_err(db_lock_error)?;
    let meta = storage::get_index_meta(&conn, profile_id)
        .map_err(|error| format!("Failed to get index meta: {error}"))?;
    let Some(meta) = meta else {
        return Ok(index_status(STATUS_STALE));
    };
    if meta.model_id != embedding_model {
        return Ok(index_status(STATUS_STALE));
    }
    Ok(index_status(meta.status.as_str()))
}

pub fn get_index_status_impl(
    state: &AppState,
    session_id: String,
) -> Result<IndexStatusResponse, String> {
    let Some(profile_id) = resolve_status_profile(state, &session_id)? else {
        return Ok(index_status(STATUS_NOT_CONFIGURED));
    };
    let Some(embedding_model) = configured_embedding_model(state)? else {
        return Ok(index_status(STATUS_NOT_CONFIGURED));
    };
    if is_build_in_progress(state, &profile_id)? {
        return Ok(index_status(STATUS_BUILDING));
    }
    stored_index_status(state, &profile_id, &embedding_model)
}
