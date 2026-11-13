//! Index build orchestration — generates DDL chunks, computes hashes,
//! performs incremental embedding, and stores results.
//!
//! The public functions take explicit dependencies (SQLite mutex, MySQL pool,
//! HTTP client) so they are testable without the Tauri runtime.

use regex::Regex;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::OnceLock;

#[cfg(not(coverage))]
use chrono::Utc;
#[cfg(not(coverage))]
use std::sync::Mutex;
#[cfg(not(coverage))]
use std::time::Instant;
#[cfg(not(coverage))]
use tokio_util::sync::CancellationToken;

#[cfg(not(coverage))]
use super::embeddings;
#[cfg(not(coverage))]
use super::storage;
#[cfg(not(coverage))]
use super::types::{
    BuildConfig, BuildPhase, BuildProgress, BuildResult, ChunkEmbeddingUpdate, ChunkInsert,
    ChunkType, IndexMeta, IndexStatus, ProgressCallback,
};
use super::types::{FkEdge, FkInput, TableDdlInput};

/// Maximum number of texts per embedding batch.
#[cfg(not(coverage))]
const EMBED_BATCH_SIZE: usize = 32;

/// Number of chunks to commit in a single SQLite transaction.
#[cfg(not(coverage))]
const SQLITE_COMMIT_BATCH: usize = 20;

// ── Pure helper functions ────────────────────────────────────────────────

/// Strip MySQL engine/storage metadata from a CREATE TABLE statement so that
/// the resulting text captures only the schema structure (columns, indexes, FKs).
///
/// Removes: `AUTO_INCREMENT=\d+`, `ROW_FORMAT=...`, `ENGINE=...`, trailing
/// `DEFAULT CHARSET=...`, `COLLATE=...`, and `COMMENT='...'` clauses that
/// appear after the closing `)` of the column list.
pub fn compact_ddl(create_table_sql: &str) -> String {
    static AUTO_INCREMENT_REGEX: OnceLock<Regex> = OnceLock::new();
    static TRAILING_CLAUSE_REGEX: OnceLock<Regex> = OnceLock::new();
    static WHITESPACE_REGEX: OnceLock<Regex> = OnceLock::new();

    // Remove AUTO_INCREMENT=<digits> (case-insensitive)
    let re_auto_inc = AUTO_INCREMENT_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\s*AUTO_INCREMENT\s*=\s*\d+").expect("valid auto_increment regex")
    });
    let text = re_auto_inc.replace_all(create_table_sql, "");

    // Remove trailing engine/storage clauses after the last `)`
    // These are: ENGINE=..., ROW_FORMAT=..., DEFAULT CHARSET=..., COLLATE=..., COMMENT='...'
    let re_trailing = TRAILING_CLAUSE_REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)\)\s*(ENGINE\s*=\s*\S+|ROW_FORMAT\s*=\s*\S+|DEFAULT\s+CHARSET\s*=\s*\S+|COLLATE\s*=\s*\S+|COMMENT\s*=\s*'[^']*'|/\*![^*]*\*/|\s)*\s*;?\s*$",
        )
        .expect("valid trailing clause regex")
    });

    let text = strip_trailing_table_options(&text, re_trailing);

    // Normalize whitespace
    let re_ws =
        WHITESPACE_REGEX.get_or_init(|| Regex::new(r"\s+").expect("valid whitespace regex"));
    let text = re_ws.replace_all(&text, " ");

    text.trim().to_string()
}

fn strip_trailing_table_options(text: &str, trailing_clause_regex: &Regex) -> String {
    let Some(trailing_match) = trailing_clause_regex.find(text) else {
        return text.to_string();
    };
    match text[..trailing_match.start() + 1].rfind(')') {
        Some(paren_position) => format!("{})", &text[..paren_position]),
        None => text.to_string(),
    }
}

#[cfg(not(coverage))]
fn routine_chunk_type(routine_type: &str) -> ChunkType {
    if routine_type == "PROCEDURE" {
        return ChunkType::Procedure;
    }
    ChunkType::Function
}

#[cfg(not(coverage))]
fn show_create_routine_keyword(routine_type: &str) -> &'static str {
    let is_procedure = routine_type.to_uppercase() == "PROCEDURE";
    if is_procedure {
        return "PROCEDURE";
    }
    "FUNCTION"
}

/// Strip MySQL engine/storage metadata from DDL but **keep** `COMMENT '...'`
/// annotations (both table-level and column-level). This variant is used to
/// produce the text sent to the embedding model, where comments carry useful
/// semantic information.
///
/// Removes: `ENGINE=...`, `ROW_FORMAT=...`, `DEFAULT CHARSET=...`,
/// `COLLATE=...`, `AUTO_INCREMENT=\d+` — but preserves `COMMENT` clauses.
pub fn compact_ddl_for_llm(create_table_sql: &str) -> String {
    static AUTO_INCREMENT_REGEX: OnceLock<Regex> = OnceLock::new();
    static ENGINE_REGEX: OnceLock<Regex> = OnceLock::new();
    static ROW_FORMAT_REGEX: OnceLock<Regex> = OnceLock::new();
    static CHARSET_REGEX: OnceLock<Regex> = OnceLock::new();
    static COLLATE_REGEX: OnceLock<Regex> = OnceLock::new();
    static WHITESPACE_REGEX2: OnceLock<Regex> = OnceLock::new();
    static ROW_COUNT_COMMENT_REGEX: OnceLock<Regex> = OnceLock::new();

    // Strip any previously appended row-count annotation so hashing is stable on round-trip
    let re_row_count = ROW_COUNT_COMMENT_REGEX.get_or_init(|| {
        Regex::new(r"(?m)\n?--\s*approximate rows:\s*\d+\s*$").expect("valid regex")
    });
    let text = re_row_count.replace_all(create_table_sql, "");

    let re_auto_inc = AUTO_INCREMENT_REGEX
        .get_or_init(|| Regex::new(r"(?i)\s*AUTO_INCREMENT\s*=\s*\d+").expect("valid regex"));
    let text = re_auto_inc.replace_all(&text, "");

    let re_engine =
        ENGINE_REGEX.get_or_init(|| Regex::new(r"(?i)\bENGINE\s*=\s*\S+").expect("valid regex"));
    let text = re_engine.replace_all(&text, "");

    let re_row_format = ROW_FORMAT_REGEX
        .get_or_init(|| Regex::new(r"(?i)\bROW_FORMAT\s*=\s*\S+").expect("valid regex"));
    let text = re_row_format.replace_all(&text, "");

    let re_charset = CHARSET_REGEX
        .get_or_init(|| Regex::new(r"(?i)\bDEFAULT\s+CHARSET\s*=\s*\S+").expect("valid regex"));
    let text = re_charset.replace_all(&text, "");

    let re_collate =
        COLLATE_REGEX.get_or_init(|| Regex::new(r"(?i)\bCOLLATE\s*=\s*\S+").expect("valid regex"));
    let text = re_collate.replace_all(&text, "");

    let re_ws = WHITESPACE_REGEX2.get_or_init(|| Regex::new(r"\s+").expect("valid regex"));
    let text = re_ws.replace_all(&text, " ");

    text.trim().to_string()
}

/// Extract the table-level `COMMENT='...'` value from a `CREATE TABLE` DDL.
pub fn extract_table_comment(ddl: &str) -> Option<String> {
    static TABLE_COMMENT_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = TABLE_COMMENT_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\)\s*[^;]*COMMENT\s*=\s*'((?:[^'\\]|\\.)*)'")
            .expect("valid table comment regex")
    });
    re.captures(ddl).map(|captures| captures[1].to_string())
}

/// Extract `(column_name, comment)` pairs from inline column `COMMENT '...'`
/// clauses in a `CREATE TABLE` DDL.
pub fn extract_column_comments(ddl: &str) -> Vec<(String, String)> {
    static COL_COMMENT_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = COL_COMMENT_REGEX.get_or_init(|| {
        Regex::new(r"(?i)`([^`]+)`\s+\S+[^,\n]*COMMENT\s+'((?:[^'\\]|\\.)*)'")
            .expect("valid column comment regex")
    });
    re.captures_iter(ddl)
        .map(|captures| (captures[1].to_string(), captures[2].to_string()))
        .collect()
}

/// Build the rich prose description of a table for the embedding model.
///
/// The output is a human-readable paragraph that captures table identity,
/// column names/types/comments, primary key, unique indexes, foreign keys,
/// and approximate row count.
pub struct TableEmbeddingDescription<'a> {
    pub db_name: &'a str,
    pub table_name: &'a str,
    pub table_comment: Option<&'a str>,
    pub columns: &'a [(String, String, Option<String>)],
    pub primary_key_columns: &'a [String],
    pub unique_indexes: &'a [String],
    pub foreign_keys: &'a [FkEdge],
    pub row_count: Option<i64>,
}

pub fn generate_text_for_embedding(description: &TableEmbeddingDescription<'_>) -> String {
    let db = description.db_name;
    let tbl = description.table_name;
    let table_comment = description.table_comment;
    let cols = description.columns;
    let primary_key_columns = description.primary_key_columns;
    let unique_index = description.unique_indexes;
    let foreign_keys = description.foreign_keys;
    let row_count = description.row_count;
    let mut parts = Vec::new();

    // Table identity
    let default_comment = format!("stores {tbl} data");
    let comment_desc = table_comment
        .filter(|comment| !comment.is_empty())
        .unwrap_or(&default_comment);
    parts.push(format!("Table `{db}`.`{tbl}` — {comment_desc}."));

    // Columns
    if !cols.is_empty() {
        let col_descs: Vec<String> = cols
            .iter()
            .map(|(name, typ, comment)| match comment {
                Some(comment_text) => format!("{name} ({typ}, \"{comment_text}\")"),
                None => format!("{name} ({typ})"),
            })
            .collect();
        parts.push(format!("Columns: {}.", col_descs.join(", ")));
    }

    // Primary key
    if !primary_key_columns.is_empty() {
        parts.push(format!("Primary key: {}.", primary_key_columns.join(", ")));
    }

    // Unique indexes
    if !unique_index.is_empty() {
        parts.push(format!("Unique indexes: {}.", unique_index.join(", ")));
    }

    // Foreign keys
    if !foreign_keys.is_empty() {
        parts.push("Foreign keys:".to_string());
        for foreign_key in foreign_keys {
            let mut desc = format!(
                "  - {} references `{}`.`{}`({})",
                foreign_key.src_col, foreign_key.dst_db, foreign_key.dst_tbl, foreign_key.dst_col
            );
            if let Some(ref on_del) = foreign_key.on_delete {
                if on_del != "RESTRICT" {
                    desc.push_str(&format!(" [ON DELETE {on_del}]"));
                }
            }
            parts.push(desc);
        }
    }

    // Row count
    if let Some(count) = row_count {
        parts.push(format!("Approximate rows: {count}."));
    }

    parts.join("\n")
}

