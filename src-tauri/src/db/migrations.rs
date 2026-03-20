use rusqlite::{Connection, Result};

/// The list of migrations to apply, in order.
/// Each entry is (migration_name, sql).
/// New migrations must be added here manually when new .sql files are created.
const MIGRATIONS: &[(&str, &str)] = &[(
    "001_initial",
    include_str!("../../migrations/001_initial.sql"),
)];

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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        Connection::open_in_memory().expect("should open in-memory connection")
    }

    #[test]
    fn test_run_migrations_creates_migrations_table() {
        let conn = test_conn();
        run_migrations(&conn).expect("should run migrations without error");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_migrations'",
                [],
                |row| row.get(0),
            )
            .expect("should query sqlite_master");

        assert_eq!(count, 1);
    }

    #[test]
    fn test_run_migrations_applies_initial_migration() {
        let conn = test_conn();
        run_migrations(&conn).expect("should run migrations");

        let applied: String = conn
            .query_row(
                "SELECT name FROM _migrations WHERE name = '001_initial'",
                [],
                |row| row.get(0),
            )
            .expect("should find 001_initial in _migrations");

        assert_eq!(applied, "001_initial");
    }

    #[test]
    fn test_run_migrations_creates_settings_table() {
        let conn = test_conn();
        run_migrations(&conn).expect("should run migrations");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='settings'",
                [],
                |row| row.get(0),
            )
            .expect("should query sqlite_master");

        assert_eq!(count, 1);
    }

    #[test]
    fn test_run_migrations_creates_connections_table() {
        let conn = test_conn();
        run_migrations(&conn).expect("should run migrations");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='connections'",
                [],
                |row| row.get(0),
            )
            .expect("should query sqlite_master");

        assert_eq!(count, 1);
    }

    #[test]
    fn test_run_migrations_creates_connection_groups_table() {
        let conn = test_conn();
        run_migrations(&conn).expect("should run migrations");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='connection_groups'",
                [],
                |row| row.get(0),
            )
            .expect("should query sqlite_master");

        assert_eq!(count, 1);
    }

    #[test]
    fn test_run_migrations_is_idempotent() {
        let conn = test_conn();
        run_migrations(&conn).expect("first run should succeed");
        run_migrations(&conn).expect("second run should also succeed (idempotent)");

        // Verify 001_initial is recorded only once
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _migrations WHERE name = '001_initial'",
                [],
                |row| row.get(0),
            )
            .expect("should query _migrations count");

        assert_eq!(count, 1);
    }
}
