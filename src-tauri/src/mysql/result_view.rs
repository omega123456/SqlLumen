//! Views over cached query-editor results: sort, filter, tombstones and windows.
//!
//! The Rust result cache is the single source of truth for a result's rows, row
//! order, row membership and row identity. Base rows (`StoredResult::rows`)
//! never move; a **view** is a permutation of base-row indices that encodes the
//! current sort, filter and tombstone exclusion. `None` is the identity view
//! (no sort, no filter, no tombstones) and costs no memory.
//!
//! The webview only ever sees **windows** of the view: a slice of rows plus the
//! parallel base indices that identify them.
//!
//! View writes are compare-and-swap: every request carries the view version
//! the frontend last saw, the view is built outside the cache lock, and the
//! write-back (under the in-place lock) only succeeds when the slot's version
//! still equals that base version. Otherwise it is refused with
//! `view_superseded: current=<n>`.
//!
//! Filter evaluation mirrors the previous JavaScript engine exactly (JS
//! `String()` / `Number()` coercion, TINYINT normalization), except that
//! `LIKE` is MySQL-like: `%` and `_` also match newlines.

use std::borrow::Cow;
use std::cmp::Ordering;
use std::collections::BTreeSet;
use std::sync::Arc;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::mysql::multi_result::minus_sign;
use crate::mysql::query_executor::{compare_json_values, ColumnMeta, SharedRow, StoredResult};
use crate::mysql::result_cache::{CachedResultEntry, SlotWrite};
use crate::state::AppState;

/// View version of a freshly stored result.
pub const INITIAL_VIEW_VERSION: u64 = 1;
/// Rows in the first window returned by every execute path.
pub const FIRST_WINDOW_ROWS: usize = 1_000;
/// Maximum rows per window or by-index request.
pub const MAX_WINDOW_ROWS: usize = 2_000;

/// Error returned when a tab's cached results expired (routed by the frontend).
pub const RESULTS_EXPIRED_MESSAGE: &str =
    "results_expired: Results for this tab have expired. Re-run the query to see results.";
/// Error returned when a request names a query id the slot no longer holds.
pub const STALE_QUERY_MESSAGE: &str =
    "Results were refreshed by a newer query. Re-run the query to continue.";
/// Prefix of the compare-and-swap refusal (`view_superseded: current=<n>`).
pub const VIEW_SUPERSEDED_PREFIX: &str = "view_superseded:";
/// Prefix of a window request against an old view version.
pub const VIEW_STALE_PREFIX: &str = "view_stale:";

// ── IPC shapes ──────────────────────────────────────────────────────────────────

/// Sort direction of a view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Asc,
    Desc,
}

/// The sort part of a view spec.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewSort {
    pub column: String,
    pub direction: SortDirection,
}

/// One filter condition (the frontend `FilterCondition` shape).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewFilterCondition {
    pub column: String,
    pub operator: String,
    #[serde(default)]
    pub value: String,
}

/// A complete view spec: optional sort plus filter conditions.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultViewSpec {
    #[serde(default)]
    pub sort: Option<ViewSort>,
    #[serde(default)]
    pub filters: Vec<ViewFilterCondition>,
}

impl ResultViewSpec {
    /// True when the spec neither sorts nor filters.
    pub fn is_empty(&self) -> bool {
        self.sort.is_none() && self.filters.is_empty()
    }
}

/// A slice of a result's current view.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResultWindow {
    /// View position of the first row.
    pub offset: usize,
    /// The rows, shared by pointer with the cache.
    pub rows: Vec<SharedRow>,
    /// Base-row index of each row (parallel to `rows`).
    pub base_indices: Vec<u32>,
}

/// Response for `set_result_view`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetResultViewResult {
    pub view_version: u64,
    pub view_row_count: usize,
    pub total_rows: usize,
    pub first_window: ResultWindow,
}

