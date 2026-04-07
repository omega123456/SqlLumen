//! Integration tests for the SQL import engine (statement parsing).

mod common;

use sqllumen_lib::export::sql_import::parse_sql_statements;

#[test]
fn parse_simple_statements() {
    let input = "SELECT 1;\nSELECT 2;\nSELECT 3;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 3);
    assert_eq!(stmts[0], "SELECT 1");
    assert_eq!(stmts[1], "SELECT 2");
    assert_eq!(stmts[2], "SELECT 3");
}

#[test]
fn parse_empty_input() {
    let stmts = parse_sql_statements("");
    assert!(stmts.is_empty());
}

#[test]
fn parse_whitespace_only() {
    let stmts = parse_sql_statements("   \n\n  \t  ");
    assert!(stmts.is_empty());
}

#[test]
fn parse_no_trailing_semicolon() {
    let input = "SELECT 1;\nSELECT 2";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 2);
    assert_eq!(stmts[0], "SELECT 1");
    assert_eq!(stmts[1], "SELECT 2");
}

#[test]
fn parse_delimiter_directive() {
    let input = "\
DELIMITER //
CREATE PROCEDURE test_proc()
BEGIN
  SELECT 1;
END //
DELIMITER ;
SELECT 2;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 2);
    assert!(stmts[0].contains("CREATE PROCEDURE"));
    assert!(stmts[0].contains("SELECT 1;"));
    assert!(stmts[0].contains("END"));
    assert_eq!(stmts[1], "SELECT 2");
}

#[test]
fn parse_string_with_semicolons() {
    let input = "INSERT INTO t VALUES ('hello; world');";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 1);
    assert_eq!(stmts[0], "INSERT INTO t VALUES ('hello; world')");
}

#[test]
fn parse_double_quoted_string_with_semicolons() {
    let input = r#"INSERT INTO t VALUES ("hello; world");"#;
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 1);
    assert!(stmts[0].contains(r#""hello; world""#));
}

#[test]
fn parse_single_line_comments_dash_dash() {
    let input = "-- This is a comment\nSELECT 1;\n-- Another comment\nSELECT 2;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 2);
    assert_eq!(stmts[0], "SELECT 1");
    assert_eq!(stmts[1], "SELECT 2");
}

#[test]
fn parse_single_line_comments_hash() {
    let input = "# This is a comment\nSELECT 1;\n# Another\nSELECT 2;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 2);
    assert_eq!(stmts[0], "SELECT 1");
    assert_eq!(stmts[1], "SELECT 2");
}

#[test]
fn parse_multi_line_comments() {
    let input = "/* This is\na multi-line comment */\nSELECT 1;\n/* Another */SELECT 2;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 2);
    // The comment gets replaced with a space, so the trimmed statement is clean
    assert!(stmts[0].contains("SELECT 1"));
    assert!(stmts[1].contains("SELECT 2"));
}

#[test]
fn parse_backtick_identifiers() {
    let input = "SELECT `col;name` FROM `table;name`;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 1);
    assert_eq!(stmts[0], "SELECT `col;name` FROM `table;name`");
}

#[test]
fn parse_escaped_backtick() {
    let input = "SELECT `col``name` FROM t;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 1);
    assert!(stmts[0].contains("`col``name`"));
}

#[test]
fn parse_escaped_single_quote() {
    let input = "INSERT INTO t VALUES ('it''s a test');";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 1);
    assert!(stmts[0].contains("'it''s a test'"));
}

#[test]
fn parse_backslash_escaped_quote() {
    let input = "INSERT INTO t VALUES ('it\\'s a test');";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 1);
    assert!(stmts[0].contains("it\\'s a test"));
}

#[test]
fn parse_multiple_delimiter_changes() {
    let input = "\
DELIMITER $$
CREATE FUNCTION f1() RETURNS INT
BEGIN
  RETURN 1;
END $$
DELIMITER //
CREATE PROCEDURE p1()
BEGIN
  SELECT 2;
END //
DELIMITER ;
SELECT 3;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 3);
    assert!(stmts[0].contains("FUNCTION f1"));
    assert!(stmts[1].contains("PROCEDURE p1"));
    assert_eq!(stmts[2], "SELECT 3");
}

#[test]
fn parse_delimiter_case_insensitive() {
    let input = "delimiter //\nSELECT 1 //\ndelimiter ;\nSELECT 2;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 2);
    assert_eq!(stmts[0], "SELECT 1");
    assert_eq!(stmts[1], "SELECT 2");
}

