//! Integration tests for the copy-to-host engine's pure helpers (Phase 2).
//!
//! Covers:
//! - DEFINER-strip regex/scan across various definer formats (stripping +
//!   non-stripping cases), leaving the rest of the DDL intact.
//! - Adaptive batch sizing (small rows vs. large rows against a fixed byte
//!   budget; row cap; single oversized row).
//! - `query_ddl` type strings per object type.
//! - DDL transform helpers (DROP-IF-EXISTS, CREATE-IF-NOT-EXISTS).
//! - Byte-budget computation (fallback + fraction).
//! - Progress/cancel state transitions (running → completed / failed / cancelled)
//!   and the work-list flattening.
//!
//! All helpers are pure, so no MySQL pool is needed; the DB-touching async
//! orchestration is `#[cfg(not(coverage))]` in the engine module and exercised
//! against a live server elsewhere.

use sqllumen_lib::export::copy_to_host::{
    apply_create_if_not_exists, batch_byte_budget, begin_object, complete_object,
    drop_if_exists_statement, has_cross_database_non_table_copy, mark_cancelled, mark_completed,
    mark_failed, new_running_progress, plan_batches, qualified_drop_if_exists_statement,
    qualify_table_ddl_schema, render_row, rewrite_non_table_ddl_schema, should_cancel,
    strip_definer, validate_cross_database_non_table_copy, validate_mysql_identifier_token,
    validate_selection_for_options, CopyObjectType, CopyOptions, CopySelection, InsertMode,
    COPY_BATCH_ROW_CAP, FALLBACK_PACKET_BYTES, FK_CHECKS_DISABLE, FK_CHECKS_ENABLE,
};
use sqllumen_lib::export::sql_dump::{value_byte_len, value_to_literal, SqlDumpValue};
use sqllumen_lib::state::CopyJobStatus;

// ── DEFINER stripping ─────────────────────────────────────────────────────

#[test]
fn test_strip_definer_backtick_user_host() {
    let ddl = "CREATE DEFINER=`root`@`localhost` PROCEDURE `sp_x`() BEGIN END";
    let out = strip_definer(ddl);
    assert_eq!(out, "CREATE PROCEDURE `sp_x`() BEGIN END");
    assert!(!out.to_ascii_uppercase().contains("DEFINER"));
}

#[test]
fn test_strip_definer_single_quoted_user_host() {
    let ddl = "CREATE DEFINER='admin'@'%' FUNCTION fn_y() RETURNS INT RETURN 1";
    let out = strip_definer(ddl);
    assert_eq!(out, "CREATE FUNCTION fn_y() RETURNS INT RETURN 1");
}

#[test]
fn test_strip_definer_single_quoted_user_with_whitespace() {
    let ddl = "CREATE DEFINER='my user'@'%' PROCEDURE `sp_x`() BEGIN END";
    let out = strip_definer(ddl);
    assert_eq!(out, "CREATE PROCEDURE `sp_x`() BEGIN END");
}

#[test]
fn test_strip_definer_backtick_host_with_whitespace() {
    let ddl = "CREATE DEFINER=`root`@`local host` EVENT ev ON SCHEDULE EVERY 1 DAY DO SET @x=1";
    let out = strip_definer(ddl);
    assert_eq!(out, "CREATE EVENT ev ON SCHEDULE EVERY 1 DAY DO SET @x=1");
}

#[test]
fn test_strip_definer_with_spaces_around_equals() {
    let ddl = "CREATE DEFINER = `u`@`h` TRIGGER trg AFTER INSERT ON t FOR EACH ROW SET @x = 1";
    let out = strip_definer(ddl);
    assert_eq!(
        out,
        "CREATE TRIGGER trg AFTER INSERT ON t FOR EACH ROW SET @x = 1"
    );
}

#[test]
fn test_strip_definer_lowercase_keyword() {
    let ddl = "create definer=`root`@`localhost` event ev ON SCHEDULE EVERY 1 DAY DO SET @x=1";
    let out = strip_definer(ddl);
    assert_eq!(out, "create event ev ON SCHEDULE EVERY 1 DAY DO SET @x=1");
}

#[test]
fn test_strip_definer_no_clause_is_unchanged() {
    let ddl = "CREATE TABLE `t` (`id` INT PRIMARY KEY)";
    assert_eq!(strip_definer(ddl), ddl);
}

