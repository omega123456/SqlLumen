-- Migration 004: Recreate query_history and favorites with corrected schemas.
-- Drops existing tables and recreates them with proper column names and types.

DROP TABLE IF EXISTS query_history;
DROP TABLE IF EXISTS favorites;

-- Query history: stores every executed query per connection.
CREATE TABLE query_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id   TEXT NOT NULL,
    database_name   TEXT,
    sql_text        TEXT NOT NULL,
    timestamp       TEXT NOT NULL,
    duration_ms     INTEGER,
    row_count       INTEGER,
    affected_rows   INTEGER,
    success         INTEGER NOT NULL,
    error_message   TEXT
);

CREATE INDEX idx_query_history_connection_timestamp
    ON query_history (connection_id, timestamp DESC);

-- Favorites: saved queries, optionally scoped to a connection.
CREATE TABLE favorites (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    sql_text        TEXT NOT NULL,
    description     TEXT,
    category        TEXT,
    connection_id   TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX idx_favorites_connection_id ON favorites (connection_id);
CREATE INDEX idx_favorites_created_at ON favorites (created_at DESC);