#[test]
fn parse_comment_only_input() {
    let input = "-- Just a comment\n/* And another */";
    let stmts = parse_sql_statements(input);
    assert!(stmts.is_empty());
}

#[test]
fn parse_mixed_comments_and_statements() {
    let input = "-- header\nSELECT 1; /* inline */ SELECT 2;\n# footer";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 2);
}

#[test]
fn parse_create_table_with_semicolons_in_default() {
    let input = "CREATE TABLE t (\n  name VARCHAR(255) DEFAULT 'hello;world'\n);";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 1);
    assert!(stmts[0].contains("'hello;world'"));
}

#[test]
fn parse_windows_line_endings() {
    let input = "SELECT 1;\r\nSELECT 2;\r\n";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 2);
}

#[test]
fn import_progress_types_serialize() {
    use sqllumen_lib::state::{ImportJobProgress, ImportJobStatus, ImportError};

    let progress = ImportJobProgress {
        job_id: "test-123".to_string(),
        status: ImportJobStatus::Running,
        statements_total: 10,
        statements_done: 5,
        errors: vec![ImportError {
            statement_index: 2,
            sql_preview: "SELECT bad".to_string(),
            error_message: "syntax error".to_string(),
        }],
        stop_on_error: false,
        cancel_requested: false,
        completed_at: None,
    };

    let json = serde_json::to_string(&progress).expect("should serialize");
    assert!(json.contains("\"jobId\""));
    assert!(json.contains("\"statementsTotal\""));
    assert!(json.contains("\"statementsDone\""));
    assert!(json.contains("\"sqlPreview\""));
    assert!(json.contains("\"errorMessage\""));
}

#[test]
fn import_job_status_variants_serialize() {
    use sqllumen_lib::state::ImportJobStatus;

    let running = serde_json::to_string(&ImportJobStatus::Running).unwrap();
    assert_eq!(running, "\"running\"");

    let completed = serde_json::to_string(&ImportJobStatus::Completed).unwrap();
    assert_eq!(completed, "\"completed\"");

    let failed = serde_json::to_string(&ImportJobStatus::Failed).unwrap();
    assert_eq!(failed, "\"failed\"");

    let cancelled = serde_json::to_string(&ImportJobStatus::Cancelled).unwrap();
    assert_eq!(cancelled, "\"cancelled\"");
}

// ── Conditional comments ──────────────────────────────────────────────────

#[test]
fn parse_conditional_comment_preserved_as_executable() {
    let input = "/*!40101 SET NAMES utf8 */;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 1);
    assert!(stmts[0].contains("SET NAMES utf8"));
}

#[test]
fn parse_conditional_comment_interleaved_with_statements() {
    let input = "/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;\nSELECT 1;\n/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 3);
    assert!(stmts[0].contains("SET @OLD_CHARACTER_SET_CLIENT"));
    assert_eq!(stmts[1], "SELECT 1");
    assert!(stmts[2].contains("SET CHARACTER_SET_CLIENT"));
}

#[test]
fn parse_conditional_comment_with_semicolons_inside() {
    // Content inside conditional comments should be treated as executable
    let input = "/*!50003 CREATE FUNCTION f1() RETURNS INT\nBEGIN RETURN 1; END */;";
    let stmts = parse_sql_statements(input);
    // The /*!...*/ content is inlined, so the semicolons inside are part of the executable SQL
    assert!(!stmts.is_empty());
}

// ── Dollar-sign delimiter ─────────────────────────────────────────────────

#[test]
fn parse_dollar_dollar_delimiter() {
    let input = "\
DELIMITER $$
CREATE TRIGGER tr1 BEFORE INSERT ON t FOR EACH ROW
BEGIN
  SET NEW.created_at = NOW();
END $$
DELIMITER ;
SELECT 1;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 2);
    assert!(stmts[0].contains("CREATE TRIGGER"));
    assert!(stmts[0].contains("SET NEW.created_at"));
    assert_eq!(stmts[1], "SELECT 1");
}

// ── Mixed delimiter and conditional comments ──────────────────────────────

#[test]
fn parse_mixed_delimiter_and_conditional_comments() {
    let input = "\
/*!40101 SET NAMES utf8 */;
DELIMITER //
CREATE PROCEDURE p1()
BEGIN
  SELECT 1;
END //
DELIMITER ;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD */;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 3);
    assert!(stmts[0].contains("SET NAMES utf8"));
    assert!(stmts[1].contains("CREATE PROCEDURE"));
    assert!(stmts[2].contains("SET CHARACTER_SET_CLIENT"));
}

