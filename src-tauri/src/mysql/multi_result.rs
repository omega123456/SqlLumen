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
    #[cfg(not(coverage))]
    fn in_statement(mut self, statement_index: usize) -> Self {
        self.stored.statement_index = statement_index;
        self
    }

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

#[cfg(not(coverage))]
struct StatementFailure<'a> {
    sql: &'a str,
    statement_index: usize,
    error_message: String,
}

impl BatchResults {
    #[cfg(not(coverage))]
    fn push(&mut self, outcome: StatementOutcome) {
        self.stored_results.push(outcome.stored);
        self.result_items.push(outcome.item);
    }

    #[cfg(not(coverage))]
    fn push_error(&mut self, failure: StatementFailure<'_>) {
        let StatementFailure {
            sql,
            statement_index,
            error_message,
        } = failure;
        use crate::mysql::query_executor::{MultiQueryResultItem, StoredResult};

        let mut result = StoredResult::empty(uuid::Uuid::new_v4().to_string());
        result.source_sql = sql.to_string();
        result.statement_index = statement_index;
        result.error_message = Some(error_message.clone());
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

#[derive(Clone, Copy)]
pub struct StatementBatch<'a> {
    pub statements: &'a [String],
    pub row_limit: usize,
    pub is_read_only: bool,
    pub run: Option<&'a crate::export::run_export::RunSession>,
}

impl StatementBatch<'_> {
    #[cfg(not(coverage))]
    fn is_run_cancelled(&self) -> bool {
        self.run
            .is_some_and(crate::export::run_export::RunSession::is_cancel_requested)
    }

    #[cfg(not(coverage))]
    fn begin_statement(&self, statement_index: usize) {
        if let Some(session) = self.run {
            session.begin_statement(statement_index);
        }
    }
}
