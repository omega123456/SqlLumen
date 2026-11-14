use super::*;

#[cfg(not(coverage))]
pub(super) struct RetrievalSettings {
    top_k: usize,
    top_n: usize,
    foreign_key_fanout_cap: usize,
    lexical_weight: f64,
    rerank_enabled: bool,
    graph_depth: u32,
    feedback_boost: f64,
}

#[cfg(not(coverage))]
pub(super) const DEFAULT_TOP_K_PER_QUERY: usize = 30;
#[cfg(not(coverage))]
pub(super) const DEFAULT_TOP_N_RESULTS: usize = 20;
#[cfg(not(coverage))]
pub(super) const DEFAULT_FOREIGN_KEY_FANOUT_CAP: usize = 30;
#[cfg(not(coverage))]
pub(super) const DEFAULT_LEXICAL_WEIGHT: f64 = 0.2;
#[cfg(not(coverage))]
pub(super) const DEFAULT_GRAPH_DEPTH: u32 = 2;
#[cfg(not(coverage))]
pub(super) const MIN_GRAPH_DEPTH: u32 = 1;
#[cfg(not(coverage))]
pub(super) const MAX_GRAPH_DEPTH: u32 = 3;
#[cfg(not(coverage))]
pub(super) const DEFAULT_FEEDBACK_BOOST: f64 = 0.15;
#[cfg(not(coverage))]
pub(super) const LOGGED_TOP_RESULT_COUNT: usize = 5;

#[cfg(not(coverage))]
pub(super) fn read_parsed_setting<T: std::str::FromStr>(
    state: &AppState,
    key: &str,
    default: T,
) -> T {
    read_setting(&state.db, key)
        .ok()
        .and_then(|text| text.parse().ok())
        .unwrap_or(default)
}

#[cfg(not(coverage))]
pub(super) fn read_retrieval_settings(state: &AppState) -> RetrievalSettings {
    let rerank_enabled = read_setting(&state.db, "ai.retrieval.rerankEnabled")
        .ok()
        .is_some_and(|text| text == "true");
    let graph_depth: u32 =
        read_parsed_setting(state, "ai.retrieval.graphDepth", DEFAULT_GRAPH_DEPTH);
    RetrievalSettings {
        top_k: read_parsed_setting(state, "ai.retrieval.topKPerQuery", DEFAULT_TOP_K_PER_QUERY),
        top_n: read_parsed_setting(state, "ai.retrieval.topN", DEFAULT_TOP_N_RESULTS),
        foreign_key_fanout_cap: read_parsed_setting(
            state,
            "ai.retrieval.fkFanoutCap",
            DEFAULT_FOREIGN_KEY_FANOUT_CAP,
        ),
        lexical_weight: read_parsed_setting(
            state,
            "ai.retrieval.lexicalWeight",
            DEFAULT_LEXICAL_WEIGHT,
        ),
        rerank_enabled,
        graph_depth: graph_depth.clamp(MIN_GRAPH_DEPTH, MAX_GRAPH_DEPTH),
        feedback_boost: read_parsed_setting(
            state,
            "ai.retrieval.feedbackBoost",
            DEFAULT_FEEDBACK_BOOST,
        ),
    }
}

#[cfg(not(coverage))]
pub(super) struct QueryEmbeddingRequest<'a> {
    profile_id: &'a str,
    queries: &'a [String],
    model: &'a str,
    endpoint: &'a str,
}

#[cfg(not(coverage))]
pub(super) async fn embed_search_queries(
    state: &AppState,
    request: &QueryEmbeddingRequest<'_>,
) -> Result<Vec<Vec<f32>>, String> {
    let QueryEmbeddingRequest {
        profile_id,
        queries,
        model,
        endpoint,
    } = *request;
    tracing::debug!(
        profile_id = %profile_id,
        query_count = queries.len(),
        model = %model,
        "semantic_search: embedding queries"
    );
    let mut query_vectors: Vec<Vec<f32>> = Vec::with_capacity(queries.len());
    let mut uncached_indices: Vec<usize> = Vec::new();
    for (index, query) in queries.iter().enumerate() {
        let cached_vec = state.embedding_cache.get(model, query);
        if cached_vec.is_none() {
            uncached_indices.push(index);
        }
        query_vectors.push(cached_vec.unwrap_or_default());
    }
    if uncached_indices.is_empty() {
        return Ok(query_vectors);
    }

    let uncached_texts = uncached_indices
        .iter()
        .map(|index| queries[*index].clone())
        .collect();
    let embedding_target = embeddings::EmbeddingModel {
        base_url: endpoint,
        model,
    };
    let input = embeddings::EmbeddingInput::texts(uncached_texts);
    let new_embeddings = embeddings::embed_texts(&state.http_client, embedding_target, input)
        .await
        .map_err(|error| format!("Embedding failed: {error}"))?;

    for (uncached_position, index) in uncached_indices.iter().enumerate() {
        query_vectors[*index] = new_embeddings[uncached_position].clone();
        let cache_key = EmbeddingCacheKey::new(model, &queries[*index]);
        state
            .embedding_cache
            .insert(cache_key, new_embeddings[uncached_position].clone());
    }
    Ok(query_vectors)
}