/// Response for `fetch_result_window`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResultWindowResult {
    pub offset: usize,
    pub rows: Vec<SharedRow>,
    pub base_indices: Vec<u32>,
    pub view_row_count: usize,
    pub view_version: u64,
}

/// Response for `remove_result_rows`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveResultRowsResult {
    pub view_version: u64,
    pub view_row_count: usize,
    pub total_rows: usize,
}

// ── JavaScript coercion parity ──────────────────────────────────────────────────

fn finite_compare_number(text: &str) -> Option<f64> {
    if text.is_empty() {
        return None;
    }
    Some(js_string_to_number(text)).filter(|number| number.is_finite())
}

/// JavaScript `Number.prototype.toString()` for a finite double.
pub fn js_number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return format!("{}Infinity", minus_sign(value < 0.0));
    }
    if value == 0.0 {
        return "0".to_string();
    }
    let sign = minus_sign(value < 0.0);
    // `{:e}` yields the shortest round-trip digits, e.g. "1.2345e-7".
    let sci = format!("{:e}", value.abs());
    let (mantissa, exponent) = sci.split_once('e').unwrap_or((sci.as_str(), "0"));
    let digits: String = mantissa
        .chars()
        .filter(|character| *character != '.')
        .collect();
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let point_position = exponent + 1;
    format!("{sign}{}", js_number_body(&digits, point_position))
}

const JS_MAX_FIXED_POINT_POSITION: i32 = 21;
const JS_MIN_FIXED_POINT_POSITION: i32 = -6;

fn js_number_body(digits: &str, point_position: i32) -> String {
    let digit_count = digits.len() as i32;
    let fits_fixed_notation = point_position <= JS_MAX_FIXED_POINT_POSITION;
    let is_whole_number = digit_count <= point_position && fits_fixed_notation;
    if is_whole_number {
        return format!(
            "{digits}{}",
            "0".repeat((point_position - digit_count) as usize)
        );
    }
    let has_inner_decimal_point = 0 < point_position && fits_fixed_notation;
    if has_inner_decimal_point {
        return format!(
            "{}.{}",
            &digits[..point_position as usize],
            &digits[point_position as usize..]
        );
    }
    let is_small_fraction = JS_MIN_FIXED_POINT_POSITION < point_position && point_position <= 0;
    if is_small_fraction {
        return format!("0.{}{digits}", "0".repeat((-point_position) as usize));
    }
    js_exponential_body(digits, point_position - 1)
}

fn js_exponential_body(digits: &str, exponent: i32) -> String {
    let exponent_sign = js_exponent_sign(exponent);
    let exponent_magnitude = exponent.abs();
    let has_single_digit = digits.len() == 1;
    if has_single_digit {
        return format!("{digits}e{exponent_sign}{exponent_magnitude}");
    }
    format!(
        "{}.{}e{exponent_sign}{exponent_magnitude}",
        &digits[..1],
        &digits[1..]
    )
}

fn js_exponent_sign(exponent: i32) -> char {
    if exponent < 0 {
        return '-';
    }
    '+'
}

fn json_number_as_f64(number: &serde_json::Number) -> f64 {
    if let Some(integer) = number.as_i64() {
        return integer as f64;
    }
    if let Some(unsigned) = number.as_u64() {
        return unsigned as f64;
    }
    number.as_f64().unwrap_or(f64::NAN)
}

/// JavaScript `String(value)` for a JSON cell value.
///
/// `null` → `"null"`, booleans → `"true"`/`"false"`, numbers per JS formatting,
/// objects → `"[object Object]"`, arrays → elements joined with `,` (with
/// `null` elements rendered as empty strings, as `Array.prototype.join` does).
pub fn js_string(value: &Value) -> Cow<'_, str> {
    match value {
        Value::Null => Cow::Borrowed("null"),
        Value::Bool(true) => Cow::Borrowed("true"),
        Value::Bool(false) => Cow::Borrowed("false"),
        Value::Number(number) => Cow::Owned(js_number_to_string(json_number_as_f64(number))),
        Value::String(text) => Cow::Borrowed(text.as_str()),
        Value::Array(items) => Cow::Owned(
            items
                .iter()
                .map(|item| match item {
                    Value::Null => Cow::Borrowed(""),
                    other => js_string(other),
                })
                .collect::<Vec<_>>()
                .join(","),
        ),
        Value::Object(_) => Cow::Borrowed("[object Object]"),
    }
}