fn quote_identifier(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

fn parse_identifier_parts(identifier: &str) -> Vec<String> {
    identifier
        .split('.')
        .map(|part| part.trim_matches('`').trim().to_string())
        .filter(|part| !part.is_empty())
        .collect()
}

/// Ensure the leading `CREATE TABLE ...` identifier is fully qualified with the
/// source database name so semantic search and downstream prompt assembly retain
/// unambiguous table identity across databases.
pub fn qualify_table_ddl(db_name: &str, table_name: &str, ddl: &str) -> String {
    static CREATE_TABLE_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = CREATE_TABLE_REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)^\s*(CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+((?:`[^`]+`|[a-z_][a-z0-9_$]*)(?:\.(?:`[^`]+`|[a-z_][a-z0-9_$]*))?)",
        )
        .expect("valid create table qualification regex")
    });

    let quoted_db = quote_identifier(db_name);
    let quoted_table = quote_identifier(table_name);

    re.replace(ddl, format!("$1 {quoted_db}.{quoted_table}"))
        .into_owned()
}

/// Ensure REFERENCES clauses also use database-qualified table names.
pub fn qualify_references_in_ddl(db_name: &str, ddl: &str) -> String {
    static REFERENCES_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = REFERENCES_REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)\bREFERENCES\s+((?:`[^`]+`|[a-z_][a-z0-9_$]*)(?:\.(?:`[^`]+`|[a-z_][a-z0-9_$]*))?)\s*\(",
        )
        .expect("valid references qualification regex")
    });

    re.replace_all(ddl, |captures: &regex::Captures<'_>| {
        let identifier = captures
            .get(1)
            .map(|matched| matched.as_str())
            .unwrap_or_default();
        let parts = parse_identifier_parts(identifier);
        let qualified = match parts.as_slice() {
            [table_name] => format!(
                "{}.{}",
                quote_identifier(db_name),
                quote_identifier(table_name)
            ),
            [ref_db_name, table_name] => {
                format!(
                    "{}.{}",
                    quote_identifier(ref_db_name),
                    quote_identifier(table_name)
                )
            }
            _ => identifier.to_string(),
        };

        format!("REFERENCES {qualified} (")
    })
    .into_owned()
}

/// Normalize table DDL so both the declared table and its REFERENCES targets are
/// database-qualified.
pub fn normalize_table_ddl(db_name: &str, table_name: &str, ddl: &str) -> String {
    let ddl = qualify_table_ddl(db_name, table_name, ddl);
    qualify_references_in_ddl(db_name, &ddl)
}

/// Generate a human-readable chunk text describing a foreign key relationship.
pub fn generate_fk_chunk_text(foreign_key: &FkInput) -> String {
    let cols = foreign_key.columns.join(", ");
    let ref_cols = foreign_key.ref_columns.join(", ");
    format!(
        "Table {db}.{table} has a foreign key ({cols}) that references {ref_db}.{ref_table}({ref_cols}) ON DELETE {on_delete} ON UPDATE {on_update}",
        db = foreign_key.db_name,
        table = foreign_key.table_name,
        ref_db = foreign_key.ref_db_name,
        ref_table = foreign_key.ref_table_name,
        on_delete = foreign_key.on_delete,
        on_update = foreign_key.on_update,
    )
}

/// Compute a SHA-256 hex digest of the given text.
pub fn compute_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

/// Split an identifier into segments by underscore and camelCase boundaries.
/// E.g. "user_order_items" → ["user", "order", "items"]
///      "userOrderItems" → ["user", "order", "items"]
pub fn split_identifier_segments(name: &str) -> Vec<String> {
    let mut segments = Vec::new();
    // First split by underscore
    for part in name.split('_') {
        if part.is_empty() {
            continue;
        }
        // Split camelCase within each underscore segment
        let mut current = String::new();
        for ch in part.chars() {
            let starts_new_segment = ch.is_uppercase() && !current.is_empty();
            if starts_new_segment {
                segments.push(current.to_ascii_lowercase());
                current = String::new();
            }
            current.push(ch);
        }
        if !current.is_empty() {
            segments.push(current.to_ascii_lowercase());
        }
    }
    segments
}

/// Chunk key for a table DDL chunk.
pub fn table_chunk_key(db_name: &str, table_name: &str) -> String {
    format!("table:{db_name}.{table_name}")
}

/// Chunk key for a foreign key chunk.
pub fn fk_chunk_key(db_name: &str, table_name: &str, constraint_name: &str) -> String {
    format!("fk:{db_name}.{table_name}:{constraint_name}")
}

// ── FK parsing from DDL ──────────────────────────────────────────────────

/// Parse foreign key definitions from a `SHOW CREATE TABLE` result.
///
/// Looks for lines matching:
/// ```text
/// CONSTRAINT `fk_name` FOREIGN KEY (`col1`, `col2`) REFERENCES `ref_table` (`ref_col1`, `ref_col2`) ON DELETE CASCADE ON UPDATE NO ACTION
/// ```
pub fn parse_fks_from_ddl(db_name: &str, table_name: &str, ddl: &str) -> Vec<FkInput> {
    static FK_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = FK_REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)CONSTRAINT\s+`([^`]+)`\s+FOREIGN\s+KEY\s+\(([^)]+)\)\s+REFERENCES\s+(?:`([^`]+)`\.)?`([^`]+)`\s+\(([^)]+)\)(?:\s+ON\s+DELETE\s+(RESTRICT|CASCADE|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION))?(?:\s+ON\s+UPDATE\s+(RESTRICT|CASCADE|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION))?",
        )
        .expect("valid FK regex")
    });

    let mut foreign_keys = Vec::new();
    for cap in re.captures_iter(ddl) {
        let constraint_name = cap[1].to_string();
        let columns = parse_backtick_list(&cap[2]);
        let ref_db = cap
            .get(3)
            .map(|matched| matched.as_str().to_string())
            .unwrap_or_else(|| db_name.to_string());
        let ref_table = cap[4].to_string();
        let ref_columns = parse_backtick_list(&cap[5]);
        let on_delete = cap
            .get(6)
            .map(|matched| matched.as_str().to_uppercase())
            .unwrap_or_else(|| "RESTRICT".to_string());
        let on_update = cap
            .get(7)
            .map(|matched| matched.as_str().to_uppercase())
            .unwrap_or_else(|| "RESTRICT".to_string());

        foreign_keys.push(FkInput {
            db_name: db_name.to_string(),
            table_name: table_name.to_string(),
            constraint_name,
            columns,
            ref_db_name: ref_db,
            ref_table_name: ref_table,
            ref_columns,
            on_delete,
            on_update,
        });
    }
    foreign_keys
}

/// Parse a backtick-delimited column list like `` `col1`,`col2` `` into `["col1", "col2"]`.
fn parse_backtick_list(list: &str) -> Vec<String> {
    static BACKTICK_LIST_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = BACKTICK_LIST_REGEX
        .get_or_init(|| Regex::new(r"`([^`]+)`").expect("valid backtick list regex"));
    re.captures_iter(list)
        .map(|captures| captures[1].to_string())
        .collect()
}

// ── Diff logic ───────────────────────────────────────────────────────────

/// Given the stored `(chunk_key, ddl_hash)` pairs and new DDL inputs,
/// determine which chunks are new, changed, or unchanged.
///
/// Returns `(to_embed, to_delete_keys)`:
/// - `to_embed`: `Vec<(chunk_key, ddl_text, ddl_hash, ChunkType, db, table, ref_db, ref_table)>` — new or changed
/// - `to_delete_keys`: `Vec<String>` — chunk keys that existed before but are no longer present
pub fn diff_chunks(
    stored_hashes: &[(String, String)],
    new_chunks: &[(String, String, String)], // (chunk_key, ddl_text, ddl_hash)
) -> (Vec<String>, Vec<String>) {
    let stored_map: HashMap<&str, &str> = stored_hashes
        .iter()
        .map(|(key, hash)| (key.as_str(), hash.as_str()))
        .collect();

    let new_map: HashMap<&str, (&str, &str)> = new_chunks
        .iter()
        .map(|(key, _text, hash)| (key.as_str(), (_text.as_str(), hash.as_str())))
        .collect();

    // Keys that need embedding: new or hash changed
    let mut needs_embed = Vec::new();
    for (key, (_text, hash)) in &new_map {
        match stored_map.get(key) {
            Some(stored_hash) if *stored_hash == *hash => {
                // unchanged — skip
            }
            _ => {
                needs_embed.push(key.to_string());
            }
        }
    }

    // Keys to delete: in stored but not in new
    let mut to_delete = Vec::new();
    for key in stored_map.keys() {
        if !new_map.contains_key(key) {
            to_delete.push(key.to_string());
        }
    }

    (needs_embed, to_delete)
}

// ── Signature short-circuit partition (pure) ────────────────────────────

/// Outcome of the signature-based partition for a single table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignatureDecision {
    /// The stored signature matches and a `table:` chunk already exists;
    /// the caller can reuse the stored DDL text without calling
    /// `SHOW CREATE TABLE`.
    Reuse,
    /// Signature differs, is missing, or the expected chunk is gone — the
    /// caller must fetch fresh DDL via `SHOW CREATE TABLE`.
    Refetch,
}

/// Decide whether a single `(db_name, table_name)` can be short-circuited.
///
/// `current_sig` is the freshly computed signature for this table (or `None`
/// if absent from `current_signatures`, which typically means the table is
/// brand new in this pass). `stored_sig` is the previously persisted
/// signature. `chunk_exists` must be true iff a `table:` chunk for this table
/// is present in the `schema_index_chunks` SQLite store.
///
/// Pure / no I/O — used in both production (inside the build loop) and tests.
const NON_COLUMN_DDL_LINE_KEYWORDS: [&str; 8] = [
    "PRIMARY",
    "KEY",
    "UNIQUE",
    "INDEX",
    "CONSTRAINT",
    "FULLTEXT",
    "SPATIAL",
    "CREATE",
];

fn is_non_column_ddl_line(trimmed_line: &str) -> bool {
    let upper_line = trimmed_line.to_uppercase();
    let starts_with_keyword = NON_COLUMN_DDL_LINE_KEYWORDS
        .iter()
        .any(|keyword| upper_line.starts_with(keyword));
    starts_with_keyword || trimmed_line.starts_with(')')
}

pub fn decide_signature_action(
    current_sig: Option<&str>,
    stored_sig: Option<&str>,
    chunk_exists: bool,
) -> SignatureDecision {
    let has_unchanged_signature = current_sig.is_some() && current_sig == stored_sig;
    if has_unchanged_signature && chunk_exists {
        return SignatureDecision::Reuse;
    }
    SignatureDecision::Refetch
}

// ── Build index (full) ──────────────────────────────────────────────────

#[cfg(not(coverage))]
const FINALIZING_SQLITE_STEPS: usize = 2;

#[cfg(not(coverage))]
struct FinalizingSteps {
    done: usize,
    total: usize,
}

#[cfg(not(coverage))]
struct EmbeddingProgressTracker {
    profile_id: String,
    tables_done: usize,
    tables_total: usize,
    total_embed_batches: usize,
    embed_batches_done: usize,
    finalizing: Option<FinalizingSteps>,
}

#[cfg(not(coverage))]
impl EmbeddingProgressTracker {
    fn start(&mut self) -> BuildProgress {
        if self.tables_done >= self.tables_total {
            self.finalizing = Some(FinalizingSteps {
                done: 0,
                total: self.total_embed_batches + FINALIZING_SQLITE_STEPS,
            });
        }
        self.current_progress()
    }

