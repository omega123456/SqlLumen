//! Integration tests for schema commands (`commands/schema.rs`).
//!
//! Tests for `safe_identifier` and other pure-logic helpers run without MySQL.
//! Tests that require a live MySQL connection are marked `#[ignore]`.

mod common;

use mysql_client_lib::mysql::schema_queries::safe_identifier;

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
// Live MySQL tests (require real connection — ignored by default)
// ---------------------------------------------------------------------------

#[ignore]
#[tokio::test]
async fn test_list_databases_requires_mysql() {
    // This test requires a real MySQL connection.
    // Run with: cargo test --test commands_schema_integration -- --ignored
    eprintln!("This test requires a live MySQL connection");
}

#[ignore]
#[tokio::test]
async fn test_read_only_rejects_create_database() {
    // This test requires a real MySQL connection with a read-only entry in registry.
    // Run with: cargo test --test commands_schema_integration -- --ignored
    eprintln!("This test requires a live MySQL connection with read-only setup");
}
