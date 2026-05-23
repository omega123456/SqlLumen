//! In-memory result cache backed by moka with time-to-idle eviction,
//! disk spill on expiry, transparent re-warm, parallel LRU tracking
//! for RAM-pressure eviction, and a pluggable memory snapshot source.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use moka::notification::RemovalCause;
use moka::sync::Cache;
use moka::Expiry;
use sha2::{Digest, Sha256};

use super::query_executor::StoredResult;

/// Wrapper stored in the moka cache. Holds the result rows plus a
/// monotonically increasing generation token used for stale-listener
/// protection.
#[derive(Debug, Clone)]
pub struct CachedResultEntry {
    pub rows: Vec<StoredResult>,
    pub generation: u64,
}

struct SpillWriteJob {
    connection_id: String,
    tab_id: String,
    generation: u64,
    rows: Vec<StoredResult>,
}

enum SpillWorkerMessage {
    Write(SpillWriteJob),
    Flush(Sender<()>),
    Shutdown,
}

/// Result of a `ResultCache::get()` call.
#[derive(Debug)]
pub enum ResultCacheGet {
    /// Entry was found in the in-memory cache.
    Found(Arc<CachedResultEntry>),
    /// Entry was re-warmed from a spill file on disk.
    ReWarmed(Arc<CachedResultEntry>),
    /// Key was never stored in this session.
    NeverStored,
    /// Key was previously stored but is no longer available (neither in
    /// cache nor on disk).
    Expired,
}

impl ResultCacheGet {
    /// Convenience: extract the entry if `Found` or `ReWarmed`, else `None`.
    pub fn into_entry(self) -> Option<Arc<CachedResultEntry>> {
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
    fn available_bytes(&self) -> u64 {
        self.sys.available_memory()
    }

    fn total_bytes(&self) -> u64 {
        self.sys.total_memory()
    }
}

/// Custom moka `Expiry` that reads the current TTL from a shared atomic.
/// Returns the same duration for create, read, and update so every
/// interaction resets the idle timer to the latest configured value.
struct DynamicTtlExpiry {
    ttl_secs: Arc<AtomicU64>,
}

impl Expiry<(String, String), Arc<CachedResultEntry>> for DynamicTtlExpiry {
    fn expire_after_create(
        &self,
        _key: &(String, String),
        _value: &Arc<CachedResultEntry>,
        _current_time: std::time::Instant,
    ) -> Option<Duration> {
        Some(Duration::from_secs(self.ttl_secs.load(Ordering::Relaxed)))
    }

    fn expire_after_read(
        &self,
        _key: &(String, String),
        _value: &Arc<CachedResultEntry>,
        _current_time: std::time::Instant,
        _current_duration: Option<Duration>,
        _last_modified_at: std::time::Instant,
    ) -> Option<Duration> {
        Some(Duration::from_secs(self.ttl_secs.load(Ordering::Relaxed)))
    }