    fn record_batch(&mut self, table_chunks_in_batch: usize) -> BuildProgress {
        self.tables_done += table_chunks_in_batch;
        self.embed_batches_done += 1;
        if let Some(progress) = self.advance_finalizing() {
            return progress;
        }
        if self.tables_done >= self.tables_total {
            let remaining_batches = self
                .total_embed_batches
                .saturating_sub(self.embed_batches_done);
            self.finalizing = Some(FinalizingSteps {
                done: 0,
                total: remaining_batches + FINALIZING_SQLITE_STEPS,
            });
        }
        self.current_progress()
    }

    fn advance_finalizing(&mut self) -> Option<BuildProgress> {
        let steps = self.finalizing.as_mut()?;
        steps.done = (steps.done + 1).min(steps.total);
        Some(self.current_progress())
    }

    fn current_progress(&self) -> BuildProgress {
        match &self.finalizing {
            Some(steps) => BuildProgress {
                profile_id: self.profile_id.clone(),
                phase: BuildPhase::Finalizing,
                tables_done: steps.done,
                tables_total: steps.total,
            },
            None => BuildProgress {
                profile_id: self.profile_id.clone(),
                phase: BuildPhase::Embedding,
                tables_done: self.tables_done,
                tables_total: self.tables_total,
            },
        }
    }
}

