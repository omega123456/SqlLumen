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
    BuildConfig, BuildProgress, BuildResult, ChunkInsert, ChunkType, FkInput, IndexMeta,
    IndexStatus, ProgressCallback, TableDdlInput,
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
/// `DEFAULT CHARSET=...`, `COLLATE=...` clauses that appear after the closing
/// `)` of the column list.
///
/// **Preserves** the table-level `COMMENT='...'` clause: if present, it is
/// reattached to the closing `)` so the documentation signal (arguably the
/// single highest-signal semantic field on a MySQL table) survives into the
/// embedding input. See plan item A1.
pub fn compact_ddl(create_table_sql: &str) -> String {
    static AUTO_INCREMENT_REGEX: OnceLock<Regex> = OnceLock::new();
    static TRAILING_CLAUSE_REGEX: OnceLock<Regex> = OnceLock::new();
    static WHITESPACE_REGEX: OnceLock<Regex> = OnceLock::new();

    let re_auto_inc = AUTO_INCREMENT_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\s*AUTO_INCREMENT\s*=\s*\d+").expect("valid auto_increment regex")
    });
    let text = re_auto_inc.replace_all(create_table_sql, "");

    // Extract the table-level COMMENT='...' clause (if any) before stripping
    // trailing clauses, so it can be reattached below.
    let table_comment = extract_table_comment(&text);

    // Remove trailing engine/storage clauses after the last `)`
    // These are: ENGINE=..., ROW_FORMAT=..., DEFAULT CHARSET=..., COLLATE=...,
    // COMMENT='...', /*!...*/ comment tokens.
    let re_trailing = TRAILING_CLAUSE_REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)\)\s*(ENGINE\s*=\s*\S+|ROW_FORMAT\s*=\s*\S+|DEFAULT\s+CHARSET\s*=\s*\S+|COLLATE\s*=\s*\S+|COMMENT\s*=\s*'(?:[^']|'')*'|/\*![^*]*\*/|\s)*\s*;?\s*$",
        )
        .expect("valid trailing clause regex")
    });

    let text = if let Some(mat) = re_trailing.find(&text) {
        let paren_pos = text[..mat.start() + 1].rfind(')');
        match paren_pos {
            Some(pos) => format!("{})", &text[..pos]),
            None => text.to_string(),
        }
    } else {
        text.to_string()
    };

    let re_ws =
        WHITESPACE_REGEX.get_or_init(|| Regex::new(r"\s+").expect("valid whitespace regex"));
    let text = re_ws.replace_all(&text, " ");
    let text = text.trim().to_string();

    match table_comment {
        Some(comment) if !comment.is_empty() => {
            format!("{text} COMMENT='{}'", comment.replace('\'', "''"))
        }
        _ => text,
    }
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
///
/// Includes:
/// - parent → child phrasing (original sentence)
/// - child ← parent phrasing ("Table X is referenced by Y on ...") so that
///   queries written from the referenced-table side still match (plan A6)
/// - an explicit JOIN hint line so JOIN-flavored queries embed against the
///   same chunk (plan A7)
pub fn generate_fk_chunk_text(fk: &FkInput) -> String {
    let cols = fk.columns.join(", ");
    let ref_cols = fk.ref_columns.join(", ");

    let join_pairs: Vec<String> = fk
        .columns
        .iter()
        .zip(fk.ref_columns.iter())
        .map(|(src, tgt)| {
            format!(
                "{db}.{table}.{src} = {ref_db}.{ref_table}.{tgt}",
                db = fk.db_name,
                table = fk.table_name,
                src = src,
                ref_db = fk.ref_db_name,
                ref_table = fk.ref_table_name,
                tgt = tgt,
            )
        })
        .collect();

    let parent_child = format!(
        "Table {db}.{table} has a foreign key ({cols}) that references {ref_db}.{ref_table}({ref_cols}) ON DELETE {on_delete} ON UPDATE {on_update}",
        db = fk.db_name,
        table = fk.table_name,
        ref_db = fk.ref_db_name,
        ref_table = fk.ref_table_name,
        on_delete = fk.on_delete,
        on_update = fk.on_update,
    );

    let reverse = format!(
        "Table {ref_db}.{ref_table} is referenced by {db}.{table} on ({cols}).",
        db = fk.db_name,
        table = fk.table_name,
        ref_db = fk.ref_db_name,
        ref_table = fk.ref_table_name,
    );

    let join_hint = format!(
        "Join {db}.{table} to {ref_db}.{ref_table} ON {pairs}.",
        db = fk.db_name,
        table = fk.table_name,
        ref_db = fk.ref_db_name,
        ref_table = fk.ref_table_name,
        pairs = join_pairs.join(" AND "),
    );

    format!("{parent_child}. {reverse} {join_hint}")
}

