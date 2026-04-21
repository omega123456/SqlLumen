//! Integration tests for processlist commands (`commands/processlist.rs`).
//!
//! Tests that open real MySQL connections via `MockMySqlServer` are gated
//! behind `#[cfg(not(coverage))]` because the `#[cfg(coverage)]` build
//! stubs out `open_connection_impl` (it creates a pool, immediately closes
//! it, and never registers the session in the connection registry).
//! This matches the pattern used in `table_data_integration.rs`.

mod common;

#[cfg(not(coverage))]
use common::mock_mysql_server::{
    MockCell, MockColumnDef, MockMySqlServer, MockQueryStep,
};
#[cfg(not(coverage))]
use opensrv_mysql::{ColumnFlags, ColumnType};
#[cfg(not(coverage))]
use sqllumen_lib::commands::connections::{save_connection_impl, SaveConnectionInput};
#[cfg(not(coverage))]
use sqllumen_lib::commands::mysql::open_connection_impl;
use sqllumen_lib::commands::processlist::{get_processlist_impl, kill_queries_impl};
#[cfg(not(coverage))]
use sqllumen_lib::state::AppState;

#[cfg(not(coverage))]
fn save_input(port: u16) -> SaveConnectionInput {
    SaveConnectionInput {
        name: "Test DB".to_string(),
        host: "127.0.0.1".to_string(),
        port: port.into(),
        username: "root".to_string(),
        password: None,
        default_database: None,
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        color: None,
        group_id: None,
        read_only: false,
        sort_order: 0,
        connect_timeout_secs: Some(30),
        keepalive_interval_secs: Some(60),
    }
}

#[cfg(not(coverage))]
fn save_input_read_only(port: u16) -> SaveConnectionInput {
    SaveConnectionInput {
        read_only: true,
        ..save_input(port)
    }
}

#[cfg(not(coverage))]
fn processlist_steps() -> Vec<MockQueryStep> {
    vec![MockQueryStep {
        query: "SHOW FULL PROCESSLIST",
        columns: vec![
            MockColumnDef {
                name: "Id",
                coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                colflags: ColumnFlags::UNSIGNED_FLAG,
            },
            MockColumnDef {
                name: "User",
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "Host",
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "db",
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "Command",
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "Time",
                coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "State",
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            },
            MockColumnDef {
                name: "Info",
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            },
        ],
        rows: vec![vec![
            MockCell::U64(42),
            MockCell::Bytes(b"root"),
            MockCell::Bytes(b"localhost:3306"),
            MockCell::Bytes(b"mydb"),
            MockCell::Bytes(b"Query"),
            MockCell::I64(5),
            MockCell::Bytes(b"executing"),
            MockCell::Bytes(b"SELECT 1"),
        ]],
        error: None,
    }]
}

#[cfg(not(coverage))]
async fn open_session(state: &AppState, port: u16, read_only: bool) -> String {
    let input = if read_only {
        save_input_read_only(port)
    } else {
        save_input(port)
    };
    let profile_id = save_connection_impl(state, input).expect("save");
    let result = open_connection_impl(state, &profile_id)
        .await
        .expect("open");
    result.session_id
}

#[cfg(not(coverage))]
#[tokio::test]
async fn test_get_processlist_returns_rows() {
    common::ensure_fake_backend_once();
    let state = common::test_app_state();

    let server = MockMySqlServer::start_script(processlist_steps()).await;

    let session_id = open_session(&state, server.port, false).await;
    let rows = get_processlist_impl(&state, &session_id)
        .await
        .expect("should get processlist");
    assert!(!rows.is_empty());
    assert_eq!(rows[0].id, 42);
    assert_eq!(rows[0].user, "root");
    assert_eq!(rows[0].host, "localhost:3306");
    assert_eq!(rows[0].db.as_deref(), Some("mydb"));
    assert_eq!(rows[0].command, "Query");
    assert_eq!(rows[0].time, 5);
    assert_eq!(rows[0].state.as_deref(), Some("executing"));
    assert_eq!(rows[0].info.as_deref(), Some("SELECT 1"));
}

#[tokio::test]
async fn test_get_processlist_invalid_session() {
    common::ensure_fake_backend_once();
    let state = common::test_app_state();
    let result = get_processlist_impl(&state, "nonexistent").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[cfg(not(coverage))]
#[tokio::test]
async fn test_kill_queries_read_only() {
    common::ensure_fake_backend_once();
    let state = common::test_app_state();

    let server = MockMySqlServer::start_script(processlist_steps()).await;
    let session_id = open_session(&state, server.port, true).await;

    let result = kill_queries_impl(&state, &session_id, vec![42]).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("read-only"));
}

#[tokio::test]
async fn test_kill_queries_invalid_session() {
    common::ensure_fake_backend_once();
    let state = common::test_app_state();
    let result = kill_queries_impl(&state, "nonexistent", vec![1]).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[cfg(not(coverage))]
#[tokio::test]
async fn test_kill_queries_returns_results() {
    common::ensure_fake_backend_once();
    let state = common::test_app_state();

    // The mock server will return OK for any unknown query (including KILL QUERY)
    let server = MockMySqlServer::start_script(processlist_steps()).await;
    let session_id = open_session(&state, server.port, false).await;

    let results = kill_queries_impl(&state, &session_id, vec![42, 99])
        .await
        .expect("should kill queries");
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].id, 42);
    assert!(results[0].success);
    assert_eq!(results[1].id, 99);
    assert!(results[1].success);
}