#[test]
fn test_strip_definer_only_first_occurrence_token_consumed() {
    // The user@host token contains no whitespace; the literal value after it is
    // preserved. A later word that happens to contain "definer" in data is not a
    // concern for DDL, so we just verify the body survives intact.
    let ddl = "CREATE DEFINER=`a`@`b` PROCEDURE p() SELECT 'definer note'";
    let out = strip_definer(ddl);
    assert_eq!(out, "CREATE PROCEDURE p() SELECT 'definer note'");
}

#[test]
fn test_strip_definer_malformed_no_equals_unchanged() {
    // "DEFINER" without a following '=' is not a valid clause; leave untouched.
    let ddl = "SELECT DEFINER FROM t";
    assert_eq!(strip_definer(ddl), ddl);
}

// ── DDL type strings ──────────────────────────────────────────────────────

#[test]
fn test_ddl_type_str_matches_query_ddl_contract() {
    assert_eq!(CopyObjectType::Table.ddl_type_str(), "table");
    assert_eq!(CopyObjectType::Procedure.ddl_type_str(), "procedure");
    assert_eq!(CopyObjectType::Function.ddl_type_str(), "function");
    assert_eq!(CopyObjectType::Trigger.ddl_type_str(), "trigger");
    assert_eq!(CopyObjectType::Event.ddl_type_str(), "event");
}

#[test]
fn test_supports_definer_only_non_tables() {
    assert!(!CopyObjectType::Table.supports_definer());
    assert!(CopyObjectType::Procedure.supports_definer());
    assert!(CopyObjectType::Function.supports_definer());
    assert!(CopyObjectType::Trigger.supports_definer());
    assert!(CopyObjectType::Event.supports_definer());
}

// ── DDL transforms ────────────────────────────────────────────────────────

#[test]
fn test_drop_if_exists_statement_per_type() {
    assert_eq!(
        drop_if_exists_statement(CopyObjectType::Table, "t"),
        "DROP TABLE IF EXISTS `t`"
    );
    assert_eq!(
        drop_if_exists_statement(CopyObjectType::Procedure, "p"),
        "DROP PROCEDURE IF EXISTS `p`"
    );
    assert_eq!(
        drop_if_exists_statement(CopyObjectType::Function, "f"),
        "DROP FUNCTION IF EXISTS `f`"
    );
    assert_eq!(
        drop_if_exists_statement(CopyObjectType::Trigger, "trg"),
        "DROP TRIGGER IF EXISTS `trg`"
    );
    assert_eq!(
        drop_if_exists_statement(CopyObjectType::Event, "ev"),
        "DROP EVENT IF EXISTS `ev`"
    );
}

#[test]
fn test_apply_create_if_not_exists_table() {
    let ddl = "CREATE TABLE `users` (`id` INT)";
    let out = apply_create_if_not_exists(CopyObjectType::Table, ddl);
    assert_eq!(out, "CREATE TABLE IF NOT EXISTS `users` (`id` INT)");
    assert!(out.starts_with("CREATE TABLE IF NOT EXISTS"));
}

#[test]
fn test_apply_create_if_not_exists_idempotent() {
    let ddl = "CREATE TABLE IF NOT EXISTS `users` (`id` INT)";
    assert_eq!(apply_create_if_not_exists(CopyObjectType::Table, ddl), ddl);
}

#[test]
fn test_apply_create_if_not_exists_preserves_leading_ws() {
    let ddl = "\n  CREATE TABLE `t` (`id` INT)";
    let out = apply_create_if_not_exists(CopyObjectType::Table, ddl);
    assert_eq!(out, "\n  CREATE TABLE IF NOT EXISTS `t` (`id` INT)");
}

#[test]
fn test_apply_create_if_not_exists_non_table_unchanged() {
    for (object_type, ddl) in [
        (CopyObjectType::Procedure, "CREATE PROCEDURE p() BEGIN END"),
        (
            CopyObjectType::Function,
            "CREATE FUNCTION f() RETURNS INT RETURN 1",
        ),
        (
            CopyObjectType::Trigger,
            "CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW SET @x=1",
        ),
        (
            CopyObjectType::Event,
            "CREATE EVENT ev ON SCHEDULE EVERY 1 DAY DO SET @x=1",
        ),
    ] {
        assert_eq!(apply_create_if_not_exists(object_type, ddl), ddl);
    }
}

