//! Integration tests for schema commands (`commands/schema.rs`).
//!
//! Pure logic (`safe_identifier`, registry checks) and command paths that fail before
//! touching the network (missing connection, read-only guard) run without MySQL.

mod common;

use mysql_client_lib::commands::schema::{create_database_impl, list_databases_impl};
use mysql_client_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
use mysql_client_lib::mysql::schema_queries::safe_identifier;
use mysql_client_lib::state::AppState;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use tokio_util::sync::CancellationToken;

fn dummy_lazy_pool() -> sqlx::MySqlPool {
    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(13306)
        .username("dummy")
        .password("dummy");
    MySqlPoolOptions::new().connect_lazy_with(opts)
}

fn dummy_stored_params() -> StoredConnectionParams {
    StoredConnectionParams {
        profile_id: "profile-schema-test".to_string(),
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

fn register_lazy_pool(state: &AppState, connection_id: &str, read_only: bool) {
    let entry = RegistryEntry {
        pool: dummy_lazy_pool(),
        session_id: connection_id.to_string(),
        profile_id: "profile-schema-test".to_string(),
        status: ConnectionStatus::Connected,
        server_version: "8.0.0".to_string(),
        cancellation_token: CancellationToken::new(),
        connection_params: dummy_stored_params(),
        read_only,
    };
    state.registry.insert(connection_id.to_string(), entry);
}

// ---------------------------------------------------------------------------
// safe_identifier tests (pure — no MySQL needed)
// ---------------------------------------------------------------------------

#[test]
fn test_safe_identifier_basic() {
    assert_eq!(safe_identifier("test").unwrap(), "`test`");
}

#[test]
fn test_safe_identifier_with_spaces() {
    assert_eq!(safe_identifier("my table").unwrap(), "`my table`");
}

#[test]
fn test_safe_identifier_with_backtick() {
    assert_eq!(safe_identifier("te`st").unwrap(), "`te``st`");
}

#[test]
fn test_safe_identifier_multiple_backticks() {
    assert_eq!(safe_identifier("a`b`c").unwrap(), "`a``b``c`");
}

#[test]
fn test_safe_identifier_all_backticks() {
    assert_eq!(safe_identifier("```").unwrap(), "````````");
}

#[test]
fn test_safe_identifier_empty_rejected() {
    let result = safe_identifier("");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("empty"));
}

#[test]
fn test_safe_identifier_too_long_rejected() {
    let long = "a".repeat(65);
    let result = safe_identifier(&long);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("64 characters"));
}

#[test]
fn test_safe_identifier_exactly_64_chars() {
    let exact = "a".repeat(64);
    let result = safe_identifier(&exact);
    assert!(result.is_ok());
    let escaped = result.unwrap();
    assert!(escaped.starts_with('`'));
    assert!(escaped.ends_with('`'));
}

#[test]
fn test_safe_identifier_single_char() {
    assert_eq!(safe_identifier("x").unwrap(), "`x`");
}

#[test]
fn test_safe_identifier_special_characters() {
    assert_eq!(safe_identifier("my-table").unwrap(), "`my-table`");
    assert_eq!(safe_identifier("my.table").unwrap(), "`my.table`");
    assert_eq!(safe_identifier("my/table").unwrap(), "`my/table`");
}

#[test]
fn test_safe_identifier_unicode() {
    assert_eq!(safe_identifier("日本語").unwrap(), "`日本語`");
}

#[test]
fn test_safe_identifier_numeric_name() {
    assert_eq!(safe_identifier("123").unwrap(), "`123`");
}

#[test]
fn test_safe_identifier_with_single_quotes() {
    assert_eq!(safe_identifier("it's").unwrap(), "`it's`");
}

#[test]
fn test_safe_identifier_with_double_quotes() {
    assert_eq!(safe_identifier("my\"table").unwrap(), "`my\"table`");
}

// ---------------------------------------------------------------------------
// Read-only connection rejection tests
// ---------------------------------------------------------------------------

