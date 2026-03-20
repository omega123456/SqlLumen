use mysql_client_lib::db::migrations;
use rusqlite::Connection;

/// Creates a fresh in-memory SQLite database with all migrations applied.
/// Each test gets a fully isolated database instance.
pub fn test_db() -> Connection {
    let conn = Connection::open_in_memory().expect("should open in-memory database");
    migrations::run_migrations(&conn).expect("should run migrations");
    conn
}
