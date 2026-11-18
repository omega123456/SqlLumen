use crate::mysql::pool;
use crate::mysql::schema_queries::safe_identifier;
use crate::state::AppState;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectDatabaseRequest {
    pub connection_id: String,
    pub database_name: String,
}

#[cfg(any(test, feature = "test-utils"))]
type SelectDatabaseHook = fn(&str, &str) -> Result<(), String>;

#[cfg(any(test, feature = "test-utils"))]
static TEST_SELECT_DATABASE_HOOK: std::sync::Mutex<Option<SelectDatabaseHook>> =
    std::sync::Mutex::new(None);

#[cfg(any(test, feature = "test-utils"))]
pub fn set_test_select_database_hook(hook: Option<SelectDatabaseHook>) {
    let mut guard = TEST_SELECT_DATABASE_HOOK
        .lock()
        .expect("select database hook lock poisoned");
    *guard = hook;
}

pub async fn select_database_impl(
    state: &AppState,
    request: &SelectDatabaseRequest,
) -> Result<(), String> {
    let connection_id = request.connection_id.as_str();
    let database_name = request.database_name.as_str();
    let mut stored_params = state
        .registry
        .get_connection_params(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let _ = safe_identifier(database_name)?;
    stored_params.default_database = Some(database_name.to_string());

    let password = stored_params.resolve_password()?;

    #[cfg(any(test, feature = "test-utils"))]
    let hook = *TEST_SELECT_DATABASE_HOOK
        .lock()
        .expect("select database hook lock poisoned");
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(hook) = hook {
        hook(connection_id, database_name)?;
        crate::mysql::session::use_database(state, connection_id, database_name).await?;
        state
            .registry
            .set_default_database(connection_id, Some(database_name.to_string()));
        return Ok(());
    }

    let new_pool = pool::create_pool(&stored_params.to_connection_params(password))
        .await
        .map_err(|error| format!("Failed to select database '{database_name}': {error}"))?;

    crate::mysql::session::use_database(state, connection_id, database_name).await?;

    state.registry.replace_pool(connection_id, new_pool);
    state
        .registry
        .set_default_database(connection_id, Some(database_name.to_string()));
    Ok(())
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn select_database(
    payload: SelectDatabaseRequest,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    select_database_impl(&state, &payload).await
}
