use std::fs::DirEntry;
use std::path::Path;

use jiff::Timestamp;

use super::runs_directory;
use crate::timestamps::days_before;

pub const RUN_FOLDER_RETENTION_DAYS: i64 = 7;

pub fn sweep_run_folders(root: &Path, now: Timestamp) {
    let runs = runs_directory(root);
    let entries = match std::fs::read_dir(&runs) {
        Ok(entries) => entries,
        Err(error) if crate::is_not_found_error(&error) => return,
        Err(error) => {
            tracing::warn!(error = %error, path = %runs.display(), "failed to list run folders");
            return;
        }
    };
    let cutoff = days_before(now, RUN_FOLDER_RETENTION_DAYS);
    entries
        .flatten()
        .filter(|entry| was_modified_before(entry, cutoff))
        .for_each(|entry| remove_expired_run_folder(&entry.path()));
}

fn was_modified_before(entry: &DirEntry, cutoff: Timestamp) -> bool {
    let modified = entry.metadata().and_then(|metadata| metadata.modified());
    let Ok(modified) = modified else {
        return false;
    };
    Timestamp::try_from(modified).is_ok_and(|modified_at| modified_at < cutoff)
}

fn remove_expired_run_folder(folder: &Path) {
    if let Err(error) = std::fs::remove_dir_all(folder) {
        tracing::warn!(
            error = %error,
            path = %folder.display(),
            "failed to remove an expired run folder"
        );
    }
}
