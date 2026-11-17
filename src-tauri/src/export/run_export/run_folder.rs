use std::fs::DirBuilder;
use std::path::{Path, PathBuf};

use crate::timestamps::folder_timestamp_now;

const APP_TEMP_DIRECTORY_NAME: &str = "sqllumen";
const RUNS_DIRECTORY_NAME: &str = "agent-runs";
#[cfg(unix)]
const OWNER_ONLY_DIRECTORY_MODE: u32 = 0o700;

pub fn runs_directory(root: &Path) -> PathBuf {
    root.join(APP_TEMP_DIRECTORY_NAME).join(RUNS_DIRECTORY_NAME)
}

pub(super) fn create_run_folder(root: &Path) -> Result<PathBuf, String> {
    let runs = runs_directory(root);
    owner_only_directory_builder()
        .recursive(true)
        .create(&runs)
        .map_err(|error| format!("Couldn't create the run folder: {error}"))?;
    let folder = runs.join(folder_timestamp_now());
    owner_only_directory_builder()
        .create(&folder)
        .map_err(|error| format!("Couldn't create the run folder: {error}"))?;
    Ok(folder)
}

pub(super) fn remove_run_folder(folder: &Path) {
    if let Err(error) = std::fs::remove_dir_all(folder) {
        tracing::warn!(
            error = %error,
            path = %folder.display(),
            "failed to remove an unfinished run folder"
        );
    }
}

fn owner_only_directory_builder() -> DirBuilder {
    let mut builder = DirBuilder::new();
    restrict_to_owner(&mut builder);
    builder
}

#[cfg(unix)]
fn restrict_to_owner(builder: &mut DirBuilder) {
    use std::os::unix::fs::DirBuilderExt;
    builder.mode(OWNER_ONLY_DIRECTORY_MODE);
}

#[cfg(not(unix))]
fn restrict_to_owner(_builder: &mut DirBuilder) {}
