//! Registers an in-process mock MySQL server as an open connection in `AppState`.

use opensrv_mysql::{ColumnFlags, ColumnType};
use sqllumen_lib::mysql::connection_options::mysql_opts;
use sqllumen_lib::mysql::pool::{BackgroundPool, ConnectionParams, PoolSettings, SslSettings};
use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
use sqllumen_lib::state::AppState;
use std::time::Duration;

use crate::common::mock_mysql_server::MockColumnDef;

pub const MOCK_CONNECT_TIMEOUT_SECS: u64 = 1;
pub const MOCK_POOL_MAX_CONNECTIONS: usize = 2;
pub const MOCK_USERNAME: &str = "root";
pub const MOCK_HOST: &str = "127.0.0.1";

pub fn mock_connection_input(port: u16) -> ConnectionParams {
    ConnectionParams {
        host: MOCK_HOST.to_string(),
        port,
        username: MOCK_USERNAME.to_string(),
        password: String::new(),
        default_database: None,
        ssl: SslSettings::default(),
        connect_timeout_secs: MOCK_CONNECT_TIMEOUT_SECS,
    }
}

pub fn mock_pool_with_params(params: &ConnectionParams) -> BackgroundPool {
    let opts = mysql_opts(params).expect("mock connection options are valid");
    let settings = PoolSettings {
        connect_timeout: Duration::from_secs(params.connect_timeout_secs),
        max_connections: MOCK_POOL_MAX_CONNECTIONS,
    };
    BackgroundPool::connect_lazily(opts, settings)
}

pub fn mock_pool(port: u16) -> BackgroundPool {
    mock_pool_with_params(&mock_connection_input(port))
}

/// A held connection opened straight through mysql_async, so it also works in coverage builds.
pub async fn mock_connection(port: u16) -> mysql_async::Conn {
    let opts = mysql_opts(&mock_connection_input(port)).expect("mock connection options are valid");
    mysql_async::Conn::new(opts)
        .await
        .expect("the mock server accepts the connection")
}

pub fn mock_connection_params(connection_id: &str, port: u16) -> StoredConnectionParams {
    StoredConnectionParams {
        profile_id: connection_id.to_string(),
        host: MOCK_HOST.to_string(),
        port,
        username: MOCK_USERNAME.to_string(),
        has_password: false,
        keychain_ref: None,
        default_database: None,
        ssl: SslSettings {
            enabled: false,
            ca_path: None,
            cert_path: None,
            key_path: None,
        },
        connect_timeout_secs: MOCK_CONNECT_TIMEOUT_SECS,
        keepalive_interval_secs: 0,
    }
}

pub fn register_mock_pool(state: &AppState, connection_id: &str, pool: BackgroundPool) {
    let params = mock_connection_params(connection_id, 13306);
    register_mock_connection(state, pool, params);
}

pub fn register_mock_connection(
    state: &AppState,
    pool: BackgroundPool,
    connection_params: StoredConnectionParams,
) {
    let connection_id = connection_params.profile_id.clone();
    let entry = RegistryEntry {
        pool,
        session_id: connection_id.clone(),
        profile_id: connection_id.clone(),
        status: ConnectionStatus::Connected,
        server_version: "8.0.0".to_string(),
        cancellation_token: tokio_util::sync::CancellationToken::new(),
        connection_params,
        read_only: false,
    };
    state.registry.insert(connection_id, entry);
}

pub fn text_column(name: &'static str) -> MockColumnDef {
    MockColumnDef {
        name,
        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
        colflags: ColumnFlags::empty(),
    }
}

pub fn integer_column(name: &'static str) -> MockColumnDef {
    MockColumnDef {
        name,
        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
        colflags: ColumnFlags::empty(),
    }
}

pub const UNREACHABLE_MYSQL_PORT: u16 = 13306;

/// A lazily connecting pool aimed at a port nothing listens on.
pub fn unreachable_pool() -> BackgroundPool {
    mock_pool(UNREACHABLE_MYSQL_PORT)
}
