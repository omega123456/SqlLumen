//! In-memory result cache backed by moka with time-to-idle eviction,
//! disk spill on expiry, transparent re-warm, parallel LRU tracking
//! for RAM-pressure eviction, and a pluggable memory snapshot source.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
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

/// Wrapper stored in the moka cache. Holds the cached value plus a
/// monotonically increasing generation token used for stale-listener
/// protection.
#[derive(Debug, Clone)]
pub struct CachedEntry<V> {
    pub value: V,
    pub generation: u64,
}

struct SpillWriteJob<V> {
    connection_id: String,
    tab_id: String,
    generation: u64,
    entry: Arc<CachedEntry<V>>,
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
            Self::Found(e) | Self::ReWarmed(e) => Some(e),
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

/// Abstraction over system memory for testability.
pub trait MemorySnapshot: Send + Sync {
    fn refresh(&mut self) {}
    fn available_bytes(&self) -> u64;
    fn total_bytes(&self) -> u64;
}

/// Production implementation using `sysinfo`.
pub struct SysinfoMemorySnapshot {
    sys: sysinfo::System,
}

impl SysinfoMemorySnapshot {
    pub fn new() -> Self {
        let mut sys = sysinfo::System::new();
        sys.refresh_memory();
        Self { sys }
    }

    /// Refresh memory stats before reading.
    pub fn refresh(&mut self) {
        self.sys.refresh_memory();
    }
}

impl MemorySnapshot for SysinfoMemorySnapshot {
    fn refresh(&mut self) {
        self.sys.refresh_memory();
    }

    fn available_bytes(&self) -> u64 {
        // macOS: sysinfo's available_memory() excludes the large pool of
        // inactive (reclaimable) pages, so on a machine with plenty of free
        // RAM it reports only a few GB and spuriously triggers RAM-pressure
        // eviction. Read the reclaimable total straight from Mach instead.
        #[cfg(target_os = "macos")]
        {
            if let Some(bytes) = macos_reclaimable_bytes() {
                return bytes;
            }
        }

        let available = self.sys.available_memory();
        if available > 0 {
            return available;
        }
        // Fallback: approximate as total − used.
        self.sys
            .total_memory()
            .saturating_sub(self.sys.used_memory())
    }

