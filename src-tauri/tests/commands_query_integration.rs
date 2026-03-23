//! Integration tests for query executor helper functions and file I/O.
//! These tests do not require a real MySQL connection — they test the
//! SQL parsing, comment stripping, read-only enforcement, and file I/O logic.

use mysql_client_lib::mysql::query_executor::ColumnMeta;
use mysql_client_lib::mysql::query_executor::StoredResult;
use mysql_client_lib::mysql::query_executor::{
    evict_results_impl, fetch_result_page_impl, find_with_main_keyword, get_first_keyword,
    has_top_level_limit, inject_limit_into_select, is_read_only_allowed, is_select_like,
    needs_auto_limit, read_file_impl, strip_non_executable_comments, write_file_impl,
};
use mysql_client_lib::mysql::registry::ConnectionRegistry;
use mysql_client_lib::state::AppState;
use rusqlite::Connection;
use std::sync::Mutex;

mod common;

fn test_state() -> AppState {
    common::ensure_fake_backend_once();
    let conn = Connection::open_in_memory().expect("should open in-memory db");
    mysql_client_lib::db::migrations::run_migrations(&conn).expect("should run migrations");
    AppState {
        db: Mutex::new(conn),
        registry: ConnectionRegistry::new(),
        app_handle: None,
        results: std::sync::RwLock::new(std::collections::HashMap::new()),
        log_filter_reload: Mutex::new(None),
    }
}

// ── Comment stripping ─────────────────────────────────────────────────────────

#[test]
fn strip_block_comment_replaces_with_space() {
    let stripped = strip_non_executable_comments("SELECT /* hi */ 1");
    assert!(!stripped.contains("/* hi */"));
    assert!(stripped.contains("SELECT"));
    assert!(stripped.contains("1"));
}

#[test]
fn strip_preserves_executable_comment() {
    let sql = "/*!50001 SELECT 1 */";
    let stripped = strip_non_executable_comments(sql);
    assert!(stripped.contains("/*!50001 SELECT 1 */"));
}

#[test]
fn strip_preserves_optimizer_hint() {
    let sql = "SELECT /*+ NO_INDEX_MERGE(t) */ * FROM t";
    let stripped = strip_non_executable_comments(sql);
    assert!(stripped.contains("/*+ NO_INDEX_MERGE(t) */"));
}

#[test]
fn strip_removes_line_comment() {
    let stripped = strip_non_executable_comments("SELECT 1 -- my comment\nFROM t");
    assert!(!stripped.contains("my comment"));
    assert!(stripped.contains("FROM t"));
}

#[test]
fn strip_removes_hash_comment() {
    let stripped = strip_non_executable_comments("SELECT 1 # hash comment\nFROM t");
    assert!(!stripped.contains("hash comment"));
    assert!(stripped.contains("FROM t"));
}

#[test]
fn strip_preserves_string_literals() {
    let sql = "SELECT '-- not a comment' FROM t";
    let stripped = strip_non_executable_comments(sql);
    assert!(stripped.contains("'-- not a comment'"));
}

// ── Keyword extraction ────────────────────────────────────────────────────────

#[test]
fn first_keyword_select() {
    assert_eq!(get_first_keyword("SELECT * FROM t"), "SELECT");
}

#[test]
fn first_keyword_insert() {
    assert_eq!(get_first_keyword("  INSERT INTO t VALUES (1)"), "INSERT");
}

#[test]
fn first_keyword_empty() {
    assert_eq!(get_first_keyword(""), "");
}

// ── SELECT detection ─────────────────────────────────────────────────────────

#[test]
fn is_select_like_returns_true_for_select_variants() {
    assert!(is_select_like("SELECT"));
    assert!(is_select_like("SHOW"));
    assert!(is_select_like("DESCRIBE"));
    assert!(is_select_like("DESC"));
    assert!(is_select_like("EXPLAIN"));
    // WITH is no longer in is_select_like — handled via find_with_main_keyword
    assert!(!is_select_like("WITH"));
}

