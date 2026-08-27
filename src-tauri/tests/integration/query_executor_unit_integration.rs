use sqllumen_lib::mysql::query_executor::{
    find_with_main_keyword, get_first_keyword, has_top_level_limit, inject_limit_into_select,
    is_read_only_allowed, needs_auto_limit, read_file_impl, strip_non_executable_comments,
    write_file_impl,
};

#[test]
fn test_strip_removes_block_comments() {
    let sql = "SELECT /* comment */ 1";
    assert_eq!(strip_non_executable_comments(sql).trim(), "SELECT   1");
}

#[test]
fn test_strip_preserves_executable_comments() {
    let sql = "SELECT /*!50001 1 */ FROM t";
    let result = strip_non_executable_comments(sql);
    assert!(result.contains("/*!50001 1 */"));
}

#[test]
fn test_strip_preserves_hint_comments() {
    let sql = "SELECT /*+ INDEX(t idx) */ * FROM t";
    let result = strip_non_executable_comments(sql);
    assert!(result.contains("/*+ INDEX(t idx) */"));
}

#[test]
fn test_strip_removes_line_comments() {
    let sql = "SELECT 1 -- comment\nFROM t";
    let result = strip_non_executable_comments(sql);
    assert!(!result.contains("-- comment"));
    assert!(result.contains("FROM t"));
}

#[test]
fn test_strip_removes_hash_comments() {
    let sql = "SELECT 1 # comment\nFROM t";
    let result = strip_non_executable_comments(sql);
    assert!(!result.contains("# comment"));
    assert!(result.contains("FROM t"));
}

#[test]
fn test_get_first_keyword() {
    assert_eq!(get_first_keyword("SELECT * FROM t"), "SELECT");
    assert_eq!(get_first_keyword("  insert into t"), "INSERT");
    assert_eq!(get_first_keyword(""), "");
}

#[test]
fn test_get_first_keyword_executable_comment() {
    assert_eq!(get_first_keyword("/*!50001 DELETE FROM t */"), "DELETE");
    assert_eq!(get_first_keyword("/*!50708 SELECT * FROM t */"), "SELECT");
    assert_eq!(get_first_keyword("/*!SELECT * FROM t */"), "SELECT");
}

#[test]
fn test_find_with_main_keyword() {
    assert_eq!(
        find_with_main_keyword("WITH cte AS (SELECT 1) SELECT * FROM cte"),
        "SELECT"
    );
    assert_eq!(
        find_with_main_keyword("WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte"),
        "INSERT"
    );
    assert_eq!(
        find_with_main_keyword(
            "WITH cte AS (SELECT 1) DELETE FROM t WHERE id IN (SELECT * FROM cte)"
        ),
        "DELETE"
    );
    assert_eq!(
        find_with_main_keyword("WITH RECURSIVE cte AS (SELECT 1) SELECT * FROM cte"),
        "SELECT"
    );
}

#[test]
fn test_has_top_level_limit() {
    assert!(has_top_level_limit("SELECT * FROM t LIMIT 10"));
    assert!(!has_top_level_limit("SELECT * FROM t"));
    // LIMIT inside subquery should not count
    assert!(!has_top_level_limit(
        "SELECT * FROM (SELECT id FROM users LIMIT 10) t"
    ));
    // LIMIT inside string should not count
    assert!(!has_top_level_limit(
        "SELECT * FROM t WHERE desc = 'LIMIT 1000'"
    ));
    // Top-level LIMIT should count even with subqueries
    assert!(has_top_level_limit(
        "SELECT * FROM (SELECT id FROM users) t LIMIT 10"
    ));
}

#[test]
fn test_needs_auto_limit_select_without_limit() {
    assert!(needs_auto_limit("SELECT * FROM t"));
    assert!(needs_auto_limit("SELECT id FROM users WHERE active = 1"));
}

#[test]
fn test_needs_auto_limit_select_with_limit() {
    assert!(!needs_auto_limit("SELECT * FROM t LIMIT 10"));
    assert!(!needs_auto_limit("SELECT * FROM t LIMIT 10, 20"));
    assert!(!needs_auto_limit("SELECT * FROM t LIMIT 10 OFFSET 5"));
}

#[test]
fn test_needs_auto_limit_non_select() {
    assert!(!needs_auto_limit("SHOW TABLES"));
    assert!(!needs_auto_limit("DESCRIBE t"));
    assert!(!needs_auto_limit("INSERT INTO t VALUES (1)"));
}

#[test]
fn test_needs_auto_limit_with_cte_select() {
    assert!(needs_auto_limit("WITH cte AS (SELECT 1) SELECT * FROM cte"));
}

#[test]
fn test_needs_auto_limit_with_cte_select_has_limit() {
    assert!(!needs_auto_limit(
        "WITH cte AS (SELECT 1) SELECT * FROM cte LIMIT 10"
    ));
}

#[test]
fn test_needs_auto_limit_with_cte_insert() {
    assert!(!needs_auto_limit(
        "WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte"
    ));
}

#[test]
fn test_needs_auto_limit_subquery_limit_not_top_level() {
    assert!(needs_auto_limit(
        "SELECT * FROM (SELECT id FROM users LIMIT 10) t"
    ));
}

