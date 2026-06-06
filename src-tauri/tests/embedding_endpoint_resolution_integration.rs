//! Integration tests for the effective-embedding-endpoint resolver and the
//! `read_embedding_config` fallback behaviour (embedding URL with chat fallback).

use rusqlite::Connection;
use sqllumen_lib::ai_memory::{read_embedding_config, resolve_embedding_endpoint};
use sqllumen_lib::db::migrations::run_migrations;
use sqllumen_lib::db::settings;

/// Helper: open an in-memory DB and run all migrations so the `settings` table exists.
fn setup_db() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    run_migrations(&conn).expect("run migrations");
    conn
}

fn set(conn: &Connection, key: &str, value: &str) {
    settings::set_setting(conn, key, value).expect("set setting");
}

// ── resolve_embedding_endpoint ─────────────────────────────────────────────

#[test]
fn resolver_falls_back_to_chat_endpoint_when_embedding_key_absent() {
    let conn = setup_db();
    set(&conn, "ai.endpoint", "http://chat.local:11434/v1");

    let resolved = resolve_embedding_endpoint(&conn).expect("resolve");
    assert_eq!(resolved, "http://chat.local:11434/v1");
}

#[test]
fn resolver_falls_back_to_chat_endpoint_when_embedding_key_blank() {
    let conn = setup_db();
    set(&conn, "ai.endpoint", "http://chat.local:11434/v1");
    // Stored-but-empty: settings::get_setting returns Ok(Some("")) for this.
    set(&conn, "ai.embeddingEndpoint", "");

    let resolved = resolve_embedding_endpoint(&conn).expect("resolve");
    assert_eq!(resolved, "http://chat.local:11434/v1");
}

#[test]
fn resolver_treats_whitespace_only_embedding_key_as_blank() {
    let conn = setup_db();
    set(&conn, "ai.endpoint", "http://chat.local:11434/v1");
    set(&conn, "ai.embeddingEndpoint", "   \t  ");

    let resolved = resolve_embedding_endpoint(&conn).expect("resolve");
    assert_eq!(resolved, "http://chat.local:11434/v1");
}

#[test]
fn resolver_returns_embedding_endpoint_when_set() {
    let conn = setup_db();
    set(&conn, "ai.endpoint", "http://chat.local:11434/v1");
    set(
        &conn,
        "ai.embeddingEndpoint",
        "http://embeddings.local:8080/v1",
    );

    let resolved = resolve_embedding_endpoint(&conn).expect("resolve");
    assert_eq!(resolved, "http://embeddings.local:8080/v1");
}

#[test]
fn resolver_trims_embedding_endpoint_value() {
    let conn = setup_db();
    set(&conn, "ai.endpoint", "http://chat.local:11434/v1");
    set(
        &conn,
        "ai.embeddingEndpoint",
        "  http://embeddings.local:8080/v1  ",
    );

    let resolved = resolve_embedding_endpoint(&conn).expect("resolve");
    assert_eq!(resolved, "http://embeddings.local:8080/v1");
}

#[test]
fn resolver_returns_empty_when_both_endpoints_blank() {
    let conn = setup_db();
    // Nothing configured at all.
    let resolved = resolve_embedding_endpoint(&conn).expect("resolve");
    assert_eq!(resolved, "");

    // Both stored but empty.
    set(&conn, "ai.endpoint", "");
    set(&conn, "ai.embeddingEndpoint", "");
    let resolved = resolve_embedding_endpoint(&conn).expect("resolve");
    assert_eq!(resolved, "");
}

#[test]
fn resolver_surfaces_chat_endpoint_deserialization_errors() {
    let conn = setup_db();
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)",
        ("ai.endpoint", "not-json"),
    )
    .expect("insert malformed endpoint value");

    let err = resolve_embedding_endpoint(&conn).expect_err("invalid json should fail");
    assert!(err.contains("expected ident") || err.contains("expected value"));
}

/// Verifies the dual-endpoint split relied on by `semantic_search`: with distinct
/// chat + embedding URLs, the resolver yields the embedding URL (for `embed_texts`)
/// while a direct `ai.endpoint` read yields the chat URL (for `rerank_with_llm`).
#[test]
fn resolver_and_chat_endpoint_diverge_for_semantic_search_split() {
    let conn = setup_db();
    set(&conn, "ai.endpoint", "http://chat.local:11434/v1");
    set(
        &conn,
        "ai.embeddingEndpoint",
        "http://embeddings.local:8080/v1",
    );

    let embedding_endpoint = resolve_embedding_endpoint(&conn).expect("resolve");
    let chat_endpoint = settings::get_setting(&conn, "ai.endpoint")
        .expect("get chat endpoint")
        .unwrap_or_default();

    assert_eq!(embedding_endpoint, "http://embeddings.local:8080/v1");
    assert_eq!(chat_endpoint, "http://chat.local:11434/v1");
    assert_ne!(
        embedding_endpoint, chat_endpoint,
        "embedding and chat endpoints must diverge so embed_texts and rerank_with_llm target different servers"
    );
}

// ── read_embedding_config end-to-end fallback ──────────────────────────────

#[test]
fn read_embedding_config_falls_back_to_chat_endpoint() {
    let conn = setup_db();
    set(&conn, "ai.endpoint", "http://chat.local:11434/v1");
    set(&conn, "ai.embeddingModel", "nomic-embed-text");
    // Stored-but-empty embedding key must succeed via fallback, not error.
    set(&conn, "ai.embeddingEndpoint", "");

    let (endpoint, model) = read_embedding_config(&conn).expect("read config");
    assert_eq!(endpoint, "http://chat.local:11434/v1");
    assert_eq!(model, "nomic-embed-text");
}

#[test]
fn read_embedding_config_uses_embedding_endpoint_when_set() {
    let conn = setup_db();
    set(&conn, "ai.endpoint", "http://chat.local:11434/v1");
    set(
        &conn,
        "ai.embeddingEndpoint",
        "http://embeddings.local:8080/v1",
    );
    set(&conn, "ai.embeddingModel", "nomic-embed-text");

    let (endpoint, model) = read_embedding_config(&conn).expect("read config");
    assert_eq!(endpoint, "http://embeddings.local:8080/v1");
    assert_eq!(model, "nomic-embed-text");
}

#[test]
fn read_embedding_config_errors_when_effective_endpoint_empty() {
    let conn = setup_db();
    set(&conn, "ai.embeddingModel", "nomic-embed-text");
    // Neither endpoint configured → effective endpoint is empty → error.
    let err = read_embedding_config(&conn).expect_err("should error on empty endpoint");
    assert!(err.contains("endpoint"), "unexpected error: {err}");
}

#[test]
fn read_embedding_config_errors_when_model_empty() {
    let conn = setup_db();
    set(&conn, "ai.endpoint", "http://chat.local:11434/v1");
    // No embedding model configured.
    let err = read_embedding_config(&conn).expect_err("should error on empty model");
    assert!(err.contains("model"), "unexpected error: {err}");
}

#[test]
fn read_embedding_config_surfaces_model_deserialization_errors() {
    let conn = setup_db();
    set(&conn, "ai.endpoint", "http://chat.local:11434/v1");
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)",
        ("ai.embeddingModel", "not-json"),
    )
    .expect("insert malformed model value");

    let err = read_embedding_config(&conn).expect_err("invalid json should fail");
    assert!(err.contains("expected ident") || err.contains("expected value"));
}
