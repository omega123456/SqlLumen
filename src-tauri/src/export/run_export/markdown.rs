use super::RunOutcome;
use super::csv_files::ResultFileRecord;
use super::registry::RunDescription;
use crate::mysql::query_executor::{
    StoredResult, get_first_keyword, returns_result_set, strip_non_executable_comments,
};

const BLOCK_SEPARATOR: &str = "\n\n";
const LINE_SEPARATOR: &str = "\n";
const TABLE_PIPE: &str = "|";
const ESCAPED_TABLE_PIPE: &str = "\\|";
const NO_DATABASE: &str = "none";
const CSV_CONVENTIONS: &str =
    "Every row of each result, in query order. Header row; NULL is \\N; binary values are 0x hex";
const RUNNING_STATUS: &str = "Status: running. Results are still being written.";
const NOT_RUN_YET: &str = "Not run yet.";
const PARTLY_RUN_NOTE: &str = "The statement may have partly run.";

pub struct FinalReport<'a> {
    pub description: &'a RunDescription,
    pub results: &'a [StoredResult],
    pub records: &'a [ResultFileRecord],
    pub outcome: &'a RunOutcome,
}

struct HeaderRow {
    field: &'static str,
    value: String,
}

struct StatementBody {
    summary: String,
    details: String,
}

struct DocumentParts {
    status: String,
    header: String,
    sections: Vec<String>,
}

struct StatementResults<'a> {
    results: Vec<&'a StoredResult>,
    records: Vec<&'a ResultFileRecord>,
}

pub fn running_document(description: &RunDescription) -> String {
    let statement_sections: Vec<String> = description
        .statements
        .iter()
        .enumerate()
        .map(|(statement_index, sql)| {
            let body = StatementBody {
                summary: "waiting".to_string(),
                details: NOT_RUN_YET.to_string(),
            };
            statement_section(statement_index, sql, &body)
        })
        .collect();
    let parts = DocumentParts {
        status: RUNNING_STATUS.to_string(),
        header: header_table(description, Vec::new()),
        sections: statement_sections,
    };
    document(description, parts)
}

pub fn final_document(report: &FinalReport<'_>) -> String {
    let description = report.description;
    let duration = HeaderRow {
        field: "Duration",
        value: format!("{} ms", total_time_ms(report.results)),
    };
    let statement_sections: Vec<String> = description
        .statements
        .iter()
        .enumerate()
        .map(|(statement_index, sql)| {
            let body = statement_body(report, statement_index);
            statement_section(statement_index, sql, &body)
        })
        .collect();
    let parts = DocumentParts {
        status: status_line(report),
        header: header_table(description, vec![duration]),
        sections: statement_sections,
    };
    document(description, parts)
}

fn document(description: &RunDescription, parts: DocumentParts) -> String {
    let DocumentParts {
        status,
        header,
        sections,
    } = parts;
    let mut blocks = vec![
        format!("# SqlLumen run: {}", description.tab_title),
        status,
        header,
    ];
    blocks.extend(sections);
    blocks.join(BLOCK_SEPARATOR) + LINE_SEPARATOR
}

fn header_table(description: &RunDescription, extra_rows: Vec<HeaderRow>) -> String {
    let database = description
        .connection
        .database
        .clone()
        .unwrap_or_else(|| NO_DATABASE.to_string());
    let mut rows = vec![
        HeaderRow {
            field: "Connection",
            value: description.connection.description.clone(),
        },
        HeaderRow {
            field: "Database",
            value: database,
        },
        HeaderRow {
            field: "Started (UTC)",
            value: description.started_at.clone(),
        },
        HeaderRow {
            field: "Result grid",
            value: format!(
                "Shows the first {} rows of each result",
                description.row_ceiling
            ),
        },
        HeaderRow {
            field: "CSV files",
            value: CSV_CONVENTIONS.to_string(),
        },
    ];
    rows.extend(extra_rows);
    let mut lines = vec!["| Field | Value |".to_string(), "|---|---|".to_string()];
    lines.extend(
        rows.iter()
            .map(|row| format!("| {} | {} |", row.field, table_cell(&row.value))),
    );
    lines.join(LINE_SEPARATOR)
}

fn total_time_ms(results: &[StoredResult]) -> u64 {
    results.iter().map(|stored| stored.total_time_ms).sum()
}

