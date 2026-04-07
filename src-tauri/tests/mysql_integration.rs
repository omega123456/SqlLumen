mod common;

use sqllumen_lib::credentials;
use sqllumen_lib::mysql::registry::{
    ConnectionRegistry, ConnectionStatus, RegistryEntry, StoredConnectionParams,
};
#[cfg(not(coverage))]
use sqllumen_lib::mysql::schema_queries::{
    decode_mysql_optional_text_cell_for_test, decode_mysql_text_cell_for_test,
    decode_mysql_text_cell_named_for_test,
};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use tokio_util::sync::CancellationToken;

// --- Helper: create a lazy (non-connecting) dummy pool for registry tests ---

fn dummy_pool() -> sqlx::MySqlPool {
    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(13306)
        .username("dummy")
        .password("dummy");
    MySqlPoolOptions::new().connect_lazy_with(opts)
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
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        connect_timeout_secs: 10,
        keepalive_interval_secs: 60,
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
    assert!(!conn.ssl_enabled);
    assert_eq!(conn.ssl_ca_path, None);
    assert_eq!(conn.ssl_cert_path, None);
    assert_eq!(conn.ssl_key_path, None);
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

// --- Registry Tests (need tokio context for sqlx pool internals) ---

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

// --- Registry Health Monitor Support Tests ---

#[tokio::test]
async fn test_registry_remove_cancels_token() {
    let registry = ConnectionRegistry::new();
    let entry = dummy_entry("test-health-1");
    let token_clone = entry.cancellation_token.clone();

    registry.insert("test-health-1".to_string(), entry);
    assert!(!token_clone.is_cancelled(), "token should not be cancelled before remove");

    registry.remove("test-health-1");
    assert!(token_clone.is_cancelled(), "token should be cancelled after remove");
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

    assert!(old.is_some(), "insert should return old entry on replacement");
    assert!(token1_clone.is_cancelled(), "old token should be cancelled on replacement");
    assert!(!token2_clone.is_cancelled(), "new token should still be active");
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

// --- Credential Tests (in-memory test backend; no OS keychain) ---

#[test]
fn test_credential_store_and_retrieve() {
    common::ensure_fake_backend_once();
    let test_id = format!("test-cred-{}", uuid::Uuid::new_v4());

    credentials::store_password(&test_id, "my_secret_password")
        .expect("should store password");

    let retrieved =
        credentials::retrieve_password(&test_id).expect("should retrieve password");
    assert_eq!(retrieved, "my_secret_password");

    credentials::delete_password(&test_id).expect("should delete password");
}

#[test]
fn test_credential_overwrite() {
    common::ensure_fake_backend_once();
    let test_id = format!("test-cred-ow-{}", uuid::Uuid::new_v4());

    credentials::store_password(&test_id, "first_password").expect("should store");
    credentials::store_password(&test_id, "second_password").expect("should overwrite");

    let retrieved = credentials::retrieve_password(&test_id).expect("should retrieve");
    assert_eq!(retrieved, "second_password");

    credentials::delete_password(&test_id).expect("should delete");
}

#[test]
fn test_credential_delete() {
    common::ensure_fake_backend_once();
    let test_id = format!("test-cred-del-{}", uuid::Uuid::new_v4());

    credentials::store_password(&test_id, "temp_password").expect("should store");
    credentials::delete_password(&test_id).expect("should delete");

    let result = credentials::retrieve_password(&test_id);
    assert!(result.is_err(), "should fail to retrieve deleted password");
}

#[test]
fn test_credential_retrieve_nonexistent() {
    common::ensure_fake_backend_once();
    let test_id = format!("test-cred-none-{}", uuid::Uuid::new_v4());
    let result = credentials::retrieve_password(&test_id);
    assert!(result.is_err(), "should fail for nonexistent credential");
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
        // Use sqlx's built-in URL parsing for simplicity
        let pool = sqlx::MySqlPool::connect(&url)
            .await
            .expect("should connect to MySQL");

        let row = sqlx::query("SELECT VERSION()")
            .fetch_one(&pool)
            .await
            .expect("should execute query");

        let version: String = sqlx::Row::get(&row, 0);
        assert!(!version.is_empty(), "should return server version");

        pool.close().await;
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
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            connect_timeout_secs: 10,
        };

        let pool = create_pool(&params).await.expect("should create pool");
        pool.close().await;
    });
}

