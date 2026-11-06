//! Result views over the cached query-editor result (`mysql::result_view`):
//! sort, filter (JS parity), tombstones, windows, compare-and-swap view writes,
//! the locking-clause detector, the `results.maxRows` startup helper, spill
//! round-trips and the first-window payload size.
//!
//! Everything here is pure cache logic, so it runs (and counts) in coverage
//! builds. The live-MySQL ceiling cases live in `result_row_ceiling_integration`.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use serde_json::{json, Value};
use sqllumen_lib::commands::settings::{
    load_results_max_rows, parse_results_max_rows, RESULTS_MAX_ROWS_DEFAULT,
};
use sqllumen_lib::mysql::query_executor::{
    compare_json_values, effective_row_limit, has_locking_clause, statement_blocked_reason,
    update_result_cell_impl, ColumnMeta, ExecuteQueryResult, FullExportBlockedReason,
    MultiQueryResultItem, RunDatabase, SharedRow, StoredResult,
};
use sqllumen_lib::mysql::result_cache::SlotWrite;
use sqllumen_lib::mysql::result_view::{
    apply_initial_view, commit_result_view, fetch_result_window_impl, first_window,
    is_tinyint_boolean_alias, js_number, js_number_to_string, js_string, js_string_to_number,
    like_pattern_to_regex, normalize_tinyint_value, prepare_result_view, remove_result_rows_impl,
    resolve_spec, set_result_view_impl, slice_window, view_len, ResultViewSpec, SpecMode,
    FIRST_WINDOW_ROWS, MAX_WINDOW_ROWS, STALE_QUERY_MESSAGE,
};
use sqllumen_lib::state::AppState;

use crate::common;

const CONN: &str = "c1";
const TAB: &str = "t1";
const QID: &str = "q1";

fn col(name: &str, data_type: &str) -> ColumnMeta {
    ColumnMeta {
        name: name.to_string(),
        data_type: data_type.to_string(),
    }
}

fn spec(value: Value) -> ResultViewSpec {
    serde_json::from_value(value).expect("valid view spec")
}

fn stored(columns: Vec<ColumnMeta>, rows: Vec<Vec<Value>>) -> StoredResult {
    StoredResult::new(
        QID.to_string(),
        columns,
        common::shared_rows(rows),
        1,
        1,
        0,
        false,
    )
}

fn insert(state: &AppState, columns: Vec<ColumnMeta>, rows: Vec<Vec<Value>>) {
    state
        .result_cache
        .insert(CONN, TAB, vec![stored(columns, rows)]);
}

/// id / name / score rows used by most view tests.
fn people_state() -> AppState {
    let state = common::test_app_state();
    insert(
        &state,
        vec![
            col("id", "INT"),
            col("name", "VARCHAR"),
            col("score", "INT"),
        ],
        vec![
            vec![json!(1), json!("Charlie"), json!(30)],
            vec![json!(2), json!("alice"), Value::Null],
            vec![json!(3), json!("Bob"), json!(5)],
            vec![json!(4), json!("dave"), json!(100)],
        ],
    );
    state
}

fn set_view(state: &AppState, base: u64, value: Value) -> Result<Vec<u32>, String> {
    set_result_view_impl(state, CONN, TAB, 0, QID, base, &spec(value))
        .map(|r| r.first_window.base_indices)
}

fn slot(state: &AppState) -> StoredResult {
    state
        .result_cache
        .get(CONN, TAB)
        .into_entry()
        .expect("cached result")
        .value[0]
        .clone()
}

fn filter_ids(column: &str, operator: &str, value: &str) -> Vec<u32> {
    let state = people_state();
    set_view(
        &state,
        1,
        json!({ "filters": [{ "column": column, "operator": operator, "value": value }] }),
    )
    .expect("filter applies")
}

// ── compare_json_values (moved from the retired sort suite) ───────────────────

#[test]
fn compare_json_values_orders_nulls_numbers_strings_and_mixed_types() {
    use std::cmp::Ordering;
    assert_eq!(
        compare_json_values(&Value::Null, &Value::Null),
        Ordering::Equal
    );
    assert_eq!(
        compare_json_values(&Value::Null, &json!(1)),
        Ordering::Greater
    );
    assert_eq!(compare_json_values(&json!(1), &Value::Null), Ordering::Less);
    assert_eq!(compare_json_values(&json!(2), &json!(10)), Ordering::Less);
    assert_eq!(
        compare_json_values(&json!(1.5), &json!(1.25)),
        Ordering::Greater
    );
    assert_eq!(
        compare_json_values(&json!("a"), &json!("b")),
        Ordering::Less
    );
    assert_eq!(
        compare_json_values(&json!(1), &json!("1")),
        "1".cmp("\"1\"")
    );
    assert_eq!(
        compare_json_values(&json!(true), &json!(false)),
        Ordering::Greater
    );
}

// ── Sort ─────────────────────────────────────────────────────────────────────

#[test]
fn sort_string_column_asc_and_desc() {
    let state = people_state();
    let asc = set_view(
        &state,
        1,
        json!({ "sort": { "column": "name", "direction": "asc" } }),
    )
    .expect("asc");
    // Byte order: uppercase before lowercase, exactly as compare_json_values.
    assert_eq!(asc, vec![2, 0, 1, 3]);
    let desc = set_view(
        &state,
        2,
        json!({ "sort": { "column": "name", "direction": "desc" } }),
    )
    .expect("desc");
    assert_eq!(desc, vec![3, 1, 0, 2]);
}

