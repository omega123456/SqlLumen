//! Connection health monitoring with auto-reconnection and exponential backoff.
//!
//! After a connection is opened, a background tokio task is spawned that
//! periodically pings the MySQL server. If a ping fails, the monitor sets
//! the connection status to `Disconnected`, then enters a reconnection loop
//! with a backoff schedule of 5 s → 15 s → 30 s (capped).

#[cfg(not(coverage))]
use crate::credentials;
#[cfg(not(coverage))]
use crate::mysql::pool;
#[cfg(not(coverage))]
use crate::mysql::query_log;
#[cfg(not(coverage))]
use crate::mysql::registry::ConnectionStatus;
#[cfg(not(coverage))]
use crate::state::AppState;
use std::time::Duration;
use tauri::{AppHandle, Runtime};
#[cfg(not(coverage))]
use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;

/// Event payload emitted via `app_handle.emit()` when connection status changes.
#[derive(serde::Serialize, Clone)]
pub struct ConnectionStatusChangedPayload {
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    pub status: String,
    pub message: Option<String>,
}

/// Backoff schedule for reconnection attempts.
/// Returns the delay before the next reconnection attempt based on the attempt number (0-indexed).
pub fn backoff_duration(attempt: u32) -> Duration {
    match attempt {
        0 => Duration::from_secs(5),
        1 => Duration::from_secs(15),
        _ => Duration::from_secs(30),
    }
}

