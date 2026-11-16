use super::*;

pub(super) struct StreamEnd {
    pub(super) outcome: ExportOutcome,
    pub(super) interrupted: bool,
    pub(super) own_kill_sent: bool,
}

pub(super) fn is_interrupted_by_own_kill(
    error: &mysql_async::Error,
    stopping: bool,
    cancel_requested: impl Fn() -> bool,
) -> bool {
    crate::mysql::multi_result::is_query_interrupted(error) && (stopping || cancel_requested())
}

pub(super) const WRITE_FAILURE_KILL_PURPOSE: &str = "write failure";
pub(super) const SHEET_LIMIT_KILL_PURPOSE: &str = "sheet limit";

pub(super) fn rerun_start_failure(error: &mysql_async::Error, cancel_requested: bool) -> StreamEnd {
    use crate::mysql::multi_result::{is_query_interrupted, map_mysql_error};

    let interrupted = is_query_interrupted(error);
    let is_cancelled_by_user = interrupted && cancel_requested;
    if is_cancelled_by_user {
        return StreamEnd {
            outcome: ExportOutcome::Cancelled,
            interrupted,
            own_kill_sent: false,
        };
    }
    StreamEnd {
        outcome: ExportOutcome::Failed(map_mysql_error(error)),
        interrupted,
        own_kill_sent: false,
    }
}

pub(super) struct RerunStream<'a, 'b> {
    pub(super) rerun: &'a RerunContext<'b>,
    pub(super) pipeline: &'a mut ExportPipeline,
    pub(super) failure: Option<String>,
    pub(super) stopping: bool,
    pub(super) interrupted: bool,
    pub(super) own_kill_sent: bool,
}

impl RerunStream<'_, '_> {
    pub(super) fn cancel_requested(&self) -> bool {
        self.rerun.prepared.cancel.requested.load(Ordering::Relaxed)
    }

    pub(super) async fn stop_with_kill(&mut self, purpose: &str) {
        self.stopping = true;
        self.own_kill_sent |= self.rerun.kill(purpose).await;
    }

    pub(super) async fn fail_writing(&mut self, error: String) {
        self.failure = Some(error);
        self.stop_with_kill(WRITE_FAILURE_KILL_PURPOSE).await;
    }

    pub(super) async fn accept_row(&mut self, row: mysql_async::Row) {
        if self.stopping {
            return;
        }
        if self.cancel_requested() {
            self.stopping = true;
            return;
        }
        let values = crate::mysql::multi_result::serialize_row(row);
        match self.pipeline.accept_row(&values) {
            Ok(RowWrite::Written) => {}
            Ok(RowWrite::SheetLimitReached) => self.stop_with_kill(SHEET_LIMIT_KILL_PURPOSE).await,
            Err(error) => self.fail_writing(error).await,
        }
    }

    pub(super) fn record_stream_error(&mut self, error: &mysql_async::Error) {
        use crate::mysql::multi_result::{is_query_interrupted, map_mysql_error};

        let cancel_requested = || self.cancel_requested();
        if is_interrupted_by_own_kill(error, self.stopping, cancel_requested) {
            self.interrupted = true;
            return;
        }
        self.interrupted = is_query_interrupted(error);
        if self.failure.is_none() {
            self.failure = Some(map_mysql_error(error));
        }
    }

    pub(super) fn end(self) -> StreamEnd {
        let cancel_requested = self.cancel_requested();
        let outcome = match self.failure {
            Some(message) => ExportOutcome::Failed(message),
            None if cancel_requested => ExportOutcome::Cancelled,
            None => ExportOutcome::Completed,
        };
        StreamEnd {
            outcome,
            interrupted: self.interrupted,
            own_kill_sent: self.own_kill_sent,
        }
    }
}

pub(super) async fn stream_rerun(
    rerun: &RerunContext<'_>,
    conn: &mut mysql_async::Conn,
    pipeline: &mut ExportPipeline,
) -> StreamEnd {
    let prepared = rerun.prepared;
    let cancel_requested = || prepared.cancel.requested.load(Ordering::Relaxed);
    let mut rows = match crate::mysql::logged_query::stream_text(conn, &prepared.source_sql).await {
        Ok(rows) => rows,
        Err(error) => return rerun_start_failure(&error, cancel_requested()),
    };

    let columns: Vec<String> = rows
        .columns()
        .iter()
        .map(|column| column.name_str().to_string())
        .collect();
    let mut stream = RerunStream {
        rerun,
        pipeline,
        failure: None,
        stopping: false,
        interrupted: false,
        own_kill_sent: false,
    };
    if let Err(error) = stream.pipeline.open(&columns) {
        stream.fail_writing(error).await;
    }

    loop {
        match rows.next_row().await {
            Ok(Some(row)) => stream.accept_row(row).await,
            Ok(None) => break,
            Err(error) => {
                stream.record_stream_error(&error);
                break;
            }
        }
    }
    rows.finish();
    stream.end()
}