#[test]
fn is_select_like_returns_false_for_dml() {
    assert!(!is_select_like("INSERT"));
    assert!(!is_select_like("UPDATE"));
    assert!(!is_select_like("DELETE"));
}

// ── Auto-LIMIT detection ──────────────────────────────────────────────────────

#[test]
fn needs_auto_limit_for_select_without_limit() {
    assert!(needs_auto_limit("SELECT * FROM users"));
    assert!(needs_auto_limit(
        "SELECT id, name FROM orders WHERE status = 'active'"
    ));
}

#[test]
fn no_auto_limit_when_limit_present() {
    assert!(!needs_auto_limit("SELECT * FROM t LIMIT 50"));
    assert!(!needs_auto_limit("SELECT * FROM t LIMIT 10, 20"));
    assert!(!needs_auto_limit("SELECT * FROM t LIMIT 10 OFFSET 5"));
}

#[test]
fn no_auto_limit_for_non_select() {
    assert!(!needs_auto_limit("SHOW TABLES"));
    assert!(!needs_auto_limit("DESCRIBE users"));
    assert!(!needs_auto_limit("INSERT INTO t VALUES (1)"));
    assert!(!needs_auto_limit("UPDATE t SET x=1"));
}

#[test]
fn auto_limit_with_cte_select() {
    assert!(needs_auto_limit("WITH cte AS (SELECT 1) SELECT * FROM cte"));
    assert!(!needs_auto_limit(
        "WITH cte AS (SELECT 1) SELECT * FROM cte LIMIT 10"
    ));
    assert!(!needs_auto_limit(
        "WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte"
    ));
}

#[test]
fn auto_limit_subquery_limit_not_top_level() {
    assert!(needs_auto_limit(
        "SELECT * FROM (SELECT id FROM users LIMIT 10) t"
    ));
}

#[test]
fn auto_limit_string_literal_limit() {
    assert!(needs_auto_limit(
        "SELECT * FROM t WHERE desc = 'LIMIT 1000'"
    ));
}

#[test]
fn has_top_level_limit_basic() {
    assert!(has_top_level_limit("SELECT * FROM t LIMIT 10"));
    assert!(!has_top_level_limit("SELECT * FROM t"));
}

#[test]
fn has_top_level_limit_in_subquery() {
    assert!(!has_top_level_limit(
        "SELECT * FROM (SELECT id FROM users LIMIT 10) t"
    ));
}

#[test]
fn has_top_level_limit_in_string() {
    assert!(!has_top_level_limit(
        "SELECT * FROM t WHERE desc = 'LIMIT 1000'"
    ));
}

#[test]
fn has_top_level_limit_with_subquery_and_outer_limit() {
    assert!(has_top_level_limit(
        "SELECT * FROM (SELECT id FROM users) t LIMIT 10"
    ));
}

#[test]
fn find_with_main_keyword_select() {
    assert_eq!(
        find_with_main_keyword("WITH cte AS (SELECT 1) SELECT * FROM cte"),
        "SELECT"
    );
}

#[test]
fn find_with_main_keyword_insert() {
    assert_eq!(
        find_with_main_keyword("WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte"),
        "INSERT"
    );
}

#[test]
fn find_with_main_keyword_recursive() {
    assert_eq!(
        find_with_main_keyword("WITH RECURSIVE cte AS (SELECT 1) SELECT * FROM cte"),
        "SELECT"
    );
}

#[test]
fn find_with_main_keyword_delete() {
    assert_eq!(
        find_with_main_keyword(
            "WITH cte AS (SELECT 1) DELETE FROM t WHERE id IN (SELECT * FROM cte)"
        ),
        "DELETE"
    );
}

#[test]
fn find_with_main_keyword_not_with() {
    // Input that doesn't start with WITH should return empty
    assert_eq!(find_with_main_keyword("SELECT * FROM t"), "");
}

#[test]
fn read_only_blocks_with_dml() {
    assert!(!is_read_only_allowed(
        "WITH cte AS (SELECT 1) DELETE FROM t"
    ));
    assert!(!is_read_only_allowed(
        "WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte"
    ));
}

