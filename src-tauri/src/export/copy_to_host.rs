//! Copy-to-host engine: copies selected schema objects (tables, procedures,
//! functions, triggers, events) from a source database to a target database on a
//! *different* host.
//!
//! Architecture mirrors `sql_dump`'s background-job model but writes directly to
//! a target pool instead of a file:
//!
//! - **Target pool resolution** reuses a writable live pool for the chosen saved
//!   profile when one is already open, otherwise opens a dedicated internal pool
//!   from the saved profile credentials. Target object statements are fully
//!   schema-qualified instead of issuing `USE target_db`, so a reused UI pool's
//!   default database cannot leak or change.
//! - **DDL** comes from the shared [`query_ddl`](crate::mysql::schema_queries::query_ddl)
//!   helper (correct `SHOW CREATE …` + DDL column per object type), then optional
//!   DROP-/CREATE-IF transforms and optional DEFINER stripping are applied.
//! - **Table data** is copied as adaptive, byte-budgeted multi-row `INSERT`
//!   batches (soft cap 1,000 rows, shrunk to stay within ~50% of the target's
//!   `max_allowed_packet`). Only the per-cell `SqlDumpValue` literal building from
//!   `sql_dump` is reused; the INSERT-to-pool path is net-new.
//! - The whole table phase runs with `FOREIGN_KEY_CHECKS = 0` on the target, which
//!   is always restored (including on error / cancel).
//!
//! Pure helpers (DEFINER stripping, DDL transforms, adaptive batching,
//! progress/cancel transitions) carry the tested logic; the
//! async DB-touching orchestration is `#[cfg(not(coverage))]` (no real MySQL pool
//! in coverage builds), matching the convention in `schema_queries.rs`.

use crate::export::sql_dump::SqlDumpValue;
use crate::state::{CopyJobProgress, CopyJobStatus};
use serde::{Deserialize, Serialize};

/// Soft cap on rows per `INSERT` batch (matches the dump's `INSERT_BATCH_SIZE`).
pub const COPY_BATCH_ROW_CAP: usize = 1_000;

/// Conservative byte budget used when the target's `max_allowed_packet` cannot be
/// read (4 MiB — the historical MySQL default for `max_allowed_packet`).
pub const FALLBACK_PACKET_BYTES: u64 = 4 * 1024 * 1024;

/// Fraction of the target's `max_allowed_packet` a single batch is allowed to use.
/// Conservative so the rendered statement (plus prefix/overhead) stays well below
/// the server's hard limit.
pub const PACKET_BUDGET_FRACTION: f64 = 0.5;

// ---------------------------------------------------------------------------
// Object categories
// ---------------------------------------------------------------------------

/// The five copyable object categories. The string form and DDL column index map
/// onto the shared `query_ddl` helper's expectations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CopyObjectType {
    Table,
    Procedure,
    Function,
    Trigger,
    Event,
}

impl CopyObjectType {
    /// The `object_type` string accepted by
    /// [`query_ddl`](crate::mysql::schema_queries::query_ddl).
    pub fn ddl_type_str(self) -> &'static str {
        match self {
            CopyObjectType::Table => "table",
            CopyObjectType::Procedure => "procedure",
            CopyObjectType::Function => "function",
            CopyObjectType::Trigger => "trigger",
            CopyObjectType::Event => "event",
        }
    }

    /// Whether the DEFINER clause may be stripped for this object type. Tables
    /// have no DEFINER; routines/triggers/events do.
    pub fn supports_definer(self) -> bool {
        !matches!(self, CopyObjectType::Table)
    }

    /// Human/IPC label stored in `CopyJobProgress.current_object_type`.
    pub fn label(self) -> &'static str {
        self.ddl_type_str()
    }
}

// ---------------------------------------------------------------------------
// Insert mode
// ---------------------------------------------------------------------------

/// How rows are written to the target table.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InsertMode {
    /// Plain `INSERT INTO`.
    #[default]
    Insert,
    /// `INSERT IGNORE INTO` — duplicate-key rows are skipped.
    InsertIgnore,
    /// `REPLACE INTO` — duplicate-key rows are replaced.
    Replace,
}

impl InsertMode {
    /// The statement keyword(s) preceding the target table name.
    pub fn keyword(self) -> &'static str {
        match self {
            InsertMode::Insert => "INSERT INTO",
            InsertMode::InsertIgnore => "INSERT IGNORE INTO",
            InsertMode::Replace => "REPLACE INTO",
        }
    }
}

// ---------------------------------------------------------------------------
// Copy options / params (engine-facing shapes)
// ---------------------------------------------------------------------------

/// User-selected behavior options for a copy job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyOptions {
    /// Copy object structure (DDL). Applies to all object types.
    pub copy_structure: bool,
    /// Copy table data (INSERTs). Applies only to tables.
    pub copy_data: bool,
    /// Emit a DROP … IF EXISTS before the CREATE.
    pub drop_if_exists: bool,
    /// Rewrite CREATE … into CREATE … IF NOT EXISTS where supported.
    pub create_if_not_exists: bool,
    /// TRUNCATE the target table before inserting data.
    pub truncate_before_insert: bool,
    /// How rows are inserted.
    pub insert_mode: InsertMode,
    /// Strip the DEFINER clause from routine/trigger/event DDL.
    pub ignore_definer: bool,
}

impl Default for CopyOptions {
    fn default() -> Self {
        Self {
            copy_structure: true,
            copy_data: true,
            drop_if_exists: false,
            create_if_not_exists: false,
            truncate_before_insert: false,
            insert_mode: InsertMode::Insert,
            ignore_definer: true,
        }
    }
}

/// The objects selected for copying, grouped by category.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopySelection {
    pub tables: Vec<String>,
    pub procedures: Vec<String>,
    pub functions: Vec<String>,
    pub triggers: Vec<String>,
    pub events: Vec<String>,
}

impl CopySelection {
    /// Total number of selected objects across all categories.
    pub fn total(&self) -> usize {
        self.tables.len()
            + self.procedures.len()
            + self.functions.len()
            + self.triggers.len()
            + self.events.len()
    }