#[test]
fn sort_numeric_column_is_numeric_with_nulls_last_asc_and_first_desc() {
    let state = people_state();
    let asc = set_view(
        &state,
        1,
        json!({ "sort": { "column": "score", "direction": "asc" } }),
    )
    .expect("asc");
    assert_eq!(asc, vec![2, 0, 3, 1], "5 < 30 < 100, NULL last");
    let desc = set_view(
        &state,
        2,
        json!({ "sort": { "column": "score", "direction": "desc" } }),
    )
    .expect("desc");
    assert_eq!(desc, vec![1, 3, 0, 2], "NULL first in desc");
}

#[test]
fn sort_mixed_types_and_empty_results() {
    let state = common::test_app_state();
    insert(
        &state,
        vec![col("v", "VARCHAR")],
        vec![vec![json!("b")], vec![json!(1)], vec![json!("a")]],
    );
    let order = set_view(
        &state,
        1,
        json!({ "sort": { "column": "v", "direction": "asc" } }),
    )
    .expect("mixed sort");
    assert_eq!(order.len(), 3);

    let empty = common::test_app_state();
    insert(&empty, vec![col("v", "INT")], vec![]);
    let order = set_view(
        &empty,
        1,
        json!({ "sort": { "column": "v", "direction": "asc" } }),
    )
    .expect("empty sort");
    assert!(order.is_empty());
}

#[test]
fn sort_unknown_column_is_an_error_and_missing_results_error() {
    let state = people_state();
    let err = set_view(
        &state,
        1,
        json!({ "sort": { "column": "nope", "direction": "asc" } }),
    )
    .expect_err("unknown sort column");
    assert_eq!(err, "Column 'nope' not found in result set");

    let err = set_result_view_impl(&state, CONN, "other-tab", 0, QID, 1, &spec(json!({})))
        .expect_err("no results for tab");
    assert!(err.contains("No results found"));
    let err = set_result_view_impl(&state, CONN, TAB, 3, QID, 1, &spec(json!({})))
        .expect_err("bad result index");
    assert!(err.contains("Result index 3 out of range"));
}

#[test]
fn sort_keeps_base_rows_and_shares_row_pointers() {
    let state = people_state();
    let before = slot(&state);
    let result = set_result_view_impl(
        &state,
        CONN,
        TAB,
        0,
        QID,
        1,
        &spec(json!({ "sort": { "column": "id", "direction": "desc" } })),
    )
    .expect("sort");
    let after = slot(&state);
    assert!(
        Arc::ptr_eq(&before.rows, &after.rows),
        "base rows never move"
    );
    assert!(Arc::ptr_eq(&result.first_window.rows[0], &before.rows[3]));
    assert_eq!(result.view_version, 2);
    assert_eq!(result.view_row_count, 4);
    assert_eq!(result.total_rows, 4);
}

#[test]
fn clearing_sort_and_filter_restores_the_original_order_without_a_rerun() {
    let state = people_state();
    set_view(
        &state,
        1,
        json!({
            "sort": { "column": "id", "direction": "desc" },
            "filters": [{ "column": "id", "operator": ">", "value": "1" }]
        }),
    )
    .expect("sort and filter");
    assert_eq!(view_len(&slot(&state)), 3);

    let cleared = set_view(&state, 2, json!({})).expect("clear");
    assert_eq!(cleared, vec![0, 1, 2, 3]);
    let current = slot(&state);
    assert!(current.view.is_none(), "cleared view is the identity");
    assert!(current.view_spec.is_empty());
    assert_eq!(current.view_version, 3);
}

#[test]
fn sort_and_filter_combine_in_one_view() {
    let state = people_state();
    let order = set_view(
        &state,
        1,
        json!({
            "sort": { "column": "score", "direction": "desc" },
            "filters": [{ "column": "score", "operator": "IS NOT NULL", "value": "" }]
        }),
    )
    .expect("combined");
    assert_eq!(order, vec![3, 0, 2]);
}

// ── Filters (JS parity) ─────────────────────────────────────────────────────

#[test]
fn filter_operators_null_and_equality() {
    assert_eq!(filter_ids("score", "IS NULL", ""), vec![1]);
    assert_eq!(filter_ids("score", "IS NOT NULL", ""), vec![0, 2, 3]);
    assert_eq!(filter_ids("name", "==", "Bob"), vec![2]);
    assert_eq!(filter_ids("name", "!=", "Bob"), vec![0, 1, 3]);
    // String(null) === "null", exactly as the JS engine compared.
    assert_eq!(filter_ids("score", "==", "null"), vec![1]);
}

#[test]
fn filter_comparisons_are_numeric_when_both_sides_parse_and_skip_nulls() {
    assert_eq!(filter_ids("score", ">", "29"), vec![0, 3]);
    assert_eq!(filter_ids("score", ">=", "30"), vec![0, 3]);
    assert_eq!(filter_ids("score", "<", "30"), vec![2]);
    assert_eq!(filter_ids("score", "<=", "30"), vec![0, 2]);
    // Non-numeric condition: falls back to string comparison (NULL never matches).
    assert_eq!(filter_ids("name", ">", "C"), vec![0, 1, 3]);
    assert_eq!(filter_ids("name", "<=", "Bob"), vec![2]);
    // Empty condition is not numeric, so "30" > "" as strings.
    assert_eq!(filter_ids("score", ">", ""), vec![0, 2, 3]);
}

#[test]
fn filter_like_is_case_insensitive_escapes_literals_and_crosses_newlines() {
    assert_eq!(filter_ids("name", "LIKE", "a%"), vec![1]);
    assert_eq!(filter_ids("name", "LIKE", "_ob"), vec![2]);
    assert_eq!(filter_ids("name", "NOT LIKE", "%a%"), vec![2]);

    let state = common::test_app_state();
    insert(
        &state,
        vec![col("note", "TEXT")],
        vec![
            vec![json!("line one\nline two")],
            vec![json!("a.c")],
            vec![json!("abc")],
            vec![json!("x\ny")],
        ],
    );
    let ids = |pattern: &str| {
        set_result_view_impl(
            &state,
            CONN,
            TAB,
            0,
            QID,
            slot(&state).view_version,
            &spec(
                json!({ "filters": [{ "column": "note", "operator": "LIKE", "value": pattern }] }),
            ),
        )
        .expect("like")
        .first_window
        .base_indices
    };
    assert_eq!(ids("%two"), vec![0], "% matches across newlines");
    assert_eq!(ids("x_y"), vec![3], "_ matches a newline");
    assert_eq!(ids("a.c"), vec![1], ". is literal");
    assert!(like_pattern_to_regex("(a+)[b]")
        .expect("escaped")
        .is_match("(A+)[B]"));
}

