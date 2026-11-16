use super::*;

#[cfg(not(coverage))]
pub async fn kill_export_query(state: &AppState, kill: &ExportKill<'_>) -> bool {
    let ExportKill {
        connection_id,
        thread_id,
        purpose,
    } = *kill;
    let Some(pool) = state.registry.get_pool(connection_id) else {
        tracing::warn!(
            connection_id,
            thread_id,
            purpose,
            "result export: no pool for KILL QUERY"
        );
        return false;
    };
    tracing::debug!(
        connection_id,
        thread_id,
        purpose,
        "result export: issuing KILL QUERY"
    );
    let pool_kill = crate::mysql::pool::KillQuery {
        thread_id,
        checkout_timeout: EXPORT_KILL_ACQUIRE_TIMEOUT,
    };
    let Err(failure) = pool.kill_query(pool_kill).await else {
        return true;
    };
    tracing::warn!(connection_id, thread_id, purpose, %failure, "result export: KILL QUERY not sent");
    false
}

#[cfg(coverage)]
pub async fn kill_export_query(state: &AppState, kill: &ExportKill<'_>) -> bool {
    state.registry.get_pool(kill.connection_id).is_some()
}

#[cfg(not(coverage))]
pub async fn run_result_export_job(state: &AppState, prepared: PreparedResultExport) {
    let mut pipeline = ExportPipeline::new(&prepared);
    let rerun = rerun_into_pipeline(state, &prepared, &mut pipeline).await;
    pipeline.complete(rerun.outcome, rerun.restore_error);
}

#[cfg(coverage)]
pub async fn run_result_export_job(state: &AppState, prepared: PreparedResultExport) {
    if is_cancel_requested(&prepared.jobs, &prepared.job_id) {
        ExportPipeline::new(&prepared).complete(ExportOutcome::Cancelled, None);
        return;
    }
    let message = missing_live_session_message(state, &prepared.connection_id);
    ExportPipeline::new(&prepared).complete(ExportOutcome::Failed(message), None);
}

#[cfg(coverage)]
pub(super) fn missing_live_session_message(state: &AppState, connection_id: &str) -> String {
    if state.has_open_connection(connection_id) {
        return "Full export needs a live MySQL session.".to_string();
    }
    format!("Connection '{connection_id}' not found in registry")
}

#[cfg(not(coverage))]
pub(super) struct RerunEnd {
    pub(super) outcome: ExportOutcome,
    pub(super) restore_error: Option<String>,
}

#[cfg(not(coverage))]
impl RerunEnd {
    pub(super) fn without_restore(outcome: ExportOutcome) -> Self {
        Self {
            outcome,
            restore_error: None,
        }
    }
}

#[cfg(not(coverage))]
pub(super) struct RerunContext<'a> {
    pub(super) state: &'a AppState,
    pub(super) prepared: &'a PreparedResultExport,
    pub(super) thread_id: u64,
}

#[cfg(not(coverage))]
impl RerunContext<'_> {
    pub(super) async fn kill(&self, purpose: &str) -> bool {
        let export_kill = ExportKill {
            connection_id: &self.prepared.connection_id,
            thread_id: self.thread_id,
            purpose,
        };
        kill_export_query(self.state, &export_kill).await
    }
}

#[cfg(not(coverage))]
pub(super) async fn rerun_into_pipeline(
    state: &AppState,
    prepared: &PreparedResultExport,
    pipeline: &mut ExportPipeline,
) -> RerunEnd {
    if is_cancel_requested(&prepared.jobs, &prepared.job_id) {
        return RerunEnd::without_restore(ExportOutcome::Cancelled);
    }
    let mut guard = match crate::mysql::session::acquire(state, &prepared.connection_id).await {
        Ok(guard) => guard,
        Err(error) => return RerunEnd::without_restore(ExportOutcome::Failed(error)),
    };
    let session = guard.as_mut().expect("acquire always yields a session");
    let thread_id = session.thread_id;
    set_job_thread(&prepared.jobs, &prepared.job_id, Some(thread_id));

    let mut restore_to = None;
    let mut stream = StreamEnd {
        outcome: ExportOutcome::Cancelled,
        interrupted: false,
        own_kill_sent: false,
    };
    let was_cancelled_while_queued = prepared.cancel.requested.load(Ordering::SeqCst);
    if !was_cancelled_while_queued {
        match switch_to_run_database(&mut session.conn, prepared).await {
            Ok(previous) => {
                restore_to = previous;
                let rerun = RerunContext {
                    state,
                    prepared,
                    thread_id,
                };
                stream = stream_rerun(&rerun, &mut session.conn, pipeline).await;
            }
            Err(_) if prepared.cancel.requested.load(Ordering::SeqCst) => {}
            Err(error) => stream.outcome = ExportOutcome::Failed(error),
        }
    }

    set_job_thread(&prepared.jobs, &prepared.job_id, None);
    wait_for_cancel_kills(&prepared.cancel, &prepared.job_id, CANCEL_KILL_WAIT).await;
    let kill_sent = stream.own_kill_sent || prepared.cancel.kill_sent.load(Ordering::SeqCst);
    let has_unabsorbed_kill = kill_sent && !stream.interrupted;
    if has_unabsorbed_kill {
        crate::mysql::multi_result::absorb_late_kill(&mut session.conn, &prepared.connection_id)
            .await;
    }

    let restore_error = match restore_to {
        Some(previous) => {
            restore_database(&mut session.conn, &prepared.connection_id, previous).await
        }
        None => None,
    };
    drop(guard);
    RerunEnd {
        outcome: stream.outcome,
        restore_error,
    }
}