#[test]
fn read_only_blocks_set_persist() {
    assert!(!is_read_only_allowed("SET PERSIST max_connections = 100"));
    assert!(!is_read_only_allowed(
        "SET PERSIST_ONLY max_connections = 100"
    ));
    assert!(!is_read_only_allowed("SET PASSWORD = 'newpass'"));
    assert!(!is_read_only_allowed("SET @@GLOBAL.max_connections = 100"));
}

#[test]
fn read_only_allows_set_session_forms() {
    assert!(is_read_only_allowed("SET SESSION wait_timeout = 60"));
    assert!(is_read_only_allowed("SET LOCAL wait_timeout = 60"));
    assert!(is_read_only_allowed("SET @@session.wait_timeout = 60"));
}

#[test]
fn first_keyword_executable_comment() {
    assert_eq!(get_first_keyword("/*!50001 DELETE FROM t */"), "DELETE");
    assert_eq!(get_first_keyword("/*!50708 SELECT * FROM t */"), "SELECT");
}

#[test]
fn first_keyword_executable_comment_no_version() {
    // Executable comment without version number
    assert_eq!(get_first_keyword("/*!SELECT * FROM t */"), "SELECT");
}

// ── LIMIT injection ───────────────────────────────────────────────────────────

#[test]
fn inject_limit_appends_at_end() {
    let result = inject_limit_into_select("SELECT * FROM t", 1000);
    assert_eq!(result, "SELECT * FROM t LIMIT 1000");
}

#[test]
fn inject_limit_strips_trailing_semicolon() {
    let result = inject_limit_into_select("SELECT * FROM t;", 100);
    assert_eq!(result, "SELECT * FROM t LIMIT 100");
}

#[test]
fn inject_limit_before_for_update() {
    let result = inject_limit_into_select("SELECT id FROM t FOR UPDATE", 10);
    let limit_pos = result.find("LIMIT").expect("LIMIT should be present");
    let for_pos = result
        .find("FOR UPDATE")
        .expect("FOR UPDATE should be present");
    assert!(limit_pos < for_pos, "LIMIT should precede FOR UPDATE");
}

#[test]
fn inject_limit_before_for_share() {
    let result = inject_limit_into_select("SELECT id FROM t FOR SHARE", 10);
    assert!(result.contains("LIMIT 10"));
    let limit_pos = result.find("LIMIT").unwrap();
    let for_pos = result.find("FOR SHARE").unwrap();
    assert!(limit_pos < for_pos);
}

#[test]
fn inject_limit_before_lock_in_share_mode() {
    let result = inject_limit_into_select("SELECT id FROM t LOCK IN SHARE MODE", 10);
    assert!(result.contains("LIMIT 10"));
    let limit_pos = result.find("LIMIT").unwrap();
    let lock_pos = result.find("LOCK IN SHARE MODE").unwrap();
    assert!(limit_pos < lock_pos);
}

#[test]
fn inject_limit_skips_into_outfile() {
    let result = inject_limit_into_select(
        "SELECT * FROM t INTO OUTFILE '/tmp/out.csv'",
        1000,
    );
    assert!(
        result.contains("INTO OUTFILE"),
        "INTO OUTFILE should be preserved"
    );
    assert!(
        !result.contains("LIMIT"),
        "LIMIT should not be injected for INTO OUTFILE"
    );
}

// ── Read-only enforcement ─────────────────────────────────────────────────────

#[test]
fn read_only_allows_select() {
    assert!(is_read_only_allowed("SELECT * FROM t"));
}

#[test]
fn read_only_allows_show() {
    assert!(is_read_only_allowed("SHOW DATABASES"));
}

#[test]
fn read_only_allows_describe() {
    assert!(is_read_only_allowed("DESCRIBE users"));
    assert!(is_read_only_allowed("DESC users"));
}

