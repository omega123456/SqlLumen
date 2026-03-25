use crate::credentials;
use crate::mysql::pool;
use crate::mysql::schema_queries::safe_identifier;
use crate::state::AppState;

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
    connection_id: &str,
    database_name: &str,
) -> Result<(), String> {
    let mut stored_params = state
        .registry
        .get_connection_params(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found"))?;

    let _ = safe_identifier(database_name)?;
    stored_params.default_database = Some(database_name.to_string());

    let password = if stored_params.has_password {
        credentials::retrieve_password_for_connection(
            stored_params.profile_id.as_str(),
            stored_params.keychain_ref.as_deref(),
        )?
    } else {
        String::new()
    };

    #[cfg(any(test, feature = "test-utils"))]
    if let Some(hook) = *TEST_SELECT_DATABASE_HOOK
        .lock()
        .expect("select database hook lock poisoned")
    {
        hook(connection_id, database_name)?;
        state
            .registry
            .set_default_database(connection_id, Some(database_name.to_string()));
        return Ok(());
    }

    let new_pool = pool::create_pool(&stored_params.to_connection_params(password))
        .await
        .map_err(|e| format!("Failed to select database '{database_name}': {e}"))?;

    state.registry.replace_pool(connection_id, new_pool);
    state
        .registry
        .set_default_database(connection_id, Some(database_name.to_string()));

    Ok(())
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn select_database(
    connection_id: String,
    database_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    select_database_impl(&state, &connection_id, &database_name).await
}
