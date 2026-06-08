//! Repository + command-layer tests for session snapshots.

mod common;

use rusqlite::Connection;
use sqllumen_lib::commands::session_snapshots::{
    create_session_snapshot_impl, delete_session_snapshot_impl, get_session_snapshot_impl,
    list_session_snapshots_impl,
};
use sqllumen_lib::db::migrations::run_migrations;
use sqllumen_lib::db::session_snapshots::{
    delete_snapshot, get_state_json, insert_and_prune, list_summaries, NewSnapshot,
};

fn test_conn() -> Connection {
    let mut conn = Connection::open_in_memory().expect("should open in-memory connection");
    run_migrations(&mut conn).expect("should run migrations");
    conn
}

fn sample(trigger: &str, conn_count: i64, tab_count: i64) -> NewSnapshot {
    let summary = format!("[{{\"name\":\"ProdDB\",\"tabCount\":{tab_count}}}]");
    let state =
        format!("{{\"version\":1,\"trigger\":\"{trigger}\",\"connectionCount\":{conn_count}}}");
    NewSnapshot {
        trigger_type: trigger.to_string(),
        connection_count: conn_count,
        tab_count,
        summary_json: summary,
        state_json: state,
    }
}

#[test]
fn test_migration_creates_table_and_index() {
    let conn = test_conn();

    let table_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='session_snapshots'",
            [],
            |row| row.get(0),
        )
        .expect("should query sqlite_master");
    assert_eq!(table_count, 1, "session_snapshots table should exist");

    let index_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_session_snapshots_created_at'",
            [],
            |row| row.get(0),
        )
        .expect("should query sqlite_master for index");
    assert_eq!(index_count, 1, "created_at index should exist");
}

#[test]
fn test_insert_returns_id() {
    let conn = test_conn();
    let id = insert_and_prune(&conn, &sample("manual", 3, 7), 10).expect("insert should succeed");
    assert!(id > 0, "insert should return a positive id");
}

#[test]
fn test_list_newest_first_and_omits_state() {
    let conn = test_conn();
    // RFC-3339 timestamps generated in order; ties broken by id DESC.
    let _id1 = insert_and_prune(&conn, &sample("manual", 1, 1), 10).expect("insert 1");
    let _id2 = insert_and_prune(&conn, &sample("daily", 2, 4), 10).expect("insert 2");
    let id3 = insert_and_prune(&conn, &sample("onClose", 3, 9), 10).expect("insert 3");

    let summaries = list_summaries(&conn).expect("should list");
    assert_eq!(summaries.len(), 3);

    // Newest first: the last inserted has the largest id and >= timestamp.
    assert_eq!(summaries[0].id, id3);
    assert_eq!(summaries[0].trigger_type, "onClose");
    assert_eq!(summaries[0].connection_count, 3);
    assert_eq!(summaries[0].tab_count, 9);

    // The connections summary is parsed from summary_json.
    assert_eq!(summaries[0].connections.len(), 1);
    assert_eq!(summaries[0].connections[0].name, "ProdDB");
    assert_eq!(summaries[0].connections[0].tab_count, 9);

    // Confirms ordering across all rows.
    let ids: Vec<i64> = summaries.iter().map(|s| s.id).collect();
    let mut sorted = ids.clone();
    sorted.sort_by(|a, b| b.cmp(a));
    assert_eq!(ids, sorted, "summaries should be newest (highest id) first");
}

#[test]
fn test_get_returns_exact_state_json() {
    let conn = test_conn();
    let snapshot = sample("manual", 2, 5);
    let expected_state = snapshot.state_json.clone();
    let id = insert_and_prune(&conn, &snapshot, 10).expect("insert");

    let state = get_state_json(&conn, id).expect("get should succeed");
    assert_eq!(state, Some(expected_state));
}

#[test]
fn test_get_missing_returns_none() {
    let conn = test_conn();
    let state = get_state_json(&conn, 9999).expect("get should succeed");
    assert_eq!(state, None);
}

