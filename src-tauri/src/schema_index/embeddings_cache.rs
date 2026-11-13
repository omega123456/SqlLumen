//! Simple LRU cache for embedding vectors, keyed by `(model_id, text)`.
//!
//! Used by `semantic_search_impl` to avoid re-embedding identical query strings.
//! The build path bypasses this cache entirely.

use std::collections::HashMap;
use std::sync::Mutex;

/// Default capacity of the embedding cache.
const DEFAULT_CAPACITY: usize = 256;

#[derive(Debug, Clone, Copy)]
pub struct EmbeddingCacheKey<'a> {
    pub model_id: &'a str,
    pub text: &'a str,
}

impl<'a> EmbeddingCacheKey<'a> {
    pub fn new(model_id: &'a str, text: &'a str) -> Self {
        Self { model_id, text }
    }
}

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

impl CacheInner {
    fn is_full(&self) -> bool {
        self.map.len() >= self.capacity
    }

    fn evict_least_recently_used(&mut self) {
        let lru_key = self
            .map
            .iter()
            .min_by_key(|(_, entry)| entry.last_used)
            .map(|(key, _)| key.clone());
        if let Some(key) = lru_key {
            self.map.remove(&key);
        }
    }
}

impl Default for EmbeddingCache {
    fn default() -> Self {
        Self::new()
    }
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
        let entry = inner
            .map
            .get_mut(&(model_id.to_string(), text.to_string()))?;
        entry.last_used = counter;
        Some(entry.vec.clone())
    }

    pub fn insert(&self, cache_key: EmbeddingCacheKey<'_>, vec: Vec<f32>) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        inner.counter += 1;
        let counter = inner.counter;

        let key = (cache_key.model_id.to_string(), cache_key.text.to_string());
        if inner.map.contains_key(&key) {
            inner.map.get_mut(&key).unwrap().vec = vec;
            inner.map.get_mut(&key).unwrap().last_used = counter;
            return;
        }

        if inner.is_full() {
            inner.evict_least_recently_used();
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
