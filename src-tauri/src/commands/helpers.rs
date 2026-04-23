use crate::state::AppState;

/// Resolve a runtime session ID to the saved connection profile ID.
///
/// Tries the `session_profile_map` first (populated when schema-index registers
/// a session), then falls back to the connection `registry`.
pub fn resolve_session_profile(state: &AppState, session_id: &str) -> Result<String, String> {
    // Try session_profile_map first
    if let Ok(map) = state.session_profile_map.lock() {
        if let Some(pid) = map.get(session_id) {
            return Ok(pid.clone());
        }
    }

    // Fall back to registry
    state
        .registry
        .get_profile_id(session_id)
        .ok_or_else(|| format!("Session '{session_id}' not found"))
}