#[test]
fn test_rewrite_non_table_ddl_schema_procedure_header_only() {
    let ddl =
        "CREATE PROCEDURE `shop`.`sp_recalc`() BEGIN SELECT '`shop`.`sp_recalc` literal'; END";
    let out = rewrite_non_table_ddl_schema(
        CopyObjectType::Procedure,
        ddl,
        "shop",
        "shop_copy",
        "sp_recalc",
    );
    assert!(out.starts_with("CREATE PROCEDURE `shop_copy`.`sp_recalc`()"));
    assert!(out.contains("'`shop`.`sp_recalc` literal'"));
}

#[test]
fn test_rewrite_non_table_ddl_schema_function_header_only() {
    let ddl = "CREATE FUNCTION `shop`.`fn_total`() RETURNS INT RETURN 1";
    let out = rewrite_non_table_ddl_schema(
        CopyObjectType::Function,
        ddl,
        "shop",
        "target_db",
        "fn_total",
    );
    assert_eq!(
        out,
        "CREATE FUNCTION `target_db`.`fn_total`() RETURNS INT RETURN 1"
    );
}

#[test]
fn test_rewrite_non_table_ddl_schema_trigger_header_only() {
    let ddl = "CREATE TRIGGER `shop`.`trg_audit` AFTER INSERT ON `users` FOR EACH ROW SET @note = '-- `shop`.`trg_audit` comment-like literal'";
    let out = rewrite_non_table_ddl_schema(
        CopyObjectType::Trigger,
        ddl,
        "shop",
        "audit_copy",
        "trg_audit",
    );
    assert!(out.starts_with("CREATE TRIGGER `audit_copy`.`trg_audit`"));
    assert!(out.contains("'-- `shop`.`trg_audit` comment-like literal'"));
}

#[test]
fn test_rewrite_non_table_ddl_schema_event_header_only() {
    let ddl = "CREATE EVENT `shop`.`ev_nightly` ON SCHEDULE EVERY 1 DAY DO SELECT 'keep `shop`.`ev_nightly`'";
    let out =
        rewrite_non_table_ddl_schema(CopyObjectType::Event, ddl, "shop", "archive", "ev_nightly");
    assert!(out.starts_with("CREATE EVENT `archive`.`ev_nightly`"));
    assert!(out.contains("'keep `shop`.`ev_nightly`'"));
}

#[test]
fn test_rewrite_non_table_ddl_schema_qualifies_unqualified_procedure() {
    let ddl = "CREATE PROCEDURE `sp_recalc`() BEGIN SELECT '`sp_recalc` literal'; END";
    let out = rewrite_non_table_ddl_schema(
        CopyObjectType::Procedure,
        ddl,
        "shop",
        "shop_copy",
        "sp_recalc",
    );
    assert!(out.starts_with("CREATE PROCEDURE `shop_copy`.`sp_recalc`()"));
    assert!(out.contains("'`sp_recalc` literal'"));
}

#[test]
fn test_rewrite_non_table_ddl_schema_qualifies_unqualified_function_same_db_name() {
    let ddl = "CREATE FUNCTION fn_total() RETURNS INT RETURN 1";
    let out =
        rewrite_non_table_ddl_schema(CopyObjectType::Function, ddl, "shop", "shop", "fn_total");
    assert_eq!(
        out,
        "CREATE FUNCTION `shop`.`fn_total`() RETURNS INT RETURN 1"
    );
}

#[test]
fn test_rewrite_non_table_ddl_schema_qualifies_unqualified_trigger_name_only() {
    let ddl = "CREATE TRIGGER trg_audit AFTER INSERT ON `users` FOR EACH ROW SET @note = 'ON `users` literal'";
    let out = rewrite_non_table_ddl_schema(
        CopyObjectType::Trigger,
        ddl,
        "shop",
        "audit_copy",
        "trg_audit",
    );
    assert!(out.starts_with("CREATE TRIGGER `audit_copy`.`trg_audit` AFTER INSERT ON `users`"));
    assert!(out.contains("'ON `users` literal'"));
}

#[test]
fn test_rewrite_non_table_ddl_schema_qualifies_unqualified_event() {
    let ddl = "CREATE EVENT ev_nightly ON SCHEDULE EVERY 1 DAY DO SELECT 'ev_nightly'";
    let out =
        rewrite_non_table_ddl_schema(CopyObjectType::Event, ddl, "shop", "archive", "ev_nightly");
    assert!(out.starts_with("CREATE EVENT `archive`.`ev_nightly` ON SCHEDULE"));
    assert!(out.contains("'ev_nightly'"));
}

