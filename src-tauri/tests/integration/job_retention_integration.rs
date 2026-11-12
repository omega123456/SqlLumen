//! Terminal-job retention shared by dump, import, copy and result-export job maps.

use sqllumen_lib::export::job_retention::{cleanup_terminal_jobs, TERMINAL_JOB_RETENTION};
use sqllumen_lib::state::{
    CopyJobProgress, CopyJobStatus, DumpJobProgress, DumpJobStatus, ImportJobProgress,
    ImportJobStatus,
};
use std::collections::HashMap;
use std::time::{Duration, SystemTime};

const ONE_SECOND: Duration = Duration::from_secs(1);

fn expired_completion() -> Option<SystemTime> {
    Some(SystemTime::now() - TERMINAL_JOB_RETENTION - ONE_SECOND)
}

fn future_completion() -> Option<SystemTime> {
    Some(SystemTime::now() + TERMINAL_JOB_RETENTION)
}

fn import_job(completed_at: Option<SystemTime>) -> ImportJobProgress {
    ImportJobProgress {
        job_id: "import".to_string(),
        status: ImportJobStatus::Completed,
        statements_total: 1,
        statements_done: 1,
        errors: vec![],
        stop_on_error: false,
        cancel_requested: false,
        completed_at,
    }
}

fn dump_job(completed_at: Option<SystemTime>) -> DumpJobProgress {
    DumpJobProgress {
        job_id: "dump".to_string(),
        status: DumpJobStatus::Completed,
        tables_total: 1,
        tables_done: 1,
        current_table: None,
        bytes_written: 0,
        rows_exported: 0,
        error_message: None,
        cancel_requested: false,
        mysql_thread_id: None,
        completed_at,
    }
}

fn copy_job(completed_at: Option<SystemTime>) -> CopyJobProgress {
    CopyJobProgress {
        job_id: "copy".to_string(),
        status: CopyJobStatus::Completed,
        objects_total: 1,
        objects_done: 1,
        current_object: None,
        current_object_type: None,
        rows_total: None,
        rows_done: None,
        error_message: None,
        cancel_requested: false,
        completed_at,
    }
}

#[test]
fn cleanup_drops_only_jobs_finished_longer_ago_than_the_retention() {
    let mut jobs = HashMap::from([
        ("running".to_string(), import_job(None)),
        ("recent".to_string(), import_job(Some(SystemTime::now()))),
        ("old".to_string(), import_job(expired_completion())),
        ("future".to_string(), import_job(future_completion())),
    ]);

    cleanup_terminal_jobs(&mut jobs);

    let mut kept: Vec<&str> = jobs.keys().map(String::as_str).collect();
    kept.sort_unstable();
    assert_eq!(kept, vec!["future", "recent", "running"]);
}

#[test]
fn cleanup_applies_to_dump_jobs() {
    let mut jobs = HashMap::from([
        ("running".to_string(), dump_job(None)),
        ("old".to_string(), dump_job(expired_completion())),
    ]);

    cleanup_terminal_jobs(&mut jobs);

    assert!(jobs.contains_key("running"));
    assert!(!jobs.contains_key("old"));
}

#[test]
fn cleanup_applies_to_copy_jobs() {
    let mut jobs = HashMap::from([
        ("recent".to_string(), copy_job(Some(SystemTime::now()))),
        ("old".to_string(), copy_job(expired_completion())),
    ]);

    cleanup_terminal_jobs(&mut jobs);

    assert!(jobs.contains_key("recent"));
    assert!(!jobs.contains_key("old"));
}