/// Build (or incrementally update) the schema index for a connection.
///
/// Algorithm:
/// 1. Check model change → drop and recreate vec table if needed
/// 2. Set status = "building"
/// 3. Fetch all databases and tables via MySQL
/// 4. For each table: SHOW CREATE TABLE → compact DDL → compute hash
/// 5. Diff against stored hashes
/// 6. Embed new/changed chunks in batches
/// 7. Store results, report progress
/// 8. Set status = "ready"
#[cfg(not(coverage))]
pub async fn build_index(
    config: &BuildConfig,
    sqlite_conn: &Mutex<rusqlite::Connection>,
    mysql_pool: &sqlx::MySqlPool,
    http_client: &reqwest::Client,
    on_progress: Option<&ProgressCallback>,
    cancellation: &CancellationToken,
) -> Result<BuildResult, String> {
    let start = Instant::now();
    let started_at = Utc::now().to_rfc3339();

    tracing::info!(
        profile_id = %config.connection_id,
        model_id = %config.model_id,
        started_at = %started_at,
        "schema_index build_index: started (full / incremental)"
    );

    // 1. Check model change and handle vec table recreation
    tracing::debug!(
        profile_id = %config.connection_id,
        "schema_index build_index: checking model / vec0 schema (handle_model_change)"
    );
    handle_model_change(config, sqlite_conn, http_client).await?;
    tracing::debug!(
        profile_id = %config.connection_id,
        "schema_index build_index: model and vector storage ready"
    );

    // 2. Set status = "building"
    {
        let conn = sqlite_conn
            .lock()
            .map_err(|error| format!("SQLite lock: {error}"))?;
        storage::update_index_status(&conn, &config.connection_id, &IndexStatus::Building)
            .map_err(|error| format!("Failed to set building status: {error}"))?;
    }
    tracing::debug!(
        profile_id = %config.connection_id,
        status_at = %Utc::now().to_rfc3339(),
        "schema_index build_index: SQLite index status set to building"
    );

    // 3. Fetch databases and tables
    if cancellation.is_cancelled() {
        tracing::warn!(
            profile_id = %config.connection_id,
            at = %Utc::now().to_rfc3339(),
            "schema_index build_index: cancelled before MySQL enumeration"
        );
        return Err("Build cancelled".to_string());
    }

    // 3a. Enumerate every user (non-system) base table in one round-trip.
    let enum_started = Instant::now();
    let all_tables = fetch_all_user_tables(mysql_pool).await?;
    let tables_total = all_tables.len();
    let distinct_dbs: std::collections::HashSet<&str> =
        all_tables.iter().map(|(db, _)| db.as_str()).collect();
    tracing::info!(
        profile_id = %config.connection_id,
        database_count = distinct_dbs.len(),
        tables_total,
        elapsed_ms = enum_started.elapsed().as_millis() as u64,
        "schema_index build_index: enumerated user databases from MySQL"
    );

    // Emit an initial loading_schema progress event so the UI can immediately
    // leave the "0/0" indeterminate state and show "Reading schema...".
    if let Some(cb) = on_progress {
        cb(BuildProgress {
            profile_id: config.connection_id.clone(),
            phase: BuildPhase::LoadingSchema,
            tables_done: 0,
            tables_total: 0,
        });
    }

    if cancellation.is_cancelled() {
        return Err("Build cancelled".to_string());
    }

    // 3b. Compute current per-table MySQL signatures in three bulk queries.
    let sig_started = Instant::now();
    let current_signatures = fetch_all_table_signatures(mysql_pool).await?;
    tracing::info!(
        profile_id = %config.connection_id,
        signature_count = current_signatures.len(),
        elapsed_ms = sig_started.elapsed().as_millis() as u64,
        "schema_index build_index: bulk-fetched per-table schema signatures"
    );

    if cancellation.is_cancelled() {
        return Err("Build cancelled".to_string());
    }

    // 3c. Load previously stored signatures so unchanged tables can skip DDL fetch.
    let stored_signatures = {
        let conn = sqlite_conn
            .lock()
            .map_err(|error| format!("SQLite lock: {error}"))?;
        storage::get_signatures_for_connection(&conn, &config.connection_id)
            .map_err(|error| format!("Failed to load stored signatures: {error}"))?
    };

    // Partition tables: reuse stored DDL when signature matches AND a `table:`
    // chunk already exists in SQLite; otherwise queue for SHOW CREATE TABLE.
    let mut reused_ddls: Vec<TableDdlInput> = Vec::new();
    let mut to_fetch: Vec<(String, String)> = Vec::new();
    {
        let conn = sqlite_conn
            .lock()
            .map_err(|error| format!("SQLite lock: {error}"))?;
        for (db_name, table_name) in &all_tables {
            let current = current_signatures
                .get(&(db_name.clone(), table_name.clone()))
                .map(|signature| signature.as_str());
            let stored = stored_signatures
                .get(&(db_name.clone(), table_name.clone()))
                .map(|signature| signature.as_str());

            // We only need to check for chunk existence when the signatures
            // match — otherwise the decision is already `Refetch`.
            let chunk_key = table_chunk_key(db_name, table_name);
            let signatures_match = matches!((current, stored), (Some(current_signature), Some(stored_signature)) if current_signature == stored_signature);
            let mut existing_chunk = None;
            if signatures_match {
                existing_chunk =
                    storage::get_chunk_by_key(&conn, &config.connection_id, &chunk_key).map_err(
                        |error| format!("Failed to look up existing chunk {chunk_key}: {error}"),
                    )?;
            }
            let chunk_exists = existing_chunk.is_some();

            match decide_signature_action(current, stored, chunk_exists) {
                SignatureDecision::Reuse => {
                    // Safe to unwrap: chunk_exists implies Some(...).
                    let ddl = existing_chunk.expect("chunk_exists").ddl_text;
                    reused_ddls.push(TableDdlInput {
                        db_name: db_name.clone(),
                        table_name: table_name.clone(),
                        create_table_sql: ddl,
                    });
                }
                SignatureDecision::Refetch => {
                    to_fetch.push((db_name.clone(), table_name.clone()));
                }
            }
        }
    }

    tracing::info!(
        profile_id = %config.connection_id,
        reused_ddls = reused_ddls.len(),
        to_fetch = to_fetch.len(),
        total_tables = tables_total,
        "schema_index build_index: signature short-circuit partitioned tables"
    );

    // Emit an initial progress event so the UI can leave the 0/0 state now.
    if let Some(cb) = on_progress {
        cb(BuildProgress {
            profile_id: config.connection_id.clone(),
            phase: BuildPhase::LoadingSchema,
            tables_done: reused_ddls.len(),
            tables_total,
        });
    }

    // 3d. Parallel SHOW CREATE TABLE for tables that actually changed.
    let mut fetched_ddls = Vec::new();
    if !to_fetch.is_empty() {
        fetched_ddls = fetch_create_tables_parallel(
            mysql_pool,
            to_fetch,
            &config.connection_id,
            cancellation,
            on_progress,
            reused_ddls.len(),
            tables_total,
        )
        .await?;
    }

    let mut all_ddl_inputs: Vec<TableDdlInput> = Vec::with_capacity(tables_total);
    all_ddl_inputs.extend(reused_ddls);
    all_ddl_inputs.extend(fetched_ddls);

    tracing::info!(
        profile_id = %config.connection_id,
        tables_total,
        "schema_index build_index: fetched SHOW CREATE TABLE for all tables"
    );

    // 3e. Fetch approximate row counts for all user tables.
    let row_counts = fetch_row_counts(mysql_pool).await?;
    tracing::debug!(
        profile_id = %config.connection_id,
        row_count_entries = row_counts.len(),
        "schema_index build_index: fetched approximate row counts from information_schema"
    );

    // 3f. Fetch views and routines in parallel with each other.
    let (views_result, routines_result) = tokio::join!(
        fetch_all_user_views(mysql_pool),
        fetch_all_user_routines(mysql_pool),
    );
    let all_views = views_result?;
    let all_routines = routines_result?;
    tracing::info!(
        profile_id = %config.connection_id,
        views = all_views.len(),
        routines = all_routines.len(),
        "schema_index build_index: enumerated views and routines"
    );

    // 4. Generate chunk data (table + FK chunks)
    let (table_chunks, foreign_key_chunks) =
        generate_all_chunks_with_row_counts(&all_ddl_inputs, &row_counts);
    tracing::debug!(
        profile_id = %config.connection_id,
        table_chunk_rows = table_chunks.len(),
        fk_chunk_rows = foreign_key_chunks.len(),
        "schema_index build_index: generated table and FK chunk texts (DDL normalized, hashes computed)"
    );

    // 4a. Store FK edges in the adjacency table
    {
        let all_foreign_key_edges: Vec<FkEdge> = foreign_key_chunks
            .iter()
            .flat_map(|(_, _, _, foreign_key)| {
                foreign_key
                    .columns
                    .iter()
                    .zip(foreign_key.ref_columns.iter())
                    .map(|(src_col, dst_col)| FkEdge {
                        connection_id: config.connection_id.clone(),
                        src_db: foreign_key.db_name.clone(),
                        src_tbl: foreign_key.table_name.clone(),
                        src_col: src_col.clone(),
                        dst_db: foreign_key.ref_db_name.clone(),
                        dst_tbl: foreign_key.ref_table_name.clone(),
                        dst_col: dst_col.clone(),
                        constraint_name: foreign_key.constraint_name.clone(),
                        on_delete: Some(foreign_key.on_delete.clone()),
                        on_update: Some(foreign_key.on_update.clone()),
                    })
            })
            .collect();
        let conn = sqlite_conn
            .lock()
            .map_err(|error| format!("SQLite lock: {error}"))?;
        storage::replace_fk_edges_for_connection(
            &conn,
            &config.connection_id,
            &all_foreign_key_edges,
        )
        .map_err(|error| format!("Failed to store FK edges: {error}"))?;
    }

    // 4b. Compute and store segment document frequency for lexical IDF scoring
    {
        let mut segment_counts: HashMap<String, usize> = HashMap::new();
        for tc in &table_chunks {
            let segments = split_identifier_segments(&tc.table_name);
            let unique_segments: std::collections::HashSet<String> = segments.into_iter().collect();
            for seg in unique_segments {
                *segment_counts.entry(seg).or_insert(0) += 1;
            }
        }
        let entries: Vec<(String, usize)> = segment_counts.into_iter().collect();
        let conn = sqlite_conn
            .lock()
            .map_err(|error| format!("SQLite lock: {error}"))?;
        storage::replace_segment_df_for_connection(&conn, &config.connection_id, &entries)
            .map_err(|error| format!("Failed to store segment DF: {error}"))?;
    }

    // Merge into a single list for diffing
    let mut all_new: Vec<PendingChunk> = Vec::new();
    for tc in &table_chunks {
        all_new.push(PendingChunk {
            chunk_key: tc.chunk_key.clone(),
            ddl_text: tc.ddl_text.clone(),
            ddl_hash: tc.ddl_hash.clone(),
            chunk_type: ChunkType::Table,
            db_name: tc.db_name.clone(),
            table_name: tc.table_name.clone(),
            ref_db_name: None,
            ref_table_name: None,
            text_for_embedding: tc.text_for_embedding.clone(),
            row_count_approx: tc.row_count_approx,
        });
    }
    // NOTE: FK chunks are no longer inserted into schema_index_chunks.
    // FK data lives exclusively in schema_index_fk_edges (already stored above).

    // Add view chunks
    for (db, view_name, create_view_ddl) in &all_views {
        let key = format!("view:{db}.{view_name}");
        let hash = compute_hash(create_view_ddl);
        let truncated = create_view_ddl
            .char_indices()
            .nth(500)
            .map_or(create_view_ddl.as_str(), |(cut, _)| &create_view_ddl[..cut]);
        let text_for_emb = format!("View `{db}`.`{view_name}`: {truncated}");
        all_new.push(PendingChunk {
            chunk_key: key,
            ddl_text: create_view_ddl.clone(),
            ddl_hash: hash,
            chunk_type: ChunkType::View,
            db_name: db.clone(),
            table_name: view_name.clone(),
            ref_db_name: None,
            ref_table_name: None,
            text_for_embedding: Some(text_for_emb),
            row_count_approx: None,
        });
    }

    // Add routine chunks (procedures and functions)
    for (db, routine_name, routine_type, create_ddl) in &all_routines {
        let chunk_type = routine_chunk_type(routine_type);
        let type_lower = chunk_type.as_str();
        let key = format!("{type_lower}:{db}.{routine_name}");
        let hash = compute_hash(create_ddl);
        let truncated = create_ddl
            .char_indices()
            .nth(500)
            .map_or(create_ddl.as_str(), |(cut, _)| &create_ddl[..cut]);
        let text_for_emb = format!("{routine_type} `{db}`.`{routine_name}`: {truncated}");
        all_new.push(PendingChunk {
            chunk_key: key,
            ddl_text: create_ddl.clone(),
            ddl_hash: hash,
            chunk_type,
            db_name: db.clone(),
            table_name: routine_name.clone(),
            ref_db_name: None,
            ref_table_name: None,
            text_for_embedding: Some(text_for_emb),
            row_count_approx: None,
        });
    }

    // 5. Diff against stored hashes
    let stored_hashes = {
        let conn = sqlite_conn
            .lock()
            .map_err(|error| format!("SQLite lock: {error}"))?;
        storage::get_chunk_hashes(&conn, &config.connection_id)
            .map_err(|error| format!("Failed to get chunk hashes: {error}"))?
    };

    let new_for_diff: Vec<(String, String, String)> = all_new
        .iter()
        .map(|chunk| {
            (
                chunk.chunk_key.clone(),
                chunk.ddl_text.clone(),
                chunk.ddl_hash.clone(),
            )
        })
        .collect();

    let (needs_embed_keys, to_delete_keys) = diff_chunks(&stored_hashes, &new_for_diff);

    // Delete removed chunks (by specific chunk key, not by table — avoids
    // cascade-deleting unrelated FK chunks that share the same table).
    if !to_delete_keys.is_empty() {
        tracing::info!(
            profile_id = %config.connection_id,
            remove_count = to_delete_keys.len(),
            at = %Utc::now().to_rfc3339(),
            "schema_index build_index: deleting obsolete chunk keys no longer present in schema"
        );
        tracing::debug!(
            profile_id = %config.connection_id,
            obsolete_chunk_keys = ?to_delete_keys,
            "schema_index build_index: obsolete chunk keys to delete"
        );
        let conn = sqlite_conn
            .lock()
            .map_err(|error| format!("SQLite lock: {error}"))?;
        for key in &to_delete_keys {
            storage::delete_chunk_by_key(&conn, &config.connection_id, key)
                .map_err(|error| format!("Failed to delete chunk {key}: {error}"))?;
        }
    }

    // 6. Embed new/changed chunks in batches
    let chunks_to_embed: Vec<_> = all_new
        .iter()
        .filter(|chunk| needs_embed_keys.contains(&chunk.chunk_key))
        .collect();

    let total_to_embed = chunks_to_embed.len();
    let staged_at = Utc::now().to_rfc3339();
    let staged_table_chunks = chunks_to_embed
        .iter()
        .filter(|chunk| matches!(&chunk.chunk_type, ChunkType::Table))
        .count();
    let staged_foreign_key_chunks = chunks_to_embed
        .iter()
        .filter(|chunk| matches!(&chunk.chunk_type, ChunkType::Fk))
        .count();
    let unchanged_chunks = all_new.len().saturating_sub(total_to_embed);

    tracing::info!(
        profile_id = %config.connection_id,
        staged_at = %staged_at,
        total_chunks_current = all_new.len(),
        staged_for_embedding = total_to_embed,
        staged_table_chunks,
        staged_foreign_key_chunks,
        unchanged_chunks_skipped = unchanged_chunks,
        obsolete_chunks_removed = to_delete_keys.len(),
        "schema_index build_index: diff complete — staged chunks for embedding (new or hash-changed); skipped unchanged"
    );

    let should_log_chunk_keys =
        tracing::enabled!(tracing::Level::DEBUG) && !chunks_to_embed.is_empty();
    if should_log_chunk_keys {
        let keys_preview: Vec<(&str, &str)> = chunks_to_embed
            .iter()
            .map(|chunk| (chunk.chunk_key.as_str(), chunk.chunk_type.as_str()))
            .collect();
        tracing::debug!(
            profile_id = %config.connection_id,
            staged_chunk_keys = ?keys_preview,
            "schema_index build_index: full list of chunk keys staged for this build"
        );
    }

    // Count tables that don't need re-embedding (unchanged tables are already "done")
    let unchanged_tables = {
        let table_keys_to_embed: std::collections::HashSet<&str> = chunks_to_embed
            .iter()
            .filter(|chunk| matches!(&chunk.chunk_type, ChunkType::Table))
            .map(|chunk| chunk.chunk_key.as_str())
            .collect();
        let total_table_chunks = table_chunks.len();
        total_table_chunks - table_keys_to_embed.len()
    };
    let mut progress_tracker = EmbeddingProgressTracker {
        profile_id: config.connection_id.clone(),
        tables_done: unchanged_tables,
        tables_total,
        total_embed_batches: total_to_embed.div_ceil(EMBED_BATCH_SIZE),
        embed_batches_done: 0,
        finalizing: None,
    };

    // Emit an initial embedding/finalizing progress event so the UI can switch
    // from "Reading schema..." immediately. If table progress is already
    // complete (e.g. only FK chunks remain), report Finalizing right away
    // with a separate step counter.
    let initial_progress = progress_tracker.start();
    if let Some(cb) = on_progress {
        cb(initial_progress);
    }

    for batch_start in (0..total_to_embed).step_by(EMBED_BATCH_SIZE) {
        if cancellation.is_cancelled() {
            tracing::warn!(
                profile_id = %config.connection_id,
                at = %Utc::now().to_rfc3339(),
                progress_chunks = batch_start,
                total_chunks = total_to_embed,
                "schema_index build_index: cancelled during embedding"
            );
            return Err("Build cancelled".to_string());
        }

        let batch_end = (batch_start + EMBED_BATCH_SIZE).min(total_to_embed);
        let batch = &chunks_to_embed[batch_start..batch_end];

        // Use text_for_embedding when available, falling back to ddl_text
        let texts: Vec<String> = batch
            .iter()
            .map(|chunk| {
                chunk
                    .text_for_embedding
                    .as_ref()
                    .unwrap_or(&chunk.ddl_text)
                    .clone()
            })
            .collect();

        let batch_keys: Vec<&str> = batch.iter().map(|chunk| chunk.chunk_key.as_str()).collect();
        tracing::info!(
            profile_id = %config.connection_id,
            batch_start,
            batch_end,
            batch_len = batch.len(),
            at = %Utc::now().to_rfc3339(),
            "schema_index build_index: calling embedding API for batch"
        );
        tracing::debug!(
            profile_id = %config.connection_id,
            chunk_keys = ?batch_keys,
            "schema_index build_index: batch chunk keys (no DDL text logged)"
        );

        let embed_started = Instant::now();
        let embeddings =
            embeddings::embed_texts(http_client, &config.endpoint, &config.model_id, texts, None)
                .await
                .map_err(|error| format!("Embedding failed: {error}"))?;
        tracing::debug!(
            profile_id = %config.connection_id,
            batch_start,
            elapsed_ms = embed_started.elapsed().as_millis() as u64,
            vectors_returned = embeddings.len(),
            vector_dims = embeddings.first().map(|embedding| embedding.len()).unwrap_or(0),
            "schema_index build_index: embedding API batch finished"
        );

        // Store in SQLite with batched transactions
        {
            let conn = sqlite_conn
                .lock()
                .map_err(|error| format!("SQLite lock: {error}"))?;
            let mut tx_count = 0;
            conn.execute_batch("BEGIN")
                .map_err(|error| format!("BEGIN: {error}"))?;

            for (chunk_index, chunk) in batch.iter().enumerate() {
                let embedding = &embeddings[chunk_index];

                // Check if chunk already exists (update vs insert)
                let existing =
                    storage::get_chunk_by_key(&conn, &config.connection_id, &chunk.chunk_key)
                        .map_err(|error| format!("Failed to lookup chunk: {error}"))?;

                match existing {
                    Some(existing_chunk) => {
                        storage::update_chunk_embedding(
                            &conn,
                            &config.connection_id,
                            &ChunkEmbeddingUpdate {
                                chunk_id: existing_chunk.id,
                                ddl_text: &chunk.ddl_text,
                                ddl_hash: &chunk.ddl_hash,
                                model_id: &config.model_id,
                                embedding,
                                text_for_embedding: chunk.text_for_embedding.as_deref(),
                                row_count_approx: chunk.row_count_approx,
                            },
                        )
                        .map_err(|error| format!("Failed to update chunk: {error}"))?;
                    }
                    None => {
                        let insert = ChunkInsert {
                            connection_id: config.connection_id.clone(),
                            chunk_key: chunk.chunk_key.clone(),
                            db_name: chunk.db_name.clone(),
                            table_name: chunk.table_name.clone(),
                            chunk_type: chunk.chunk_type.clone(),
                            ddl_text: chunk.ddl_text.clone(),
                            ddl_hash: chunk.ddl_hash.clone(),
                            model_id: config.model_id.clone(),
                            ref_db_name: chunk.ref_db_name.clone(),
                            ref_table_name: chunk.ref_table_name.clone(),
                            embedding: embedding.clone(),
                            text_for_embedding: chunk.text_for_embedding.clone(),
                            row_count_approx: chunk.row_count_approx,
                        };
                        storage::insert_chunk(&conn, &insert)
                            .map_err(|error| format!("Failed to insert chunk: {error}"))?;
                    }
                }

                tx_count += 1;
                if tx_count >= SQLITE_COMMIT_BATCH {
                    conn.execute_batch("COMMIT")
                        .map_err(|error| format!("COMMIT: {error}"))?;
                    conn.execute_batch("BEGIN")
                        .map_err(|error| format!("BEGIN: {error}"))?;
                    tx_count = 0;
                }
            }

            conn.execute_batch("COMMIT")
                .map_err(|error| format!("COMMIT: {error}"))?;
        }

        tracing::debug!(
            profile_id = %config.connection_id,
            batch_start,
            at = %Utc::now().to_rfc3339(),
            "schema_index build_index: SQLite transaction committed for embedding batch"
        );

        // Count how many table chunks (not FK chunks) were in this batch
        let table_chunks_in_batch = batch
            .iter()
            .filter(|chunk| matches!(&chunk.chunk_type, ChunkType::Table))
            .count();
        let batch_progress = progress_tracker.record_batch(table_chunks_in_batch);
        if let Some(cb) = on_progress {
            cb(batch_progress);
        }
    }

    // 7a. Persist current signatures for every table that now has a chunk so
    // the next build can short-circuit unchanged tables. Also drop signatures
    // for tables that no longer exist in the bulk enumeration.
    {
        let conn = sqlite_conn
            .lock()
            .map_err(|error| format!("SQLite lock: {error}"))?;

        let sig_rows: Vec<(String, String, String)> = current_signatures
            .iter()
            .map(|((db, tbl), sig)| (db.clone(), tbl.clone(), sig.clone()))
            .collect();
        conn.execute_batch("BEGIN")
            .map_err(|error| format!("BEGIN signatures: {error}"))?;
        storage::upsert_signatures(&conn, &config.connection_id, &sig_rows)
            .map_err(|error| format!("Failed to upsert signatures: {error}"))?;

        // Remove signatures for tables no longer present. `current_signatures`
        // already covers only existing tables, so stored signatures whose key
        // isn't in `current_signatures` are stale.
        let current_keys: std::collections::HashSet<(String, String)> =
            current_signatures.keys().cloned().collect();
        for (db, tbl) in stored_signatures.keys() {
            if !current_keys.contains(&(db.clone(), tbl.clone())) {
                storage::delete_signature(&conn, &config.connection_id, db, tbl)
                    .map_err(|error| format!("Failed to delete stale signature: {error}"))?;
            }
        }
        conn.execute_batch("COMMIT")
            .map_err(|error| format!("COMMIT signatures: {error}"))?;
    }

    if let (Some(cb), Some(progress)) = (on_progress, progress_tracker.advance_finalizing()) {
        cb(progress);
    }

    // 8. Set status = "ready", update last_build_at
    {
        let conn = sqlite_conn
            .lock()
            .map_err(|error| format!("SQLite lock: {error}"))?;
        let now = chrono::Utc::now().to_rfc3339();
        let meta = storage::get_index_meta(&conn, &config.connection_id)
            .map_err(|error| format!("Failed to get index meta: {error}"))?;
        if let Some(mut meta_update) = meta {
            meta_update.status = IndexStatus::Ready;
            meta_update.last_build_at = Some(now);
            storage::upsert_index_meta(&conn, &meta_update)
                .map_err(|error| format!("Failed to update index meta: {error}"))?;
        }
    }

    if let (Some(cb), Some(progress)) = (on_progress, progress_tracker.advance_finalizing()) {
        cb(progress);
    }

    let duration_ms = start.elapsed().as_millis() as u64;
    let finished_at = Utc::now().to_rfc3339();
    tracing::info!(
        profile_id = %config.connection_id,
        finished_at = %finished_at,
        tables_indexed = tables_total,
        duration_ms,
        chunks_embedded_this_run = total_to_embed,
        "schema_index build_index: completed — status will be set to ready"
    );

    Ok(BuildResult {
        profile_id: config.connection_id.clone(),
        tables_indexed: tables_total,
        duration_ms,
    })
}

