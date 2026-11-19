use crate::common;
use sqllumen_lib::mysql::pool::SslSettings;

use sqllumen_lib::credentials;
use sqllumen_lib::mysql::pool::{BackgroundPool, PoolSettings};
use sqllumen_lib::mysql::registry::{
    ConnectionRegistry, ConnectionStatus, RegistryEntry, StoredConnectionParams,
};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

const LIVE_POOL_SETTINGS: PoolSettings = PoolSettings {
    connect_timeout: Duration::from_secs(10),
    max_connections: 1,
};

fn dummy_pool() -> BackgroundPool {
    common::mock_session::unreachable_pool()
}

fn live_pool(url: &str) -> BackgroundPool {
    let opts = mysql_async::Opts::from_url(url).expect("MYSQL_TEST_URL should parse");
    BackgroundPool::connect_lazily(opts, LIVE_POOL_SETTINGS)
}

fn dummy_params() -> StoredConnectionParams {
    StoredConnectionParams {
        profile_id: "profile-dummy".to_string(),
        host: "127.0.0.1".to_string(),
        port: 13306,
        username: "dummy".to_string(),
        has_password: true,
        keychain_ref: Some("dummy".to_string()),
        default_database: None,
        ssl: SslSettings::default(),
        connect_timeout_secs: 10,
        keepalive_interval_secs: 60,
        session_password: None,
    }
}

#[test]
fn test_stored_connection_params_clone() {
    let params = dummy_params();
    let cloned = params.clone();
    assert_eq!(cloned.host, "127.0.0.1");
    assert_eq!(cloned.port, 13306);
    assert_eq!(cloned.username, "dummy");
    assert!(cloned.has_password);
    assert_eq!(cloned.connect_timeout_secs, 10);
    assert_eq!(cloned.keepalive_interval_secs, 60);
}

#[test]
fn test_stored_connection_params_to_connection_params() {
    let stored = dummy_params();
    let conn = stored.to_connection_params("s3cret".to_string());
    assert_eq!(conn.host, "127.0.0.1");
    assert_eq!(conn.port, 13306);
    assert_eq!(conn.username, "dummy");
    assert_eq!(conn.password, "s3cret");
    assert_eq!(conn.default_database, None);
    assert_eq!(conn.ssl, SslSettings::default());
    assert_eq!(conn.connect_timeout_secs, 10);
}

fn dummy_entry(id: &str) -> RegistryEntry {
    RegistryEntry {
        pool: dummy_pool(),
        session_id: id.to_string(),
        profile_id: "profile-dummy".to_string(),
        status: ConnectionStatus::Connected,
        server_version: "8.0.0".to_string(),
        cancellation_token: CancellationToken::new(),
        connection_params: dummy_params(),
        read_only: false,
    }
}

// --- Registry Tests ---

#[tokio::test]
async fn test_registry_insert_and_contains() {
    let registry = ConnectionRegistry::new();

    let entry = dummy_entry("test-1");

    registry.insert("test-1".to_string(), entry);
    assert!(registry.contains("test-1"));
    assert!(!registry.contains("test-2"));
}

#[tokio::test]
async fn test_registry_get_pool() {
    let registry = ConnectionRegistry::new();

    let entry = dummy_entry("test-1");

    registry.insert("test-1".to_string(), entry);

    let retrieved = registry.get_pool("test-1");
    assert!(retrieved.is_some());

    let missing = registry.get_pool("test-999");
    assert!(missing.is_none());
}

#[tokio::test]
async fn test_registry_get_and_update_status() {
    let registry = ConnectionRegistry::new();

    let entry = dummy_entry("test-1");

    registry.insert("test-1".to_string(), entry);

    assert_eq!(
        registry.get_status("test-1"),
        Some(ConnectionStatus::Connected)
    );

    registry.update_status("test-1", ConnectionStatus::Reconnecting);
    assert_eq!(
        registry.get_status("test-1"),
        Some(ConnectionStatus::Reconnecting)
    );

    registry.update_status("test-1", ConnectionStatus::Disconnected);
    assert_eq!(
        registry.get_status("test-1"),
        Some(ConnectionStatus::Disconnected)
    );
}