#[test]
fn test_qualified_drop_if_exists_statement_per_non_table_type() {
    assert_eq!(
        qualified_drop_if_exists_statement(CopyObjectType::Procedure, "shop_copy", "p"),
        "DROP PROCEDURE IF EXISTS `shop_copy`.`p`"
    );
    assert_eq!(
        qualified_drop_if_exists_statement(CopyObjectType::Function, "shop_copy", "f"),
        "DROP FUNCTION IF EXISTS `shop_copy`.`f`"
    );
    assert_eq!(
        qualified_drop_if_exists_statement(CopyObjectType::Trigger, "shop_copy", "trg"),
        "DROP TRIGGER IF EXISTS `shop_copy`.`trg`"
    );
    assert_eq!(
        qualified_drop_if_exists_statement(CopyObjectType::Event, "shop_copy", "ev"),
        "DROP EVENT IF EXISTS `shop_copy`.`ev`"
    );
}

#[test]
fn test_rewrite_non_table_ddl_schema_leaves_tables_unchanged() {
    let ddl = "CREATE TABLE `shop`.`users` (`id` INT)";
    assert_eq!(
        rewrite_non_table_ddl_schema(CopyObjectType::Table, ddl, "shop", "shop_copy", "users"),
        ddl
    );
}

#[test]
fn test_qualify_table_ddl_schema_adds_target_database() {
    let ddl = "CREATE TABLE `users` (`id` INT)";
    assert_eq!(
        qualify_table_ddl_schema(ddl, "shop_copy", "users"),
        "CREATE TABLE `shop_copy`.`users` (`id` INT)"
    );
}

#[test]
fn test_qualify_table_ddl_schema_handles_if_not_exists_and_backticks() {
    let ddl = "CREATE TABLE IF NOT EXISTS `weird``name` (`id` INT)";
    assert_eq!(
        qualify_table_ddl_schema(ddl, "target`db", "weird`name"),
        "CREATE TABLE IF NOT EXISTS `target``db`.`weird``name` (`id` INT)"
    );
}

#[test]
fn test_qualify_table_ddl_schema_leaves_already_qualified_ddl_unchanged() {
    let ddl = "CREATE TABLE `source`.`users` (`id` INT)";
    assert_eq!(qualify_table_ddl_schema(ddl, "target", "users"), ddl);
}

// ── Insert mode ───────────────────────────────────────────────────────────

#[test]
fn test_insert_mode_keywords() {
    assert_eq!(InsertMode::Insert.keyword(), "INSERT INTO");
    assert_eq!(InsertMode::InsertIgnore.keyword(), "INSERT IGNORE INTO");
    assert_eq!(InsertMode::Replace.keyword(), "REPLACE INTO");
}

// ── Byte budget ───────────────────────────────────────────────────────────

#[test]
fn test_batch_byte_budget_uses_half_of_packet() {
    // 8 MiB packet → 4 MiB budget.
    let budget = batch_byte_budget(Some(8 * 1024 * 1024));
    assert_eq!(budget, 4 * 1024 * 1024);
}

#[test]
fn test_batch_byte_budget_fallback_when_unknown() {
    let budget = batch_byte_budget(None);
    assert_eq!(budget, (FALLBACK_PACKET_BYTES as f64 * 0.5) as u64);
}

#[test]
fn test_batch_byte_budget_zero_uses_fallback() {
    let budget = batch_byte_budget(Some(0));
    assert_eq!(budget, (FALLBACK_PACKET_BYTES as f64 * 0.5) as u64);
}

#[test]
fn test_batch_byte_budget_floor_is_1kib() {
    // A tiny packet still yields at least 1 KiB so an oversized row can ship.
    let budget = batch_byte_budget(Some(100));
    assert_eq!(budget, 1024);
}

// ── render_row + literal building reuse ───────────────────────────────────

