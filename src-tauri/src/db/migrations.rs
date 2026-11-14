use refinery::Target;
use rusqlite::{Connection, Result};

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

pub fn run_migrations(conn: &mut Connection) -> std::result::Result<Vec<i32>, String> {
    run_with_runner(conn, "main", embedded_main::migrations::runner)
}

pub fn run_log_migrations(conn: &mut Connection) -> std::result::Result<Vec<i32>, String> {
    run_with_runner(conn, "logs", embedded_logs::migrations::runner)
}

fn run_with_runner(
    conn: &mut Connection,
    db_label: &str,
    runner: impl Fn() -> refinery::Runner,
) -> std::result::Result<Vec<i32>, String> {
    let history_exists = table_exists(conn, "refinery_schema_history").map_err(|error| {
        map_err(
            db_label,
            "checking refinery_schema_history existence",
            error,
        )
    })?;
    let legacy_exists = table_exists(conn, "_migrations")
        .map_err(|error| map_err(db_label, "checking legacy _migrations existence", error))?;

    let needs_cutover_seed = !history_exists && legacy_exists;
    if needs_cutover_seed {
        let watermark = legacy_watermark(conn)
            .map_err(|error| map_err(db_label, "reading legacy migration watermark", error))?;
        if let Some(version) = watermark {
            runner()
                .set_grouped(true)
                .set_target(Target::FakeVersion(version))
                .run(conn)
                .map_err(|error| map_err(db_label, "seeding refinery history (fake run)", error))?;
        }
    }

    if legacy_exists {
        conn.execute_batch("DROP TABLE IF EXISTS _migrations;")
            .map_err(|error| map_err(db_label, "dropping legacy _migrations table", error))?;
    }

    let report = runner()
        .run(conn)
        .map_err(|error| map_err(db_label, "running migrations", error))?;

    Ok(report
        .applied_migrations()
        .iter()
        .map(|migration| migration.version())
        .collect())
}

fn table_exists(conn: &Connection, name: &str) -> Result<bool> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
}

fn legacy_watermark(conn: &Connection) -> Result<Option<i32>> {
    let mut stmt = conn.prepare("SELECT name FROM _migrations")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;

    let mut max: Option<i32> = None;
    for name in rows {
        let name = name?;
        let prefix: String = name
            .chars()
            .take_while(|character| character.is_ascii_digit())
            .collect();
        if let Ok(value) = prefix.parse::<i32>() {
            max = Some(max.map_or(value, |current_max| current_max.max(value)));
        }
    }
    Ok(max)
}

fn map_err(db_label: &str, op: &str, error: impl std::fmt::Display) -> String {
    tracing::error!(db = db_label, operation = op, error = %error, "database migration failure");
    format!("{db_label} migration error during {op}: {error}")
}
