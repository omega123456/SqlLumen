use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use moka::notification::RemovalCause;
use moka::sync::Cache;
use moka::Expiry;
use serde::de::DeserializeOwned;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::query_executor::StoredResult;

mod cache_access;
mod construction;
mod memory_snapshot;
mod ram_pressure;
mod spill_worker;
mod stored_results;
pub use memory_snapshot::*;
use spill_worker::*;

pub const DEFAULT_ROW_CEILING: usize = 100_000;

const RAM_PRESSURE_MAX_THRESHOLD_BYTES: u64 = 4_294_967_296;
const RAM_PRESSURE_THRESHOLD_PERCENT: u64 = 10;
const PERCENT: u64 = 100;
const RAM_PRESSURE_MAX_PASSES: usize = 5;
const RAM_PRESSURE_EVICTION_BATCH_SIZE: usize = 3;
const RAM_PRESSURE_SETTLE_DELAY: Duration = Duration::from_millis(100);
const BYTES_PER_MEBIBYTE: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy)]
pub struct CacheKey<'a> {
    pub connection_id: &'a str,
    pub tab_id: &'a str,
}

impl<'a> CacheKey<'a> {
    pub fn new(connection_id: &'a str, tab_id: &'a str) -> Self {
        Self {
            connection_id,
            tab_id,
        }
    }
}

pub struct VersionedValue<V> {
    pub expected_invalidation_version: u64,
    pub value: V,
}

#[derive(Clone, Copy)]
pub struct SlotWriteTarget<'a> {
    pub connection_id: &'a str,
    pub tab_id: &'a str,
    pub expected_invalidation_version: u64,
    pub index: usize,
    pub expected_query_id: Option<&'a str>,
    pub base_view_version: Option<u64>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SlotWrite<T> {
    Applied(T),
    Invalidated,
    QueryIdMismatch,
    ViewSuperseded { current: u64 },
}

#[derive(Debug, Clone)]
pub struct CachedEntry<V> {
    pub value: V,
    pub generation: u64,
}

type CacheMapKey = (String, String);
type SpillMarker = (String, String, u64);
type SharedSpillMarkers = Arc<RwLock<HashSet<SpillMarker>>>;
type SharedGenerations = Arc<RwLock<HashMap<CacheMapKey, u64>>>;

const MAX_CACHE_ENTRIES: u64 = 10_000;
const SPILL_FILE_EXTENSION: &str = "msgpack";

struct SpillWriteJob<V> {
    connection_id: String,
    tab_id: String,
    generation: u64,
    entry: Arc<CachedEntry<V>>,
}

impl<V> SpillWriteJob<V> {
    fn key(&self) -> CacheMapKey {
        (self.connection_id.clone(), self.tab_id.clone())
    }

    fn marker(&self) -> SpillMarker {
        (
            self.connection_id.clone(),
            self.tab_id.clone(),
            self.generation,
        )
    }
}

enum SpillWorkerMessage<V> {
    Write(SpillWriteJob<V>),
    Flush(Sender<()>),
    Shutdown,
}

#[derive(Debug)]
pub enum CacheGet<V> {
    Found(Arc<CachedEntry<V>>),
    ReWarmed(Arc<CachedEntry<V>>),
    NeverStored,
    Expired,
}

impl<V> CacheGet<V> {
    pub fn into_entry(self) -> Option<Arc<CachedEntry<V>>> {
        match self {
            Self::Found(entry) | Self::ReWarmed(entry) => Some(entry),
            _ => None,
        }
    }

    pub fn is_available(&self) -> bool {
        matches!(self, Self::Found(_) | Self::ReWarmed(_))
    }

    pub fn is_expired(&self) -> bool {
        matches!(self, Self::Expired)
    }
}

pub struct GenericCache<V>
where
    V: Clone + Send + Sync + Serialize + DeserializeOwned + std::fmt::Debug + 'static,
{
    cache: Cache<(String, String), Arc<CachedEntry<V>>>,
    spill_dir: PathBuf,
    session_id: String,
    ttl_secs: Arc<AtomicU64>,
    ram_pressure_min_idle: Duration,
    lru_order: RwLock<VecDeque<(String, String)>>,
    last_touched_at: RwLock<HashMap<(String, String), Instant>>,
    next_generation: AtomicU64,
    known_keys: RwLock<HashSet<(String, String)>>,
    generations: Arc<RwLock<HashMap<(String, String), u64>>>,
    spillable_removals: Arc<RwLock<HashSet<(String, String, u64)>>>,
    invalidation_versions: Arc<RwLock<HashMap<(String, String), u64>>>,
    cleaned_keys: Arc<RwLock<HashSet<(String, String)>>>,
    spill_worker_tx: Sender<SpillWorkerMessage<V>>,
    spill_worker_handle: Mutex<Option<std::thread::JoinHandle<()>>>,
    in_place_write_lock: Mutex<()>,
    row_ceiling: Arc<AtomicUsize>,
}

pub type ResultCache = GenericCache<Vec<StoredResult>>;
pub type CachedResultEntry = CachedEntry<Vec<StoredResult>>;
pub type ResultCacheGet = CacheGet<Vec<StoredResult>>;

fn removal_cause_label(cause: RemovalCause) -> &'static str {
    match cause {
        RemovalCause::Expired => "expired",
        RemovalCause::Size => "size",
        RemovalCause::Explicit => "explicit",
        RemovalCause::Replaced => "replaced",
    }
}

fn safe_spill_filename(connection_id: &str, tab_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(connection_id.as_bytes());
    hasher.update(b":");
    hasher.update(tab_id.as_bytes());
    let hash = hasher.finalize();
    hex::encode(hash)
}