    /// Flatten the selection into an ordered `(type, name)` work list.
    ///
    /// Tables come first so the data phase (which runs under
    /// `FOREIGN_KEY_CHECKS = 0`) is grouped, followed by routines, triggers, and
    /// events (always structure-only).
    pub fn work_list(&self) -> Vec<(CopyObjectType, String)> {
        let mut out = Vec::with_capacity(self.total());
        for t in &self.tables {
            out.push((CopyObjectType::Table, t.clone()));
        }
        for p in &self.procedures {
            out.push((CopyObjectType::Procedure, p.clone()));
        }
        for f in &self.functions {
            out.push((CopyObjectType::Function, f.clone()));
        }
        for t in &self.triggers {
            out.push((CopyObjectType::Trigger, t.clone()));
        }
        for e in &self.events {
            out.push((CopyObjectType::Event, e.clone()));
        }
        out
    }

    /// `true` when any non-table objects are selected.
    pub fn has_non_table_objects(&self) -> bool {
        !self.procedures.is_empty()
            || !self.functions.is_empty()
            || !self.triggers.is_empty()
            || !self.events.is_empty()
    }
}

/// Full set of parameters consumed by the engine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyToHostParams {
    pub source_connection_id: String,
    pub source_database: String,
    /// Saved **profile id** of the target connection (not a runtime session id).
    pub target_connection_id: String,
    pub target_database: String,
    pub objects: CopySelection,
    pub options: CopyOptions,
}

/// `true` when `selection` contains non-table objects in a cross-database copy.
///
/// This is informational only: non-table DDL is schema-rewritten before being
/// applied to the selected target database.
pub fn has_cross_database_non_table_copy(
    selection: &CopySelection,
    source_database: &str,
    target_database: &str,
) -> bool {
    !source_database.eq_ignore_ascii_case(target_database) && selection.has_non_table_objects()
}

/// Validate selected objects against copy options.
///
/// Data-only mode affects only the table data dimension: selected routines,
/// triggers, and events are structural by nature and remain valid selections.
pub fn validate_selection_for_options(
    selection: &CopySelection,
    options: &CopyOptions,
) -> Result<(), String> {
    if selection.total() == 0 {
        return Err("Select at least one object to copy".to_string());
    }

    if !selection.tables.is_empty()
        && !selection.has_non_table_objects()
        && !options.copy_structure
        && !options.copy_data
    {
        return Err(
            "Table copy would do nothing: enable structure and/or data, or select a non-table object"
                .to_string(),
        );
    }

    Ok(())
}

/// Validate cross-database non-table copies.
///
/// Non-table objects are supported across database names: server-emitted DDL is
/// rewritten narrowly at the object header so the object is created in the
/// selected target database.
pub fn validate_cross_database_non_table_copy(
    _selection: &CopySelection,
    _source_database: &str,
    _target_database: &str,
) -> Result<(), String> {
    Ok(())
}

/// Validate a charset/collation token before interpolating it as an unquoted SQL
/// identifier fragment.
pub fn validate_mysql_identifier_token(kind: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Ok(());
    }

    if value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Ok(());
    }

    Err(format!(
        "Invalid source {kind} '{value}' returned by metadata; refusing to interpolate it into CREATE DATABASE"
    ))
}

// ---------------------------------------------------------------------------
// DEFINER stripping
// ---------------------------------------------------------------------------

/// Remove the `DEFINER = '…'@'…'` clause from routine/trigger/event DDL.
///
/// Consumes `DEFINER`, optional whitespace, `=`, optional whitespace, then the
/// complete `user@host` spec. The spec is parsed quote-aware so valid quoted
/// definers containing whitespace (for example `'my user'@'%'`) are removed as a
/// whole instead of leaving corrupt fragments in the DDL.
///
/// Case-insensitive; only the first occurrence is removed (DDL has exactly one
/// DEFINER clause). If no clause is present the input is returned unchanged.
pub fn strip_definer(ddl: &str) -> String {
    // Hand-rolled scan (no regex dependency needed): find a case-insensitive
    // "DEFINER", skip ws/=/ws, then skip the user@host spec while respecting
    // quoted whitespace, then collapse following whitespace to a single space so
    // the surrounding tokens stay split.
    let bytes = ddl.as_bytes();
    let lower = ddl.to_ascii_lowercase();
    let needle = "definer";
    let Some(start) = lower.find(needle) else {
        return ddl.to_string();
    };

    let mut i = start + needle.len();
    // optional whitespace
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    // require '='
    if i >= bytes.len() || bytes[i] != b'=' {
        return ddl.to_string();
    }
    i += 1;
    // optional whitespace
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    // consume the user@host spec, allowing whitespace inside quoted identifiers
    if i >= bytes.len() || bytes[i].is_ascii_whitespace() {
        return ddl.to_string();
    }
    let mut quote: Option<u8> = None;
    while i < bytes.len() {
        let b = bytes[i];
        match quote {
            Some(q) => {
                i += 1;
                if b == q {
                    // MySQL escapes quote characters in quoted identifiers by
                    // doubling them; keep the doubled pair inside the quote.
                    if i < bytes.len() && bytes[i] == q {
                        i += 1;
                    } else {
                        quote = None;
                    }
                }
            }
            None => {
                if b.is_ascii_whitespace() {
                    break;
                }
                if b == b'\'' || b == b'`' || b == b'"' {
                    quote = Some(b);
                }
                i += 1;
            }
        }
    }
    if quote.is_some() {
        return ddl.to_string();
    }
    // consume trailing whitespace after the clause
    let mut after = i;
    while after < bytes.len() && bytes[after].is_ascii_whitespace() {
        after += 1;
    }

    let mut result = String::with_capacity(ddl.len());
    result.push_str(&ddl[..start]);
    // If both sides have content, keep a single separating space so adjacent
    // keywords (e.g. "CREATE" / "PROCEDURE") remain split.
    let needs_space =
        !result.is_empty() && !result.ends_with(char::is_whitespace) && after < ddl.len();
    if needs_space {
        result.push(' ');
    }
    result.push_str(&ddl[after..]);
    result
}

// ---------------------------------------------------------------------------
// DDL transforms
// ---------------------------------------------------------------------------

