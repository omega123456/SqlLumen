use super::*;

impl<V> GenericCache<V>
where
    V: Clone + Send + Sync + Serialize + DeserializeOwned + std::fmt::Debug + 'static,
{
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
        if !spill_path.exists() {
            tracing::debug!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                path = %spill_path.display(),
                "cache spill restore missed: spill file not found"
            );
            return CacheGet::Expired;
        }
        tracing::debug!(
            connection_id = %connection_id,
            tab_id = %tab_id,
            path = %spill_path.display(),
            "cache attempting spill restore"
        );
        match self.restore_from_spill(key, &spill_path) {
            Some(entry) => CacheGet::ReWarmed(entry),
            None => CacheGet::Expired,
        }
    }

    pub(super) fn read_spill_file(spill_path: &std::path::Path) -> Option<SpillContents<V>> {
        let bytes = fs::read(spill_path)
            .inspect_err(|error| {
                tracing::warn!(error = %error, path = %spill_path.display(), "failed to read spill file");
            })
            .ok()?;
        let value = rmp_serde::from_slice::<V>(&bytes)
            .inspect_err(|error| {
                tracing::warn!(error = %error, path = %spill_path.display(), "failed to deserialize spill file");
            })
            .ok()?;
        Some(SpillContents {
            value,
            byte_count: bytes.len(),
        })
    }

    pub(super) fn restore_from_spill(
        &self,
        key: CacheMapKey,
        spill_path: &std::path::Path,
    ) -> Option<Arc<CachedEntry<V>>> {
        let SpillContents {
            value,
            byte_count: spill_bytes,
        } = Self::read_spill_file(spill_path)?;
        let _ = fs::remove_file(spill_path);

        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        let entry = Arc::new(CachedEntry { value, generation });
        self.cache.insert(key.clone(), Arc::clone(&entry));
        self.touch_lru(&key);
        let (connection_id, tab_id) = key.clone();
        {
            let mut gens = self.generations.write().expect("generations lock poisoned");
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
        Some(entry)
    }

    pub fn insert(&self, key: CacheKey<'_>, value: V) {
        let expected_invalidation_version =
            self.current_invalidation_version(key.connection_id, key.tab_id);
        let write = VersionedValue {
            expected_invalidation_version,
            value,
        };
        let _ = self.insert_if_current(key, write);
    }

    pub fn current_invalidation_version(&self, connection_id: &str, tab_id: &str) -> u64 {
        let key = (connection_id.to_string(), tab_id.to_string());
        let versions = self
            .invalidation_versions
            .read()
            .expect("invalidation_versions lock poisoned");
        versions.get(&key).copied().unwrap_or(0)
    }

    pub fn insert_if_current(&self, cache_key: CacheKey<'_>, write: VersionedValue<V>) -> bool {
        let CacheKey {
            connection_id,
            tab_id,
        } = cache_key;
        let VersionedValue {
            expected_invalidation_version,
            value,
        } = write;
        let key = (connection_id.to_string(), tab_id.to_string());
        let current_invalidation_version = self.current_invalidation_version(connection_id, tab_id);
        if current_invalidation_version != expected_invalidation_version {
            return false;
        }

        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);

        let spill_path = self.spill_file_path(connection_id, tab_id);
        let _ = fs::remove_file(&spill_path);

        self.forget_spill_markers(&key);

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

    pub fn remove(&self, connection_id: &str, tab_id: &str) {
        let key = (connection_id.to_string(), tab_id.to_string());
        self.cache.invalidate(&key);
        self.remove_from_lru(&key);
        self.remove_last_touched(&key);
    }

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
        self.forget_spill_markers(&key);
    }

    pub fn set_ttl(&self, seconds: u64) {
        self.ttl_secs.store(seconds, Ordering::Relaxed);
    }

    pub fn ttl_seconds(&self) -> u64 {
        self.ttl_secs.load(Ordering::Relaxed)
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn spill_dir(&self) -> &PathBuf {
        &self.spill_dir
    }

    pub fn run_pending_tasks(&self) {
        self.cache.run_pending_tasks();
    }

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

    pub fn entry_count(&self) -> u64 {
        self.cache.entry_count()
    }

    pub fn lru_snapshot(&self) -> Vec<(String, String)> {
        let lru = self.lru_order.read().expect("lru_order lock poisoned");
        lru.iter().cloned().collect()
    }
}