#[test]
fn filter_conditions_on_unknown_columns_are_dropped_and_unknown_operators_fail() {
    let state = people_state();
    let ids = set_view(
        &state,
        1,
        json!({ "filters": [
            { "column": "missing", "operator": "==", "value": "x" },
            { "column": "id", "operator": "<", "value": "3" }
        ] }),
    )
    .expect("unknown column dropped");
    assert_eq!(ids, vec![0, 1]);
    assert_eq!(slot(&state).view_spec.filters.len(), 1);

    let err = set_view(
        &state,
        2,
        json!({ "filters": [{ "column": "id", "operator": "~", "value": "1" }] }),
    )
    .expect_err("unknown operator");
    assert!(err.contains("Unsupported filter operator"));
}

#[test]
fn filter_normalizes_tinyint_columns_to_zero_and_one() {
    assert!(is_tinyint_boolean_alias(" tinyint(1) "));
    assert!(is_tinyint_boolean_alias("BOOLEAN"));
    assert!(!is_tinyint_boolean_alias("TINYINT UNSIGNED"));
    assert_eq!(*normalize_tinyint_value(&json!(true)), json!(1));
    assert_eq!(*normalize_tinyint_value(&json!("\u{0}")), json!(0));
    assert_eq!(*normalize_tinyint_value(&json!("10")), json!("10"));

    let state = common::test_app_state();
    insert(
        &state,
        vec![col("flag", "TINYINT"), col("raw", "VARCHAR")],
        vec![
            vec![json!(true), json!(true)],
            vec![json!("\u{1}"), json!("\u{1}")],
            vec![json!(0), json!(false)],
        ],
    );
    let flagged = set_view(
        &state,
        1,
        json!({ "filters": [{ "column": "flag", "operator": "==", "value": "1" }] }),
    )
    .expect("tinyint filter");
    assert_eq!(flagged, vec![0, 1]);
    let raw = set_view(
        &state,
        2,
        json!({ "filters": [{ "column": "raw", "operator": "==", "value": "true" }] }),
    )
    .expect("non-tinyint column keeps JS String(true)");
    assert_eq!(raw, vec![0]);
}

#[test]
fn js_string_matches_javascript_string_conversion() {
    assert_eq!(js_string(&Value::Null), "null");
    assert_eq!(js_string(&json!(true)), "true");
    assert_eq!(js_string(&json!(false)), "false");
    assert_eq!(js_string(&json!(42)), "42");
    assert_eq!(js_string(&json!(u64::MAX)), "18446744073709552000");
    assert_eq!(js_string(&json!(1.0)), "1");
    assert_eq!(js_string(&json!(-0.5)), "-0.5");
    assert_eq!(js_string(&json!(0.000001)), "0.000001");
    assert_eq!(js_string(&json!(1.5e-7)), "1.5e-7");
    assert_eq!(js_string(&json!(1e-7)), "1e-7");
    assert_eq!(js_string(&json!(1e21)), "1e+21");
    assert_eq!(js_string(&json!(1.25e21)), "1.25e+21");
    assert_eq!(
        js_string(&json!(123456789012345680000.0)),
        "123456789012345680000"
    );
    assert_eq!(js_string(&json!(0.0)), "0");
    assert_eq!(js_string(&json!("text")), "text");
    assert_eq!(js_string(&json!({ "kind": "bytes" })), "[object Object]");
    assert_eq!(js_string(&json!([1, null, "a", [2, 3]])), "1,,a,2,3");
    assert_eq!(js_number_to_string(f64::NAN), "NaN");
    assert_eq!(js_number_to_string(f64::INFINITY), "Infinity");
    assert_eq!(js_number_to_string(f64::NEG_INFINITY), "-Infinity");
}

#[test]
fn js_number_matches_javascript_number_coercion() {
    assert_eq!(js_string_to_number(""), 0.0);
    assert_eq!(js_string_to_number(" \t12\n "), 12.0);
    assert_eq!(js_string_to_number("\u{FEFF}7\u{A0}"), 7.0);
    assert_eq!(js_string_to_number("0x1F"), 31.0);
    assert_eq!(js_string_to_number("0O17"), 15.0);
    assert_eq!(js_string_to_number("0b101"), 5.0);
    assert!(js_string_to_number("0x").is_nan());
    assert!(js_string_to_number("0xZ").is_nan());
    assert!(js_string_to_number("-0x10").is_nan());
    assert_eq!(js_string_to_number("Infinity"), f64::INFINITY);
    assert_eq!(js_string_to_number("-Infinity"), f64::NEG_INFINITY);
    assert_eq!(js_string_to_number("+5"), 5.0);
    assert_eq!(js_string_to_number("1e3"), 1000.0);
    assert_eq!(js_string_to_number(".5"), 0.5);
    assert_eq!(js_string_to_number("5."), 5.0);
    assert_eq!(js_string_to_number("-2.5E-1"), -0.25);
    for nan in [
        "abc", "inf", "NaN", "1_000", ".", "1e", "1e+", "--1", "12px",
    ] {
        assert!(js_string_to_number(nan).is_nan(), "{nan:?} should be NaN");
    }
    assert_eq!(js_number(&json!(true)), 1.0);
    assert_eq!(js_number(&json!(false)), 0.0);
    assert_eq!(js_number(&Value::Null), 0.0);
    assert_eq!(js_number(&json!(2.5)), 2.5);
    assert_eq!(js_number(&json!([5])), 5.0);
    assert_eq!(js_number(&json!([])), 0.0);
    assert!(js_number(&json!([1, 2])).is_nan());
    assert!(js_number(&json!({ "a": 1 })).is_nan());
}