/// JavaScript `WhiteSpace` + `LineTerminator` (the set `String.prototype.trim` removes).
fn is_js_whitespace(character: char) -> bool {
    matches!(
        character,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

const DECIMAL_POINT_BYTES: &[u8] = b".";
const EXPONENT_MARKER_BYTES: &[u8] = b"eE";
const EXPONENT_SIGN_BYTES: &[u8] = b"+-";

fn is_ascii_digit_at(bytes: &[u8], position: usize) -> bool {
    bytes.get(position).is_some_and(u8::is_ascii_digit)
}

fn has_any_byte_at(bytes: &[u8], position: usize, expected: &[u8]) -> bool {
    bytes
        .get(position)
        .is_some_and(|byte| expected.contains(byte))
}

/// True when `s` is a JS `StrUnsignedDecimalLiteral` (digits with an optional
/// fraction and exponent; at least one digit in the significand).
fn is_js_unsigned_decimal(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut position = 0;
    let int_start = position;
    while is_ascii_digit_at(bytes, position) {
        position += 1;
    }
    let mut digits = position - int_start;
    if has_any_byte_at(bytes, position, DECIMAL_POINT_BYTES) {
        position += 1;
        let frac_start = position;
        while is_ascii_digit_at(bytes, position) {
            position += 1;
        }
        digits += position - frac_start;
    }
    if digits == 0 {
        return false;
    }
    if has_any_byte_at(bytes, position, EXPONENT_MARKER_BYTES) {
        position += 1;
        if has_any_byte_at(bytes, position, EXPONENT_SIGN_BYTES) {
            position += 1;
        }
        let exp_start = position;
        while is_ascii_digit_at(bytes, position) {
            position += 1;
        }
        if position == exp_start {
            return false;
        }
    }
    position == bytes.len()
}

/// JavaScript `Number(string)` (`StringToNumber`): trims JS whitespace, `""`
/// becomes `0`, `0x`/`0o`/`0b` prefixes parse, `Infinity` parses (callers then
/// reject it as non-finite), and anything else that isn't a decimal literal is
/// `NaN`.
pub fn js_string_to_number(text: &str) -> f64 {
    let trimmed = text.trim_matches(is_js_whitespace);
    if trimmed.is_empty() {
        return 0.0;
    }
    let lower_prefix = trimmed.get(..2).map(str::to_ascii_lowercase);
    let radix = match lower_prefix.as_deref() {
        Some("0x") => Some(16),
        Some("0o") => Some(8),
        Some("0b") => Some(2),
        _ => None,
    };
    if let Some(radix) = radix {
        let body = &trimmed[2..];
        let is_radix_literal =
            !body.is_empty() && body.chars().all(|character| character.is_digit(radix));
        if !is_radix_literal {
            return f64::NAN;
        }
        return body.chars().fold(0.0, |acc, character| {
            acc * radix as f64 + character.to_digit(radix).unwrap_or(0) as f64
        });
    }
    let (sign, unsigned) = match trimmed.as_bytes()[0] {
        b'+' => (1.0, &trimmed[1..]),
        b'-' => (-1.0, &trimmed[1..]),
        _ => (1.0, trimmed),
    };
    if unsigned == "Infinity" {
        return sign * f64::INFINITY;
    }
    if !is_js_unsigned_decimal(unsigned) {
        return f64::NAN;
    }
    unsigned
        .parse::<f64>()
        .map(|magnitude| sign * magnitude)
        .unwrap_or(f64::NAN)
}

/// JavaScript `Number(value)` for a JSON cell value.
///
/// `true`/`false` → `1`/`0`, `null` → `0`, strings per [`js_string_to_number`],
/// arrays via their joined string (so a one-element array becomes its
/// element), objects → `NaN`.
pub fn js_number(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(true) => 1.0,
        Value::Bool(false) => 0.0,
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        Value::String(text) => js_string_to_number(text),
        Value::Array(_) => js_string_to_number(&js_string(value)),
        Value::Object(_) => f64::NAN,
    }
}

/// JS relational string comparison (UTF-16 code-unit order).
fn js_string_cmp(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

/// True for columns the frontend normalizes as TINYINT / boolean aliases.
pub fn is_tinyint_boolean_alias(data_type: &str) -> bool {
    matches!(
        data_type.trim().to_ascii_uppercase().as_str(),
        "BOOL" | "BOOLEAN" | "TINYINT" | "TINYINT(1)"
    )
}

/// The same 0/1 normalization `normalizeTinyIntRows` applies for display:
/// booleans and one-character strings with code 0 or 1 become numbers.
pub fn normalize_tinyint_value(value: &Value) -> Cow<'_, Value> {
    match value {
        Value::Bool(boolean) => Cow::Owned(Value::from(u8::from(*boolean))),
        Value::String(text) => {
            let mut chars = text.encode_utf16();
            match (chars.next(), chars.next()) {
                (Some(code @ (0 | 1)), None) => Cow::Owned(Value::from(code)),
                _ => Cow::Borrowed(value),
            }
        }
        _ => Cow::Borrowed(value),
    }
}

// ── Filters ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
enum CompareOp {
    Gt,
    Ge,
    Lt,
    Le,
}

impl CompareOp {
    fn holds(self, ordering: Ordering) -> bool {
        match self {
            Self::Gt => ordering == Ordering::Greater,
            Self::Ge => ordering != Ordering::Less,
            Self::Lt => ordering == Ordering::Less,
            Self::Le => ordering != Ordering::Greater,
        }
    }

    fn holds_f64(self, left: f64, right: f64) -> bool {
        match self {
            Self::Gt => left > right,
            Self::Ge => left >= right,
            Self::Lt => left < right,
            Self::Le => left <= right,
        }
    }
}

#[derive(Debug)]
enum FilterTest {
    IsNull,
    IsNotNull,
    Equals(String),
    NotEquals(String),
    Compare {
        op: CompareOp,
        text: String,
        number: Option<f64>,
    },
    Like {
        regex: Regex,
        negate: bool,
    },
}

/// A filter condition compiled once for fast per-row evaluation.
#[derive(Debug)]
pub struct CompiledFilter {
    column: usize,
    tinyint: bool,
    test: FilterTest,
}

impl CompiledFilter {
    fn comparable_cell<'a>(&self, raw: &'a Value) -> Cow<'a, Value> {
        if self.tinyint {
            return normalize_tinyint_value(raw);
        }
        Cow::Borrowed(raw)
    }

    /// Evaluate the condition against one row.
    pub fn matches(&self, row: &[Value]) -> bool {
        let raw = row.get(self.column).unwrap_or(&Value::Null);
        let cell = self.comparable_cell(raw);
        let cell = cell.as_ref();
        match &self.test {
            FilterTest::IsNull => cell.is_null(),
            FilterTest::IsNotNull => !cell.is_null(),
            FilterTest::Equals(value) => js_string(cell) == value.as_str(),
            FilterTest::NotEquals(value) => js_string(cell) != value.as_str(),
            FilterTest::Compare { op, text, number } => {
                if cell.is_null() {
                    return false;
                }
                if let Some(right) = number {
                    let left = js_number(cell);
                    if left.is_finite() {
                        return op.holds_f64(left, *right);
                    }
                }
                op.holds(js_string_cmp(&js_string(cell), text))
            }
            FilterTest::Like { regex, negate } => regex.is_match(&js_string(cell)) != *negate,
        }
    }
}