#[test]
fn test_registry_is_read_only_returns_false_for_unknown_id() {
    let state = common::test_app_state();
    assert!(!state.registry.is_read_only("nonexistent"));
}

#[test]
fn test_registry_contains_returns_false_for_unknown_id() {
    let state = common::test_app_state();
    assert!(!state.registry.contains("nonexistent"));
}

// ---------------------------------------------------------------------------
// Coverage-mode impl function tests (exercise stubs)
// ---------------------------------------------------------------------------

#[cfg(coverage)]
mod coverage_stubs {
    use super::*;
    use mysql_client_lib::commands::schema::*;

    #[tokio::test]
    async fn test_list_databases_impl_coverage() {
        let state = common::test_app_state();
        super::register_lazy_pool(&state, "test-conn", false);
        let result = list_databases_impl(&state, "test-conn").await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_list_schema_objects_impl_coverage_valid() {
        let state = common::test_app_state();
        let result = list_schema_objects_impl(&state, "test-conn", "db", "table").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_list_schema_objects_impl_coverage_invalid() {
        let state = common::test_app_state();
        let result = list_schema_objects_impl(&state, "test-conn", "db", "invalid").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_list_columns_impl_coverage() {
        let state = common::test_app_state();
        let result = list_columns_impl(&state, "test-conn", "db", "tbl").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_schema_info_impl_coverage() {
        let state = common::test_app_state();
        let result = get_schema_info_impl(&state, "test-conn", "db", "obj", "table").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_database_details_impl_coverage() {
        let state = common::test_app_state();
        let result = get_database_details_impl(&state, "test-conn", "mydb").await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().name, "mydb");
    }

    #[tokio::test]
    async fn test_list_charsets_impl_coverage() {
        let state = common::test_app_state();
        let result = list_charsets_impl(&state, "test-conn").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_list_collations_impl_coverage() {
        let state = common::test_app_state();
        let result = list_collations_impl(&state, "test-conn").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_create_database_impl_coverage() {
        let state = common::test_app_state();
        // Registry has no entries, so is_read_only returns false
        let result =
            create_database_impl(&state, "test-conn", "newdb", None, None).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_drop_database_impl_coverage() {
        let state = common::test_app_state();
        let result = drop_database_impl(&state, "test-conn", "db").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_alter_database_impl_coverage() {
        let state = common::test_app_state();
        let result =
            alter_database_impl(&state, "test-conn", "db", Some("utf8"), None).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_rename_database_impl_coverage() {
        let state = common::test_app_state();
        let result = rename_database_impl(&state, "test-conn", "old", "new").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_drop_table_impl_coverage() {
        let state = common::test_app_state();
        let result = drop_table_impl(&state, "test-conn", "db", "tbl").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_truncate_table_impl_coverage() {
        let state = common::test_app_state();
        let result = truncate_table_impl(&state, "test-conn", "db", "tbl").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_rename_table_impl_coverage() {
        let state = common::test_app_state();
        let result =
            rename_table_impl(&state, "test-conn", "db", "old", "new").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_create_database_impl_rejects_empty_name() {
        let state = common::test_app_state();
        let result =
            create_database_impl(&state, "test-conn", "", None, None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[tokio::test]
    async fn test_drop_table_impl_rejects_long_identifier() {
        let state = common::test_app_state();
        let long = "a".repeat(65);
        let result = drop_table_impl(&state, "test-conn", &long, "tbl").await;
        assert!(result.is_err());
    }
}

// ---------------------------------------------------------------------------
// Command guards (no live MySQL — fail before pool/query)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_list_databases_errors_when_connection_not_open() {
    let state = common::test_app_state();
    let result = list_databases_impl(&state, "not-registered").await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("not open"),
        "expected missing-connection error, got: {err}"
    );
}

#[tokio::test]
async fn test_create_database_rejected_when_connection_read_only() {
    let state = common::test_app_state();
    register_lazy_pool(&state, "ro-conn", true);

    let result = create_database_impl(&state, "ro-conn", "newdb", None, None).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("read-only"),
        "expected read-only rejection, got: {err}"
    );
}
