//! Optional cross-encoder re-ranking via LLM.
//!
//! When `ai.retrieval.rerankEnabled` is true, the top-N search candidates are
//! sent to the configured LLM endpoint with a ranking prompt. The LLM returns
//! a JSON object `{"ranked": [chunkId, ...]}` that reorders the candidates.
//!
//! On any failure (timeout, malformed JSON, missing IDs), the original order is
//! preserved silently.

use super::search::SearchResult;
use crate::ai::local_compat::CapabilityCache;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Timeout for hidden compat rerank call (seconds).
const RERANK_COMPAT_TIMEOUT_SECS: u64 = 4;

/// Rerank search results using an LLM cross-encoder.
///
/// Sends the candidate chunk IDs and summaries to the LLM, which returns a
/// reordered subset. Falls back to the original order on any error.
///
/// When a `capability_cache` is provided and the endpoint is local with
/// completions support, routes through the raw `/v1/completions` path with
/// reasoning disabled. Otherwise uses the chat completions path.
///
/// # Arguments
/// * `candidates` — top-N search results to rerank
/// * `question` — the user's original question
/// * `client` — HTTP client for the LLM call
/// * `endpoint` — base URL for the LLM API
/// * `model` — model name for the chat completion
/// * `capability_cache` — optional capability cache for compat routing
///
/// Returns the candidates in re-ranked order, or the original order on failure.
pub async fn rerank_with_llm(
    candidates: Vec<SearchResult>,
    question: &str,
    client: &reqwest::Client,
    endpoint: &str,
    model: &str,
    api_key: Option<&str>,
    capability_cache: Option<Arc<CapabilityCache>>,
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
                let truncated = r.ddl_text.char_indices().nth(200).map_or(r.ddl_text.as_str(), |(i, _)| &r.ddl_text[..i]);
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

    let user_prompt = format!(
        "Question: \"{question}\"\nCandidates: {candidates_json}"
    );

    // Try hidden compat call for local endpoints with completions support
    if let Some(ref cache) = capability_cache {
        let ipc_messages = vec![
            crate::ai::types::IpcMessage {
                role: "system".to_string(),
                content: system_prompt.to_string(),
            },
            crate::ai::types::IpcMessage {
                role: "user".to_string(),
                content: user_prompt.clone(),
            },
        ];

        let compat_result = crate::ai::client::run_hidden_compat_call(
            endpoint,
            model,
            &ipc_messages,
            api_key,
            cache,
            RERANK_COMPAT_TIMEOUT_SECS,
            "rerank",
            Some(crate::ai::client::RERANK_PROBE_TIMEOUT_SECS),
        )
        .await;

        match compat_result {
            Ok(text) => {
                let sanitized = crate::ai::local_compat::sanitize_thinking_content(&text);
                let ranked_ids = parse_rerank_text(&sanitized);
                match ranked_ids {
                    Some(ids) if !ids.is_empty() => {
                        tracing::info!(endpoint = %endpoint, "rerank: compat completions succeeded");
                        return reorder_by_ids(candidates, &ids);
                    }
                    _ => {
                        tracing::warn!(
                            endpoint = %endpoint,
                            text_preview = %text.chars().take(200).collect::<String>(),
                            "rerank: compat completions returned unparseable response, falling back to original order"
                        );
                        return candidates;
                    }
                }
            }
            Err(ref reason) if reason == "not_eligible" => {
                // Non-local endpoint — fall through to chat completions path
            }
            Err(reason) => {
                tracing::warn!(endpoint = %endpoint, reason = %reason, "rerank compat failed, falling back to original order");
                return candidates;
            }
        }
    }

    // Existing chat completions path
    let mut request_body_obj = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.0,
        "max_tokens": 512
    })
    .as_object()
    .cloned()
    .unwrap_or_default();
    crate::ai::client::apply_reasoning_off_compatibility(&mut request_body_obj);
    let request_body = serde_json::Value::Object(request_body_obj);

    let url = format!(
        "{}/chat/completions",
        endpoint.trim_end_matches('/')
    );

    // 6 second timeout
    let mut request = client.post(&url).json(&request_body);
    if let Some(key) = api_key {
        request = request.bearer_auth(key);
    }
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(6),
        request.send(),
    )
    .await;

    let response = match result {
        Ok(Ok(resp)) => resp,
        Ok(Err(e)) => {
            tracing::warn!(error = %e, "rerank_with_llm: HTTP request failed, falling back to original order");
            return candidates;
        }
        Err(_) => {
            tracing::warn!("rerank_with_llm: request timed out (6s), falling back to original order");
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
    let ranked_ids = parse_rerank_response(&body);

    match ranked_ids {
        Some(ids) if !ids.is_empty() => {
            reorder_by_ids(candidates, &ids)
        }
        _ => {
            tracing::warn!(
                body_preview = %body.chars().take(200).collect::<String>(),
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

    parse_rerank_text(&content)
}

/// Parse raw text (from either chat or completions response) to extract ranked chunk IDs.
pub fn parse_rerank_text(content: &str) -> Option<Vec<i64>> {
    // First try direct parse, then look for JSON in the text
    if let Ok(output) = serde_json::from_str::<RerankOutput>(content) {
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
