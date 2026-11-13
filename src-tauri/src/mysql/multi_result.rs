//! Batch SQL execution and stored procedure multi-result-set retrieval using `mysql_async`.
//!
//! This module handles:
//! - **Batch execution** (`execute_multi_query`): Executes multiple SQL statements sequentially
//!   on a single `mysql_async` connection, preserving session state.
//! - **CALL execution** (`execute_call_query`): Executes a single `CALL` statement and collects
//!   all returned result sets.
//!
//! Statements run on the connection's shared editor session (`crate::mysql::session`), so
//! session state carries over between runs and query windows. Cancel support is provided via
//! thread ID registration before any statements execute.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
#[cfg(not(coverage))]
use std::sync::Arc;

#[cfg(not(coverage))]
mod batch;
#[cfg(not(coverage))]
mod ceiling;
#[cfg(not(coverage))]
mod connection;
#[cfg(not(coverage))]
mod row_stream;
#[cfg(not(coverage))]
mod statements;
mod value_serialization;
#[cfg(not(coverage))]
pub use batch::*;
#[cfg(not(coverage))]
pub use ceiling::*;
#[cfg(not(coverage))]
pub use connection::*;
#[cfg(not(coverage))]
pub(crate) use row_stream::*;
#[cfg(not(coverage))]
use statements::*;
pub use value_serialization::*;

/// Maximum safe integer in JavaScript (Number.MAX_SAFE_INTEGER = 2^53 - 1).
pub const JS_SAFE_INTEGER_MAX: i64 = 9_007_199_254_740_991;

pub fn json_from_i64(number: i64) -> serde_json::Value {
    let is_safe_integer = (-JS_SAFE_INTEGER_MAX..=JS_SAFE_INTEGER_MAX).contains(&number);
    if is_safe_integer {
        return serde_json::Value::from(number);
    }
    serde_json::Value::String(number.to_string())
}

pub fn json_from_u64(number: u64) -> serde_json::Value {
    if number > JS_SAFE_INTEGER_MAX as u64 {
        return serde_json::Value::String(number.to_string());
    }
    serde_json::Value::from(number)
}

/// Returns `true` if the SQL statement is a CALL statement.
///
/// Strips non-executable comments and checks the first keyword (case-insensitive).
pub fn is_call_statement(sql: &str) -> bool {
    let stripped = crate::mysql::query_executor::strip_non_executable_comments(sql);
    let keyword = crate::mysql::query_executor::get_first_keyword(&stripped);
    keyword == "CALL"
}

pub struct StatementOutcome {
    pub stored: crate::mysql::query_executor::StoredResult,
    pub item: crate::mysql::query_executor::MultiQueryResultItem,
}

impl StatementOutcome {
    pub fn from_stored(
        stored: crate::mysql::query_executor::StoredResult,
        re_executable: bool,
    ) -> Self {
        let item = crate::mysql::query_executor::MultiQueryResultItem::from_stored(
            &stored,
            None,
            re_executable,
        );
        Self { stored, item }
    }
}

#[derive(Default)]
pub struct BatchResults {
    pub stored_results: Vec<crate::mysql::query_executor::StoredResult>,
    pub result_items: Vec<crate::mysql::query_executor::MultiQueryResultItem>,
}

impl BatchResults {
    #[cfg(not(coverage))]
    fn push(&mut self, outcome: StatementOutcome) {
        self.stored_results.push(outcome.stored);
        self.result_items.push(outcome.item);
    }

    #[cfg(not(coverage))]
    fn push_error(&mut self, sql: &str, error_message: String) {
        use crate::mysql::query_executor::{MultiQueryResultItem, StoredResult};

        let mut result = StoredResult::empty(uuid::Uuid::new_v4().to_string());
        result.source_sql = sql.to_string();
        self.result_items.push(MultiQueryResultItem::from_stored(
            &result,
            Some(error_message),
            false,
        ));
        self.stored_results.push(result);
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SessionStatement<'a> {
    pub sql: &'a str,
    pub row_limit: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct StatementBatch<'a> {
    pub statements: &'a [String],
    pub row_limit: usize,
    pub is_read_only: bool,
}