    fn total_bytes(&self) -> u64 {
        self.sys.total_memory()
    }
}

/// Reclaimable memory on macOS = (free + inactive + speculative) pages.
///
/// These are the pages the kernel can hand back under pressure. We
/// deliberately exclude `compressor` pages (holding live compressed data)
/// and `wired`/`active` pages. Returns `None` if the Mach call fails, so the
/// caller can fall back to `sysinfo`.
#[cfg(target_os = "macos")]
fn macos_reclaimable_bytes() -> Option<u64> {
    use std::mem;

    // Not re-exported by libc 0.2; declared here so the `mach_host_self()` send
    // right can be released. Stable Mach syscall: releases a reference to the
    // named port right in the given task's IPC space.
    extern "C" {
        fn mach_port_deallocate(
            task: libc::mach_port_t,
            name: libc::mach_port_t,
        ) -> libc::kern_return_t;
    }

    // SAFETY: the Mach call operates on a stack-owned, zero-initialized
    // out-param with an explicitly sized count, and we check the return code
    // before reading the result. `mach_host_self` is deprecated in libc in
    // favor of the `mach2` crate, but the symbol is stable; we avoid the extra
    // dependency.
    #[allow(deprecated)]
    unsafe {
        let page_size = libc::vm_page_size as u64;
        if page_size == 0 {
            return None;
        }

        // `mach_host_self()` returns an owned send right that must be released,
        // otherwise this periodically-called function leaks a port name per call.
        let host = libc::mach_host_self();

        let mut stats: libc::vm_statistics64 = mem::zeroed();
        let mut count = libc::HOST_VM_INFO64_COUNT;
        let ret = libc::host_statistics64(
            host,
            libc::HOST_VM_INFO64,
            &mut stats as *mut _ as *mut libc::integer_t,
            &mut count,
        );
        mach_port_deallocate(libc::mach_task_self(), host);

        if ret != libc::KERN_SUCCESS {
            return None;
        }

        let reclaimable_pages = stats.free_count as u64
            + stats.inactive_count as u64
            + stats.speculative_count as u64;
        Some(reclaimable_pages.saturating_mul(page_size))
    }
}

/// Custom moka `Expiry` that reads the current TTL from a shared atomic.
/// Returns the same duration for create, read, and update so every
/// interaction resets the idle timer to the latest configured value.
struct DynamicTtlExpiry {
    ttl_secs: Arc<AtomicU64>,
}

impl<V> Expiry<(String, String), Arc<CachedEntry<V>>> for DynamicTtlExpiry
where
    V: Clone + Send + Sync + Serialize + DeserializeOwned + std::fmt::Debug + 'static,
{
    fn expire_after_create(
        &self,
        _key: &(String, String),
        _value: &Arc<CachedEntry<V>>,
        _current_time: std::time::Instant,
    ) -> Option<Duration> {
        Some(Duration::from_secs(self.ttl_secs.load(Ordering::Relaxed)))
    }

    fn expire_after_read(
        &self,
        _key: &(String, String),
        _value: &Arc<CachedEntry<V>>,
        _current_time: std::time::Instant,
        _current_duration: Option<Duration>,
        _last_modified_at: std::time::Instant,
    ) -> Option<Duration> {
        Some(Duration::from_secs(self.ttl_secs.load(Ordering::Relaxed)))
    }

    fn expire_after_update(
        &self,
        _key: &(String, String),
        _value: &Arc<CachedEntry<V>>,
        _current_time: std::time::Instant,
        _current_duration: Option<Duration>,
    ) -> Option<Duration> {
        Some(Duration::from_secs(self.ttl_secs.load(Ordering::Relaxed)))
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
}

impl<V> GenericCache<V>
where
    V: Clone + Send + Sync + Serialize + DeserializeOwned + std::fmt::Debug + 'static,
{
    const DEFAULT_RAM_PRESSURE_MIN_IDLE: Duration = Duration::from_secs(10 * 60);

    /// Create a new `GenericCache`.
    ///
    /// - `ttl_seconds`: initial time-to-idle in seconds
    /// - `spill_dir`: base directory for spill files (created lazily)
    pub fn new(ttl_seconds: u64, spill_dir: PathBuf) -> Self {
        Self::new_with_shared_ttl(Arc::new(AtomicU64::new(ttl_seconds)), spill_dir)
    }

    /// Create a cache that reads TTL from a shared atomic source.
    pub fn new_with_shared_ttl(ttl: Arc<AtomicU64>, spill_dir: PathBuf) -> Self {
        Self::new_with_shared_ttl_and_ram_pressure_idle(
            ttl,
            spill_dir,
            Self::DEFAULT_RAM_PRESSURE_MIN_IDLE,
        )
    }

    fn new_with_shared_ttl_and_ram_pressure_idle(
        ttl: Arc<AtomicU64>,
        spill_dir: PathBuf,
        ram_pressure_min_idle: Duration,
    ) -> Self {
        let session_id = uuid::Uuid::new_v4().to_string();
        let spillable_removals: Arc<RwLock<HashSet<(String, String, u64)>>> =
            Arc::new(RwLock::new(HashSet::new()));
        let invalidation_versions = Arc::new(RwLock::new(HashMap::new()));
        let cleaned_keys: Arc<RwLock<HashSet<(String, String)>>> =
            Arc::new(RwLock::new(HashSet::new()));
        let generations = Arc::new(RwLock::new(HashMap::new()));

        let spill_dir_for_listener = spill_dir.clone();
        let session_id_for_listener = session_id.clone();
        let spillable_for_worker = Arc::clone(&spillable_removals);
        let spillable_for_listener = Arc::clone(&spillable_removals);
        let cleaned_for_listener = Arc::clone(&cleaned_keys);
        let generations_for_worker_thread = Arc::clone(&generations);
        let (spill_worker_tx, spill_worker_rx) = mpsc::channel::<SpillWorkerMessage<V>>();
        let spill_worker_tx_for_listener = spill_worker_tx.clone();

        let spill_worker_handle = std::thread::spawn(move || {
            while let Ok(message) = spill_worker_rx.recv() {
                match message {
                    SpillWorkerMessage::Write(job) => {
                        let key = (job.connection_id.clone(), job.tab_id.clone());
                        let still_spillable = {
                            let spillable = spillable_for_worker
                                .read()
                                .expect("spillable_removals lock poisoned");
                            spillable.contains(&(key.0.clone(), key.1.clone(), job.generation))
                        };

                        if !still_spillable {
                            tracing::debug!(
                                connection_id = %job.connection_id,
                                tab_id = %job.tab_id,
                                generation = job.generation,
                                "cache spill write skipped: no longer spillable"
                            );
                            continue;
                        }

                        let current_generation = {
                            let gens = generations_for_worker_thread
                                .read()
                                .expect("generations lock poisoned");
                            gens.get(&key).copied()
                        };

                        if current_generation != Some(job.generation) {
                            tracing::debug!(
                                connection_id = %job.connection_id,
                                tab_id = %job.tab_id,
                                generation = job.generation,
                                current_generation = ?current_generation,
                                "cache spill write skipped: stale generation"
                            );
                            let mut spillable = spillable_for_worker
                                .write()
                                .expect("spillable_removals lock poisoned");
                            spillable.remove(&(key.0.clone(), key.1.clone(), job.generation));
                            continue;
                        }

                        let session_dir = spill_dir_for_listener.join(&session_id_for_listener);
                        if let Err(e) = fs::create_dir_all(&session_dir) {
                            tracing::warn!(
                                error = %e,
                                connection_id = %job.connection_id,
                                tab_id = %job.tab_id,
                                generation = job.generation,
                                "failed to create spill directory"
                            );
                            continue;
                        }

                        let safe_name = safe_spill_filename(&job.connection_id, &job.tab_id);
                        let path = session_dir.join(format!("{safe_name}.msgpack"));

                        match rmp_serde::to_vec_named(&job.entry.value) {
                            Ok(bytes) => {
                                if let Err(e) = fs::write(&path, &bytes) {
                                    tracing::warn!(
                                        error = %e,
                                        path = %path.display(),
                                        "failed to write spill file"
                                    );
                                } else {
                                    tracing::debug!(
                                        connection_id = %job.connection_id,
                                        tab_id = %job.tab_id,
                                        generation = job.generation,
                                        path = %path.display(),
                                        spill_bytes = bytes.len(),
                                        "cache spill written to disk"
                                    );
                                }
                            }
                            Err(e) => {
                                tracing::warn!(
                                    error = %e,
                                    connection_id = %job.connection_id,
                                    tab_id = %job.tab_id,
                                    generation = job.generation,
                                    "failed to serialize value for spill"
                                );
                            }
                        }

                        let mut spillable = spillable_for_worker
                            .write()
                            .expect("spillable_removals lock poisoned");
                        spillable.remove(&(key.0.clone(), key.1.clone(), job.generation));
                    }
                    SpillWorkerMessage::Flush(ack) => {
                        let _ = ack.send(());
                    }
                    SpillWorkerMessage::Shutdown => break,
                }
            }
        });

        let ttl_secs = Arc::clone(&ttl);
        let cache = Cache::builder()
            .max_capacity(10_000)
            .expire_after(DynamicTtlExpiry {
                ttl_secs: Arc::clone(&ttl),
            })
            .eviction_listener(move |key, value, cause| {
                let key: &(String, String) = &key;
                let entry: Arc<CachedEntry<V>> = value;
                let generation = entry.generation;

                {
                    let cleaned = cleaned_for_listener
                        .read()
                        .expect("cleaned_keys lock poisoned");
                    if cleaned.contains(key) {
                        return;
                    }
                }

                let marker = (key.0.clone(), key.1.clone(), generation);
                let should_spill = match cause {
                    RemovalCause::Expired | RemovalCause::Size => {
                        let mut spillable = spillable_for_listener
                            .write()
                            .expect("spillable_removals lock poisoned");
                        spillable.insert(marker.clone());
                        true
                    }
                    RemovalCause::Explicit => {
                        let spillable = spillable_for_listener
                            .read()
                            .expect("spillable_removals lock poisoned");
                        spillable.contains(&marker)
                    }
                    RemovalCause::Replaced => false,
                };

                if !should_spill {
                    return;
                }

                let send_result =
                    spill_worker_tx_for_listener.send(SpillWorkerMessage::Write(SpillWriteJob {
                        connection_id: key.0.clone(),
                        tab_id: key.1.clone(),
                        generation,
                        entry,
                    }));
                if let Err(e) = send_result {
                    let mut spillable = spillable_for_listener
                        .write()
                        .expect("spillable_removals lock poisoned");
                    spillable.remove(&marker);
                    tracing::warn!(
                        error = %e,
                        key = ?key,
                        generation,
                        "failed to enqueue spill write job"
                    );
                } else {
                    tracing::debug!(
                        connection_id = %key.0,
                        tab_id = %key.1,
                        generation,
                        cause = %removal_cause_label(cause),
                        "cache eviction: enqueueing spill write"
                    );
                }
            })
            .build();

        Self {
            cache,
            spill_dir,
            session_id,
            ttl_secs,
            ram_pressure_min_idle,
            lru_order: RwLock::new(VecDeque::new()),
            last_touched_at: RwLock::new(HashMap::new()),
            next_generation: AtomicU64::new(1),
            known_keys: RwLock::new(HashSet::new()),
            generations,
            spillable_removals,
            invalidation_versions,
            cleaned_keys,
            spill_worker_tx,
            spill_worker_handle: Mutex::new(Some(spill_worker_handle)),
        }
    }

    /// Test constructor that accepts a pre-created temporary directory path.
    pub fn new_for_test(ttl_seconds: u64, spill_dir: PathBuf) -> Self {
        Self::new(ttl_seconds, spill_dir)
    }

    /// Test constructor with a custom RAM-pressure idle threshold.
    pub fn new_for_test_with_ram_pressure_idle(
        ttl_seconds: u64,
        spill_dir: PathBuf,
        ram_pressure_min_idle: Duration,
    ) -> Self {
        Self::new_with_shared_ttl_and_ram_pressure_idle(
            Arc::new(AtomicU64::new(ttl_seconds)),
            spill_dir,
            ram_pressure_min_idle,
        )
    }

    /// Retrieve a cached value by connection and tab ID.
    /// On cache miss, attempts to re-warm from a spill file.
    pub fn get(&self, connection_id: &str, tab_id: &str) -> CacheGet<V> {
        let key = (connection_id.to_string(), tab_id.to_string());

        if let Some(entry) = self.cache.get(&key) {
            self.touch_lru(&key);
            return CacheGet::Found(entry);
        }

        let known = {
            let kk = self.known_keys.read().expect("known_keys lock poisoned");
            kk.contains(&key)
        };

        if !known {
            return CacheGet::NeverStored;
        }

        let spill_path = self.spill_file_path(connection_id, tab_id);
        if spill_path.exists() {
            tracing::debug!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                path = %spill_path.display(),
                "cache attempting spill restore"
            );
            match fs::read(&spill_path) {
                Ok(bytes) => match rmp_serde::from_slice::<V>(&bytes) {
                    Ok(value) => {
                        let spill_bytes = bytes.len();
                        let _ = fs::remove_file(&spill_path);

                        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
                        let entry = Arc::new(CachedEntry { value, generation });
                        self.cache.insert(key.clone(), Arc::clone(&entry));
                        self.touch_lru(&key);
                        {
                            let mut gens =
                                self.generations.write().expect("generations lock poisoned");
                            gens.insert(key, generation);
                        }
                        tracing::debug!(
                            connection_id = %connection_id,
                            tab_id = %tab_id,
                            generation,
                            path = %spill_path.display(),
                            spill_bytes,
                            "cache spill restored from disk"
                        );
                        return CacheGet::ReWarmed(entry);
                    }
                    Err(e) => {
                        tracing::warn!(
                            error = %e,
                            path = %spill_path.display(),
                            "failed to deserialize spill file"
                        );
                    }
                },
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        path = %spill_path.display(),
                        "failed to read spill file"
                    );
                }
            }
        } else {
            tracing::debug!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                path = %spill_path.display(),
                "cache spill restore missed: spill file not found"
            );
        }

        CacheGet::Expired
    }

    /// Insert or replace a value for a connection/tab pair.
    pub fn insert(&self, connection_id: &str, tab_id: &str, value: V) {
        let expected_invalidation_version =
            self.current_invalidation_version(connection_id, tab_id);
        let _ = self.insert_if_current(connection_id, tab_id, expected_invalidation_version, value);
    }

    /// Returns the current invalidation version for the key.
    pub fn current_invalidation_version(&self, connection_id: &str, tab_id: &str) -> u64 {
        let key = (connection_id.to_string(), tab_id.to_string());
        let versions = self
            .invalidation_versions
            .read()
            .expect("invalidation_versions lock poisoned");
        versions.get(&key).copied().unwrap_or(0)
    }

    /// Insert or replace a value when the invalidation version still matches.
    pub fn insert_if_current(
        &self,
        connection_id: &str,
        tab_id: &str,
        expected_invalidation_version: u64,
        value: V,
    ) -> bool {
        let key = (connection_id.to_string(), tab_id.to_string());
        if self.current_invalidation_version(connection_id, tab_id) != expected_invalidation_version
        {
            return false;
        }

        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);

        let spill_path = self.spill_file_path(connection_id, tab_id);
        let _ = fs::remove_file(&spill_path);

        {
            let mut spillable = self
                .spillable_removals
                .write()
                .expect("spillable_removals lock poisoned");
            spillable.retain(|&(ref c, ref t, _)| !(c == &key.0 && t == &key.1));
        }

        {
            let mut cleaned = self
                .cleaned_keys
                .write()
                .expect("cleaned_keys lock poisoned");
            cleaned.remove(&key);
        }

        let entry = Arc::new(CachedEntry { value, generation });
        self.cache.insert(key.clone(), entry);

        {
            let mut kk = self.known_keys.write().expect("known_keys lock poisoned");
            kk.insert(key.clone());
        }
        {
            let mut gens = self.generations.write().expect("generations lock poisoned");
            gens.insert(key.clone(), generation);
        }
        self.touch_lru(&key);
        true
    }

    /// Remove (invalidate) a cached value without spill cleanup.
    pub fn remove(&self, connection_id: &str, tab_id: &str) {
        let key = (connection_id.to_string(), tab_id.to_string());
        self.cache.invalidate(&key);
        self.remove_from_lru(&key);
        self.remove_last_touched(&key);
    }

    /// Remove a cached value and any associated spill artifacts.
    pub fn remove_with_spill_cleanup(&self, connection_id: &str, tab_id: &str) {
        let key = (connection_id.to_string(), tab_id.to_string());
        let invalidation_version = self.next_generation.fetch_add(1, Ordering::Relaxed);

        {
            let mut versions = self
                .invalidation_versions
                .write()
                .expect("invalidation_versions lock poisoned");
            versions.insert(key.clone(), invalidation_version);
        }

        {
            let mut cleaned = self
                .cleaned_keys
                .write()
                .expect("cleaned_keys lock poisoned");
            cleaned.insert(key.clone());
        }

        self.cache.invalidate(&key);

        let spill_path = self.spill_file_path(connection_id, tab_id);
        let _ = fs::remove_file(&spill_path);

        self.remove_from_lru(&key);
        self.remove_last_touched(&key);
        {
            let mut kk = self.known_keys.write().expect("known_keys lock poisoned");
            kk.remove(&key);
        }
        {
            let mut gens = self.generations.write().expect("generations lock poisoned");
            gens.remove(&key);
        }
        {
            let mut spillable = self
                .spillable_removals
                .write()
                .expect("spillable_removals lock poisoned");
            spillable.retain(|&(ref c, ref t, _)| !(c == &key.0 && t == &key.1));
        }
    }

    /// Update the TTL used for future cache interactions.
    pub fn set_ttl(&self, seconds: u64) {
        self.ttl_secs.store(seconds, Ordering::Relaxed);
    }

    /// Current TTL in seconds (for testing).
    pub fn ttl_seconds(&self) -> u64 {
        self.ttl_secs.load(Ordering::Relaxed)
    }

    /// Session UUID generated at construction.
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Base spill directory path.
    pub fn spill_dir(&self) -> &PathBuf {
        &self.spill_dir
    }

    /// Run pending moka maintenance tasks (forces lazy eviction).
    pub fn run_pending_tasks(&self) {
        self.cache.run_pending_tasks();
    }

    /// Block until spill writes already queued by the listener are completed.
    pub fn flush_spill_jobs(&self) {
        let (ack_tx, ack_rx) = mpsc::channel();
        if self
            .spill_worker_tx
            .send(SpillWorkerMessage::Flush(ack_tx))
            .is_err()
        {
            return;
        }

        let _ = ack_rx.recv();
    }

    /// Current number of entries in the cache.
    pub fn entry_count(&self) -> u64 {
        self.cache.entry_count()
    }

    /// Snapshot of the LRU order (front = least recently used).
    pub fn lru_snapshot(&self) -> Vec<(String, String)> {
        let lru = self.lru_order.read().expect("lru_order lock poisoned");
        lru.iter().cloned().collect()
    }

    /// Run cache maintenance and RAM-pressure eviction.
    pub fn run_maintenance(&self, snapshot: &mut dyn MemorySnapshot) {
        self.cache.run_pending_tasks();

        let total = snapshot.total_bytes();
        let threshold = std::cmp::min(4_294_967_296_u64, total * 10 / 100);
        const MAX_PASSES: usize = 5;
        const EVICTION_BATCH_SIZE: usize = 3;
        const SETTLE_DELAY_MS: u64 = 100;

        for pass in 0..MAX_PASSES {
            snapshot.refresh();
            let available = snapshot.available_bytes();
            if available >= threshold {
                break;
            }

            tracing::info!(
                available_mb = available / (1024 * 1024),
                threshold_mb = threshold / (1024 * 1024),
                "RAM pressure detected, evicting LRU entries"
            );

            let keys_to_evict: Vec<(String, String)> = {
                let lru = self.lru_order.read().expect("lru_order lock poisoned");
                let last_touched = self
                    .last_touched_at
                    .read()
                    .expect("last_touched_at lock poisoned");
                let now = Instant::now();
                lru.iter()
                    .filter(|key| {
                        last_touched
                            .get(*key)
                            .map(|touched_at| {
                                now.saturating_duration_since(*touched_at)
                                    >= self.ram_pressure_min_idle
                            })
                            .unwrap_or(false)
                    })
                    .take(EVICTION_BATCH_SIZE)
                    .cloned()
                    .collect()
            };

            if keys_to_evict.is_empty() {
                tracing::debug!(
                    min_idle_secs = self.ram_pressure_min_idle.as_secs(),
                    "RAM pressure detected, but no cache entries are idle enough to spill"
                );
                break;
            }

            for key in &keys_to_evict {
                let generation = {
                    let gens = self.generations.read().expect("generations lock poisoned");
                    gens.get(key).copied()
                };

                if let Some(g) = generation {
                    {
                        let mut spillable = self
                            .spillable_removals
                            .write()
                            .expect("spillable_removals lock poisoned");
                        spillable.insert((key.0.clone(), key.1.clone(), g));
                    }

                    tracing::info!(
                        connection_id = %key.0,
                        tab_id = %key.1,
                        generation = g,
                        "evicting entry due to RAM pressure"
                    );

                    self.cache.invalidate(key);
                    self.remove_from_lru(key);
                }
            }

            self.cache.run_pending_tasks();

            if pass + 1 < MAX_PASSES {
                std::thread::sleep(Duration::from_millis(SETTLE_DELAY_MS));
            }
        }
    }

    /// Compute the spill file path for a given key.
    pub fn spill_file_path(&self, connection_id: &str, tab_id: &str) -> PathBuf {
        let safe_name = safe_spill_filename(connection_id, tab_id);
        self.spill_dir
            .join(&self.session_id)
            .join(format!("{safe_name}.msgpack"))
    }

    fn touch_lru(&self, key: &(String, String)) {
        let mut lru = self.lru_order.write().expect("lru_order lock poisoned");
        lru.retain(|k| k != key);
        lru.push_back(key.clone());
        drop(lru);

        let mut last_touched = self
            .last_touched_at
            .write()
            .expect("last_touched_at lock poisoned");
        last_touched.insert(key.clone(), Instant::now());
    }

    fn remove_from_lru(&self, key: &(String, String)) {
        let mut lru = self.lru_order.write().expect("lru_order lock poisoned");
        lru.retain(|k| k != key);
    }

    fn remove_last_touched(&self, key: &(String, String)) {
        let mut last_touched = self
            .last_touched_at
            .write()
            .expect("last_touched_at lock poisoned");
        last_touched.remove(key);
    }
}

