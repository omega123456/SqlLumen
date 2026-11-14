use rusqlite::{params, Connection, Result};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

const DIRECT_TABLE_MATCH_SCORE: f64 = 1.0;
const IDENTIFIER_EXACT_MATCH_SCORE: f64 = 0.8;
const DIRECT_TABLE_SEGMENT_MATCH_SCORE: f64 = 0.5;
const IDENTIFIER_SEGMENT_MATCH_SCORE: f64 = 0.4;
const PLURAL_MATCH_QUALITY: f64 = 0.95;
const SEGMENT_PLURAL_MATCH_QUALITY: f64 = 0.9;
const TABLE_PREFIX_BASE_QUALITY: f64 = 0.6;
const SEGMENT_PREFIX_BASE_QUALITY: f64 = 0.5;
const PREFIX_COVERAGE_QUALITY_RANGE: f64 = 0.3;
const MIN_PREFIX_MATCH_CHARS: usize = 3;
const MIN_PLURAL_WORD_CHARS: usize = 4;
const MAX_RAW_IDF: f64 = 5.0;
const FULL_WEIGHT_TOKEN_CHARS: f64 = 4.0;
const MIN_IDENTIFIER_TOKEN_CHARS: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) struct QualifiedIdentifier {
    pub(super) db_name: Option<String>,
    pub(super) table_name: String,
}

impl QualifiedIdentifier {
    fn has_table_name(&self) -> bool {
        !self.table_name.is_empty()
    }
}

const SQL_STOPWORDS: &[&str] = &[
    "select",
    "from",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "full",
    "cross",
    "on",
    "where",
    "and",
    "or",
    "not",
    "as",
    "into",
    "update",
    "delete",
    "insert",
    "table",
    "references",
    "group",
    "order",
    "by",
    "limit",
    "offset",
    "having",
    "union",
    "all",
    "distinct",
    "with",
    "case",
    "when",
    "then",
    "else",
    "end",
    "null",
    "true",
    "false",
    "like",
    "in",
    "exists",
    "between",
    "is",
    "create",
    "alter",
    "drop",
    "primary",
    "foreign",
    "key",
    "constraint",
    "values",
    "set",
    "call",
    "show",
    "describe",
    "explain",
    "asc",
    "desc",
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "id",
    "list",
    "me",
    "get",
    "find",
    "which",
    "how",
    "many",
    "much",
    "total",
    "last",
    "first",
    "recent",
    "old",
    "new",
    "please",
    "want",
    "need",
    "give",
    "tell",
    "what",
    "why",
    "when",
    "where",
    "who",
];

#[derive(Clone, Copy)]
pub(super) struct LexicalSignals<'a> {
    pub(super) direct_table_candidates: &'a HashSet<QualifiedIdentifier>,
    pub(super) identifier_tokens: &'a HashSet<String>,
    pub(super) segment_df: &'a HashMap<String, usize>,
    pub(super) total_tables: usize,
}

struct NormalizedTableName<'a> {
    db_name: &'a str,
    table_name: &'a str,
}

pub(super) fn load_segment_df(conn: &Connection, connection_id: &str) -> HashMap<String, usize> {
    super::super::storage::get_segment_df_for_connection(conn, connection_id).unwrap_or_default()
}

fn direct_table_regex() -> &'static regex::Regex {
    static TABLE_REGEX: OnceLock<regex::Regex> = OnceLock::new();
    TABLE_REGEX.get_or_init(|| {
        regex::Regex::new(
            r"(?i)\b(?:from|join|into|update|table|references)\s+((?:`[^`]+`|[a-z_][a-z0-9_]*)(?:\.(?:`[^`]+`|[a-z_][a-z0-9_]*))?)",
        )
        .expect("valid direct table regex")
    })
}

fn keyword_table_candidates(query_text: &str) -> impl Iterator<Item = QualifiedIdentifier> + '_ {
    direct_table_regex()
        .captures_iter(query_text)
        .filter_map(|capture| capture.get(1))
        .map(|identifier| parse_qualified_identifier(identifier.as_str()))
}

fn dotted_token_candidates(query_text: &str) -> impl Iterator<Item = QualifiedIdentifier> + '_ {
    query_text
        .split_whitespace()
        .filter(|token| token.contains('.'))
        .map(|token| parse_qualified_identifier(token.trim_matches(is_surrounding_punctuation)))
}

