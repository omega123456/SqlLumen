use super::*;
use crate::mysql::cell_values::DecodedRow;
use crate::mysql::logged_query::{LoggedStatement, execute, fetch_first_decoded, stream};
use crate::mysql::pool::{self, BackgroundPool};
use crate::mysql::registry::StoredConnectionParams;
use crate::mysql::schema_queries::{query_ddl_on_connection, safe_identifier};
use crate::state::AppState;
use mysql_async::Conn;
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
    source: &'a BackgroundPool,
    target: &'a BackgroundPool,
}

pub struct CopyConnections<'a> {
    pub source: &'a mut Conn,
    pub target: &'a mut Conn,
}

struct CopyRun<'a> {
    params: &'a CopyToHostParams,
    job: &'a CopyJob,
    byte_budget: u64,
}

struct PendingInsert<'a> {
    prefix: &'a str,
    rows: &'a [RenderedRow],
    rows_done: u64,
}

pub struct ResolvedTargetPool {
    pub pool: BackgroundPool,
    pub owned: bool,
}

impl ResolvedTargetPool {
    pub fn dispose(self) {
        if self.owned {
            self.pool
                .disconnect_in_background("copy-to-host target pool");
        }
    }
}
