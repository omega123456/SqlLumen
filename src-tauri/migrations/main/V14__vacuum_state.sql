-- Per-database vacuum-state tracking table.
-- Holds a single key/value row recording when the database was last vacuumed
-- (Unix-seconds string), seeded to '0' meaning "never vacuumed".
-- DDL/DML only: no PRAGMA, no VACUUM (those would break the migration runner's
-- per-migration transaction). The auto_vacuum conversion runs in init code.
CREATE TABLE IF NOT EXISTS _vacuum_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO _vacuum_state (key, value) VALUES ('last_vacuum_at', '0');
