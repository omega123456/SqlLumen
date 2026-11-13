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

mod ddl;
#[cfg(not(coverage))]
mod engine;

pub use ddl::*;

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

    pub fn is_empty(&self) -> bool {
        self.total() == 0
    }

    /// Flatten the selection into an ordered `(type, name)` work list.
    ///
    /// Tables come first so the data phase (which runs under
    /// `FOREIGN_KEY_CHECKS = 0`) is grouped, followed by routines, triggers, and
    /// events (always structure-only).
    pub fn work_list(&self) -> Vec<(CopyObjectType, String)> {
        let mut out = Vec::with_capacity(self.total());
        for table in &self.tables {
            out.push((CopyObjectType::Table, table.clone()));
        }
        for procedure in &self.procedures {
            out.push((CopyObjectType::Procedure, procedure.clone()));
        }
        for function in &self.functions {
            out.push((CopyObjectType::Function, function.clone()));
        }
        for trigger in &self.triggers {
            out.push((CopyObjectType::Trigger, trigger.clone()));
        }
        for event in &self.events {
            out.push((CopyObjectType::Event, event.clone()));
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
    if selection.is_empty() {
        return Err("Select at least one object to copy".to_string());
    }

    let selects_only_tables = !selection.tables.is_empty() && !selection.has_non_table_objects();
    let copies_nothing_from_tables = !options.copy_structure && !options.copy_data;
    if selects_only_tables && copies_nothing_from_tables {
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

fn is_plain_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn is_ascii_whitespace_byte_at(bytes: &[u8], position: usize) -> bool {
    bytes.get(position).is_some_and(u8::is_ascii_whitespace)
}

fn has_byte_at(bytes: &[u8], position: usize, expected: u8) -> bool {
    bytes.get(position) == Some(&expected)
}

/// Validate a charset/collation token before interpolating it as an unquoted SQL
/// identifier fragment.
pub fn validate_mysql_identifier_token(kind: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Ok(());
    }

    if value.bytes().all(is_plain_identifier_byte) {
        return Ok(());
    }

    Err(format!(
        "Invalid source {kind} '{value}' returned by metadata; refusing to interpolate it into CREATE DATABASE"
    ))
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
        Some(packet_bytes) if packet_bytes > 0 => packet_bytes,
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedRow {
    pub tuple: String,
    pub byte_len: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct BatchFill {
    pub row_count: usize,
    pub byte_count: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct BatchLimits {
    pub byte_budget: usize,
    pub row_cap: usize,
}

pub fn render_row(row: &[SqlDumpValue]) -> RenderedRow {
    use crate::export::sql_dump::value_to_literal;
    let mut tuple = String::with_capacity(2 + row.len() * 8);
    tuple.push('(');
    for (column_index, value) in row.iter().enumerate() {
        if column_index > 0 {
            tuple.push_str(", ");
        }
        let lit = value_to_literal(value);
        tuple.push_str(&lit);
    }
    tuple.push(')');
    let byte_len = tuple.len();
    RenderedRow { tuple, byte_len }
}

const TUPLE_SEPARATOR: &str = ", ";

pub fn tuple_separator_len(tuples_in_batch: usize) -> usize {
    if tuples_in_batch == 0 {
        return 0;
    }
    TUPLE_SEPARATOR.len()
}

pub fn should_start_new_batch(
    current: BatchFill,
    next_row_bytes: usize,
    limits: BatchLimits,
) -> bool {
    let current_count = current.row_count;
    let prospective = current.byte_count + tuple_separator_len(current_count) + next_row_bytes;
    let row_cap_hit = current_count >= limits.row_cap.max(1);
    let budget_hit = current_count > 0 && prospective > limits.byte_budget;

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
    rows: &[RenderedRow],
    limits: BatchLimits,
    prefix_len: usize,
) -> Vec<std::ops::Range<usize>> {
    let mut batches = Vec::new();
    if rows.is_empty() {
        return batches;
    }

    let mut start = 0usize;
    let mut fill = BatchFill {
        row_count: 0,
        byte_count: prefix_len,
    };

    for (index, row) in rows.iter().enumerate() {
        if should_start_new_batch(fill, row.byte_len, limits) {
            batches.push(start..index);
            start = index;
            fill = BatchFill {
                row_count: 0,
                byte_count: prefix_len,
            };
        }
        fill.byte_count += tuple_separator_len(fill.row_count) + row.byte_len;
        fill.row_count += 1;
    }
    batches.push(start..rows.len());
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
    object: CopyObject<'_>,
    rows_total: Option<u64>,
) {
    progress.current_object = Some(object.name.to_string());
    progress.current_object_type = Some(object.object_type.label().to_string());
    progress.rows_total = rows_total;
    progress.rows_done = rows_total.map(|_| 0);
}

/// Record that an object finished successfully.
pub fn complete_object(progress: &mut CopyJobProgress) {
    progress.objects_done += 1;
    progress.rows_total = None;
    progress.rows_done = None;
}

/// Whether the job has been asked to cancel (checked at safe checkpoints).
pub fn should_cancel(progress: &CopyJobProgress) -> bool {
    progress.cancel_requested
}

#[cfg(not(coverage))]
pub use engine::{
    ensure_target_database, open_pool_for_profile, read_max_allowed_packet, read_source_charset,
    resolve_target_pool, run_copy, run_target_statement, target_database_exists, CopyJob,
    CopyJobMap, DatabaseEncoding, ResolvedTargetPool,
};
