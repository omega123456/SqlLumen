use crate::credentials;
use crate::db::connections;
#[cfg(not(coverage))]
use crate::mysql::health;
#[cfg(not(coverage))]
use crate::mysql::query_log;
#[cfg(not(coverage))]
use crate::mysql::pool;
#[cfg(coverage)]
use crate::mysql::pool::create_pool;
#[cfg(not(coverage))]
use crate::mysql::pool::ConnectionParams;
#[cfg(not(coverage))]
use crate::mysql::registry::{RegistryEntry, StoredConnectionParams};
use crate::mysql::registry::ConnectionStatus;
use crate::state::AppState;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
#[cfg(not(coverage))]
use sqlx::Row;
use std::sync::MutexGuard;
#[cfg(not(coverage))]
use std::time::Instant;
#[cfg(not(coverage))]
use tauri::State;
#[cfg(not(coverage))]
use tokio_util::sync::CancellationToken;
#[cfg(not(coverage))]
use uuid::Uuid;

/// Input parameters for testing a MySQL connection.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionInput {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub default_database: Option<String>,
    pub ssl_enabled: bool,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub connect_timeout_secs: Option<u64>,
}

/// Result of testing a MySQL connection.
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

/// Result of opening a MySQL connection.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenConnectionResult {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub server_version: String,
}

// --- Testable implementations ---

#[cfg(not(coverage))]
fn lock_db(state: &AppState) -> Result<MutexGuard<'_, Connection>, String> {
    match state.db.lock() {
        Ok(conn) => Ok(conn),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(coverage)]
fn lock_db(state: &AppState) -> Result<MutexGuard<'_, Connection>, String> {
    match state.db.lock() {
        Ok(conn) => Ok(conn),
        Err(error) => Err(error.to_string()),
    }
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
        token
    } else if let Some(ref handle) = state.app_handle {
        health::spawn_health_monitor(session_id.to_string(), keepalive_secs, handle.clone())
    } else {
        CancellationToken::new()
    }
}

#[cfg(not(coverage))]
async fn fetch_server_version(pool: &sqlx::MySqlPool) -> String {
    query_log::log_outgoing_sql("SELECT VERSION()");
    let row = sqlx::query("SELECT VERSION()").fetch_one(pool).await.ok();
    if let Some(ref r) = row {
        query_log::log_mysql_rows(std::slice::from_ref(r));
    }
    row.and_then(|r| r.try_get::<String, _>(0).ok())
        .unwrap_or_else(|| "Unknown".to_string())
}

#[cfg(not(coverage))]
async fn close_pool(pool: sqlx::MySqlPool) {
    pool.close().await;
}