/// Build a `DROP <KEYWORD> IF EXISTS \`name\`;` statement for the given object type.
///
/// `escaped_name` must already be backtick-escaped (internal backticks doubled),
/// without surrounding backticks.
pub fn drop_if_exists_statement(object_type: CopyObjectType, escaped_name: &str) -> String {
    let keyword = match object_type {
        CopyObjectType::Table => "TABLE",
        CopyObjectType::Procedure => "PROCEDURE",
        CopyObjectType::Function => "FUNCTION",
        CopyObjectType::Trigger => "TRIGGER",
        CopyObjectType::Event => "EVENT",
    };
    format!("DROP {keyword} IF EXISTS `{escaped_name}`")
}

/// Rewrite a `CREATE TABLE` DDL into `CREATE TABLE IF NOT EXISTS` (idempotent —
/// returns the DDL unchanged if it already contains `IF NOT EXISTS`, is not a
/// `CREATE TABLE`, or the object type does not support the clause).
///
/// `IF NOT EXISTS` is only valid for `CREATE TABLE`/`CREATE EVENT`/`CREATE TRIGGER`
/// (MySQL 8.0.29+) but the copy feature scopes it to tables for predictable
/// cross-version behavior; routines do not accept the clause, so they are left
/// untouched here.
pub fn apply_create_if_not_exists(object_type: CopyObjectType, ddl: &str) -> String {
    if object_type != CopyObjectType::Table {
        return ddl.to_string();
    }
    let trimmed_start = ddl.trim_start();
    let lower = trimmed_start.to_ascii_lowercase();
    if lower.starts_with("create table if not exists") {
        return ddl.to_string();
    }
    if !lower.starts_with("create table") {
        return ddl.to_string();
    }
    // Preserve leading whitespace, then splice "IF NOT EXISTS" after "CREATE TABLE".
    let leading_len = ddl.len() - trimmed_start.len();
    let leading = &ddl[..leading_len];
    let rest = &trimmed_start["create table".len()..];
    format!("{leading}CREATE TABLE IF NOT EXISTS{rest}")
}

/// Rewrite a non-table object's header name to the selected target schema.
///
/// MySQL's `SHOW CREATE` output may include either qualified or unqualified
/// object names. Copy jobs do not issue `USE target_db`, so non-table DDL must
/// name the destination schema explicitly. Replace only the keyword-scoped
/// header identifier, leaving body SQL, string literals, comments, and table DDL
/// alone.
pub fn rewrite_non_table_ddl_schema(
    object_type: CopyObjectType,
    ddl: &str,
    _source_database: &str,
    target_database: &str,
    object_name: &str,
) -> String {
    if object_type == CopyObjectType::Table || target_database.is_empty() || object_name.is_empty() {
        return ddl.to_string();
    }

    let keyword = match object_type {
        CopyObjectType::Table => return ddl.to_string(),
        CopyObjectType::Procedure => "procedure",
        CopyObjectType::Function => "function",
        CopyObjectType::Trigger => "trigger",
        CopyObjectType::Event => "event",
    };
    let lower = ddl.to_ascii_lowercase();
    let Some(keyword_pos) = lower.find(keyword) else {
        return ddl.to_string();
    };

    let escaped_target = target_database.replace('`', "``");
    let escaped_object = object_name.replace('`', "``");
    let target_qualified = format!("`{escaped_target}`.`{escaped_object}`");

    let search_start = keyword_pos + keyword.len();
    let Some((replace_start, replace_end)) = find_create_header_identifier(ddl, search_start) else {
        return ddl.to_string();
    };

    let mut rewritten =
        String::with_capacity(ddl.len() - (replace_end - replace_start) + target_qualified.len());
    rewritten.push_str(&ddl[..replace_start]);
    rewritten.push_str(&target_qualified);
    rewritten.push_str(&ddl[replace_end..]);
    rewritten
}

fn find_create_header_identifier(ddl: &str, search_start: usize) -> Option<(usize, usize)> {
    let after_keyword = &ddl[search_start..];
    let ws_len = after_keyword
        .bytes()
        .take_while(|b| b.is_ascii_whitespace())
        .count();
    let name_start = search_start + ws_len;
    let first_end = parse_mysql_identifier_end(ddl, name_start)?;
    let after_first = &ddl[first_end..];
    let ws_after_first = after_first
        .bytes()
        .take_while(|b| b.is_ascii_whitespace())
        .count();
    let dot_pos = first_end + ws_after_first;
    if ddl[dot_pos..].starts_with('.') {
        let after_dot = dot_pos + 1;
        let ws_after_dot = ddl[after_dot..]
            .bytes()
            .take_while(|b| b.is_ascii_whitespace())
            .count();
        let object_start = after_dot + ws_after_dot;
        let object_end = parse_mysql_identifier_end(ddl, object_start)?;
        Some((name_start, object_end))
    } else {
        Some((name_start, first_end))
    }
}

fn parse_mysql_identifier_end(sql: &str, start: usize) -> Option<usize> {
    if sql[start..].starts_with('`') {
        let mut idx = start + 1;
        let bytes = sql.as_bytes();
        while idx < sql.len() {
            if bytes[idx] == b'`' {
                if idx + 1 < sql.len() && bytes[idx + 1] == b'`' {
                    idx += 2;
                    continue;
                }
                return Some(idx + 1);
            }
            idx += 1;
        }
        return None;
    }

    let mut end = start;
    for (offset, ch) in sql[start..].char_indices() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '$' {
            end = start + offset + ch.len_utf8();
        } else {
            break;
        }
    }
    (end > start).then_some(end)
}

pub fn qualified_drop_if_exists_statement(
    object_type: CopyObjectType,
    target_database: &str,
    escaped_object_name: &str,
) -> String {
    let escaped_db = target_database.replace('`', "``");
    let qualified = format!("`{escaped_db}`.`{escaped_object_name}`");
    match object_type {
        CopyObjectType::Table => format!("DROP TABLE IF EXISTS {qualified}"),
        CopyObjectType::Procedure => format!("DROP PROCEDURE IF EXISTS {qualified}"),
        CopyObjectType::Function => format!("DROP FUNCTION IF EXISTS {qualified}"),
        CopyObjectType::Trigger => format!("DROP TRIGGER IF EXISTS {qualified}"),
        CopyObjectType::Event => format!("DROP EVENT IF EXISTS {qualified}"),
    }
}