/// Compute a SHA-256 hex digest of the given text.
pub fn compute_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Chunk key for a table DDL chunk.
pub fn table_chunk_key(db_name: &str, table_name: &str) -> String {
    format!("table:{db_name}.{table_name}")
}

/// Chunk key for a foreign key chunk.
pub fn fk_chunk_key(db_name: &str, table_name: &str, constraint_name: &str) -> String {
    format!("fk:{db_name}.{table_name}:{constraint_name}")
}

/// Chunk key for a natural-language summary chunk (see plan A2).
pub fn summary_chunk_key(db_name: &str, table_name: &str) -> String {
    format!("summary:{db_name}.{table_name}")
}

// ── Summary chunk (prose) ────────────────────────────────────────────────

/// Describe a table column parsed from the CREATE TABLE statement; used to
/// compose the prose summary chunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SummaryColumn {
    pub name: String,
    pub data_type: String,
    pub not_null: bool,
    pub comment: Option<String>,
}

/// Intermediate structure collected from a CREATE TABLE statement that is used
/// to render a natural-language summary chunk (plan item A2).
#[derive(Debug, Clone, Default)]
pub struct TableSummary {
    pub table_comment: Option<String>,
    pub columns: Vec<SummaryColumn>,
    pub primary_key: Vec<String>,
    pub unique_keys: Vec<Vec<String>>,
    pub indexes: Vec<Vec<String>>,
    pub foreign_keys: Vec<FkInput>,
}

/// Parse a raw CREATE TABLE statement into the subset of information used to
/// render a prose summary chunk.
///
/// This is a best-effort regex/line-based parser that targets the shape emitted
/// by MySQL's `SHOW CREATE TABLE`. It is intentionally lenient — any field it
/// fails to extract simply drops out of the rendered summary rather than
/// breaking the build.
pub fn parse_table_summary(db_name: &str, table_name: &str, ddl: &str) -> TableSummary {
    let table_comment = extract_table_comment(ddl);

    let (col_block, constraint_lines) = split_columns_and_constraints(ddl);

    let columns = parse_summary_columns(&col_block);

    let mut primary_key: Vec<String> = Vec::new();
    let mut unique_keys: Vec<Vec<String>> = Vec::new();
    let mut indexes: Vec<Vec<String>> = Vec::new();

    for line in &constraint_lines {
        let trimmed = line.trim().trim_end_matches(',');
        let upper = trimmed.to_ascii_uppercase();
        if upper.starts_with("PRIMARY KEY") {
            primary_key = parse_backtick_list(trimmed);
        } else if upper.starts_with("UNIQUE KEY") || upper.starts_with("UNIQUE INDEX") {
            let cols = parse_backtick_list(trimmed);
            if cols.len() > 1 {
                // First backtick segment is the index name; remainder are columns.
                unique_keys.push(cols.into_iter().skip(1).collect());
            } else if !cols.is_empty() {
                unique_keys.push(cols);
            }
        } else if upper.starts_with("KEY ") || upper.starts_with("INDEX ") {
            let cols = parse_backtick_list(trimmed);
            if cols.len() > 1 {
                indexes.push(cols.into_iter().skip(1).collect());
            }
        }
    }

    let foreign_keys = parse_fks_from_ddl(db_name, table_name, ddl);

    TableSummary {
        table_comment,
        columns,
        primary_key,
        unique_keys,
        indexes,
        foreign_keys,
    }
}

/// Extract the value of the table-level `COMMENT='...'` clause from a raw
/// CREATE TABLE statement. Exposed for `parse_table_summary`; the
/// `compact_ddl` helper has its own internal copy (kept colocated with the
/// rest of DDL stripping for readability).
fn extract_table_comment(create_table_sql: &str) -> Option<String> {
    static TABLE_COMMENT_REGEX: OnceLock<Regex> = OnceLock::new();
    let re = TABLE_COMMENT_REGEX.get_or_init(|| {
        Regex::new(r"(?is)\)\s*[^()]*?\bCOMMENT\s*=\s*'((?:[^']|'')*)'")
            .expect("valid table comment regex")
    });
    re.captures(create_table_sql)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().replace("''", "'"))
}