#[cfg(not(coverage))]
fn is_foreign_key_of_table(foreign_key: &FkInput, table_chunk: &GeneratedTableChunk) -> bool {
    foreign_key.db_name == table_chunk.db_name && foreign_key.table_name == table_chunk.table_name
}

/// Rebuild the index for specific tables only (partial rebuild).
#[cfg(not(coverage))]
pub async fn rebuild_tables(
    config: &BuildConfig,
    tables: &[(String, String)], // Vec<(db_name, table_name)>
    sqlite_conn: &Mutex<rusqlite::Connection>,
    mysql_pool: &sqlx::MySqlPool,
    http_client: &reqwest::Client,
    cancellation: &CancellationToken,
) -> Result<(), String> {
    let started_at = Utc::now().to_rfc3339();
    tracing::info!(
        profile_id = %config.connection_id,
        model_id = %config.model_id,
        started_at = %started_at,
        table_targets = tables.len(),
        "schema_index rebuild_tables: started (partial table rebuild)"
    );

    // 1. Delete all chunks for specified tables (covers FK chunks on both sides)
    // and invalidate their stored signatures so the follow-up `build_index`
    // will re-fetch DDL instead of short-circuiting on a stale signature.
    {
        let conn = sqlite_conn
            .lock()
            .map_err(|error| format!("SQLite lock: {error}"))?;
        for (db, tbl) in tables {
            storage::delete_chunks_by_table(&conn, &config.connection_id, db, tbl)
                .map_err(|error| format!("Failed to delete chunks for {db}.{tbl}: {error}"))?;
            storage::delete_signature(&conn, &config.connection_id, db, tbl)
                .map_err(|error| format!("Failed to delete signature for {db}.{tbl}: {error}"))?;
        }
    }
    tracing::debug!(
        profile_id = %config.connection_id,
        "schema_index rebuild_tables: removed existing chunks and signatures for targeted tables"
    );

    // 2. Re-fetch DDL for those tables
    let mut ddl_inputs = Vec::new();
    for (db, tbl) in tables {
        if cancellation.is_cancelled() {
            return Err("Rebuild cancelled".to_string());
        }
        match fetch_create_table(mysql_pool, db, tbl).await {
            Ok(ddl) => {
                ddl_inputs.push(TableDdlInput {
                    db_name: db.clone(),
                    table_name: tbl.clone(),
                    create_table_sql: ddl,
                });
            }
            Err(error) => {
                tracing::warn!(
                    db_name = %db,
                    table_name = %tbl,
                    error = %error,
                    "Table not found during rebuild (likely dropped), skipping"
                );
                // Skip this table — chunks were already deleted above
                continue;
            }
        }
    }

    // 3. Generate new table + FK chunks
    let (table_chunks, foreign_key_chunks) = generate_all_chunks(&ddl_inputs);

    // 3a. Store FK edges for rebuilt tables
    {
        let conn = sqlite_conn
            .lock()
            .map_err(|error| format!("SQLite lock: {error}"))?;
        for tc in &table_chunks {
            let edges: Vec<FkEdge> = foreign_key_chunks
                .iter()
                .filter(|(_, _, _, foreign_key)| is_foreign_key_of_table(foreign_key, tc))
                .flat_map(|(_, _, _, foreign_key)| {
                    foreign_key
                        .columns
                        .iter()
                        .zip(foreign_key.ref_columns.iter())
                        .map(|(src_col, dst_col)| FkEdge {
                            connection_id: config.connection_id.clone(),
                            src_db: foreign_key.db_name.clone(),
                            src_tbl: foreign_key.table_name.clone(),
                            src_col: src_col.clone(),
                            dst_db: foreign_key.ref_db_name.clone(),
                            dst_tbl: foreign_key.ref_table_name.clone(),
                            dst_col: dst_col.clone(),
                            constraint_name: foreign_key.constraint_name.clone(),
                            on_delete: Some(foreign_key.on_delete.clone()),
                            on_update: Some(foreign_key.on_update.clone()),
                        })
                })
                .collect();
            storage::replace_fk_edges_for_table(
                &conn,
                &config.connection_id,
                &tc.db_name,
                &tc.table_name,
                &edges,
            )
            .map_err(|error| {
                format!(
                    "Failed to store FK edges for {}.{}: {error}",
                    tc.db_name, tc.table_name
                )
            })?;
        }
    }

    // 4. Collect all texts to embed
    let mut embed_items: Vec<PendingChunk> = Vec::new();
    for tc in table_chunks {
        embed_items.push(PendingChunk {
            chunk_key: tc.chunk_key,
            ddl_text: tc.ddl_text,
            ddl_hash: tc.ddl_hash,
            chunk_type: ChunkType::Table,
            db_name: tc.db_name,
            table_name: tc.table_name,
            ref_db_name: None,
            ref_table_name: None,
            text_for_embedding: tc.text_for_embedding,
            row_count_approx: tc.row_count_approx,
        });
    }
    // NOTE: FK chunks no longer inserted into schema_index_chunks.
    // FK data lives exclusively in schema_index_fk_edges (stored above).

    let staged_at = Utc::now().to_rfc3339();
    let staged_tables = embed_items
        .iter()
        .filter(|chunk| matches!(&chunk.chunk_type, ChunkType::Table))
        .count();
    let staged_foreign_keys = embed_items
        .iter()
        .filter(|chunk| matches!(&chunk.chunk_type, ChunkType::Fk))
        .count();
    tracing::info!(
        profile_id = %config.connection_id,
        staged_at = %staged_at,
        chunks_to_embed = embed_items.len(),
        staged_table_chunks = staged_tables,
        staged_fk_chunks = staged_foreign_keys,
        "schema_index rebuild_tables: staged all chunks for targeted tables before embedding"
    );

    // 5. Embed and store
    for batch_start in (0..embed_items.len()).step_by(EMBED_BATCH_SIZE) {
        if cancellation.is_cancelled() {
            return Err("Rebuild cancelled".to_string());
        }

        let batch_end = (batch_start + EMBED_BATCH_SIZE).min(embed_items.len());
        let batch = &embed_items[batch_start..batch_end];

        // Use text_for_embedding when available, falling back to ddl_text
        let texts: Vec<String> = batch
            .iter()
            .map(|chunk| {
                chunk
                    .text_for_embedding
                    .as_ref()
                    .unwrap_or(&chunk.ddl_text)
                    .clone()
            })
            .collect();
        let batch_keys: Vec<&str> = batch.iter().map(|chunk| chunk.chunk_key.as_str()).collect();
        tracing::info!(
            profile_id = %config.connection_id,
            batch_start,
            batch_end,
            batch_len = batch.len(),
            at = %Utc::now().to_rfc3339(),
            "schema_index rebuild_tables: calling embedding API for batch"
        );
        tracing::debug!(
            profile_id = %config.connection_id,
            chunk_keys = ?batch_keys,
            "schema_index rebuild_tables: batch chunk keys"
        );

        let embed_started = Instant::now();
        let embeddings =
            embeddings::embed_texts(http_client, &config.endpoint, &config.model_id, texts, None)
                .await
                .map_err(|error| format!("Embedding failed: {error}"))?;
        tracing::debug!(
            profile_id = %config.connection_id,
            batch_start,
            elapsed_ms = embed_started.elapsed().as_millis() as u64,
            vectors_returned = embeddings.len(),
            "schema_index rebuild_tables: embedding API batch finished"
        );

        let conn = sqlite_conn
            .lock()
            .map_err(|error| format!("SQLite lock: {error}"))?;
        conn.execute_batch("BEGIN")
            .map_err(|error| format!("BEGIN: {error}"))?;

        for (chunk_index, chunk) in batch.iter().enumerate() {
            let insert = ChunkInsert {
                connection_id: config.connection_id.clone(),
                chunk_key: chunk.chunk_key.clone(),
                db_name: chunk.db_name.clone(),
                table_name: chunk.table_name.clone(),
                chunk_type: chunk.chunk_type.clone(),
                ddl_text: chunk.ddl_text.clone(),
                ddl_hash: chunk.ddl_hash.clone(),
                model_id: config.model_id.clone(),
                ref_db_name: chunk.ref_db_name.clone(),
                ref_table_name: chunk.ref_table_name.clone(),
                embedding: embeddings[chunk_index].clone(),
                text_for_embedding: chunk.text_for_embedding.clone(),
                row_count_approx: chunk.row_count_approx,
            };
            storage::insert_chunk(&conn, &insert)
                .map_err(|error| format!("Failed to insert chunk: {error}"))?;
        }

        conn.execute_batch("COMMIT")
            .map_err(|error| format!("COMMIT: {error}"))?;
    }

    tracing::info!(
        profile_id = %config.connection_id,
        at = %Utc::now().to_rfc3339(),
        "schema_index rebuild_tables: partial inserts done; running full incremental build_index to restore cross-table FK chunks"
    );

    // Restore any inbound FK chunks deleted during the targeted wipe by running
    // a full incremental diff-based build afterward.
    build_index(
        config,
        sqlite_conn,
        mysql_pool,
        http_client,
        None,
        cancellation,
    )
    .await?;

    tracing::info!(
        profile_id = %config.connection_id,
        finished_at = %Utc::now().to_rfc3339(),
        "schema_index rebuild_tables: finished (including follow-up build_index)"
    );

    Ok(())
}