/// Qualify an unqualified `CREATE TABLE` header with the selected target schema.
///
/// `SHOW CREATE TABLE` commonly returns `CREATE TABLE `name` ...` without a
/// schema qualifier. Copy jobs do not issue `USE target_db` because the target
/// pool may be a reused live UI pool, so table DDL must name the destination
/// schema explicitly. The rewrite is intentionally narrow: only the header's
/// first backtick-quoted table identifier immediately following `CREATE TABLE`
/// or `CREATE TABLE IF NOT EXISTS` is replaced.
pub fn qualify_table_ddl_schema(ddl: &str, target_database: &str, table_name: &str) -> String {
    if target_database.is_empty() || table_name.is_empty() {
        return ddl.to_string();
    }

    let trimmed_start = ddl.trim_start();
    let leading_len = ddl.len() - trimmed_start.len();
    let lower = trimmed_start.to_ascii_lowercase();
    let prefix_len = if lower.starts_with("create table if not exists") {
        "create table if not exists".len()
    } else if lower.starts_with("create table") {
        "create table".len()
    } else {
        return ddl.to_string();
    };

    let header_start = leading_len + prefix_len;
    let after_prefix = &ddl[header_start..];
    let ws_len = after_prefix
        .bytes()
        .take_while(|b| b.is_ascii_whitespace())
        .count();
    let name_start = header_start + ws_len;
    let escaped_table = table_name.replace('`', "``");
    let unqualified = format!("`{escaped_table}`");
    if !ddl[name_start..].starts_with(&unqualified) {
        return ddl.to_string();
    }

    let escaped_db = target_database.replace('`', "``");
    let qualified = format!("`{escaped_db}`.{unqualified}");
    let name_end = name_start + unqualified.len();
    let mut rewritten = String::with_capacity(ddl.len() + escaped_db.len() + 3);
    rewritten.push_str(&ddl[..name_start]);
    rewritten.push_str(&qualified);
    rewritten.push_str(&ddl[name_end..]);
    rewritten
}

// ---------------------------------------------------------------------------
// Byte budget & adaptive batching
// ---------------------------------------------------------------------------

/// Compute the per-batch byte budget from the target's `max_allowed_packet`.
///
/// Takes [`PACKET_BUDGET_FRACTION`] of `max_allowed_packet`; if the value is
/// `None`/zero (could not be read) falls back to a conservative constant. The
/// result is always at least 1 KiB so a single oversized row can still be
/// emitted as its own batch.
pub fn batch_byte_budget(max_allowed_packet: Option<u64>) -> u64 {
    let base = match max_allowed_packet {
        Some(v) if v > 0 => v,
        _ => FALLBACK_PACKET_BYTES,
    };
    let budget = (base as f64 * PACKET_BUDGET_FRACTION) as u64;
    budget.max(1024)
}

/// Render one row into its `(literal_tuple, byte_len)` form for batching.
///
/// `literal_tuple` is `(v1, v2, …)` exactly as it appears in a multi-row
/// `VALUES` clause; `byte_len` is its serialized length (used for the byte
/// budget). Reuses [`value_byte_len`]/the shared literal building from
/// `sql_dump` so the measured size matches the bytes actually sent.
pub fn render_row(row: &[SqlDumpValue]) -> (String, usize) {
    use crate::export::sql_dump::value_to_literal;
    let mut tuple = String::with_capacity(2 + row.len() * 8);
    tuple.push('(');
    for (i, val) in row.iter().enumerate() {
        if i > 0 {
            tuple.push_str(", ");
        }
        let lit = value_to_literal(val);
        tuple.push_str(&lit);
    }
    tuple.push(')');
    let len = tuple.len();
    (tuple, len)
}

/// Decide whether a current batch must be closed before adding the next row.
pub fn should_start_new_batch(
    current_count: usize,
    current_bytes: usize,
    next_row_bytes: usize,
    byte_budget: usize,
    row_cap: usize,
) -> bool {
    let sep = if current_count == 0 { 0 } else { 2 };
    let prospective = current_bytes + sep + next_row_bytes;
    let row_cap_hit = current_count >= row_cap.max(1);
    let budget_hit = current_count > 0 && prospective > byte_budget;

    row_cap_hit || budget_hit
}

/// Plan adaptive batches over pre-rendered `(tuple, byte_len)` rows.
///
/// Returns a list of index ranges `[start, end)` into `rows`, where each range is
/// one `INSERT` batch. Rules:
/// - at most [`COPY_BATCH_ROW_CAP`] rows per batch;
/// - a batch is closed early when adding the next row would push the *accumulated
///   row bytes plus per-row separators* past `byte_budget` (the fixed statement
///   prefix is accounted for by the caller via `prefix_len`);
/// - a single row larger than the budget is still emitted alone (never dropped).
///
/// Pure and allocation-light so adaptive sizing is unit-testable without a DB.
pub fn plan_batches(
    rows: &[(String, usize)],
    byte_budget: u64,
    prefix_len: usize,
    row_cap: usize,
) -> Vec<(usize, usize)> {
    let mut batches = Vec::new();
    if rows.is_empty() {
        return batches;
    }
    let cap = row_cap.max(1);
    let budget = byte_budget as usize;

    let mut start = 0usize;
    let mut acc = prefix_len; // running serialized size of the current batch
    let mut count = 0usize;

    for (idx, (_, row_len)) in rows.iter().enumerate() {
        // Separator before this row (", " between value tuples), only if not first.
        if should_start_new_batch(count, acc, *row_len, budget, cap) {
            // Close the current batch [start, idx) and start a new one at idx.
            batches.push((start, idx));
            start = idx;
            acc = prefix_len + row_len;
            count = 1;
        } else {
            let sep = if count == 0 { 0 } else { 2 };
            let prospective = acc + sep + row_len;
            acc = prospective;
            count += 1;
        }
    }
    batches.push((start, rows.len()));
    batches
}

// ---------------------------------------------------------------------------
// FK-check statements
// ---------------------------------------------------------------------------

/// Statement that disables FK checks on the target for the table phase.
pub const FK_CHECKS_DISABLE: &str = "SET FOREIGN_KEY_CHECKS = 0";
/// Statement that restores FK checks on the target (always run in a finally path).
pub const FK_CHECKS_ENABLE: &str = "SET FOREIGN_KEY_CHECKS = 1";

