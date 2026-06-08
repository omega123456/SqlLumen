-- 007_schema_index_content_redesign.sql
--
-- Rework the `schema_index_chunks` table to support the Phase 1 content
-- redesign:
--   * drop the CHECK(chunk_type IN ('table','fk')) so future chunk types
--     (view / procedure / function) are accepted without another migration,
--   * add `text_for_embedding` — the synthesized prose description that is
--     actually sent to the embedding model (ddl_text stays as the LLM-facing
--     blob and now carries `-- approximate rows: N` comments + retained
--     table/column comments),
--   * add `row_count_approx` — the `information_schema.TABLES.TABLE_ROWS`
--     snapshot captured during the build.
--
-- Also introduces `schema_index_fk_edges` — an explicit adjacency table that
-- replaces the per-FK chunk rows previously used for fan-out. FK info is now
-- collapsed into the owning table's `text_for_embedding` prose, while this
-- edges table is the source-of-truth for graph traversal in search.

-- ── Recreate schema_index_chunks without the CHECK constraint ─────────────
ALTER TABLE schema_index_chunks RENAME TO schema_index_chunks_old_007;

CREATE TABLE schema_index_chunks (
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
    UNIQUE(connection_id, chunk_key)
);

INSERT INTO schema_index_chunks
    (id, connection_id, chunk_key, db_name, table_name, chunk_type, ddl_text,
     ddl_hash, model_id, embedded_at, ref_db_name, ref_table_name)
SELECT id, connection_id, chunk_key, db_name, table_name, chunk_type, ddl_text,
       ddl_hash, model_id, embedded_at, ref_db_name, ref_table_name
FROM schema_index_chunks_old_007;

DROP TABLE schema_index_chunks_old_007;

-- ── FK adjacency edges — source of truth for fan-out in search ────────────
CREATE TABLE IF NOT EXISTS schema_index_fk_edges (
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
    UNIQUE(connection_id, src_db, src_tbl, constraint_name, src_col)
);

CREATE INDEX IF NOT EXISTS idx_schema_index_fk_edges_src
    ON schema_index_fk_edges (connection_id, src_db, src_tbl);

CREATE INDEX IF NOT EXISTS idx_schema_index_fk_edges_dst
    ON schema_index_fk_edges (connection_id, dst_db, dst_tbl);
