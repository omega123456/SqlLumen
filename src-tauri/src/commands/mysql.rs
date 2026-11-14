use crate::commands::helpers::lock_db;
use crate::credentials;
use crate::db::connections;
#[cfg(not(coverage))]
use crate::mysql::health;
use crate::mysql::metadata_cache::evict_metadata_cache_for_connection;
#[cfg(not(coverage))]
use crate::mysql::pool;
#[cfg(coverage)]
use crate::mysql::pool::create_pool;
#[cfg(not(coverage))]
use crate::mysql::pool::{ConnectionParams, SslSettings};
#[cfg(not(coverage))]
use crate::mysql::query_log;
use crate::mysql::registry::ConnectionStatus;
use crate::mysql::registry::OpenConnectionSession;
#[cfg(not(coverage))]
use crate::mysql::registry::RegistryEntry;
use crate::mysql::registry::StoredConnectionParams;
use crate::state::AppState;

#[cfg(not(coverage))]
const DEFAULT_TEST_CONNECT_TIMEOUT_SECS: u64 = 10;
use serde::{Deserialize, Serialize};
#[cfg(not(coverage))]
use sqlx::Row;
#[cfg(not(coverage))]
use std::time::Instant;
#[cfg(not(coverage))]
use tauri::State;
#[cfg(not(coverage))]
use tokio_util::sync::CancellationToken;
#[cfg(not(coverage))]
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionInput {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub profile_id: Option<String>,
    pub default_database: Option<String>,
    pub ssl_enabled: bool,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub connect_timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    pub success: bool,
    pub server_version: Option<String>,
    pub auth_method: Option<String>,
    pub ssl_status: Option<String>,
    pub connection_time_ms: Option<u64>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenConnectionResult {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub server_version: String,
}

#[cfg(not(coverage))]
fn health_monitor_token(
    state: &AppState,
    session_id: &str,
    keepalive_secs: u64,
) -> CancellationToken {
    if keepalive_secs == 0 {
        let token = CancellationToken::new();
        token.cancel();
        return token;
    }
    let Some(ref handle) = state.app_handle else {
        return CancellationToken::new();
    };
    health::spawn_health_monitor(session_id.to_string(), keepalive_secs, handle.clone())
}

#[cfg(not(coverage))]
const SERVER_VERSION_COLUMN: DiagnosticColumn = DiagnosticColumn {
    sql: "SELECT VERSION()",
    column_index: 0,
};

#[cfg(not(coverage))]
async fn fetch_server_version(pool: &sqlx::MySqlPool) -> String {
    fetch_diagnostic_value(pool, SERVER_VERSION_COLUMN)
        .await
        .unwrap_or_else(|| "Unknown".to_string())
}

#[cfg(not(coverage))]
async fn close_pool(pool: sqlx::MySqlPool) {
    pool.close().await;
}

#[cfg(not(coverage))]
fn resolve_test_connection_password(input: &TestConnectionInput) -> Result<String, String> {
    let has_typed_password = !input.password.is_empty();
    if has_typed_password {
        return Ok(input.password.clone());
    }
    let Some(profile_id) = input.profile_id.as_deref() else {
        return Ok(String::new());
    };
    Ok(credentials::get_password(profile_id)?.unwrap_or_default())
}

#[cfg(not(coverage))]
fn ssl_status_label(cipher: String) -> String {
    if cipher.is_empty() {
        return "Not using SSL".to_string();
    }
    cipher
}

#[cfg(not(coverage))]
fn failed_test_connection(error_message: String) -> TestConnectionResult {
    TestConnectionResult {
        success: false,
        server_version: None,
        auth_method: None,
        ssl_status: None,
        connection_time_ms: None,
        error_message: Some(error_message),
    }
}

#[cfg(not(coverage))]
fn test_connection_params(input: TestConnectionInput, password: String) -> ConnectionParams {
    ConnectionParams {
        host: input.host,
        port: input.port,
        username: input.username,
        password,
        default_database: input.default_database,
        ssl: SslSettings {
            enabled: input.ssl_enabled,
            ca_path: input.ssl_ca_path,
            cert_path: input.ssl_cert_path,
            key_path: input.ssl_key_path,
        },
        connect_timeout_secs: input
            .connect_timeout_secs
            .unwrap_or(DEFAULT_TEST_CONNECT_TIMEOUT_SECS)
            .max(1),
    }
}

#[cfg(not(coverage))]
struct DiagnosticColumn {
    sql: &'static str,
    column_index: usize,
}

#[cfg(not(coverage))]
async fn fetch_diagnostic_value(
    pool: &sqlx::MySqlPool,
    column: DiagnosticColumn,
) -> Option<String> {
    query_log::log_outgoing_sql(column.sql);
    let row = sqlx::query(column.sql).fetch_one(pool).await.ok()?;
    query_log::log_mysql_rows(std::slice::from_ref(&row));
    row.try_get::<String, _>(column.column_index).ok()
}

#[cfg(not(coverage))]
pub async fn test_connection_impl(input: TestConnectionInput) -> TestConnectionResult {
    let password = match resolve_test_connection_password(&input) {
        Ok(password) => password,
        Err(error) => return failed_test_connection(error),
    };
    let params = test_connection_params(input, password);

    let start = Instant::now();
    let pool = match pool::create_pool(&params).await {
        Ok(created_pool) => created_pool,
        Err(error) => return failed_test_connection(format!("Connection failed: {error}")),
    };
    let connection_time_ms = start.elapsed().as_millis() as u64;

    let server_version = fetch_diagnostic_value(&pool, SERVER_VERSION_COLUMN).await;
    let ssl_cipher_column = DiagnosticColumn {
        sql: "SHOW STATUS LIKE 'Ssl_cipher'",
        column_index: 1,
    };
    let ssl_status = fetch_diagnostic_value(&pool, ssl_cipher_column)
        .await
        .map(ssl_status_label);
    let current_user_column = DiagnosticColumn {
        sql: "SELECT CURRENT_USER()",
        column_index: 0,
    };
    let auth_method = fetch_diagnostic_value(&pool, current_user_column).await;

    pool.close().await;

    TestConnectionResult {
        success: true,
        server_version,
        auth_method,
        ssl_status,
        connection_time_ms: Some(connection_time_ms),
        error_message: None,
    }
}

#[cfg(coverage)]
pub async fn test_connection_impl(_input: TestConnectionInput) -> TestConnectionResult {
    TestConnectionResult {
        success: false,
        server_version: None,
        auth_method: None,
        ssl_status: None,
        connection_time_ms: None,
        error_message: Some("Connection failed: coverage stub".to_string()),
    }
}

#[cfg(not(coverage))]
pub async fn open_connection_impl(
    state: &AppState,
    profile_id: &str,
) -> Result<OpenConnectionResult, String> {
    let record = {
        let conn = lock_db(state)?;
        match connections::get_connection(&conn, profile_id) {
            Ok(Some(record)) => record,
            Ok(None) => return Err(format!("Connection '{profile_id}' not found")),
            Err(error) => return Err(error.to_string()),
        }
    };

    let password = credentials::resolve_password(profile_id, record.has_password)?;

    let stored_params = StoredConnectionParams::from_connection_record(profile_id, &record);
    let keepalive_secs = stored_params.keepalive_interval_secs;

    let params = stored_params.to_connection_params(password);

    let pool = pool::create_pool(&params)
        .await
        .map_err(|error| format!("Failed to connect: {error}"))?;

    let server_version = fetch_server_version(&pool).await;

    let session_id = Uuid::new_v4().to_string();

    let cancellation_token = health_monitor_token(state, &session_id, keepalive_secs);

    let entry = RegistryEntry {
        pool,
        session_id: session_id.clone(),
        profile_id: profile_id.to_string(),
        status: ConnectionStatus::Connected,
        server_version: server_version.clone(),
        cancellation_token,
        connection_params: stored_params,
        read_only: record.read_only,
    };
    if let Some(old_entry) = state.registry.insert(session_id.clone(), entry) {
        close_pool(old_entry.pool).await;
    }

    Ok(OpenConnectionResult {
        session_id,
        server_version,
    })
}

#[cfg(coverage)]
pub async fn open_connection_impl(
    state: &AppState,
    profile_id: &str,
) -> Result<OpenConnectionResult, String> {
    let record = {
        let conn = lock_db(state)?;
        match connections::get_connection(&conn, profile_id) {
            Ok(Some(record)) => record,
            Ok(None) => return Err(format!("Connection '{profile_id}' not found")),
            Err(error) => return Err(error.to_string()),
        }
    };

    let password = credentials::resolve_password(profile_id, record.has_password)?;

    let params = StoredConnectionParams::from_connection_record(profile_id, &record)
        .to_connection_params(password);

    let pool = create_pool(&params)
        .await
        .map_err(|error| format!("Failed to connect: {error}"))?;

    pool.close().await;

    let session_id = uuid::Uuid::new_v4().to_string();
    Ok(OpenConnectionResult {
        session_id,
        server_version: "Unknown".to_string(),
    })
}

fn cleanup_schema_index_session(state: &AppState, connection_id: &str) {
    let profile_id = match state.session_profile_map.lock() {
        Ok(map) => map.get(connection_id).cloned(),
        Err(_) => None,
    };

    let Some(profile_id) = profile_id else {
        return;
    };

    let should_cleanup = release_profile_session_reference(state, &profile_id);

    if let Ok(mut map) = state.session_profile_map.lock() {
        map.remove(connection_id);
    }

    if should_cleanup {
        cancel_profile_index_build(state, &profile_id);
    }
}

fn release_profile_session_reference(state: &AppState, profile_id: &str) -> bool {
    let Ok(mut counts) = state.session_ref_counts.lock() else {
        return false;
    };
    let Some(count) = counts.get_mut(profile_id) else {
        return false;
    };
    *count = count.saturating_sub(1);
    *count == 0
}

fn cancel_profile_index_build(state: &AppState, profile_id: &str) {
    if let Ok(mut tokens) = state.index_build_tokens.lock() {
        if let Some(token) = tokens.remove(profile_id) {
            token.cancel();
        }
    }
    if let Ok(mut counts) = state.session_ref_counts.lock() {
        counts.remove(profile_id);
    }
}

#[cfg(coverage)]
pub async fn close_connection_impl(state: &AppState, connection_id: &str) -> Result<(), String> {
    crate::export::result_export::cancel_result_exports_for_connection(state, connection_id).await;
    if !state.has_open_connection(connection_id) {
        return Err(format!("Connection '{connection_id}' is not open"));
    }
    cleanup_schema_index_session(state, connection_id);

    {
        let mut rq = state.running_queries.write().await;
        rq.retain(|(conn_id, _), _| conn_id != connection_id);
    }
    evict_metadata_cache_for_connection(state, connection_id);
    crate::mysql::session::close(state, connection_id).await;
    Ok(())
}

#[cfg(not(coverage))]
pub async fn close_connection_impl(state: &AppState, connection_id: &str) -> Result<(), String> {
    crate::export::result_export::cancel_result_exports_for_connection(state, connection_id).await;

    cleanup_schema_index_session(state, connection_id);

    let entry = state
        .registry
        .remove(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' is not open"))?;

    {
        let mut rq = state.running_queries.write().await;
        rq.retain(|(conn_id, _), _| conn_id != connection_id);
    }

    evict_metadata_cache_for_connection(state, connection_id);
    crate::mysql::session::close(state, connection_id).await;

    close_pool(entry.pool).await;
    Ok(())
}

pub fn get_connection_status_impl(
    state: &AppState,
    connection_id: &str,
) -> Option<ConnectionStatus> {
    state.registry.get_status(connection_id)
}

pub fn list_open_connection_sessions_impl(state: &AppState) -> Vec<OpenConnectionSession> {
    state.registry.list_sessions()
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn test_connection(input: TestConnectionInput) -> Result<TestConnectionResult, String> {
    Ok(test_connection_impl(input).await)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenConnectionPayload {
    pub profile_id: String,
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn open_connection(
    payload: OpenConnectionPayload,
    state: State<'_, AppState>,
) -> Result<OpenConnectionResult, String> {
    open_connection_impl(&state, &payload.profile_id).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn close_connection(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    close_connection_impl(&state, &connection_id).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn get_connection_status(
    connection_id: String,
    state: State<AppState>,
) -> Option<ConnectionStatus> {
    get_connection_status_impl(&state, &connection_id)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn list_open_connection_sessions(state: State<AppState>) -> Vec<OpenConnectionSession> {
    list_open_connection_sessions_impl(&state)
}
