use super::*;

/// Custom moka `Expiry` that reads the current TTL from a shared atomic.
/// Returns the same duration for create, read, and update so every
/// interaction resets the idle timer to the latest configured value.
pub(super) struct DynamicTtlExpiry {
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

    pub(super) fn new_with_shared_ttl_and_ram_pressure_idle(
        ttl: Arc<AtomicU64>,
        spill_dir: PathBuf,
        ram_pressure_min_idle: Duration,
    ) -> Self {
        let session_id = uuid::Uuid::new_v4().to_string();
        let spillable_removals: SharedSpillMarkers = Arc::new(RwLock::new(HashSet::new()));
        let invalidation_versions = Arc::new(RwLock::new(HashMap::new()));
        let cleaned_keys: Arc<RwLock<HashSet<CacheMapKey>>> = Arc::new(RwLock::new(HashSet::new()));
        let generations: SharedGenerations = Arc::new(RwLock::new(HashMap::new()));

        let (spill_worker_tx, spill_worker_rx) = mpsc::channel::<SpillWorkerMessage<V>>();
        let worker = SpillWorker {
            spill_dir: spill_dir.clone(),
            session_id: session_id.clone(),
            spillable_removals: Arc::clone(&spillable_removals),
            generations: Arc::clone(&generations),
        };
        let spill_worker_handle =
            std::thread::spawn(move || run_spill_worker(worker, spill_worker_rx));

        let listener = SpillEvictionListener {
            cleaned_keys: Arc::clone(&cleaned_keys),
            spillable_removals: Arc::clone(&spillable_removals),
            sender: spill_worker_tx.clone(),
        };
        let ttl_secs = Arc::clone(&ttl);
        let cache = Cache::builder()
            .max_capacity(MAX_CACHE_ENTRIES)
            .expire_after(DynamicTtlExpiry {
                ttl_secs: Arc::clone(&ttl),
            })
            .eviction_listener(move |key, entry, cause| {
                listener.on_eviction(Eviction { key, entry, cause })
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
            in_place_write_lock: Mutex::new(()),
            row_ceiling: Arc::new(AtomicUsize::new(DEFAULT_ROW_CEILING)),
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
}