#[tokio::test]
async fn test_registry_remove() {
    let registry = ConnectionRegistry::new();

    let entry = dummy_entry("test-1");

    registry.insert("test-1".to_string(), entry);

    let removed = registry.remove("test-1");
    assert!(removed.is_some());
    assert!(!registry.contains("test-1"));

    let removed_again = registry.remove("test-1");
    assert!(removed_again.is_none());
}

#[tokio::test]
async fn test_registry_get_status_returns_none_for_missing() {
    let registry = ConnectionRegistry::new();
    assert_eq!(registry.get_status("nonexistent"), None);
}

#[tokio::test]
async fn test_registry_update_status_noop_for_missing() {
    let registry = ConnectionRegistry::new();
    // Should not panic
    registry.update_status("nonexistent", ConnectionStatus::Connected);
}

#[tokio::test]
async fn test_registry_get_pool_by_profile_returns_none_when_empty() {
    let registry = ConnectionRegistry::new();
    assert!(registry.get_pool_by_profile("missing-profile").is_none());
}

#[tokio::test]
async fn test_registry_default_matches_new() {
    let registry = ConnectionRegistry::default();
    assert!(!registry.contains("anything"));
    assert!(registry.get_pool_by_profile("missing-profile").is_none());
}

// --- Registry Health Monitor Support Tests ---

#[tokio::test]
async fn test_registry_remove_cancels_token() {
    let registry = ConnectionRegistry::new();
    let entry = dummy_entry("test-health-1");
    let token_clone = entry.cancellation_token.clone();

    registry.insert("test-health-1".to_string(), entry);
    assert!(
        !token_clone.is_cancelled(),
        "token should not be cancelled before remove"
    );

    registry.remove("test-health-1");
    assert!(
        token_clone.is_cancelled(),
        "token should be cancelled after remove"
    );
}

#[tokio::test]
async fn test_registry_insert_replacement_cancels_old_token() {
    let registry = ConnectionRegistry::new();
    let entry1 = dummy_entry("test-replace");
    let token1_clone = entry1.cancellation_token.clone();

    registry.insert("test-replace".to_string(), entry1);
    assert!(!token1_clone.is_cancelled());

    // Insert a replacement entry with the same ID
    let entry2 = dummy_entry("test-replace");
    let token2_clone = entry2.cancellation_token.clone();
    let old = registry.insert("test-replace".to_string(), entry2);

    assert!(
        old.is_some(),
        "insert should return old entry on replacement"
    );
    assert!(
        token1_clone.is_cancelled(),
        "old token should be cancelled on replacement"
    );
    assert!(
        !token2_clone.is_cancelled(),
        "new token should still be active"
    );
}

#[tokio::test]
async fn test_registry_replace_pool() {
    let registry = ConnectionRegistry::new();
    let entry = dummy_entry("test-pool-replace");
    registry.insert("test-pool-replace".to_string(), entry);

    // Replace with a new pool
    let new_pool = dummy_pool();
    registry.replace_pool("test-pool-replace", new_pool);

    // Should still be accessible
    assert!(registry.get_pool("test-pool-replace").is_some());
}

#[tokio::test]
async fn test_registry_replace_pool_noop_for_missing() {
    let registry = ConnectionRegistry::new();
    // Should not panic
    registry.replace_pool("nonexistent", dummy_pool());
}

#[tokio::test]
async fn test_registry_get_connection_params() {
    let registry = ConnectionRegistry::new();
    let entry = dummy_entry("test-params");
    registry.insert("test-params".to_string(), entry);

    let params = registry.get_connection_params("test-params");
    assert!(params.is_some());
    let params = params.unwrap();
    assert_eq!(params.host, "127.0.0.1");
    assert_eq!(params.port, 13306);
    assert_eq!(params.username, "dummy");
    assert!(params.has_password);
    assert_eq!(params.connect_timeout_secs, 10);
    assert_eq!(params.keepalive_interval_secs, 60);
}