#[test]
fn read_only_allows_explain() {
    assert!(is_read_only_allowed("EXPLAIN SELECT * FROM t"));
}

#[test]
fn read_only_allows_with() {
    assert!(is_read_only_allowed(
        "WITH cte AS (SELECT 1) SELECT * FROM cte"
    ));
}

#[test]
fn read_only_allows_use() {
    assert!(is_read_only_allowed("USE mydb"));
}

#[test]
fn read_only_allows_set_session() {
    assert!(is_read_only_allowed("SET session_timeout = 30"));
    assert!(is_read_only_allowed("SET @@session.timeout = 30"));
}

#[test]
fn read_only_blocks_set_global() {
    assert!(!is_read_only_allowed("SET GLOBAL max_connections = 100"));
}

#[test]
fn read_only_blocks_insert() {
    assert!(!is_read_only_allowed("INSERT INTO t (id) VALUES (1)"));
}

#[test]
fn read_only_blocks_update() {
    assert!(!is_read_only_allowed("UPDATE t SET x = 1 WHERE id = 1"));
}

#[test]
fn read_only_blocks_delete() {
    assert!(!is_read_only_allowed("DELETE FROM t WHERE id = 1"));
}

#[test]
fn read_only_blocks_create() {
    assert!(!is_read_only_allowed("CREATE TABLE new_t (id INT)"));
}

#[test]
fn read_only_blocks_drop() {
    assert!(!is_read_only_allowed("DROP TABLE t"));
}

#[test]
fn read_only_blocks_truncate() {
    assert!(!is_read_only_allowed("TRUNCATE TABLE t"));
}

#[test]
fn read_only_with_leading_block_comment() {
    assert!(!is_read_only_allowed("/* comment */ DELETE FROM t"));
    assert!(is_read_only_allowed("/* comment */ SELECT * FROM t"));
}

#[test]
fn read_only_with_leading_line_comment() {
    assert!(!is_read_only_allowed("-- comment\nDELETE FROM t"));
}

#[test]
fn read_only_with_leading_hash_comment() {
    assert!(!is_read_only_allowed("# comment\nDELETE FROM t"));
}

#[test]
fn read_only_allows_empty_statement() {
    assert!(is_read_only_allowed(""));
    assert!(is_read_only_allowed("   "));
}

#[test]
fn read_only_allows_bare_set() {
    // Bare SET with no second word — allowed by default
    assert!(is_read_only_allowed("SET"));
}

#[test]
fn read_only_allows_set_user_variable() {
    assert!(is_read_only_allowed("SET @myvar = 42"));
}

#[test]
fn read_only_blocks_set_persist_only_scoped() {
    assert!(!is_read_only_allowed("SET @@PERSIST.max_connections = 100"));
    assert!(!is_read_only_allowed(
        "SET @@PERSIST_ONLY.max_connections = 100"
    ));
}

#[test]
fn read_only_executable_comment_select() {
    // Executable comment containing SELECT should be allowed
    assert!(is_read_only_allowed("/*!50001 SELECT * FROM t */"));
}

#[test]
fn read_only_executable_comment_delete_blocked() {
    // Executable comment containing DELETE should be blocked
    assert!(!is_read_only_allowed("/*!50001 DELETE FROM t */"));
}

// ── Evict results ─────────────────────────────────────────────────────────────

#[test]
fn evict_results_removes_stored_result() {
    let state = test_state();

    // Insert a result manually
    {
        let mut results = state.results.write().expect("lock ok");
        results.insert(
            ("conn-1".to_string(), "tab-1".to_string()),
            StoredResult {
                query_id: "qid-1".to_string(),
                columns: vec![ColumnMeta {
                    name: "id".to_string(),
                    data_type: "INT".to_string(),
                }],
                rows: vec![vec![serde_json::json!(1)]],
                execution_time_ms: 5,
                affected_rows: 0,
                auto_limit_applied: false,
                page_size: 1000,
            },
        );
    }

    // Verify it exists
    {
        let results = state.results.read().expect("lock ok");
        assert!(results.contains_key(&("conn-1".to_string(), "tab-1".to_string())));
    }

    // Evict
    evict_results_impl(&state, "conn-1", "tab-1");

    // Verify gone
    {
        let results = state.results.read().expect("lock ok");
        assert!(!results.contains_key(&("conn-1".to_string(), "tab-1".to_string())));
    }
}

