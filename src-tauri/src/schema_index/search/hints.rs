use rusqlite::{Connection, Result};
use std::collections::HashMap;

use super::{
    multi_query_search_configured, RetrievalHints, SearchConfigExt, SearchQueries, SearchResult,
    TableHint,
};

const EDITOR_TABLE_HINT_WEIGHT: f64 = 0.5;

type HintKey = (String, String);

fn hint_key(db_name: &str, table_name: &str) -> HintKey {
    (
        db_name.to_ascii_lowercase(),
        table_name.to_ascii_lowercase(),
    )
}

fn raise_hint_weight(hint_weights: &mut HashMap<HintKey, f64>, hint: &TableHint) {
    let weight = hint_weights
        .entry(hint_key(&hint.db_name, &hint.table_name))
        .or_insert(0.0);
    *weight = weight.max(hint.weight);
}

fn collect_hint_weights(hints: &RetrievalHints) -> HashMap<HintKey, f64> {
    let mut hint_weights: HashMap<HintKey, f64> = HashMap::new();
    for hint in hints.recent_tables.iter().chain(&hints.accepted_tables) {
        raise_hint_weight(&mut hint_weights, hint);
    }
    for table in &hints.editor_tables {
        hint_weights
            .entry(hint_key(&table.db_name, &table.table_name))
            .or_insert(EDITOR_TABLE_HINT_WEIGHT);
    }
    hint_weights
}

fn apply_feedback_boost(
    results: &mut [SearchResult],
    hint_weights: &HashMap<HintKey, f64>,
    feedback_boost: f64,
) {
    for result in results.iter_mut() {
        let key = hint_key(&result.db_name, &result.table_name);
        if let Some(&hint_weight) = hint_weights.get(&key) {
            result.score += feedback_boost * hint_weight;
        }
    }
    results.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}

pub fn multi_query_search_with_hints(
    conn: &Connection,
    queries: &SearchQueries<'_>,
    config: &SearchConfigExt,
) -> Result<Vec<SearchResult>> {
    let mut results = multi_query_search_configured(conn, queries, &config.base)?;
    if results.is_empty() {
        return Ok(results);
    }

    let hint_weights = collect_hint_weights(&config.hints);
    let should_apply_feedback_boost = !hint_weights.is_empty() && config.feedback_boost > 0.0;
    if should_apply_feedback_boost {
        apply_feedback_boost(&mut results, &hint_weights, config.feedback_boost);
    }
    Ok(results)
}