#[test]
fn comparison_filters_follow_js_coercion_for_cells_and_conditions() {
    let state = common::test_app_state();
    insert(
        &state,
        vec![col("v", "JSON")],
        vec![
            vec![json!("0x10")],
            vec![json!([5])],
            vec![json!(true)],
            vec![json!({ "a": 1 })],
            vec![json!("Infinity")],
        ],
    );
    let ids = |op: &str, value: &str, base: u64| {
        set_result_view_impl(
            &state,
            CONN,
            TAB,
            0,
            QID,
            base,
            &spec(json!({ "filters": [{ "column": "v", "operator": op, "value": value }] })),
        )
        .expect("filter")
        .first_window
        .base_indices
    };
    // "0x10" → 16, [5] → 5, true → 1; the object and "Infinity" aren't finite
    // and compare as strings: "[object Object]" > "4", "Infinity" > "4".
    assert_eq!(ids(">", "4", 1), vec![0, 1, 3, 4]);
    // An "Infinity" condition is not finite either: plain UTF-16 string
    // comparison ("[" and "t" sort after "I").
    assert_eq!(ids("<", "Infinity", 2), vec![0, 1]);
}

#[test]
fn string_comparisons_use_utf16_code_unit_order_like_javascript() {
    let state = common::test_app_state();
    insert(
        &state,
        vec![col("s", "VARCHAR")],
        vec![vec![json!("\u{FF61}")], vec![json!("\u{1F600}")]],
    );
    // In UTF-16, U+FF61 (0xFF61) sorts after the surrogate pair (0xD83D …),
    // even though its code point is smaller.
    let ids = set_view(
        &state,
        1,
        json!({ "filters": [{ "column": "s", "operator": ">", "value": "\u{1F600}" }] }),
    )
    .expect("utf16 filter");
    assert_eq!(ids, vec![0]);
}

// ── Windows ──────────────────────────────────────────────────────────────────

fn numbered(count: usize) -> AppState {
    let state = common::test_app_state();
    insert(
        &state,
        vec![col("n", "INT")],
        (0..count).map(|i| vec![json!(i)]).collect(),
    );
    state
}

#[test]
fn window_slicing_clamps_limit_and_offset_and_reports_the_view() {
    let state = numbered(2_500);
    let window =
        fetch_result_window_impl(&state, CONN, TAB, 0, QID, 1, 100, 5_000).expect("window");
    assert_eq!(window.offset, 100);
    assert_eq!(window.rows.len(), MAX_WINDOW_ROWS);
    assert_eq!(window.base_indices.first(), Some(&100));
    assert_eq!(window.view_row_count, 2_500);
    assert_eq!(window.view_version, 1);

    let tail = fetch_result_window_impl(&state, CONN, TAB, 0, QID, 1, 2_400, 500).expect("tail");
    assert_eq!(tail.rows.len(), 100);

    let past = fetch_result_window_impl(&state, CONN, TAB, 0, QID, 1, 9_999, 10).expect("past");
    assert_eq!(past.offset, 2_500);
    assert!(past.rows.is_empty());

    assert_eq!(first_window(&slot(&state)).rows.len(), FIRST_WINDOW_ROWS);
    assert_eq!(slice_window(&slot(&state), 0, 0).rows.len(), 0);
}

#[test]
fn window_for_an_old_view_version_is_refused_as_stale() {
    let state = numbered(10);
    set_view(
        &state,
        1,
        json!({ "sort": { "column": "n", "direction": "desc" } }),
    )
    .expect("sort");
    let err = fetch_result_window_impl(&state, CONN, TAB, 0, QID, 1, 0, 10)
        .expect_err("stale view version");
    assert_eq!(err, "view_stale: requested=1 current=2");

    let window = fetch_result_window_impl(&state, CONN, TAB, 0, QID, 2, 0, 3).expect("current");
    assert_eq!(window.base_indices, vec![9, 8, 7]);
}

#[test]
fn requests_for_a_replaced_or_expired_result_are_refused() {
    let state = numbered(5);
    let err = fetch_result_window_impl(&state, CONN, TAB, 0, "old-query", 1, 0, 10)
        .expect_err("stale query id");
    assert_eq!(err, STALE_QUERY_MESSAGE);

    state.result_cache.remove(CONN, TAB);
    let err = fetch_result_window_impl(&state, CONN, TAB, 0, QID, 1, 0, 10).expect_err("expired");
    assert!(err.starts_with("results_expired:"), "{err}");
    let err = set_view(&state, 1, json!({})).expect_err("expired view write");
    assert!(err.starts_with("results_expired:"), "{err}");
}

// ── Tombstones ───────────────────────────────────────────────────────────────