/// Split a CREATE TABLE statement into (column_lines, constraint_lines) based
/// on the top-level `(...)` column list. Column lines are entries whose first
/// non-whitespace character is a backtick; constraint lines are everything else
/// (PRIMARY KEY, UNIQUE, INDEX, CONSTRAINT ...).
fn split_columns_and_constraints(ddl: &str) -> (Vec<String>, Vec<String>) {
    let Some(open) = ddl.find('(') else {
        return (Vec::new(), Vec::new());
    };
    let body = &ddl[open + 1..];
    let Some(close_rel) = find_matching_close_paren(body) else {
        return (Vec::new(), Vec::new());
    };
    let inside = &body[..close_rel];

    let mut parts: Vec<String> = Vec::new();
    let mut depth: usize = 0;
    let mut current = String::new();
    let mut in_quote = false;
    for ch in inside.chars() {
        match ch {
            '\'' => {
                in_quote = !in_quote;
                current.push(ch);
            }
            '(' if !in_quote => {
                depth += 1;
                current.push(ch);
            }
            ')' if !in_quote => {
                if depth > 0 {
                    depth -= 1;
                }
                current.push(ch);
            }
            ',' if !in_quote && depth == 0 => {
                parts.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }

    let mut columns = Vec::new();
    let mut constraints = Vec::new();
    for part in parts {
        let t = part.trim();
        if t.starts_with('`') {
            columns.push(part);
        } else {
            constraints.push(part);
        }
    }
    (columns, constraints)
}

fn find_matching_close_paren(body: &str) -> Option<usize> {
    let mut depth: usize = 0;
    let mut in_quote = false;
    for (i, ch) in body.char_indices() {
        match ch {
            '\'' => in_quote = !in_quote,
            '(' if !in_quote => depth += 1,
            ')' if !in_quote => {
                if depth == 0 {
                    return Some(i);
                }
                depth -= 1;
            }
            _ => {}
        }
    }
    None
}

fn parse_summary_columns(col_lines: &[String]) -> Vec<SummaryColumn> {
    static COL_HEAD_REGEX: OnceLock<Regex> = OnceLock::new();
    let head_re = COL_HEAD_REGEX.get_or_init(|| {
        Regex::new(r"^`((?:[^`]|``)+)`\s+(.+)$").expect("valid column head regex")
    });

    static COLUMN_COMMENT_REGEX: OnceLock<Regex> = OnceLock::new();
    let comment_re = COLUMN_COMMENT_REGEX.get_or_init(|| {
        Regex::new(r"(?i)COMMENT\s+'((?:[^']|'')*)'").expect("valid column comment regex")
    });

    let mut out = Vec::new();
    for raw in col_lines {
        let line = raw.trim().trim_end_matches(',');
        let Some(cap) = head_re.captures(line) else {
            continue;
        };
        let name = cap[1].replace("``", "`");
        let rest = &cap[2];

        let data_type = extract_column_type(rest);
        let upper = rest.to_ascii_uppercase();
        let not_null = upper.contains("NOT NULL");
        let comment = comment_re
            .captures(rest)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().replace("''", "'"));

        out.push(SummaryColumn {
            name,
            data_type,
            not_null,
            comment,
        });
    }
    out
}

/// Extract the SQL type from the tail of a column definition (everything
/// after the backticked column name). Takes the first whitespace-delimited
/// token plus a balanced `(...)` length/precision suffix if present.
fn extract_column_type(rest: &str) -> String {
    let s = rest.trim_start();
    let mut end = 0;
    let bytes = s.as_bytes();
    while end < bytes.len() && !bytes[end].is_ascii_whitespace() && bytes[end] != b'(' {
        end += 1;
    }
    let mut result = String::from(&s[..end]);
    if end < bytes.len() && bytes[end] == b'(' {
        let mut depth = 0;
        let mut close_idx = None;
        for (i, ch) in s[end..].char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        close_idx = Some(end + i + 1);
                        break;
                    }
                }
                _ => {}
            }
        }
        if let Some(idx) = close_idx {
            result.push_str(&s[end..idx]);
        }
    }
    if result.to_ascii_uppercase().starts_with("UNSIGNED") {
        // Odd spacing, skip; otherwise leave as-is.
    }
    // Detect trailing "unsigned" / "zerofill" attributes (they come after the type).
    let tail_upper = s[result.len()..].trim_start().to_ascii_uppercase();
    for modifier in ["UNSIGNED", "ZEROFILL"] {
        if tail_upper.starts_with(modifier) {
            result.push(' ');
            result.push_str(&tail_upper[..modifier.len()].to_ascii_lowercase());
            break;
        }
    }
    result
}

