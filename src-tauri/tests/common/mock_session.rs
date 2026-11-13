//! Registers an in-process mock MySQL server as an open connection in `AppState`.

use opensrv_mysql::{ColumnFlags, ColumnType};
use sqllumen_lib::mysql::pool::SslSettings;
use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
use sqllumen_lib::state::AppState;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use std::time::Duration;

use crate::common::mock_mysql_server::MockColumnDef;

const MOCK_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(10);

pub fn mock_pool(port: u16) -> sqlx::MySqlPool {
    let options = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(port)
        .username("root")
        .password("");
    MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(MOCK_ACQUIRE_TIMEOUT)
        .connect_lazy_with(options)
}

pub fn register_mock_pool(state: &AppState, connection_id: &str, pool: sqlx::MySqlPool) {
    let entry = RegistryEntry {
        pool,
        session_id: connection_id.to_string(),
        profile_id: connection_id.to_string(),
        status: ConnectionStatus::Connected,
        server_version: "8.0.0".to_string(),
        cancellation_token: tokio_util::sync::CancellationToken::new(),
        connection_params: StoredConnectionParams {
            profile_id: connection_id.to_string(),
            host: "127.0.0.1".to_string(),
            port: 13306,
            username: "root".to_string(),
            has_password: false,
            keychain_ref: None,
            default_database: None,
            ssl: SslSettings {
                enabled: false,
                ca_path: None,
                cert_path: None,
                key_path: None,
            },
            connect_timeout_secs: 10,
            keepalive_interval_secs: 0,
        },
        read_only: false,
    };
    state.registry.insert(connection_id.to_string(), entry);
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
