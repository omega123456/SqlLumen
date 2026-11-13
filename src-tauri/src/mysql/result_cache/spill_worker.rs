use super::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum SpillAttempt {
    DirectoryUnavailable,
    Attempted,
}

pub(super) struct SpillWorker {
    pub(super) spill_dir: PathBuf,
    pub(super) session_id: String,
    pub(super) spillable_removals: SharedSpillMarkers,
    pub(super) generations: SharedGenerations,
}

impl SpillWorker {
    pub(super) fn is_spillable(&self, marker: &SpillMarker) -> bool {
        let spillable = self
            .spillable_removals
            .read()
            .expect("spillable_removals lock poisoned");
        spillable.contains(marker)
    }

    pub(super) fn forget_marker(&self, marker: &SpillMarker) {
        let mut spillable = self
            .spillable_removals
            .write()
            .expect("spillable_removals lock poisoned");
        spillable.remove(marker);
    }

    pub(super) fn current_generation(&self, key: &CacheMapKey) -> Option<u64> {
        let generations = self.generations.read().expect("generations lock poisoned");
        generations.get(key).copied()
    }

    pub(super) fn write_spill_file<V: Serialize>(&self, job: &SpillWriteJob<V>) -> SpillAttempt {
        let session_dir = self.spill_dir.join(&self.session_id);
        if let Err(error) = fs::create_dir_all(&session_dir) {
            tracing::warn!(
                error = %error,
                connection_id = %job.connection_id,
                tab_id = %job.tab_id,
                generation = job.generation,
                "failed to create spill directory"
            );
            return SpillAttempt::DirectoryUnavailable;
        }

        let safe_name = safe_spill_filename(&job.connection_id, &job.tab_id);
        let path = session_dir.join(format!("{safe_name}.{SPILL_FILE_EXTENSION}"));
        let bytes = match rmp_serde::to_vec_named(&job.entry.value) {
            Ok(bytes) => bytes,
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    connection_id = %job.connection_id,
                    tab_id = %job.tab_id,
                    generation = job.generation,
                    "failed to serialize value for spill"
                );
                return SpillAttempt::Attempted;
            }
        };
        match fs::write(&path, &bytes) {
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    path = %path.display(),
                    "failed to write spill file"
                );
            }
            Ok(()) => {
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
        SpillAttempt::Attempted
    }

    pub(super) fn process<V: Serialize>(&self, job: SpillWriteJob<V>) {
        let marker = job.marker();
        if !self.is_spillable(&marker) {
            tracing::debug!(
                connection_id = %job.connection_id,
                tab_id = %job.tab_id,
                generation = job.generation,
                "cache spill write skipped: no longer spillable"
            );
            return;
        }

        let current_generation = self.current_generation(&job.key());
        if current_generation != Some(job.generation) {
            tracing::debug!(
                connection_id = %job.connection_id,
                tab_id = %job.tab_id,
                generation = job.generation,
                current_generation = ?current_generation,
                "cache spill write skipped: stale generation"
            );
            self.forget_marker(&marker);
            return;
        }

        if self.write_spill_file(&job) == SpillAttempt::DirectoryUnavailable {
            return;
        }
        self.forget_marker(&marker);
    }
}

pub(super) fn acknowledge_flush(ack: Sender<()>) {
    let _ = ack.send(());
}

pub(super) fn run_spill_worker<V: Serialize>(
    worker: SpillWorker,
    receiver: mpsc::Receiver<SpillWorkerMessage<V>>,
) {
    while let Ok(message) = receiver.recv() {
        match message {
            SpillWorkerMessage::Write(job) => worker.process(job),
            SpillWorkerMessage::Flush(ack) => acknowledge_flush(ack),
            SpillWorkerMessage::Shutdown => break,
        }
    }
}

pub(super) struct SpillContents<V> {
    pub(super) value: V,
    pub(super) byte_count: usize,
}

pub(super) struct Eviction<V> {
    pub(super) key: Arc<CacheMapKey>,
    pub(super) entry: Arc<CachedEntry<V>>,
    pub(super) cause: RemovalCause,
}

pub(super) struct SpillEvictionListener<V> {
    pub(super) cleaned_keys: Arc<RwLock<HashSet<CacheMapKey>>>,
    pub(super) spillable_removals: SharedSpillMarkers,
    pub(super) sender: Sender<SpillWorkerMessage<V>>,
}

impl<V> SpillEvictionListener<V> {
    pub(super) fn is_cleaned(&self, key: &CacheMapKey) -> bool {
        let cleaned = self
            .cleaned_keys
            .read()
            .expect("cleaned_keys lock poisoned");
        cleaned.contains(key)
    }

    pub(super) fn should_spill(&self, cause: RemovalCause, marker: &SpillMarker) -> bool {
        match cause {
            RemovalCause::Expired | RemovalCause::Size => {
                let mut spillable = self
                    .spillable_removals
                    .write()
                    .expect("spillable_removals lock poisoned");
                spillable.insert(marker.clone());
                true
            }
            RemovalCause::Explicit => {
                let spillable = self
                    .spillable_removals
                    .read()
                    .expect("spillable_removals lock poisoned");
                spillable.contains(marker)
            }
            RemovalCause::Replaced => false,
        }
    }

    pub(super) fn on_eviction(&self, eviction: Eviction<V>) {
        let Eviction { key, entry, cause } = eviction;
        let key = key.as_ref();
        let generation = entry.generation;
        if self.is_cleaned(key) {
            return;
        }
        let marker = (key.0.clone(), key.1.clone(), generation);
        if !self.should_spill(cause, &marker) {
            return;
        }

        let job = SpillWriteJob {
            connection_id: key.0.clone(),
            tab_id: key.1.clone(),
            generation,
            entry,
        };
        if let Err(error) = self.sender.send(SpillWorkerMessage::Write(job)) {
            let mut spillable = self
                .spillable_removals
                .write()
                .expect("spillable_removals lock poisoned");
            spillable.remove(&marker);
            tracing::warn!(
                error = %error,
                key = ?key,
                generation,
                "failed to enqueue spill write job"
            );
            return;
        }
        tracing::debug!(
            connection_id = %key.0,
            tab_id = %key.1,
            generation,
            cause = %removal_cause_label(cause),
            "cache eviction: enqueueing spill write"
        );
    }
}

pub(super) fn settle_before_next_pass(passes_run: usize) {
    let has_another_pass = passes_run < RAM_PRESSURE_MAX_PASSES;
    if has_another_pass {
        std::thread::sleep(RAM_PRESSURE_SETTLE_DELAY);
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum PressurePass {
    Relieved,
    NothingIdle,
    Evicted,
}
