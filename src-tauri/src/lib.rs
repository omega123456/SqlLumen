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
pub mod timestamps;
pub mod window_chrome;

#[cfg(not(any(test, coverage)))]
#[macro_use]
mod command_registry;
#[cfg(not(any(test, coverage)))]
mod app_runtime;

pub fn http_client_builder() -> reqwest::ClientBuilder {
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

pub fn initialize_database(app_data_dir: &Path) -> Result<Connection, String> {
    init_sqlite_vec();

    let db_path = app_data_dir.join("sqllumen.db");
    let mut conn = open_database(db_path)
        .map_err(|error| format!("failed to open SQLite database: {error}"))?;
    let applied = run_migrations(&mut conn)
        .map_err(|error| format!("failed to run database migrations: {error}"))?;

    if applied.contains(&MIGRATION_CONNECTION_CASCADE_CLEANUP) {
        tracing::info!("migration 013 newly applied; running one-time VACUUM to reclaim space");
        if let Err(error) = conn.execute_batch("VACUUM;") {
            tracing::error!(error = ?error, "one-time VACUUM after migration 013 failed");
        }
    }

    if applied.contains(&MIGRATION_VACUUM_STATE_MAIN) {
        tracing::info!(
            "migration 014 newly applied; converting main database to incremental auto-vacuum"
        );
        crate::db::vacuum::convert_to_incremental_vacuum(&conn, "main database");
    }

    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| format!("failed to enable foreign key enforcement: {error}"))?;

    Ok(conn)
}

#[cfg(not(any(test, coverage)))]
pub fn run() {
    app_runtime::run()
}

#[cfg(coverage)]
pub fn run() {}