pub(super) fn extract_direct_table_candidates(
    query_texts: &[String],
) -> HashSet<QualifiedIdentifier> {
    query_texts
        .iter()
        .flat_map(|query_text| {
            keyword_table_candidates(query_text).chain(dotted_token_candidates(query_text))
        })
        .filter(QualifiedIdentifier::has_table_name)
        .collect()
}

fn is_noise_token(token: &str) -> bool {
    token.len() < MIN_IDENTIFIER_TOKEN_CHARS || SQL_STOPWORDS.contains(&token)
}

pub(super) fn extract_identifier_tokens(query_texts: &[String]) -> HashSet<String> {
    static IDENTIFIER_REGEX: OnceLock<regex::Regex> = OnceLock::new();
    let regex = IDENTIFIER_REGEX.get_or_init(|| {
        regex::Regex::new(r"(?i)\b[a-z_][a-z0-9_]*\b").expect("valid identifier regex")
    });

    query_texts
        .iter()
        .flat_map(|query_text| regex.find_iter(query_text))
        .map(|matched| matched.as_str().to_ascii_lowercase())
        .filter(|token| !is_noise_token(token))
        .collect()
}

fn is_surrounding_punctuation(character: char) -> bool {
    character.is_ascii_punctuation() && character != '.' && character != '`'
}

fn parse_qualified_identifier(identifier: &str) -> QualifiedIdentifier {
    let parts: Vec<String> = identifier
        .split('.')
        .map(|part| part.trim_matches('`').trim().to_ascii_lowercase())
        .filter(|part| !part.is_empty())
        .collect();

    match parts.as_slice() {
        [table_name] => QualifiedIdentifier {
            db_name: None,
            table_name: table_name.clone(),
        },
        [db_name, table_name] => QualifiedIdentifier {
            db_name: Some(db_name.clone()),
            table_name: table_name.clone(),
        },
        _ => QualifiedIdentifier {
            db_name: None,
            table_name: String::new(),
        },
    }
}