#[test]
fn evict_results_no_op_when_not_found() {
    let state = test_state();
    // Should not panic
    evict_results_impl(&state, "conn-missing", "tab-missing");
}

// ── Fetch result page ─────────────────────────────────────────────────────────

#[test]
fn fetch_result_page_returns_correct_slice() {
    let state = test_state();

    let rows: Vec<Vec<serde_json::Value>> =
        (1i64..=25).map(|i| vec![serde_json::json!(i)]).collect();

    {
        let mut results = state.results.write().expect("lock ok");
        results.insert(
            ("c1".to_string(), "t1".to_string()),
            StoredResult {
                query_id: "q1".to_string(),
                columns: vec![ColumnMeta {
                    name: "n".to_string(),
                    data_type: "INT".to_string(),
                }],
                rows,
                execution_time_ms: 1,
                affected_rows: 0,
                auto_limit_applied: false,
                page_size: 10,
            },
        );
    }

    let page1 = fetch_result_page_impl(&state, "c1", "t1", "q1", 1).expect("page 1 ok");
    assert_eq!(page1.rows.len(), 10);
    assert_eq!(page1.page, 1);
    assert_eq!(page1.total_pages, 3);

    let page3 = fetch_result_page_impl(&state, "c1", "t1", "q1", 3).expect("page 3 ok");
    assert_eq!(page3.rows.len(), 5); // 25 - 20 = 5 remaining
}

#[test]
fn fetch_result_page_errors_on_wrong_query_id() {
    let state = test_state();

    {
        let mut results = state.results.write().expect("lock ok");
        results.insert(
            ("c1".to_string(), "t1".to_string()),
            StoredResult {
                query_id: "q1".to_string(),
                columns: vec![],
                rows: vec![],
                execution_time_ms: 1,
                affected_rows: 0,
                auto_limit_applied: false,
                page_size: 1000,
            },
        );
    }

    let err = fetch_result_page_impl(&state, "c1", "t1", "wrong-id", 1)
        .expect_err("wrong query_id should error");
    assert!(err.contains("Query ID mismatch") || err.contains("mismatch"));
}

#[test]
fn fetch_result_page_errors_when_not_found() {
    let state = test_state();
    let err = fetch_result_page_impl(&state, "conn-missing", "tab-missing", "q1", 1)
        .expect_err("missing result should error");
    assert!(err.contains("No results found") || err.contains("not found"));
}

#[test]
fn fetch_result_page_errors_on_page_zero() {
    let state = test_state();

    {
        let mut results = state.results.write().expect("lock ok");
        results.insert(
            ("c1".to_string(), "t1".to_string()),
            StoredResult {
                query_id: "q1".to_string(),
                columns: vec![],
                rows: vec![vec![serde_json::json!(1)]],
                execution_time_ms: 1,
                affected_rows: 0,
                auto_limit_applied: false,
                page_size: 1000,
            },
        );
    }

    let err = fetch_result_page_impl(&state, "c1", "t1", "q1", 0)
        .expect_err("page 0 should error");
    assert!(err.contains("out of range"));
}

#[test]
fn fetch_result_page_errors_on_page_beyond_total() {
    let state = test_state();

    {
        let mut results = state.results.write().expect("lock ok");
        results.insert(
            ("c1".to_string(), "t1".to_string()),
            StoredResult {
                query_id: "q1".to_string(),
                columns: vec![],
                rows: vec![vec![serde_json::json!(1)]],
                execution_time_ms: 1,
                affected_rows: 0,
                auto_limit_applied: false,
                page_size: 1000,
            },
        );
    }

    let err = fetch_result_page_impl(&state, "c1", "t1", "q1", 2)
        .expect_err("page beyond total should error");
    assert!(err.contains("out of range"));
}

