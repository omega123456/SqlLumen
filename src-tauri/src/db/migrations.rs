use refinery::Target;
use rusqlite::{Connection, Result};

/// Migration version numbers that gate post-migration hooks (one-time VACUUM /
/// auto-vacuum conversions) run outside the migration runner's transactions.
/// These mirror the `VNN__*.sql` filenames in `migrations/main` and
/// `migrations/logs`; keep them in sync if those files are renumbered.
pub const MIGRATION_CONNECTION_CASCADE_CLEANUP: i32 = 13;
pub const MIGRATION_VACUUM_STATE_MAIN: i32 = 14;
pub const MIGRATION_VACUUM_STATE_LOGS: i32 = 2;

mod embedded_main {
    use refinery::embed_migrations;
    embed_migrations!("migrations/main");
}

mod embedded_logs {
    use refinery::embed_migrations;
    embed_migrations!("migrations/logs");
}

/// Run all pending main-database migrations on the given connection via
/// refinery, performing a one-time cutover from the legacy `_migrations`
/// tracking table when necessary.
///
/// Returns the **versions** of migrations that were newly applied during this
/// invocation (already-applied / faked migrations are not included). Pure-fake
/// cutovers therefore return an empty vector. Does NOT touch
/// `PRAGMA foreign_keys` — foreign-key enforcement is enabled only in
/// `initialize_database` (production), so the default test helpers stay FK-off.
pub fn run_migrations(conn: &mut Connection) -> std::result::Result<Vec<i32>, String> {
    run_with_runner(conn, "main", embedded_main::migrations::runner)
}

/// Run all pending logs-database migrations on the given connection via
/// refinery, performing the same one-time cutover from the legacy `_migrations`
/// tracking table as [`run_migrations`].
///
/// Returns the **versions** of migrations that were newly applied during this
/// invocation (already-applied / faked migrations are not included). Pure-fake
/// cutovers therefore return an empty vector.
pub fn run_log_migrations(conn: &mut Connection) -> std::result::Result<Vec<i32>, String> {
    run_with_runner(conn, "logs", embedded_logs::migrations::runner)
}

/// Shared refinery cutover + run routine for a single database.
///
/// `db_label` is used purely for `tracing` context. `runner` is the embedded
/// refinery runner for this database's migration set.
fn run_with_runner(
    conn: &mut Connection,
    db_label: &str,
    runner: impl Fn() -> refinery::Runner,
) -> std::result::Result<Vec<i32>, String> {
    let history_exists = table_exists(conn, "refinery_schema_history")
        .map_err(|e| map_err(db_label, "checking refinery_schema_history existence", e))?;
    let legacy_exists = table_exists(conn, "_migrations")
        .map_err(|e| map_err(db_label, "checking legacy _migrations existence", e))?;

    // Cutover seed: only when refinery has never tracked this DB but the legacy
    // custom runner did. Records migrations 1..=K in refinery_schema_history
    // without executing their SQL (refinery computes the checksums itself).
    if !history_exists && legacy_exists {
        let watermark = legacy_watermark(conn)
            .map_err(|e| map_err(db_label, "reading legacy migration watermark", e))?;
        if let Some(k) = watermark {
            runner()
                .set_grouped(true)
                .set_target(Target::FakeVersion(k))
                .run(conn)
                .map_err(|e| map_err(db_label, "seeding refinery history (fake run)", e))?;
        }
    }

    // Single source of truth: drop the legacy table after (or in absence of) a
    // seed. Idempotent and crash-safe via IF EXISTS.
    if legacy_exists {
        conn.execute_batch("DROP TABLE IF EXISTS _migrations;")
            .map_err(|e| map_err(db_label, "dropping legacy _migrations table", e))?;
    }

    // Real, non-grouped run: applies remaining migrations with per-migration
    // commits so post-migration VACUUM hooks (illegal in a transaction) work.
    let report = runner()
        .run(conn)
        .map_err(|e| map_err(db_label, "running migrations", e))?;

    Ok(report
        .applied_migrations()
        .iter()
        .map(|m| m.version())
        .collect())
}

/// Returns `true` if a table with the given name exists in `sqlite_master`.
fn table_exists(conn: &Connection, name: &str) -> Result<bool> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
}

/// Parse the highest already-applied migration version from the legacy
/// `_migrations` table. Each `name` is of the form `NNN_description`; the
/// watermark is the max integer parsed from the leading numeric prefix. Returns
/// `None` when the table is empty or yields no parseable version.
fn legacy_watermark(conn: &Connection) -> Result<Option<i32>> {
    let mut stmt = conn.prepare("SELECT name FROM _migrations")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;

    let mut max: Option<i32> = None;
    for name in rows {
        let name = name?;
        let prefix: String = name.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(v) = prefix.parse::<i32>() {
            max = Some(max.map_or(v, |m| m.max(v)));
        }
    }
    Ok(max)
}

/// Log an underlying refinery/rusqlite failure with operation context and
/// return a Display-able `String` error for the caller.
fn map_err(db_label: &str, op: &str, err: impl std::fmt::Display) -> String {
    tracing::error!(db = db_label, operation = op, error = %err, "database migration failure");
    format!("{db_label} migration error during {op}: {err}")
}