#[cfg(not(coverage))]
pub(super) struct SearchRun<'a> {
    state: &'a AppState,
    profile_id: &'a str,
    queries: &'a [String],
    retrieval: &'a RetrievalSettings,
}

#[cfg(not(coverage))]
impl SearchRun<'_> {
    pub(super) fn base_results(
        &self,
        query_vectors: &[Vec<f32>],
        hints: Option<RetrievalHints>,
    ) -> Result<Vec<SearchResult>, String> {
        let retrieval = self.retrieval;
        let conn = self.state.db.lock().map_err(db_lock_error)?;
        let search_config = SearchConfigExt {
            base: search::SearchConfig {
                top_k_per_query: retrieval.top_k,
                top_n_results: retrieval.top_n,
                max_fk_chunks: retrieval.foreign_key_fanout_cap,
                lexical_weight: retrieval.lexical_weight,
            },
            graph_depth: retrieval.graph_depth,
            feedback_boost: retrieval.feedback_boost,
            hints: hints.unwrap_or_default(),
        };
        tracing::debug!(
            profile_id = %self.profile_id,
            graph_depth = search_config.graph_depth,
            feedback_boost = search_config.feedback_boost,
            "semantic_search: running pipeline (rerank before graph={})",
            retrieval.rerank_enabled
        );
        let search_queries = search::SearchQueries {
            connection_id: self.profile_id,
            query_texts: self.queries,
            query_vectors,
        };
        search::multi_query_search_with_hints(&conn, &search_queries, &search_config)
            .map_err(|error| format!("Search failed: {error}"))
    }

    pub(super) async fn reranked(
        &self,
        results: Vec<SearchResult>,
        chat_endpoint: &str,
    ) -> Vec<SearchResult> {
        let should_rerank = self.retrieval.rerank_enabled && !results.is_empty();
        if !should_rerank {
            return results;
        }
        let chat_model = read_setting(&self.state.db, "ai.model").unwrap_or_default();
        let has_chat_backend = !chat_model.is_empty() && !chat_endpoint.is_empty();
        if !has_chat_backend {
            return results;
        }
        let original_query = self.queries.first().cloned().unwrap_or_default();
        tracing::debug!(
            profile_id = %self.profile_id,
            candidate_count = results.len(),
            "semantic_search: invoking LLM re-rank (before graph expansion)"
        );
        let backend = rerank::RerankBackend {
            endpoint: chat_endpoint,
            model: &chat_model,
        };
        let input = rerank::RerankInput {
            candidates: results,
            question: &original_query,
        };
        rerank::rerank_with_llm(&self.state.http_client, backend, input).await
    }

    pub(super) fn graph_expanded(
        &self,
        results: Vec<SearchResult>,
    ) -> Result<Vec<SearchResult>, String> {
        let graph_depth = self.retrieval.graph_depth;
        let should_expand_graph = graph_depth > 0 && !results.is_empty();
        if !should_expand_graph {
            return Ok(results);
        }
        let conn = self.state.db.lock().map_err(db_lock_error)?;
        let expansion = search::GraphExpansion {
            connection_id: self.profile_id,
            graph_depth,
            max_foreign_key_chunks: self.retrieval.foreign_key_fanout_cap as u32,
        };
        search::apply_graph_expansion(&conn, results, &expansion)
            .map_err(|error| format!("Graph expansion failed: {error}"))
    }
}

#[cfg(not(coverage))]
pub(super) fn top_result_summaries(results: &[SearchResult]) -> Vec<String> {
    results
        .iter()
        .take(LOGGED_TOP_RESULT_COUNT)
        .map(|result| {
            format!(
                "{}.{} ({}, {})",
                result.db_name, result.table_name, result.chunk_type, result.score
            )
        })
        .collect()
}

