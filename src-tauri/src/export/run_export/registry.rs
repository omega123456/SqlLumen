use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use serde_json::Value;

use super::csv_files::{ResultFileKey, ResultFileRecord, RunFiles, WriteFailure};
use super::{RunExportProgress, RunPhase};
use crate::mysql::query_executor::ColumnMeta;
use crate::mysql::session::TabRun;

pub struct ConnectionSummary {
    pub description: String,
    pub database: Option<String>,
}

pub struct RunDescription {
    pub tab_title: String,
    pub connection: ConnectionSummary,
    pub statements: Vec<String>,
    pub row_ceiling: usize,
    pub started_at: String,
}

pub struct RunSessionParts {
    pub run_id: String,
    pub tab: TabRun,
    pub folder: PathBuf,
    pub description: RunDescription,
}

struct RunState {
    phase: RunPhase,
    statement_index: usize,
    is_cancel_requested: bool,
    files: RunFiles,
}

pub struct RunSession {
    pub run_id: String,
    pub tab: TabRun,
    pub run_file: PathBuf,
    pub description: RunDescription,
    state: Mutex<RunState>,
}

pub struct RunSnapshot {
    pub statement_index: usize,
    pub is_cancel_requested: bool,
    pub records: Vec<ResultFileRecord>,
    pub write_failure: Option<WriteFailure>,
}

impl RunSession {
    pub fn new(parts: RunSessionParts) -> Self {
        let RunSessionParts {
            run_id,
            tab,
            folder,
            description,
        } = parts;
        let run_file = folder.join(super::RUN_FILE_NAME);
        let state = Mutex::new(RunState {
            phase: RunPhase::Queued,
            statement_index: 0,
            is_cancel_requested: false,
            files: RunFiles::new(&folder),
        });
        Self {
            run_id,
            tab,
            run_file,
            description,
            state,
        }
    }

    pub fn folder(&self) -> &Path {
        self.run_file
            .parent()
            .expect("the run file always sits inside its run folder")
    }

    pub fn begin_statement(&self, statement_index: usize) {
        let mut state = self.lock();
        state.phase = RunPhase::Running;
        state.statement_index = statement_index;
    }

    pub fn open_result(
        &self,
        set_number: Option<usize>,
        columns: &[ColumnMeta],
    ) -> Result<(), String> {
        let mut state = self.lock();
        let statement_index = state.statement_index;
        let key = ResultFileKey {
            statement_index,
            set_number,
        };
        state.files.open_result(key, columns)
    }

    pub fn write_row(&self, row: &[Value]) -> Result<(), String> {
        let mut state = self.lock();
        state.phase = RunPhase::Writing;
        state.files.write_row(row)
    }

    pub fn close_result(&self, is_complete: bool) {
        self.lock().files.close_result(is_complete);
    }

    pub fn request_cancel(&self) {
        self.lock().is_cancel_requested = true;
    }

    pub fn is_cancel_requested(&self) -> bool {
        self.lock().is_cancel_requested
    }

    pub fn progress(&self) -> RunExportProgress {
        let state = self.lock();
        RunExportProgress {
            run_file_path: self.run_file.display().to_string(),
            phase: state.phase,
            statement_number: state.statement_index + 1,
            statement_count: self.description.statements.len(),
            rows_written: state.files.rows_written(),
            bytes_written: state.files.bytes_written(),
        }
    }

    pub fn close_and_snapshot(&self) -> RunSnapshot {
        let mut state = self.lock();
        state.files.close_result(false);
        RunSnapshot {
            statement_index: state.statement_index,
            is_cancel_requested: state.is_cancel_requested,
            records: state.files.records().to_vec(),
            write_failure: state.files.write_failure().cloned(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, RunState> {
        self.state.lock().expect("run session lock poisoned")
    }
}

#[derive(Default)]
pub struct RunRegistry {
    runs: Mutex<HashMap<String, Arc<RunSession>>>,
}

impl RunRegistry {
    pub fn register(&self, session: Arc<RunSession>) {
        self.lock().insert(session.run_id.clone(), session);
    }

    pub fn get(&self, run_id: &str) -> Option<Arc<RunSession>> {
        self.lock().get(run_id).cloned()
    }

    pub fn remove(&self, run_id: &str) {
        self.lock().remove(run_id);
    }

    pub fn request_cancel(&self, tab: &TabRun) -> bool {
        let runs = self.lock();
        let tab_runs: Vec<&Arc<RunSession>> = runs
            .values()
            .filter(|session| session.tab == *tab)
            .collect();
        tab_runs.iter().for_each(|session| session.request_cancel());
        !tab_runs.is_empty()
    }

    pub fn is_empty(&self) -> bool {
        self.lock().is_empty()
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Arc<RunSession>>> {
        self.runs.lock().expect("run registry lock poisoned")
    }
}