// ── Internal helpers ─────────────────────────────────────────────────────

/// Handle model change: if the stored model differs from config, drop the vec table,
/// clear all chunks, detect new dimension, and recreate.
#[cfg(not(coverage))]
async fn handle_model_change(
    config: &BuildConfig,
    sqlite_conn: &Mutex<rusqlite::Connection>,
    http_client: &reqwest::Client,
) -> Result<(), String> {
    let existing_meta = {
        let conn = sqlite_conn
            .lock()
            .map_err(|error| format!("SQLite lock: {error}"))?;
        storage::get_index_meta(&conn, &config.connection_id)
            .map_err(|error| format!("Failed to get index meta: {error}"))?
    };

    match existing_meta {
        Some(meta) if meta.model_id != config.model_id => {
            // Model changed — rebuild from scratch
            tracing::info!(
                old_model = %meta.model_id,
                new_model = %config.model_id,
                "Schema index model changed, rebuilding"
            );

            let dimension = embeddings::detect_embedding_dimension(
                http_client,
                &config.endpoint,
                &config.model_id,
            )
            .await
            .map_err(|error| format!("Failed to detect embedding dimension: {error}"))?;

            let conn = sqlite_conn
                .lock()
                .map_err(|error| format!("SQLite lock: {error}"))?;
            // Delete chunks BEFORE dropping vec table, because delete_all_chunks
            // needs to remove rows from the vec table first.
            storage::delete_all_chunks(&conn, &config.connection_id)
                .map_err(|error| format!("Failed to delete chunks: {error}"))?;
            storage::drop_vec_table(&conn, &config.connection_id)
                .map_err(|error| format!("Failed to drop vec table: {error}"))?;
            storage::create_vec_table(&conn, &config.connection_id, dimension)
                .map_err(|error| format!("Failed to create vec table: {error}"))?;

            let new_meta = IndexMeta {
                connection_id: config.connection_id.clone(),
                model_id: config.model_id.clone(),
                embedding_dimension: dimension as i64,
                last_build_at: None,
                status: IndexStatus::Building,
                vec_schema_version: Some(storage::VEC_SCHEMA_VERSION as i64),
            };
            storage::upsert_index_meta(&conn, &new_meta)
                .map_err(|error| format!("Failed to upsert index meta: {error}"))?;
        }
        Some(meta) if meta.vec_schema_version != Some(storage::VEC_SCHEMA_VERSION as i64) => {
            // Same model but stale vec0 schema (e.g. L2 → cosine migration) —
            // drop and recreate with the current schema.
            tracing::info!(
                old_version = ?meta.vec_schema_version,
                new_version = storage::VEC_SCHEMA_VERSION,
                "Vec0 table schema version changed, rebuilding"
            );

            let dimension = meta.embedding_dimension as usize;
            let conn = sqlite_conn
                .lock()
                .map_err(|error| format!("SQLite lock: {error}"))?;
            storage::delete_all_chunks(&conn, &config.connection_id)
                .map_err(|error| format!("Failed to delete chunks: {error}"))?;
            storage::drop_vec_table(&conn, &config.connection_id)
                .map_err(|error| format!("Failed to drop vec table: {error}"))?;
            storage::create_vec_table(&conn, &config.connection_id, dimension)
                .map_err(|error| format!("Failed to create vec table: {error}"))?;

            let new_meta = IndexMeta {
                connection_id: config.connection_id.clone(),
                model_id: config.model_id.clone(),
                embedding_dimension: dimension as i64,
                last_build_at: None,
                status: IndexStatus::Building,
                vec_schema_version: Some(storage::VEC_SCHEMA_VERSION as i64),
            };
            storage::upsert_index_meta(&conn, &new_meta)
                .map_err(|error| format!("Failed to upsert index meta: {error}"))?;
        }
        None => {
            // No meta yet — detect dimension and create
            let dimension = embeddings::detect_embedding_dimension(
                http_client,
                &config.endpoint,
                &config.model_id,
            )
            .await
            .map_err(|error| format!("Failed to detect embedding dimension: {error}"))?;

            let conn = sqlite_conn
                .lock()
                .map_err(|error| format!("SQLite lock: {error}"))?;
            storage::create_vec_table(&conn, &config.connection_id, dimension)
                .map_err(|error| format!("Failed to create vec table: {error}"))?;

            let new_meta = IndexMeta {
                connection_id: config.connection_id.clone(),
                model_id: config.model_id.clone(),
                embedding_dimension: dimension as i64,
                last_build_at: None,
                status: IndexStatus::Building,
                vec_schema_version: Some(storage::VEC_SCHEMA_VERSION as i64),
            };
            storage::upsert_index_meta(&conn, &new_meta)
                .map_err(|error| format!("Failed to upsert index meta: {error}"))?;
        }
        Some(_) => {
            // Same model, same vec schema — continue incrementally
            tracing::debug!(
                profile_id = %config.connection_id,
                model_id = %config.model_id,
                "schema_index handle_model_change: same model and vec schema — incremental path"
            );
        }
    }

    Ok(())
}

/// A pending chunk awaiting embedding — replaces the anonymous 10-field tuple
/// that was previously threaded through `build_index` / `rebuild_tables`.
#[derive(Debug, Clone)]
#[cfg(not(coverage))]
pub(crate) struct PendingChunk {
    pub chunk_key: String,
    pub ddl_text: String,
    pub ddl_hash: String,
    pub chunk_type: ChunkType,
    pub db_name: String,
    pub table_name: String,
    pub ref_db_name: Option<String>,
    pub ref_table_name: Option<String>,
    pub text_for_embedding: Option<String>,
    pub row_count_approx: Option<i64>,
}

/// A generated table chunk with enriched embedding text.
#[derive(Debug, Clone)]
pub struct GeneratedTableChunk {
    pub chunk_key: String,
    pub ddl_text: String,
    pub ddl_hash: String,
    pub db_name: String,
    pub table_name: String,
    pub text_for_embedding: Option<String>,
    pub row_count_approx: Option<i64>,
}

/// Parse column definitions from a `CREATE TABLE` DDL.
///
/// Returns `(col_name, col_type, col_comment)` triples.
pub fn parse_columns_from_ddl(ddl: &str) -> Vec<(String, String, Option<String>)> {
    static COL_DEF_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = COL_DEF_REGEX.get_or_init(|| {
        Regex::new(r"(?im)^\s*`([^`]+)`\s+(\S+(?:\([^)]*\))?(?:\s+unsigned)?)")
            .expect("valid column def regex")
    });
    static COL_COMMENT_INLINE: OnceLock<Regex> = OnceLock::new();
    let re_comment = COL_COMMENT_INLINE.get_or_init(|| {
        Regex::new(r"(?i)COMMENT\s+'((?:[^'\\]|\\.)*)'").expect("valid inline comment regex")
    });

    let mut cols = Vec::new();
    for line in ddl.lines() {
        let trimmed = line.trim();
        if is_non_column_ddl_line(trimmed) {
            continue;
        }
        if let Some(cap) = re.captures(trimmed) {
            let name = cap[1].to_string();
            let typ = cap[2].to_string();
            let comment = re_comment
                .captures(trimmed)
                .map(|captures| captures[1].to_string());
            cols.push((name, typ, comment));
        }
    }
    cols
}

/// Parse primary key column names from a `CREATE TABLE` DDL.
pub fn parse_pk_from_ddl(ddl: &str) -> Vec<String> {
    static PK_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = PK_REGEX
        .get_or_init(|| Regex::new(r"(?i)PRIMARY\s+KEY\s+\(([^)]+)\)").expect("valid PK regex"));
    match re.captures(ddl) {
        Some(cap) => parse_backtick_list(&cap[1]),
        None => Vec::new(),
    }
}

/// Parse unique index names from a `CREATE TABLE` DDL.
pub fn parse_unique_indexes_from_ddl(ddl: &str) -> Vec<String> {
    static UNIQUE_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = UNIQUE_REGEX.get_or_init(|| {
        Regex::new(r"(?i)UNIQUE\s+(?:KEY|INDEX)\s+`([^`]+)`").expect("valid unique index regex")
    });
    re.captures_iter(ddl)
        .map(|captures| captures[1].to_string())
        .collect()
}

/// Generate table + FK chunks from DDL inputs, enriched with `text_for_embedding`.
///
/// `row_counts` provides approximate row counts from `information_schema.TABLES`.
///
pub type GeneratedFkChunk = (String, String, String, FkInput);

/// Returns:
/// - table_chunks: `Vec<GeneratedTableChunk>`
/// - fk_chunks: `Vec<(chunk_key, fk_text, fk_hash, FkInput)>`
/// - fk_edges: `Vec<FkEdge>` — flat list of all FK edges for bulk storage
pub fn generate_all_chunks(
    ddl_inputs: &[TableDdlInput],
) -> (Vec<GeneratedTableChunk>, Vec<GeneratedFkChunk>) {
    generate_all_chunks_with_row_counts(ddl_inputs, &HashMap::new())
}

