CREATE TABLE IF NOT EXISTS session_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  connection_count INTEGER NOT NULL,
  tab_count INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  state_json TEXT NOT NULL
);
CREATE INDEX idx_session_snapshots_created_at ON session_snapshots(created_at);