// ---------------------------------------------------------------------------
// Progress / cancel transitions
// ---------------------------------------------------------------------------

/// Build the initial `Running` progress entry for a new job.
pub fn new_running_progress(job_id: String, objects_total: usize) -> CopyJobProgress {
    CopyJobProgress {
        job_id,
        status: CopyJobStatus::Running,
        objects_total,
        objects_done: 0,
        current_object: None,
        current_object_type: None,
        rows_total: None,
        rows_done: None,
        error_message: None,
        cancel_requested: false,
        completed_at: None,
    }
}

/// Mark the start of work on a single object (updates current object/type and
/// resets the per-table row counters).
pub fn begin_object(
    progress: &mut CopyJobProgress,
    object_type: CopyObjectType,
    name: &str,
    rows_total: Option<u64>,
) {
    progress.current_object = Some(name.to_string());
    progress.current_object_type = Some(object_type.label().to_string());
    progress.rows_total = rows_total;
    progress.rows_done = rows_total.map(|_| 0);
}

/// Record that an object finished successfully.
pub fn complete_object(progress: &mut CopyJobProgress) {
    progress.objects_done += 1;
    progress.rows_total = None;
    progress.rows_done = None;
}

/// Transition the job to `Completed`.
pub fn mark_completed(progress: &mut CopyJobProgress) {
    progress.status = CopyJobStatus::Completed;
    progress.current_object = None;
    progress.current_object_type = None;
    progress.rows_total = None;
    progress.rows_done = None;
    progress.completed_at = Some(std::time::SystemTime::now());
}

/// Transition the job to `Failed`, recording the failing object and message.
pub fn mark_failed(progress: &mut CopyJobProgress, message: impl Into<String>) {
    progress.status = CopyJobStatus::Failed;
    progress.error_message = Some(message.into());
    progress.completed_at = Some(std::time::SystemTime::now());
}

/// Transition the job to `Cancelled`.
pub fn mark_cancelled(progress: &mut CopyJobProgress) {
    progress.status = CopyJobStatus::Cancelled;
    progress.completed_at = Some(std::time::SystemTime::now());
}

/// Whether the job has been asked to cancel (checked at safe checkpoints).
pub fn should_cancel(progress: &CopyJobProgress) -> bool {
    progress.cancel_requested
}

// ---------------------------------------------------------------------------
// Async DB orchestration — excluded from coverage (needs a real MySQL pool).
// ---------------------------------------------------------------------------

#[cfg(not(coverage))]
mod engine {
    use super::*;
    use crate::mysql::pool;
    use crate::mysql::query_log;
    use crate::mysql::registry::StoredConnectionParams;
    use crate::mysql::schema_queries::{query_ddl, safe_identifier};
    use crate::state::AppState;
    use futures::StreamExt;
    use sqlx::mysql::MySqlPool;
    use sqlx::{Column, MySqlConnection, Row};
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::sync::RwLock;

    /// A resolved target pool, either reused from a live writable profile session
    /// or opened internally for this copy job.
    pub struct ResolvedTargetPool {
        pub pool: MySqlPool,
        /// `true` when this engine opened the pool and owns its lifecycle.
        pub owned: bool,
    }

    impl ResolvedTargetPool {
        /// Dispose the pool if (and only if) it was opened internally.
        pub async fn dispose(self) {
            if self.owned {
                self.pool.close().await;
            }
        }
    }

    /// Open an internal pool from a saved profile's stored credentials, reusing
    /// the same chain as `open_connection_impl`: read the profile from SQLite,
    /// resolve the password from the keychain, then create the pool.
    pub async fn open_pool_for_profile(
        state: &AppState,
        profile_id: &str,
    ) -> Result<MySqlPool, String> {
        let record = {
            let conn = state
                .db
                .lock()
                .map_err(|e| format!("Failed to lock database: {e}"))?;
            match crate::db::connections::get_connection(&conn, profile_id) {
                Ok(Some(record)) => record,
                Ok(None) => return Err(format!("Connection '{profile_id}' not found")),
                Err(error) => return Err(error.to_string()),
            }
        };

        let password = crate::credentials::resolve_password(profile_id, record.has_password)?;

        let timeout_secs = record.connect_timeout_secs.unwrap_or(10).max(1) as u64;
        let keepalive_secs = record.keepalive_interval_secs.unwrap_or(60).max(0) as u64;

        let stored = StoredConnectionParams {
            profile_id: profile_id.to_string(),
            host: record.host,
            port: record.port as u16,
            username: record.username,
            has_password: record.has_password,
            keychain_ref: record.keychain_ref,
            default_database: record.default_database,
            ssl_enabled: record.ssl_enabled,
            ssl_ca_path: record.ssl_ca_path,
            ssl_cert_path: record.ssl_cert_path,
            ssl_key_path: record.ssl_key_path,
            connect_timeout_secs: timeout_secs,
            keepalive_interval_secs: keepalive_secs,
        };

        let params = stored.to_connection_params(password);
        pool::create_pool(&params)
            .await
            .map_err(|e| format!("Failed to connect to target: {e}"))
    }

    /// Resolve the target pool by reusing a live writable session for the saved
    /// profile when one exists, otherwise opening an internal pool from the
    /// stored credentials. The copy body never issues `USE`, so reusing a live
    /// pool cannot leak a changed default database back to the UI session.
    pub async fn resolve_target_pool(
        state: &AppState,
        target_profile_id: &str,
    ) -> Result<ResolvedTargetPool, String> {
        if let Some(pool) = state.registry.get_pool_by_profile(target_profile_id) {
            return Ok(ResolvedTargetPool { pool, owned: false });
        }

        let pool = open_pool_for_profile(state, target_profile_id).await?;
        Ok(ResolvedTargetPool { pool, owned: true })
    }

