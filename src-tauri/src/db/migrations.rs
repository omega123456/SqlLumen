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
        "006_schema_index_signatures",
        include_str!("../../migrations/006_schema_index_signatures.sql"),
    ),
    (
        "007_schema_index_content_redesign",
        include_str!("../../migrations/007_schema_index_content_redesign.sql"),
    ),
    (
        "008_schema_index_segment_df",
        include_str!("../../migrations/008_schema_index_segment_df.sql"),
    ),
    (
        "009_ai_memory",
        include_str!("../../migrations/009_ai_memory.sql"),
    ),
    (
        "010_schema_cache",
        include_str!("../../migrations/010_schema_cache.sql"),
    ),
    (
        "011_ai_memory_multi_level",
        include_str!("../../migrations/011_ai_memory_multi_level.sql"),
    ),
    (
        "012_session_snapshots",
        include_str!("../../migrations/012_session_snapshots.sql"),
    ),
    (
        "013_connection_cascade_cleanup",
        include_str!("../../migrations/013_connection_cascade_cleanup.sql"),
    ),
    (
        "014_vacuum_state",
        include_str!("../../migrations/014_vacuum_state.sql"),
    ),
];

/// The list of migrations to apply to the logs database, in order.
/// Each entry is (migration_name, sql). Mirrors `MIGRATIONS` for the logs DB.
const LOG_MIGRATIONS: &[(&str, &str)] = &[
    (
        "001_initial_schema",
        include_str!("../../migrations/logs/001_initial_schema.sql"),
    ),
    (
        "002_vacuum_state",
        include_str!("../../migrations/logs/002_vacuum_state.sql"),
    ),
];

/// Run all pending migrations on the given connection.
/// Creates the `_migrations` tracking table if it doesn't exist.
/// Applies migrations in order, skipping already-applied ones.
///
/// Returns the names of migrations that were newly applied during this
/// invocation (already-applied migrations are not included). Does NOT touch
/// `PRAGMA foreign_keys` — foreign-key enforcement is enabled only in
/// `initialize_database` (production), so the default test helpers stay
/// FK-off.
pub fn run_migrations(conn: &Connection) -> Result<Vec<String>> {
    apply_migrations(conn, MIGRATIONS)
}

/// Run all pending migrations on the logs database connection.
///
/// Delegates to the same core runner used by [`run_migrations`], driven by the
/// logs-DB [`LOG_MIGRATIONS`] list. Returns the names of migrations newly
/// applied during this invocation.
pub fn run_log_migrations(conn: &Connection) -> Result<Vec<String>> {
    apply_migrations(conn, LOG_MIGRATIONS)
}

/// Core migration runner shared by the main and logs databases.
///
/// Creates the `_migrations` tracking table if it doesn't exist, then applies
/// each pending migration from `migrations` in order inside its own
/// transaction, recording bookkeeping. Returns the names of migrations newly
/// applied during this invocation.
fn apply_migrations(conn: &Connection, migrations: &[(&str, &str)]) -> Result<Vec<String>> {
    // Create the migrations tracking table
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            name       TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        );",
    )?;

    let mut applied: Vec<String> = Vec::new();

    for (name, sql) in migrations {
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
            applied.push((*name).to_string());
        }
    }

    Ok(applied)
}

/// Simple Unix timestamp string for migration tracking.
/// Although `chrono` is already a direct dependency, a plain Unix-seconds
/// integer string is used here intentionally — migration tracking only needs a
/// monotonic, sortable marker, not a formatted calendar date.
fn timestamp_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    secs.to_string()
}
