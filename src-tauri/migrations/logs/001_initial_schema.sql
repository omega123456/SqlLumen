-- Logs database initial schema.
-- Faithful, idempotent reproduction of the original `init_schema` body from
-- logging/log_store.rs. All statements use IF NOT EXISTS so this migration can
-- be safely applied to a pre-existing logs database whose tables already exist.
CREATE TABLE IF NOT EXISTS log_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL,
    level_num INTEGER NOT NULL,
    target TEXT NOT NULL,
    message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_log_entries_timestamp
    ON log_entries(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_log_entries_level_num_timestamp
    ON log_entries(level_num, timestamp DESC);
