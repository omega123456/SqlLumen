#![warn(clippy::min_ident_chars)]

pub mod ai;
pub mod ai_memory;
pub mod commands;
pub mod credentials;
pub mod db;
pub mod export;
pub mod logging;
pub mod mysql;
pub mod schema_index;
pub mod state;
pub mod window_chrome;

#[cfg(not(any(test, coverage)))]
#[macro_use]
mod command_registry;
#[cfg(not(any(test, coverage)))]
mod app_runtime;

pub fn http_client_builder() -> reqwest::ClientBuilder {
    // reqwest uses `rustls-no-provider`; match sqlx/updater on ring instead of pulling in aws-lc-rs.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let builder = reqwest::Client::builder();
    #[cfg(feature = "test-utils")]
    let builder = builder.no_proxy();
    builder
}

pub fn http_client() -> reqwest::Client {
    http_client_builder().build().expect("http client")
}

use db::connection::open_database;
use db::migrations::{
    run_migrations, MIGRATION_CONNECTION_CASCADE_CLEANUP, MIGRATION_VACUUM_STATE_MAIN,
};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Once;

/// Register the sqlite-vec extension as a global auto-extension.
///
/// Uses `sqlite3_auto_extension` so that every new `Connection::open*` call
/// automatically loads the vec0 virtual table support. Safe to call multiple
/// times — a `Once` guard ensures the FFI registration happens exactly once.
type SqliteExtensionEntryPoint = unsafe extern "C" fn(
    *mut rusqlite::ffi::sqlite3,
    *mut *mut std::ffi::c_char,
    *const rusqlite::ffi::sqlite3_api_routines,
) -> std::ffi::c_int;

pub fn init_sqlite_vec() {
    static INIT: Once = Once::new();
    INIT.call_once(|| unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute::<
            *const (),
            SqliteExtensionEntryPoint,
        >(
            sqlite_vec::sqlite3_vec_init as *const ()
        )));
    });
}

/// Directory for SQLite, logs, and other app data.
///
/// In debug builds (`pnpm tauri dev`, `cargo build`), uses a sibling folder `{identifier}-dev`
/// so development does not read or write the same files as release installs.
pub fn resolved_app_data_dir(base: &Path) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        match base.file_name().and_then(|name| name.to_str()) {
            Some(name) => base.with_file_name(format!("{name}-dev")),
            None => base.to_path_buf(),
        }
    }
    #[cfg(not(debug_assertions))]
    {
        base.to_path_buf()
    }
}

pub fn is_empty_path(path: &Path) -> bool {
    path.as_os_str().is_empty()
}

pub fn is_not_found_error(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::NotFound
}

/// Initialize the SQLite database for the application.
/// Opens the database at the given app data directory and runs all pending migrations.
/// Returns the raw Connection — caller assembles AppState.
pub fn initialize_database(app_data_dir: &Path) -> Result<Connection, String> {
    // Register sqlite-vec auto-extension before opening any connection.
    init_sqlite_vec();

    let db_path = app_data_dir.join("sqllumen.db");
    let mut conn = open_database(db_path)
        .map_err(|error| format!("failed to open SQLite database: {error}"))?;
    let applied = run_migrations(&mut conn)
        .map_err(|error| format!("failed to run database migrations: {error}"))?;

    // When the cascade-cleanup migration is first applied it rebuilds several
    // large tables, leaving freed pages behind. Reclaim that disk space with a
    // single VACUUM. VACUUM is illegal inside a transaction and the migration
    // runner wraps each migration in one, so it must run here, after the loop.
    if applied.contains(&MIGRATION_CONNECTION_CASCADE_CLEANUP) {
        tracing::info!("migration 013 newly applied; running one-time VACUUM to reclaim space");
        if let Err(error) = conn.execute_batch("VACUUM;") {
            tracing::error!(error = ?error, "one-time VACUUM after migration 013 failed");
        }
    }

    // When the vacuum-state migration is first applied, convert the database to
    // incremental auto-vacuum mode. Enabling incremental auto-vacuum on an
    // existing database requires a full VACUUM to take effect; VACUUM is illegal
    // inside a transaction, so the conversion runs here rather than in migration
    // SQL.
    if applied.contains(&MIGRATION_VACUUM_STATE_MAIN) {
        tracing::info!(
            "migration 014 newly applied; converting main database to incremental auto-vacuum"
        );
        crate::db::vacuum::convert_to_incremental_vacuum(&conn, "main database");
    }

    // Enable foreign-key enforcement for production. This is the sole owner of
    // FK enablement (run_migrations leaves it off so default test helpers stay
    // FK-off). PRAGMA foreign_keys is a no-op inside a transaction, so it is set
    // here, outside any transaction.
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| format!("failed to enable foreign key enforcement: {error}"))?;

    Ok(conn)
}

#[cfg(not(any(test, coverage)))]
pub fn run() {
    app_runtime::run()
}

/// Coverage builds still compile the bin target (`main.rs`), which calls `run()`.
/// Provide a no-op stub so coverage can focus on the testable library surface
/// without linking or executing the full Tauri runtime on Windows.
#[cfg(coverage)]
pub fn run() {}
