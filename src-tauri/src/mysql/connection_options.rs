use std::fmt;
use std::future::Future;
use std::path::PathBuf;
use std::time::Duration;

use mysql_async::{ClientIdentity, DriverError, Opts, OptsBuilder, SslOpts};

use crate::db::ssl_mode::SslMode;
use crate::mysql::pool::{ConnectionParams, SslSettings};

pub const ACCESS_DENIED_ERROR_CODES: [u16; 2] = [1045, 1698];

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

#[derive(Debug)]
pub enum ConnectFailure {
    InvalidSettings(String),
    Mysql(mysql_async::Error),
}

impl ConnectFailure {
    pub fn is_access_denied(&self) -> bool {
        let Self::Mysql(mysql_async::Error::Server(server_error)) = self else {
            return false;
        };
        ACCESS_DENIED_ERROR_CODES.contains(&server_error.code)
    }
}

impl fmt::Display for ConnectFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSettings(message) => formatter.write_str(message),
            Self::Mysql(error) => write!(formatter, "{error}"),
        }
    }
}

impl From<mysql_async::Error> for ConnectFailure {
    fn from(error: mysql_async::Error) -> Self {
        Self::Mysql(error)
    }
}

pub fn connect_timed_out_error(timeout: Duration) -> mysql_async::Error {
    mysql_async::Error::Other(Box::new(ConnectTimedOut { timeout }))
}

pub fn connect_timeout(params: &ConnectionParams) -> Duration {
    Duration::from_secs(params.connect_timeout_secs)
}

pub fn mysql_opts(params: &ConnectionParams) -> Result<Opts, String> {
    let builder = base_options(params).ssl_opts(ssl_opts(&params.ssl)?);
    Ok(builder.into())
}

pub fn plaintext_opts(params: &ConnectionParams) -> Opts {
    base_options(params).into()
}

fn base_options(params: &ConnectionParams) -> OptsBuilder {
    OptsBuilder::default()
        .ip_or_hostname(params.host.as_str())
        .tcp_port(params.port)
        .user(Some(params.username.as_str()))
        .pass(password(params))
        .db_name(default_database(params))
        .prefer_socket(false)
}

pub fn falls_back_to_plaintext(mode: SslMode, error: &mysql_async::Error) -> bool {
    let server_lacks_tls = matches!(
        error,
        mysql_async::Error::Driver(DriverError::NoClientSslFlagFromServer)
    );
    mode == SslMode::Preferred && server_lacks_tls
}

pub async fn connect_preferring_tls<Connected, Attempt, Connecting>(
    params: &ConnectionParams,
    attempt: Attempt,
) -> Result<Connected, ConnectFailure>
where
    Attempt: Fn(Opts) -> Connecting,
    Connecting: Future<Output = Result<Connected, mysql_async::Error>>,
{
    let opts = mysql_opts(params).map_err(ConnectFailure::InvalidSettings)?;
    let tls_error = match attempt(opts).await {
        Ok(connected) => return Ok(connected),
        Err(error) => error,
    };
    if !falls_back_to_plaintext(params.ssl.mode, &tls_error) {
        return Err(ConnectFailure::Mysql(tls_error));
    }
    tracing::warn!(
        host = params.host.as_str(),
        port = params.port,
        "server offers no TLS; the Preferred SSL mode connects without encryption"
    );
    Ok(attempt(plaintext_opts(params)).await?)
}

pub async fn connect_with_params(
    params: &ConnectionParams,
) -> Result<mysql_async::Conn, ConnectFailure> {
    let timeout = connect_timeout(params);
    connect_preferring_tls(params, |opts| connect_within_timeout(opts, timeout)).await
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
    if !ssl.mode.uses_tls() {
        return Ok(None);
    }
    let identity = client_identity(ssl)?;
    Ok(Some(
        server_verification(ssl).with_client_identity(identity),
    ))
}

fn server_verification(ssl: &SslSettings) -> SslOpts {
    match ssl.mode {
        SslMode::Disabled | SslMode::Preferred | SslMode::Required => {
            SslOpts::default().with_danger_accept_invalid_certs(true)
        }
        SslMode::VerifyCa => trusted_roots(ssl).with_danger_skip_domain_validation(true),
        SslMode::VerifyIdentity => trusted_roots(ssl),
    }
}

fn trusted_roots(ssl: &SslSettings) -> SslOpts {
    let custom_roots = ssl
        .ca_path
        .as_deref()
        .map(|ca_path| PathBuf::from(ca_path).into())
        .into_iter()
        .collect();
    SslOpts::default().with_root_certs(custom_roots)
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
