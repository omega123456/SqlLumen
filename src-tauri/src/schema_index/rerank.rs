//! Optional cross-encoder re-ranking via LLM.
//!
//! When `ai.retrieval.rerankEnabled` is true, the top-N search candidates are
//! sent to the configured LLM endpoint with a ranking prompt. The LLM returns
//! a JSON object `{"ranked": [chunkId, ...]}` that reorders the candidates.
//!
//! On any failure (timeout, malformed JSON, missing IDs), the original order is
//! preserved silently.

use super::search::SearchResult;
use crate::ai::chat_compat::{
    is_local_eligible, reasoning_strategy_name, strip_known_hidden_reasoning_markers,
    ReasoningStrategy,
};
use crate::ai::client::{
    apply_reasoning_off_compatibility_to_latest_user, prepare_local_compat_request,
};
use crate::ai::types::IpcMessage;
use crate::state::AppState;
use serde::{Deserialize, Serialize};

/// Rerank search results using an LLM cross-encoder.
///
/// Sends the candidate chunk IDs and summaries to the LLM, which returns a
/// reordered subset. Falls back to the original order on any error.
///
/// # Arguments
/// * `candidates` — top-N search results to rerank
/// * `question` — the user's original question
/// * `client` — HTTP client for the LLM call
/// * `endpoint` — base URL for the LLM API
/// * `model` — model name for the chat completion
///
/// Returns the candidates in re-ranked order, or the original order on failure.
pub async fn rerank_with_llm(
    state: &AppState,
    candidates: Vec<SearchResult>,
    question: &str,
    client: &reqwest::Client,
    endpoint: &str,
    model: &str,
) -> Vec<SearchResult> {
    if candidates.is_empty() {
        return candidates;
    }

    // Build the candidate list for the prompt
    let candidate_list: Vec<RerankCandidate> = candidates
        .iter()
        .map(|r| {
            // Truncate text_for_embedding / ddl_text to ~200 chars for the summary
            let summary = if r.ddl_text.len() > 200 {
                let truncated = r
                    .ddl_text
                    .char_indices()
                    .nth(200)
                    .map_or(r.ddl_text.as_str(), |(i, _)| &r.ddl_text[..i]);
                format!("{}…", truncated)
            } else {
                r.ddl_text.clone()
            };
            RerankCandidate {
                id: r.chunk_id,
                name: format!("`{}`.`{}`", r.db_name, r.table_name),
                summary,
            }
        })
        .collect();

    let candidates_json =
        serde_json::to_string(&candidate_list).unwrap_or_else(|_| "[]".to_string());

    let system_prompt = "You rank database tables by relevance to a user question. \
        Return JSON {\"ranked\":[chunkId,...]} containing a subset of the input ids \
        in best-first order.";

    let user_prompt = format!("Question: \"{question}\"\nCandidates: {candidates_json}");

    let hidden_messages = vec![
        IpcMessage {
            role: "system".to_string(),
            content: system_prompt.to_string(),
        },
        IpcMessage {
            role: "user".to_string(),
            content: user_prompt,
        },
    ];

    let chat_url = crate::ai::client::normalise_to_chat_completions_url(endpoint);
    let is_local_endpoint = is_local_eligible(endpoint);
    let (strategy, provider_messages, reasoning_fields) = if is_local_endpoint {
        match prepare_local_compat_request(state, client, endpoint, model, hidden_messages.clone()).await {
            Ok(prepared) => prepared,
            Err(error) => {
                tracing::warn!(endpoint = %endpoint, model = %model, error = %error, "rerank compatibility strategy unavailable; preserving original order");
                return candidates;
            }
        }
    } else {
        let provider_messages: Vec<crate::ai::types::ApiMessage> = hidden_messages
            .iter()
            .map(crate::ai::types::ApiMessage::from)
            .collect();
        let mut body = serde_json::json!({
            "messages": provider_messages,
        });
        apply_reasoning_off_compatibility_to_latest_user(
            body.as_object_mut().expect("messages object"),
        );
        if let Some(messages) = body.get("messages").and_then(|v| v.as_array()) {
            (ReasoningStrategy::StandardFields, serde_json::from_value(serde_json::Value::Array(messages.clone())).unwrap_or_default(), body)
        } else {
            (ReasoningStrategy::StandardFields, Vec::new(), body)
        }
    };

    tracing::debug!(
        endpoint = %crate::ai::chat_compat::normalize_endpoint_key(endpoint),
        model = %model,
        strategy = reasoning_strategy_name(strategy),
        "rerank applying reasoning compatibility strategy"
    );

    let mut request_body_obj = serde_json::json!({
        "model": model,
        "messages": provider_messages,
        "temperature": 0.0,
        "max_tokens": 512
    })
    .as_object()
    .cloned()
    .unwrap_or_default();
    if is_local_endpoint {
        if let Some(obj) = reasoning_fields.as_object() {
            request_body_obj.extend(obj.clone());
        }
    } else {
        apply_reasoning_off_compatibility_to_latest_user(&mut request_body_obj);
    }
    let request_body = serde_json::Value::Object(request_body_obj);

    // 6 second timeout
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(6),
        client.post(&chat_url).json(&request_body).send(),
    )
    .await;

    let response = match result {
        Ok(Ok(resp)) => resp,
        Ok(Err(e)) => {
            tracing::warn!(error = %e, "rerank_with_llm: HTTP request failed, falling back to original order");
            return candidates;
        }
        Err(_) => {
            tracing::warn!(
                "rerank_with_llm: request timed out (6s), falling back to original order"
            );
            return candidates;
        }
    };

    let body = match response.text().await {
        Ok(text) => text,
        Err(e) => {
            tracing::warn!(error = %e, "rerank_with_llm: failed to read response body");
            return candidates;
        }
    };

    // Parse response: look for {"ranked": [...]} in the assistant message content
    let sanitized_body = strip_known_hidden_reasoning_markers(&body, Some(strategy));
    let ranked_ids = parse_rerank_response(&sanitized_body);

    match ranked_ids {
        Some(ids) if !ids.is_empty() => reorder_by_ids(candidates, &ids),
        _ => {
            tracing::warn!(
                http_body_len = sanitized_body.len(),
                error_kind = "parse_ranked_ids_failed",
                "rerank_with_llm: could not parse ranked IDs from LLM response"
            );
            candidates
        }
    }
}

