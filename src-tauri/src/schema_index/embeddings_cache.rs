//! Simple LRU cache for embedding vectors, keyed by `(model_id, text)`.
//!
//! Used by `semantic_search_impl` to avoid re-embedding identical query strings.
//! The build path bypasses this cache entirely.

use std::collections::HashMap;
use std::sync::Mutex;

/// Default capacity of the embedding cache.
const DEFAULT_CAPACITY: usize = 256;

/// A simple LRU-like cache for embedding vectors.
///
/// Uses a `HashMap` with a counter-based eviction: when the cache is full, the
/// entry with the smallest `last_used` counter is evicted. This is O(n) for
/// eviction but the cache is small (256 entries) so it's fine.
pub struct EmbeddingCache {
    inner: Mutex<CacheInner>,
}

struct CacheEntry {
    vec: Vec<f32>,
    last_used: u64,
}

struct CacheInner {
    map: HashMap<(String, String), CacheEntry>,
    counter: u64,
    capacity: usize,
}

impl EmbeddingCache {
    /// Create a new embedding cache with the default capacity (256).
    pub fn new() -> Self {
        Self::with_capacity(DEFAULT_CAPACITY)
    }

    /// Create a new embedding cache with the given capacity.
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            inner: Mutex::new(CacheInner {
                map: HashMap::new(),
                counter: 0,
                capacity,
            }),
        }
    }

    /// Look up a cached embedding vector.
    pub fn get(&self, model_id: &str, text: &str) -> Option<Vec<f32>> {
        let mut inner = self.inner.lock().ok()?;
        inner.counter += 1;
        let counter = inner.counter;
        if let Some(entry) = inner.map.get_mut(&(model_id.to_string(), text.to_string())) {
            entry.last_used = counter;
            Some(entry.vec.clone())
        } else {
            None
        }
    }

    /// Insert an embedding vector into the cache, evicting the LRU entry if full.
    pub fn insert(&self, model_id: &str, text: &str, vec: Vec<f32>) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        inner.counter += 1;
        let counter = inner.counter;

        let key = (model_id.to_string(), text.to_string());
        if inner.map.contains_key(&key) {
            inner.map.get_mut(&key).unwrap().vec = vec;
            inner.map.get_mut(&key).unwrap().last_used = counter;
            return;
        }

        if inner.map.len() >= inner.capacity {
            // Evict LRU entry
            let lru_key = inner
                .map
                .iter()
                .min_by_key(|(_, e)| e.last_used)
                .map(|(k, _)| k.clone());
            if let Some(k) = lru_key {
                inner.map.remove(&k);
            }
        }

        inner.map.insert(
            key,
            CacheEntry {
                vec,
                last_used: counter,
            },
        );
    }
}
