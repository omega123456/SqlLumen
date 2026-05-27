use sqllumen_lib::mysql::ddl_detector::{detect_ddl_tables, DdlDetectionResult};

fn table(database: Option<&str>, table: &str) -> (Option<String>, String) {
    (database.map(str::to_string), table.to_string())
}

#[test]
fn detects_alter_table_with_unqualified_name() {
    let result = detect_ddl_tables("ALTER TABLE users ADD COLUMN email TEXT");

    assert_eq!(
        result,
        DdlDetectionResult::DdlDetected(vec![table(None, "users")])
    );
}

#[test]
fn detects_alter_table_with_qualified_name() {
    let result = detect_ddl_tables("ALTER TABLE mydb.users ADD COLUMN email TEXT");

    assert_eq!(
        result,
        DdlDetectionResult::DdlDetected(vec![table(Some("mydb"), "users")])
    );
}

#[test]
fn detects_create_table() {
    let result = detect_ddl_tables("CREATE TABLE users (id INT PRIMARY KEY)");

    assert_eq!(
        result,
        DdlDetectionResult::DdlDetected(vec![table(None, "users")])
    );
}

#[test]
fn detects_drop_table() {
    let result = detect_ddl_tables("DROP TABLE mydb.users");

    assert_eq!(
        result,
        DdlDetectionResult::DdlDetected(vec![table(Some("mydb"), "users")])
    );
}

#[test]
fn detects_create_index_using_on_target_table() {
    let result = detect_ddl_tables("CREATE INDEX idx_users_email ON mydb.users (email)");

    assert_eq!(
        result,
        DdlDetectionResult::DdlDetected(vec![table(Some("mydb"), "users")])
    );
}

#[test]
fn detects_drop_index_using_on_target_table() {
    let result = detect_ddl_tables("DROP INDEX idx_users_email ON mydb.users");

    assert_eq!(
        result,
        DdlDetectionResult::DdlDetected(vec![table(Some("mydb"), "users")])
    );
}

#[test]
fn detects_rename_table_and_returns_both_old_and_new_names() {
    let result = detect_ddl_tables("RENAME TABLE mydb.users TO mydb.app_users");

    assert_eq!(
        result,
        DdlDetectionResult::DdlDetected(vec![
            table(Some("mydb"), "users"),
            table(Some("mydb"), "app_users"),
        ])
    );
}

#[test]
fn detects_backtick_quoted_identifiers() {
    let result =
        detect_ddl_tables("ALTER TABLE `my-db`.`user-table` ADD COLUMN `display-name` TEXT");

    assert_eq!(
        result,
        DdlDetectionResult::DdlDetected(vec![table(Some("my-db"), "user-table")])
    );
}

#[test]
fn detects_multiple_ddl_statements() {
    let result = detect_ddl_tables(
        "ALTER TABLE users ADD COLUMN email TEXT; CREATE TABLE audit_log (id INT PRIMARY KEY)",
    );

    assert_eq!(
        result,
        DdlDetectionResult::DdlDetected(vec![table(None, "users"), table(None, "audit_log")])
    );
}

#[test]
fn ignores_non_ddl_statements() {
    for sql in [
        "SELECT * FROM users",
        "INSERT INTO users (id) VALUES (1)",
        "UPDATE users SET name = 'Ada' WHERE id = 1",
        "DELETE FROM users WHERE id = 1",
    ] {
        assert_eq!(detect_ddl_tables(sql), DdlDetectionResult::NoDdl);
    }
}

#[test]
fn returns_only_ddl_tables_for_mixed_input() {
    let result = detect_ddl_tables(
        "SELECT * FROM users; ALTER TABLE users ADD COLUMN email TEXT; UPDATE users SET email = 'a@example.com'",
    );

    assert_eq!(
        result,
        DdlDetectionResult::DdlDetected(vec![table(None, "users")])
    );
}

#[test]
fn returns_parse_failed_for_malformed_sql() {
    let result = detect_ddl_tables("ALTER TABLE");

    assert_eq!(result, DdlDetectionResult::ParseFailed);
}

#[test]
fn returns_no_ddl_for_empty_sql() {
    assert_eq!(detect_ddl_tables("   "), DdlDetectionResult::NoDdl);
}

#[test]
fn excludes_truncate_table() {
    assert_eq!(
        detect_ddl_tables("TRUNCATE TABLE mydb.users"),
        DdlDetectionResult::NoDdl
    );
}
