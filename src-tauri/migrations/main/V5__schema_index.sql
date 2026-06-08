CREATE TABLE IF NOT EXISTS schema_index_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT NOT NULL,
    chunk_key TEXT NOT NULL,
    db_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    chunk_type TEXT NOT NULL CHECK(chunk_type IN ('table', 'fk')),
    ddl_text TEXT NOT NULL,
    ddl_hash TEXT NOT NULL,
    model_id TEXT NOT NULL,
    embedded_at TEXT NOT NULL DEFAULT (datetime('now')),
    ref_db_name TEXT,
    ref_table_name TEXT,
    UNIQUE(connection_id, chunk_key)
);

CREATE TABLE IF NOT EXISTS schema_index_meta (
    connection_id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    embedding_dimension INTEGER NOT NULL,
    last_build_at TEXT,
    status TEXT NOT NULL DEFAULT 'stale'
);
