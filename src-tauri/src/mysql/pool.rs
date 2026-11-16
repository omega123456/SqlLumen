use std::fmt;
use std::time::Duration;

use mysql_async::{Conn, Opts, OptsBuilder, PoolConstraints, PoolOpts};

use crate::mysql::connection_options::{checkout_within_timeout, connect_timeout, mysql_opts};

#[cfg(any(test, feature = "test-utils"))]
type TestPoolFactory = fn(&ConnectionParams) -> Result<BackgroundPool, String>;

const MIN_POOL_CONNECTIONS: usize = 1;
const MAX_POOL_CONNECTIONS: usize = 10;
pub const IDLE_CONNECTION_TTL: Duration = Duration::from_secs(10 * 60);
pub const MAX_CONNECTION_LIFETIME: Duration = Duration::from_secs(30 * 60);
const POOL_RESETS_RETURNED_CONNECTIONS: bool = true;
const REPORT_MATCHED_ROWS_AS_AFFECTED: bool = true;
pub const TRANSFER_TIME_ZONE_SQL: &str = "SET time_zone='+00:00'";
pub const SERVER_VERSION_SQL: &str = "SELECT VERSION()";
pub const UNKNOWN_SERVER_VERSION: &str = "Unknown";

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

#[derive(Debug, Clone)]
pub struct BackgroundPool {
    pool: mysql_async::Pool,
    connect_timeout: Duration,
}

pub struct OpenedPool {
    pub pool: BackgroundPool,
    pub server_version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KillQuery {
    pub thread_id: u64,
    pub checkout_timeout: Duration,
}

#[derive(Debug)]
pub enum KillQueryFailure {
    Checkout(mysql_async::Error),
    Kill(mysql_async::Error),
}

impl fmt::Display for KillQueryFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Checkout(error) => {
                write!(formatter, "no pool connection for KILL QUERY: {error}")
            }
            Self::Kill(error) => write!(formatter, "KILL QUERY failed: {error}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PoolSettings {
    pub connect_timeout: Duration,
    pub max_connections: usize,
}

impl BackgroundPool {
    pub fn new(pool: mysql_async::Pool, connect_timeout: Duration) -> Self {
        Self {
            pool,
            connect_timeout,
        }
    }

    pub fn connect_lazily(opts: Opts, settings: PoolSettings) -> Self {
        let pool_opts = OptsBuilder::from_opts(opts)
            .client_found_rows(REPORT_MATCHED_ROWS_AS_AFFECTED)
            .pool_opts(background_pool_options(settings.max_connections));
        Self::new(mysql_async::Pool::new(pool_opts), settings.connect_timeout)
    }

    pub fn connect_timeout(&self) -> Duration {
        self.connect_timeout
    }

    pub async fn checkout(&self) -> Result<Conn, mysql_async::Error> {
        checkout_within_timeout(&self.pool, self.connect_timeout).await
    }

    pub async fn disconnect(self) -> Result<(), mysql_async::Error> {
        self.pool.disconnect().await
    }

    pub fn disconnect_in_background(self, purpose: &'static str) {
        tokio::spawn(self.disconnect_logging_failure(purpose));
    }

    async fn disconnect_logging_failure(self, purpose: &'static str) {
        let Err(error) = self.disconnect().await else {
            return;
        };
        tracing::warn!(purpose, ?error, "background pool disconnect failed");
    }

    #[cfg(not(coverage))]
    pub async fn checkout_for_transfer(&self) -> Result<Conn, String> {
        use crate::mysql::logged_query::{execute, LoggedStatement};

        let mut conn = self.checkout().await.map_err(|error| error.to_string())?;
        execute(&mut conn, LoggedStatement::text(TRANSFER_TIME_ZONE_SQL))
            .await
            .map_err(|error| format!("Failed to set the transfer time zone: {error}"))?;
        Ok(conn)
    }

    #[cfg(coverage)]
    pub async fn checkout_for_transfer(&self) -> Result<Conn, String> {
        let _ = TRANSFER_TIME_ZONE_SQL;
        self.checkout().await.map_err(|error| error.to_string())
    }

