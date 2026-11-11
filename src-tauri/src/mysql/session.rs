//! Shared MySQL session for the query editor.
//!
//! Every query-editor window of a connection runs on the same `mysql_async`
//! connection, so session state (user variables, `USE`, temporary tables, open
//! transactions) carries over between runs and windows. A session runs one
//! statement at a time: concurrent runs queue on the slot mutex.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, OwnedMutexGuard};
use tokio_util::sync::CancellationToken;

use crate::state::AppState;

pub const QUEUED_RUN_CANCELLED_MESSAGE: &str =
    "Query cancelled while waiting for the editor session";

pub struct EditorSession {
    pub conn: mysql_async::Conn,
    /// MySQL thread ID of `conn`, used for `KILL QUERY` cancellation.
    pub thread_id: u64,
}

pub type SessionSlot = Arc<Mutex<Option<EditorSession>>>;
pub type SessionGuard = OwnedMutexGuard<Option<EditorSession>>;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TabRun {
    pub connection_id: String,
    pub tab_id: String,
}

impl TabRun {
    pub fn new(connection_id: &str, tab_id: &str) -> Self {
        Self {
            connection_id: connection_id.to_string(),
            tab_id: tab_id.to_string(),
        }
    }

    pub fn running_query_key(&self) -> (String, String) {
        (self.connection_id.clone(), self.tab_id.clone())
    }
}

#[derive(Default)]
pub struct EditorSessions {
    slots: std::sync::Mutex<HashMap<String, SessionSlot>>,
    queued_runs: std::sync::Mutex<HashMap<TabRun, CancellationToken>>,
}

impl EditorSessions {
    pub fn has_session(&self, connection_id: &str) -> bool {
        self.lock_slots().contains_key(connection_id)
    }

    pub fn is_empty(&self) -> bool {
        self.lock_slots().is_empty()
    }

    pub fn cancel_queued_run(&self, run: &TabRun) -> bool {
        let Some(cancellation) = self.lock_queued_runs().remove(run) else {
            return false;
        };
        cancellation.cancel();
        true
    }

    fn lock_slots(&self) -> std::sync::MutexGuard<'_, HashMap<String, SessionSlot>> {
        self.slots.lock().expect("editor sessions lock poisoned")
    }

    fn lock_queued_runs(&self) -> std::sync::MutexGuard<'_, HashMap<TabRun, CancellationToken>> {
        self.queued_runs
            .lock()
            .expect("queued editor runs lock poisoned")
    }

    #[cfg(not(coverage))]
    fn join_queue(&self, run: &TabRun) -> CancellationToken {
        let cancellation = CancellationToken::new();
        self.lock_queued_runs()
            .insert(run.clone(), cancellation.clone());
        cancellation
    }

    #[cfg(not(coverage))]
    fn leave_queue(&self, run: &TabRun) {
        self.lock_queued_runs().remove(run);
    }
}

#[cfg(not(coverage))]
fn slot(state: &AppState, connection_id: &str) -> SessionSlot {
    state
        .editor_sessions
        .lock_slots()
        .entry(connection_id.to_string())
        .or_default()
        .clone()
}

fn existing_slot(state: &AppState, connection_id: &str) -> Option<SessionSlot> {
    state
        .editor_sessions
        .lock_slots()
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

#[cfg(not(coverage))]
pub async fn acquire_for_run(state: &AppState, run: &TabRun) -> Result<SessionGuard, String> {
    let cancellation = state.editor_sessions.join_queue(run);

    let acquired = acquire_unless_cancelled(state, &run.connection_id, &cancellation).await;
    if acquired.is_err() {
        state.editor_sessions.leave_queue(run);
    }
    let guard = acquired?;

    let thread_id = guard
        .as_ref()
        .expect("acquire always yields a session")
        .thread_id;
    state
        .running_queries
        .write()
        .await
        .insert(run.running_query_key(), thread_id);
    state.editor_sessions.leave_queue(run);

    if cancellation.is_cancelled() {
        state
            .running_queries
            .write()
            .await
            .remove(&run.running_query_key());
        return Err(QUEUED_RUN_CANCELLED_MESSAGE.to_string());
    }
    Ok(guard)
}

#[cfg(not(coverage))]
async fn acquire_unless_cancelled(
    state: &AppState,
    connection_id: &str,
    cancellation: &CancellationToken,
) -> Result<SessionGuard, String> {
    tokio::select! {
        acquired = acquire(state, connection_id) => acquired,
        _ = cancellation.cancelled() => Err(QUEUED_RUN_CANCELLED_MESSAGE.to_string()),
    }
}

/// Switch an existing editor session to `database` so session state survives a
/// database change. No-op when the connection has no session yet (a new one
/// picks up the registry's default database). A session that turns out to be
/// dead is discarded instead, so the next `acquire` reconnects on the registry's
/// default database; only server errors (e.g. access denied) are returned.
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
        crate::mysql::query_log::log_mysql_async_error(&error);
        if error.is_fatal() {
            tracing::warn!(
                connection_id,
                thread_id = session.thread_id,
                database,
                ?error,
                "editor session lost on database switch; session state discarded"
            );
            *guard = None;
            return Ok(());
        }
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
    let removed = state.editor_sessions.lock_slots().remove(connection_id);
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
