use rusqlite::{Connection, Result};

/// The list of migrations to apply, in order.
/// Each entry is (migration_name, sql).
/// New migrations must be added here manually when new .sql files are created.
const MIGRATIONS: &[(&str, &str)] = &[
    (
        "001_initial",
        include_str!("../../migrations/001_initial.sql"),
    ),
    (
        "002_connection_timeouts",
        include_str!("../../migrations/002_connection_timeouts.sql"),
    ),
    (
        "003_history_favorites",
        include_str!("../../migrations/003_history_favorites.sql"),
    ),
    (
        "004_fix_history_favorites_schema",
        include_str!("../../migrations/004_fix_history_favorites_schema.sql"),
    ),
    (
        "005_schema_index",
        include_str!("../../migrations/005_schema_index.sql"),
    ),
    (
        "006_schema_index_summary_chunks",
        include_str!("../../migrations/006_schema_index_summary_chunks.sql"),
    ),
];

/// Run all pending migrations on the given connection.
/// Creates the `_migrations` tracking table if it doesn't exist.
/// Applies migrations in order, skipping already-applied ones.
pub fn run_migrations(conn: &Connection) -> Result<()> {
    // Create the migrations tracking table
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            name       TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        );",
    )?;

    for (name, sql) in MIGRATIONS {
        // Check if already applied — propagate errors, don't swallow them
        let already_applied: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM _migrations WHERE name = ?1",
                [name],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count > 0)?;

        if !already_applied {
            // Run migration atomically — both the schema change and the bookkeeping record
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            let now = timestamp_now();
            tx.execute(
                "INSERT INTO _migrations (name, applied_at) VALUES (?1, ?2)",
                rusqlite::params![name, now],
            )?;
            tx.commit()?;
        }
    }

    Ok(())
}

/// Simple Unix timestamp string for migration tracking.
/// Avoids pulling in chrono as a dependency for this one use case.
fn timestamp_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{secs}")
}
