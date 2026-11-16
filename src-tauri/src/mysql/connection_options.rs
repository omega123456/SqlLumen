use std::fmt;
use std::path::PathBuf;
use std::time::Duration;

use mysql_async::{ClientIdentity, Opts, OptsBuilder, SslOpts};

use crate::mysql::pool::{ConnectionParams, SslSettings};

pub const CLIENT_IDENTITY_INCOMPLETE_MESSAGE: &str =
    "TLS configuration error: the client certificate and the client key must be given together";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConnectTimedOut {
    pub timeout: Duration,
}

impl fmt::Display for ConnectTimedOut {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "connecting to MySQL timed out after {} s",
            self.timeout.as_secs()
        )
    }
}

impl std::error::Error for ConnectTimedOut {}

pub fn connect_timed_out_error(timeout: Duration) -> mysql_async::Error {
    mysql_async::Error::Other(Box::new(ConnectTimedOut { timeout }))
}

pub fn connect_timeout(params: &ConnectionParams) -> Duration {
    Duration::from_secs(params.connect_timeout_secs)
}

pub fn mysql_opts(params: &ConnectionParams) -> Result<Opts, String> {
    let builder = OptsBuilder::default()
        .ip_or_hostname(params.host.as_str())
        .tcp_port(params.port)
        .user(Some(params.username.as_str()))
        .pass(password(params))
        .db_name(default_database(params))
        .prefer_socket(false)
        .ssl_opts(ssl_opts(&params.ssl)?);
    Ok(builder.into())
}

fn password(params: &ConnectionParams) -> Option<&str> {
    Some(params.password.as_str()).filter(|password| !password.is_empty())
}

fn default_database(params: &ConnectionParams) -> Option<&str> {
    params
        .default_database
        .as_deref()
        .filter(|database| !database.is_empty())
}

fn ssl_opts(ssl: &SslSettings) -> Result<Option<SslOpts>, String> {
    if !ssl.enabled {
        return Ok(None);
    }
    let identity = client_identity(ssl)?;
    Ok(Some(
        server_verification(ssl).with_client_identity(identity),
    ))
}

fn server_verification(ssl: &SslSettings) -> SslOpts {
    let Some(ca_path) = ssl.ca_path.as_deref() else {
        return SslOpts::default().with_danger_accept_invalid_certs(true);
    };
    SslOpts::default()
        .with_root_certs(vec![PathBuf::from(ca_path).into()])
        .with_danger_skip_domain_validation(true)
}

fn client_identity(ssl: &SslSettings) -> Result<Option<ClientIdentity>, String> {
    match (ssl.cert_path.as_deref(), ssl.key_path.as_deref()) {
        (None, None) => Ok(None),
        (Some(cert_path), Some(key_path)) => Ok(Some(ClientIdentity::new(
            PathBuf::from(cert_path).into(),
            PathBuf::from(key_path).into(),
        ))),
        _ => Err(CLIENT_IDENTITY_INCOMPLETE_MESSAGE.to_string()),
    }
}

#[cfg(not(coverage))]
async fn within_connect_timeout<F>(
    connecting: F,
    timeout: Duration,
) -> Result<mysql_async::Conn, mysql_async::Error>
where
    F: std::future::Future<Output = Result<mysql_async::Conn, mysql_async::Error>>,
{
    tokio::time::timeout(timeout, connecting)
        .await
        .unwrap_or_else(|_| Err(connect_timed_out_error(timeout)))
}

#[cfg(not(coverage))]
pub async fn connect_within_timeout(
    opts: Opts,
    timeout: Duration,
) -> Result<mysql_async::Conn, mysql_async::Error> {
    within_connect_timeout(mysql_async::Conn::new(opts), timeout).await
}

#[cfg(coverage)]
pub async fn connect_within_timeout(
    opts: Opts,
    timeout: Duration,
) -> Result<mysql_async::Conn, mysql_async::Error> {
    let _ = opts;
    Err(connect_timed_out_error(timeout))
}

#[cfg(not(coverage))]
pub async fn checkout_within_timeout(
    pool: &mysql_async::Pool,
    timeout: Duration,
) -> Result<mysql_async::Conn, mysql_async::Error> {
    within_connect_timeout(pool.get_conn(), timeout).await
}

#[cfg(coverage)]
pub async fn checkout_within_timeout(
    pool: &mysql_async::Pool,
    timeout: Duration,
) -> Result<mysql_async::Conn, mysql_async::Error> {
    let _ = pool;
    Err(connect_timed_out_error(timeout))
}