#[derive(Debug, Serialize)]
struct RerankCandidate {
    id: i64,
    name: String,
    summary: String,
}

#[derive(Debug, Deserialize)]
struct RerankOutput {
    ranked: Vec<i64>,
}

/// Parse the LLM chat completion response to extract ranked chunk IDs.
pub fn parse_rerank_response(response_body: &str) -> Option<Vec<i64>> {
    // Try to parse as OpenAI-style chat completion
    #[derive(Deserialize)]
    struct ChatCompletion {
        choices: Vec<ChatChoice>,
    }
    #[derive(Deserialize)]
    struct ChatChoice {
        message: ChatMessage,
    }
    #[derive(Deserialize)]
    struct ChatMessage {
        content: String,
    }

    let content = if let Ok(completion) = serde_json::from_str::<ChatCompletion>(response_body) {
        completion.choices.first()?.message.content.clone()
    } else {
        // Maybe the response body IS the content directly
        response_body.to_string()
    };
    // Try to parse the content as RerankOutput
    // First try direct parse, then look for JSON in the text
    if let Ok(output) = serde_json::from_str::<RerankOutput>(&content) {
        return Some(output.ranked);
    }

    // Try to find JSON object in the text
    if let Some(start) = content.find('{') {
        if let Some(end) = content.rfind('}') {
            let json_str = &content[start..=end];
            if let Ok(output) = serde_json::from_str::<RerankOutput>(json_str) {
                return Some(output.ranked);
            }
        }
    }

    None
}

/// Reorder candidates according to the given ID order.
/// IDs not in the ranked list are appended at the end in their original order.
pub fn reorder_by_ids(candidates: Vec<SearchResult>, ranked_ids: &[i64]) -> Vec<SearchResult> {
    use std::collections::HashMap;

    let mut id_to_result: HashMap<i64, SearchResult> =
        candidates.into_iter().map(|r| (r.chunk_id, r)).collect();

    let mut reordered = Vec::new();

    // Add results in the ranked order
    for id in ranked_ids {
        if let Some(result) = id_to_result.remove(id) {
            reordered.push(result);
        }
    }

    // Append remaining results not in the ranked list
    let mut remaining: Vec<SearchResult> = id_to_result.into_values().collect();
    remaining.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    reordered.extend(remaining);

    reordered
}