/// Translate a SQL `LIKE` pattern into an anchored, case-insensitive regex in
/// which `%` and `_` also match newlines (MySQL semantics). Other characters
/// are literal.
pub fn like_pattern_to_regex(pattern: &str) -> Result<Regex, String> {
    let mut source = String::from("(?is)^");
    for ch in pattern.chars() {
        match ch {
            '%' => source.push_str(".*"),
            '_' => source.push('.'),
            other => source.push_str(&regex::escape(other.encode_utf8(&mut [0; 4]))),
        }
    }
    source.push('$');
    Regex::new(&source).map_err(|error| format!("Invalid LIKE pattern: {error}"))
}

fn compile_filter(
    condition: &ViewFilterCondition,
    column: usize,
    columns: &[ColumnMeta],
) -> Result<CompiledFilter, String> {
    let test = match condition.operator.as_str() {
        "IS NULL" => FilterTest::IsNull,
        "IS NOT NULL" => FilterTest::IsNotNull,
        "==" => FilterTest::Equals(condition.value.clone()),
        "!=" => FilterTest::NotEquals(condition.value.clone()),
        ">" | ">=" | "<" | "<=" => {
            let op = match condition.operator.as_str() {
                ">" => CompareOp::Gt,
                ">=" => CompareOp::Ge,
                "<" => CompareOp::Lt,
                _ => CompareOp::Le,
            };
            let number = finite_compare_number(&condition.value);
            FilterTest::Compare {
                op,
                text: condition.value.clone(),
                number,
            }
        }
        "LIKE" | "NOT LIKE" => FilterTest::Like {
            regex: like_pattern_to_regex(&condition.value)?,
            negate: condition.operator == "NOT LIKE",
        },
        other => return Err(format!("Unsupported filter operator '{other}'")),
    };
    Ok(CompiledFilter {
        column,
        tinyint: is_tinyint_boolean_alias(&columns[column].data_type),
        test,
    })
}