// ── CR-only line endings ──────────────────────────────────────────────────

#[test]
fn parse_cr_only_line_endings() {
    // Classic Mac OS-style line endings: \r only
    let input = "SELECT 1;\rSELECT 2;\r";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 2);
}

// ── Mixed line endings (CRLF, LF, CR) ────────────────────────────────────

#[test]
fn parse_mixed_line_endings() {
    let input = "SELECT 1;\r\nSELECT 2;\nSELECT 3;\rSELECT 4;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 4);
}

// ── Nested block comments ─────────────────────────────────────────────────

#[test]
fn parse_block_comment_before_delimiter_directive() {
    let input = "/* setup */\nDELIMITER //\nSELECT 1; //\nDELIMITER ;\nSELECT 2;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 2);
    assert!(stmts[0].contains("SELECT 1;"));
    assert_eq!(stmts[1], "SELECT 2");
}

// ── Only delimiter directives, no actual statements ───────────────────────

#[test]
fn parse_only_delimiters_no_statements() {
    let input = "DELIMITER //\nDELIMITER ;";
    let stmts = parse_sql_statements(input);
    assert!(stmts.is_empty());
}

// ── Statement ending without trailing newline ─────────────────────────────

#[test]
fn parse_no_trailing_newline_after_delimiter() {
    let input = "DELIMITER //\nSELECT 1 //";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 1);
    assert_eq!(stmts[0], "SELECT 1");
}

// ── Delimiter with trailing spaces ────────────────────────────────────────

#[test]
fn parse_delimiter_with_trailing_spaces() {
    let input = "DELIMITER //   \nSELECT 1 //\nDELIMITER ;   \nSELECT 2;";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 2);
}

// ── Double-quoted string with escaped characters ──────────────────────────

#[test]
fn parse_double_quoted_with_backslash_escape() {
    let input = r#"INSERT INTO t VALUES ("he said \"hi\"");"#;
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 1);
}

// ── Single statement no semicolon ─────────────────────────────────────────

#[test]
fn parse_single_statement_without_semicolon() {
    let input = "SELECT NOW()";
    let stmts = parse_sql_statements(input);
    assert_eq!(stmts.len(), 1);
    assert_eq!(stmts[0], "SELECT NOW()");
}

// ── ImportError serde ─────────────────────────────────────────────────────

#[test]
fn import_error_serde_round_trip() {
    use sqllumen_lib::state::ImportError;

    let err = ImportError {
        statement_index: 42,
        sql_preview: "INSERT INTO broken...".to_string(),
        error_message: "Unknown column 'x'".to_string(),
    };

    let json = serde_json::to_value(&err).expect("serialize");
    assert_eq!(json["statementIndex"], serde_json::json!(42));
    assert_eq!(json["sqlPreview"], serde_json::json!("INSERT INTO broken..."));
    assert_eq!(json["errorMessage"], serde_json::json!("Unknown column 'x'"));

    let round_trip: ImportError = serde_json::from_value(json).expect("deserialize");
    assert_eq!(round_trip.statement_index, 42);
}

// ── ImportJobProgress full serde ──────────────────────────────────────────

#[test]
fn import_job_progress_serde_round_trip() {
    use sqllumen_lib::state::{ImportJobProgress, ImportJobStatus, ImportError};

    let progress = ImportJobProgress {
        job_id: "imp-456".to_string(),
        status: ImportJobStatus::Completed,
        statements_total: 100,
        statements_done: 100,
        errors: vec![ImportError {
            statement_index: 50,
            sql_preview: "bad sql".to_string(),
            error_message: "syntax error".to_string(),
        }],
        stop_on_error: true,
        cancel_requested: false,
        completed_at: None,
    };

    let json = serde_json::to_value(&progress).expect("serialize");
    assert_eq!(json["jobId"], serde_json::json!("imp-456"));
    assert_eq!(json["status"], serde_json::json!("completed"));
    assert_eq!(json["statementsTotal"], serde_json::json!(100));
    assert_eq!(json["stopOnError"], serde_json::json!(true));
    assert_eq!(json["cancelRequested"], serde_json::json!(false));
    let errors = json["errors"].as_array().unwrap();
    assert_eq!(errors.len(), 1);

    let round_trip: ImportJobProgress = serde_json::from_value(json).expect("deserialize");
    assert_eq!(round_trip.job_id, "imp-456");
    assert!(round_trip.stop_on_error);
}