#[test]
fn test_render_row_matches_value_literals() {
    let row = vec![
        SqlDumpValue::Int(7),
        SqlDumpValue::QuotedString("ab".to_string()),
        SqlDumpValue::Null,
    ];
    let (tuple, len) = render_row(&row);
    assert_eq!(tuple, "(7, 'ab', NULL)");
    assert_eq!(len, tuple.len());
    // The per-cell building is the shared sql_dump helper.
    assert_eq!(value_to_literal(&SqlDumpValue::Int(7)), "7");
    assert_eq!(value_byte_len(&SqlDumpValue::QuotedString("ab".into())), 4);
}

// ── Adaptive batching ─────────────────────────────────────────────────────

#[test]
fn test_plan_batches_small_rows_single_batch_under_cap() {
    // 5 small rows, generous budget, no cap pressure → one batch.
    let rows: Vec<(String, usize)> = (0..5).map(|_| ("(1)".to_string(), 3)).collect();
    let batches = plan_batches(&rows, 1_000_000, 20, 1000);
    assert_eq!(batches, vec![(0, 5)]);
}

#[test]
fn test_plan_batches_respects_row_cap() {
    // 2500 tiny rows, cap 1000 → 3 batches (1000, 1000, 500).
    let rows: Vec<(String, usize)> = (0..2500).map(|_| ("(1)".to_string(), 3)).collect();
    let batches = plan_batches(&rows, u64::MAX, 20, COPY_BATCH_ROW_CAP);
    assert_eq!(batches, vec![(0, 1000), (1000, 2000), (2000, 2500)]);
    for (s, e) in &batches {
        assert!(e - s <= COPY_BATCH_ROW_CAP);
    }
}

#[test]
fn test_plan_batches_splits_on_byte_budget() {
    // Each row is 100 bytes; budget 250 incl. prefix 10 → ~2 rows/batch.
    // prefix=10, row1: 10+100=110, row2: 110+2+100=212 (<=250 ok),
    // row3: 212+2+100=314 (>250) → close, new batch.
    let rows: Vec<(String, usize)> = (0..5).map(|_| ("x".repeat(100), 100usize)).collect();
    let batches = plan_batches(&rows, 250, 10, 1000);
    assert_eq!(batches, vec![(0, 2), (2, 4), (4, 5)]);
}

#[test]
fn test_plan_batches_single_oversized_row_emitted_alone() {
    // One row exceeds the whole budget → still emitted as its own batch.
    let rows = vec![("big".to_string(), 10_000usize)];
    let batches = plan_batches(&rows, 100, 10, 1000);
    assert_eq!(batches, vec![(0, 1)]);
}

#[test]
fn test_plan_batches_oversized_row_among_small_rows() {
    // small(10), small(10), HUGE(5000), small(10) with budget 100, prefix 10.
    // batch0: rows 0,1 (10+10+10+2=32 <=100; next +2+5000 over) → close [0,2)
    // batch1: huge alone [2,3)
    // batch2: last small [3,4)
    let rows = vec![
        ("a".to_string(), 10usize),
        ("b".to_string(), 10usize),
        ("h".to_string(), 5000usize),
        ("c".to_string(), 10usize),
    ];
    let batches = plan_batches(&rows, 100, 10, 1000);
    assert_eq!(batches, vec![(0, 2), (2, 3), (3, 4)]);
}

#[test]
fn test_plan_batches_empty_input() {
    let rows: Vec<(String, usize)> = vec![];
    assert!(plan_batches(&rows, 1000, 10, 1000).is_empty());
}

// ── FK-check statements ───────────────────────────────────────────────────

#[test]
fn test_fk_check_statements() {
    assert_eq!(FK_CHECKS_DISABLE, "SET FOREIGN_KEY_CHECKS = 0");
    assert_eq!(FK_CHECKS_ENABLE, "SET FOREIGN_KEY_CHECKS = 1");
}

#[test]
fn test_terminal_progress_states_preserve_completed_at_for_fk_restore_paths() {
    let mut completed = new_running_progress("completed".into(), 1);
    mark_completed(&mut completed);
    assert_eq!(completed.status, CopyJobStatus::Completed);
    assert!(completed.completed_at.is_some());

    let mut failed = new_running_progress("failed".into(), 1);
    mark_failed(&mut failed, "copy body failed after FK disable");
    assert_eq!(failed.status, CopyJobStatus::Failed);
    assert!(failed.completed_at.is_some());
    assert_eq!(
        failed.error_message.as_deref(),
        Some("copy body failed after FK disable")
    );

    let mut cancelled = new_running_progress("cancelled".into(), 1);
    cancelled.cancel_requested = true;
    mark_cancelled(&mut cancelled);
    assert_eq!(cancelled.status, CopyJobStatus::Cancelled);
    assert!(cancelled.completed_at.is_some());
}