#[test]
fn test_delete_removes_target_row() {
    let conn = test_conn();
    let id = insert_and_prune(&conn, &sample("manual", 1, 1), 10).expect("insert");

    let removed = delete_snapshot(&conn, id).expect("delete should succeed");
    assert!(removed, "delete should report a removed row");

    assert_eq!(get_state_json(&conn, id).expect("get"), None);
    assert_eq!(list_summaries(&conn).expect("list").len(), 0);
}

#[test]
fn test_delete_missing_returns_false() {
    let conn = test_conn();
    let removed = delete_snapshot(&conn, 1234).expect("delete should succeed");
    assert!(!removed, "deleting a missing row should report false");
}

#[test]
fn test_prune_keeps_exactly_keep_newest() {
    let conn = test_conn();
    let keep = 3;
    let mut ids = Vec::new();
    for i in 0..7 {
        ids.push(insert_and_prune(&conn, &sample("manual", i, i), keep).expect("insert"));
    }

    let summaries = list_summaries(&conn).expect("list");
    assert_eq!(
        summaries.len() as i64,
        keep,
        "exactly `keep` rows should remain"
    );

    // The newest 3 inserted ids must be the survivors.
    let surviving: Vec<i64> = summaries.iter().map(|s| s.id).collect();
    let expected_newest = vec![ids[6], ids[5], ids[4]];
    assert_eq!(
        surviving, expected_newest,
        "the newest `keep` rows should survive"
    );
}

#[test]
fn test_prune_keep_larger_than_count_keeps_all() {
    let conn = test_conn();
    for i in 0..4 {
        insert_and_prune(&conn, &sample("manual", i, i), 50).expect("insert");
    }
    assert_eq!(list_summaries(&conn).expect("list").len(), 4);
}

#[test]
fn test_prune_keep_one_keeps_only_newest() {
    let conn = test_conn();
    let mut last_id = 0;
    for i in 0..5 {
        last_id = insert_and_prune(&conn, &sample("manual", i, i), 1).expect("insert");
    }
    let summaries = list_summaries(&conn).expect("list");
    assert_eq!(summaries.len(), 1, "keep = 1 should leave only the newest");
    assert_eq!(summaries[0].id, last_id);
}

#[test]
fn test_inserting_exactly_at_the_limit_keeps_all() {
    let conn = test_conn();
    let keep = 5;
    for i in 0..keep {
        insert_and_prune(&conn, &sample("manual", i, i), keep).expect("insert");
    }
    // Exactly `keep` inserts at the limit -> none pruned.
    assert_eq!(list_summaries(&conn).expect("list").len() as i64, keep);

    // One more crosses the limit -> prune back to `keep`.
    insert_and_prune(&conn, &sample("manual", 99, 99), keep).expect("insert");
    assert_eq!(list_summaries(&conn).expect("list").len() as i64, keep);
}

#[test]
fn test_command_impls_create_list_get_and_delete_snapshots() {
    let state = common::test_app_state();
    let summary_json = "[{\"name\":\"ProdDB\",\"tabCount\":2}]";
    let state_json = "{\"version\":1,\"connections\":[{\"profileId\":\"p-prod\",\"tabs\":[]}]}";

    let created_id =
        create_session_snapshot_impl(&state, "manual", 1, 2, summary_json, state_json, 10)
            .expect("create impl should succeed");
    assert!(created_id > 0, "create impl should return a positive id");

    let summaries = list_session_snapshots_impl(&state).expect("list impl should succeed");
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].id, created_id);
    assert_eq!(summaries[0].trigger_type, "manual");
    assert_eq!(summaries[0].connection_count, 1);
    assert_eq!(summaries[0].tab_count, 2);
    assert_eq!(summaries[0].connections.len(), 1);
    assert_eq!(summaries[0].connections[0].name, "ProdDB");
    assert_eq!(summaries[0].connections[0].tab_count, 2);

    let restored_state =
        get_session_snapshot_impl(&state, created_id).expect("get impl should succeed");
    assert_eq!(restored_state, Some(state_json.to_string()));

    let removed =
        delete_session_snapshot_impl(&state, created_id).expect("delete impl should succeed");
    assert!(removed, "delete impl should report a removed row");

    let after_delete = list_session_snapshots_impl(&state).expect("list after delete should work");
    assert!(after_delete.is_empty(), "delete impl should remove the row");
    assert_eq!(
        get_session_snapshot_impl(&state, created_id).expect("get after delete should succeed"),
        None
    );
}