#[test]
fn tombstones_remove_rows_from_counts_windows_and_later_views() {
    let state = people_state();
    let removed =
        remove_result_rows_impl(&state, CONN, TAB, 0, QID, 1, &[1, 3, 99]).expect("remove");
    assert_eq!(removed.view_version, 2);
    assert_eq!(removed.view_row_count, 2);
    assert_eq!(removed.total_rows, 2);

    let window = fetch_result_window_impl(&state, CONN, TAB, 0, QID, 2, 0, 10).expect("window");
    assert_eq!(window.base_indices, vec![0, 2]);

    // Removing again is idempotent; a later view still excludes them.
    remove_result_rows_impl(&state, CONN, TAB, 0, QID, 2, &[1]).expect("idempotent");
    let cleared = set_view(&state, 3, json!({})).expect("clear view");
    assert_eq!(cleared, vec![0, 2], "tombstoned rows never come back");
    assert!(
        slot(&state).view.is_some(),
        "tombstones keep an explicit view"
    );

    let sorted = set_view(
        &state,
        4,
        json!({ "sort": { "column": "id", "direction": "desc" } }),
    )
    .expect("sorted");
    assert_eq!(sorted, vec![2, 0]);

    // Base indices never shift.
    assert_eq!(slot(&state).rows.len(), 4);
    assert_eq!(
        *slot(&state).tombstones,
        [1u32, 3].into_iter().collect::<BTreeSet<_>>()
    );
}

#[test]
fn remove_rows_on_a_sorted_view_keeps_the_sort_order() {
    let state = people_state();
    set_view(
        &state,
        1,
        json!({ "sort": { "column": "id", "direction": "desc" } }),
    )
    .expect("sort");
    remove_result_rows_impl(&state, CONN, TAB, 0, QID, 2, &[2]).expect("remove");
    let window = fetch_result_window_impl(&state, CONN, TAB, 0, QID, 3, 0, 10).expect("window");
    assert_eq!(window.base_indices, vec![3, 1, 0]);
}

#[test]
fn update_result_cell_targets_base_indices_under_a_view_and_refuses_tombstones() {
    let state = people_state();
    set_view(
        &state,
        1,
        json!({
            "sort": { "column": "id", "direction": "desc" },
            "filters": [{ "column": "id", "operator": ">=", "value": "2" }]
        }),
    )
    .expect("view");
    // View is [3, 2, 1]: edit base row 2 ("Bob"), which sits at view position 1.
    let mut updates = HashMap::new();
    updates.insert(1, json!("Bobby"));
    update_result_cell_impl(&state, CONN, TAB, 2, updates, None, QID).expect("edit base row 2");

    let current = slot(&state);
    assert_eq!(current.rows[2][1], json!("Bobby"));
    assert_eq!(current.rows[1][1], json!("alice"), "other rows untouched");
    assert_eq!(
        current.view_version, 2,
        "edits don't change the view version"
    );
    let window = fetch_result_window_impl(&state, CONN, TAB, 0, QID, 2, 1, 1).expect("window");
    assert_eq!(window.rows[0][1], json!("Bobby"));

    remove_result_rows_impl(&state, CONN, TAB, 0, QID, 2, &[2]).expect("delete");
    let mut updates = HashMap::new();
    updates.insert(1, json!("ghost"));
    let err = update_result_cell_impl(&state, CONN, TAB, 2, updates, None, QID)
        .expect_err("tombstoned row");
    assert!(err.contains("was deleted"), "{err}");
    assert_eq!(
        slot(&state).rows[2][1],
        json!("Bobby"),
        "refused edit writes nothing"
    );
}

// ── Compare-and-swap ─────────────────────────────────────────────────────────

#[test]
fn view_write_against_an_old_base_version_is_superseded() {
    let state = people_state();
    set_view(
        &state,
        1,
        json!({ "sort": { "column": "id", "direction": "asc" } }),
    )
    .expect("first");
    let err = set_view(
        &state,
        1,
        json!({ "sort": { "column": "id", "direction": "desc" } }),
    )
    .expect_err("old base version");
    assert_eq!(err, "view_superseded: current=2");

    let err = remove_result_rows_impl(&state, CONN, TAB, 0, QID, 1, &[0])
        .expect_err("old base version for remove");
    assert_eq!(err, "view_superseded: current=2");
}

#[test]
fn a_delete_landing_during_a_view_build_wins_and_its_tombstones_survive() {
    let state = people_state();
    let prepared = prepare_result_view(
        &state,
        CONN,
        TAB,
        0,
        QID,
        1,
        &spec(json!({ "sort": { "column": "name", "direction": "asc" } })),
    )
    .expect("prepare");

    remove_result_rows_impl(&state, CONN, TAB, 0, QID, 1, &[0]).expect("delete lands first");

    let err = commit_result_view(&state, prepared).expect_err("view write refused");
    assert_eq!(err, "view_superseded: current=2");
    let current = slot(&state);
    assert!(current.tombstones.contains(&0), "tombstones stay applied");
    assert_eq!(view_len(&current), 3);

    // Re-issuing against the reported version succeeds and excludes the row.
    let order = set_view(
        &state,
        2,
        json!({ "sort": { "column": "name", "direction": "asc" } }),
    )
    .expect("re-issue");
    assert_eq!(order, vec![2, 1, 3]);
}

#[test]
fn a_view_write_after_a_rerun_or_invalidation_is_refused() {
    let state = people_state();
    let prepared =
        prepare_result_view(&state, CONN, TAB, 0, QID, 1, &spec(json!({}))).expect("prepare");
    // A re-run replaces the slot with a new query id.
    state
        .result_cache
        .insert(CONN, TAB, vec![StoredResult::empty("q2".to_string())]);
    let err = commit_result_view(&state, prepared).expect_err("query id changed");
    assert_eq!(err, STALE_QUERY_MESSAGE);

    let state = people_state();
    let prepared =
        prepare_result_view(&state, CONN, TAB, 0, QID, 1, &spec(json!({}))).expect("prepare");
    // Tab close bumps the invalidation version.
    state.result_cache.remove_with_spill_cleanup(CONN, TAB);
    let err = commit_result_view(&state, prepared).expect_err("invalidated");
    assert_eq!(err, STALE_QUERY_MESSAGE);
}

