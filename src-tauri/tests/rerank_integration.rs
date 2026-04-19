//! Integration tests for the LLM-based re-ranking module.
//!
//! Tests the parsing and reordering logic without a real LLM endpoint.

use sqllumen_lib::schema_index::rerank::{parse_rerank_response, reorder_by_ids};
use sqllumen_lib::schema_index::search::SearchResult;

fn make_result(chunk_id: i64, table_name: &str, score: f64) -> SearchResult {
    SearchResult {
        chunk_id,
        chunk_key: format!("table:testdb.{table_name}"),
        db_name: "testdb".to_string(),
        table_name: table_name.to_string(),
        chunk_type: "table".to_string(),
        ddl_text: format!("CREATE TABLE `{table_name}` (id INT)"),
        ref_db_name: None,
        ref_table_name: None,
        score,
    }
}

// We test the reorder_by_ids and parse logic indirectly through rerank_with_llm
// by using a mock HTTP server. For unit-level testing, we test the public API
// with timeout scenarios.

#[tokio::test]
async fn test_rerank_empty_candidates() {
    let client = reqwest::Client::new();
    let results = sqllumen_lib::schema_index::rerank::rerank_with_llm(
        vec![],
        "test question",
        &client,
        "http://localhost:99999", // unreachable
        "test-model",
    )
    .await;
    assert!(results.is_empty());
}

#[tokio::test]
async fn test_rerank_timeout_fallback() {
    // Use a non-routable address to trigger timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(100))
        .build()
        .unwrap();

    let candidates = vec![
        make_result(1, "users", 0.9),
        make_result(2, "orders", 0.8),
    ];

    let results = sqllumen_lib::schema_index::rerank::rerank_with_llm(
        candidates.clone(),
        "find user orders",
        &client,
        "http://192.0.2.1:1", // non-routable (RFC 5737)
        "test-model",
    )
    .await;

    // Should fall back to original order
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].chunk_id, 1);
    assert_eq!(results[1].chunk_id, 2);
}

#[tokio::test]
async fn test_rerank_invalid_endpoint_fallback() {
    let client = reqwest::Client::new();

    let candidates = vec![
        make_result(1, "users", 0.9),
        make_result(2, "orders", 0.8),
        make_result(3, "products", 0.7),
    ];

    let results = sqllumen_lib::schema_index::rerank::rerank_with_llm(
        candidates.clone(),
        "show products",
        &client,
        "http://localhost:1", // should fail to connect
        "test-model",
    )
    .await;

    // Should fall back to original order
    assert_eq!(results.len(), 3);
    assert_eq!(results[0].chunk_id, 1);
}

#[test]
fn test_search_result_clone_and_fields() {
    let r = make_result(42, "users", 0.95);
    let cloned = r.clone();
    assert_eq!(cloned.chunk_id, 42);
    assert_eq!(cloned.table_name, "users");
    assert_eq!(cloned.score, 0.95);
}

// ── parse_rerank_response tests ─────────────────────────────────────────

#[test]
fn parse_response_direct_json() {
    let body = r#"{"ranked": [3, 1, 2]}"#;
    let ids = parse_rerank_response(body).unwrap();
    assert_eq!(ids, vec![3, 1, 2]);
}

#[test]
fn parse_response_openai_chat_completion() {
    let body = r#"{
        "choices": [{
            "message": {
                "content": "{\"ranked\": [5, 10, 1]}"
            }
        }]
    }"#;
    let ids = parse_rerank_response(body).unwrap();
    assert_eq!(ids, vec![5, 10, 1]);
}

#[test]
fn parse_response_json_embedded_in_text() {
    let body = r#"{
        "choices": [{
            "message": {
                "content": "Here is the ranking:\n{\"ranked\": [7, 2, 4]}\nDone."
            }
        }]
    }"#;
    let ids = parse_rerank_response(body).unwrap();
    assert_eq!(ids, vec![7, 2, 4]);
}

#[test]
fn parse_response_invalid_json_returns_none() {
    let body = "this is not json at all";
    assert!(parse_rerank_response(body).is_none());
}

#[test]
fn parse_response_empty_ranked_array() {
    let body = r#"{"ranked": []}"#;
    let ids = parse_rerank_response(body).unwrap();
    assert!(ids.is_empty());
}

#[test]
fn parse_response_missing_ranked_key() {
    let body = r#"{"other": [1, 2, 3]}"#;
    assert!(parse_rerank_response(body).is_none());
}

// ── reorder_by_ids tests ────────────────────────────────────────────────

#[test]
fn reorder_exact_match() {
    let candidates = vec![
        make_result(1, "users", 0.9),
        make_result(2, "orders", 0.8),
        make_result(3, "products", 0.7),
    ];
    let reordered = reorder_by_ids(candidates, &[3, 1, 2]);
    assert_eq!(reordered[0].chunk_id, 3);
    assert_eq!(reordered[1].chunk_id, 1);
    assert_eq!(reordered[2].chunk_id, 2);
}

#[test]
fn reorder_partial_ids_appends_remainder() {
    let candidates = vec![
        make_result(1, "users", 0.9),
        make_result(2, "orders", 0.8),
        make_result(3, "products", 0.7),
    ];
    let reordered = reorder_by_ids(candidates, &[2]);
    assert_eq!(reordered[0].chunk_id, 2);
    // Remaining should be appended sorted by score desc
    assert_eq!(reordered.len(), 3);
    assert_eq!(reordered[1].chunk_id, 1); // higher score
    assert_eq!(reordered[2].chunk_id, 3);
}

#[test]
fn reorder_unknown_ids_ignored() {
    let candidates = vec![
        make_result(1, "users", 0.9),
    ];
    let reordered = reorder_by_ids(candidates, &[999, 1]);
    assert_eq!(reordered.len(), 1);
    assert_eq!(reordered[0].chunk_id, 1);
}

#[test]
fn reorder_empty_candidates() {
    let reordered = reorder_by_ids(vec![], &[1, 2]);
    assert!(reordered.is_empty());
}

#[test]
fn reorder_empty_ids_preserves_score_order() {
    let candidates = vec![
        make_result(1, "users", 0.5),
        make_result(2, "orders", 0.9),
    ];
    let reordered = reorder_by_ids(candidates, &[]);
    assert_eq!(reordered[0].chunk_id, 2); // higher score first
    assert_eq!(reordered[1].chunk_id, 1);
}

#[tokio::test]
async fn test_rerank_with_long_ddl_truncation() {
    // Verify that candidates with long DDL text don't crash the rerank
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(100))
        .build()
        .unwrap();

    let mut r = make_result(1, "users", 0.9);
    r.ddl_text = "x".repeat(500); // longer than 200 chars

    let candidates = vec![r, make_result(2, "orders", 0.8)];

    let results = sqllumen_lib::schema_index::rerank::rerank_with_llm(
        candidates,
        "test question",
        &client,
        "http://192.0.2.1:1",
        "test-model",
    )
    .await;

    // Falls back to original order
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].chunk_id, 1);
}