#[test]
fn test_command_impl_create_prunes_to_keep_limit() {
    let state = common::test_app_state();

    let first_id = create_session_snapshot_impl(
        &state,
        "daily",
        1,
        1,
        "[{\"name\":\"ProdDB\",\"tabCount\":1}]",
        "{\"version\":1,\"ordinal\":1}",
        2,
    )
    .expect("first create should succeed");
    let second_id = create_session_snapshot_impl(
        &state,
        "daily",
        1,
        1,
        "[{\"name\":\"ProdDB\",\"tabCount\":1}]",
        "{\"version\":1,\"ordinal\":2}",
        2,
    )
    .expect("second create should succeed");
    let third_id = create_session_snapshot_impl(
        &state,
        "daily",
        1,
        1,
        "[{\"name\":\"ProdDB\",\"tabCount\":1}]",
        "{\"version\":1,\"ordinal\":3}",
        2,
    )
    .expect("third create should succeed");

    let summaries = list_session_snapshots_impl(&state).expect("list impl should succeed");
    let ids: Vec<i64> = summaries.iter().map(|summary| summary.id).collect();
    assert_eq!(
        ids,
        vec![third_id, second_id],
        "keep=2 should retain newest two"
    );
    assert_eq!(
        get_session_snapshot_impl(&state, first_id).expect("get first should succeed"),
        None,
        "oldest snapshot should be pruned by the command layer"
    );
}

// ── Error-path coverage: trigger map_err closures ────────────────────────

/// Drop the `session_snapshots` table so subsequent `*_impl` calls hit the
/// command-layer `map_err(|e| e.to_string())` closures in
/// `commands/session_snapshots.rs`.
#[test]
fn test_create_session_snapshot_impl_error_when_table_missing() {
    let state = common::test_app_state();
    {
        let conn = state.db.lock().expect("db lock");
        conn.execute_batch("DROP TABLE IF EXISTS session_snapshots")
            .expect("drop");
    }

    let result = create_session_snapshot_impl(
        &state,
        "manual",
        1,
        2,
        "[{\"name\":\"ProdDB\",\"tabCount\":2}]",
        "{\"version\":1}",
        10,
    );
    assert!(
        result.is_err(),
        "should error when session_snapshots table is missing"
    );
    assert!(
        result.unwrap_err().contains("no such table"),
        "error should mention missing table"
    );
}

#[test]
fn test_list_session_snapshots_impl_error_when_table_missing() {
    let state = common::test_app_state();
    {
        let conn = state.db.lock().expect("db lock");
        conn.execute_batch("DROP TABLE IF EXISTS session_snapshots")
            .expect("drop");
    }

    let result = list_session_snapshots_impl(&state);
    assert!(
        result.is_err(),
        "should error when session_snapshots table is missing"
    );
}

#[test]
fn test_get_session_snapshot_impl_error_when_table_missing() {
    let state = common::test_app_state();
    {
        let conn = state.db.lock().expect("db lock");
        conn.execute_batch("DROP TABLE IF EXISTS session_snapshots")
            .expect("drop");
    }

    let result = get_session_snapshot_impl(&state, 1);
    assert!(
        result.is_err(),
        "should error when session_snapshots table is missing"
    );
}

#[test]
fn test_delete_session_snapshot_impl_error_when_table_missing() {
    let state = common::test_app_state();
    {
        let conn = state.db.lock().expect("db lock");
        conn.execute_batch("DROP TABLE IF EXISTS session_snapshots")
            .expect("drop");
    }

    let result = delete_session_snapshot_impl(&state, 1);
    assert!(
        result.is_err(),
        "should error when session_snapshots table is missing"
    );
}