#[test]
fn slot_modifier_reports_every_refusal_and_leaves_the_cache_unchanged_on_error() {
    let state = people_state();
    let cache = &state.result_cache;
    let version = cache.current_invalidation_version(CONN, TAB);

    let outcome = cache
        .modify_slot_in_place_if_current(CONN, TAB, version + 1, 0, None, None, |_| Ok(()))
        .expect("modifier");
    assert_eq!(outcome, SlotWrite::Invalidated);
    let outcome = cache
        .modify_slot_in_place_if_current(CONN, TAB, version, 5, None, None, |_| Ok(()))
        .expect("modifier");
    assert_eq!(outcome, SlotWrite::Invalidated);
    let outcome = cache
        .modify_slot_in_place_if_current(CONN, "missing", 0, 0, None, None, |_| Ok(()))
        .expect("modifier");
    assert_eq!(outcome, SlotWrite::Invalidated);
    let outcome = cache
        .modify_slot_in_place_if_current(CONN, TAB, version, 0, Some("other"), None, |_| Ok(()))
        .expect("modifier");
    assert_eq!(outcome, SlotWrite::QueryIdMismatch);
    let outcome = cache
        .modify_slot_in_place_if_current(CONN, TAB, version, 0, Some(QID), Some(7), |_| Ok(()))
        .expect("modifier");
    assert_eq!(outcome, SlotWrite::ViewSuperseded { current: 1 });

    let err = cache
        .modify_slot_in_place_if_current(CONN, TAB, version, 0, None, None, |slot| {
            slot.view_version = 99;
            Err::<(), _>("boom".to_string())
        })
        .expect_err("closure error");
    assert_eq!(err, "boom");
    assert_eq!(
        slot(&state).view_version,
        1,
        "failed closure writes nothing"
    );
}

// ── Initial (execute / re-execute) view specs ───────────────────────────────

#[tokio::test]
async fn initial_view_spec_presorts_prefilters_and_drops_unknown_columns() {
    let base = stored(
        vec![col("id", "INT"), col("name", "VARCHAR")],
        vec![
            vec![json!(1), json!("a")],
            vec![json!(2), json!("b")],
            vec![json!(3), json!("c")],
        ],
    );
    let result = apply_initial_view(
        base.clone(),
        Some(spec(json!({
            "sort": { "column": "id", "direction": "desc" },
            "filters": [
                { "column": "id", "operator": "<", "value": "3" },
                { "column": "gone", "operator": "==", "value": "x" },
                { "column": "id", "operator": "??", "value": "x" }
            ]
        }))),
    )
    .await
    .expect("initial view");
    assert_eq!(first_window(&result).base_indices, vec![1, 0]);
    assert_eq!(result.view_spec.filters.len(), 1, "unknown parts dropped");
    assert_eq!(result.view_version, 1);

    let dropped = apply_initial_view(
        base.clone(),
        Some(spec(
            json!({ "sort": { "column": "gone", "direction": "asc" } }),
        )),
    )
    .await
    .expect("unknown sort column dropped, not an error");
    assert!(dropped.view.is_none());
    assert!(dropped.view_spec.is_empty());

    let untouched = apply_initial_view(base.clone(), None)
        .await
        .expect("no spec");
    assert!(untouched.view.is_none());
    let empty = apply_initial_view(base, Some(ResultViewSpec::default()))
        .await
        .expect("empty spec");
    assert!(empty.view.is_none());
}

#[test]
fn strict_spec_resolution_reports_unknown_operators() {
    let columns = vec![col("id", "INT")];
    let err = resolve_spec(
        &spec(json!({ "filters": [{ "column": "id", "operator": "<>", "value": "1" }] })),
        &columns,
        SpecMode::Strict,
    )
    .expect_err("strict");
    assert!(err.contains("Unsupported filter operator '<>'"));
    let lenient = resolve_spec(
        &spec(json!({ "filters": [{ "column": "id", "operator": "<>", "value": "1" }] })),
        &columns,
        SpecMode::Lenient,
    )
    .expect("lenient");
    assert!(lenient.effective.filters.is_empty());
}

// ── Response shapes and payload size ────────────────────────────────────────

#[test]
fn result_items_carry_window_metadata_and_never_the_full_result() {
    let mut result = stored(
        vec![col("id", "INT")],
        (0..1_500).map(|i| vec![json!(i)]).collect(),
    );
    result.truncated = true;
    result.row_ceiling = 1_500;
    result.applied_row_limit = Some(500);
    result.source_sql = "SELECT id FROM t FOR UPDATE".to_string();
    result.full_export_blocked_reason = Some(FullExportBlockedReason::Locking);

    let item = MultiQueryResultItem::from_stored(&result, Some("warn".to_string()), true);
    let json = serde_json::to_value(&item).expect("serialize item");
    assert!(json.get("rows").is_none());
    assert_eq!(json["firstWindow"]["rows"].as_array().unwrap().len(), 1_000);
    assert_eq!(json["firstWindow"]["baseIndices"][999], json!(999));
    assert_eq!(json["firstWindow"]["offset"], json!(0));
    assert_eq!(json["viewRowCount"], json!(1_500));
    assert_eq!(json["viewVersion"], json!(1));
    assert_eq!(json["truncated"], json!(true));
    assert_eq!(json["rowCeiling"], json!(1_500));
    assert_eq!(json["appliedRowLimit"], json!(500));
    assert_eq!(json["fullExportBlockedReason"], json!("locking"));
    assert_eq!(json["sourceSql"], json!("SELECT id FROM t FOR UPDATE"));
    assert_eq!(json["error"], json!("warn"));

    let single = serde_json::to_value(ExecuteQueryResult::from(item)).expect("serialize");
    assert!(single.get("rows").is_none());
    assert!(single.get("sourceSql").is_none());
    assert_eq!(single["totalRows"], json!(1_500));
    assert_eq!(single["fullExportBlockedReason"], json!("locking"));

    let unknown = serde_json::to_value(FullExportBlockedReason::UnknownDatabase).unwrap();
    assert_eq!(unknown, json!("unknownDatabase"));
    assert_eq!(
        serde_json::to_value(FullExportBlockedReason::Call).unwrap(),
        json!("call")
    );
}