#[tokio::test]
async fn test_registry_get_connection_params_returns_none_for_missing() {
    let registry = ConnectionRegistry::new();
    assert!(registry.get_connection_params("nonexistent").is_none());
}

#[tokio::test]
async fn test_registry_set_default_database_updates_existing_entry() {
    let registry = ConnectionRegistry::new();
    let entry = dummy_entry("test-db-default");
    registry.insert("test-db-default".to_string(), entry);

    registry.set_default_database("test-db-default", Some("analytics_db".to_string()));

    let params = registry
        .get_connection_params("test-db-default")
        .expect("params should exist");
    assert_eq!(params.default_database.as_deref(), Some("analytics_db"));
}

#[tokio::test]
async fn test_registry_set_default_database_noop_for_missing_entry() {
    let registry = ConnectionRegistry::new();
    registry.set_default_database("missing", Some("analytics_db".to_string()));
    assert!(registry.get_connection_params("missing").is_none());
}

#[tokio::test]
async fn test_registry_lists_sessions_in_runtime_id_order() {
    let registry = ConnectionRegistry::new();
    let mut second = dummy_entry("session-b");
    second.profile_id = "profile-b".to_string();
    second.status = ConnectionStatus::Reconnecting;
    second.connection_params.default_database = Some("analytics".to_string());
    let mut first = dummy_entry("session-a");
    first.profile_id = "profile-a".to_string();
    first.status = ConnectionStatus::Disconnected;

    registry.insert("session-b".to_string(), second);
    registry.insert("session-a".to_string(), first);

    let sessions = registry.list_sessions();
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0].session_id, "session-a");
    assert_eq!(sessions[0].profile_id, "profile-a");
    assert_eq!(sessions[0].status, ConnectionStatus::Disconnected);
    assert_eq!(sessions[1].session_id, "session-b");
    assert_eq!(sessions[1].profile_id, "profile-b");
    assert_eq!(sessions[1].status, ConnectionStatus::Reconnecting);
    assert_eq!(sessions[1].session_database.as_deref(), Some("analytics"));
}

// --- Credential Tests (in-memory test backend; no OS keychain) ---

#[test]
fn test_credential_store_and_retrieve() {
    common::ensure_fake_backend_once();
    let test_id = format!("test-cred-{}", uuid::Uuid::new_v4());

    credentials::store_password(&test_id, "my_secret_password").expect("should store password");

    let retrieved = credentials::get_password(&test_id).expect("should retrieve password");
    assert_eq!(retrieved.as_deref(), Some("my_secret_password"));

    credentials::delete_password(&test_id).expect("should delete password");
}

#[test]
fn test_credential_overwrite() {
    common::ensure_fake_backend_once();
    let test_id = format!("test-cred-ow-{}", uuid::Uuid::new_v4());

    credentials::store_password(&test_id, "first_password").expect("should store");
    credentials::store_password(&test_id, "second_password").expect("should overwrite");

    let retrieved = credentials::get_password(&test_id).expect("should retrieve");
    assert_eq!(retrieved.as_deref(), Some("second_password"));

    credentials::delete_password(&test_id).expect("should delete");
}

#[test]
fn test_credential_delete() {
    common::ensure_fake_backend_once();
    let test_id = format!("test-cred-del-{}", uuid::Uuid::new_v4());

    credentials::store_password(&test_id, "temp_password").expect("should store");
    credentials::delete_password(&test_id).expect("should delete");

    let result = credentials::get_password(&test_id).expect("lookup should succeed");
    assert!(result.is_none(), "should not retrieve deleted password");
}

#[test]
fn test_credential_retrieve_nonexistent() {
    common::ensure_fake_backend_once();
    let test_id = format!("test-cred-none-{}", uuid::Uuid::new_v4());
    let result = credentials::get_password(&test_id).expect("lookup should succeed");
    assert!(
        result.is_none(),
        "should return none for nonexistent credential"
    );
}

// --- Pool Creation Tests (require live MySQL) ---

