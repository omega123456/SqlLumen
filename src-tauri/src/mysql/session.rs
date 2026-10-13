//! Shared MySQL session for the query editor.
//!
//! Every query-editor window of a connection runs on the same `mysql_async`
//! connection, so session state (user variables, `USE`, temporary tables, open
//! transactions) carries over between runs and windows. A session runs one
//! statement at a time: concurrent runs queue on the slot mutex.

use std::sync::Arc;
use tokio::sync::{Mutex, OwnedMutexGuard};

use crate::state::AppState;

pub struct EditorSession {
    pub conn: mysql_async::Conn,
    /// MySQL thread ID of `conn`, used for `KILL QUERY` cancellation.
    pub thread_id: u64,
}

pub type SessionSlot = Arc<Mutex<Option<EditorSession>>>;
pub type SessionGuard = OwnedMutexGuard<Option<EditorSession>>;

#[cfg(not(coverage))]
fn slot(state: &AppState, connection_id: &str) -> SessionSlot {
    state
        .editor_sessions
        .lock()
        .expect("editor sessions lock poisoned")
        .entry(connection_id.to_string())
        .or_default()
        .clone()
}

fn existing_slot(state: &AppState, connection_id: &str) -> Option<SessionSlot> {
    state
        .editor_sessions
        .lock()
        .expect("editor sessions lock poisoned")
        .get(connection_id)
        .cloned()
}

/// Lock the connection's editor session, waiting while another window's query
/// runs. Connects on first use, and reconnects if the session died (in which
/// case its variables and open transaction are gone). The guard always holds
/// `Some` session on success.
#[cfg(not(coverage))]
pub async fn acquire(state: &AppState, connection_id: &str) -> Result<SessionGuard, String> {
    use mysql_async::prelude::Queryable;

    let mut guard = slot(state, connection_id).lock_owned().await;

    if let Some(session) = guard.as_mut() {
        if let Err(error) = session.conn.ping().await {
            tracing::warn!(
                connection_id,
                thread_id = session.thread_id,
                ?error,
                "editor session lost; session state discarded, reconnecting"
            );
            *guard = None;
        }
    }

    if guard.is_none() {
        let params = state
            .registry
            .get_connection_params(connection_id)
            .ok_or_else(|| format!("Connection '{connection_id}' not found in registry"))?;
        let mut conn = crate::mysql::multi_result::build_connection(&params).await?;

        let sql = "SELECT CONNECTION_ID()";
        crate::mysql::query_log::log_outgoing_sql(sql);
        let thread_id: u64 = conn
            .query_first::<u64, _>(sql)
            .await
            .map_err(|e| format!("Failed to get connection ID: {e}"))?
            .ok_or_else(|| "CONNECTION_ID() returned NULL".to_string())?;

        *guard = Some(EditorSession { conn, thread_id });
    }

    Ok(guard)
}

/// Switch an existing editor session to `database` so session state survives a
/// database change. No-op when the connection has no session yet (a new one
/// picks up the registry's default database).
#[cfg(not(coverage))]
pub async fn use_database(
    state: &AppState,
    connection_id: &str,
    database: &str,
) -> Result<(), String> {
    use mysql_async::prelude::Queryable;

    let Some(slot) = existing_slot(state, connection_id) else {
        return Ok(());
    };
    let mut guard = slot.lock().await;
    let Some(session) = guard.as_mut() else {
        return Ok(());
    };

    let sql = format!(
        "USE {}",
        crate::mysql::schema_queries::safe_identifier(database)?
    );
    crate::mysql::query_log::log_outgoing_sql(&sql);
    if let Err(error) = session.conn.query_drop(&sql).await {
        tracing::warn!(connection_id, database, ?error, "editor session USE failed");
        return Err(format!("Failed to switch session to '{database}': {error}"));
    }
    Ok(())
}

/// Coverage stub for `use_database`.
#[cfg(coverage)]
pub async fn use_database(
    state: &AppState,
    connection_id: &str,
    database: &str,
) -> Result<(), String> {
    crate::mysql::schema_queries::safe_identifier(database)?;
    let _ = existing_slot(state, connection_id);
    Ok(())
}

/// Drop the connection's editor session. An idle session is disconnected right
/// away; a busy one is dropped (and disconnected) when its running query ends.
pub async fn close(state: &AppState, connection_id: &str) {
    let removed = state
        .editor_sessions
        .lock()
        .expect("editor sessions lock poisoned")
        .remove(connection_id);
    let Some(slot) = removed else {
        return;
    };
    let Ok(mut guard) = slot.try_lock() else {
        return;
    };
    if let Some(session) = guard.take() {
        if let Err(error) = session.conn.disconnect().await {
            tracing::warn!(connection_id, ?error, "editor session disconnect failed");
        }
    }
}
