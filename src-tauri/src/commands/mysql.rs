use crate::commands::helpers::lock_db;
#[cfg(not(coverage))]
use crate::credentials;
use crate::db::connections;
#[cfg(not(coverage))]
use crate::mysql::cell_values::DecodedRow;
#[cfg(not(coverage))]
use crate::mysql::health;
#[cfg(not(coverage))]
use crate::mysql::logged_query::{fetch_first, LoggedStatement};
use crate::mysql::metadata_cache::evict_metadata_cache_for_connection;
#[cfg(not(coverage))]
use crate::mysql::pool;
#[cfg(coverage)]
use crate::mysql::pool::create_pool;
#[cfg(not(coverage))]
use crate::mysql::pool::{ConnectionParams, SslSettings};
use crate::mysql::registry::ConnectionStatus;
use crate::mysql::registry::OpenConnectionSession;
#[cfg(not(coverage))]
use crate::mysql::registry::RegistryEntry;
use crate::mysql::registry::{SessionPassword, StoredConnectionParams};
use crate::state::AppState;
use crate::timestamps;

#[cfg(not(coverage))]
const DEFAULT_TEST_CONNECT_TIMEOUT_SECS: u64 = 10;
use serde::{Deserialize, Serialize};
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
    pub ssl_mode: crate::db::ssl_mode::SslMode,
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
    pub last_connected_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OpenConnectionErrorKind {
    AccessDenied,
    Failed,
}