#[test]
fn test_pool_creation_with_live_mysql() {
    let url = match std::env::var("MYSQL_TEST_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Skipping test_pool_creation_with_live_mysql: MYSQL_TEST_URL not set");
            return;
        }
    };

    let rt = tokio::runtime::Runtime::new().expect("should create tokio runtime");
    rt.block_on(async {
        use sqllumen_lib::mysql::logged_query::{fetch_first_decoded_pooled, LoggedStatement};

        let pool = live_pool(&url);
        let row = fetch_first_decoded_pooled(&pool, LoggedStatement::text("SELECT VERSION()"))
            .await
            .expect("should execute query")
            .expect("should return a row");

        let version = row.required_text(0).expect("version text");
        assert!(!version.is_empty(), "should return server version");

        pool.disconnect().await.expect("pool disconnects");
    });
}

#[test]
fn test_create_pool_with_live_mysql() {
    let url = match std::env::var("MYSQL_TEST_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Skipping test_create_pool_with_live_mysql: MYSQL_TEST_URL not set");
            return;
        }
    };

    // Parse URL manually: mysql://user:pass@host:port/database
    let url_str = url
        .strip_prefix("mysql://")
        .expect("MYSQL_TEST_URL should start with mysql://");
    let (auth, rest) = url_str.split_once('@').expect("should have @");
    let (user, pass) = auth.split_once(':').unwrap_or((auth, ""));
    let (host_port, db) = rest.split_once('/').unwrap_or((rest, ""));
    let (host, port_str) = host_port.split_once(':').unwrap_or((host_port, "3306"));
    let port: u16 = port_str.parse().expect("should parse port");
    let database = if db.is_empty() {
        None
    } else {
        Some(db.to_string())
    };

    let rt = tokio::runtime::Runtime::new().expect("should create tokio runtime");
    rt.block_on(async {
        use sqllumen_lib::mysql::pool::{create_pool, ConnectionParams};

        let params = ConnectionParams {
            host: host.to_string(),
            port,
            username: user.to_string(),
            password: pass.to_string(),
            default_database: database,
            ssl: SslSettings::default(),
            connect_timeout_secs: 10,
        };

        let pool = create_pool(&params).await.expect("should create pool");
        pool.disconnect().await.expect("pool disconnects");
    });
}

#[cfg(not(coverage))]
async fn fetch_first_live_row(
    pool: &BackgroundPool,
    statement: sqllumen_lib::mysql::logged_query::LoggedStatement<'_>,
) -> sqllumen_lib::mysql::cell_values::DecodedRow {
    sqllumen_lib::mysql::logged_query::fetch_first_decoded_pooled(pool, statement)
        .await
        .expect("query should succeed")
        .expect("query should return a row")
}

/// `information_schema` identifier columns can be `VARBINARY` (e.g. MariaDB); the text
/// accessors must read those cells as UTF-8 text (requires `MYSQL_TEST_URL`).
#[cfg(not(coverage))]
#[tokio::test]
async fn test_schema_text_decode_accepts_varbinary_like_information_schema() {
    use sqllumen_lib::mysql::cell_values::DecodedRow;
    use sqllumen_lib::mysql::logged_query::LoggedStatement;

    let Ok(url) = std::env::var("MYSQL_TEST_URL") else {
        eprintln!(
            "Skipping test_schema_text_decode_accepts_varbinary_like_information_schema: MYSQL_TEST_URL not set"
        );
        return;
    };
    let pool = live_pool(&url);

    let row_bin: DecodedRow = fetch_first_live_row(
        &pool,
        LoggedStatement::bound(
            "SELECT CAST(? AS BINARY) AS schema_name",
            vec!["my_db_τest".into()],
        ),
    )
    .await;
    assert_eq!(
        row_bin.required_text(0).expect("indexed VARBINARY decode"),
        "my_db_τest"
    );

    let row_named = fetch_first_live_row(
        &pool,
        LoggedStatement::bound(
            "SELECT CAST(? AS BINARY) AS Key_name",
            vec!["named_idx".into()],
        ),
    )
    .await;
    assert_eq!(
        row_named
            .required_text("Key_name")
            .expect("named VARBINARY decode"),
        "named_idx"
    );

    let row_txt = fetch_first_live_row(
        &pool,
        LoggedStatement::bound(
            "SELECT CAST(? AS CHAR(64) CHARACTER SET utf8mb4) AS plain",
            vec!["utf8_plain".into()],
        ),
    )
    .await;
    assert_eq!(
        row_txt.required_text(0).expect("VARCHAR decode"),
        "utf8_plain"
    );

    let row_null = fetch_first_live_row(
        &pool,
        LoggedStatement::bound("SELECT CAST(NULL AS BINARY) AS x", vec![]),
    )
    .await;
    assert_eq!(row_null.optional_text(0).expect("optional decode"), None);

    pool.disconnect().await.expect("pool disconnects");
}