#[cfg(not(coverage))]
pub(super) struct SearchEndpoints {
    embedding_model: String,
    embedding_endpoint: String,
    chat_endpoint: String,
}

#[cfg(not(coverage))]
pub(super) fn read_search_endpoints(
    state: &AppState,
    profile_id: &str,
) -> Result<SearchEndpoints, String> {
    let embedding_model = read_setting(&state.db, EMBEDDING_MODEL_SETTING)?;
    let embedding_endpoint = read_embedding_endpoint(&state.db)?;
    let chat_endpoint = read_setting(&state.db, "ai.endpoint")?;
    tracing::debug!(
        profile_id = %profile_id,
        embedding_model = %embedding_model,
        embedding_endpoint_set = !embedding_endpoint.is_empty(),
        chat_endpoint_set = !chat_endpoint.is_empty(),
        "semantic_search: resolved embedding configuration"
    );
    Ok(SearchEndpoints {
        embedding_model,
        embedding_endpoint,
        chat_endpoint,
    })
}

#[cfg(not(coverage))]
pub async fn semantic_search_impl(
    state: &AppState,
    request: SemanticSearchRequest,
) -> Result<Vec<SearchResult>, String> {
    let SemanticSearchRequest {
        session_id,
        queries,
        hints,
    } = request;
    let profile_id = resolve_session_profile(state, &session_id)?;

    tracing::debug!(
        session_id = %session_id,
        profile_id = %profile_id,
        query_count = queries.len(),
        queries = ?queries,
        "semantic_search: incoming request"
    );

    let SearchEndpoints {
        embedding_model,
        embedding_endpoint,
        chat_endpoint,
    } = read_search_endpoints(state, &profile_id)?;

    if embedding_model.is_empty() {
        tracing::warn!(profile_id = %profile_id, "semantic_search: aborted — no embedding model configured");
        return Err("No embedding model configured".to_string());
    }

    if queries.is_empty() {
        tracing::debug!(profile_id = %profile_id, "semantic_search: empty query list — returning early");
        return Ok(vec![]);
    }

    let retrieval = read_retrieval_settings(state);
    let embedding_request = QueryEmbeddingRequest {
        profile_id: &profile_id,
        queries: &queries,
        model: &embedding_model,
        endpoint: &embedding_endpoint,
    };
    let query_vectors = embed_search_queries(state, &embedding_request).await?;
    tracing::debug!(
        profile_id = %profile_id,
        vector_count = query_vectors.len(),
        vector_dims = query_vectors.first().map(|vector| vector.len()).unwrap_or(0),
        "semantic_search: embedding complete"
    );

    let run = SearchRun {
        state,
        profile_id: &profile_id,
        queries: &queries,
        retrieval: &retrieval,
    };
    let results = run.base_results(&query_vectors, hints)?;
    let results = run.reranked(results, &chat_endpoint).await;
    let results = run.graph_expanded(results)?;

    tracing::debug!(
        profile_id = %profile_id,
        result_count = results.len(),
        top_results = ?top_result_summaries(&results),
        "semantic_search: complete"
    );

    Ok(results)
}

#[cfg(coverage)]
pub async fn semantic_search_impl(
    state: &AppState,
    request: SemanticSearchRequest,
) -> Result<Vec<SearchResult>, String> {
    let SemanticSearchRequest {
        session_id,
        queries,
        ..
    } = request;
    let _profile_id = resolve_session_profile(state, &session_id)?;

    tracing::debug!(
        session_id = %session_id,
        query_count = queries.len(),
        "semantic_search (coverage stub): incoming request"
    );

    let embedding_model = read_setting(&state.db, EMBEDDING_MODEL_SETTING)?;
    if embedding_model.is_empty() {
        tracing::warn!(session_id = %session_id, "semantic_search (coverage stub): aborted — no embedding model configured");
        return Err("No embedding model configured".to_string());
    }

    if queries.is_empty() {
        tracing::debug!(session_id = %session_id, "semantic_search (coverage stub): empty query list — returning early");
        return Ok(vec![]);
    }

    tracing::debug!(session_id = %session_id, "semantic_search (coverage stub): returning stub error");
    Err("Coverage stub: semantic search not available".to_string())
}