// ── Spec resolution and view building ───────────────────────────────────────────

/// How strictly a view spec is validated against the result's columns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpecMode {
    /// `set_result_view`: an unknown sort column or operator is an error;
    /// conditions on unknown columns are dropped (as the JS engine did).
    Strict,
    /// Execute / re-execute: anything referring to a missing column (or an
    /// unknown operator) is dropped, so a re-run whose columns changed never fails.
    Lenient,
}

/// A view spec resolved against a result's columns.
#[derive(Debug)]
pub struct ResolvedSpec {
    /// The spec with dropped parts removed (stored on the result).
    pub effective: ResultViewSpec,
    sort: Option<(usize, SortDirection)>,
    filters: Vec<CompiledFilter>,
}

impl ResolvedSpec {
    fn is_identity(&self) -> bool {
        self.sort.is_none() && self.filters.is_empty()
    }
}

/// Validate and compile `spec` against `columns`.
pub fn resolve_spec(
    spec: &ResultViewSpec,
    columns: &[ColumnMeta],
    mode: SpecMode,
) -> Result<ResolvedSpec, String> {
    let position = |name: &str| columns.iter().position(|column| column.name == name);

    let mut effective = ResultViewSpec::default();
    let mut sort = None;
    if let Some(requested) = &spec.sort {
        match position(&requested.column) {
            Some(index) => {
                sort = Some((index, requested.direction));
                effective.sort = Some(requested.clone());
            }
            None if mode == SpecMode::Strict => {
                return Err(format!(
                    "Column '{}' not found in result set",
                    requested.column
                ));
            }
            None => {}
        }
    }

    let mut filters = Vec::with_capacity(spec.filters.len());
    for condition in &spec.filters {
        let Some(index) = position(&condition.column) else {
            continue;
        };
        match compile_filter(condition, index, columns) {
            Ok(compiled) => {
                filters.push(compiled);
                effective.filters.push(condition.clone());
            }
            Err(error) if mode == SpecMode::Strict => return Err(error),
            Err(error) => {
                tracing::warn!(error = %error, column = %condition.column, "dropping filter condition from re-run view spec");
            }
        }
    }

    Ok(ResolvedSpec {
        effective,
        sort,
        filters,
    })
}