/// `insert_table_row_impl` must use the driver's `last_insert_id()` (`u64`). Decoding
/// `SELECT LAST_INSERT_ID()` as `i64` fails when the AI column is `BIGINT UNSIGNED`.
#[cfg(not(coverage))]
#[tokio::test]
async fn insert_table_row_impl_refetches_unsigned_bigint_autoincrement_pk() {
    let Some(target) =
        mysql_test_target("insert_table_row_impl_refetches_unsigned_bigint_autoincrement_pk")
    else {
        return;
    };
    let url = target.url;
    let db_name = target.database_name;

    use sqllumen_lib::mysql::metadata_cache::MetadataCache;
    use sqllumen_lib::mysql::table_data::{insert_table_row_impl, PrimaryKeyInfo};
    use std::collections::HashMap;

    let pool = live_pool(&url);

    let table = format!("__ins_unsigned_ai_{}", uuid::Uuid::new_v4().simple());

    create_unsigned_auto_increment_table(&pool, &db_name, &table).await;

    let mut values = HashMap::new();
    values.insert("label".to_string(), serde_json::json!("unsigned_ai_smoke"));
    let pk = PrimaryKeyInfo {
        key_columns: vec!["id".to_string()],
        has_auto_increment: true,
        is_unique_key_fallback: false,
    };

    let metadata_cache = MetadataCache::new();
    let insert_outcome = insert_table_row_impl(
        &pool,
        &metadata_cache,
        &sqllumen_lib::mysql::table_data::InsertTableRowRequest {
            connection_id: "mysql-test-connection".to_string(),
            database: db_name.to_string(),
            table: table.to_string(),
            values: values.clone(),
            primary_key_info: pk.clone(),
        },
    )
    .await;

    let drop_sql = format!("DROP TABLE `{}`.`{}`", db_name, table);
    let _ = sqllumen_lib::mysql::logged_query::execute_pooled(
        &pool,
        sqllumen_lib::mysql::logged_query::LoggedStatement::text(&drop_sql),
    )
    .await;

    pool.disconnect().await.expect("pool disconnects");

    let row_vec =
        insert_outcome.expect("insert should succeed for BIGINT UNSIGNED AUTO_INCREMENT PK");
    let id_cell = row_vec.iter().find(|(c, _)| c == "id").map(|(_, v)| v);
    assert!(
        id_cell.is_some_and(|v| v.as_u64().is_some_and(|n| n >= 1)),
        "expected positive numeric id in returned row, got {:?}",
        id_cell
    );
}

#[cfg(not(coverage))]
async fn create_unsigned_auto_increment_table(pool: &BackgroundPool, db_name: &str, table: &str) {
    let create_sql = format!(
        "CREATE TABLE `{}`.`{}` ( \
         `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, \
         `label` VARCHAR(64) NOT NULL, \
         PRIMARY KEY (`id`) \
         ) ENGINE=InnoDB",
        db_name, table
    );
    sqllumen_lib::mysql::logged_query::execute_pooled(
        pool,
        sqllumen_lib::mysql::logged_query::LoggedStatement::text(&create_sql),
    )
    .await
    .expect("CREATE TABLE for unsigned AI insert test");
}

#[cfg(not(coverage))]
struct MySqlTestTarget {
    url: String,
    database_name: String,
}