/// Like [`generate_all_chunks`] but accepts optional row counts.
pub fn generate_all_chunks_with_row_counts(
    ddl_inputs: &[TableDdlInput],
    row_counts: &HashMap<(String, String), i64>,
) -> (Vec<GeneratedTableChunk>, Vec<GeneratedFkChunk>) {
    let mut table_chunks = Vec::new();
    let mut foreign_key_chunks = Vec::new();

    for input in ddl_inputs {
        let raw_ddl = &input.create_table_sql;

        // Parse structural info from DDL
        let cols = parse_columns_from_ddl(raw_ddl);
        let primary_key_columns = parse_pk_from_ddl(raw_ddl);
        let unique_index = parse_unique_indexes_from_ddl(raw_ddl);
        let table_comment = extract_table_comment(raw_ddl);
        let foreign_keys = parse_fks_from_ddl(&input.db_name, &input.table_name, raw_ddl);
        let row_count = row_counts
            .get(&(input.db_name.clone(), input.table_name.clone()))
            .copied();

        // Convert FkInputs to FkEdges for text_for_embedding
        let foreign_key_edges: Vec<FkEdge> = foreign_keys
            .iter()
            .flat_map(|foreign_key| {
                foreign_key
                    .columns
                    .iter()
                    .zip(foreign_key.ref_columns.iter())
                    .map(|(src_col, dst_col)| FkEdge {
                        connection_id: String::new(), // filled in by caller
                        src_db: foreign_key.db_name.clone(),
                        src_tbl: foreign_key.table_name.clone(),
                        src_col: src_col.clone(),
                        dst_db: foreign_key.ref_db_name.clone(),
                        dst_tbl: foreign_key.ref_table_name.clone(),
                        dst_col: dst_col.clone(),
                        constraint_name: foreign_key.constraint_name.clone(),
                        on_delete: Some(foreign_key.on_delete.clone()),
                        on_update: Some(foreign_key.on_update.clone()),
                    })
                    .collect::<Vec<_>>()
            })
            .collect();

        // Generate rich embedding text
        let text_for_embedding = generate_text_for_embedding(&TableEmbeddingDescription {
            db_name: &input.db_name,
            table_name: &input.table_name,
            table_comment: table_comment.as_deref(),
            columns: &cols,
            primary_key_columns: &primary_key_columns,
            unique_indexes: &unique_index,
            foreign_keys: &foreign_key_edges,
            row_count,
        });

        // Table chunk: compact DDL (preserving comments for LLM) with optional row count annotation
        let compacted = compact_ddl_for_llm(raw_ddl);
        let mut compacted = normalize_table_ddl(&input.db_name, &input.table_name, &compacted);
        let hash = compute_hash(&compacted);
        if let Some(count) = row_count {
            compacted = format!("{compacted}\n-- approximate rows: {count}");
        }
        let key = table_chunk_key(&input.db_name, &input.table_name);

        table_chunks.push(GeneratedTableChunk {
            chunk_key: key,
            ddl_text: compacted,
            ddl_hash: hash,
            db_name: input.db_name.clone(),
            table_name: input.table_name.clone(),
            text_for_embedding: Some(text_for_embedding),
            row_count_approx: row_count,
        });

        // FK chunks from DDL parsing
        for foreign_key in foreign_keys {
            let foreign_key_text = generate_fk_chunk_text(&foreign_key);
            let foreign_key_hash = compute_hash(&foreign_key_text);
            let foreign_key_key = fk_chunk_key(
                &foreign_key.db_name,
                &foreign_key.table_name,
                &foreign_key.constraint_name,
            );
            foreign_key_chunks.push((
                foreign_key_key,
                foreign_key_text,
                foreign_key_hash,
                foreign_key,
            ));
        }
    }

    (table_chunks, foreign_key_chunks)
}

// ── MySQL fetch helpers (excluded from coverage builds) ──────────────────

/// MySQL system schemas that should never be indexed.
#[cfg(not(coverage))]
const SYSTEM_SCHEMAS: &[&str] = &["information_schema", "mysql", "performance_schema", "sys"];

/// Concurrency for parallel `SHOW CREATE TABLE` fetches. Must stay at or below
/// the MySQL pool's `max_connections` so foreground queries aren't starved.
pub const SHOW_CREATE_TABLE_CONCURRENCY: usize = 8;

/// Enumerate every user (non-system) base table in one `information_schema`
/// round-trip. Returns `(schema, table)` pairs sorted by `(schema, table)`.
#[cfg(not(coverage))]
async fn fetch_all_user_tables(pool: &sqlx::MySqlPool) -> Result<Vec<(String, String)>, String> {
    let rows = sqlx::query(
        "SELECT TABLE_SCHEMA, TABLE_NAME \
         FROM information_schema.TABLES \
         WHERE TABLE_TYPE = 'BASE TABLE' \
           AND TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys') \
         ORDER BY TABLE_SCHEMA, TABLE_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to enumerate user tables: {error}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let schema = decode_string(row, 0).map_err(|error| format!("schema: {error}"))?;
        let table = decode_string(row, 1).map_err(|error| format!("table: {error}"))?;
        // Double-check: bind does not work with NOT IN (tuple) so guard in Rust too.
        if SYSTEM_SCHEMAS.contains(&schema.to_lowercase().as_str()) {
            continue;
        }
        out.push((schema, table));
    }
    Ok(out)
}

/// Tolerant UTF-8 column decoder: try `String`, fall back to bytes → lossy UTF-8.
/// Used everywhere we read MySQL identifier / metadata columns that the server
/// may hand back as either depending on collation.
#[cfg(not(coverage))]
fn decode_string(row: &sqlx::mysql::MySqlRow, index: usize) -> Result<String, sqlx::Error> {
    use sqlx::Row;
    row.try_get::<String, _>(index).or_else(|_| {
        row.try_get::<Vec<u8>, _>(index)
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
    })
}