fn status_line(report: &FinalReport<'_>) -> String {
    let statement_count = report.description.statements.len();
    match report.outcome {
        RunOutcome::Complete => {
            format!("Status: complete. All {statement_count} statements ran.")
        }
        RunOutcome::Cancelled { statement_number } => format!(
            "Status: cancelled at statement {statement_number} of {statement_count}.{}",
            remaining_statements_text(*statement_number, statement_count)
        ),
        RunOutcome::Stopped { statement_number } => format!(
            "Status: stopped at statement {statement_number} of {statement_count} on an error.{}",
            remaining_statements_text(*statement_number, statement_count)
        ),
        RunOutcome::WriteFailed {
            statement_number,
            file_name,
        } => format!(
            "Status: stopped at statement {statement_number} of {statement_count}: couldn't write {file_name}.{}",
            remaining_statements_text(*statement_number, statement_count)
        ),
        RunOutcome::Failed { message } => format!("Status: failed. {message}"),
    }
}

fn remaining_statements_text(statement_number: usize, statement_count: usize) -> String {
    let first_remaining = statement_number + 1;
    if first_remaining > statement_count {
        return String::new();
    }
    if first_remaining == statement_count {
        return format!(" Statement {statement_count} did not run.");
    }
    format!(" Statements {first_remaining}–{statement_count} did not run.")
}

fn table_cell(value: &str) -> String {
    value
        .replace(TABLE_PIPE, ESCAPED_TABLE_PIPE)
        .replace(LINE_SEPARATOR, " ")
}

fn statement_section(statement_index: usize, sql: &str, body: &StatementBody) -> String {
    let sql = sql.trim();
    let heading = format!(
        "## {}. {}: {}",
        statement_index + 1,
        statement_kind(sql),
        body.summary
    );
    [heading, format!("```sql\n{sql}\n```"), body.details.clone()].join(BLOCK_SEPARATOR)
}

fn statement_kind(sql: &str) -> String {
    get_first_keyword(&strip_non_executable_comments(sql))
}

fn statement_results<'a>(report: &FinalReport<'a>, statement_index: usize) -> StatementResults<'a> {
    StatementResults {
        results: report
            .results
            .iter()
            .filter(|stored| stored.statement_index == statement_index)
            .collect(),
        records: report
            .records
            .iter()
            .filter(|record| record.key.statement_index == statement_index)
            .collect(),
    }
}

fn statement_body(report: &FinalReport<'_>, statement_index: usize) -> StatementBody {
    let executed = statement_results(report, statement_index);
    let Some(first) = executed.results.first() else {
        return not_run_body(report.outcome);
    };
    if let Some(error_message) = &first.error_message {
        let sql = &report.description.statements[statement_index];
        return error_body(error_message, sql, &executed.records);
    }
    if executed.records.is_empty() {
        return affected_rows_body(first);
    }
    if executed.records.len() > 1 {
        return result_sets_body(&executed);
    }
    result_set_body(first, executed.records[0])
}

fn not_run_body(outcome: &RunOutcome) -> StatementBody {
    let details = match outcome {
        RunOutcome::Failed { .. } => "May not have run: the run failed before results came back.",
        _ => "Did not run.",
    };
    StatementBody {
        summary: "not run".to_string(),
        details: details.to_string(),
    }
}

fn error_body(error_message: &str, sql: &str, records: &[&ResultFileRecord]) -> StatementBody {
    let mut lines = vec![format!("Error: {error_message}")];
    let may_have_partly_run = !returns_result_set(&strip_non_executable_comments(sql));
    if may_have_partly_run {
        lines.push(PARTLY_RUN_NOTE.to_string());
    }
    lines.extend(records.iter().map(|record| file_line(record)));
    StatementBody {
        summary: "error".to_string(),
        details: lines.join(LINE_SEPARATOR),
    }
}

fn result_set_body(stored: &StoredResult, record: &ResultFileRecord) -> StatementBody {
    StatementBody {
        summary: format!("{} rows", record.rows_written),
        details: format!(
            "Rows: {}. Time: {} ms. {}",
            record.rows_written,
            stored.total_time_ms,
            file_line(record)
        ),
    }
}

fn result_sets_body(executed: &StatementResults<'_>) -> StatementBody {
    let lines: Vec<String> = executed
        .records
        .iter()
        .enumerate()
        .map(|(set_index, record)| {
            format!(
                "- Result set {}: {} rows. {}",
                set_index + 1,
                record.rows_written,
                file_line(record)
            )
        })
        .collect();
    StatementBody {
        summary: format!("{} result sets", executed.records.len()),
        details: lines.join(LINE_SEPARATOR),
    }
}

fn affected_rows_body(stored: &StoredResult) -> StatementBody {
    StatementBody {
        summary: format!("{} rows affected", stored.affected_rows),
        details: format!(
            "Affected rows: {}. Time: {} ms.",
            stored.affected_rows, stored.total_time_ms
        ),
    }
}

fn file_line(record: &ResultFileRecord) -> String {
    let path = record.path.display();
    if record.is_complete {
        return format!("File: {path}");
    }
    format!(
        "File: {path} (incomplete: {} rows written before the run stopped)",
        record.rows_written
    )
}