#[cfg(not(coverage))]
fn mysql_test_target(test_name: &str) -> Option<MySqlTestTarget> {
    let Ok(url) = std::env::var("MYSQL_TEST_URL") else {
        eprintln!("Skipping {test_name}: MYSQL_TEST_URL not set");
        return None;
    };
    let Some(after_scheme) = url.strip_prefix("mysql://") else {
        eprintln!("Skipping: MYSQL_TEST_URL must start with mysql://");
        return None;
    };
    let host_and_rest = after_scheme
        .split_once('@')
        .map_or(after_scheme, |(_, rest)| rest);
    let Some((_host_port, path)) = host_and_rest.split_once('/') else {
        eprintln!("Skipping: MYSQL_TEST_URL has no database path");
        return None;
    };
    let database_name = path.split('?').next().unwrap_or(path).trim().to_string();
    if database_name.is_empty() {
        eprintln!("Skipping: MYSQL_TEST_URL must include a database name");
        return None;
    }
    Some(MySqlTestTarget { url, database_name })
}

#[cfg(not(coverage))]
mod pool_lifecycle {
    use crate::common;
    use crate::common::mock_mysql_server::{MockMySqlServer, MockScript};
    use crate::common::silent_listener::{closed_port, SilentListener};
    use sqllumen_lib::commands::connections::{save_connection_impl, SaveConnectionInput};
    use sqllumen_lib::commands::mysql::{
        close_connection_impl, open_connection_impl, OpenConnectionErrorKind, OpenConnectionPayload,
    };
    use sqllumen_lib::mysql::pool::{
        background_pool_options, IDLE_CONNECTION_TTL, MAX_CONNECTION_LIFETIME,
    };
    use sqllumen_lib::state::AppState;
    use std::time::{Duration, Instant};

    const REJECTED_USERNAME: &str = "intruder";
    const TIMEOUT_DEADLINE: Duration = Duration::from_millis(1500);
    const DISCONNECT_DEADLINE: Duration = Duration::from_secs(1);
    const POLL_INTERVAL: Duration = Duration::from_millis(10);
    const MOCK_SERVER_VERSION: &str = "8.0.36-mock";