/// Render a natural-language summary chunk from a parsed table (see plan A2).
/// Returns `None` if there's no meaningful content (e.g. no columns parsed) —
/// in that case the caller should simply skip emitting a summary chunk.
pub fn generate_summary_chunk_text(
    db_name: &str,
    table_name: &str,
    summary: &TableSummary,
) -> Option<String> {
    if summary.columns.is_empty() {
        return None;
    }

    let mut out = String::new();
    out.push_str(&format!("Table {db_name}.{table_name}"));
    if let Some(comment) = &summary.table_comment {
        let trimmed = comment.trim();
        if !trimmed.is_empty() {
            out.push_str(&format!(" — {trimmed}"));
        }
    }
    out.push('.');

    out.push_str(" Columns: ");
    let col_strings: Vec<String> = summary
        .columns
        .iter()
        .map(|c| render_summary_column(c, summary))
        .collect();
    out.push_str(&col_strings.join("; "));
    out.push('.');

    if !summary.primary_key.is_empty() {
        out.push_str(&format!(
            " Primary key: {}.",
            summary.primary_key.join(", ")
        ));
    }

    if !summary.unique_keys.is_empty() {
        let unique_strs: Vec<String> = summary
            .unique_keys
            .iter()
            .map(|cols| format!("({})", cols.join(", ")))
            .collect();
        out.push_str(&format!(" Unique: {}.", unique_strs.join(", ")));
    }

    if !summary.indexes.is_empty() {
        let idx_strs: Vec<String> = summary
            .indexes
            .iter()
            .map(|cols| format!("({})", cols.join(", ")))
            .collect();
        out.push_str(&format!(" Indexes on: {}.", idx_strs.join(", ")));
    }

    if !summary.foreign_keys.is_empty() {
        let fk_strs: Vec<String> = summary
            .foreign_keys
            .iter()
            .map(|fk| {
                format!(
                    "({}) → {}.{}({})",
                    fk.columns.join(", "),
                    fk.ref_db_name,
                    fk.ref_table_name,
                    fk.ref_columns.join(", ")
                )
            })
            .collect();
        out.push_str(&format!(" Foreign keys: {}.", fk_strs.join(", ")));
    }

    Some(out)
}

