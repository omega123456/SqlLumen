CREATE TABLE IF NOT EXISTS schema_index_table_signatures (
    connection_id TEXT NOT NULL,
    db_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    mysql_signature TEXT NOT NULL,
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (connection_id, db_name, table_name)
);

CREATE INDEX IF NOT EXISTS idx_schema_index_table_signatures_connection
    ON schema_index_table_signatures (connection_id);
