//! In-memory result cache backed by moka with time-to-idle eviction,
//! disk spill on expiry, transparent re-warm, parallel LRU tracking
//! for RAM-pressure eviction, and a pluggable memory snapshot source.

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

/// Default hard ceiling on rows kept per query-editor result
/// (`results.maxRows`); see `commands::settings` for the setting bounds.
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

/// Outcome of [`GenericCache::modify_slot_in_place_if_current`].
#[derive(Debug, PartialEq, Eq)]
pub enum SlotWrite<T> {
    /// The closure ran and its changes were written back.
    Applied(T),
    /// The invalidation version changed, or the entry or slot is gone.
    Invalidated,
    /// The slot holds a different query id than the request expected.
    QueryIdMismatch,
    /// The slot's view version no longer equals the request's base version.
    ViewSuperseded { current: u64 },
}

/// Wrapper stored in the moka cache. Holds the cached value plus a
/// monotonically increasing generation token used for stale-listener
/// protection.
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

/// Result of a `GenericCache::get()` call.
#[derive(Debug)]
pub enum CacheGet<V> {
    /// Entry was found in the in-memory cache.
    Found(Arc<CachedEntry<V>>),
    /// Entry was re-warmed from a spill file on disk.
    ReWarmed(Arc<CachedEntry<V>>),
    /// Key was never stored in this session.
    NeverStored,
    /// Key was previously stored but is no longer available (neither in
    /// cache nor on disk).
    Expired,
}

impl<V> CacheGet<V> {
    /// Convenience: extract the entry if `Found` or `ReWarmed`, else `None`.
    pub fn into_entry(self) -> Option<Arc<CachedEntry<V>>> {
        match self {
            Self::Found(entry) | Self::ReWarmed(entry) => Some(entry),
            _ => None,
        }
    }

    /// Returns `true` when an entry is available (found or re-warmed).
    pub fn is_available(&self) -> bool {
        matches!(self, Self::Found(_) | Self::ReWarmed(_))
    }

    /// Returns `true` when the key was known but results are gone.
    pub fn is_expired(&self) -> bool {
        matches!(self, Self::Expired)
    }
}

/// Thread-safe cache with time-to-idle eviction, disk spill,
/// re-warm, and RAM-pressure eviction.
pub struct GenericCache<V>
where
    V: Clone + Send + Sync + Serialize + DeserializeOwned + std::fmt::Debug + 'static,
{
    cache: Cache<(String, String), Arc<CachedEntry<V>>>,
    spill_dir: PathBuf,
    session_id: String,
    ttl_secs: Arc<AtomicU64>,
    ram_pressure_min_idle: Duration,
    /// Parallel LRU order for RAM-pressure eviction (front = least recent).
    lru_order: RwLock<VecDeque<(String, String)>>,
    /// Last access time per key used to debounce RAM-pressure spill attempts.
    last_touched_at: RwLock<HashMap<(String, String), Instant>>,
    /// Next generation token (monotonically increasing per cache instance).
    next_generation: AtomicU64,
    /// Keys that have ever been inserted (to distinguish NeverStored vs Expired).
    known_keys: RwLock<HashSet<(String, String)>>,
    /// Current generation per key (for stale-listener protection).
    generations: Arc<RwLock<HashMap<(String, String), u64>>>,
    /// Keys+generations pre-approved for spill by RAM-pressure eviction.
    spillable_removals: Arc<RwLock<HashSet<(String, String, u64)>>>,
    /// Per-key invalidation version used to drop late writes after explicit cleanup.
    invalidation_versions: Arc<RwLock<HashMap<(String, String), u64>>>,
    /// Keys that have been explicitly cleaned up (tab close). The eviction
    /// listener must not write spill files for these keys.
    cleaned_keys: Arc<RwLock<HashSet<(String, String)>>>,
    spill_worker_tx: Sender<SpillWorkerMessage<V>>,
    spill_worker_handle: Mutex<Option<std::thread::JoinHandle<()>>>,
    /// Serializes in-place read-modify-write updates (cell edits, view and
    /// tombstone write-backs) so concurrent callers cannot lose each other's changes.
    in_place_write_lock: Mutex<()>,
    /// Hard ceiling on rows kept per result (read by the editor decode loop).
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

/// Derive a filesystem-safe filename from connection_id and tab_id
/// using hex-encoded SHA-256. Contains no path separators.
fn safe_spill_filename(connection_id: &str, tab_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(connection_id.as_bytes());
    hasher.update(b":");
    hasher.update(tab_id.as_bytes());
    let hash = hasher.finalize();
    hex::encode(hash)
}