/// Test a MySQL connection with the given parameters.
/// Creates a temporary pool, runs diagnostic queries, and drops the pool.
#[cfg(not(coverage))]
pub async fn test_connection_impl(input: TestConnectionInput) -> TestConnectionResult {
    let params = ConnectionParams {
        host: input.host,
        port: input.port,
        username: input.username,
        password: input.password,
        default_database: input.default_database,
        ssl_enabled: input.ssl_enabled,
        ssl_ca_path: input.ssl_ca_path,
        ssl_cert_path: input.ssl_cert_path,
        ssl_key_path: input.ssl_key_path,
        connect_timeout_secs: input.connect_timeout_secs.unwrap_or(10).max(1),
    };

    let start = Instant::now();

    let pool = match pool::create_pool(&params).await {
        Ok(p) => p,
        Err(e) => {
            return TestConnectionResult {
                success: false,
                server_version: None,
                auth_method: None,
                ssl_status: None,
                connection_time_ms: None,
                error_message: Some(format!("Connection failed: {e}")),
            };
        }
    };

    let connection_time_ms = start.elapsed().as_millis() as u64;

    // Run diagnostic queries — failures are non-fatal (report what we can)
    query_log::log_outgoing_sql("SELECT VERSION()");
    let server_version = sqlx::query("SELECT VERSION()")
        .fetch_one(&pool)
        .await
        .ok()
        .and_then(|row| {
            query_log::log_mysql_rows(std::slice::from_ref(&row));
            row.try_get::<String, _>(0).ok()
        });

    query_log::log_outgoing_sql("SHOW STATUS LIKE 'Ssl_cipher'");
    let ssl_status = sqlx::query("SHOW STATUS LIKE 'Ssl_cipher'")
        .fetch_one(&pool)
        .await
        .ok()
        .and_then(|row| {
            query_log::log_mysql_rows(std::slice::from_ref(&row));
            row.try_get::<String, _>(1).ok()
        })
        .map(|s| {
            if s.is_empty() {
                "Not using SSL".to_string()
            } else {
                s
            }
        });

    query_log::log_outgoing_sql("SELECT CURRENT_USER()");
    let auth_method = sqlx::query("SELECT CURRENT_USER()")
        .fetch_one(&pool)
        .await
        .ok()
        .and_then(|row| {
            query_log::log_mysql_rows(std::slice::from_ref(&row));
            row.try_get::<String, _>(0).ok()
        });

    // Always close the temp pool
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

/// Open a saved connection: reads from SQLite, retrieves password from keychain,
/// creates pool, registers it under a new session id, and spawns a health monitor task.
#[cfg(not(coverage))]
pub async fn open_connection_impl(
    state: &AppState,
    profile_id: &str,
) -> Result<OpenConnectionResult, String> {
    // Read connection profile from SQLite
    let record = {
        let conn = lock_db(state)?;
        match connections::get_connection(&conn, profile_id) {
            Ok(Some(record)) => record,
            Ok(None) => return Err(format!("Connection '{profile_id}' not found")),
            Err(error) => return Err(error.to_string()),
        }
    };

    // Retrieve password from keychain — propagate errors instead of hiding them
    let password = if record.has_password {
        credentials::retrieve_password_for_connection(profile_id, record.keychain_ref.as_deref())
            .map_err(|e| format!("Failed to retrieve password from keychain: {e}"))?
    } else {
        String::new()
    };

    let keepalive_secs = record.keepalive_interval_secs.unwrap_or(60).max(0) as u64;
    let timeout_secs = record.connect_timeout_secs.unwrap_or(10).max(1) as u64;

    // Build stored params first (for registry entry), then derive ConnectionParams from them.
    let stored_params = StoredConnectionParams {
        profile_id: profile_id.to_string(),
        host: record.host,
        port: record.port as u16,
        username: record.username,
        has_password: record.has_password,
        keychain_ref: record.keychain_ref,
        default_database: record.default_database,
        ssl_enabled: record.ssl_enabled,
        ssl_ca_path: record.ssl_ca_path,
        ssl_cert_path: record.ssl_cert_path,
        ssl_key_path: record.ssl_key_path,
        connect_timeout_secs: timeout_secs,
        keepalive_interval_secs: keepalive_secs,
    };

    let params = stored_params.to_connection_params(password);

    // Create pool
    let pool = pool::create_pool(&params)
        .await
        .map_err(|e| format!("Failed to connect: {e}"))?;

    // Get server version
    let server_version = fetch_server_version(&pool).await;

    let session_id = Uuid::new_v4().to_string();

    // Spawn health monitor (requires AppHandle — only available in real Tauri runtime)
    // If keepalive_interval_secs is 0, health monitoring is disabled for this connection.
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

    let password = if record.has_password {
        credentials::retrieve_password_for_connection(profile_id, record.keychain_ref.as_deref())
            .map_err(|e| format!("Failed to retrieve password from keychain: {e}"))?
    } else {
        String::new()
    };

    let params = crate::mysql::registry::StoredConnectionParams {
        profile_id: profile_id.to_string(),
        host: record.host,
        port: record.port as u16,
        username: record.username,
        has_password: record.has_password,
        keychain_ref: record.keychain_ref,
        default_database: record.default_database,
        ssl_enabled: record.ssl_enabled,
        ssl_ca_path: record.ssl_ca_path,
        ssl_cert_path: record.ssl_cert_path,
        ssl_key_path: record.ssl_key_path,
        connect_timeout_secs: record.connect_timeout_secs.unwrap_or(10).max(1) as u64,
        keepalive_interval_secs: record.keepalive_interval_secs.unwrap_or(60).max(0) as u64,
    }
    .to_connection_params(password);

    let pool = create_pool(&params)
        .await
        .map_err(|e| format!("Failed to connect: {e}"))?;

    pool.close().await;

    let session_id = uuid::Uuid::new_v4().to_string();
    Ok(OpenConnectionResult {
        session_id,
        server_version: "Unknown".to_string(),
    })
}

#[cfg(coverage)]
pub async fn close_connection_impl(state: &AppState, connection_id: &str) -> Result<(), String> {
    if state.registry.contains(connection_id) {
        // Clean up any running_queries entries for this connection
        {
            let mut rq = state.running_queries.write().await;
            rq.retain(|(conn_id, _), _| conn_id != connection_id);
        }
        Ok(())
    } else {
        Err(format!("Connection '{connection_id}' is not open"))
    }
}

/// Close an open connection: removes pool from registry and drops it.
/// The registry's `remove()` cancels the health monitor's cancellation token.
#[cfg(not(coverage))]
pub async fn close_connection_impl(state: &AppState, connection_id: &str) -> Result<(), String> {
    let entry = state
        .registry
        .remove(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' is not open"))?;

    // Clean up any running_queries entries for this connection
    {
        let mut rq = state.running_queries.write().await;
        rq.retain(|(conn_id, _), _| conn_id != connection_id);
    }

    // Explicitly close the pool before dropping
    close_pool(entry.pool).await;
    Ok(())
}

/// Get the current status of a connection from the registry.
pub fn get_connection_status_impl(
    state: &AppState,
    connection_id: &str,
) -> Option<ConnectionStatus> {
    state.registry.get_status(connection_id)
}

// --- Thin Tauri command wrappers ---

#[cfg(not(coverage))]
#[tauri::command]
pub async fn test_connection(
    input: TestConnectionInput,
) -> Result<TestConnectionResult, String> {
    Ok(test_connection_impl(input).await)
}

/// Open IPC payload: `profileId` is the saved connection row id (SQLite).
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
