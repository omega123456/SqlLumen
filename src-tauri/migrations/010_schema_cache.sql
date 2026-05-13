CREATE TABLE IF NOT EXISTS schema_cache_snapshots (
    connection_id TEXT NOT NULL PRIMARY KEY,
    snapshot_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
