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
