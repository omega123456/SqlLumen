use super::*;

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
        let Err(error) = fs::remove_dir_all(&session_dir) else {
            return;
        };
        if crate::is_not_found_error(&error) {
            return;
        }
        tracing::warn!(
            error = %error,
            path = %session_dir.display(),
            "failed to clean up spill directory on shutdown"
        );
    }
}

impl GenericCache<Vec<StoredResult>> {
    pub fn row_ceiling(&self) -> usize {
        self.row_ceiling.load(Ordering::Relaxed)
    }

    pub fn set_row_ceiling(&self, rows: usize) {
        self.row_ceiling.store(rows, Ordering::Relaxed);
    }

    pub fn modify_slot_in_place_if_current<T, F>(
        &self,
        target: &SlotWriteTarget<'_>,
        operation: F,
    ) -> Result<SlotWrite<T>, String>
    where
        F: FnOnce(&mut StoredResult) -> Result<T, String>,
    {
        let SlotWriteTarget {
            connection_id,
            tab_id,
            expected_invalidation_version,
            index,
            expected_query_id,
            base_view_version,
        } = *target;
        let key = (connection_id.to_string(), tab_id.to_string());
        let _write_guard = self
            .in_place_write_lock
            .lock()
            .expect("in_place_write_lock poisoned");

        let current_invalidation_version = self.current_invalidation_version(connection_id, tab_id);
        if current_invalidation_version != expected_invalidation_version {
            tracing::debug!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                expected_invalidation_version,
                "in-place slot update skipped: invalidation version changed"
            );
            return Ok(SlotWrite::Invalidated);
        }

        let Some(mut entry) = self.cache.get(&key) else {
            tracing::debug!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                "in-place slot update skipped: entry no longer cached"
            );
            return Ok(SlotWrite::Invalidated);
        };

        let Some(slot) = entry.value.get(index) else {
            tracing::warn!(
                connection_id = %connection_id,
                tab_id = %tab_id,
                index,
                "in-place slot update skipped: result slot index out of range"
            );
            return Ok(SlotWrite::Invalidated);
        };
        if expected_query_id.is_some_and(|qid| qid != slot.query_id) {
            return Ok(SlotWrite::QueryIdMismatch);
        }
        let is_view_superseded = base_view_version.is_some_and(|base| slot.view_version != base);
        if is_view_superseded {
            return Ok(SlotWrite::ViewSuperseded {
                current: slot.view_version,
            });
        }

        let mut next = slot.clone();
        let output = operation(&mut next)?;
        Arc::make_mut(&mut entry).value[index] = next;
        self.cache.insert(key, entry);
        Ok(SlotWrite::Applied(output))
    }
}
