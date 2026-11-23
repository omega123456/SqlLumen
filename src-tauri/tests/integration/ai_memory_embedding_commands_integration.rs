//! AI memory commands that call the embedding endpoint (save, move, search,
//! re-embed), against a wiremock embeddings server and in-memory SQLite.

use std::sync::{Arc, Mutex};

use serde_json::json;
use sqllumen_lib::ai_memory::types::{MemoryReembedProgress, MemoryScope};
use sqllumen_lib::commands::ai_memory::{
    MoveMemoryRequest, SaveMemoryRequest, SearchMemoriesRequest, list_connection_memories_impl,
    list_global_memories_impl, list_group_memories_impl, move_memory_full, reembed_all_scopes,
    save_memory_full, search_session_memories,
};
use sqllumen_lib::db::connection_groups::insert_group;
use sqllumen_lib::db::connections::insert_connection;
use sqllumen_lib::db::settings;
use sqllumen_lib::state::AppState;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::common;

const SESSION_ID: &str = "session-1";
const EMBEDDING_STATUS_FAILURE: u16 = 500;

struct MemoryFixture {
    state: AppState,
    connection_id: String,
    group_id: String,
}

async fn embeddings_server() -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": [{ "embedding": [1.0, 0.0, 0.0, 0.0], "index": 0 }]
        })))
        .mount(&server)
        .await;
    server
}

async fn failing_embeddings_server() -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(ResponseTemplate::new(EMBEDDING_STATUS_FAILURE).set_body_string("down"))
        .mount(&server)
        .await;
    server
}

fn memory_fixture(server: &MockServer) -> MemoryFixture {
    sqllumen_lib::init_sqlite_vec();
    let state = common::test_app_state();
    let conn = state.db.lock().expect("db lock");
    let group_id = insert_group(&conn, "Team").expect("group");
    let connection_id = insert_connection(
        &conn,
        &common::new_connection_data("Primary", Some(group_id.clone())),
    )
    .expect("connection");
    let endpoint = format!("{}/v1/chat/completions", server.uri());
    settings::set_setting(&conn, "ai.endpoint", &endpoint).expect("endpoint");
    settings::set_setting(&conn, "ai.embeddingModel", "test-model").expect("model");
    drop(conn);
    state
        .session_profile_map
        .lock()
        .expect("session map lock")
        .insert(SESSION_ID.to_string(), connection_id.clone());
    MemoryFixture {
        state,
        connection_id,
        group_id,
    }
}

fn save_request(content: &str, scope: MemoryScope) -> SaveMemoryRequest {
    SaveMemoryRequest {
        session_id: SESSION_ID.to_string(),
        content: content.to_string(),
        scope,
    }
}

#[tokio::test]
async fn saving_embeds_the_memory_at_each_scope() {
    let server = embeddings_server().await;
    let fixture = memory_fixture(&server);

    for scope in [
        MemoryScope::Connection,
        MemoryScope::Group,
        MemoryScope::Global,
    ] {
        save_memory_full(&fixture.state, &save_request("orders are archived", scope))
            .await
            .expect("save succeeds");
    }

    let connection_memories =
        list_connection_memories_impl(&fixture.state, &fixture.connection_id).expect("list");
    let group_memories = list_group_memories_impl(&fixture.state, &fixture.group_id).expect("list");
    let global_memories = list_global_memories_impl(&fixture.state).expect("list");
    assert_eq!(connection_memories.len(), 1);
    assert_eq!(group_memories.len(), 1);
    assert_eq!(global_memories.len(), 1);
}

#[tokio::test]
async fn a_failed_embedding_discards_the_saved_row() {
    let server = failing_embeddings_server().await;
    let fixture = memory_fixture(&server);

    let error = save_memory_full(
        &fixture.state,
        &save_request("will not stick", MemoryScope::Connection),
    )
    .await
    .expect_err("embedding failure");

    assert!(!error.is_empty());
    let remaining =
        list_connection_memories_impl(&fixture.state, &fixture.connection_id).expect("list");
    assert!(remaining.is_empty());
}

#[tokio::test]
async fn moving_re_embeds_the_memory_at_the_target_scope() {
    let server = embeddings_server().await;
    let fixture = memory_fixture(&server);
    let saved = save_memory_full(
        &fixture.state,
        &save_request("move me", MemoryScope::Connection),
    )
    .await
    .expect("save succeeds");

    let moved = move_memory_full(
        &fixture.state,
        &MoveMemoryRequest {
            memory_id: saved.id,
            from_scope: MemoryScope::Connection,
            to_scope: MemoryScope::Global,
            from_group_id: None,
            from_connection_id: Some(fixture.connection_id.clone()),
            to_group_id: None,
            to_connection_id: None,
        },
    )
    .await
    .expect("move succeeds");

    assert_eq!(moved.content, "move me");
    assert_eq!(moved.scope, MemoryScope::Global);
    let left_behind =
        list_connection_memories_impl(&fixture.state, &fixture.connection_id).expect("list");
    assert!(left_behind.is_empty());
}

#[tokio::test]
async fn searching_returns_saved_memories_for_the_session() {
    let server = embeddings_server().await;
    let fixture = memory_fixture(&server);
    save_memory_full(
        &fixture.state,
        &save_request("invoices live in billing", MemoryScope::Group),
    )
    .await
    .expect("save succeeds");

    let found = search_session_memories(
        &fixture.state,
        &SearchMemoriesRequest {
            session_id: SESSION_ID.to_string(),
            query: "where are invoices".to_string(),
            limit: 5,
        },
    )
    .await
    .expect("search succeeds");

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].content, "invoices live in billing");
}

#[tokio::test]
async fn re_embedding_reports_progress_for_every_scope() {
    let server = embeddings_server().await;
    let fixture = memory_fixture(&server);
    save_memory_full(
        &fixture.state,
        &save_request("re-embed me", MemoryScope::Connection),
    )
    .await
    .expect("save succeeds");
    let reported: Arc<Mutex<Vec<MemoryReembedProgress>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&reported);

    reembed_all_scopes(&fixture.state, move |progress| {
        sink.lock().expect("progress lock").push(progress);
    })
    .await
    .expect("re-embed succeeds");

    let reported = reported.lock().expect("progress lock");
    let reported_owners: Vec<&str> = reported
        .iter()
        .map(|progress| progress.owner_key.as_str())
        .collect();
    assert!(reported_owners.contains(&"global"));
    assert!(reported_owners.contains(&fixture.connection_id.as_str()));
}