    fn expire_after_update(
        &self,
        _key: &(String, String),
        _value: &Arc<CachedResultEntry>,
        _current_time: std::time::Instant,
        _current_duration: Option<Duration>,
    ) -> Option<Duration> {
        Some(Duration::from_secs(self.ttl_secs.load(Ordering::Relaxed)))
    }
}

/// Thread-safe result cache with time-to-idle eviction, disk spill,
/// re-warm, and RAM-pressure eviction.
pub struct ResultCache {
    cache: Cache<(String, String), Arc<CachedResultEntry>>,
    spill_dir: PathBuf,
    session_id: String,
    ttl_secs: Arc<AtomicU64>,
    /// Parallel LRU order for RAM-pressure eviction (front = least recent).
    lru_order: RwLock<VecDeque<(String, String)>>,
    /// Next generation token (monotonically increasing per cache instance).
    next_generation: AtomicU64,
    /// Keys that have ever been inserted (to distinguish NeverStored vs Expired).
    known_keys: RwLock<HashSet<(String, String)>>,
    /// Current generation per key (for stale-listener protection).
    generations: Arc<RwLock<HashMap<(String, String), u64>>>,
    /// Keys+generations pre-approved for spill by RAM-pressure eviction.
    spillable_removals: Arc<RwLock<HashSet<(String, String, u64)>>>,
    /// Keys that have been explicitly cleaned up (tab close). The eviction
    /// listener must not write spill files for these keys.
    cleaned_keys: Arc<RwLock<HashSet<(String, String)>>>,
    spill_worker_tx: Sender<SpillWorkerMessage>,
    spill_worker_handle: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl ResultCache {
    /// Create a new `ResultCache`.
    ///
    /// - `ttl_seconds`: initial time-to-idle in seconds
    /// - `spill_dir`: base directory for spill files (created lazily)
    pub fn new(ttl_seconds: u64, spill_dir: PathBuf) -> Self {
        let ttl_secs = Arc::new(AtomicU64::new(ttl_seconds));
        let session_id = uuid::Uuid::new_v4().to_string();
        let spillable_removals: Arc<RwLock<HashSet<(String, String, u64)>>> =
            Arc::new(RwLock::new(HashSet::new()));
        let cleaned_keys: Arc<RwLock<HashSet<(String, String)>>> =
            Arc::new(RwLock::new(HashSet::new()));
        let generations = Arc::new(RwLock::new(HashMap::new()));

        let spill_dir_for_listener = spill_dir.clone();
        let session_id_for_listener = session_id.clone();
        let spillable_for_worker = Arc::clone(&spillable_removals);
        let spillable_for_listener = Arc::clone(&spillable_removals);
        let cleaned_for_listener = Arc::clone(&cleaned_keys);
        let generations_for_worker_thread = Arc::clone(&generations);
        let (spill_worker_tx, spill_worker_rx) = mpsc::channel::<SpillWorkerMessage>();
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
                                "result cache spill write skipped: no longer spillable"
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
                                "result cache spill write skipped: stale generation"
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

                        match rmp_serde::to_vec_named(&job.rows) {
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
                                        result_set_count = job.rows.len(),
                                        "result cache spill written to disk"
                                    );
                                }
                            }
                            Err(e) => {
                                tracing::warn!(
                                    error = %e,
                                    connection_id = %job.connection_id,
                                    tab_id = %job.tab_id,
                                    generation = job.generation,
                                    "failed to serialize result for spill"
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

        let cache = Cache::builder()
            .max_capacity(10_000)
            .expire_after(DynamicTtlExpiry {
                ttl_secs: Arc::clone(&ttl_secs),
            })
            .eviction_listener(move |key, value, cause| {
                let key: &(String, String) = &key;
                let entry: &Arc<CachedResultEntry> = &value;
                let generation = entry.generation;

                // Never spill for keys that have been explicitly cleaned up
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
                let result_set_count = entry.rows.len();
                let rows = entry.rows.clone();
                let send_result =
                    spill_worker_tx_for_listener.send(SpillWorkerMessage::Write(SpillWriteJob {
                        connection_id: key.0.clone(),
                        tab_id: key.1.clone(),
                        generation,
                        rows,
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
                        result_set_count,
                        "result cache eviction: enqueueing spill write"
                    );
                }
            })
            .build();

        Self {
            cache,
            spill_dir,
            session_id,
            ttl_secs,
            lru_order: RwLock::new(VecDeque::new()),
            next_generation: AtomicU64::new(1),
            known_keys: RwLock::new(HashSet::new()),
            generations,
            spillable_removals,
            cleaned_keys,
            spill_worker_tx,
            spill_worker_handle: Mutex::new(Some(spill_worker_handle)),
        }
    }

    /// Test constructor that accepts a pre-created temporary directory path.
    pub fn new_for_test(ttl_seconds: u64, spill_dir: PathBuf) -> Self {
        Self::new(ttl_seconds, spill_dir)
    }

    /// Retrieve a cached result by connection and tab ID.
    /// On cache miss, attempts to re-warm from a spill file.
    pub fn get(&self, connection_id: &str, tab_id: &str) -> ResultCacheGet {
        let key = (connection_id.to_string(), tab_id.to_string());

        // Try in-memory first
        if let Some(entry) = self.cache.get(&key) {
            self.touch_lru(&key);
            return ResultCacheGet::Found(entry);
        }

        // Check if key was ever stored
        let known = {
            let kk = self.known_keys.read().expect("known_keys lock poisoned");
            kk.contains(&key)
        };

        if !known {
            return ResultCacheGet::NeverStored;
        }

        // Try to re-warm from spill file
        let spill_path = self.spill_file_path(connection_id, tab_id);
        if spill_path.exists() {
            tracing::debug!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                path = %spill_path.display(),
                "result cache attempting spill restore"
            );
            match fs::read(&spill_path) {
                Ok(bytes) => match rmp_serde::from_slice::<Vec<StoredResult>>(&bytes) {
                    Ok(rows) => {
                        let spill_bytes = bytes.len();
                        let result_set_count = rows.len();

                        // Delete spill file after successful read
                        let _ = fs::remove_file(&spill_path);

                        // Re-insert with a fresh generation
                        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
                        let entry = Arc::new(CachedResultEntry { rows, generation });
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
                            result_set_count,
                            "result cache spill restored from disk"
                        );
                        return ResultCacheGet::ReWarmed(entry);
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
                "result cache spill restore missed: spill file not found"
            );
        }

        ResultCacheGet::Expired
    }

    /// Insert or replace results for a connection/tab pair.
    pub fn insert(&self, connection_id: &str, tab_id: &str, results: Vec<StoredResult>) {
        let key = (connection_id.to_string(), tab_id.to_string());
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);

        // Clean up stale spill file for this key
        let spill_path = self.spill_file_path(connection_id, tab_id);
        let _ = fs::remove_file(&spill_path);

        // Clear old spill-permission markers for this key (any generation)
        {
            let mut spillable = self
                .spillable_removals
                .write()
                .expect("spillable_removals lock poisoned");
            spillable.retain(|&(ref c, ref t, _)| !(c == &key.0 && t == &key.1));
        }

        // Remove from cleaned_keys since we're inserting fresh data
        {
            let mut cleaned = self
                .cleaned_keys
                .write()
                .expect("cleaned_keys lock poisoned");
            cleaned.remove(&key);
        }

        let entry = Arc::new(CachedResultEntry {
            rows: results,
            generation,
        });
        self.cache.insert(key.clone(), entry);

        // Track in known_keys, generations, and LRU
        {
            let mut kk = self.known_keys.write().expect("known_keys lock poisoned");
            kk.insert(key.clone());
        }
        {
            let mut gens = self.generations.write().expect("generations lock poisoned");
            gens.insert(key.clone(), generation);
        }
        self.touch_lru(&key);
    }

    /// Remove (invalidate) a cached result without spill cleanup.
    /// Kept for backward compatibility; prefer `remove_with_spill_cleanup`
    /// for tab-close paths.
    pub fn remove(&self, connection_id: &str, tab_id: &str) {
        let key = (connection_id.to_string(), tab_id.to_string());
        self.cache.invalidate(&key);
        self.remove_from_lru(&key);
    }

    /// Remove a cached result AND clean up any associated spill file,
    /// known_keys entry, generation record, and spill-permission markers.
    /// Also marks the key as cleaned so the async eviction listener cannot
    /// recreate the spill file.
    pub fn remove_with_spill_cleanup(&self, connection_id: &str, tab_id: &str) {
        let key = (connection_id.to_string(), tab_id.to_string());

        // Mark as cleaned BEFORE invalidation so the listener sees it
        {
            let mut cleaned = self
                .cleaned_keys
                .write()
                .expect("cleaned_keys lock poisoned");
            cleaned.insert(key.clone());
        }

        self.cache.invalidate(&key);

        // Delete spill file
        let spill_path = self.spill_file_path(connection_id, tab_id);
        let _ = fs::remove_file(&spill_path);

        // Remove from all tracking structures
        self.remove_from_lru(&key);
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
    ///
    /// - Runs pending moka tasks first.
    /// - Reads the memory snapshot and compares against threshold.
    /// - Evicts up to 3 LRU entries per pass, up to 5 passes per cycle.
    /// - Re-samples memory after each pass and stops as soon as memory recovers.
    /// - Sleeps briefly between passes so the OS/runtime can settle.
    pub fn run_maintenance(&self, snapshot: &dyn MemorySnapshot) {
        self.cache.run_pending_tasks();

        let total = snapshot.total_bytes();
        let threshold = std::cmp::min(4_294_967_296_u64, total * 10 / 100);
        const MAX_PASSES: usize = 5;
        const EVICTION_BATCH_SIZE: usize = 3;
        const SETTLE_DELAY_MS: u64 = 100;

        for pass in 0..MAX_PASSES {
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
                lru.iter().take(EVICTION_BATCH_SIZE).cloned().collect()
            };

            if keys_to_evict.is_empty() {
                break;
            }

            for key in &keys_to_evict {
                // Get current generation for this key to mark as spillable
                let gen = {
                    let gens = self.generations.read().expect("generations lock poisoned");
                    gens.get(key).copied()
                };

                if let Some(g) = gen {
                    // Pre-mark as spillable so eviction listener writes spill file
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

            // Run pending tasks so the eviction listener fires
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

    // ── LRU helpers ──────────────────────────────────────────────────────

    /// Move `key` to the back (most recently used) of the LRU deque,
    /// removing any prior occurrence.
    fn touch_lru(&self, key: &(String, String)) {
        let mut lru = self.lru_order.write().expect("lru_order lock poisoned");
        lru.retain(|k| k != key);
        lru.push_back(key.clone());
    }

    /// Remove `key` from the LRU deque entirely.
    fn remove_from_lru(&self, key: &(String, String)) {
        let mut lru = self.lru_order.write().expect("lru_order lock poisoned");
        lru.retain(|k| k != key);
    }
}

impl Drop for ResultCache {
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