pub(super) fn collect_lexical_table_matches(
    conn: &Connection,
    connection_id: &str,
    signals: &LexicalSignals<'_>,
) -> Result<HashMap<i64, f64>> {
    let mut stmt = conn.prepare(
        "SELECT id, db_name, table_name
         FROM schema_index_chunks
         WHERE connection_id = ?1 AND chunk_type = 'table'",
    )?;

    let rows = stmt.query_map(params![connection_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let mut matches = HashMap::new();
    for row_result in rows {
        let (chunk_id, db_name, table_name) = row_result?;
        let normalized_db_name = db_name.to_ascii_lowercase();
        let normalized_table_name = table_name.to_ascii_lowercase();

        let table = NormalizedTableName {
            db_name: &normalized_db_name,
            table_name: &normalized_table_name,
        };
        let lexical_score = lexical_score_for_table(&table, signals);

        if lexical_score > 0.0 {
            matches.insert(chunk_id, lexical_score);
        }
    }

    Ok(matches)
}

fn table_name_segment_matches(table_name: &str, token: &str) -> bool {
    table_name.split('_').any(|segment| segment == token)
}

fn fuzzy_name_match(table_name: &str, token: &str) -> f64 {
    if table_name == token {
        return 1.0;
    }
    if is_same_word_ignoring_plural(table_name, token) {
        return PLURAL_MATCH_QUALITY;
    }
    let is_table_name_prefix =
        token.len() >= MIN_PREFIX_MATCH_CHARS && table_name.starts_with(token);
    if is_table_name_prefix {
        let coverage = token.len() as f64 / table_name.len() as f64;
        return TABLE_PREFIX_BASE_QUALITY + PREFIX_COVERAGE_QUALITY_RANGE * coverage;
    }
    for segment in table_name.split('_') {
        if segment == token {
            return 1.0;
        }
        if is_same_word_ignoring_plural(segment, token) {
            return SEGMENT_PLURAL_MATCH_QUALITY;
        }
        let is_segment_prefix = token.len() >= MIN_PREFIX_MATCH_CHARS && segment.starts_with(token);
        if is_segment_prefix {
            let coverage = token.len() as f64 / segment.len() as f64;
            return SEGMENT_PREFIX_BASE_QUALITY + PREFIX_COVERAGE_QUALITY_RANGE * coverage;
        }
    }
    0.0
}

fn is_same_word_ignoring_plural(word: &str, other_word: &str) -> bool {
    normalize_plural(word) == normalize_plural(other_word)
}

fn normalize_plural(word: &str) -> &str {
    let is_plural = word.len() >= MIN_PLURAL_WORD_CHARS && word.ends_with('s');
    if !is_plural {
        return word;
    }
    &word[..word.len() - 1]
}

fn idf_weight(segment: &str, segment_df: &HashMap<String, usize>, total_tables: usize) -> f64 {
    let df = segment_df.get(segment).copied().unwrap_or(1).max(1);
    let raw_idf = (total_tables as f64 / df as f64).ln();
    raw_idf.clamp(0.0, MAX_RAW_IDF) / MAX_RAW_IDF
}

fn segment_idf(segment: &str, segment_df: &HashMap<String, usize>, total_tables: usize) -> f64 {
    if segment_df.is_empty() {
        return 1.0;
    }
    idf_weight(segment, segment_df, total_tables)
}

fn token_length_factor(token: &str) -> f64 {
    (token.len() as f64 / FULL_WEIGHT_TOKEN_CHARS).min(1.0)
}

fn direct_match_score(
    table: &NormalizedTableName<'_>,
    signals: &LexicalSignals<'_>,
) -> Option<f64> {
    let candidates = signals.direct_table_candidates;
    let qualified = QualifiedIdentifier {
        db_name: Some(table.db_name.to_string()),
        table_name: table.table_name.to_string(),
    };
    if candidates.contains(&qualified) {
        return Some(DIRECT_TABLE_MATCH_SCORE);
    }
    let unqualified = QualifiedIdentifier {
        db_name: None,
        table_name: table.table_name.to_string(),
    };
    let names_table_exactly =
        candidates.contains(&unqualified) || signals.identifier_tokens.contains(table.table_name);
    names_table_exactly.then_some(IDENTIFIER_EXACT_MATCH_SCORE)
}

#[derive(Clone, Copy)]
struct ScoredTerm<'a> {
    text: &'a str,
    base_score: f64,
}

fn fuzzy_term_score(table_name: &str, term: ScoredTerm<'_>, signals: &LexicalSignals<'_>) -> f64 {
    let quality = fuzzy_name_match(table_name, term.text);
    if quality <= 0.0 {
        return 0.0;
    }
    let idf = segment_idf(term.text, signals.segment_df, signals.total_tables);
    let len_factor = token_length_factor(term.text);
    term.base_score * quality * idf * len_factor
}

fn segment_term_score(term: ScoredTerm<'_>, signals: &LexicalSignals<'_>) -> f64 {
    let idf = segment_idf(term.text, signals.segment_df, signals.total_tables);
    let len_factor = token_length_factor(term.text);
    term.base_score * idf * len_factor
}

fn identifier_terms<'a>(signals: &LexicalSignals<'a>) -> impl Iterator<Item = ScoredTerm<'a>> {
    signals.identifier_tokens.iter().map(|token| ScoredTerm {
        text: token,
        base_score: IDENTIFIER_EXACT_MATCH_SCORE,
    })
}

fn direct_candidate_terms<'a>(
    signals: &LexicalSignals<'a>,
) -> impl Iterator<Item = ScoredTerm<'a>> {
    signals
        .direct_table_candidates
        .iter()
        .map(|candidate| ScoredTerm {
            text: &candidate.table_name,
            base_score: DIRECT_TABLE_SEGMENT_MATCH_SCORE,
        })
}

fn best_fuzzy_score(table_name: &str, signals: &LexicalSignals<'_>) -> f64 {
    identifier_terms(signals)
        .chain(direct_candidate_terms(signals))
        .map(|term| fuzzy_term_score(table_name, term, signals))
        .fold(0.0f64, f64::max)
}

fn segment_fallback_score(table_name: &str, signals: &LexicalSignals<'_>) -> f64 {
    let identifier_segment_terms = signals.identifier_tokens.iter().map(|token| ScoredTerm {
        text: token,
        base_score: IDENTIFIER_SEGMENT_MATCH_SCORE,
    });
    direct_candidate_terms(signals)
        .chain(identifier_segment_terms)
        .find(|term| table_name_segment_matches(table_name, term.text))
        .map(|term| segment_term_score(term, signals))
        .unwrap_or(0.0)
}

fn lexical_score_for_table(table: &NormalizedTableName<'_>, signals: &LexicalSignals<'_>) -> f64 {
    if let Some(score) = direct_match_score(table, signals) {
        return score;
    }
    let fuzzy_score = best_fuzzy_score(table.table_name, signals);
    if fuzzy_score != 0.0 {
        return fuzzy_score;
    }
    segment_fallback_score(table.table_name, signals)
}