    /// Read the source database's `(charset, collation)` from
    /// `information_schema.SCHEMATA` (used when creating a new target DB).
    pub async fn read_source_charset(
        source: &MySqlPool,
        database: &str,
    ) -> Result<(String, String), String> {
        let sql = "SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME \
                   FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?";
        query_log::log_outgoing_sql_bound(sql, &[database.to_string()]);
        let row = sqlx::query(sql)
            .bind(database)
            .fetch_optional(source)
            .await
            .map_err(|e| {
                query_log::log_execute_error(&e);
                format!("Failed to read source charset: {e}")
            })?
            .ok_or_else(|| format!("Source database '{database}' not found"))?;
        query_log::log_mysql_row(&row);
        let charset: String = row.try_get(0).unwrap_or_default();
        let collation: String = row.try_get(1).unwrap_or_default();
        Ok((charset, collation))
    }

    /// Whether `database` exists on the target server.
    pub async fn target_database_exists(
        target: &mut MySqlConnection,
        database: &str,
    ) -> Result<bool, String> {
        let sql = "SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?";
        query_log::log_outgoing_sql_bound(sql, &[database.to_string()]);
        let row = sqlx::query(sql)
            .bind(database)
            .fetch_optional(&mut *target)
            .await
            .map_err(|e| {
                query_log::log_execute_error(&e);
                format!("Failed to check target database: {e}")
            })?;
        if let Some(row) = &row {
            query_log::log_mysql_row(row);
        }
        Ok(row.is_some())
    }

    /// Create the target database (if absent) using the source DB's charset and
    /// collation. No-op when the database already exists.
    ///
    /// All target writes run on the single pinned connection and fully qualify
    /// target objects so the copy job never changes session default schema.
    pub async fn ensure_target_database(
        source: &MySqlPool,
        target: &mut MySqlConnection,
        source_database: &str,
        target_database: &str,
    ) -> Result<(), String> {
        if target_database_exists(&mut *target, target_database).await? {
            return Ok(());
        }
        let (charset, collation) = read_source_charset(source, source_database).await?;
        validate_mysql_identifier_token("charset", &charset)?;
        validate_mysql_identifier_token("collation", &collation)?;
        let safe_db = safe_identifier(target_database)?;
        let mut sql = format!("CREATE DATABASE IF NOT EXISTS {safe_db}");
        if !charset.is_empty() {
            sql.push_str(&format!(" CHARACTER SET {charset}"));
        }
        if !collation.is_empty() {
            sql.push_str(&format!(" COLLATE {collation}"));
        }
        run_target_statement(&mut *target, &sql).await
    }

    /// Read the target's `max_allowed_packet`, returning `None` if it cannot be
    /// determined (the caller then uses the conservative fallback budget).
    pub async fn read_max_allowed_packet(target: &mut MySqlConnection) -> Option<u64> {
        let sql = "SELECT @@max_allowed_packet";
        query_log::log_outgoing_sql(sql);
        match sqlx::query(sql).fetch_optional(&mut *target).await {
            Ok(Some(row)) => row.try_get::<i64, _>(0).ok().map(|v| v.max(0) as u64),
            Ok(None) => None,
            Err(e) => {
                query_log::log_execute_error(&e);
                None
            }
        }
    }

    /// Execute a single statement against the target's pinned connection, logging
    /// the SQL and result. Using one connection guarantees session-scoped state
    /// (`FOREIGN_KEY_CHECKS`) applies to the same backend handle as the DDL/INSERTs.
    pub async fn run_target_statement(
        target: &mut MySqlConnection,
        sql: &str,
    ) -> Result<(), String> {
        query_log::log_outgoing_sql(sql);
        match sqlx::query(sql).execute(&mut *target).await {
            Ok(result) => {
                query_log::log_execute_result(&result);
                Ok(())
            }
            Err(e) => {
                query_log::log_execute_error(&e);
                Err(e.to_string())
            }
        }
    }

    /// Generate, transform, and apply the DDL for a single object to the target.
    ///
    /// All target writes go through the pinned connection.
    pub async fn copy_object_structure(
        source: &MySqlPool,
        target: &mut MySqlConnection,
        source_database: &str,
        target_database: &str,
        object_type: CopyObjectType,
        name: &str,
        options: &CopyOptions,
    ) -> Result<(), String> {
        let mut ddl = query_ddl(source, source_database, name, object_type.ddl_type_str()).await?;
        if ddl.trim().is_empty() {
            return Err(format!(
                "Empty DDL for {} '{name}' (insufficient privileges?)",
                object_type.label()
            ));
        }

        if options.ignore_definer && object_type.supports_definer() {
            ddl = strip_definer(&ddl);
        }
        if options.create_if_not_exists {
            ddl = apply_create_if_not_exists(object_type, &ddl);
        }
        ddl =
            rewrite_non_table_ddl_schema(object_type, &ddl, source_database, target_database, name);

        if options.drop_if_exists {
            // Validate the identifier (length/shape) before interpolating it,
            // matching the source-side SELECT / `ensure_target_database` path.
            // `safe_identifier` returns the name wrapped in backticks with inner
            // backticks doubled; `drop_if_exists_statement` re-wraps an already
            // doubled-but-unwrapped name, so feed it the manually escaped form
            // after the validation has run.
            safe_identifier(name)?;
            let escaped = name.replace('`', "``");
            safe_identifier(target_database)?;
            let drop = qualified_drop_if_exists_statement(object_type, target_database, &escaped);
            run_target_statement(&mut *target, &drop).await?;
        }

        let ddl = ddl.trim_end().trim_end_matches(';');
        let ddl = if object_type == CopyObjectType::Table {
            qualify_table_ddl_schema(ddl, target_database, name)
        } else {
            ddl.to_string()
        };
        run_target_statement(&mut *target, &ddl).await
    }

    /// Count the exact number of rows to copy from the source table so progress
    /// can report `rowsDone / rowsTotal` for the active table.
    pub async fn count_source_rows(
        source: &MySqlPool,
        source_database: &str,
        table: &str,
    ) -> Result<u64, String> {
        let safe_db = safe_identifier(source_database)?;
        let safe_table = safe_identifier(table)?;
        let sql = format!("SELECT COUNT(*) AS row_count FROM {safe_db}.{safe_table}");
        query_log::log_outgoing_sql(&sql);
        let row = sqlx::query(&sql).fetch_one(source).await.map_err(|e| {
            query_log::log_execute_error(&e);
            format!("Failed to count rows in '{table}': {e}")
        })?;
        query_log::log_mysql_row(&row);

        let row_count = row
            .try_get::<i64, _>("row_count")
            .map_err(|e| format!("Failed to decode row count for '{table}': {e}"))?;
        Ok(row_count.max(0) as u64)
    }