/// Fetch a per-table MySQL "schema fingerprint" for every user table in a
/// single sweep. Three bulk queries (one each against `COLUMNS`, `STATISTICS`,
/// `KEY_COLUMN_USAGE` joined with `REFERENTIAL_CONSTRAINTS`) are issued
/// regardless of table count, and the raw rows are SHA-256'd client-side per
/// table — this avoids any `group_concat_max_len` truncation and keeps the
/// signature logic testable in pure Rust.
///
/// Returned map is `(db_name, table_name) -> signature_hex`.
#[cfg(not(coverage))]
async fn fetch_all_table_signatures(
    pool: &sqlx::MySqlPool,
) -> Result<HashMap<(String, String), String>, String> {
    use sqlx::Row;

    let system_filter =
        "TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys')";

    let cols_sql = format!(
        "SELECT TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, \
                IS_NULLABLE, IFNULL(COLUMN_DEFAULT, ''), EXTRA, COLUMN_KEY, \
                IFNULL(COLUMN_COMMENT, ''), IFNULL(CHARACTER_SET_NAME, ''), IFNULL(COLLATION_NAME, '') \
         FROM information_schema.COLUMNS \
         WHERE {system_filter} \
         ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
    );

    let index_sql = format!(
        "SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, \
                NON_UNIQUE, IFNULL(INDEX_TYPE, '') \
         FROM information_schema.STATISTICS \
         WHERE {system_filter} \
         ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX"
    );

    let foreign_keys_sql = format!(
        "SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION, \
                kcu.COLUMN_NAME, IFNULL(kcu.REFERENCED_TABLE_SCHEMA, ''), \
                IFNULL(kcu.REFERENCED_TABLE_NAME, ''), IFNULL(kcu.REFERENCED_COLUMN_NAME, ''), \
                IFNULL(rc.UPDATE_RULE, ''), IFNULL(rc.DELETE_RULE, '') \
         FROM information_schema.KEY_COLUMN_USAGE kcu \
         LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc \
              ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA \
             AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME \
             AND rc.TABLE_NAME = kcu.TABLE_NAME \
         WHERE kcu.REFERENCED_TABLE_NAME IS NOT NULL \
           AND kcu.{system_filter} \
         ORDER BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION"
    );

    // Per-table SHA-256 hashers keyed on (schema, table).
    let mut hashers: HashMap<(String, String), Sha256> = HashMap::new();

    // Columns
    let started = Instant::now();
    let col_rows = sqlx::query(sqlx::AssertSqlSafe(cols_sql.as_str()))
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to fetch column signatures: {error}"))?;
    for row in &col_rows {
        let schema = decode_string(row, 0).map_err(|error| format!("schema: {error}"))?;
        if SYSTEM_SCHEMAS.contains(&schema.to_lowercase().as_str()) {
            continue;
        }
        let table = decode_string(row, 1).map_err(|error| format!("table: {error}"))?;
        let ordinal: i64 = row
            .try_get::<i64, _>(2)
            .or_else(|_| row.try_get::<u64, _>(2).map(|value| value as i64))
            .unwrap_or(0);
        let col_name = decode_string(row, 3).unwrap_or_default();
        let col_type = decode_string(row, 4).unwrap_or_default();
        let is_null = decode_string(row, 5).unwrap_or_default();
        let default = decode_string(row, 6).unwrap_or_default();
        let extra = decode_string(row, 7).unwrap_or_default();
        let col_key = decode_string(row, 8).unwrap_or_default();
        let comment = decode_string(row, 9).unwrap_or_default();
        let charset = decode_string(row, 10).unwrap_or_default();
        let collation = decode_string(row, 11).unwrap_or_default();

        let hasher = hashers.entry((schema.clone(), table.clone())).or_default();
        hasher.update(b"C|");
        hasher.update(ordinal.to_le_bytes());
        hasher.update(b"|");
        hasher.update(col_name.as_bytes());
        hasher.update(b"|");
        hasher.update(col_type.as_bytes());
        hasher.update(b"|");
        hasher.update(is_null.as_bytes());
        hasher.update(b"|");
        hasher.update(default.as_bytes());
        hasher.update(b"|");
        hasher.update(extra.as_bytes());
        hasher.update(b"|");
        hasher.update(col_key.as_bytes());
        hasher.update(b"|");
        hasher.update(comment.as_bytes());
        hasher.update(b"|");
        hasher.update(charset.as_bytes());
        hasher.update(b"|");
        hasher.update(collation.as_bytes());
        hasher.update(b"\x1e");
    }
    tracing::debug!(
        rows = col_rows.len(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        "schema_index signatures: COLUMNS bulk query complete"
    );

    // Indexes
    let started = Instant::now();
    let index_rows = sqlx::query(sqlx::AssertSqlSafe(index_sql.as_str()))
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to fetch index signatures: {error}"))?;
    for row in &index_rows {
        let schema = decode_string(row, 0).map_err(|error| format!("schema: {error}"))?;
        if SYSTEM_SCHEMAS.contains(&schema.to_lowercase().as_str()) {
            continue;
        }
        let table = decode_string(row, 1).map_err(|error| format!("table: {error}"))?;
        let index_name = decode_string(row, 2).unwrap_or_default();
        let seq: i64 = row
            .try_get::<i64, _>(3)
            .or_else(|_| row.try_get::<u64, _>(3).map(|value| value as i64))
            .unwrap_or(0);
        let col_name = decode_string(row, 4).unwrap_or_default();
        let non_unique: i64 = row
            .try_get::<i64, _>(5)
            .or_else(|_| row.try_get::<u64, _>(5).map(|value| value as i64))
            .unwrap_or(0);
        let index_type = decode_string(row, 6).unwrap_or_default();

        let hasher = hashers.entry((schema.clone(), table.clone())).or_default();
        hasher.update(b"I|");
        hasher.update(index_name.as_bytes());
        hasher.update(b"|");
        hasher.update(seq.to_le_bytes());
        hasher.update(b"|");
        hasher.update(col_name.as_bytes());
        hasher.update(b"|");
        hasher.update(non_unique.to_le_bytes());
        hasher.update(b"|");
        hasher.update(index_type.as_bytes());
        hasher.update(b"\x1e");
    }
    tracing::debug!(
        rows = index_rows.len(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        "schema_index signatures: STATISTICS bulk query complete"
    );

    // Foreign keys
    let started = Instant::now();
    let foreign_key_rows = sqlx::query(sqlx::AssertSqlSafe(foreign_keys_sql.as_str()))
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to fetch FK signatures: {error}"))?;
    for row in &foreign_key_rows {
        let schema = decode_string(row, 0).map_err(|error| format!("schema: {error}"))?;
        if SYSTEM_SCHEMAS.contains(&schema.to_lowercase().as_str()) {
            continue;
        }
        let table = decode_string(row, 1).map_err(|error| format!("table: {error}"))?;
        let constraint = decode_string(row, 2).unwrap_or_default();
        let ord: i64 = row
            .try_get::<i64, _>(3)
            .or_else(|_| row.try_get::<u64, _>(3).map(|value| value as i64))
            .unwrap_or(0);
        let col_name = decode_string(row, 4).unwrap_or_default();
        let ref_schema = decode_string(row, 5).unwrap_or_default();
        let ref_table = decode_string(row, 6).unwrap_or_default();
        let ref_col = decode_string(row, 7).unwrap_or_default();
        let upd = decode_string(row, 8).unwrap_or_default();
        let del = decode_string(row, 9).unwrap_or_default();

        let hasher = hashers.entry((schema.clone(), table.clone())).or_default();
        hasher.update(b"F|");
        hasher.update(constraint.as_bytes());
        hasher.update(b"|");
        hasher.update(ord.to_le_bytes());
        hasher.update(b"|");
        hasher.update(col_name.as_bytes());
        hasher.update(b"|");
        hasher.update(ref_schema.as_bytes());
        hasher.update(b"|");
        hasher.update(ref_table.as_bytes());
        hasher.update(b"|");
        hasher.update(ref_col.as_bytes());
        hasher.update(b"|");
        hasher.update(upd.as_bytes());
        hasher.update(b"|");
        hasher.update(del.as_bytes());
        hasher.update(b"\x1e");
    }
    tracing::debug!(
        rows = foreign_key_rows.len(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        "schema_index signatures: KEY_COLUMN_USAGE bulk query complete"
    );

    let out = hashers
        .into_iter()
        .map(|(key, hasher)| (key, hex::encode(hasher.finalize())))
        .collect();
    Ok(out)
}

/// Fetch approximate row counts for all user base tables.
///
/// Returns a map of `(schema, table) -> row_count` from `information_schema.TABLES`.
#[cfg(not(coverage))]
async fn fetch_row_counts(
    pool: &sqlx::MySqlPool,
) -> Result<HashMap<(String, String), i64>, String> {
    use sqlx::Row;

    let rows = sqlx::query(
        "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_ROWS \
         FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys') \
           AND TABLE_TYPE = 'BASE TABLE'",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to fetch row counts: {error}"))?;

    let mut out = HashMap::with_capacity(rows.len());
    for row in &rows {
        let schema = decode_string(row, 0).map_err(|error| format!("schema: {error}"))?;
        if SYSTEM_SCHEMAS.contains(&schema.to_lowercase().as_str()) {
            continue;
        }
        let table = decode_string(row, 1).map_err(|error| format!("table: {error}"))?;
        let count: i64 = row
            .try_get::<i64, _>(2)
            .or_else(|_| row.try_get::<u64, _>(2).map(|value| value as i64))
            .unwrap_or(0);
        out.insert((schema, table), count);
    }
    Ok(out)
}

/// Fetch all user-created views with their DDL.
///
/// Returns `(db_name, view_name, create_view_ddl)` tuples.
#[cfg(not(coverage))]
async fn fetch_all_user_views(
    pool: &sqlx::MySqlPool,
) -> Result<Vec<(String, String, String)>, String> {
    use crate::mysql::schema_queries::safe_identifier;

    let rows = sqlx::query(
        "SELECT TABLE_SCHEMA, TABLE_NAME \
         FROM information_schema.TABLES \
         WHERE TABLE_TYPE = 'VIEW' \
           AND TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys') \
         ORDER BY TABLE_SCHEMA, TABLE_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to enumerate user views: {error}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let schema = decode_string(row, 0).map_err(|error| format!("schema: {error}"))?;
        if SYSTEM_SCHEMAS.contains(&schema.to_lowercase().as_str()) {
            continue;
        }
        let view_name = decode_string(row, 1).map_err(|error| format!("view: {error}"))?;

        let safe_db = safe_identifier(&schema)
            .map_err(|error| format!("Invalid db name {schema}: {error}"))?;
        let safe_view = safe_identifier(&view_name)
            .map_err(|error| format!("Invalid view name {view_name}: {error}"))?;
        let sql = format!("SHOW CREATE VIEW {safe_db}.{safe_view}");

        match sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
            .fetch_optional(pool)
            .await
        {
            Ok(Some(ddl_row)) => {
                let ddl = decode_string(&ddl_row, 1).unwrap_or_default();
                out.push((schema, view_name, ddl));
            }
            Ok(None) => {
                tracing::warn!(
                    view = %view_name,
                    db = %schema,
                    "SHOW CREATE VIEW returned no rows, skipping"
                );
            }
            Err(error) => {
                tracing::warn!(
                    view = %view_name,
                    db = %schema,
                    error = %error,
                    "SHOW CREATE VIEW failed, skipping"
                );
            }
        }
    }
    Ok(out)
}

/// Fetch all user-created routines (procedures and functions) with their DDL.
///
/// Returns `(db_name, routine_name, routine_type, create_ddl)` tuples where
/// `routine_type` is `"PROCEDURE"` or `"FUNCTION"`.
#[cfg(not(coverage))]
async fn fetch_all_user_routines(
    pool: &sqlx::MySqlPool,
) -> Result<Vec<(String, String, String, String)>, String> {
    use crate::mysql::schema_queries::safe_identifier;

    let rows = sqlx::query(
        "SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE \
         FROM information_schema.ROUTINES \
         WHERE ROUTINE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys') \
         ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to enumerate user routines: {error}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let schema = decode_string(row, 0).map_err(|error| format!("schema: {error}"))?;
        if SYSTEM_SCHEMAS.contains(&schema.to_lowercase().as_str()) {
            continue;
        }
        let routine_name = decode_string(row, 1).map_err(|error| format!("routine: {error}"))?;
        let routine_type = decode_string(row, 2).map_err(|error| format!("type: {error}"))?;

        let safe_db = safe_identifier(&schema)
            .map_err(|error| format!("Invalid db name {schema}: {error}"))?;
        let safe_name = safe_identifier(&routine_name)
            .map_err(|error| format!("Invalid routine name {routine_name}: {error}"))?;

        let show_keyword = show_create_routine_keyword(&routine_type);
        let show_cmd = format!("SHOW CREATE {show_keyword} {safe_db}.{safe_name}");

        match sqlx::query(sqlx::AssertSqlSafe(show_cmd.as_str()))
            .fetch_optional(pool)
            .await
        {
            Ok(Some(ddl_row)) => {
                let ddl = decode_string(&ddl_row, 2).unwrap_or_default();
                out.push((schema, routine_name, routine_type.to_uppercase(), ddl));
            }
            Ok(None) => {
                tracing::warn!(
                    routine = %routine_name,
                    db = %schema,
                    "SHOW CREATE {routine_type} returned no rows, skipping"
                );
            }
            Err(error) => {
                tracing::warn!(
                    routine = %routine_name,
                    db = %schema,
                    error = %error,
                    "SHOW CREATE {routine_type} failed, skipping"
                );
            }
        }
    }
    Ok(out)
}

/// Fetch `SHOW CREATE TABLE` output.
#[cfg(not(coverage))]
async fn fetch_create_table(
    pool: &sqlx::MySqlPool,
    database: &str,
    table: &str,
) -> Result<String, String> {
    use crate::mysql::schema_queries::safe_identifier;

    let safe_db = safe_identifier(database)?;
    let safe_table = safe_identifier(table)?;
    let sql = format!("SHOW CREATE TABLE {safe_db}.{safe_table}");
    let row = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("SHOW CREATE TABLE {database}.{table} failed: {error}"))?
        .ok_or_else(|| format!("Table {database}.{table} not found"))?;

    let ddl = decode_string(&row, 1).unwrap_or_default();

    Ok(ddl)
}

/// Parallel `SHOW CREATE TABLE` fetch for a set of `(db, table)` pairs.
///
/// Uses `buffer_unordered` bounded by `SHOW_CREATE_TABLE_CONCURRENCY` so the
/// MySQL pool can't be exhausted. Per-table heartbeats log every 10 completed
/// fetches so the previously silent phase is visible in tracing output.
#[cfg(not(coverage))]
async fn fetch_create_tables_parallel(
    pool: &sqlx::MySqlPool,
    targets: Vec<(String, String)>,
    profile_id: &str,
    cancellation: &CancellationToken,
    on_progress: Option<&ProgressCallback>,
    initial_done: usize,
    total: usize,
) -> Result<Vec<TableDdlInput>, String> {
    use futures::stream::{self, StreamExt};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    let total_to_fetch = targets.len();
    let completed = Arc::new(AtomicUsize::new(0));
    let phase_started = Instant::now();

    let results: Vec<Result<TableDdlInput, String>> = stream::iter(targets)
        .map(|(db, tbl)| {
            let completed = Arc::clone(&completed);
            let profile_id = profile_id.to_string();
            async move {
                let per_started = Instant::now();
                let ddl = fetch_create_table(pool, &db, &tbl).await?;
                let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                let should_log_progress = done.is_multiple_of(10) || done == total_to_fetch;
                if should_log_progress {
                    tracing::debug!(
                        profile_id = %profile_id,
                        fetched = done,
                        total = total_to_fetch,
                        last_elapsed_ms = per_started.elapsed().as_millis() as u64,
                        "schema_index build_index: SHOW CREATE TABLE progress"
                    );
                }
                Ok(TableDdlInput {
                    db_name: db,
                    table_name: tbl,
                    create_table_sql: ddl,
                })
            }
        })
        .buffer_unordered(SHOW_CREATE_TABLE_CONCURRENCY)
        .inspect(|_| {
            if let Some(cb) = on_progress {
                let done = completed.load(Ordering::Relaxed);
                cb(BuildProgress {
                    profile_id: profile_id.to_string(),
                    phase: BuildPhase::LoadingSchema,
                    tables_done: initial_done + done,
                    tables_total: total,
                });
            }
        })
        .collect()
        .await;

    if cancellation.is_cancelled() {
        return Err("Build cancelled".to_string());
    }

    let mut out = Vec::with_capacity(results.len());
    for result in results {
        out.push(result?);
    }

    tracing::info!(
        profile_id = %profile_id,
        fetched = out.len(),
        elapsed_ms = phase_started.elapsed().as_millis() as u64,
        concurrency = SHOW_CREATE_TABLE_CONCURRENCY,
        "schema_index build_index: parallel SHOW CREATE TABLE phase complete"
    );

    Ok(out)
}