#[test]
fn first_window_payload_for_100k_by_10_is_under_200_kb() {
    // Small shared values keep the build cheap even in instrumented builds.
    let row: SharedRow = SharedRow::from(vec![
        json!(100_001),
        json!("Customer 100001"),
        json!("customer100001@example.com"),
        json!("active"),
        json!(4_521),
        json!(17.25),
        json!("2024-01-15 10:30:00"),
        Value::Null,
        json!(1),
        json!("GB"),
    ]);
    let rows: Vec<SharedRow> = (0..100_000).map(|_| Arc::clone(&row)).collect();
    let columns = (0..10).map(|i| col(&format!("c{i}"), "VARCHAR")).collect();
    let result = StoredResult::new(QID.to_string(), columns, Arc::new(rows), 1, 1, 0, true);

    let item = ExecuteQueryResult::from(MultiQueryResultItem::from_stored(&result, None, true));
    let bytes = serde_json::to_vec(&item).expect("serialize");
    assert_eq!(item.first_window.rows.len(), 1_000);
    assert_eq!(item.view_row_count, 100_000);
    assert!(
        bytes.len() < 200_000,
        "first-window payload is {} bytes",
        bytes.len()
    );
}

// ── Spill round-trip ────────────────────────────────────────────────────────

#[test]
fn spill_serialization_round_trips_the_view_and_rerun_context() {
    let mut result = stored(
        vec![col("id", "INT")],
        (0..5).map(|i| vec![json!(i)]).collect(),
    );
    result.view = Some(Arc::new(vec![4, 2, 0]));
    result.view_spec = spec(json!({
        "sort": { "column": "id", "direction": "desc" },
        "filters": [{ "column": "id", "operator": "!=", "value": "1" }]
    }));
    result.view_version = 7;
    result.tombstones = Arc::new([3u32].into_iter().collect());
    result.truncated = true;
    result.row_ceiling = 5;
    result.applied_row_limit = Some(500);
    result.source_sql = "SELECT id FROM t".to_string();
    result.run_database = RunDatabase::Named("shop".to_string());
    let mut no_db = StoredResult::empty("q2".to_string());
    no_db.run_database = RunDatabase::NoDatabase;
    no_db.full_export_blocked_reason = Some(FullExportBlockedReason::UnknownDatabase);

    // The cache's spill worker uses exactly this encoding.
    let bytes = rmp_serde::to_vec_named(&vec![result.clone(), no_db]).expect("spill encode");
    let restored: Vec<StoredResult> = rmp_serde::from_slice(&bytes).expect("spill decode");

    let first = &restored[0];
    assert_eq!(first.view.as_deref(), Some(&vec![4, 2, 0]));
    assert_eq!(first.view_spec, result.view_spec);
    assert_eq!(first.view_version, 7);
    assert_eq!(*first.tombstones, *result.tombstones);
    assert!(first.truncated);
    assert_eq!(first.row_ceiling, 5);
    assert_eq!(first.applied_row_limit, Some(500));
    assert_eq!(first.source_sql, "SELECT id FROM t");
    assert_eq!(first.run_database, RunDatabase::Named("shop".to_string()));
    assert_eq!(first.full_export_blocked_reason, None);
    assert_eq!(first.rows[4][0], json!(4));
    assert_eq!(restored[1].run_database, RunDatabase::NoDatabase);
    assert_eq!(
        restored[1].full_export_blocked_reason,
        Some(FullExportBlockedReason::UnknownDatabase)
    );
    assert_eq!(
        StoredResult::empty("x".into()).run_database,
        RunDatabase::NotCaptured
    );
}

// ── Locking detector, row limit clamp, blocked reasons ─────────────────────

#[test]
fn locking_clause_detector_is_conservative() {
    for sql in [
        "SELECT * FROM t FOR UPDATE",
        "select * from t for update nowait",
        "SELECT * FROM t FOR SHARE SKIP LOCKED",
        "SELECT * FROM a JOIN b FOR UPDATE OF a",
        "SELECT * FROM t LOCK IN SHARE MODE;",
        "SELECT * FROM t FOR UPDATE; -- trailing comment",
        "SELECT * FROM t FOR UPDATE /* why */",
        "SELECT * FROM (SELECT id FROM t FOR UPDATE) x",
        "WITH c AS (SELECT * FROM t FOR SHARE) SELECT * FROM c",
        "SELECT * FROM t\nFOR\n  UPDATE",
        "SELECT 'it''s' AS a FROM t FOR UPDATE",
        "SELECT * FROM orders WHERE sku LIKE '#%' FOR UPDATE",
        "SELECT * FROM t WHERE note = '-- x' FOR UPDATE",
        "SELECT * FROM t WHERE note = '/*' FOR SHARE",
        "SELECT a--1 FROM t FOR UPDATE",
        "SELECT `x\\`, '#' FROM t FOR UPDATE",
        "SELECT * FROM t /*!50000 FOR UPDATE */",
        "SELECT * FROM t --\nFOR UPDATE",
    ] {
        assert!(has_locking_clause(sql), "{sql:?} should be locking");
    }
    for sql in [
        "SELECT * FROM t",
        "SELECT 'FOR UPDATE' AS label FROM t",
        "SELECT \"lock in share mode\" FROM t",
        "SELECT `for` FROM t",
        "SELECT * FROM t -- FOR UPDATE",
        "SELECT * FROM t /* FOR SHARE */",
        "SELECT * FROM t # FOR UPDATE",
        "INSERT INTO t VALUES (1) ON DUPLICATE KEY UPDATE a = 1",
        "SELECT 'a\\'FOR UPDATE' FROM t",
        "SELECT for_update FROM t",
        "SELECT * FROM t FOR. UPDATE",
        "SELECT a -- FOR UPDATE",
        "SELECT a --\tFOR UPDATE",
        "SELECT * FROM t /* FOR UPDATE",
    ] {
        assert!(!has_locking_clause(sql), "{sql:?} should not be locking");
    }
}