#[test]
fn test_needs_auto_limit_string_literal_limit() {
    assert!(needs_auto_limit(
        "SELECT * FROM t WHERE description = 'LIMIT 1000'"
    ));
}

#[test]
fn test_inject_limit_basic() {
    let sql = "SELECT * FROM t";
    let result = inject_limit_into_select(sql, 1000);
    assert_eq!(result, "SELECT * FROM t LIMIT 1000");
}

#[test]
fn test_inject_limit_before_for_update() {
    let sql = "SELECT * FROM t FOR UPDATE";
    let result = inject_limit_into_select(sql, 100);
    assert!(result.contains("LIMIT 100"));
    assert!(result.contains("FOR UPDATE"));
    let limit_pos = result.find("LIMIT").unwrap();
    let for_pos = result.find("FOR UPDATE").unwrap();
    assert!(limit_pos < for_pos);
}

#[test]
fn test_inject_limit_trims_trailing_semicolon() {
    let sql = "SELECT * FROM t;";
    let result = inject_limit_into_select(sql, 1000);
    assert_eq!(result, "SELECT * FROM t LIMIT 1000");
}

#[test]
fn test_is_read_only_allowed() {
    assert!(is_read_only_allowed("SELECT * FROM t"));
    assert!(is_read_only_allowed("SHOW TABLES"));
    assert!(is_read_only_allowed("DESCRIBE t"));
    assert!(is_read_only_allowed("DESC t"));
    assert!(is_read_only_allowed("EXPLAIN SELECT * FROM t"));
    assert!(is_read_only_allowed(
        "WITH cte AS (SELECT 1) SELECT * FROM cte"
    ));
    assert!(is_read_only_allowed("USE mydb"));
    assert!(is_read_only_allowed("SET session_timeout = 30"));
}

#[test]
fn test_is_read_only_blocked() {
    assert!(!is_read_only_allowed("INSERT INTO t VALUES (1)"));
    assert!(!is_read_only_allowed("UPDATE t SET x = 1"));
    assert!(!is_read_only_allowed("DELETE FROM t"));
    assert!(!is_read_only_allowed("DROP TABLE t"));
    assert!(!is_read_only_allowed("CREATE TABLE t (id INT)"));
    assert!(!is_read_only_allowed("SET GLOBAL max_connections = 100"));
    assert!(!is_read_only_allowed("TRUNCATE TABLE t"));
}

#[test]
fn test_is_read_only_with_dml_blocked() {
    assert!(!is_read_only_allowed(
        "WITH cte AS (SELECT 1) DELETE FROM t WHERE id IN (SELECT * FROM cte)"
    ));
    assert!(!is_read_only_allowed(
        "WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte"
    ));
    assert!(!is_read_only_allowed(
        "WITH cte AS (SELECT 1) UPDATE t SET x = 1"
    ));
}

#[test]
fn test_is_read_only_set_global_forms_blocked() {
    assert!(!is_read_only_allowed("SET @@GLOBAL.max_connections = 100"));
    assert!(!is_read_only_allowed("SET PERSIST max_connections = 100"));
    assert!(!is_read_only_allowed(
        "SET PERSIST_ONLY max_connections = 100"
    ));
    assert!(!is_read_only_allowed("SET PASSWORD = 'newpass'"));
}

#[test]
fn test_is_read_only_set_session_allowed() {
    assert!(is_read_only_allowed("SET SESSION wait_timeout = 60"));
    assert!(is_read_only_allowed("SET LOCAL wait_timeout = 60"));
    assert!(is_read_only_allowed("SET @@session.wait_timeout = 60"));
    assert!(is_read_only_allowed("SET @@local.wait_timeout = 60"));
    assert!(is_read_only_allowed("SET @myvar = 42"));
}

#[test]
fn test_is_read_only_executable_comment_select() {
    assert!(is_read_only_allowed("/*!50001 SELECT * FROM t */"));
}

#[test]
fn test_is_read_only_with_leading_comment() {
    assert!(!is_read_only_allowed("/* comment */ DELETE FROM t"));
    assert!(is_read_only_allowed("/* comment */ SELECT * FROM t"));
    assert!(!is_read_only_allowed("# comment\nDELETE FROM t"));
    assert!(!is_read_only_allowed("-- comment\nDELETE FROM t"));
}

#[test]
fn test_is_read_only_executable_comment() {
    let sql = "/*!50001 DELETE FROM t */";
    assert!(!is_read_only_allowed(sql));
}

#[test]
fn test_base64_standard_encode_samples() {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    assert_eq!(STANDARD.encode(b"Man"), "TWFu");
    assert_eq!(STANDARD.encode(b"Ma"), "TWE=");
    assert_eq!(STANDARD.encode(b"M"), "TQ==");
    assert_eq!(STANDARD.encode(b""), "");
}

#[test]
fn test_read_file_missing() {
    let result = read_file_impl("/nonexistent/path/file.sql");
    assert!(result.is_err());
}

#[test]
fn test_write_and_read_file() {
    let dir = std::env::temp_dir();
    let path = dir.join(format!("test_query_{}.sql", std::process::id()));
    let path_str = path.to_str().unwrap();
    write_file_impl(path_str, "SELECT 1;").expect("write should succeed");
    let content = read_file_impl(path_str).expect("read should succeed");
    assert_eq!(content, "SELECT 1;");
    let _ = std::fs::remove_file(path);
}
