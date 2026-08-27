use sqllumen_lib::schema_index::embeddings_cache::EmbeddingCache;

#[test]
fn new_cache_returns_none_for_missing_key() {
    let cache = EmbeddingCache::new();
    assert!(cache.get("model-1", "hello world").is_none());
}

#[test]
fn insert_and_get_returns_vector() {
    let cache = EmbeddingCache::new();
    let vec = vec![1.0, 2.0, 3.0];
    cache.insert("model-1", "hello", vec.clone());
    let result = cache.get("model-1", "hello").unwrap();
    assert_eq!(result, vec);
}

#[test]
fn different_model_ids_are_separate_keys() {
    let cache = EmbeddingCache::new();
    cache.insert("model-a", "text", vec![1.0]);
    cache.insert("model-b", "text", vec![2.0]);
    assert_eq!(cache.get("model-a", "text").unwrap(), vec![1.0]);
    assert_eq!(cache.get("model-b", "text").unwrap(), vec![2.0]);
}

#[test]
fn insert_overwrites_existing_entry() {
    let cache = EmbeddingCache::new();
    cache.insert("m", "t", vec![1.0]);
    cache.insert("m", "t", vec![9.0]);
    assert_eq!(cache.get("m", "t").unwrap(), vec![9.0]);
}

#[test]
fn evicts_lru_when_capacity_exceeded() {
    let cache = EmbeddingCache::with_capacity(2);
    cache.insert("m", "a", vec![1.0]);
    cache.insert("m", "b", vec![2.0]);
    // Access "a" to make it more recently used
    cache.get("m", "a");
    // Insert "c" — should evict "b" (LRU)
    cache.insert("m", "c", vec![3.0]);
    assert!(cache.get("m", "b").is_none());
    assert_eq!(cache.get("m", "a").unwrap(), vec![1.0]);
    assert_eq!(cache.get("m", "c").unwrap(), vec![3.0]);
}

#[test]
fn eviction_removes_least_recently_used() {
    let cache = EmbeddingCache::with_capacity(3);
    cache.insert("m", "a", vec![1.0]);
    cache.insert("m", "b", vec![2.0]);
    cache.insert("m", "c", vec![3.0]);
    // Access "a" and "c" but not "b"
    cache.get("m", "a");
    cache.get("m", "c");
    // Insert "d" — should evict "b"
    cache.insert("m", "d", vec![4.0]);
    assert!(cache.get("m", "b").is_none());
    assert!(cache.get("m", "a").is_some());
    assert!(cache.get("m", "c").is_some());
    assert!(cache.get("m", "d").is_some());
}

#[test]
fn capacity_one_works() {
    let cache = EmbeddingCache::with_capacity(1);
    cache.insert("m", "a", vec![1.0]);
    assert_eq!(cache.get("m", "a").unwrap(), vec![1.0]);
    cache.insert("m", "b", vec![2.0]);
    assert!(cache.get("m", "a").is_none());
    assert_eq!(cache.get("m", "b").unwrap(), vec![2.0]);
}
