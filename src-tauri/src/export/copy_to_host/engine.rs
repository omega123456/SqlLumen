use super::*;
use crate::mysql::pool;
use crate::mysql::query_log;
use crate::mysql::registry::StoredConnectionParams;
use crate::mysql::schema_queries::{query_ddl, safe_identifier};
use crate::state::AppState;
use futures::StreamExt;
use sqlx::mysql::MySqlPool;
use sqlx::{Column, MySqlConnection, Row};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::RwLock;

mod copy_run;
mod table_copy;
mod target_setup;
pub use copy_run::*;
pub use table_copy::*;
pub use target_setup::*;

pub type CopyJobMap = Arc<RwLock<HashMap<String, CopyJobProgress>>>;

pub struct CopyJob {
    pub jobs: CopyJobMap,
    pub job_id: String,
}

impl CopyJob {
    fn is_cancel_requested(&self) -> bool {
        let map = self
            .jobs
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        map.get(&self.job_id).is_some_and(should_cancel)
    }

    fn update_progress(&self, update: impl FnOnce(&mut CopyJobProgress)) {
        let mut map = self
            .jobs
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(progress) = map.get_mut(&self.job_id) {
            update(progress);
        }
    }

    fn record_rows_done(&self, rows_done: u64) {
        self.update_progress(|progress| progress.rows_done = Some(rows_done));
    }
}

pub struct DatabaseEncoding {
    pub charset: String,
    pub collation: String,
}

struct CopyPools<'a> {
    source: &'a MySqlPool,
    target: &'a MySqlPool,
}

struct CopyRun<'a> {
    params: &'a CopyToHostParams,
    job: &'a CopyJob,
    source: &'a MySqlPool,
    byte_budget: u64,
}

struct PendingInsert<'a> {
    prefix: &'a str,
    rows: &'a [RenderedRow],
    rows_done: u64,
}

pub struct ResolvedTargetPool {
    pub pool: MySqlPool,
    pub owned: bool,
}

impl ResolvedTargetPool {
    pub async fn dispose(self) {
        if self.owned {
            self.pool.close().await;
        }
    }
}