    #[cfg(not(coverage))]
    pub async fn kill_query(&self, kill: KillQuery) -> Result<(), KillQueryFailure> {
        use crate::mysql::logged_query::{execute, LoggedStatement};

        let mut conn = checkout_within_timeout(&self.pool, kill.checkout_timeout)
            .await
            .map_err(KillQueryFailure::Checkout)?;
        let kill_sql = kill_query_sql(kill.thread_id);
        execute(&mut conn, LoggedStatement::text(&kill_sql))
            .await
            .map_err(KillQueryFailure::Kill)?;
        Ok(())
    }

    #[cfg(coverage)]
    pub async fn kill_query(&self, kill: KillQuery) -> Result<(), KillQueryFailure> {
        let _ = kill_query_sql(kill.thread_id);
        let checkout_failure =
            crate::mysql::connection_options::connect_timed_out_error(kill.checkout_timeout);
        Err(KillQueryFailure::Checkout(checkout_failure))
    }
}

pub fn kill_query_sql(thread_id: u64) -> String {
    format!("KILL QUERY {thread_id}")
}

pub fn connection_thread_id(conn: &Conn) -> u64 {
    u64::from(conn.id())
}

pub fn background_pool_options(max_connections: usize) -> PoolOpts {
    let constraints = PoolConstraints::new(MIN_POOL_CONNECTIONS, max_connections)
        .expect("pool constraints keep the minimum below the maximum");
    PoolOpts::default()
        .with_constraints(constraints)
        .with_inactive_connection_ttl(IDLE_CONNECTION_TTL)
        .with_abs_conn_ttl(Some(MAX_CONNECTION_LIFETIME))
        .with_reset_connection(POOL_RESETS_RETURNED_CONNECTIONS)
}

#[cfg(any(test, feature = "test-utils"))]
pub fn set_test_pool_factory(factory: Option<TestPoolFactory>) {
    let mut guard = TEST_POOL_FACTORY
        .lock()
        .expect("test pool factory lock poisoned");
    *guard = factory;
}

#[cfg(any(test, feature = "test-utils"))]
fn create_test_pool(params: &ConnectionParams) -> Option<Result<BackgroundPool, String>> {
    let factory = *TEST_POOL_FACTORY
        .lock()
        .expect("test pool factory lock poisoned");
    factory.map(|create| create(params))
}

fn connect_background_pool(params: &ConnectionParams) -> Result<BackgroundPool, String> {
    let settings = PoolSettings {
        connect_timeout: connect_timeout(params),
        max_connections: MAX_POOL_CONNECTIONS,
    };
    Ok(BackgroundPool::connect_lazily(
        mysql_opts(params)?,
        settings,
    ))
}

pub async fn create_pool(params: &ConnectionParams) -> Result<BackgroundPool, String> {
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(test_pool) = create_test_pool(params) {
        return test_pool;
    }

    let pool = connect_background_pool(params)?;
    let validation_checkout = pool.checkout().await.map_err(|error| error.to_string())?;
    drop(validation_checkout);
    Ok(pool)
}

pub async fn create_pool_reading_version(params: &ConnectionParams) -> Result<OpenedPool, String> {
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(test_pool) = create_test_pool(params) {
        return opened_test_pool(test_pool?).await;
    }

    let pool = connect_background_pool(params)?;
    let mut validation_checkout = pool.checkout().await.map_err(|error| error.to_string())?;
    let server_version = read_server_version(&mut validation_checkout).await;
    Ok(OpenedPool {
        pool,
        server_version,
    })
}

#[cfg(any(test, feature = "test-utils"))]
async fn opened_test_pool(pool: BackgroundPool) -> Result<OpenedPool, String> {
    let server_version = match pool.checkout().await {
        Ok(mut conn) => read_server_version(&mut conn).await,
        Err(error) => {
            tracing::warn!(?error, "reading the server version failed");
            UNKNOWN_SERVER_VERSION.to_string()
        }
    };
    Ok(OpenedPool {
        pool,
        server_version,
    })
}

async fn read_server_version(conn: &mut Conn) -> String {
    use crate::mysql::logged_query::{fetch_first_decoded, LoggedStatement};

    let statement = LoggedStatement::text(SERVER_VERSION_SQL);
    let version = match fetch_first_decoded(conn, statement).await {
        Ok(first_row) => first_row.and_then(|row| row.required_text(0).ok()),
        Err(error) => {
            tracing::warn!(?error, "reading the server version failed");
            None
        }
    };
    version.unwrap_or_else(|| UNKNOWN_SERVER_VERSION.to_string())
}