#[cfg(not(coverage))]
impl OpenConnectionErrorKind {
    fn of_connect_failure(failure: &crate::mysql::connection_options::ConnectFailure) -> Self {
        if failure.is_access_denied() {
            return Self::AccessDenied;
        }
        Self::Failed
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenConnectionError {
    pub kind: OpenConnectionErrorKind,
    pub message: String,
}

impl From<String> for OpenConnectionError {
    fn from(message: String) -> Self {
        Self {
            kind: OpenConnectionErrorKind::Failed,
            message,
        }
    }
}

#[cfg(not(coverage))]
impl From<crate::mysql::connection_options::ConnectFailure> for OpenConnectionError {
    fn from(failure: crate::mysql::connection_options::ConnectFailure) -> Self {
        Self {
            kind: OpenConnectionErrorKind::of_connect_failure(&failure),
            message: format!("Failed to connect: {failure}"),
        }
    }
}

struct ProfileToOpen {
    #[cfg(not(coverage))]
    read_only: bool,
    stored_params: StoredConnectionParams,
}

fn profile_to_open(
    state: &AppState,
    payload: OpenConnectionPayload,
) -> Result<ProfileToOpen, String> {
    let profile_id = payload.profile_id.as_str();
    let conn = lock_db(state)?;
    let record = match connections::get_connection(&conn, profile_id) {
        Ok(Some(record)) => record,
        Ok(None) => return Err(format!("Connection '{profile_id}' not found")),
        Err(error) => return Err(error.to_string()),
    };
    let mut stored_params = StoredConnectionParams::from_connection_record(profile_id, &record);
    stored_params.session_password = payload.password.map(SessionPassword::new);
    Ok(ProfileToOpen {
        #[cfg(not(coverage))]
        read_only: record.read_only,
        stored_params,
    })
}

fn record_last_connected(state: &AppState, profile_id: &str) -> Option<String> {
    let connected_at = timestamps::stored_timestamp_now();
    let recorded = lock_db(state).and_then(|conn| {
        connections::record_connected(&conn, profile_id, &connected_at)
            .map_err(|error| error.to_string())
    });
    if let Err(error) = recorded {
        tracing::warn!(
            profile_id,
            error,
            "failed to record the last connected time"
        );
        return None;
    }
    Some(connected_at)
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
    sql: pool::SERVER_VERSION_SQL,
    column_index: 0,
};

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
            mode: input.ssl_mode,
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
    conn: &mut mysql_async::Conn,
    column: DiagnosticColumn,
) -> Option<String> {
    let fetched = fetch_first(conn, LoggedStatement::text(column.sql)).await;
    let first_row = match fetched {
        Ok(first_row) => first_row?,
        Err(error) => {
            tracing::warn!(
                sql = column.sql,
                ?error,
                "test connection diagnostic failed"
            );
            return None;
        }
    };
    DecodedRow::from_row(first_row)
        .required_text(column.column_index)
        .ok()
}

#[cfg(not(coverage))]
async fn open_test_connection(params: &ConnectionParams) -> Result<mysql_async::Conn, String> {
    crate::mysql::connection_options::connect_with_params(params)
        .await
        .map_err(|failure| failure.to_string())
}

#[cfg(not(coverage))]
pub async fn test_connection_impl(input: TestConnectionInput) -> TestConnectionResult {
    let password = match resolve_test_connection_password(&input) {
        Ok(password) => password,
        Err(error) => return failed_test_connection(error),
    };
    let params = test_connection_params(input, password);

    let start = Instant::now();
    let mut conn = match open_test_connection(&params).await {
        Ok(opened_connection) => opened_connection,
        Err(error) => return failed_test_connection(format!("Connection failed: {error}")),
    };
    let connection_time_ms = start.elapsed().as_millis() as u64;

    let server_version = fetch_diagnostic_value(&mut conn, SERVER_VERSION_COLUMN).await;
    let ssl_cipher_column = DiagnosticColumn {
        sql: "SHOW STATUS LIKE 'Ssl_cipher'",
        column_index: 1,
    };
    let ssl_status = fetch_diagnostic_value(&mut conn, ssl_cipher_column)
        .await
        .map(ssl_status_label);
    let current_user_column = DiagnosticColumn {
        sql: "SELECT CURRENT_USER()",
        column_index: 0,
    };
    let auth_method = fetch_diagnostic_value(&mut conn, current_user_column).await;

    if let Err(error) = conn.disconnect().await {
        tracing::warn!(?error, "test connection disconnect failed");
    }

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
    payload: OpenConnectionPayload,
) -> Result<OpenConnectionResult, OpenConnectionError> {
    let ProfileToOpen {
        read_only,
        stored_params,
    } = profile_to_open(state, payload)?;
    let profile_id = stored_params.profile_id.clone();
    let keepalive_secs = stored_params.keepalive_interval_secs;
    let params = stored_params.to_connection_params(stored_params.resolve_password()?);

    let pool::OpenedPool {
        pool,
        server_version,
    } = pool::create_pool_reading_version(&params).await?;

    let session_id = Uuid::new_v4().to_string();

    let cancellation_token = health_monitor_token(state, &session_id, keepalive_secs);

    let entry = RegistryEntry {
        pool,
        session_id: session_id.clone(),
        profile_id: profile_id.clone(),
        status: ConnectionStatus::Connected,
        server_version: server_version.clone(),
        cancellation_token,
        connection_params: stored_params,
        read_only,
    };
    let replaced_entry = state.registry.insert(session_id.clone(), entry);
    drop(replaced_entry);

    Ok(OpenConnectionResult {
        session_id,
        server_version,
        last_connected_at: record_last_connected(state, &profile_id),
    })
}

#[cfg(coverage)]
pub async fn open_connection_impl(
    state: &AppState,
    payload: OpenConnectionPayload,
) -> Result<OpenConnectionResult, OpenConnectionError> {
    let ProfileToOpen { stored_params } = profile_to_open(state, payload)?;
    let params = stored_params.to_connection_params(stored_params.resolve_password()?);

    let validated_pool = create_pool(&params)
        .await
        .map_err(|error| format!("Failed to connect: {error}"))?;
    drop(validated_pool);

    let session_id = uuid::Uuid::new_v4().to_string();
    Ok(OpenConnectionResult {
        session_id,
        server_version: crate::mysql::pool::UNKNOWN_SERVER_VERSION.to_string(),
        last_connected_at: record_last_connected(state, &stored_params.profile_id),
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

    entry.pool.disconnect_in_background("connection close");
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
    #[serde(default)]
    pub password: Option<String>,
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn open_connection(
    payload: OpenConnectionPayload,
    state: State<'_, AppState>,
) -> Result<OpenConnectionResult, OpenConnectionError> {
    open_connection_impl(&state, payload).await
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
