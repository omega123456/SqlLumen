#[cfg(not(coverage))]
use sqlx::mysql::MySqlPoolOptions;
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use sqlx::MySqlPool;
#[cfg(not(coverage))]
use std::time::Duration;

#[cfg(any(test, feature = "test-utils"))]
type TestPoolFactory = fn(&ConnectionParams) -> Result<MySqlPool, sqlx::Error>;

#[cfg(not(coverage))]
const MIN_POOL_CONNECTIONS: u32 = 1;
#[cfg(not(coverage))]
const MAX_POOL_CONNECTIONS: u32 = 10;

#[cfg(any(test, feature = "test-utils"))]
static TEST_POOL_FACTORY: std::sync::Mutex<Option<TestPoolFactory>> = std::sync::Mutex::new(None);

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SslSettings {
    pub enabled: bool,
    pub ca_path: Option<String>,
    pub cert_path: Option<String>,
    pub key_path: Option<String>,
}

pub struct ConnectionParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub default_database: Option<String>,
    pub ssl: SslSettings,
    pub connect_timeout_secs: u64,
}

fn apply_ssl_settings(opts: MySqlConnectOptions, ssl: &SslSettings) -> MySqlConnectOptions {
    if !ssl.enabled {
        return opts.ssl_mode(MySqlSslMode::Disabled);
    }
    let mut opts = match ssl.ca_path {
        Some(ref ca_path) => opts.ssl_mode(MySqlSslMode::VerifyCa).ssl_ca(ca_path),
        None => opts.ssl_mode(MySqlSslMode::Required),
    };
    if let Some(ref cert_path) = ssl.cert_path {
        opts = opts.ssl_client_cert(cert_path);
    }
    if let Some(ref key_path) = ssl.key_path {
        opts = opts.ssl_client_key(key_path);
    }
    opts
}

pub fn build_connect_options(params: &ConnectionParams) -> MySqlConnectOptions {
    let mut opts = MySqlConnectOptions::new()
        .host(&params.host)
        .port(params.port)
        .username(&params.username);

    let has_password = !params.password.is_empty();
    if has_password {
        opts = opts.password(&params.password);
    }

    if let Some(ref db) = params.default_database {
        if !db.is_empty() {
            opts = opts.database(db);
        }
    }

    apply_ssl_settings(opts, &params.ssl)
}

#[cfg(any(test, feature = "test-utils"))]
pub fn set_test_pool_factory(factory: Option<TestPoolFactory>) {
    let mut guard = TEST_POOL_FACTORY
        .lock()
        .expect("test pool factory lock poisoned");
    *guard = factory;
}

#[cfg(any(test, feature = "test-utils"))]
fn create_test_pool(params: &ConnectionParams) -> Option<Result<MySqlPool, sqlx::Error>> {
    let factory = *TEST_POOL_FACTORY
        .lock()
        .expect("test pool factory lock poisoned");
    factory.map(|create| create(params))
}

#[cfg(not(coverage))]
pub async fn create_pool(params: &ConnectionParams) -> Result<MySqlPool, sqlx::Error> {
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(test_pool) = create_test_pool(params) {
        return test_pool;
    }

    let opts = build_connect_options(params);

    MySqlPoolOptions::new()
        .min_connections(MIN_POOL_CONNECTIONS)
        .max_connections(MAX_POOL_CONNECTIONS)
        .acquire_timeout(Duration::from_secs(params.connect_timeout_secs))
        .connect_with(opts)
        .await
}

#[cfg(coverage)]
pub async fn create_pool(params: &ConnectionParams) -> Result<MySqlPool, sqlx::Error> {
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(test_pool) = create_test_pool(params) {
        return test_pool;
    }

    let _ = build_connect_options(params);
    Err(sqlx::Error::PoolTimedOut)
}