/// Spawn a background health-check task for the given connection.
///
/// The task periodically pings the MySQL server at the configured keepalive
/// interval. If a ping fails, it enters a reconnection loop with exponential
/// backoff (5 s → 15 s → 30 s cap).
///
/// Returns a `CancellationToken` that can be used to stop the task (e.g., when
/// the connection is closed).
#[cfg(not(coverage))]
pub fn spawn_health_monitor<R: Runtime>(
    connection_id: String,
    keepalive_secs: u64,
    app_handle: AppHandle<R>,
) -> CancellationToken {
    let token = CancellationToken::new();
    let task_token = token.clone();

    tokio::spawn(async move {
        health_loop(&connection_id, keepalive_secs, &app_handle, &task_token).await;
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

/// The main health check loop. Separated from `spawn_health_monitor` for clarity.
#[cfg(not(coverage))]
async fn health_loop<R: Runtime>(
    connection_id: &str,
    keepalive_secs: u64,
    app_handle: &AppHandle<R>,
    token: &CancellationToken,
) {
    // keepalive_secs is guaranteed > 0 here — the caller skips spawning when it's 0.
    let interval = Duration::from_secs(keepalive_secs);

    loop {
        // Sleep for the keepalive interval, but exit early if cancelled.
        tokio::select! {
            _ = tokio::time::sleep(interval) => {}
            _ = token.cancelled() => { return; }
        }

        if token.is_cancelled() {
            return;
        }

        // Get pool from registry
        let pool = {
            let state = app_handle.state::<AppState>();
            state.registry.get_pool(connection_id)
        };

        let pool = match pool {
            Some(p) => p,
            None => {
                // Connection was removed from registry (closed). Stop monitoring.
                return;
            }
        };

        // Attempt to ping the server
        query_log::log_outgoing_sql("SELECT 1");
        let ping_result = sqlx::query("SELECT 1").execute(&pool).await;
        if let Ok(ref r) = ping_result {
            query_log::log_execute_result(r);
        }

        if ping_result.is_ok() {
            // Ping succeeded — connection is healthy. Continue.
            continue;
        }

        // Ping failed — enter reconnection sequence.
        let ping_err = ping_result.unwrap_err().to_string();

        // Set status to Disconnected
        update_and_emit(
            app_handle,
            connection_id,
            ConnectionStatus::Disconnected,
            Some(&ping_err),
        );

        // Enter reconnection loop
        let reconnected = reconnect_loop(connection_id, app_handle, token).await;

        if !reconnected {
            // Cancelled during reconnection — exit the health loop
            return;
        }

        // Reconnection succeeded — loop continues with normal health checks
    }
}

/// Reconnection loop with exponential backoff: 5 s → 15 s → 30 s (cap).
/// Returns `true` if reconnection succeeded, `false` if cancelled.
#[cfg(not(coverage))]
async fn reconnect_loop(
    connection_id: &str,
    app_handle: &AppHandle<impl Runtime>,
    token: &CancellationToken,
) -> bool {
    reconnect_loop_impl(connection_id, app_handle, token).await
}

#[cfg(not(coverage))]
async fn reconnect_loop_impl<R: Runtime>(
    connection_id: &str,
    app_handle: &AppHandle<R>,
    token: &CancellationToken,
) -> bool {
    let mut attempt: u32 = 0;

    loop {
        if token.is_cancelled() {
            return false;
        }

        // Set status to Reconnecting
        let delay = backoff_duration(attempt);
        update_and_emit(
            app_handle,
            connection_id,
            ConnectionStatus::Reconnecting,
            Some(&format!(
                "Reconnecting in {}s (attempt {})...",
                delay.as_secs(),
                attempt + 1
            )),
        );

        // Wait for backoff duration, exit early if cancelled
        tokio::select! {
            _ = tokio::time::sleep(delay) => {}
            _ = token.cancelled() => { return false; }
        }

        if token.is_cancelled() {
            return false;
        }

        // Get stored connection params for reconnection
        let params = {
            let state = app_handle.state::<AppState>();
            state.registry.get_connection_params(connection_id)
        };

        let stored_params = match params {
            Some(p) => p,
            None => {
                // Connection removed from registry while reconnecting
                return false;
            }
        };

        // Build ConnectionParams from stored params, re-reading password from keychain
        let password = if stored_params.has_password {
            match credentials::retrieve_password_for_connection(
                stored_params.profile_id.as_str(),
                stored_params.keychain_ref.as_deref(),
            ) {
                Ok(p) => p,
                Err(e) => {
                    // Keychain retrieval failed — emit disconnected and stop retrying
                    update_and_emit(
                        app_handle,
                        connection_id,
                        ConnectionStatus::Disconnected,
                        Some(&format!("Cannot retrieve password from keychain: {e}")),
                    );
                    return false;
                }
            }
        } else {
            String::new()
        };

        let conn_params = stored_params.to_connection_params(password);

        // Try to create a new pool
        match pool::create_pool(&conn_params).await {
            Ok(new_pool) => {
                // Replace pool in registry, set status to Connected
                {
                    let state = app_handle.state::<AppState>();
                    state.registry.replace_pool(connection_id, new_pool);
                }
                update_and_emit(app_handle, connection_id, ConnectionStatus::Connected, None);
                return true;
            }
            Err(e) => {
                // Reconnection failed — emit event and continue loop
                emit_status(
                    app_handle,
                    connection_id,
                    "reconnecting",
                    Some(&format!("Reconnection failed: {e}")),
                );

                attempt = attempt.saturating_add(1);
                // Continue to next iteration with increased backoff
            }
        }
    }
}

/// Emit a `connection-status-changed` Tauri event.
#[cfg(not(coverage))]
fn emit_status<R: Runtime>(
    app_handle: &AppHandle<R>,
    connection_id: &str,
    status: &str,
    message: Option<&str>,
) {
    let payload = ConnectionStatusChangedPayload {
        connection_id: connection_id.to_string(),
        status: status.to_string(),
        message: message.map(|s| s.to_string()),
    };

    // Fire-and-forget — don't block the health loop on event delivery failures.
    let _ = app_handle.emit("connection-status-changed", payload);
}

/// Update the registry status and emit a Tauri event in one step.
///
/// Centralizes the recurring pattern of `update_status` + `emit_status` to
/// avoid the two calls drifting apart or being done in inconsistent order.
#[cfg(not(coverage))]
fn update_and_emit(
    app_handle: &AppHandle<impl Runtime>,
    connection_id: &str,
    status: ConnectionStatus,
    message: Option<&str>,
) {
    update_and_emit_impl(app_handle, connection_id, status, message);
}

#[cfg(not(coverage))]
fn update_and_emit_impl<R: Runtime>(
    app_handle: &AppHandle<R>,
    connection_id: &str,
    status: ConnectionStatus,
    message: Option<&str>,
) {
    let status_str = match &status {
        ConnectionStatus::Connected => "connected",
        ConnectionStatus::Disconnected => "disconnected",
        ConnectionStatus::Reconnecting => "reconnecting",
    };
    {
        let state = app_handle.state::<AppState>();
        state.registry.update_status(connection_id, status);
    }
    emit_status(app_handle, connection_id, status_str, message);
}
