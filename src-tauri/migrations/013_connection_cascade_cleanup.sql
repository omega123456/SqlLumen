-- Migration 013: Rebuild per-connection static tables with ON DELETE CASCADE
-- foreign keys to connections(id), and purge existing orphan rows in one step.
--
-- For each table we create a replacement (_new) matching the CURRENT schema
-- plus FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE,
-- copy forward only rows whose connection_id exists in connections (for
-- favorites, also keep NULL connection_id rows), drop the original, rename the
-- replacement, and recreate the original indexes.
--
-- Foreign-key enforcement during this migration depends on the connection
-- default. This bundled SQLite build enforces foreign_keys ON by default, so in
-- production migration 013 actually runs under FK-ON; the orphan purge plus the
-- DROP/RENAME rebuild are designed to complete cleanly and remain FK-safe under
-- either setting. AUTOINCREMENT and existing id values are preserved for
-- query_history and schema_index_chunks, and their sqlite_sequence high-water
-- marks are retained below so future inserts do not collide with ids that once
-- belonged to now-purged orphan rows.

-- ── schema_cache_snapshots (current schema: 010) ──────────────────────────
CREATE TABLE schema_cache_snapshots_new (
    connection_id TEXT NOT NULL PRIMARY KEY,
    snapshot_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

INSERT INTO schema_cache_snapshots_new (connection_id, snapshot_json, updated_at)
SELECT connection_id, snapshot_json, updated_at
FROM schema_cache_snapshots
WHERE connection_id IN (SELECT id FROM connections);

DROP TABLE schema_cache_snapshots;
ALTER TABLE schema_cache_snapshots_new RENAME TO schema_cache_snapshots;

-- ── schema_index_meta (current schema: 005) ───────────────────────────────
CREATE TABLE schema_index_meta_new (
    connection_id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    embedding_dimension INTEGER NOT NULL,
    last_build_at TEXT,
    status TEXT NOT NULL DEFAULT 'stale',
    FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

INSERT INTO schema_index_meta_new
    (connection_id, model_id, embedding_dimension, last_build_at, status)
SELECT connection_id, model_id, embedding_dimension, last_build_at, status
FROM schema_index_meta
WHERE connection_id IN (SELECT id FROM connections);

DROP TABLE schema_index_meta;
ALTER TABLE schema_index_meta_new RENAME TO schema_index_meta;

-- ── schema_index_chunks (current schema: 007, AUTOINCREMENT preserved) ─────
CREATE TABLE schema_index_chunks_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT NOT NULL,
    chunk_key TEXT NOT NULL,
    db_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    chunk_type TEXT NOT NULL,
    ddl_text TEXT NOT NULL,
    ddl_hash TEXT NOT NULL,
    model_id TEXT NOT NULL,
    embedded_at TEXT NOT NULL DEFAULT (datetime('now')),
    ref_db_name TEXT,
    ref_table_name TEXT,
    text_for_embedding TEXT,
    row_count_approx INTEGER,
    UNIQUE(connection_id, chunk_key),
    FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

INSERT INTO schema_index_chunks_new
    (id, connection_id, chunk_key, db_name, table_name, chunk_type, ddl_text,
     ddl_hash, model_id, embedded_at, ref_db_name, ref_table_name,
     text_for_embedding, row_count_approx)
SELECT id, connection_id, chunk_key, db_name, table_name, chunk_type, ddl_text,
       ddl_hash, model_id, embedded_at, ref_db_name, ref_table_name,
       text_for_embedding, row_count_approx
FROM schema_index_chunks
WHERE connection_id IN (SELECT id FROM connections);

-- Capture the original AUTOINCREMENT high-water mark BEFORE the DROP removes the
-- sqlite_sequence entry. This reflects the true historical max id even if the
-- highest-id rows were orphans that get purged above.
CREATE TEMP TABLE _seq_hwm_schema_index_chunks AS
    SELECT COALESCE(
        (SELECT seq FROM sqlite_sequence WHERE name = 'schema_index_chunks'),
        0
    ) AS seq;

DROP TABLE schema_index_chunks;
ALTER TABLE schema_index_chunks_new RENAME TO schema_index_chunks;

-- Restore the high-water mark: take the greatest of the captured original seq
-- and whatever the INSERT...SELECT left in sqlite_sequence for the rebuilt
-- table (= MAX(id) of copied rows, or absent if no rows were copied).
UPDATE sqlite_sequence
   SET seq = MAX(
        seq,
        (SELECT seq FROM _seq_hwm_schema_index_chunks)
   )
 WHERE name = 'schema_index_chunks';

-- If no rows were copied there is no sqlite_sequence row yet; create one when
-- the captured original high-water is greater than zero.
INSERT INTO sqlite_sequence (name, seq)
SELECT 'schema_index_chunks', (SELECT seq FROM _seq_hwm_schema_index_chunks)
WHERE (SELECT seq FROM _seq_hwm_schema_index_chunks) > 0
  AND NOT EXISTS (
      SELECT 1 FROM sqlite_sequence WHERE name = 'schema_index_chunks'
  );

DROP TABLE _seq_hwm_schema_index_chunks;

-- ── schema_index_table_signatures (current schema: 006) ────────────────────
CREATE TABLE schema_index_table_signatures_new (
    connection_id TEXT NOT NULL,
    db_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    mysql_signature TEXT NOT NULL,
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (connection_id, db_name, table_name),
    FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

INSERT INTO schema_index_table_signatures_new
    (connection_id, db_name, table_name, mysql_signature, captured_at)
SELECT connection_id, db_name, table_name, mysql_signature, captured_at
FROM schema_index_table_signatures
WHERE connection_id IN (SELECT id FROM connections);

DROP TABLE schema_index_table_signatures;
ALTER TABLE schema_index_table_signatures_new RENAME TO schema_index_table_signatures;

CREATE INDEX IF NOT EXISTS idx_schema_index_table_signatures_connection
    ON schema_index_table_signatures (connection_id);

-- ── schema_index_fk_edges (current schema: 007) ────────────────────────────
CREATE TABLE schema_index_fk_edges_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT NOT NULL,
    src_db TEXT NOT NULL,
    src_tbl TEXT NOT NULL,
    src_col TEXT NOT NULL,
    dst_db TEXT NOT NULL,
    dst_tbl TEXT NOT NULL,
    dst_col TEXT NOT NULL,
    constraint_name TEXT NOT NULL,
    on_delete TEXT NOT NULL DEFAULT 'RESTRICT',
    on_update TEXT NOT NULL DEFAULT 'RESTRICT',
    UNIQUE(connection_id, src_db, src_tbl, constraint_name, src_col),
    FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

INSERT INTO schema_index_fk_edges_new
    (id, connection_id, src_db, src_tbl, src_col, dst_db, dst_tbl, dst_col,
     constraint_name, on_delete, on_update)
SELECT id, connection_id, src_db, src_tbl, src_col, dst_db, dst_tbl, dst_col,
       constraint_name, on_delete, on_update
FROM schema_index_fk_edges
WHERE connection_id IN (SELECT id FROM connections);

DROP TABLE schema_index_fk_edges;
ALTER TABLE schema_index_fk_edges_new RENAME TO schema_index_fk_edges;

CREATE INDEX IF NOT EXISTS idx_schema_index_fk_edges_src
    ON schema_index_fk_edges (connection_id, src_db, src_tbl);

CREATE INDEX IF NOT EXISTS idx_schema_index_fk_edges_dst
    ON schema_index_fk_edges (connection_id, dst_db, dst_tbl);

-- ── schema_index_segment_df (current schema: 008) ──────────────────────────
CREATE TABLE schema_index_segment_df_new (
    connection_id TEXT NOT NULL,
    segment       TEXT NOT NULL,
    doc_count     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, segment),
    FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

INSERT INTO schema_index_segment_df_new (connection_id, segment, doc_count)
SELECT connection_id, segment, doc_count
FROM schema_index_segment_df
WHERE connection_id IN (SELECT id FROM connections);

DROP TABLE schema_index_segment_df;
ALTER TABLE schema_index_segment_df_new RENAME TO schema_index_segment_df;

-- ── query_history (current schema: 004, AUTOINCREMENT preserved) ───────────
CREATE TABLE query_history_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id   TEXT NOT NULL,
    database_name   TEXT,
    sql_text        TEXT NOT NULL,
    timestamp       TEXT NOT NULL,
    duration_ms     INTEGER,
    row_count       INTEGER,
    affected_rows   INTEGER,
    success         INTEGER NOT NULL,
    error_message   TEXT,
    FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

INSERT INTO query_history_new
    (id, connection_id, database_name, sql_text, timestamp, duration_ms,
     row_count, affected_rows, success, error_message)
SELECT id, connection_id, database_name, sql_text, timestamp, duration_ms,
       row_count, affected_rows, success, error_message
FROM query_history
WHERE connection_id IN (SELECT id FROM connections);

-- Capture the original AUTOINCREMENT high-water mark BEFORE the DROP removes the
-- sqlite_sequence entry (see schema_index_chunks above for rationale).
CREATE TEMP TABLE _seq_hwm_query_history AS
    SELECT COALESCE(
        (SELECT seq FROM sqlite_sequence WHERE name = 'query_history'),
        0
    ) AS seq;

DROP TABLE query_history;
ALTER TABLE query_history_new RENAME TO query_history;

-- Restore the high-water mark to MAX(original seq, rebuilt seq).
UPDATE sqlite_sequence
   SET seq = MAX(
        seq,
        (SELECT seq FROM _seq_hwm_query_history)
   )
 WHERE name = 'query_history';

INSERT INTO sqlite_sequence (name, seq)
SELECT 'query_history', (SELECT seq FROM _seq_hwm_query_history)
WHERE (SELECT seq FROM _seq_hwm_query_history) > 0
  AND NOT EXISTS (
      SELECT 1 FROM sqlite_sequence WHERE name = 'query_history'
  );

DROP TABLE _seq_hwm_query_history;

CREATE INDEX idx_query_history_connection_timestamp
    ON query_history (connection_id, timestamp DESC);

-- ── favorites (current schema: 004, nullable connection_id retained) ───────
CREATE TABLE favorites_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    sql_text        TEXT NOT NULL,
    description     TEXT,
    category        TEXT,
    connection_id   TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

INSERT INTO favorites_new
    (id, name, sql_text, description, category, connection_id, created_at, updated_at)
SELECT id, name, sql_text, description, category, connection_id, created_at, updated_at
FROM favorites
WHERE connection_id IS NULL
   OR connection_id IN (SELECT id FROM connections);

DROP TABLE favorites;
ALTER TABLE favorites_new RENAME TO favorites;

CREATE INDEX idx_favorites_connection_id ON favorites (connection_id);
CREATE INDEX idx_favorites_created_at ON favorites (created_at DESC);
