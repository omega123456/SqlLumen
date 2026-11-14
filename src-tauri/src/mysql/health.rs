#[cfg(any(not(coverage), test, feature = "test-utils"))]
use crate::credentials;
#[cfg(any(not(coverage), test, feature = "test-utils"))]
use crate::mysql::pool;
#[cfg(not(coverage))]
use crate::mysql::query_log;
#[cfg(any(not(coverage), test, feature = "test-utils"))]
use crate::mysql::registry::ConnectionStatus;
#[cfg(any(not(coverage), test, feature = "test-utils"))]
use crate::state::AppState;
use std::time::Duration;
use tauri::{AppHandle, Runtime};
#[cfg(not(coverage))]
use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;

#[derive(serde::Serialize, Clone)]
pub struct ConnectionStatusChangedPayload {
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    pub status: String,
    pub message: Option<String>,
}

pub fn backoff_duration(attempt: u32) -> Duration {
    match attempt {
        0 => Duration::from_secs(5),
        1 => Duration::from_secs(15),
        _ => Duration::from_secs(30),
    }
}

#[cfg(not(coverage))]
pub fn spawn_health_monitor<R: Runtime>(
    connection_id: String,
    keepalive_secs: u64,
    app_handle: AppHandle<R>,
) -> CancellationToken {
    let token = CancellationToken::new();
    let task_token = token.clone();

    tokio::spawn(async move {
        let monitor = HealthMonitor {
            connection_id: &connection_id,
            app_handle: &app_handle,
        };
        health_loop(&monitor, keepalive_secs, &task_token).await;
    });

    token
}

#[cfg(coverage)]
pub fn spawn_health_monitor<R: Runtime>(
    connection_id: String,
    keepalive_secs: u64,
    app_handle: AppHandle<R>,
) -> CancellationToken {
    let _ = (connection_id, keepalive_secs, app_handle);
    CancellationToken::new()
}

#[cfg(not(coverage))]
struct HealthMonitor<'a, R: Runtime> {
    connection_id: &'a str,
    app_handle: &'a AppHandle<R>,
}

#[cfg(not(coverage))]
impl<R: Runtime> HealthMonitor<'_, R> {
    fn emit_status(&self, status: &str, message: Option<&str>) {
        let payload = ConnectionStatusChangedPayload {
            connection_id: self.connection_id.to_string(),
            status: status.to_string(),
            message: message.map(|text| text.to_string()),
        };

        let _ = self.app_handle.emit("connection-status-changed", payload);
    }

    fn update_and_emit(&self, status: ConnectionStatus, message: Option<&str>) {
        let status_str = match &status {
            ConnectionStatus::Connected => "connected",
            ConnectionStatus::Disconnected => "disconnected",
            ConnectionStatus::Reconnecting => "reconnecting",
        };
        {
            let state = self.app_handle.state::<AppState>();
            state.registry.update_status(self.connection_id, status);
        }
        self.emit_status(status_str, message);
    }
}

#[cfg(not(coverage))]
async fn health_loop<R: Runtime>(
    monitor: &HealthMonitor<'_, R>,
    keepalive_secs: u64,
    token: &CancellationToken,
) {
    let connection_id = monitor.connection_id;
    let app_handle = monitor.app_handle;
    let interval = Duration::from_secs(keepalive_secs);

    loop {
        tokio::select! {
            _ = tokio::time::sleep(interval) => {}
            _ = token.cancelled() => { return; }
        }

        if token.is_cancelled() {
            return;
        }

        let pool = {
            let state = app_handle.state::<AppState>();
            state.registry.get_pool(connection_id)
        };

        let pool = match pool {
            Some(active_pool) => active_pool,
            None => {
                return;
            }
        };

        query_log::log_outgoing_sql("SELECT 1");
        let ping_result = sqlx::query("SELECT 1").execute(&pool).await;
        if let Ok(ref result) = ping_result {
            query_log::log_execute_result(result);
        }

        if ping_result.is_ok() {
            continue;
        }

        let ping_error = ping_result.unwrap_err().to_string();

        monitor.update_and_emit(ConnectionStatus::Disconnected, Some(&ping_error));

        let reconnected = reconnect_loop(monitor, token).await;

        if !reconnected {
            return;
        }
    }
}

#[cfg(not(coverage))]
enum ReconnectAttempt {
    Connected,
    Retry,
    Stop,
}

#[cfg(not(coverage))]
async fn reconnect_loop<R: Runtime>(
    monitor: &HealthMonitor<'_, R>,
    token: &CancellationToken,
) -> bool {
    let mut attempt: u32 = 0;
    loop {
        match reconnect_attempt(monitor, token, attempt).await {
            ReconnectAttempt::Connected => return true,
            ReconnectAttempt::Stop => return false,
            ReconnectAttempt::Retry => attempt = attempt.saturating_add(1),
        }
    }
}

#[cfg(not(coverage))]
async fn wait_for_backoff(delay: std::time::Duration, token: &CancellationToken) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(delay) => !token.is_cancelled(),
        _ = token.cancelled() => false,
    }
}

#[cfg(not(coverage))]
async fn reconnect_attempt<R: Runtime>(
    monitor: &HealthMonitor<'_, R>,
    token: &CancellationToken,
    attempt: u32,
) -> ReconnectAttempt {
    if token.is_cancelled() {
        return ReconnectAttempt::Stop;
    }
    let delay = backoff_duration(attempt);
    let status_message = format!(
        "Reconnecting in {}s (attempt {})...",
        delay.as_secs(),
        attempt + 1
    );
    monitor.update_and_emit(ConnectionStatus::Reconnecting, Some(&status_message));
    if !wait_for_backoff(delay, token).await {
        return ReconnectAttempt::Stop;
    }

    let connection_id = monitor.connection_id;
    let stored_params = monitor
        .app_handle
        .state::<AppState>()
        .registry
        .get_connection_params(connection_id);
    let Some(stored_params) = stored_params else {
        return ReconnectAttempt::Stop;
    };

    let password = match credentials::resolve_password(
        stored_params.profile_id.as_str(),
        stored_params.has_password,
    ) {
        Ok(password) => password,
        Err(error) => {
            monitor.update_and_emit(ConnectionStatus::Disconnected, Some(&error));
            return ReconnectAttempt::Stop;
        }
    };

    let conn_params = stored_params.to_connection_params(password);
    match pool::create_pool(&conn_params).await {
        Ok(new_pool) => {
            let state = monitor.app_handle.state::<AppState>();
            state.registry.replace_pool(connection_id, new_pool);
            monitor.update_and_emit(ConnectionStatus::Connected, None);
            ReconnectAttempt::Connected
        }
        Err(error) => {
            let failure = format!("Reconnection failed: {error}");
            monitor.emit_status("reconnecting", Some(&failure));
            ReconnectAttempt::Retry
        }
    }
}

#[cfg(any(test, feature = "test-utils"))]
pub async fn attempt_reconnect_once_for_test(
    state: &AppState,
    connection_id: &str,
) -> Result<(), String> {
    let stored_params = state
        .registry
        .get_connection_params(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' is not open"))?;

    let password = credentials::resolve_password(
        stored_params.profile_id.as_str(),
        stored_params.has_password,
    )?;

    let conn_params = stored_params.to_connection_params(password);
    let new_pool = pool::create_pool(&conn_params)
        .await
        .map_err(|error| format!("Failed to reconnect: {error}"))?;

    state.registry.replace_pool(connection_id, new_pool);
    state
        .registry
        .update_status(connection_id, ConnectionStatus::Connected);

    Ok(())
}
