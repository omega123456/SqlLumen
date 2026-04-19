//! Index build orchestration — generates DDL chunks, computes hashes,
//! performs incremental embedding, and stores results.
//!
//! The public functions take explicit dependencies (SQLite mutex, MySQL pool,
//! HTTP client) so they are testable without the Tauri runtime.

use regex::Regex;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use chrono::Utc;
use tokio_util::sync::CancellationToken;

use super::embeddings;
use super::storage;
use super::types::{
    BuildConfig, BuildPhase, BuildProgress, BuildResult, ChunkInsert, ChunkType, FkEdge, FkInput,
    IndexMeta, IndexStatus, ProgressCallback, TableDdlInput,
};

/// Maximum number of texts per embedding batch.
const EMBED_BATCH_SIZE: usize = 32;

/// Number of chunks to commit in a single SQLite transaction.
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

    let text = if let Some(mat) = re_trailing.find(&text) {
        // Keep everything up to and including the `)`, strip the rest
        let paren_pos = text[..mat.start() + 1].rfind(')');
        match paren_pos {
            Some(pos) => format!("{})", &text[..pos]),
            None => text.to_string(),
        }
    } else {
        text.to_string()
    };

    // Normalize whitespace
    let re_ws =
        WHITESPACE_REGEX.get_or_init(|| Regex::new(r"\s+").expect("valid whitespace regex"));
    let text = re_ws.replace_all(&text, " ");

    text.trim().to_string()
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

    let re_auto_inc = AUTO_INCREMENT_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\s*AUTO_INCREMENT\s*=\s*\d+").expect("valid regex")
    });
    let text = re_auto_inc.replace_all(create_table_sql, "");

    let re_engine = ENGINE_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\bENGINE\s*=\s*\S+").expect("valid regex")
    });
    let text = re_engine.replace_all(&text, "");

    let re_row_format = ROW_FORMAT_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\bROW_FORMAT\s*=\s*\S+").expect("valid regex")
    });
    let text = re_row_format.replace_all(&text, "");

    let re_charset = CHARSET_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\bDEFAULT\s+CHARSET\s*=\s*\S+").expect("valid regex")
    });
    let text = re_charset.replace_all(&text, "");

    let re_collate = COLLATE_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\bCOLLATE\s*=\s*\S+").expect("valid regex")
    });
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
    re.captures(ddl).map(|c| c[1].to_string())
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
        .map(|c| (c[1].to_string(), c[2].to_string()))
        .collect()
}