    struct ProfileTarget<'a> {
        port: u16,
        username: &'a str,
    }

    fn save_input(target: ProfileTarget<'_>) -> SaveConnectionInput {
        SaveConnectionInput {
            name: "Lifecycle DB".to_string(),
            host: "127.0.0.1".to_string(),
            port: target.port.into(),
            username: target.username.to_string(),
            password: None,
            default_database: None,
            ssl_mode: sqllumen_lib::db::ssl_mode::SslMode::Disabled,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            color: None,
            group_id: None,
            read_only: false,
            sort_order: 0,
            connect_timeout_secs: Some(1),
            keepalive_interval_secs: Some(60),
        }
    }

    async fn open(state: &AppState, target: ProfileTarget<'_>) -> Result<String, String> {
        let profile_id = save_connection_impl(state, save_input(target)).expect("profile saves");
        open_connection_impl(state, crate::common::open_payload(&profile_id))
            .await
            .map_err(|error| error.message)
            .map(|opened| opened.session_id)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_refused_login_is_reported_as_access_denied() {
        let script = MockScript {
            rejected_username: Some(REJECTED_USERNAME),
            ..MockScript::default()
        };
        let server = MockMySqlServer::start_with(script).await;
        let state = common::test_app_state();
        let target = ProfileTarget {
            port: server.port,
            username: REJECTED_USERNAME,
        };
        let profile_id = save_connection_impl(&state, save_input(target)).expect("profile saves");

        let error = open_connection_impl(&state, crate::common::open_payload(&profile_id))
            .await
            .expect_err("login is refused");

        assert_eq!(
            error.kind,
            OpenConnectionErrorKind::AccessDenied,
            "{}",
            error.message
        );
        assert!(
            error.message.starts_with("Failed to connect:"),
            "{}",
            error.message
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_one_off_password_stays_with_the_session_for_reconnects() {
        let server = MockMySqlServer::start_script(vec![]).await;
        let state = common::test_app_state();
        let target = ProfileTarget {
            port: server.port,
            username: "root",
        };
        let profile_id = save_connection_impl(&state, save_input(target)).expect("profile saves");
        let payload = OpenConnectionPayload {
            profile_id,
            password: Some("typed-once".to_string()),
        };

        let opened = open_connection_impl(&state, payload)
            .await
            .expect("open succeeds");

        let stored = state
            .registry
            .get_connection_params(&opened.session_id)
            .expect("session is registered");
        assert_eq!(stored.resolve_password().as_deref(), Ok("typed-once"));
        assert!(opened.last_connected_at.is_some());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn opening_with_a_rejected_username_fails_at_open_time() {
        let script = MockScript {
            rejected_username: Some(REJECTED_USERNAME),
            ..MockScript::default()
        };
        let server = MockMySqlServer::start_with(script).await;
        let state = common::test_app_state();
        let target = ProfileTarget {
            port: server.port,
            username: REJECTED_USERNAME,
        };

        let error = open(&state, target).await.expect_err("login is refused");

        assert!(error.starts_with("Failed to connect:"), "{error}");
        assert!(state.registry.get_pool(REJECTED_USERNAME).is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn opening_a_closed_port_fails_at_open_time() {
        let state = common::test_app_state();
        let target = ProfileTarget {
            port: closed_port(),
            username: "root",
        };
        let started = Instant::now();

        let error = open(&state, target).await.expect_err("nothing listens");

        assert!(
            started.elapsed() < TIMEOUT_DEADLINE,
            "{:?}",
            started.elapsed()
        );
        assert!(error.starts_with("Failed to connect:"), "{error}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn opening_a_silent_server_fails_within_the_connect_timeout() {
        let listener = SilentListener::start().await;
        let state = common::test_app_state();
        let target = ProfileTarget {
            port: listener.port,
            username: "root",
        };
        let started = Instant::now();

        let error = open(&state, target)
            .await
            .expect_err("no handshake arrives");

        assert!(
            started.elapsed() < TIMEOUT_DEADLINE,
            "{:?}",
            started.elapsed()
        );
        assert!(error.contains("timed out"), "{error}");
    }

    async fn wait_until_no_live_connections(server: &MockMySqlServer) {
        let deadline = Instant::now() + DISCONNECT_DEADLINE;
        while server.live_connection_count() > 0 && Instant::now() < deadline {
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn closing_a_connection_disconnects_its_pool() {
        let server = MockMySqlServer::start_script(vec![]).await;
        let state = common::test_app_state();
        let target = ProfileTarget {
            port: server.port,
            username: "root",
        };
        let session_id = open(&state, target).await.expect("open succeeds");
        assert!(server.live_connection_count() > 0);

        close_connection_impl(&state, &session_id)
            .await
            .expect("close succeeds");
        wait_until_no_live_connections(&server).await;

        assert_eq!(server.live_connection_count(), 0);
        assert!(state.registry.get_pool(&session_id).is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn opening_reads_the_server_version_over_its_only_handshake() {
        let server = MockMySqlServer::start_script(vec![]).await;
        let state = common::test_app_state();
        let target = ProfileTarget {
            port: server.port,
            username: "root",
        };
        let profile_id = save_connection_impl(&state, save_input(target)).expect("profile saves");

        let opened = open_connection_impl(&state, crate::common::open_payload(&profile_id))
            .await
            .expect("open succeeds");

        assert_eq!(opened.server_version, MOCK_SERVER_VERSION);
        assert_eq!(server.connection_count(), 1);
    }

    #[test]
    fn background_pools_keep_idle_connections_up_to_the_maximum() {
        const MAX_CONNECTIONS: usize = 10;

        let options = background_pool_options(MAX_CONNECTIONS);

        assert_eq!(options.inactive_connection_ttl(), IDLE_CONNECTION_TTL);
        assert_eq!(options.abs_conn_ttl(), Some(MAX_CONNECTION_LIFETIME));
        assert_eq!(options.constraints().max(), MAX_CONNECTIONS);
        assert!(options.reset_connection());
    }
}
