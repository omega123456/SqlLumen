//! Optional cross-encoder re-ranking via LLM.
//!
//! When `ai.retrieval.rerankEnabled` is true, the top-N search candidates are
//! sent to the configured LLM endpoint with a ranking prompt. The LLM returns
//! a JSON object `{"ranked": [chunkId, ...]}` that reorders the candidates.
//!
//! On any failure (timeout, malformed JSON, missing IDs), the original order is
//! preserved silently.

use super::search::SearchResult;
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

    let request_body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.0,
        "max_tokens": 512
    });

    let url = format!(
        "{}/chat/completions",
        endpoint.trim_end_matches('/')
    );

    // 6 second timeout
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(6),
        client.post(&url).json(&request_body).send(),
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