#[test]
fn fetch_result_page_empty_result_set() {
    let state = test_state();

    {
        let mut results = state.results.write().expect("lock ok");
        results.insert(
            ("c1".to_string(), "t1".to_string()),
            StoredResult {
                query_id: "q1".to_string(),
                columns: vec![ColumnMeta {
                    name: "id".to_string(),
                    data_type: "INT".to_string(),
                }],
                rows: vec![],
                execution_time_ms: 1,
                affected_rows: 0,
                auto_limit_applied: false,
                page_size: 1000,
            },
        );
    }

    // Empty result sets have 1 total page; page 1 returns 0 rows
    let page1 = fetch_result_page_impl(&state, "c1", "t1", "q1", 1).expect("page 1 ok");
    assert_eq!(page1.rows.len(), 0);
    assert_eq!(page1.total_pages, 1);
}

// ── File I/O ──────────────────────────────────────────────────────────────────

#[test]
fn read_file_errors_for_missing_file() {
    let err =
        read_file_impl("/nonexistent/path/to/file.sql").expect_err("missing file should error");
    assert!(err.contains("Failed to read"));
}

#[test]
fn read_file_errors_for_non_utf8() {
    let dir = std::env::temp_dir();
    let filename = format!("test_non_utf8_{}.bin", std::process::id());
    let path = dir.join(&filename);
    std::fs::write(&path, &[0xFF, 0xFE, 0xFD]).expect("write should succeed");

    let err = read_file_impl(&path.to_string_lossy()).expect_err("non-UTF-8 should error");
    assert!(
        err.contains("UTF-8"),
        "expected UTF-8 error, got: {err}"
    );

    let _ = std::fs::remove_file(&path);
}

