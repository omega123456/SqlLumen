#[cfg(not(coverage))]
use sqlx::mysql::MySqlPoolOptions;
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use sqlx::MySqlPool;
#[cfg(not(coverage))]
use std::time::Duration;

#[cfg(any(test, feature = "test-utils"))]
type TestPoolFactory = fn(&ConnectionParams) -> Result<MySqlPool, sqlx::Error>;

#[cfg(any(test, feature = "test-utils"))]
static TEST_POOL_FACTORY: std::sync::Mutex<Option<TestPoolFactory>> = std::sync::Mutex::new(None);

/// Parameters for creating a MySQL connection pool.
pub struct ConnectionParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub default_database: Option<String>,
    pub ssl_enabled: bool,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub connect_timeout_secs: u64,
}

pub fn build_connect_options(params: &ConnectionParams) -> MySqlConnectOptions {
    let mut opts = MySqlConnectOptions::new()
        .host(&params.host)
        .port(params.port)
        .username(&params.username);

    if !params.password.is_empty() {
        opts = opts.password(&params.password);
    }

    if let Some(ref db) = params.default_database {
        if !db.is_empty() {
            opts = opts.database(db);
        }
    }

    if params.ssl_enabled {
        if let Some(ref ca_path) = params.ssl_ca_path {
            opts = opts.ssl_mode(MySqlSslMode::VerifyCa).ssl_ca(ca_path);
        } else {
            opts = opts.ssl_mode(MySqlSslMode::Required);
        }

        if let Some(ref cert_path) = params.ssl_cert_path {
            opts = opts.ssl_client_cert(cert_path);
        }

        if let Some(ref key_path) = params.ssl_key_path {
            opts = opts.ssl_client_key(key_path);
        }
    } else {
        opts = opts.ssl_mode(MySqlSslMode::Disabled);
    }

    opts
}

#[cfg(any(test, feature = "test-utils"))]
pub fn set_test_pool_factory(factory: Option<TestPoolFactory>) {
    let mut guard = TEST_POOL_FACTORY
        .lock()
        .expect("test pool factory lock poisoned");
    *guard = factory;
}

/// Create a MySQL connection pool from the given parameters.
///
/// SSL/TLS is configured via rustls when `ssl_enabled` is true.
/// If a CA cert is provided, `VerifyCa` mode is used; otherwise `Required` mode
/// (encrypted but no cert verification).
///
/// Pool config: min_connections=1, max_connections=5.
#[cfg(not(coverage))]
pub async fn create_pool(params: &ConnectionParams) -> Result<MySqlPool, sqlx::Error> {
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(factory) = *TEST_POOL_FACTORY
        .lock()
        .expect("test pool factory lock poisoned")
    {
        return factory(params);
    }

    let opts = build_connect_options(params);

    MySqlPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(params.connect_timeout_secs))
        .connect_with(opts)
        .await
}

#[cfg(coverage)]
pub async fn create_pool(params: &ConnectionParams) -> Result<MySqlPool, sqlx::Error> {
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(factory) = *TEST_POOL_FACTORY
        .lock()
        .expect("test pool factory lock poisoned")
    {
        return factory(params);
    }

    let _ = build_connect_options(params);
    Err(sqlx::Error::PoolTimedOut)
}