/// Build the rich prose description of a table for the embedding model.
///
/// The output is a human-readable paragraph that captures table identity,
/// column names/types/comments, primary key, unique indexes, foreign keys,
/// and approximate row count.
pub fn generate_text_for_embedding(
    db: &str,
    tbl: &str,
    table_comment: Option<&str>,
    cols: &[(String, String, Option<String>)], // (col_name, col_type, col_comment)
    pk_cols: &[String],
    unique_idx: &[String],
    fks: &[FkEdge],
    row_count: Option<i64>,
) -> String {
    let mut parts = Vec::new();

    // Table identity
    let default_comment = format!("stores {tbl} data");
    let comment_desc = table_comment
        .filter(|c| !c.is_empty())
        .unwrap_or(&default_comment);
    parts.push(format!("Table `{db}`.`{tbl}` — {comment_desc}."));

    // Columns
    if !cols.is_empty() {
        let col_descs: Vec<String> = cols
            .iter()
            .map(|(name, typ, comment)| {
                if let Some(c) = comment {
                    format!("{name} ({typ}, \"{c}\")")
                } else {
                    format!("{name} ({typ})")
                }
            })
            .collect();
        parts.push(format!("Columns: {}.", col_descs.join(", ")));
    }

    // Primary key
    if !pk_cols.is_empty() {
        parts.push(format!("Primary key: {}.", pk_cols.join(", ")));
    }

    // Unique indexes
    if !unique_idx.is_empty() {
        parts.push(format!("Unique indexes: {}.", unique_idx.join(", ")));
    }

    // Foreign keys
    if !fks.is_empty() {
        parts.push("Foreign keys:".to_string());
        for fk in fks {
            let mut desc = format!(
                "  - {} references `{}`.`{}`({})",
                fk.src_col, fk.dst_db, fk.dst_tbl, fk.dst_col
            );
            if let Some(ref on_del) = fk.on_delete {
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
        let identifier = captures.get(1).map(|m| m.as_str()).unwrap_or_default();
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
pub fn generate_fk_chunk_text(fk: &FkInput) -> String {
    let cols = fk.columns.join(", ");
    let ref_cols = fk.ref_columns.join(", ");
    format!(
        "Table {db}.{table} has a foreign key ({cols}) that references {ref_db}.{ref_table}({ref_cols}) ON DELETE {on_delete} ON UPDATE {on_update}",
        db = fk.db_name,
        table = fk.table_name,
        ref_db = fk.ref_db_name,
        ref_table = fk.ref_table_name,
        on_delete = fk.on_delete,
        on_update = fk.on_update,
    )
}

/// Compute a SHA-256 hex digest of the given text.
pub fn compute_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
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
            if ch.is_uppercase() && !current.is_empty() {
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

    let mut fks = Vec::new();
    for cap in re.captures_iter(ddl) {
        let constraint_name = cap[1].to_string();
        let columns = parse_backtick_list(&cap[2]);
        let ref_db = cap
            .get(3)
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| db_name.to_string());
        let ref_table = cap[4].to_string();
        let ref_columns = parse_backtick_list(&cap[5]);
        let on_delete = cap
            .get(6)
            .map(|m| m.as_str().to_uppercase())
            .unwrap_or_else(|| "RESTRICT".to_string());
        let on_update = cap
            .get(7)
            .map(|m| m.as_str().to_uppercase())
            .unwrap_or_else(|| "RESTRICT".to_string());

        fks.push(FkInput {
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
    fks
}

/// Parse a backtick-delimited column list like `` `col1`,`col2` `` into `["col1", "col2"]`.
fn parse_backtick_list(s: &str) -> Vec<String> {
    static BACKTICK_LIST_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = BACKTICK_LIST_REGEX
        .get_or_init(|| Regex::new(r"`([^`]+)`").expect("valid backtick list regex"));
    re.captures_iter(s).map(|c| c[1].to_string()).collect()
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
        .map(|(k, h)| (k.as_str(), h.as_str()))
        .collect();

    let new_map: HashMap<&str, (&str, &str)> = new_chunks
        .iter()
        .map(|(k, _text, h)| (k.as_str(), (_text.as_str(), h.as_str())))
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
    for (key, _) in &stored_map {
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
pub fn decide_signature_action(
    current_sig: Option<&str>,
    stored_sig: Option<&str>,
    chunk_exists: bool,
) -> SignatureDecision {
    match (current_sig, stored_sig) {
        (Some(c), Some(s)) if c == s && chunk_exists => SignatureDecision::Reuse,
        _ => SignatureDecision::Refetch,
    }
}

// ── Build index (full) ──────────────────────────────────────────────────

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
            .map_err(|e| format!("SQLite lock: {e}"))?;
        storage::update_index_status(&conn, &config.connection_id, &IndexStatus::Building)
            .map_err(|e| format!("Failed to set building status: {e}"))?;
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
            .map_err(|e| format!("SQLite lock: {e}"))?;
        storage::get_signatures_for_connection(&conn, &config.connection_id)
            .map_err(|e| format!("Failed to load stored signatures: {e}"))?
    };

    // Partition tables: reuse stored DDL when signature matches AND a `table:`
    // chunk already exists in SQLite; otherwise queue for SHOW CREATE TABLE.
    let mut reused_ddls: Vec<TableDdlInput> = Vec::new();
    let mut to_fetch: Vec<(String, String)> = Vec::new();
    {
        let conn = sqlite_conn
            .lock()
            .map_err(|e| format!("SQLite lock: {e}"))?;
        for (db_name, table_name) in &all_tables {
            let current = current_signatures
                .get(&(db_name.clone(), table_name.clone()))
                .map(|s| s.as_str());
            let stored = stored_signatures
                .get(&(db_name.clone(), table_name.clone()))
                .map(|s| s.as_str());

            // We only need to check for chunk existence when the signatures
            // match — otherwise the decision is already `Refetch`.
            let chunk_key = table_chunk_key(db_name, table_name);
            let existing_chunk = if matches!((current, stored), (Some(c), Some(s)) if c == s) {
                storage::get_chunk_by_key(&conn, &config.connection_id, &chunk_key)
                    .map_err(|e| format!("Failed to look up existing chunk {chunk_key}: {e}"))?
            } else {
                None
            };
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
    let fetched_ddls = if to_fetch.is_empty() {
        Vec::new()
    } else {
        fetch_create_tables_parallel(
            mysql_pool,
            to_fetch,
            &config.connection_id,
            cancellation,
            on_progress,
            reused_ddls.len(),
            tables_total,
        )
        .await?
    };

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
    let (table_chunks, fk_chunks) = generate_all_chunks_with_row_counts(&all_ddl_inputs, &row_counts);
    tracing::debug!(
        profile_id = %config.connection_id,
        table_chunk_rows = table_chunks.len(),
        fk_chunk_rows = fk_chunks.len(),
        "schema_index build_index: generated table and FK chunk texts (DDL normalized, hashes computed)"
    );

    // 4a. Store FK edges in the adjacency table
    {
        let all_fk_edges: Vec<FkEdge> = fk_chunks
            .iter()
            .flat_map(|(_, _, _, fk)| {
                fk.columns.iter().zip(fk.ref_columns.iter()).map(|(src_col, dst_col)| FkEdge {
                    connection_id: config.connection_id.clone(),
                    src_db: fk.db_name.clone(),
                    src_tbl: fk.table_name.clone(),
                    src_col: src_col.clone(),
                    dst_db: fk.ref_db_name.clone(),
                    dst_tbl: fk.ref_table_name.clone(),
                    dst_col: dst_col.clone(),
                    constraint_name: fk.constraint_name.clone(),
                    on_delete: Some(fk.on_delete.clone()),
                    on_update: Some(fk.on_update.clone()),
                })
            })
            .collect();
        let conn = sqlite_conn
            .lock()
            .map_err(|e| format!("SQLite lock: {e}"))?;
        storage::replace_fk_edges_for_connection(&conn, &config.connection_id, &all_fk_edges)
            .map_err(|e| format!("Failed to store FK edges: {e}"))?;
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
            .map_err(|e| format!("SQLite lock: {e}"))?;
        storage::replace_segment_df_for_connection(&conn, &config.connection_id, &entries)
            .map_err(|e| format!("Failed to store segment DF: {e}"))?;
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
        let truncated = create_view_ddl.char_indices().nth(500).map_or(create_view_ddl.as_str(), |(i, _)| &create_view_ddl[..i]);
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
        let chunk_type = if routine_type == "PROCEDURE" {
            ChunkType::Procedure
        } else {
            ChunkType::Function
        };
        let type_lower = chunk_type.as_str();
        let key = format!("{type_lower}:{db}.{routine_name}");
        let hash = compute_hash(create_ddl);
        let truncated = create_ddl.char_indices().nth(500).map_or(create_ddl.as_str(), |(i, _)| &create_ddl[..i]);
        let text_for_emb = format!(
            "{routine_type} `{db}`.`{routine_name}`: {truncated}"
        );
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
            .map_err(|e| format!("SQLite lock: {e}"))?;
        storage::get_chunk_hashes(&conn, &config.connection_id)
            .map_err(|e| format!("Failed to get chunk hashes: {e}"))?
    };

    let new_for_diff: Vec<(String, String, String)> = all_new
        .iter()
        .map(|c| (c.chunk_key.clone(), c.ddl_text.clone(), c.ddl_hash.clone()))
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
            .map_err(|e| format!("SQLite lock: {e}"))?;
        for key in &to_delete_keys {
            storage::delete_chunk_by_key(&conn, &config.connection_id, key)
                .map_err(|e| format!("Failed to delete chunk {key}: {e}"))?;
        }
    }

    // 6. Embed new/changed chunks in batches
    let chunks_to_embed: Vec<_> = all_new
        .iter()
        .filter(|c| needs_embed_keys.contains(&c.chunk_key))
        .collect();

    let total_to_embed = chunks_to_embed.len();
    let staged_at = Utc::now().to_rfc3339();
    let staged_table_chunks = chunks_to_embed
        .iter()
        .filter(|c| matches!(&c.chunk_type, ChunkType::Table))
        .count();
    let staged_fk_chunks = chunks_to_embed
        .iter()
        .filter(|c| matches!(&c.chunk_type, ChunkType::Fk))
        .count();
    let unchanged_chunks = all_new.len().saturating_sub(total_to_embed);

    tracing::info!(
        profile_id = %config.connection_id,
        staged_at = %staged_at,
        total_chunks_current = all_new.len(),
        staged_for_embedding = total_to_embed,
        staged_table_chunks,
        staged_fk_chunks,
        unchanged_chunks_skipped = unchanged_chunks,
        obsolete_chunks_removed = to_delete_keys.len(),
        "schema_index build_index: diff complete — staged chunks for embedding (new or hash-changed); skipped unchanged"
    );

    if tracing::enabled!(tracing::Level::DEBUG) && !chunks_to_embed.is_empty() {
        let keys_preview: Vec<(&str, &str)> = chunks_to_embed
            .iter()
            .map(|c| (c.chunk_key.as_str(), c.chunk_type.as_str()))
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
            .filter(|c| matches!(&c.chunk_type, ChunkType::Table))
            .map(|c| c.chunk_key.as_str())
            .collect();
        let total_table_chunks = table_chunks.len();
        total_table_chunks - table_keys_to_embed.len()
    };
    let mut tables_done: usize = unchanged_tables;
    let total_embed_batches = if total_to_embed == 0 {
        0
    } else {
        (total_to_embed + EMBED_BATCH_SIZE - 1) / EMBED_BATCH_SIZE
    };
    let mut embed_batches_done: usize = 0;
    let mut finalizing_started = false;
    let mut finalizing_done: usize = 0;
    let mut finalizing_total: usize = 0;

    // Emit an initial embedding/finalizing progress event so the UI can switch
    // from "Reading schema..." immediately. If table progress is already
    // complete (e.g. only FK chunks remain), report Finalizing right away
    // with a separate step counter.
    if let Some(cb) = on_progress {
        if tables_done >= tables_total {
            finalizing_started = true;
            // Remaining embedding batches + signature upsert + metadata finalize.
            finalizing_total = total_embed_batches + 2;
            cb(BuildProgress {
                profile_id: config.connection_id.clone(),
                phase: BuildPhase::Finalizing,
                tables_done: finalizing_done,
                tables_total: finalizing_total,
            });
        } else {
            cb(BuildProgress {
                profile_id: config.connection_id.clone(),
                phase: BuildPhase::Embedding,
                tables_done,
                tables_total,
            });
        }
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
            .map(|c| {
                c.text_for_embedding.as_ref().unwrap_or(&c.ddl_text).clone()
            })
            .collect();

        let batch_keys: Vec<&str> = batch.iter().map(|c| c.chunk_key.as_str()).collect();
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
                .map_err(|e| format!("Embedding failed: {e}"))?;
        tracing::debug!(
            profile_id = %config.connection_id,
            batch_start,
            elapsed_ms = embed_started.elapsed().as_millis() as u64,
            vectors_returned = embeddings.len(),
            vector_dims = embeddings.first().map(|v| v.len()).unwrap_or(0),
            "schema_index build_index: embedding API batch finished"
        );

        // Store in SQLite with batched transactions
        {
            let conn = sqlite_conn
                .lock()
                .map_err(|e| format!("SQLite lock: {e}"))?;
            let mut tx_count = 0;
            conn.execute_batch("BEGIN")
                .map_err(|e| format!("BEGIN: {e}"))?;

            for (i, chunk) in
                batch.iter().enumerate()
            {
                let embedding = &embeddings[i];

                // Check if chunk already exists (update vs insert)
                let existing = storage::get_chunk_by_key(&conn, &config.connection_id, &chunk.chunk_key)
                    .map_err(|e| format!("Failed to lookup chunk: {e}"))?;

                if let Some(existing_chunk) = existing {
                    storage::update_chunk_embedding(
                        &conn,
                        existing_chunk.id,
                        &chunk.ddl_text,
                        &chunk.ddl_hash,
                        &config.model_id,
                        embedding,
                        &config.connection_id,
                        chunk.text_for_embedding.as_deref(),
                        chunk.row_count_approx,
                    )
                    .map_err(|e| format!("Failed to update chunk: {e}"))?;
                } else {
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
                        .map_err(|e| format!("Failed to insert chunk: {e}"))?;
                }

                tx_count += 1;
                if tx_count >= SQLITE_COMMIT_BATCH {
                    conn.execute_batch("COMMIT")
                        .map_err(|e| format!("COMMIT: {e}"))?;
                    conn.execute_batch("BEGIN")
                        .map_err(|e| format!("BEGIN: {e}"))?;
                    tx_count = 0;
                }
            }

            conn.execute_batch("COMMIT")
                .map_err(|e| format!("COMMIT: {e}"))?;
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
            .filter(|c| matches!(&c.chunk_type, ChunkType::Table))
            .count();
        tables_done += table_chunks_in_batch;
        embed_batches_done += 1;
        if let Some(cb) = on_progress {
            let mut entered_finalizing_this_batch = false;

            if !finalizing_started {
                if tables_done >= tables_total {
                    finalizing_started = true;
                    entered_finalizing_this_batch = true;
                    // Remaining embedding batches after this one + two SQLite
                    // finalization steps (signatures + metadata status update).
                    finalizing_total = total_embed_batches.saturating_sub(embed_batches_done) + 2;
                    finalizing_done = 0;
                    cb(BuildProgress {
                        profile_id: config.connection_id.clone(),
                        phase: BuildPhase::Finalizing,
                        tables_done: finalizing_done,
                        tables_total: finalizing_total,
                    });
                } else {
                    cb(BuildProgress {
                        profile_id: config.connection_id.clone(),
                        phase: BuildPhase::Embedding,
                        tables_done,
                        tables_total,
                    });
                }
            }

            if finalizing_started && !entered_finalizing_this_batch {
                finalizing_done = (finalizing_done + 1).min(finalizing_total);
                cb(BuildProgress {
                    profile_id: config.connection_id.clone(),
                    phase: BuildPhase::Finalizing,
                    tables_done: finalizing_done,
                    tables_total: finalizing_total,
                });
            }
        }
    }

    // 7a. Persist current signatures for every table that now has a chunk so
    // the next build can short-circuit unchanged tables. Also drop signatures
    // for tables that no longer exist in the bulk enumeration.
    {
        let conn = sqlite_conn
            .lock()
            .map_err(|e| format!("SQLite lock: {e}"))?;

        let sig_rows: Vec<(String, String, String)> = current_signatures
            .iter()
            .map(|((db, tbl), sig)| (db.clone(), tbl.clone(), sig.clone()))
            .collect();
        conn.execute_batch("BEGIN")
            .map_err(|e| format!("BEGIN signatures: {e}"))?;
        storage::upsert_signatures(&conn, &config.connection_id, &sig_rows)
            .map_err(|e| format!("Failed to upsert signatures: {e}"))?;

        // Remove signatures for tables no longer present. `current_signatures`
        // already covers only existing tables, so stored signatures whose key
        // isn't in `current_signatures` are stale.
        let current_keys: std::collections::HashSet<(String, String)> =
            current_signatures.keys().cloned().collect();
        for (db, tbl) in stored_signatures.keys() {
            if !current_keys.contains(&(db.clone(), tbl.clone())) {
                storage::delete_signature(&conn, &config.connection_id, db, tbl)
                    .map_err(|e| format!("Failed to delete stale signature: {e}"))?;
            }
        }
        conn.execute_batch("COMMIT")
            .map_err(|e| format!("COMMIT signatures: {e}"))?;
    }

    if let Some(cb) = on_progress {
        if finalizing_started {
            finalizing_done = (finalizing_done + 1).min(finalizing_total);
            cb(BuildProgress {
                profile_id: config.connection_id.clone(),
                phase: BuildPhase::Finalizing,
                tables_done: finalizing_done,
                tables_total: finalizing_total,
            });
        }
    }

    // 8. Set status = "ready", update last_build_at
    {
        let conn = sqlite_conn
            .lock()
            .map_err(|e| format!("SQLite lock: {e}"))?;
        let now = chrono::Utc::now().to_rfc3339();
        let meta = storage::get_index_meta(&conn, &config.connection_id)
            .map_err(|e| format!("Failed to get index meta: {e}"))?;
        if let Some(mut m) = meta {
            m.status = IndexStatus::Ready;
            m.last_build_at = Some(now);
            storage::upsert_index_meta(&conn, &m)
                .map_err(|e| format!("Failed to update index meta: {e}"))?;
        }
    }

    if let Some(cb) = on_progress {
        if finalizing_started {
            finalizing_done = (finalizing_done + 1).min(finalizing_total);
            cb(BuildProgress {
                profile_id: config.connection_id.clone(),
                phase: BuildPhase::Finalizing,
                tables_done: finalizing_done,
                tables_total: finalizing_total,
            });
        }
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
            .map_err(|e| format!("SQLite lock: {e}"))?;
        for (db, tbl) in tables {
            storage::delete_chunks_by_table(&conn, &config.connection_id, db, tbl)
                .map_err(|e| format!("Failed to delete chunks for {db}.{tbl}: {e}"))?;
            storage::delete_signature(&conn, &config.connection_id, db, tbl)
                .map_err(|e| format!("Failed to delete signature for {db}.{tbl}: {e}"))?;
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
            Err(e) => {
                tracing::warn!(
                    db_name = %db,
                    table_name = %tbl,
                    error = %e,
                    "Table not found during rebuild (likely dropped), skipping"
                );
                // Skip this table — chunks were already deleted above
                continue;
            }
        }
    }

    // 3. Generate new table + FK chunks
    let (table_chunks, fk_chunks) = generate_all_chunks(&ddl_inputs);

    // 3a. Store FK edges for rebuilt tables
    {
        let conn = sqlite_conn
            .lock()
            .map_err(|e| format!("SQLite lock: {e}"))?;
        for tc in &table_chunks {
            // Collect edges for this table from fk_chunks
            let edges: Vec<FkEdge> = fk_chunks
                .iter()
                .filter(|(_, _, _, fk)| fk.db_name == tc.db_name && fk.table_name == tc.table_name)
                .flat_map(|(_, _, _, fk)| {
                    fk.columns.iter().zip(fk.ref_columns.iter()).map(|(src_col, dst_col)| FkEdge {
                        connection_id: config.connection_id.clone(),
                        src_db: fk.db_name.clone(),
                        src_tbl: fk.table_name.clone(),
                        src_col: src_col.clone(),
                        dst_db: fk.ref_db_name.clone(),
                        dst_tbl: fk.ref_table_name.clone(),
                        dst_col: dst_col.clone(),
                        constraint_name: fk.constraint_name.clone(),
                        on_delete: Some(fk.on_delete.clone()),
                        on_update: Some(fk.on_update.clone()),
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
            .map_err(|e| format!("Failed to store FK edges for {}.{}: {e}", tc.db_name, tc.table_name))?;
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
        .filter(|c| matches!(&c.chunk_type, ChunkType::Table))
        .count();
    let staged_fks = embed_items
        .iter()
        .filter(|c| matches!(&c.chunk_type, ChunkType::Fk))
        .count();
    tracing::info!(
        profile_id = %config.connection_id,
        staged_at = %staged_at,
        chunks_to_embed = embed_items.len(),
        staged_table_chunks = staged_tables,
        staged_fk_chunks = staged_fks,
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
            .map(|c| {
                c.text_for_embedding.as_ref().unwrap_or(&c.ddl_text).clone()
            })
            .collect();
        let batch_keys: Vec<&str> = batch.iter().map(|c| c.chunk_key.as_str()).collect();
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
                .map_err(|e| format!("Embedding failed: {e}"))?;
        tracing::debug!(
            profile_id = %config.connection_id,
            batch_start,
            elapsed_ms = embed_started.elapsed().as_millis() as u64,
            vectors_returned = embeddings.len(),
            "schema_index rebuild_tables: embedding API batch finished"
        );

        let conn = sqlite_conn
            .lock()
            .map_err(|e| format!("SQLite lock: {e}"))?;
        conn.execute_batch("BEGIN")
            .map_err(|e| format!("BEGIN: {e}"))?;

        for (i, chunk) in
            batch.iter().enumerate()
        {
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
                embedding: embeddings[i].clone(),
                text_for_embedding: chunk.text_for_embedding.clone(),
                row_count_approx: chunk.row_count_approx,
            };
            storage::insert_chunk(&conn, &insert)
                .map_err(|e| format!("Failed to insert chunk: {e}"))?;
        }

        conn.execute_batch("COMMIT")
            .map_err(|e| format!("COMMIT: {e}"))?;
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
            .map_err(|e| format!("SQLite lock: {e}"))?;
        storage::get_index_meta(&conn, &config.connection_id)
            .map_err(|e| format!("Failed to get index meta: {e}"))?
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
            .map_err(|e| format!("Failed to detect embedding dimension: {e}"))?;

            let conn = sqlite_conn
                .lock()
                .map_err(|e| format!("SQLite lock: {e}"))?;
            // Delete chunks BEFORE dropping vec table, because delete_all_chunks
            // needs to remove rows from the vec table first.
            storage::delete_all_chunks(&conn, &config.connection_id)
                .map_err(|e| format!("Failed to delete chunks: {e}"))?;
            storage::drop_vec_table(&conn, &config.connection_id)
                .map_err(|e| format!("Failed to drop vec table: {e}"))?;
            storage::create_vec_table(&conn, &config.connection_id, dimension)
                .map_err(|e| format!("Failed to create vec table: {e}"))?;

            let new_meta = IndexMeta {
                connection_id: config.connection_id.clone(),
                model_id: config.model_id.clone(),
                embedding_dimension: dimension as i64,
                last_build_at: None,
                status: IndexStatus::Building,
                vec_schema_version: Some(storage::VEC_SCHEMA_VERSION as i64),
            };
            storage::upsert_index_meta(&conn, &new_meta)
                .map_err(|e| format!("Failed to upsert index meta: {e}"))?;
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
                .map_err(|e| format!("SQLite lock: {e}"))?;
            storage::delete_all_chunks(&conn, &config.connection_id)
                .map_err(|e| format!("Failed to delete chunks: {e}"))?;
            storage::drop_vec_table(&conn, &config.connection_id)
                .map_err(|e| format!("Failed to drop vec table: {e}"))?;
            storage::create_vec_table(&conn, &config.connection_id, dimension)
                .map_err(|e| format!("Failed to create vec table: {e}"))?;

            let new_meta = IndexMeta {
                connection_id: config.connection_id.clone(),
                model_id: config.model_id.clone(),
                embedding_dimension: dimension as i64,
                last_build_at: None,
                status: IndexStatus::Building,
                vec_schema_version: Some(storage::VEC_SCHEMA_VERSION as i64),
            };
            storage::upsert_index_meta(&conn, &new_meta)
                .map_err(|e| format!("Failed to upsert index meta: {e}"))?;
        }
        None => {
            // No meta yet — detect dimension and create
            let dimension = embeddings::detect_embedding_dimension(
                http_client,
                &config.endpoint,
                &config.model_id,
            )
            .await
            .map_err(|e| format!("Failed to detect embedding dimension: {e}"))?;

            let conn = sqlite_conn
                .lock()
                .map_err(|e| format!("SQLite lock: {e}"))?;
            storage::create_vec_table(&conn, &config.connection_id, dimension)
                .map_err(|e| format!("Failed to create vec table: {e}"))?;

            let new_meta = IndexMeta {
                connection_id: config.connection_id.clone(),
                model_id: config.model_id.clone(),
                embedding_dimension: dimension as i64,
                last_build_at: None,
                status: IndexStatus::Building,
                vec_schema_version: Some(storage::VEC_SCHEMA_VERSION as i64),
            };
            storage::upsert_index_meta(&conn, &new_meta)
                .map_err(|e| format!("Failed to upsert index meta: {e}"))?;
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
        // Skip lines that start with constraint keywords
        if trimmed.to_uppercase().starts_with("PRIMARY")
            || trimmed.to_uppercase().starts_with("KEY")
            || trimmed.to_uppercase().starts_with("UNIQUE")
            || trimmed.to_uppercase().starts_with("INDEX")
            || trimmed.to_uppercase().starts_with("CONSTRAINT")
            || trimmed.to_uppercase().starts_with("FULLTEXT")
            || trimmed.to_uppercase().starts_with("SPATIAL")
            || trimmed.starts_with(')')
            || trimmed.to_uppercase().starts_with("CREATE")
        {
            continue;
        }
        if let Some(cap) = re.captures(trimmed) {
            let name = cap[1].to_string();
            let typ = cap[2].to_string();
            let comment = re_comment
                .captures(trimmed)
                .map(|c| c[1].to_string());
            cols.push((name, typ, comment));
        }
    }
    cols
}

/// Parse primary key column names from a `CREATE TABLE` DDL.
pub fn parse_pk_from_ddl(ddl: &str) -> Vec<String> {
    static PK_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = PK_REGEX.get_or_init(|| {
        Regex::new(r"(?i)PRIMARY\s+KEY\s+\(([^)]+)\)").expect("valid PK regex")
    });
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
        .map(|c| c[1].to_string())
        .collect()
}

/// Generate table + FK chunks from DDL inputs, enriched with `text_for_embedding`.
///
/// `row_counts` provides approximate row counts from `information_schema.TABLES`.
///
/// Returns:
/// - table_chunks: `Vec<GeneratedTableChunk>`
/// - fk_chunks: `Vec<(chunk_key, fk_text, fk_hash, FkInput)>`
/// - fk_edges: `Vec<FkEdge>` — flat list of all FK edges for bulk storage
pub fn generate_all_chunks(
    ddl_inputs: &[TableDdlInput],
) -> (
    Vec<GeneratedTableChunk>,
    Vec<(String, String, String, FkInput)>,
) {
    generate_all_chunks_with_row_counts(ddl_inputs, &HashMap::new())
}

/// Like [`generate_all_chunks`] but accepts optional row counts.
pub fn generate_all_chunks_with_row_counts(
    ddl_inputs: &[TableDdlInput],
    row_counts: &HashMap<(String, String), i64>,
) -> (
    Vec<GeneratedTableChunk>,
    Vec<(String, String, String, FkInput)>,
) {
    let mut table_chunks = Vec::new();
    let mut fk_chunks = Vec::new();

    for input in ddl_inputs {
        let raw_ddl = &input.create_table_sql;

        // Parse structural info from DDL
        let cols = parse_columns_from_ddl(raw_ddl);
        let pk_cols = parse_pk_from_ddl(raw_ddl);
        let unique_idx = parse_unique_indexes_from_ddl(raw_ddl);
        let table_comment = extract_table_comment(raw_ddl);
        let fks = parse_fks_from_ddl(&input.db_name, &input.table_name, raw_ddl);
        let row_count = row_counts
            .get(&(input.db_name.clone(), input.table_name.clone()))
            .copied();

        // Convert FkInputs to FkEdges for text_for_embedding
        let fk_edges: Vec<FkEdge> = fks
            .iter()
            .flat_map(|fk| {
                fk.columns
                    .iter()
                    .zip(fk.ref_columns.iter())
                    .map(|(src_col, dst_col)| FkEdge {
                        connection_id: String::new(), // filled in by caller
                        src_db: fk.db_name.clone(),
                        src_tbl: fk.table_name.clone(),
                        src_col: src_col.clone(),
                        dst_db: fk.ref_db_name.clone(),
                        dst_tbl: fk.ref_table_name.clone(),
                        dst_col: dst_col.clone(),
                        constraint_name: fk.constraint_name.clone(),
                        on_delete: Some(fk.on_delete.clone()),
                        on_update: Some(fk.on_update.clone()),
                    })
                    .collect::<Vec<_>>()
            })
            .collect();

        // Generate rich embedding text
        let text_for_embedding = generate_text_for_embedding(
            &input.db_name,
            &input.table_name,
            table_comment.as_deref(),
            &cols,
            &pk_cols,
            &unique_idx,
            &fk_edges,
            row_count,
        );

        // Table chunk: compact DDL (preserving comments for LLM) with optional row count annotation
        let compacted = compact_ddl_for_llm(raw_ddl);
        let mut compacted = normalize_table_ddl(&input.db_name, &input.table_name, &compacted);
        if let Some(count) = row_count {
            compacted = format!("{compacted}\n-- approximate rows: {count}");
        }
        let hash = compute_hash(&compacted);
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
        for fk in fks {
            let fk_text = generate_fk_chunk_text(&fk);
            let fk_hash = compute_hash(&fk_text);
            let fk_key = fk_chunk_key(&fk.db_name, &fk.table_name, &fk.constraint_name);
            fk_chunks.push((fk_key, fk_text, fk_hash, fk));
        }
    }

    (table_chunks, fk_chunks)
}

// ── MySQL fetch helpers (excluded from coverage builds) ──────────────────

/// MySQL system schemas that should never be indexed.
const SYSTEM_SCHEMAS: &[&str] = &["information_schema", "mysql", "performance_schema", "sys"];

/// Concurrency for parallel `SHOW CREATE TABLE` fetches. Must stay at or below
/// the MySQL pool's `max_connections` so foreground queries aren't starved.
pub const SHOW_CREATE_TABLE_CONCURRENCY: usize = 8;

/// Enumerate every user (non-system) base table in one `information_schema`
/// round-trip. Returns `(schema, table)` pairs sorted by `(schema, table)`.
#[cfg(not(coverage))]
async fn fetch_all_user_tables(
    pool: &sqlx::MySqlPool,
) -> Result<Vec<(String, String)>, String> {
    let rows = sqlx::query(
        "SELECT TABLE_SCHEMA, TABLE_NAME \
         FROM information_schema.TABLES \
         WHERE TABLE_TYPE = 'BASE TABLE' \
           AND TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys') \
         ORDER BY TABLE_SCHEMA, TABLE_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to enumerate user tables: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let schema = decode_string(row, 0).map_err(|e| format!("schema: {e}"))?;
        let table = decode_string(row, 1).map_err(|e| format!("table: {e}"))?;
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
fn decode_string(row: &sqlx::mysql::MySqlRow, idx: usize) -> Result<String, sqlx::Error> {
    use sqlx::Row;
    row.try_get::<String, _>(idx).or_else(|_| {
        row.try_get::<Vec<u8>, _>(idx)
            .map(|b| String::from_utf8_lossy(&b).into_owned())
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

    let system_filter = "TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys')";

    let cols_sql = format!(
        "SELECT TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, \
                IS_NULLABLE, IFNULL(COLUMN_DEFAULT, ''), EXTRA, COLUMN_KEY, \
                IFNULL(COLUMN_COMMENT, ''), IFNULL(CHARACTER_SET_NAME, ''), IFNULL(COLLATION_NAME, '') \
         FROM information_schema.COLUMNS \
         WHERE {system_filter} \
         ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
    );

    let idx_sql = format!(
        "SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, \
                NON_UNIQUE, IFNULL(INDEX_TYPE, '') \
         FROM information_schema.STATISTICS \
         WHERE {system_filter} \
         ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX"
    );

    let fks_sql = format!(
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
    let col_rows = sqlx::query(&cols_sql)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch column signatures: {e}"))?;
    for row in &col_rows {
        let schema = decode_string(row, 0).map_err(|e| format!("schema: {e}"))?;
        if SYSTEM_SCHEMAS.contains(&schema.to_lowercase().as_str()) {
            continue;
        }
        let table = decode_string(row, 1).map_err(|e| format!("table: {e}"))?;
        let ordinal: i64 = row
            .try_get::<i64, _>(2)
            .or_else(|_| row.try_get::<u64, _>(2).map(|v| v as i64))
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

        let hasher = hashers
            .entry((schema.clone(), table.clone()))
            .or_insert_with(Sha256::new);
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
    let idx_rows = sqlx::query(&idx_sql)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch index signatures: {e}"))?;
    for row in &idx_rows {
        let schema = decode_string(row, 0).map_err(|e| format!("schema: {e}"))?;
        if SYSTEM_SCHEMAS.contains(&schema.to_lowercase().as_str()) {
            continue;
        }
        let table = decode_string(row, 1).map_err(|e| format!("table: {e}"))?;
        let idx_name = decode_string(row, 2).unwrap_or_default();
        let seq: i64 = row
            .try_get::<i64, _>(3)
            .or_else(|_| row.try_get::<u64, _>(3).map(|v| v as i64))
            .unwrap_or(0);
        let col_name = decode_string(row, 4).unwrap_or_default();
        let non_unique: i64 = row
            .try_get::<i64, _>(5)
            .or_else(|_| row.try_get::<u64, _>(5).map(|v| v as i64))
            .unwrap_or(0);
        let idx_type = decode_string(row, 6).unwrap_or_default();

        let hasher = hashers
            .entry((schema.clone(), table.clone()))
            .or_insert_with(Sha256::new);
        hasher.update(b"I|");
        hasher.update(idx_name.as_bytes());
        hasher.update(b"|");
        hasher.update(seq.to_le_bytes());
        hasher.update(b"|");
        hasher.update(col_name.as_bytes());
        hasher.update(b"|");
        hasher.update(non_unique.to_le_bytes());
        hasher.update(b"|");
        hasher.update(idx_type.as_bytes());
        hasher.update(b"\x1e");
    }
    tracing::debug!(
        rows = idx_rows.len(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        "schema_index signatures: STATISTICS bulk query complete"
    );

    // Foreign keys
    let started = Instant::now();
    let fk_rows = sqlx::query(&fks_sql)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch FK signatures: {e}"))?;
    for row in &fk_rows {
        let schema = decode_string(row, 0).map_err(|e| format!("schema: {e}"))?;
        if SYSTEM_SCHEMAS.contains(&schema.to_lowercase().as_str()) {
            continue;
        }
        let table = decode_string(row, 1).map_err(|e| format!("table: {e}"))?;
        let constraint = decode_string(row, 2).unwrap_or_default();
        let ord: i64 = row
            .try_get::<i64, _>(3)
            .or_else(|_| row.try_get::<u64, _>(3).map(|v| v as i64))
            .unwrap_or(0);
        let col_name = decode_string(row, 4).unwrap_or_default();
        let ref_schema = decode_string(row, 5).unwrap_or_default();
        let ref_table = decode_string(row, 6).unwrap_or_default();
        let ref_col = decode_string(row, 7).unwrap_or_default();
        let upd = decode_string(row, 8).unwrap_or_default();
        let del = decode_string(row, 9).unwrap_or_default();

        let hasher = hashers
            .entry((schema.clone(), table.clone()))
            .or_insert_with(Sha256::new);
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
        rows = fk_rows.len(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        "schema_index signatures: KEY_COLUMN_USAGE bulk query complete"
    );

    let out = hashers
        .into_iter()
        .map(|(k, hasher)| (k, format!("{:x}", hasher.finalize())))
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
    .map_err(|e| format!("Failed to fetch row counts: {e}"))?;

    let mut out = HashMap::with_capacity(rows.len());
    for row in &rows {
        let schema = decode_string(row, 0).map_err(|e| format!("schema: {e}"))?;
        if SYSTEM_SCHEMAS.contains(&schema.to_lowercase().as_str()) {
            continue;
        }
        let table = decode_string(row, 1).map_err(|e| format!("table: {e}"))?;
        let count: i64 = row
            .try_get::<i64, _>(2)
            .or_else(|_| row.try_get::<u64, _>(2).map(|v| v as i64))
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
    use sqlx::Row;

    let rows = sqlx::query(
        "SELECT TABLE_SCHEMA, TABLE_NAME \
         FROM information_schema.TABLES \
         WHERE TABLE_TYPE = 'VIEW' \
           AND TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys') \
         ORDER BY TABLE_SCHEMA, TABLE_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to enumerate user views: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let schema = decode_string(row, 0).map_err(|e| format!("schema: {e}"))?;
        if SYSTEM_SCHEMAS.contains(&schema.to_lowercase().as_str()) {
            continue;
        }
        let view_name = decode_string(row, 1).map_err(|e| format!("view: {e}"))?;

        let safe_db = safe_identifier(&schema)
            .map_err(|e| format!("Invalid db name {schema}: {e}"))?;
        let safe_view = safe_identifier(&view_name)
            .map_err(|e| format!("Invalid view name {view_name}: {e}"))?;
        let sql = format!("SHOW CREATE VIEW {safe_db}.{safe_view}");

        match sqlx::query(&sql).fetch_optional(pool).await {
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
            Err(e) => {
                tracing::warn!(
                    view = %view_name,
                    db = %schema,
                    error = %e,
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
    use sqlx::Row;

    let rows = sqlx::query(
        "SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE \
         FROM information_schema.ROUTINES \
         WHERE ROUTINE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys') \
         ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to enumerate user routines: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let schema = decode_string(row, 0).map_err(|e| format!("schema: {e}"))?;
        if SYSTEM_SCHEMAS.contains(&schema.to_lowercase().as_str()) {
            continue;
        }
        let routine_name = decode_string(row, 1).map_err(|e| format!("routine: {e}"))?;
        let routine_type = decode_string(row, 2).map_err(|e| format!("type: {e}"))?;

        let safe_db = safe_identifier(&schema)
            .map_err(|e| format!("Invalid db name {schema}: {e}"))?;
        let safe_name = safe_identifier(&routine_name)
            .map_err(|e| format!("Invalid routine name {routine_name}: {e}"))?;

        let show_cmd = if routine_type.to_uppercase() == "PROCEDURE" {
            format!("SHOW CREATE PROCEDURE {safe_db}.{safe_name}")
        } else {
            format!("SHOW CREATE FUNCTION {safe_db}.{safe_name}")
        };

        match sqlx::query(&show_cmd).fetch_optional(pool).await {
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
            Err(e) => {
                tracing::warn!(
                    routine = %routine_name,
                    db = %schema,
                    error = %e,
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
    use sqlx::Row;

    let safe_db = safe_identifier(database)?;
    let safe_table = safe_identifier(table)?;
    let sql = format!("SHOW CREATE TABLE {safe_db}.{safe_table}");
    let row = sqlx::query(&sql)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("SHOW CREATE TABLE {database}.{table} failed: {e}"))?
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

    let results: Vec<Result<TableDdlInput, String>> = stream::iter(targets.into_iter())
        .map(|(db, tbl)| {
            let completed = Arc::clone(&completed);
            let profile_id = profile_id.to_string();
            async move {
                let per_started = Instant::now();
                let ddl = fetch_create_table(pool, &db, &tbl).await?;
                let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                if done % 10 == 0 || done == total_to_fetch {
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
    for r in results {
        out.push(r?);
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
