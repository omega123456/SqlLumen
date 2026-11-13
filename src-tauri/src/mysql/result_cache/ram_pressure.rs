use super::*;

impl<V> GenericCache<V>
where
    V: Clone + Send + Sync + Serialize + DeserializeOwned + std::fmt::Debug + 'static,
{
    pub(super) fn has_idled_past_minimum(&self, touched_at: Instant, now: Instant) -> bool {
        now.saturating_duration_since(touched_at) >= self.ram_pressure_min_idle
    }

    /// Run cache maintenance and RAM-pressure eviction.
    pub fn run_maintenance(&self, snapshot: &mut dyn MemorySnapshot) {
        self.cache.run_pending_tasks();

        let threshold = std::cmp::min(
            RAM_PRESSURE_MAX_THRESHOLD_BYTES,
            snapshot.total_bytes() * RAM_PRESSURE_THRESHOLD_PERCENT / PERCENT,
        );
        let mut passes_run = 0;
        while passes_run < RAM_PRESSURE_MAX_PASSES
            && self.run_pressure_pass(snapshot, threshold) == PressurePass::Evicted
        {
            passes_run += 1;
            settle_before_next_pass(passes_run);
        }
    }

    pub(super) fn run_pressure_pass(
        &self,
        snapshot: &mut dyn MemorySnapshot,
        threshold: u64,
    ) -> PressurePass {
        snapshot.refresh();
        let available = snapshot.available_bytes();
        if available >= threshold {
            return PressurePass::Relieved;
        }

        tracing::info!(
            available_mb = available / BYTES_PER_MEBIBYTE,
            threshold_mb = threshold / BYTES_PER_MEBIBYTE,
            "RAM pressure detected, evicting LRU entries"
        );
        let keys_to_evict = self.idle_lru_keys();
        if keys_to_evict.is_empty() {
            tracing::debug!(
                min_idle_secs = self.ram_pressure_min_idle.as_secs(),
                "RAM pressure detected, but no cache entries are idle enough to spill"
            );
            return PressurePass::NothingIdle;
        }

        for key in &keys_to_evict {
            self.evict_for_ram_pressure(key);
        }
        self.cache.run_pending_tasks();
        PressurePass::Evicted
    }

    pub(super) fn idle_lru_keys(&self) -> Vec<CacheMapKey> {
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
                    .is_some_and(|touched_at| self.has_idled_past_minimum(*touched_at, now))
            })
            .take(RAM_PRESSURE_EVICTION_BATCH_SIZE)
            .cloned()
            .collect()
    }

    pub(super) fn evict_for_ram_pressure(&self, key: &CacheMapKey) {
        let generation = {
            let gens = self.generations.read().expect("generations lock poisoned");
            gens.get(key).copied()
        };
        let Some(expected_generation) = generation else {
            return;
        };
        {
            let mut spillable = self
                .spillable_removals
                .write()
                .expect("spillable_removals lock poisoned");
            spillable.insert((key.0.clone(), key.1.clone(), expected_generation));
        }
        tracing::info!(
            connection_id = %key.0,
            tab_id = %key.1,
            generation = expected_generation,
            "evicting entry due to RAM pressure"
        );
        self.cache.invalidate(key);
        self.remove_from_lru(key);
    }

    /// Compute the spill file path for a given key.
    pub fn spill_file_path(&self, connection_id: &str, tab_id: &str) -> PathBuf {
        let safe_name = safe_spill_filename(connection_id, tab_id);
        self.spill_dir
            .join(&self.session_id)
            .join(format!("{safe_name}.{SPILL_FILE_EXTENSION}"))
    }

    pub(super) fn forget_spill_markers(&self, key: &CacheMapKey) {
        let mut spillable = self
            .spillable_removals
            .write()
            .expect("spillable_removals lock poisoned");
        spillable.retain(|(connection_id, tab_id, _)| (connection_id, tab_id) != (&key.0, &key.1));
    }

    pub(super) fn touch_lru(&self, key: &(String, String)) {
        let mut lru = self.lru_order.write().expect("lru_order lock poisoned");
        lru.retain(|existing| existing != key);
        lru.push_back(key.clone());
        drop(lru);

        let mut last_touched = self
            .last_touched_at
            .write()
            .expect("last_touched_at lock poisoned");
        last_touched.insert(key.clone(), Instant::now());
    }

    pub(super) fn remove_from_lru(&self, key: &(String, String)) {
        let mut lru = self.lru_order.write().expect("lru_order lock poisoned");
        lru.retain(|existing| existing != key);
    }

    pub(super) fn remove_last_touched(&self, key: &(String, String)) {
        let mut last_touched = self
            .last_touched_at
            .write()
            .expect("last_touched_at lock poisoned");
        last_touched.remove(key);
    }
}