/// Build the view permutation for `rows` under `resolved`, excluding
/// `tombstones`. Returns `None` (identity) when nothing sorts, filters or is
/// tombstoned. Filtering keeps base order; sorting is stable over it.
pub fn build_view(
    rows: &[SharedRow],
    tombstones: &BTreeSet<u32>,
    resolved: &ResolvedSpec,
) -> Option<Arc<Vec<u32>>> {
    let keeps_stored_order = resolved.is_identity() && tombstones.is_empty();
    if keeps_stored_order {
        return None;
    }
    let mut indices: Vec<u32> = (0..rows.len() as u32)
        .filter(|row_index| !tombstones.contains(row_index))
        .filter(|&row_index| {
            let row = &rows[row_index as usize];
            resolved.filters.iter().all(|filter| filter.matches(row))
        })
        .collect();
    if let Some((column, direction)) = resolved.sort {
        indices.sort_by(|&left, &right| {
            let va = rows[left as usize].get(column).unwrap_or(&Value::Null);
            let vb = rows[right as usize].get(column).unwrap_or(&Value::Null);
            let ordering = compare_json_values(va, vb);
            match direction {
                SortDirection::Asc => ordering,
                SortDirection::Desc => ordering.reverse(),
            }
        });
    }
    Some(Arc::new(indices))
}

/// Apply an execute / re-execute view spec to a freshly decoded result on the
/// blocking pool. Unknown columns are dropped; an empty or absent spec keeps
/// the identity view.
pub async fn apply_initial_view(
    mut stored: StoredResult,
    spec: Option<ResultViewSpec>,
) -> Result<StoredResult, String> {
    let Some(spec) = spec.filter(|spec_text| !spec_text.is_empty()) else {
        return Ok(stored);
    };
    tokio::task::spawn_blocking(move || {
        let resolved = resolve_spec(&spec, &stored.columns, SpecMode::Lenient)?;
        stored.view = build_view(&stored.rows, &stored.tombstones, &resolved);
        stored.view_spec = resolved.effective;
        Ok(stored)
    })
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "initial view build task failed");
        format!("View build task failed: {error}")
    })?
}

// ── Windows ─────────────────────────────────────────────────────────────────────

/// Number of rows in the result's current view.
pub fn view_len(stored: &StoredResult) -> usize {
    match &stored.view {
        Some(view) => view.len(),
        None => stored.rows.len(),
    }
}

/// Slice the view: `limit` is clamped to [`MAX_WINDOW_ROWS`] and `offset` to
/// the view length (an out-of-range offset yields an empty window, not an error).
pub fn slice_window(stored: &StoredResult, offset: usize, limit: usize) -> ResultWindow {
    let len = view_len(stored);
    let offset = offset.min(len);
    let end = offset + limit.min(MAX_WINDOW_ROWS).min(len - offset);
    let base_indices: Vec<u32> = match &stored.view {
        Some(view) => view[offset..end].to_vec(),
        None => (offset as u32..end as u32).collect(),
    };
    let rows = base_indices
        .iter()
        .map(|&row_index| Arc::clone(&stored.rows[row_index as usize]))
        .collect();
    ResultWindow {
        offset,
        rows,
        base_indices,
    }
}

/// The first window of the result's current view.
pub fn first_window(stored: &StoredResult) -> ResultWindow {
    slice_window(stored, 0, FIRST_WINDOW_ROWS)
}

/// All rows of the current view, in view order (for export). Copies row
/// pointers only.
pub fn view_rows(stored: &StoredResult) -> Vec<SharedRow> {
    match &stored.view {
        Some(view) => view
            .iter()
            .map(|&row_index| Arc::clone(&stored.rows[row_index as usize]))
            .collect(),
        None => (*stored.rows).clone(),
    }
}