fn render_summary_column(col: &SummaryColumn, summary: &TableSummary) -> String {
    let mut parts = vec![format!("{} {}", col.name, col.data_type)];
    if summary.primary_key.iter().any(|p| p == &col.name) {
        parts.push("PK".to_string());
    } else if summary
        .unique_keys
        .iter()
        .any(|uk| uk.len() == 1 && uk[0] == col.name)
    {
        parts.push("UNIQUE".to_string());
    }
    if col.not_null && !summary.primary_key.iter().any(|p| p == &col.name) {
        parts.push("NOT NULL".to_string());
    }
    let mut rendered = parts.join(" ");
    if let Some(comment) = &col.comment {
        let trimmed = comment.trim();
        if !trimmed.is_empty() {
            rendered.push_str(&format!(" — {trimmed}"));
        }
    }
    rendered
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

    let databases = fetch_database_list(mysql_pool).await?;
    tracing::info!(
        profile_id = %config.connection_id,
        database_count = databases.len(),
        "schema_index build_index: enumerated user databases from MySQL"
    );

    let mut all_ddl_inputs: Vec<TableDdlInput> = Vec::new();
    for db_name in &databases {
        if cancellation.is_cancelled() {
            return Err("Build cancelled".to_string());
        }
        let tables = fetch_table_list(mysql_pool, db_name).await?;
        for table_name in &tables {
            let ddl = fetch_create_table(mysql_pool, db_name, table_name).await?;
            all_ddl_inputs.push(TableDdlInput {
                db_name: db_name.clone(),
                table_name: table_name.clone(),
                create_table_sql: ddl,
            });
        }
    }

    let tables_total = all_ddl_inputs.len();
    tracing::info!(
        profile_id = %config.connection_id,
        tables_total,
        "schema_index build_index: fetched SHOW CREATE TABLE for all tables"
    );

    // 4. Generate chunk data (table + summary + FK chunks)
    let (table_chunks, summary_chunks, fk_chunks) = generate_all_chunks(&all_ddl_inputs);
    tracing::debug!(
        profile_id = %config.connection_id,
        table_chunk_rows = table_chunks.len(),
        summary_chunk_rows = summary_chunks.len(),
        fk_chunk_rows = fk_chunks.len(),
        "schema_index build_index: generated table, summary and FK chunk texts (DDL normalized, hashes computed)"
    );

    // Merge into a single list for diffing
    let mut all_new: Vec<(
        String,
        String,
        String,
        ChunkType,
        String,
        String,
        Option<String>,
        Option<String>,
    )> = Vec::new();
    for (key, text, hash, db, table) in &table_chunks {
        all_new.push((
            key.clone(),
            text.clone(),
            hash.clone(),
            ChunkType::Table,
            db.clone(),
            table.clone(),
            None,
            None,
        ));
    }
    for (key, text, hash, db, table) in &summary_chunks {
        all_new.push((
            key.clone(),
            text.clone(),
            hash.clone(),
            ChunkType::Summary,
            db.clone(),
            table.clone(),
            None,
            None,
        ));
    }
    for (key, text, hash, fk) in &fk_chunks {
        all_new.push((
            key.clone(),
            text.clone(),
            hash.clone(),
            ChunkType::Fk,
            fk.db_name.clone(),
            fk.table_name.clone(),
            Some(fk.ref_db_name.clone()),
            Some(fk.ref_table_name.clone()),
        ));
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
        .map(|(k, text, hash, ..)| (k.clone(), text.clone(), hash.clone()))
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
        .filter(|(k, ..)| needs_embed_keys.contains(k))
        .collect();

    let total_to_embed = chunks_to_embed.len();
    let staged_at = Utc::now().to_rfc3339();
    let staged_table_chunks = chunks_to_embed
        .iter()
        .filter(|(_, _, _, ct, ..)| matches!(ct, &ChunkType::Table))
        .count();
    let staged_summary_chunks = chunks_to_embed
        .iter()
        .filter(|(_, _, _, ct, ..)| matches!(ct, &ChunkType::Summary))
        .count();
    let staged_fk_chunks = chunks_to_embed
        .iter()
        .filter(|(_, _, _, ct, ..)| matches!(ct, &ChunkType::Fk))
        .count();
    let unchanged_chunks = all_new.len().saturating_sub(total_to_embed);

    tracing::info!(
        profile_id = %config.connection_id,
        staged_at = %staged_at,
        total_chunks_current = all_new.len(),
        staged_for_embedding = total_to_embed,
        staged_table_chunks,
        staged_summary_chunks,
        staged_fk_chunks,
        unchanged_chunks_skipped = unchanged_chunks,
        obsolete_chunks_removed = to_delete_keys.len(),
        "schema_index build_index: diff complete — staged chunks for embedding (new or hash-changed); skipped unchanged"
    );

    if tracing::enabled!(tracing::Level::DEBUG) && !chunks_to_embed.is_empty() {
        let keys_preview: Vec<(&str, &str)> = chunks_to_embed
            .iter()
            .map(|(k, _, _, ct, ..)| (k.as_str(), ct.as_str()))
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
            .filter(|(_, _, _, ct, ..)| matches!(ct, &ChunkType::Table))
            .map(|(k, ..)| k.as_str())
            .collect();
        let total_table_chunks = table_chunks.len();
        total_table_chunks - table_keys_to_embed.len()
    };
    let mut tables_done: usize = unchanged_tables;

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

        let texts: Vec<String> = batch.iter().map(|(_, text, ..)| text.clone()).collect();

        let batch_keys: Vec<&str> = batch.iter().map(|(k, ..)| k.as_str()).collect();
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
            embeddings::embed_texts(http_client, &config.endpoint, &config.model_id, texts)
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

            for (i, (key, text, hash, chunk_type, db, table, ref_db, ref_table)) in
                batch.iter().enumerate()
            {
                let embedding = &embeddings[i];

                // Check if chunk already exists (update vs insert)
                let existing = storage::get_chunk_by_key(&conn, &config.connection_id, key)
                    .map_err(|e| format!("Failed to lookup chunk: {e}"))?;

                if let Some(existing_chunk) = existing {
                    storage::update_chunk_embedding(
                        &conn,
                        existing_chunk.id,
                        text,
                        hash,
                        &config.model_id,
                        embedding,
                        &config.connection_id,
                    )
                    .map_err(|e| format!("Failed to update chunk: {e}"))?;
                } else {
                    let insert = ChunkInsert {
                        connection_id: config.connection_id.clone(),
                        chunk_key: key.clone(),
                        db_name: db.clone(),
                        table_name: table.clone(),
                        chunk_type: chunk_type.clone(),
                        ddl_text: text.clone(),
                        ddl_hash: hash.clone(),
                        model_id: config.model_id.clone(),
                        ref_db_name: ref_db.clone(),
                        ref_table_name: ref_table.clone(),
                        embedding: embedding.clone(),
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
            .filter(|(_, _, _, ct, ..)| matches!(ct, &ChunkType::Table))
            .count();
        tables_done += table_chunks_in_batch;
        if let Some(cb) = on_progress {
            cb(BuildProgress {
                profile_id: config.connection_id.clone(),
                tables_done,
                tables_total,
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
    {
        let conn = sqlite_conn
            .lock()
            .map_err(|e| format!("SQLite lock: {e}"))?;
        for (db, tbl) in tables {
            storage::delete_chunks_by_table(&conn, &config.connection_id, db, tbl)
                .map_err(|e| format!("Failed to delete chunks for {db}.{tbl}: {e}"))?;
        }
    }
    tracing::debug!(
        profile_id = %config.connection_id,
        "schema_index rebuild_tables: removed existing chunks for targeted tables"
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

    // 3. Generate new table + summary + FK chunks
    let (table_chunks, summary_chunks, fk_chunks) = generate_all_chunks(&ddl_inputs);

    // 4. Collect all texts to embed
    let mut embed_items: Vec<(
        String,
        String,
        String,
        ChunkType,
        String,
        String,
        Option<String>,
        Option<String>,
    )> = Vec::new();
    for (key, text, hash, db, table) in table_chunks {
        embed_items.push((key, text, hash, ChunkType::Table, db, table, None, None));
    }
    for (key, text, hash, db, table) in summary_chunks {
        embed_items.push((key, text, hash, ChunkType::Summary, db, table, None, None));
    }
    for (key, text, hash, fk) in fk_chunks {
        embed_items.push((
            key,
            text,
            hash,
            ChunkType::Fk,
            fk.db_name.clone(),
            fk.table_name.clone(),
            Some(fk.ref_db_name),
            Some(fk.ref_table_name),
        ));
    }

    let staged_at = Utc::now().to_rfc3339();
    let staged_tables = embed_items
        .iter()
        .filter(|(_, _, _, ct, ..)| matches!(ct, &ChunkType::Table))
        .count();
    let staged_summaries = embed_items
        .iter()
        .filter(|(_, _, _, ct, ..)| matches!(ct, &ChunkType::Summary))
        .count();
    let staged_fks = embed_items
        .iter()
        .filter(|(_, _, _, ct, ..)| matches!(ct, &ChunkType::Fk))
        .count();
    tracing::info!(
        profile_id = %config.connection_id,
        staged_at = %staged_at,
        chunks_to_embed = embed_items.len(),
        staged_table_chunks = staged_tables,
        staged_summary_chunks = staged_summaries,
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

        let texts: Vec<String> = batch.iter().map(|(_, text, ..)| text.clone()).collect();
        let batch_keys: Vec<&str> = batch.iter().map(|(k, ..)| k.as_str()).collect();
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
            embeddings::embed_texts(http_client, &config.endpoint, &config.model_id, texts)
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

        for (i, (key, text, hash, chunk_type, db, table, ref_db, ref_table)) in
            batch.iter().enumerate()
        {
            let insert = ChunkInsert {
                connection_id: config.connection_id.clone(),
                chunk_key: key.clone(),
                db_name: db.clone(),
                table_name: table.clone(),
                chunk_type: chunk_type.clone(),
                ddl_text: text.clone(),
                ddl_hash: hash.clone(),
                model_id: config.model_id.clone(),
                ref_db_name: ref_db.clone(),
                ref_table_name: ref_table.clone(),
                embedding: embeddings[i].clone(),
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

/// Generate table + summary + FK chunks from DDL inputs.
///
/// Returns:
/// - table_chunks: `Vec<(chunk_key, ddl_text, ddl_hash, db_name, table_name)>`
/// - summary_chunks: `Vec<(chunk_key, summary_text, summary_hash, db_name, table_name)>`
/// - fk_chunks: `Vec<(chunk_key, fk_text, fk_hash, FkInput)>`
///
/// Each table yields one DDL chunk (used for exact-identifier match) and, when
/// enough structure can be parsed, one natural-language summary chunk (used for
/// English-ish question matching — plan item A2). FK constraints yield one
/// chunk per constraint (plan items A6/A7 — bidirectional + JOIN phrasing).
pub fn generate_all_chunks(
    ddl_inputs: &[TableDdlInput],
) -> (
    Vec<(String, String, String, String, String)>,
    Vec<(String, String, String, String, String)>,
    Vec<(String, String, String, FkInput)>,
) {
    let mut table_chunks = Vec::new();
    let mut summary_chunks = Vec::new();
    let mut fk_chunks = Vec::new();

    for input in ddl_inputs {
        let compacted = compact_ddl(&input.create_table_sql);
        let compacted = normalize_table_ddl(&input.db_name, &input.table_name, &compacted);
        let hash = compute_hash(&compacted);
        let key = table_chunk_key(&input.db_name, &input.table_name);
        table_chunks.push((
            key,
            compacted,
            hash,
            input.db_name.clone(),
            input.table_name.clone(),
        ));

        let summary =
            parse_table_summary(&input.db_name, &input.table_name, &input.create_table_sql);
        if let Some(summary_text) =
            generate_summary_chunk_text(&input.db_name, &input.table_name, &summary)
        {
            let summary_hash = compute_hash(&summary_text);
            let summary_key = summary_chunk_key(&input.db_name, &input.table_name);
            summary_chunks.push((
                summary_key,
                summary_text,
                summary_hash,
                input.db_name.clone(),
                input.table_name.clone(),
            ));
        }

        let fks = parse_fks_from_ddl(&input.db_name, &input.table_name, &input.create_table_sql);
        for fk in fks {
            let fk_text = generate_fk_chunk_text(&fk);
            let fk_hash = compute_hash(&fk_text);
            let fk_key = fk_chunk_key(&fk.db_name, &fk.table_name, &fk.constraint_name);
            fk_chunks.push((fk_key, fk_text, fk_hash, fk));
        }
    }

    (table_chunks, summary_chunks, fk_chunks)
}

// ── MySQL fetch helpers (excluded from coverage builds) ──────────────────

/// Fetch non-system database names from MySQL.
#[cfg(not(coverage))]
async fn fetch_database_list(pool: &sqlx::MySqlPool) -> Result<Vec<String>, String> {
    use sqlx::Row;
    let rows =
        sqlx::query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME")
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Failed to list databases: {e}"))?;

    let system_dbs = ["information_schema", "mysql", "performance_schema", "sys"];
    let mut names = Vec::new();
    for row in &rows {
        let name: String = row
            .try_get::<String, _>(0)
            .or_else(|_| {
                row.try_get::<Vec<u8>, _>(0)
                    .map(|b| String::from_utf8_lossy(&b).into_owned())
            })
            .map_err(|e| format!("Failed to decode database name: {e}"))?;
        if !system_dbs.contains(&name.to_lowercase().as_str()) {
            names.push(name);
        }
    }
    Ok(names)
}

/// Fetch table names from a database.
#[cfg(not(coverage))]
async fn fetch_table_list(pool: &sqlx::MySqlPool, database: &str) -> Result<Vec<String>, String> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list tables in {database}: {e}"))?;

    let mut names = Vec::new();
    for row in &rows {
        let name: String = row
            .try_get::<String, _>(0)
            .or_else(|_| {
                row.try_get::<Vec<u8>, _>(0)
                    .map(|b| String::from_utf8_lossy(&b).into_owned())
            })
            .map_err(|e| format!("Failed to decode table name: {e}"))?;
        names.push(name);
    }
    Ok(names)
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

    let ddl: String = row
        .try_get::<String, _>(1)
        .or_else(|_| {
            row.try_get::<Vec<u8>, _>(1)
                .map(|b| String::from_utf8_lossy(&b).into_owned())
        })
        .unwrap_or_default();

    Ok(ddl)
}
