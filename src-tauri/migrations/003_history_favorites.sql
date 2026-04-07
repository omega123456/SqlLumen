-- Query history: stores every executed query per connection profile.
CREATE TABLE IF NOT EXISTS query_history (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL,
    database_name   TEXT,
    sql_text        TEXT NOT NULL,
    execution_time_ms INTEGER NOT NULL DEFAULT 0,
    row_count       INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'success',
    error_message   TEXT,
    executed_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_query_history_profile_id ON query_history (profile_id);
CREATE INDEX IF NOT EXISTS idx_query_history_executed_at ON query_history (executed_at DESC);

-- Favorites: saved queries per connection profile.
CREATE TABLE IF NOT EXISTS favorites (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    sql_text        TEXT NOT NULL,
    database_name   TEXT,
    notes           TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_favorites_profile_id ON favorites (profile_id);
CREATE INDEX IF NOT EXISTS idx_favorites_created_at ON favorites (created_at DESC);
