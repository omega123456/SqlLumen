use crate::export::sql_dump::SqlDumpValue;
use crate::state::{CopyJobProgress, CopyJobStatus};
use serde::{Deserialize, Serialize};

mod ddl;
#[cfg(not(coverage))]
mod engine;

pub use ddl::*;

pub const COPY_BATCH_ROW_CAP: usize = 1_000;

pub const FALLBACK_PACKET_BYTES: u64 = 4 * 1024 * 1024;

pub const PACKET_BUDGET_FRACTION: f64 = 0.5;

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
    pub fn ddl_type_str(self) -> &'static str {
        match self {
            CopyObjectType::Table => "table",
            CopyObjectType::Procedure => "procedure",
            CopyObjectType::Function => "function",
            CopyObjectType::Trigger => "trigger",
            CopyObjectType::Event => "event",
        }
    }

    pub fn supports_definer(self) -> bool {
        !matches!(self, CopyObjectType::Table)
    }

    pub fn label(self) -> &'static str {
        self.ddl_type_str()
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InsertMode {
    #[default]
    Insert,
    InsertIgnore,
    Replace,
}

impl InsertMode {
    pub fn keyword(self) -> &'static str {
        match self {
            InsertMode::Insert => "INSERT INTO",
            InsertMode::InsertIgnore => "INSERT IGNORE INTO",
            InsertMode::Replace => "REPLACE INTO",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyOptions {
    pub copy_structure: bool,
    pub copy_data: bool,
    pub drop_if_exists: bool,
    pub create_if_not_exists: bool,
    pub truncate_before_insert: bool,
    pub insert_mode: InsertMode,
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

    pub fn has_non_table_objects(&self) -> bool {
        !self.procedures.is_empty()
            || !self.functions.is_empty()
            || !self.triggers.is_empty()
            || !self.events.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyToHostParams {
    pub source_connection_id: String,
    pub source_database: String,
    pub target_connection_id: String,
    pub target_database: String,
    pub objects: CopySelection,
    pub options: CopyOptions,
}

pub fn has_cross_database_non_table_copy(
    selection: &CopySelection,
    source_database: &str,
    target_database: &str,
) -> bool {
    !source_database.eq_ignore_ascii_case(target_database) && selection.has_non_table_objects()
}

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

pub fn batch_byte_budget(max_allowed_packet: Option<u64>) -> u64 {
    let base = match max_allowed_packet {
        Some(packet_bytes) if packet_bytes > 0 => packet_bytes,
        _ => FALLBACK_PACKET_BYTES,
    };
    let budget = (base as f64 * PACKET_BUDGET_FRACTION) as u64;
    budget.max(1024)
}

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

pub const FK_CHECKS_DISABLE: &str = "SET FOREIGN_KEY_CHECKS = 0";
pub const FK_CHECKS_ENABLE: &str = "SET FOREIGN_KEY_CHECKS = 1";

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

pub fn complete_object(progress: &mut CopyJobProgress) {
    progress.objects_done += 1;
    progress.rows_total = None;
    progress.rows_done = None;
}

pub fn should_cancel(progress: &CopyJobProgress) -> bool {
    progress.cancel_requested
}

#[cfg(not(coverage))]
pub use engine::{
    ensure_target_database, open_pool_for_profile, read_max_allowed_packet, read_source_charset,
    resolve_target_pool, run_copy, run_target_statement, target_database_exists, CopyJob,
    CopyJobMap, DatabaseEncoding, ResolvedTargetPool,
};