// ── Command implementations ─────────────────────────────────────────────────────

fn superseded(current: u64) -> String {
    format!("{VIEW_SUPERSEDED_PREFIX} current={current}")
}

/// A validated result slot, borrowed from the cached entry without copying
/// the slot (its source SQL, columns and view metadata are not cloned per
/// window fetch).
pub(crate) struct SlotRef {
    entry: Arc<CachedResultEntry>,
    index: usize,
}

impl std::ops::Deref for SlotRef {
    type Target = StoredResult;

    fn deref(&self) -> &StoredResult {
        &self.entry.value[self.index]
    }
}

/// The target slot after validating expiry, index and query id.
fn read_slot(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    result_index: usize,
    query_id: &str,
) -> Result<SlotRef, String> {
    let cache_result = state.result_cache.get(connection_id, tab_id);
    if cache_result.is_expired() {
        return Err(RESULTS_EXPIRED_MESSAGE.to_string());
    }
    let entry = cache_result
        .into_entry()
        .ok_or_else(|| format!("No results found for tab '{tab_id}'"))?;
    let slot = entry.value.get(result_index).ok_or_else(|| {
        format!(
            "Result index {result_index} out of range (total: {})",
            entry.value.len()
        )
    })?;
    if slot.query_id != query_id {
        return Err(STALE_QUERY_MESSAGE.to_string());
    }
    Ok(SlotRef {
        entry,
        index: result_index,
    })
}

/// A view built outside the cache lock, waiting for its compare-and-swap write.
#[derive(Debug)]
pub struct PreparedView {
    connection_id: String,
    tab_id: String,
    result_index: usize,
    query_id: String,
    base_view_version: u64,
    expected_invalidation_version: u64,
    view: Option<Arc<Vec<u32>>>,
    effective_spec: ResultViewSpec,
}

/// First half of `set_result_view`: validate the request and build the new
/// view from the slot as it is now, without holding any cache lock.
pub fn prepare_result_view(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    result_index: usize,
    query_id: &str,
    base_view_version: u64,
    view_spec: &ResultViewSpec,
) -> Result<PreparedView, String> {
    let expected_invalidation_version = state
        .result_cache
        .current_invalidation_version(connection_id, tab_id);
    let slot = read_slot(state, connection_id, tab_id, result_index, query_id)?;
    if slot.view_version != base_view_version {
        return Err(superseded(slot.view_version));
    }
    let resolved = resolve_spec(view_spec, &slot.columns, SpecMode::Strict)?;
    let view = build_view(&slot.rows, &slot.tombstones, &resolved);
    Ok(PreparedView {
        connection_id: connection_id.to_string(),
        tab_id: tab_id.to_string(),
        result_index,
        query_id: query_id.to_string(),
        base_view_version,
        expected_invalidation_version,
        view,
        effective_spec: resolved.effective,
    })
}

fn map_slot_write<T>(outcome: SlotWrite<T>) -> Result<T, String> {
    match outcome {
        SlotWrite::Applied(value) => Ok(value),
        SlotWrite::ViewSuperseded { current } => Err(superseded(current)),
        SlotWrite::QueryIdMismatch | SlotWrite::Invalidated => Err(STALE_QUERY_MESSAGE.to_string()),
    }
}

