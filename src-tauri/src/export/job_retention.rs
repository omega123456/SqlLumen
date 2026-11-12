use crate::state::{CopyJobProgress, DumpJobProgress, ImportJobProgress, ResultExportJobProgress};
use std::collections::HashMap;
use std::time::{Duration, SystemTime};

const SECONDS_PER_MINUTE: u64 = 60;
const TERMINAL_JOB_RETENTION_MINUTES: u64 = 5;

pub const TERMINAL_JOB_RETENTION: Duration =
    Duration::from_secs(TERMINAL_JOB_RETENTION_MINUTES * SECONDS_PER_MINUTE);

pub trait CompletedAt {
    fn completed_at(&self) -> Option<SystemTime>;
}

impl CompletedAt for DumpJobProgress {
    fn completed_at(&self) -> Option<SystemTime> {
        self.completed_at
    }
}

impl CompletedAt for ImportJobProgress {
    fn completed_at(&self) -> Option<SystemTime> {
        self.completed_at
    }
}

impl CompletedAt for CopyJobProgress {
    fn completed_at(&self) -> Option<SystemTime> {
        self.completed_at
    }
}

impl CompletedAt for ResultExportJobProgress {
    fn completed_at(&self) -> Option<SystemTime> {
        self.completed_at
    }
}

fn is_within_retention(completed_at: Option<SystemTime>, now: SystemTime) -> bool {
    let Some(completed_at) = completed_at else {
        return true;
    };
    now.duration_since(completed_at)
        .map_or(true, |age| age < TERMINAL_JOB_RETENTION)
}

pub fn cleanup_terminal_jobs<Job: CompletedAt>(jobs: &mut HashMap<String, Job>) {
    let now = SystemTime::now();
    jobs.retain(|_, job| is_within_retention(job.completed_at(), now));
}
