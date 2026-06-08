-- Per-database vacuum-state tracking table for the logs database.
-- Mirrors migrations/014_vacuum_state.sql for the main database.
-- DDL/DML only: no PRAGMA, no VACUUM. The auto_vacuum conversion runs in init
-- code, not inside the migration runner's per-migration transaction.
CREATE TABLE IF NOT EXISTS _vacuum_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO _vacuum_state (key, value) VALUES ('last_vacuum_at', '0');
