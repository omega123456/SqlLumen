-- Migration 008: Add segment document frequency table for IDF-aware lexical matching.
CREATE TABLE IF NOT EXISTS schema_index_segment_df (
    connection_id TEXT NOT NULL,
    segment       TEXT NOT NULL,
    doc_count     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, segment)
);
