-- Multi-level AI memory: connection / group / global scopes.
--
-- Rename the existing single-level table (preserving all rows and the
-- corresponding `ai_memory_vectors_{connection_id}` vec0 tables, which keep
-- their names) and add the two new scope tables.

-- SQLite's ALTER TABLE ... RENAME TO keeps the old index but does NOT rename
-- it, so we explicitly drop + recreate the index under the new name for
-- naming consistency.
ALTER TABLE ai_memories RENAME TO connection_memories;
DROP INDEX IF EXISTS idx_ai_memories_connection_id;
CREATE INDEX idx_connection_memories_connection_id ON connection_memories(connection_id);

CREATE TABLE IF NOT EXISTS group_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX idx_group_memories_group_id ON group_memories(group_id);

CREATE TABLE IF NOT EXISTS global_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
);