/// `information_schema` identifier columns can be `VARBINARY` (e.g. MariaDB). sqlx cannot use
/// `row.get::<String>()` on those cells — we must fall back to bytes + UTF-8. This test forces
/// that path with `CAST(? AS BINARY)` (requires `MYSQL_TEST_URL`).
#[cfg(not(coverage))]
#[tokio::test]
async fn test_schema_text_decode_accepts_varbinary_like_information_schema() {
    let url = match std::env::var("MYSQL_TEST_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!(
                "Skipping test_schema_text_decode_accepts_varbinary_like_information_schema: MYSQL_TEST_URL not set"
            );
            return;
        }
    };

    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("should connect to MYSQL_TEST_URL");

    let row_bin = sqlx::query("SELECT CAST(? AS BINARY) AS schema_name")
        .bind("my_db_τest")
        .fetch_one(&pool)
        .await
        .expect("CAST AS BINARY query");

    assert_eq!(
        decode_mysql_text_cell_for_test(&row_bin, 0).expect("indexed VARBINARY decode"),
        "my_db_τest"
    );

    let row_named = sqlx::query("SELECT CAST(? AS BINARY) AS Key_name")
        .bind("named_idx")
        .fetch_one(&pool)
        .await
        .expect("named CAST AS BINARY query");

    assert_eq!(
        decode_mysql_text_cell_named_for_test(&row_named, "Key_name").expect("named VARBINARY decode"),
        "named_idx"
    );

    let row_txt = sqlx::query(
        "SELECT CAST(? AS CHAR(64) CHARACTER SET utf8mb4) AS plain",
    )
    .bind("utf8_plain")
    .fetch_one(&pool)
    .await
    .expect("CHAR utf8mb4 query");

    assert_eq!(
        decode_mysql_text_cell_for_test(&row_txt, 0).expect("VARCHAR decode"),
        "utf8_plain"
    );

    let row_null = sqlx::query("SELECT CAST(NULL AS BINARY) AS x")
        .fetch_one(&pool)
        .await
        .expect("NULL binary query");

    assert_eq!(
        decode_mysql_optional_text_cell_for_test(&row_null, 0).expect("optional decode"),
        None
    );

    pool.close().await;
}

/// `insert_table_row_impl` must use the driver's `last_insert_id()` (`u64`). Decoding
/// `SELECT LAST_INSERT_ID()` as `i64` fails when the AI column is `BIGINT UNSIGNED`.
#[cfg(not(coverage))]
#[tokio::test]
async fn insert_table_row_impl_refetches_unsigned_bigint_autoincrement_pk() {
    let url = match std::env::var("MYSQL_TEST_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!(
                "Skipping insert_table_row_impl_refetches_unsigned_bigint_autoincrement_pk: MYSQL_TEST_URL not set"
            );
            return;
        }
    };

    let db_name = {
        let after_scheme = match url.strip_prefix("mysql://") {
            Some(s) => s,
            None => {
                eprintln!("Skipping: MYSQL_TEST_URL must start with mysql://");
                return;
            }
        };
        let host_and_rest = match after_scheme.split_once('@') {
            Some((_, r)) => r,
            None => after_scheme,
        };
        let Some((_host_port, path)) = host_and_rest.split_once('/') else {
            eprintln!("Skipping: MYSQL_TEST_URL has no database path");
            return;
        };
        let db = path.split('?').next().unwrap_or(path).trim();
        if db.is_empty() {
            eprintln!("Skipping: MYSQL_TEST_URL must include a database name");
            return;
        }
        db.to_string()
    };

    use sqllumen_lib::mysql::table_data::{insert_table_row_impl, PrimaryKeyInfo};
    use std::collections::HashMap;

    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect MYSQL_TEST_URL");

    let table = format!(
        "__ins_unsigned_ai_{}",
        uuid::Uuid::new_v4().simple()
    );

    let create_sql = format!(
        "CREATE TABLE `{}`.`{}` ( \
         `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, \
         `label` VARCHAR(64) NOT NULL, \
         PRIMARY KEY (`id`) \
         ) ENGINE=InnoDB",
        db_name, table
    );
    sqlx::query(&create_sql)
        .execute(&pool)
        .await
        .expect("CREATE TABLE for unsigned AI insert test");

    let mut values = HashMap::new();
    values.insert("label".to_string(), serde_json::json!("unsigned_ai_smoke"));
    let pk = PrimaryKeyInfo {
        key_columns: vec!["id".to_string()],
        has_auto_increment: true,
        is_unique_key_fallback: false,
    };

    let insert_outcome = insert_table_row_impl(&pool, &db_name, &table, &values, &pk).await;

    let _ = sqlx::query(&format!("DROP TABLE `{}`.`{}`", db_name, table))
        .execute(&pool)
        .await;

    pool.close().await;

    let row_vec = insert_outcome.expect("insert should succeed for BIGINT UNSIGNED AUTO_INCREMENT PK");
    let id_cell = row_vec.iter().find(|(c, _)| c == "id").map(|(_, v)| v);
    assert!(
        id_cell.is_some_and(|v| v.as_u64().is_some_and(|n| n >= 1)),
        "expected positive numeric id in returned row, got {:?}",
        id_cell
    );
}