/// Second half of `set_result_view`: write the prepared view back with
/// compare-and-swap on the base view version, bumping the version.
pub fn commit_result_view(
    state: &AppState,
    prepared: PreparedView,
) -> Result<SetResultViewResult, String> {
    let PreparedView {
        connection_id,
        tab_id,
        result_index,
        query_id,
        base_view_version,
        expected_invalidation_version,
        view,
        effective_spec,
    } = prepared;
    let outcome = state.result_cache.modify_slot_in_place_if_current(
        &connection_id,
        &tab_id,
        expected_invalidation_version,
        result_index,
        Some(&query_id),
        Some(base_view_version),
        |slot| {
            slot.view = view;
            slot.view_spec = effective_spec;
            slot.view_version += 1;
            Ok(slot.clone())
        },
    )?;
    let slot = map_slot_write(outcome).inspect_err(|error| {
        tracing::debug!(connection_id = %connection_id, tab_id = %tab_id, error = %error, "set_result_view write refused");
    })?;
    Ok(SetResultViewResult {
        view_version: slot.view_version,
        view_row_count: view_len(&slot),
        total_rows: slot.live_row_count(),
        first_window: first_window(&slot),
    })
}

/// Replace a result's whole view spec (sort plus filters) and return the first
/// window of the new view. Refused with `view_superseded: current=<n>` when
/// `base_view_version` is not the slot's current version.
pub fn set_result_view_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    result_index: usize,
    query_id: &str,
    base_view_version: u64,
    view_spec: &ResultViewSpec,
) -> Result<SetResultViewResult, String> {
    let prepared = prepare_result_view(
        state,
        connection_id,
        tab_id,
        result_index,
        query_id,
        base_view_version,
        view_spec,
    )?;
    commit_result_view(state, prepared)
}

/// Fetch a window of the result's current view. Refused with `view_stale:`
/// when `view_version` is not the current version.
#[allow(clippy::too_many_arguments)]
pub fn fetch_result_window_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    result_index: usize,
    query_id: &str,
    view_version: u64,
    offset: usize,
    limit: usize,
) -> Result<FetchResultWindowResult, String> {
    let slot = read_slot(state, connection_id, tab_id, result_index, query_id)?;
    if slot.view_version != view_version {
        return Err(format!(
            "{VIEW_STALE_PREFIX} requested={view_version} current={}",
            slot.view_version
        ));
    }
    let window = slice_window(&slot, offset, limit);
    Ok(FetchResultWindowResult {
        offset: window.offset,
        rows: window.rows,
        base_indices: window.base_indices,
        view_row_count: view_len(&slot),
        view_version: slot.view_version,
    })
}

/// Tombstone deleted rows: they leave the view, counts, windows and export,
/// while base indices never shift. Compare-and-swap on the base view version
/// (tombstoning is idempotent, so the frontend may retry against `<n>`).
pub fn remove_result_rows_impl(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    result_index: usize,
    query_id: &str,
    base_view_version: u64,
    base_indices: &[u32],
) -> Result<RemoveResultRowsResult, String> {
    let expected_invalidation_version = state
        .result_cache
        .current_invalidation_version(connection_id, tab_id);
    let slot = read_slot(state, connection_id, tab_id, result_index, query_id)?;
    if slot.view_version != base_view_version {
        return Err(superseded(slot.view_version));
    }

    let row_count = slot.rows.len() as u32;
    let mut tombstones = (*slot.tombstones).clone();
    tombstones.extend(
        base_indices
            .iter()
            .copied()
            .filter(|&row_index| row_index < row_count),
    );
    let view: Vec<u32> = match &slot.view {
        Some(view) => view
            .iter()
            .copied()
            .filter(|row_index| !tombstones.contains(row_index))
            .collect(),
        None => (0..row_count)
            .filter(|row_index| !tombstones.contains(row_index))
            .collect(),
    };
    let tombstones = Arc::new(tombstones);
    let view = Arc::new(view);

    let outcome = state.result_cache.modify_slot_in_place_if_current(
        connection_id,
        tab_id,
        expected_invalidation_version,
        result_index,
        Some(query_id),
        Some(base_view_version),
        |slot| {
            slot.tombstones = tombstones;
            slot.view = Some(view);
            slot.view_version += 1;
            Ok(RemoveResultRowsResult {
                view_version: slot.view_version,
                view_row_count: view_len(slot),
                total_rows: slot.live_row_count(),
            })
        },
    )?;
    map_slot_write(outcome)
}
