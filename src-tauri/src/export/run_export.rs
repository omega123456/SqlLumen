use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::mysql::multi_result::BatchResults;
use crate::mysql::query_executor::StoredResult;
use crate::mysql::session::TabRun;
use crate::state::AppState;
use crate::timestamps::log_timestamp_now;

mod csv_files;
mod markdown;
mod registry;
mod run_folder;
mod sweep;

pub use csv_files::{ResultFileKey, ResultFileRecord, RunFiles, WriteFailure};
pub use markdown::{final_document, running_document, FinalReport};
pub use registry::{
    ConnectionSummary, RunDescription, RunRegistry, RunSession, RunSessionParts, RunSnapshot,
};
pub use run_folder::runs_directory;
pub use sweep::{sweep_run_folders, RUN_FOLDER_RETENTION_DAYS};

pub const RUN_FILE_NAME: &str = "run.md";
pub const RUN_NOT_STARTED_MESSAGE: &str = "This run is no longer available. Run again.";
pub const RUN_INTERRUPTED_MESSAGE: &str = "The run stopped before it finished.";
const RUN_FILE_TEMP_EXTENSION: &str = "md.tmp";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunExportRequest {
    pub connection_id: String,
    pub tab_id: String,
    pub connection_name: String,
    pub tab_title: String,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunExportStart {
    pub run_id: String,
    pub run_file_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunExportOptions {
    pub run_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RunPhase {
    Queued,
    Running,
    Writing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunExportProgress {
    pub run_file_path: String,
    pub phase: RunPhase,
    pub statement_number: usize,
    pub statement_count: usize,
    pub rows_written: usize,
    pub bytes_written: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RunOutcome {
    Complete,
    Cancelled {
        statement_number: usize,
    },
    Stopped {
        statement_number: usize,
    },
    WriteFailed {
        statement_number: usize,
        file_name: String,
    },
    Failed {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunExportSummary {
    pub run_file_path: String,
    pub statement_count: usize,
    pub outcome: RunOutcome,
}

pub struct RunFinish<'a> {
    pub results: &'a [StoredResult],
    pub batch_error: Option<&'a str>,
}

impl<'a> RunFinish<'a> {
    pub fn from_batch(batch: &'a Result<BatchResults, String>) -> Self {
        match batch {
            Ok(batch_results) => Self {
                results: &batch_results.stored_results,
                batch_error: None,
            },
            Err(message) => Self {
                results: &[],
                batch_error: Some(message.as_str()),
            },
        }
    }
}

pub struct RunClaim<'a> {
    registry: &'a RunRegistry,
    session: Arc<RunSession>,
    is_finished: bool,
}

impl RunClaim<'_> {
    pub fn session(&self) -> &RunSession {
        &self.session
    }

    pub fn finish(mut self, finish: &RunFinish<'_>) -> RunExportSummary {
        self.is_finished = true;
        self.registry.remove(&self.session.run_id);
        finish_run(&self.session, finish)
    }
}

impl Drop for RunClaim<'_> {
    fn drop(&mut self) {
        if self.is_finished {
            return;
        }
        self.registry.remove(&self.session.run_id);
        let interrupted = RunFinish {
            results: &[],
            batch_error: Some(RUN_INTERRUPTED_MESSAGE),
        };
        finish_run(&self.session, &interrupted);
    }
}

pub fn start_run_export_impl(
    state: &AppState,
    request: &StartRunExportRequest,
    root: &Path,
) -> Result<RunExportStart, String> {
    let folder = run_folder::create_run_folder(root)?;
    let session = RunSession::new(RunSessionParts {
        run_id: uuid::Uuid::new_v4().to_string(),
        tab: TabRun::new(&request.connection_id, &request.tab_id),
        folder: folder.clone(),
        description: RunDescription {
            tab_title: request.tab_title.clone(),
            connection: connection_summary(state, request),
            statements: request.statements.clone(),
            row_ceiling: state.result_cache.row_ceiling(),
            started_at: log_timestamp_now(),
        },
    });
    write_run_file(&session.run_file, &running_document(&session.description))
        .inspect_err(|_| run_folder::remove_run_folder(&folder))?;
    let start = RunExportStart {
        run_id: session.run_id.clone(),
        run_file_path: session.run_file.display().to_string(),
    };
    state.editor_sessions.runs.register(Arc::new(session));
    Ok(start)
}

pub fn get_run_export_progress_impl(state: &AppState, run_id: &str) -> Option<RunExportProgress> {
    state
        .editor_sessions
        .runs
        .get(run_id)
        .map(|session| session.progress())
}

pub fn claim_run<'a>(
    state: &'a AppState,
    options: Option<&RunExportOptions>,
) -> Result<Option<RunClaim<'a>>, String> {
    let Some(options) = options else {
        return Ok(None);
    };
    let registry = &state.editor_sessions.runs;
    let session = registry
        .get(&options.run_id)
        .ok_or_else(|| RUN_NOT_STARTED_MESSAGE.to_string())?;
    let is_finished = false;
    Ok(Some(RunClaim {
        registry,
        session,
        is_finished,
    }))
}

pub fn finish_run(session: &RunSession, finish: &RunFinish<'_>) -> RunExportSummary {
    let snapshot = session.close_and_snapshot();
    let outcome = run_outcome(&snapshot, finish);
    let report = FinalReport {
        description: &session.description,
        results: finish.results,
        records: &snapshot.records,
        outcome: &outcome,
    };
    let written = write_run_file(&session.run_file, &final_document(&report));
    let final_outcome = written.map_or_else(|message| RunOutcome::Failed { message }, |()| outcome);
    RunExportSummary {
        run_file_path: session.run_file.display().to_string(),
        statement_count: session.description.statements.len(),
        outcome: final_outcome,
    }
}

pub fn run_outcome(snapshot: &RunSnapshot, finish: &RunFinish<'_>) -> RunOutcome {
    if let Some(message) = finish.batch_error {
        return interrupted_outcome(snapshot, message);
    }
    if let Some(failure) = &snapshot.write_failure {
        return RunOutcome::WriteFailed {
            statement_number: failure.key.statement_index + 1,
            file_name: failure.key.file_name(),
        };
    }
    let failed_statement_number = finish
        .results
        .iter()
        .find(|stored| stored.error_message.is_some())
        .map(|failed| failed.statement_index + 1);
    let Some(statement_number) = failed_statement_number else {
        return RunOutcome::Complete;
    };
    if snapshot.is_cancel_requested {
        return RunOutcome::Cancelled { statement_number };
    }
    RunOutcome::Stopped { statement_number }
}

fn interrupted_outcome(snapshot: &RunSnapshot, message: &str) -> RunOutcome {
    if snapshot.is_cancel_requested {
        return RunOutcome::Cancelled {
            statement_number: snapshot.statement_index + 1,
        };
    }
    RunOutcome::Failed {
        message: message.to_string(),
    }
}

fn write_run_file(path: &Path, document: &str) -> Result<(), String> {
    let temp_path = path.with_extension(RUN_FILE_TEMP_EXTENSION);
    std::fs::write(&temp_path, document)
        .and_then(|()| std::fs::rename(&temp_path, path))
        .map_err(|error| format!("Couldn't write the run file: {error}"))
}

fn connection_summary(state: &AppState, request: &StartRunExportRequest) -> ConnectionSummary {
    let connection_id = request.connection_id.as_str();
    let Some(params) = state.registry.get_connection_params(connection_id) else {
        return ConnectionSummary {
            description: request.connection_name.clone(),
            database: None,
        };
    };
    let server_version = state
        .registry
        .server_version(connection_id)
        .unwrap_or_default();
    ConnectionSummary {
        description: format!(
            "{}, server {server_version} at {}:{}",
            request.connection_name, params.host, params.port
        ),
        database: params.default_database,
    }
}