    /// Copy a single table's data as adaptive byte-budgeted multi-row INSERTs.
    ///
    /// Streams source rows one at a time (never loading the whole table into
    /// RAM), accumulating rendered value-tuples into a batch and flushing the
    /// batch — to the pinned target connection — once the row cap or byte budget
    /// is reached. Updates `progress.rows_done` after each flushed batch and
    /// honors cancellation at batch boundaries. Returns `Ok(true)` if completed,
    /// `Ok(false)` if cancelled mid-way.
    #[allow(clippy::too_many_arguments)]
    pub async fn copy_table_data(
        source: &MySqlPool,
        target: &mut MySqlConnection,
        source_database: &str,
        target_database: &str,
        table: &str,
        options: &CopyOptions,
        byte_budget: u64,
        jobs: &Arc<RwLock<HashMap<String, CopyJobProgress>>>,
        job_id: &str,
    ) -> Result<bool, String> {
        let safe_db = safe_identifier(source_database)?;
        let safe_table = safe_identifier(table)?;

        if options.truncate_before_insert {
            // Validate the target identifier the same way as the source-side
            // SELECT instead of interpolating a raw, unvalidated name.
            let safe_target_table = safe_identifier(table)?;
            let safe_target_db = safe_identifier(target_database)?;
            run_target_statement(
                &mut *target,
                &format!("TRUNCATE TABLE {safe_target_db}.{safe_target_table}"),
            )
            .await?;
        }

        // Stream rows from the source (never `fetch_all` — large tables would
        // otherwise be loaded into RAM in full).
        let select_sql = format!("SELECT * FROM {safe_db}.{safe_table}");
        query_log::log_outgoing_sql(&select_sql);
        let mut stream = sqlx::query(&select_sql).fetch(source);

        let budget = byte_budget as usize;
        let cap = COPY_BATCH_ROW_CAP.max(1);

        // Built lazily from the first streamed row (column list → INSERT prefix).
        let mut prefix: Option<String> = None;
        // Accumulated rendered value-tuples for the current batch.
        let mut batch: Vec<(String, usize)> = Vec::new();
        let mut acc = 0usize; // running serialized size incl. prefix
        let mut rows_done: u64 = 0;

        loop {
            // Cancel checkpoint at batch boundary (before fetching the next row).
            {
                let map = jobs.read().unwrap_or_else(|p| p.into_inner());
                if let Some(p) = map.get(job_id) {
                    if should_cancel(p) {
                        return Ok(false);
                    }
                }
            }

            let next = stream.next().await.transpose().map_err(|e| {
                query_log::log_execute_error(&e);
                format!("Failed to read data from '{table}': {e}")
            })?;

            let Some(row) = next else {
                break;
            };

            // On the first row, derive the column list and INSERT prefix.
            if prefix.is_none() {
                let col_list = row
                    .columns()
                    .iter()
                    .map(|c| format!("`{}`", c.name().replace('`', "``")))
                    .collect::<Vec<_>>()
                    .join(", ");
                // Validate the target table identifier (length/shape) on the
                // write path too, matching the source-side SELECT.
                let safe_target_table = safe_identifier(table)?;
                let safe_target_db = safe_identifier(target_database)?;
                let built = format!(
                    "{} {} ({}) VALUES ",
                    options.insert_mode.keyword(),
                    format_args!("{safe_target_db}.{safe_target_table}"),
                    col_list
                );
                acc = built.len();
                prefix = Some(built);
            }

            let vals: Vec<SqlDumpValue> = (0..row.columns().len())
                .map(|i| crate::commands::sql_dump::serialize_dump_value(&row, i))
                .collect();
            let (tuple, tuple_len) = render_row(&vals);

            // Decide whether this row fits the current batch or starts a new one.
            if should_start_new_batch(batch.len(), acc, tuple_len, budget, cap) {
                // Flush the full batch, then start a new one with this row.
                rows_done = flush_batch(
                    &mut *target,
                    prefix.as_deref().unwrap_or(""),
                    &batch,
                    rows_done,
                    jobs,
                    job_id,
                )
                .await?;
                batch.clear();
                acc = prefix.as_deref().map(str::len).unwrap_or(0) + tuple_len;
                batch.push((tuple, tuple_len));
            } else {
                let sep = if batch.is_empty() { 0 } else { 2 };
                let prospective = acc + sep + tuple_len;
                acc = prospective;
                batch.push((tuple, tuple_len));
            }
        }

        // Flush any remaining partial batch.
        if !batch.is_empty() {
            flush_batch(
                &mut *target,
                prefix.as_deref().unwrap_or(""),
                &batch,
                rows_done,
                jobs,
                job_id,
            )
            .await?;
        }

        Ok(true)
    }

    /// Render and execute one INSERT batch against the pinned target connection,
    /// then bump `progress.rows_done`. Returns the updated running row count.
    async fn flush_batch(
        target: &mut MySqlConnection,
        prefix: &str,
        batch: &[(String, usize)],
        rows_done: u64,
        jobs: &Arc<RwLock<HashMap<String, CopyJobProgress>>>,
        job_id: &str,
    ) -> Result<u64, String> {
        let mut stmt = String::with_capacity(prefix.len() + batch.len() * 32);
        stmt.push_str(prefix);
        for (i, (tuple, _)) in batch.iter().enumerate() {
            if i > 0 {
                stmt.push_str(", ");
            }
            stmt.push_str(tuple);
        }
        run_target_statement(&mut *target, &stmt).await?;

        let new_rows_done = rows_done + batch.len() as u64;
        let mut map = jobs.write().unwrap_or_else(|p| p.into_inner());
        if let Some(p) = map.get_mut(job_id) {
            p.rows_done = Some(new_rows_done);
        }
        Ok(new_rows_done)
    }