impl<V> Drop for GenericCache<V>
where
    V: Clone + Send + Sync + Serialize + DeserializeOwned + std::fmt::Debug + 'static,
{
    fn drop(&mut self) {
        let _ = self.spill_worker_tx.send(SpillWorkerMessage::Shutdown);

        if let Some(handle) = self
            .spill_worker_handle
            .lock()
            .expect("spill_worker_handle lock poisoned")
            .take()
        {
            let _ = handle.join();
        }

        let session_dir = self.spill_dir.join(&self.session_id);
        if let Err(e) = fs::remove_dir_all(&session_dir) {
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(
                    error = %e,
                    path = %session_dir.display(),
                    "failed to clean up spill directory on shutdown"
                );
            }
        }
    }
}

/// Result-set-specific cache operations that need to reach into the
/// `Vec<StoredResult>` value (the generic `GenericCache<V>` impl cannot index
/// into an opaque `V`).
impl GenericCache<Vec<StoredResult>> {
    /// Swap the `rows` Arc of a single result slot in place, only when the
    /// invalidation version still matches `expected_invalidation_version`. The
    /// version check is best-effort: it is not atomic with the moka mutation, so
    /// a narrow race remains (same shape as
    /// [`GenericCache::insert_if_current`]).
    ///
    /// Unlike [`GenericCache::insert_if_current`], this updates in place: it does
    /// **not** bump the generation, remove spill files, or churn LRU
    /// bookkeeping. Only `value[idx].rows` changes. `Arc::make_mut` avoids
    /// cloning the underlying `Vec<StoredResult>` only when the entry Arc is
    /// uniquely held (best-effort); if another reader still holds it, the vec is
    /// cloned. In the common case it mutates the cached entry directly with no
    /// sibling-`columns` clone.
    ///
    /// Returns `true` if the swap was applied, `false` if the version no longer
    /// matched (a query was re-run / invalidated during the sort) or the entry /
    /// slot was gone.
    pub fn update_rows_in_place_if_current(
        &self,
        connection_id: &str,
        tab_id: &str,
        expected_invalidation_version: u64,
        idx: usize,
        new_rows: Arc<Vec<Vec<serde_json::Value>>>,
    ) -> bool {
        let key = (connection_id.to_string(), tab_id.to_string());

        if self.current_invalidation_version(connection_id, tab_id) != expected_invalidation_version
        {
            tracing::debug!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                expected_invalidation_version,
                "in-place rows update skipped: invalidation version changed"
            );
            return false;
        }

        let Some(mut entry) = self.cache.get(&key) else {
            tracing::debug!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                "in-place rows update skipped: entry no longer cached"
            );
            return false;
        };

        let cached = Arc::make_mut(&mut entry);
        let Some(slot) = cached.value.get_mut(idx) else {
            tracing::warn!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                idx,
                "in-place rows update skipped: result slot index out of range"
            );
            return false;
        };

        slot.rows = new_rows;
        self.cache.insert(key, entry);
        true
    }
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