// ── Selection / work list ─────────────────────────────────────────────────

#[test]
fn test_selection_total_and_work_list_order() {
    let sel = CopySelection {
        tables: vec!["t1".into(), "t2".into()],
        procedures: vec!["p1".into()],
        functions: vec!["f1".into()],
        triggers: vec!["trg1".into()],
        events: vec!["ev1".into()],
    };
    assert_eq!(sel.total(), 6);
    let work = sel.work_list();
    assert_eq!(
        work,
        vec![
            (CopyObjectType::Table, "t1".to_string()),
            (CopyObjectType::Table, "t2".to_string()),
            (CopyObjectType::Procedure, "p1".to_string()),
            (CopyObjectType::Function, "f1".to_string()),
            (CopyObjectType::Trigger, "trg1".to_string()),
            (CopyObjectType::Event, "ev1".to_string()),
        ]
    );
}

#[test]
fn test_copy_options_default_ignores_definer() {
    let opts = CopyOptions::default();
    assert!(opts.ignore_definer);
    assert!(opts.copy_structure);
    assert!(opts.copy_data);
    assert_eq!(opts.insert_mode, InsertMode::Insert);
}

#[test]
fn test_validate_selection_for_options_allows_data_only_non_tables() {
    let selection = CopySelection {
        tables: vec!["users".into()],
        procedures: vec!["sp_recalc".into()],
        functions: vec![],
        triggers: vec![],
        events: vec![],
    };
    let options = CopyOptions {
        copy_structure: false,
        copy_data: true,
        ..CopyOptions::default()
    };

    assert!(validate_selection_for_options(&selection, &options).is_ok());
}

#[test]
fn test_validate_selection_for_options_allows_data_only_tables() {
    let selection = CopySelection {
        tables: vec!["users".into()],
        procedures: vec![],
        functions: vec![],
        triggers: vec![],
        events: vec![],
    };
    let options = CopyOptions {
        copy_structure: false,
        copy_data: true,
        ..CopyOptions::default()
    };

    assert!(validate_selection_for_options(&selection, &options).is_ok());
}

#[test]
fn test_validate_cross_database_non_table_copy_allows_mismatched_databases() {
    let selection = CopySelection {
        tables: vec!["users".into()],
        procedures: vec!["sp_recalc".into()],
        functions: vec![],
        triggers: vec![],
        events: vec![],
    };

    assert!(validate_cross_database_non_table_copy(&selection, "shop", "shop_copy").is_ok());
    assert!(has_cross_database_non_table_copy(
        &selection,
        "shop",
        "shop_copy"
    ));
}

#[test]
fn test_validate_cross_database_non_table_copy_allows_same_database_name() {
    let selection = CopySelection {
        tables: vec![],
        procedures: vec!["sp_recalc".into()],
        functions: vec!["fn_total".into()],
        triggers: vec!["trg_audit".into()],
        events: vec!["ev_nightly".into()],
    };

    assert!(validate_cross_database_non_table_copy(&selection, "shop", "shop").is_ok());
    assert!(has_cross_database_non_table_copy(
        &selection,
        "shop",
        "shop_copy"
    ));
    assert!(!has_cross_database_non_table_copy(
        &selection, "shop", "shop"
    ));
}

#[test]
fn test_validate_mysql_identifier_token_allows_ascii_alnum_and_underscore() {
    assert!(validate_mysql_identifier_token("charset", "utf8mb4").is_ok());
    assert!(validate_mysql_identifier_token("collation", "utf8mb4_0900_ai_ci").is_ok());
    assert!(validate_mysql_identifier_token("collation", "").is_ok());
}

#[test]
fn test_validate_mysql_identifier_token_rejects_sql_injection_chars() {
    let error = validate_mysql_identifier_token("charset", "utf8mb4; DROP DATABASE mysql")
        .expect_err("invalid metadata token should be rejected");
    assert!(error.contains("refusing to interpolate"));
}

// ── Progress / cancel transitions ─────────────────────────────────────────

