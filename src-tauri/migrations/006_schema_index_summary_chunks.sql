-- Extend schema_index_chunks.chunk_type to allow the 'summary' chunk type
-- (natural-language prose summary per table, in addition to 'table' DDL chunks
-- and 'fk' relationship chunks). See plan item A2 — smarter-semantic-retrieval.
--
-- SQLite cannot ALTER a CHECK constraint in-place, so we rebuild the table.
-- We keep the schema identical apart from the relaxed constraint.

CREATE TABLE schema_index_chunks_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT NOT NULL,
    chunk_key TEXT NOT NULL,
    db_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    chunk_type TEXT NOT NULL CHECK(chunk_type IN ('table', 'fk', 'summary')),
    ddl_text TEXT NOT NULL,
    ddl_hash TEXT NOT NULL,
    model_id TEXT NOT NULL,
    embedded_at TEXT NOT NULL DEFAULT (datetime('now')),
    ref_db_name TEXT,
    ref_table_name TEXT,
    UNIQUE(connection_id, chunk_key)
);

INSERT INTO schema_index_chunks_new
    (id, connection_id, chunk_key, db_name, table_name, chunk_type,
     ddl_text, ddl_hash, model_id, embedded_at, ref_db_name, ref_table_name)
SELECT
    id, connection_id, chunk_key, db_name, table_name, chunk_type,
    ddl_text, ddl_hash, model_id, embedded_at, ref_db_name, ref_table_name
FROM schema_index_chunks;

DROP TABLE schema_index_chunks;
ALTER TABLE schema_index_chunks_new RENAME TO schema_index_chunks;