    /// Run a full copy job to completion, writing terminal status into `jobs`.
    pub async fn run_copy(
        state: &AppState,
        params: CopyToHostParams,
        jobs: Arc<RwLock<HashMap<String, CopyJobProgress>>>,
        job_id: String,
    ) {
        let result = run_copy_inner(state, &params, &jobs, &job_id).await;
        // Terminal-status write must never be silently dropped on a poisoned
        // lock — recover the guard so the job does not stay `Running` forever.
        let mut map = jobs.write().unwrap_or_else(|p| p.into_inner());
        match map.get_mut(&job_id) {
            Some(p) => {
                // Only set a terminal state if still running (cancel may have
                // already set Cancelled inside the inner loop).
                if p.status == CopyJobStatus::Running {
                    match result {
                        Ok(true) => mark_completed(p),
                        Ok(false) => mark_cancelled(p),
                        Err(e) => mark_failed(p, e),
                    }
                }
            }
            None => {
                tracing::error!(
                    job_id = %job_id,
                    "Copy job entry missing when writing terminal status"
                );
            }
        }
    }

    /// Inner copy orchestration. Returns `Ok(true)` on completion, `Ok(false)` if
    /// cancelled, `Err` on first error (stop-on-first-error).
    async fn run_copy_inner(
        state: &AppState,
        params: &CopyToHostParams,
        jobs: &Arc<RwLock<HashMap<String, CopyJobProgress>>>,
        job_id: &str,
    ) -> Result<bool, String> {
        let source = state
            .registry
            .get_pool(&params.source_connection_id)
            .ok_or_else(|| {
                format!(
                    "Source connection '{}' not found",
                    params.source_connection_id
                )
            })?;

        let resolved = resolve_target_pool(state, &params.target_connection_id).await?;
        let outcome =
            run_copy_with_pools(state, params, jobs, job_id, &source, &resolved.pool).await;
        resolved.dispose().await;
        outcome
    }

    /// Copy body once both pools are resolved. FK checks are always restored.
    ///
    /// A single target connection is pinned for the entire job so that all
    /// session-scoped statements (`USE`, `SET FOREIGN_KEY_CHECKS`) and every
    /// DDL/TRUNCATE/INSERT run on the *same* backend handle. Without pinning, a
    /// pool with `max_connections > 1` could apply `USE`/`SET` to one connection
    /// while the writes land on another, defeating both the default-database
    /// switch and the FK-check guarantee.
    async fn run_copy_with_pools(
        _state: &AppState,
        params: &CopyToHostParams,
        jobs: &Arc<RwLock<HashMap<String, CopyJobProgress>>>,
        job_id: &str,
        source: &MySqlPool,
        target: &MySqlPool,
    ) -> Result<bool, String> {
        validate_cross_database_non_table_copy(
            &params.objects,
            &params.source_database,
            &params.target_database,
        )?;

        // Pin one target connection for the whole job (mirrors sql_dump's
        // `pool.acquire()` + `&mut *conn` streaming pattern).
        let mut conn = target
            .acquire()
            .await
            .map_err(|e| format!("Failed to acquire target connection: {e}"))?;

        ensure_target_database(
            source,
            &mut conn,
            &params.source_database,
            &params.target_database,
        )
        .await?;

        let byte_budget = batch_byte_budget(read_max_allowed_packet(&mut conn).await);

        // Disable FK checks for the duration; always restore.
        run_target_statement(&mut conn, FK_CHECKS_DISABLE).await?;
        let body = copy_objects(params, jobs, job_id, source, &mut conn, byte_budget).await;
        // Finally: restore FK checks regardless of the body outcome.
        let restore = run_target_statement(&mut conn, FK_CHECKS_ENABLE).await;

        match body {
            Ok(outcome) => {
                restore?;
                Ok(outcome)
            }
            Err(e) => {
                // Surface the original error even if restore also failed.
                if let Err(re) = restore {
                    tracing::error!(error = %re, "Failed to restore FOREIGN_KEY_CHECKS after copy error");
                }
                Err(e)
            }
        }
    }

    /// Iterate the work list, copying each object and updating progress. All
    /// target writes go through the pinned connection `target`.
    async fn copy_objects(
        params: &CopyToHostParams,
        jobs: &Arc<RwLock<HashMap<String, CopyJobProgress>>>,
        job_id: &str,
        source: &MySqlPool,
        target: &mut MySqlConnection,
        byte_budget: u64,
    ) -> Result<bool, String> {
        let work = params.objects.work_list();
        let opts = &params.options;

        for (object_type, name) in work {
            let rows_total = if object_type == CopyObjectType::Table && opts.copy_data {
                Some(count_source_rows(source, &params.source_database, &name).await?)
            } else {
                None
            };

            // Cancel checkpoint at object boundary.
            {
                let mut map = jobs.write().unwrap_or_else(|p| p.into_inner());
                let p = map.get_mut(job_id).ok_or("Job entry missing")?;
                if should_cancel(p) {
                    mark_cancelled(p);
                    return Ok(false);
                }
                begin_object(p, object_type, &name, rows_total);
            }

            // Structure phase (all object types; routines/triggers/events are
            // always structure-only).
            let is_table = object_type == CopyObjectType::Table;
            let do_structure = opts.copy_structure || !is_table;
            if do_structure {
                copy_object_structure(
                    source,
                    &mut *target,
                    &params.source_database,
                    &params.target_database,
                    object_type,
                    &name,
                    opts,
                )
                .await?;
            }

            // Data phase (tables only, when copy_data is set).
            if is_table && opts.copy_data {
                let completed = copy_table_data(
                    source,
                    &mut *target,
                    &params.source_database,
                    &params.target_database,
                    &name,
                    opts,
                    byte_budget,
                    jobs,
                    job_id,
                )
                .await?;
                if !completed {
                    let mut map = jobs.write().unwrap_or_else(|p| p.into_inner());
                    if let Some(p) = map.get_mut(job_id) {
                        mark_cancelled(p);
                    }
                    return Ok(false);
                }
            }

            let mut map = jobs.write().unwrap_or_else(|p| p.into_inner());
            if let Some(p) = map.get_mut(job_id) {
                complete_object(p);
            }
        }

        Ok(true)
    }
}

#[cfg(not(coverage))]
pub use engine::{
    copy_object_structure, copy_table_data, ensure_target_database, open_pool_for_profile,
    read_max_allowed_packet, read_source_charset, resolve_target_pool, run_copy,
    run_target_statement, target_database_exists, ResolvedTargetPool,
};
