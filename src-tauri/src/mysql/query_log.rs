//! Debug logging for SQL sent to MySQL and raw rows before app serialization.

use sqlx::mysql::MySqlRow;
use sqlx::{Column, Row, TypeInfo};

pub const TARGET: &str = "mysql_traffic";

pub fn log_outgoing_sql(sql: &str) {
    tracing::debug!(target: TARGET, %sql, "mysql outgoing query");
}

/// Log a parameterized statement with bound values (for visibility into what the client sends).
pub fn log_outgoing_sql_bound(sql: &str, binds: &[String]) {
    tracing::debug!(target: TARGET, %sql, ?binds, "mysql outgoing query (bound)");
}

/// Secondary client call for metadata (e.g. sqlx `describe`), not a separate MySQL text protocol query string.
pub fn log_sqlx_describe(sql: &str) {
    tracing::debug!(target: TARGET, %sql, "mysql sqlx describe (column metadata)");
}

fn format_cell(row: &MySqlRow, i: usize) -> String {
    let type_name = row.column(i).type_info().name().to_uppercase();

    if type_name.contains("INT") || type_name == "YEAR" {
        if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
            return format!("{v:?}");
        }
        if let Ok(v) = row.try_get::<Option<u64>, _>(i) {
            return format!("{v:?}");
        }
        if let Ok(v) = row.try_get::<Option<String>, _>(i) {
            return format!("{v:?}");
        }
    }

    if type_name.contains("FLOAT") || type_name.contains("DOUBLE") {
        if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
            return format!("{v:?}");
        }
    }

    if type_name.contains("DECIMAL") || type_name.contains("NUMERIC") {
        if let Ok(v) = row.try_get::<Option<String>, _>(i) {
            return format!("{v:?}");
        }
    }

    if type_name == "BOOL" || type_name == "BOOLEAN" {
        if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
            return format!("{v:?}");
        }
    }

    if type_name.contains("BLOB") || type_name == "BINARY" || type_name == "VARBINARY" {
        if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(i) {
            return format!("bytes(len={})", v.as_ref().map(|b| b.len()).unwrap_or(0));
        }
    }

    match row.try_get::<Option<String>, _>(i) {
        Ok(v) => format!("{v:?}"),
        Err(e) => format!("<decode_error: {e}>"),
    }
}

fn format_mysql_row(row: &MySqlRow) -> String {
    let mut parts = Vec::new();
    for i in 0..row.len() {
        let name = row.column(i).name();
        let val = format_cell(row, i);
        parts.push(format!("{name}={val}"));
    }
    parts.join(", ")
}

pub fn log_mysql_rows(rows: &[MySqlRow]) {
    tracing::debug!(target: TARGET, row_count = rows.len(), "mysql result rows (pre-serialize)");
    for (i, row) in rows.iter().enumerate() {
        let s = format_mysql_row(row);
        tracing::debug!(target: TARGET, row_index = i, row = %s, "mysql row");
    }
}

/// Log a single row (e.g. `fetch_one` / `COUNT(*)`).
pub fn log_mysql_row(row: &MySqlRow) {
    log_mysql_rows(std::slice::from_ref(row));
}

pub fn log_execute_result(r: &sqlx::mysql::MySqlQueryResult) {
    tracing::debug!(
        target: TARGET,
        rows_affected = r.rows_affected(),
        last_insert_id = r.last_insert_id(),
        "mysql execute result",
    );
}
