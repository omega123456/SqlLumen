use std::sync::{Mutex, MutexGuard};
use tokio_util::sync::CancellationToken;

use super::super::types::{BuildConfig, BuildProgress, ProgressCallback};

mod embedding;
mod full_build;
mod partial_rebuild;
mod pending_chunk;
mod progress;
mod schema_snapshot;
mod vector_storage;

pub use full_build::build_index;
pub use partial_rebuild::rebuild_tables;

const EMBED_BATCH_SIZE: usize = 32;
const SQLITE_COMMIT_BATCH: usize = 20;
const BUILD_CANCELLED: &str = "Build cancelled";

#[derive(Clone, Copy)]
pub struct IndexBuildResources<'a> {
    pub sqlite_conn: &'a Mutex<rusqlite::Connection>,
    pub mysql_pool: &'a crate::mysql::pool::BackgroundPool,
    pub http_client: &'a reqwest::Client,
    pub cancellation: &'a CancellationToken,
}

#[derive(Clone, Copy)]
struct BuildContext<'a> {
    config: &'a BuildConfig,
    resources: IndexBuildResources<'a>,
    on_progress: Option<&'a ProgressCallback>,
}

impl BuildContext<'_> {
    fn connection_id(&self) -> &str {
        &self.config.connection_id
    }

    fn report(&self, progress: BuildProgress) {
        let Some(on_progress) = self.on_progress else {
            return;
        };
        on_progress(progress);
    }

    fn lock_index_db(&self) -> Result<MutexGuard<'_, rusqlite::Connection>, String> {
        lock_index_db(self.resources.sqlite_conn)
    }

    fn is_cancelled(&self) -> bool {
        self.resources.cancellation.is_cancelled()
    }
}

fn lock_index_db(
    sqlite_conn: &Mutex<rusqlite::Connection>,
) -> Result<MutexGuard<'_, rusqlite::Connection>, String> {
    sqlite_conn
        .lock()
        .map_err(|error| format!("SQLite lock: {error}"))
}

fn ensure_not_cancelled(context: &BuildContext<'_>) -> Result<(), String> {
    if context.is_cancelled() {
        return Err(BUILD_CANCELLED.to_string());
    }
    Ok(())
}

fn elapsed_millis(started: std::time::Instant) -> u64 {
    started.elapsed().as_millis() as u64
}