#[test]
fn write_and_read_roundtrip() {
    let dir = std::env::temp_dir();
    let filename = format!("test_query_int_{}.sql", std::process::id());
    let path = dir.join(&filename);
    let path_str = path.to_string_lossy().to_string();

    let content = "SELECT * FROM users;\nSELECT * FROM orders;";
    write_file_impl(&path_str, content).expect("write should succeed");

    let read_back = read_file_impl(&path_str).expect("read should succeed");
    assert_eq!(read_back, content);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn write_file_creates_parent_directories() {
    let dir = std::env::temp_dir();
    let nested = dir
        .join(format!("test_nested_{}", std::process::id()))
        .join("subdir")
        .join("file.sql");
    let path_str = nested.to_string_lossy().to_string();

    write_file_impl(&path_str, "SELECT 1;").expect("write with mkdir should succeed");
    assert!(nested.exists());

    // Cleanup
    let _ = std::fs::remove_dir_all(dir.join(format!("test_nested_{}", std::process::id())));
}

// ── Coverage-mode tests for execute_query_impl / fetch_schema_metadata_impl ──

#[cfg(coverage)]
mod coverage_stubs {
    use super::*;
    use mysql_client_lib::mysql::query_executor::{
        execute_query_impl, fetch_schema_metadata_impl,
    };
    use mysql_client_lib::mysql::registry::{
        ConnectionStatus, RegistryEntry, StoredConnectionParams,
    };
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

    fn dummy_stored_params(profile_id: &str) -> StoredConnectionParams {
        StoredConnectionParams {
            profile_id: profile_id.to_string(),
            host: "127.0.0.1".to_string(),
            port: 13306,
            username: "dummy".to_string(),
            has_password: false,
            keychain_ref: None,
            default_database: None,
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            connect_timeout_secs: 10,
            keepalive_interval_secs: 0,
        }
    }

    fn register_lazy_pool(state: &AppState, connection_id: &str, read_only: bool) {
        let entry = RegistryEntry {
            pool: dummy_lazy_pool(),
            session_id: connection_id.to_string(),
            profile_id: connection_id.to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.0".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: dummy_stored_params(connection_id),
            read_only,
        };
        state.registry.insert(connection_id.to_string(), entry);
    }

    // ── execute_query_impl ────────────────────────────────────────────────

    #[tokio::test]
    async fn execute_query_impl_coverage_success() {
        let state = test_state();
        register_lazy_pool(&state, "conn-cov", false);

        let result = execute_query_impl(&state, "conn-cov", "tab-1", "SELECT * FROM t", 100)
            .await
            .expect("coverage stub should succeed");

        assert!(!result.query_id.is_empty());
        assert!(result.auto_limit_applied);
        assert_eq!(result.total_rows, 0);
        assert_eq!(result.total_pages, 1);
    }

    #[tokio::test]
    async fn execute_query_impl_coverage_missing_connection() {
        let state = test_state();

        let err = execute_query_impl(&state, "missing", "tab-1", "SELECT 1", 100)
            .await
            .expect_err("missing connection should error");
        assert!(err.contains("not found"));
    }

    #[tokio::test]
    async fn execute_query_impl_coverage_read_only_blocks_dml() {
        let state = test_state();
        register_lazy_pool(&state, "ro-conn", true);

        let err = execute_query_impl(&state, "ro-conn", "tab-1", "INSERT INTO t VALUES (1)", 100)
            .await
            .expect_err("read-only should block DML");
        assert!(err.contains("read-only"));
    }

    #[tokio::test]
    async fn execute_query_impl_coverage_read_only_allows_select() {
        let state = test_state();
        register_lazy_pool(&state, "ro-conn", true);

        let result = execute_query_impl(&state, "ro-conn", "tab-1", "SELECT 1", 100)
            .await
            .expect("read-only should allow SELECT");
        assert!(!result.query_id.is_empty());
    }

    #[tokio::test]
    async fn execute_query_impl_coverage_page_size_zero() {
        let state = test_state();
        register_lazy_pool(&state, "conn-cov", false);

        let result = execute_query_impl(&state, "conn-cov", "tab-1", "SHOW TABLES", 0)
            .await
            .expect("page_size 0 should fallback to 1000");
        assert_eq!(result.total_pages, 1);
    }

    #[tokio::test]
    async fn execute_query_impl_coverage_no_auto_limit() {
        let state = test_state();
        register_lazy_pool(&state, "conn-cov", false);

        // INSERT doesn't get auto-limit
        let result =
            execute_query_impl(&state, "conn-cov", "tab-1", "INSERT INTO t VALUES (1)", 100)
                .await
                .expect("stub should succeed");
        assert!(!result.auto_limit_applied);
    }

    #[tokio::test]
    async fn execute_query_impl_coverage_stores_result() {
        let state = test_state();
        register_lazy_pool(&state, "conn-cov", false);

        let result =
            execute_query_impl(&state, "conn-cov", "tab-1", "SELECT * FROM t", 100)
                .await
                .expect("stub should succeed");

        // Verify result is stored and can be fetched
        let page = fetch_result_page_impl(&state, "conn-cov", "tab-1", &result.query_id, 1)
            .expect("page fetch should succeed");
        assert_eq!(page.total_pages, 1);
    }

    // ── fetch_schema_metadata_impl ────────────────────────────────────────

    #[tokio::test]
    async fn fetch_schema_metadata_impl_coverage_success() {
        let state = test_state();
        register_lazy_pool(&state, "conn-cov", false);

        let metadata = fetch_schema_metadata_impl(&state, "conn-cov")
            .await
            .expect("coverage stub should succeed");

        assert!(!metadata.databases.is_empty());
        assert!(metadata.tables.contains_key("stub_db"));
        assert!(metadata.columns.contains_key("stub_db.stub_table"));
        assert!(metadata.routines.contains_key("stub_db"));
    }

    #[tokio::test]
    async fn fetch_schema_metadata_impl_coverage_missing_connection() {
        let state = test_state();

        let err = fetch_schema_metadata_impl(&state, "missing")
            .await
            .expect_err("missing connection should error");
        assert!(err.contains("not found"));
    }
}