#[test]
fn test_progress_running_to_completed() {
    let mut p = new_running_progress("job-1".into(), 3);
    assert_eq!(p.status, CopyJobStatus::Running);
    assert_eq!(p.objects_total, 3);
    assert_eq!(p.objects_done, 0);

    begin_object(&mut p, CopyObjectType::Table, "users", Some(50));
    assert_eq!(p.current_object.as_deref(), Some("users"));
    assert_eq!(p.current_object_type.as_deref(), Some("table"));
    assert_eq!(p.rows_total, Some(50));
    assert_eq!(p.rows_done, Some(0));
    complete_object(&mut p);
    assert_eq!(p.objects_done, 1);
    assert!(p.rows_total.is_none());

    complete_object(&mut p);
    complete_object(&mut p);
    assert_eq!(p.objects_done, 3);

    mark_completed(&mut p);
    assert_eq!(p.status, CopyJobStatus::Completed);
    assert!(p.current_object.is_none());
    assert!(p.completed_at.is_some());
    assert!(p.error_message.is_none());
}

#[test]
fn test_progress_running_to_failed_stops_with_message() {
    let mut p = new_running_progress("job-2".into(), 5);
    begin_object(&mut p, CopyObjectType::Trigger, "trg_audit", None);
    complete_object(&mut p); // 1 of 5 done before failure
    mark_failed(&mut p, "ER_NO_SUCH_TABLE: missing privilege");
    assert_eq!(p.status, CopyJobStatus::Failed);
    assert_eq!(p.objects_done, 1, "partial progress preserved on failure");
    assert_eq!(
        p.error_message.as_deref(),
        Some("ER_NO_SUCH_TABLE: missing privilege")
    );
    assert!(p.completed_at.is_some());
}

#[test]
fn test_progress_running_to_cancelled() {
    let mut p = new_running_progress("job-3".into(), 4);
    assert!(!should_cancel(&p));
    p.cancel_requested = true;
    assert!(should_cancel(&p));
    mark_cancelled(&mut p);
    assert_eq!(p.status, CopyJobStatus::Cancelled);
    assert!(p.completed_at.is_some());
}

#[test]
fn test_begin_object_non_table_has_no_row_counters() {
    let mut p = new_running_progress("job-4".into(), 1);
    begin_object(&mut p, CopyObjectType::Procedure, "sp_x", None);
    assert_eq!(p.current_object_type.as_deref(), Some("procedure"));
    assert!(p.rows_total.is_none());
    assert!(p.rows_done.is_none());
}

#[test]
fn test_table_copy_source_counts_rows_for_live_progress_totals() {
    let source = include_str!("../src/export/copy_to_host.rs");
    assert!(
        source.contains("SELECT COUNT(*) AS row_count"),
        "table copy should count exact source rows for rowsTotal progress"
    );
    assert!(
        source.contains("begin_object(p, object_type, &name, rows_total);"),
        "table copy should pass the counted rows_total into progress when object work begins"
    );
}

#[test]
fn test_copy_engine_reuses_live_target_pool_without_use_statement() {
    let source = include_str!("../src/export/copy_to_host.rs");
    assert!(
        source.contains("state.registry.get_pool_by_profile(target_profile_id)"),
        "target resolution must reuse a live pool for the selected saved profile when available"
    );
    assert!(
        source.contains("ResolvedTargetPool { pool, owned: false }"),
        "reused live pools must not be disposed by the copy job"
    );
    assert!(
        !source.contains("format!(\"USE {safe_target_db}\")"),
        "copy jobs must not issue USE against a possibly reused live UI pool"
    );
}

#[test]
fn test_copy_engine_keeps_internal_pool_fallback() {
    let source = include_str!("../src/export/copy_to_host.rs");
    assert!(
        source.contains("open_pool_for_profile(state, target_profile_id).await?"),
        "target resolution must still open an internal pool when no live profile session exists"
    );
    assert!(
        source.contains("ResolvedTargetPool { pool, owned: true }"),
        "internally opened target pools must remain owned/disposed by the copy job"
    );
}

#[test]
fn test_copy_engine_fully_qualifies_target_table_statements() {
    let source = include_str!("../src/export/copy_to_host.rs");
    assert!(source
        .contains("qualified_drop_if_exists_statement(object_type, target_database, &escaped)"));
    assert!(source.contains("TRUNCATE TABLE {safe_target_db}.{safe_target_table}"));
    assert!(source.contains("{safe_target_db}.{safe_target_table}"));
    assert!(source.contains("qualify_table_ddl_schema(ddl, target_database, name)"));
}