#[test]
fn row_limit_clamp_and_statement_blocked_reasons() {
    assert_eq!(effective_row_limit(500, 100_000), 500);
    assert_eq!(effective_row_limit(0, 100_000), 1_000);
    assert_eq!(effective_row_limit(5_000_000, 100_000), 100_000);
    assert_eq!(effective_row_limit(500, 0), 1);

    assert_eq!(
        statement_blocked_reason("CALL p()", true),
        Some(FullExportBlockedReason::Call)
    );
    assert_eq!(
        statement_blocked_reason("SELECT 1 FOR UPDATE", false),
        Some(FullExportBlockedReason::Locking)
    );
    assert_eq!(statement_blocked_reason("SELECT 1", false), None);
}

// ── results.maxRows startup helper ──────────────────────────────────────────

#[test]
fn startup_helper_reads_clamps_and_defaults_results_max_rows() {
    let conn = common::test_db();
    assert_eq!(load_results_max_rows(&conn), RESULTS_MAX_ROWS_DEFAULT);

    let set = |value: &str| {
        sqllumen_lib::db::settings::set_setting(&conn, "results.maxRows", value).expect("set");
        load_results_max_rows(&conn)
    };
    assert_eq!(set("5000"), 5_000);
    assert_eq!(set(" 2500 "), 2_500);
    assert_eq!(set("10"), 1_000);
    assert_eq!(set("5000000"), 1_000_000);
    assert_eq!(set("abc"), RESULTS_MAX_ROWS_DEFAULT);
    assert_eq!(set("-5"), RESULTS_MAX_ROWS_DEFAULT);
    assert_eq!(parse_results_max_rows("1.5"), None);

    // An unreadable settings table falls back to the default.
    let broken = common::test_conn();
    assert_eq!(load_results_max_rows(&broken), RESULTS_MAX_ROWS_DEFAULT);
}

// ── Coverage-build execute stubs with view specs ────────────────────────────

#[cfg(coverage)]
mod coverage_stubs {
    use super::*;
    use sqllumen_lib::mysql::query_executor::{
        execute_call_query_impl, execute_multi_query_impl, execute_query_impl,
        reexecute_single_result_impl,
    };
    use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
    use tokio_util::sync::CancellationToken;

    fn register(state: &AppState) {
        let pool = MySqlPoolOptions::new().connect_lazy_with(
            MySqlConnectOptions::new()
                .host("127.0.0.1")
                .port(13306)
                .username("dummy")
                .password("dummy"),
        );
        state.registry.insert(
            CONN.to_string(),
            RegistryEntry {
                pool,
                session_id: CONN.to_string(),
                profile_id: "p".to_string(),
                status: ConnectionStatus::Connected,
                server_version: "8.0".to_string(),
                cancellation_token: CancellationToken::new(),
                connection_params: StoredConnectionParams {
                    profile_id: "p".to_string(),
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
                },
                read_only: false,
            },
        );
    }

    #[tokio::test]
    async fn execute_stubs_clamp_the_row_limit_and_report_window_metadata() {
        let state = common::test_app_state();
        register(&state);
        state.result_cache.set_row_ceiling(2_000);

        let single = execute_query_impl(
            &state,
            CONN,
            TAB,
            "SELECT * FROM t FOR UPDATE",
            5_000,
            Some(spec(
                json!({ "sort": { "column": "x", "direction": "asc" } }),
            )),
        )
        .await
        .expect("stub");
        assert_eq!(single.applied_row_limit, Some(2_000));
        assert_eq!(single.row_ceiling, 2_000);
        assert_eq!(
            single.full_export_blocked_reason,
            Some(FullExportBlockedReason::Locking)
        );

        let multi = execute_multi_query_impl(
            &state,
            CONN,
            TAB,
            vec!["SELECT 1".to_string(), "CALL p()".to_string()],
            0,
        )
        .await
        .expect("multi stub");
        assert_eq!(multi.results[0].applied_row_limit, Some(1_000));
        assert_eq!(
            multi.results[1].full_export_blocked_reason,
            Some(FullExportBlockedReason::Call)
        );

        let call = execute_call_query_impl(&state, CONN, TAB, "CALL p()", 10)
            .await
            .expect("call stub");
        assert_eq!(
            call.results[0].full_export_blocked_reason,
            Some(FullExportBlockedReason::Call)
        );
    }

    #[tokio::test]
    async fn reexecute_stub_returns_a_presorted_prefiltered_first_window() {
        let state = common::test_app_state();
        register(&state);
        insert(
            &state,
            vec![col("id", "INT")],
            (0..5).map(|i| vec![json!(i)]).collect(),
        );

        let item = reexecute_single_result_impl(
            &state,
            CONN,
            TAB,
            0,
            "SELECT id FROM t",
            500,
            Some(spec(json!({
                "sort": { "column": "id", "direction": "desc" },
                "filters": [
                    { "column": "id", "operator": ">", "value": "1" },
                    { "column": "gone", "operator": "==", "value": "1" }
                ]
            }))),
        )
        .await
        .expect("re-execute stub");
        assert_eq!(item.first_window.base_indices, vec![4, 3, 2]);
        assert_eq!(item.view_row_count, 3);
        assert_eq!(item.total_rows, 5);
        assert_eq!(slot(&state).view_spec.filters.len(), 1);
    }
}
