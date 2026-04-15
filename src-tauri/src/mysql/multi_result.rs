//! Batch SQL execution and stored procedure multi-result-set retrieval using `mysql_async`.
//!
//! This module handles:
//! - **Batch execution** (`execute_multi_query`): Executes multiple SQL statements sequentially
//!   on a single `mysql_async` connection, preserving session state.
//! - **CALL execution** (`execute_call_query`): Executes a single `CALL` statement and collects
//!   all returned result sets.
//!
//! Connections are not pooled — created on-demand and disconnected after the batch completes.
//! Cancel support is provided via thread ID registration before any statements execute.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

/// Maximum safe integer in JavaScript (Number.MAX_SAFE_INTEGER = 2^53 - 1).
pub const JS_SAFE_INTEGER_MAX: i64 = 9_007_199_254_740_991;

// ── Statement classification ───────────────────────────────────────────────────

/// Returns `true` if the SQL statement is a CALL statement.
///
/// Strips non-executable comments and checks the first keyword (case-insensitive).
pub fn is_call_statement(sql: &str) -> bool {
    let stripped = crate::mysql::query_executor::strip_non_executable_comments(sql);
    let keyword = crate::mysql::query_executor::get_first_keyword(&stripped);
    keyword == "CALL"
}

// ── Column type display ────────────────────────────────────────────────────────

/// Map a `mysql_async::consts::ColumnType` to a human-readable display name
/// that matches the strings returned by `sqlx` for consistency.
///
/// Uses the column flags to distinguish UNSIGNED variants and BINARY types.
pub fn column_type_display_name(
    col_type: mysql_async::consts::ColumnType,
    flags: mysql_async::consts::ColumnFlags,
) -> String {
    use mysql_async::consts::ColumnType::*;

    let is_unsigned = flags.contains(mysql_async::consts::ColumnFlags::UNSIGNED_FLAG);
    let is_binary = flags.contains(mysql_async::consts::ColumnFlags::BINARY_FLAG);

    match col_type {
        MYSQL_TYPE_TINY => {
            if is_unsigned {
                "TINYINT UNSIGNED".to_string()
            } else {
                "TINYINT".to_string()
            }
        }
        MYSQL_TYPE_SHORT => {
            if is_unsigned {
                "SMALLINT UNSIGNED".to_string()
            } else {
                "SMALLINT".to_string()
            }
        }
        MYSQL_TYPE_INT24 => {
            if is_unsigned {
                "MEDIUMINT UNSIGNED".to_string()
            } else {
                "MEDIUMINT".to_string()
            }
        }
        MYSQL_TYPE_LONG => {
            if is_unsigned {
                "INT UNSIGNED".to_string()
            } else {
                "INT".to_string()
            }
        }
        MYSQL_TYPE_LONGLONG => {
            if is_unsigned {
                "BIGINT UNSIGNED".to_string()
            } else {
                "BIGINT".to_string()
            }
        }
        MYSQL_TYPE_FLOAT => "FLOAT".to_string(),
        MYSQL_TYPE_DOUBLE => "DOUBLE".to_string(),
        MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => "DECIMAL".to_string(),
        MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE => "DATE".to_string(),
        MYSQL_TYPE_DATETIME | MYSQL_TYPE_DATETIME2 => "DATETIME".to_string(),
        MYSQL_TYPE_TIMESTAMP | MYSQL_TYPE_TIMESTAMP2 => "TIMESTAMP".to_string(),
        MYSQL_TYPE_TIME | MYSQL_TYPE_TIME2 => "TIME".to_string(),
        MYSQL_TYPE_YEAR => "YEAR".to_string(),
        MYSQL_TYPE_BIT => "BIT".to_string(),
        MYSQL_TYPE_JSON => "JSON".to_string(),
        MYSQL_TYPE_ENUM => "ENUM".to_string(),
        MYSQL_TYPE_SET => "SET".to_string(),
        MYSQL_TYPE_TINY_BLOB => {
            if is_binary {
                "TINYBLOB".to_string()
            } else {
                "TINYTEXT".to_string()
            }
        }
        MYSQL_TYPE_BLOB => {
            if is_binary {
                "BLOB".to_string()
            } else {
                "TEXT".to_string()
            }
        }
        MYSQL_TYPE_MEDIUM_BLOB => {
            if is_binary {
                "MEDIUMBLOB".to_string()
            } else {
                "MEDIUMTEXT".to_string()
            }
        }
        MYSQL_TYPE_LONG_BLOB => {
            if is_binary {
                "LONGBLOB".to_string()
            } else {
                "LONGTEXT".to_string()
            }
        }
        MYSQL_TYPE_STRING => {
            if is_binary {
                "BINARY".to_string()
            } else {
                "CHAR".to_string()
            }
        }
        MYSQL_TYPE_VAR_STRING => {
            if is_binary {
                "VARBINARY".to_string()
            } else {
                "VARCHAR".to_string()
            }
        }
        MYSQL_TYPE_GEOMETRY => "GEOMETRY".to_string(),
        MYSQL_TYPE_NULL => "NULL".to_string(),
        _ => format!("{:?}", col_type),
    }
}

// ── Value serialization ────────────────────────────────────────────────────────

/// Serialize raw bytes from a Bytes value, using context from the column type.
///
/// This handles the dispatch logic for `mysql_async::Value::Bytes(...)` which is
/// used for strings, DECIMAL, BIT, and BLOB/BINARY types.
pub fn serialize_bytes_value(
    bytes: &[u8],
    col_type: mysql_async::consts::ColumnType,
    flags: mysql_async::consts::ColumnFlags,
) -> serde_json::Value {
    use mysql_async::consts::ColumnType::*;

    let is_binary = flags.contains(mysql_async::consts::ColumnFlags::BINARY_FLAG);

    match col_type {
        // BIT: convert bytes to u64 integer
        MYSQL_TYPE_BIT => {
            let mut val: u64 = 0;
            for &b in bytes {
                val = (val << 8) | (b as u64);
            }
            if val > JS_SAFE_INTEGER_MAX as u64 {
                serde_json::Value::String(val.to_string())
            } else {
                serde_json::Value::from(val)
            }
        }

        // DECIMAL/NUMERIC: string to preserve precision
        MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => {
            let s = String::from_utf8_lossy(bytes);
            serde_json::Value::String(s.into_owned())
        }

        // BLOB/BINARY types: base64-encode if binary flag is set
        MYSQL_TYPE_TINY_BLOB | MYSQL_TYPE_BLOB | MYSQL_TYPE_MEDIUM_BLOB | MYSQL_TYPE_LONG_BLOB => {
            if is_binary {
                serde_json::Value::String(BASE64_STANDARD.encode(bytes))
            } else {
                serde_json::Value::String(String::from_utf8_lossy(bytes).into_owned())
            }
        }

        // BINARY / VARBINARY
        MYSQL_TYPE_STRING | MYSQL_TYPE_VAR_STRING if is_binary => {
            serde_json::Value::String(BASE64_STANDARD.encode(bytes))
        }

        // JSON type — return as string (it's already JSON text, but we wrap it)
        MYSQL_TYPE_JSON => serde_json::Value::String(String::from_utf8_lossy(bytes).into_owned()),

        // All other Bytes values (VARCHAR, TEXT, ENUM, SET, etc.) — UTF-8 string
        _ => serde_json::Value::String(String::from_utf8_lossy(bytes).into_owned()),
    }
}

/// Serialize a single `mysql_async::Value` to a `serde_json::Value`,
/// matching the output format of the existing sqlx `serialize_value` function.
pub fn serialize_mysql_value(
    value: &mysql_async::Value,
    col_type: mysql_async::consts::ColumnType,
    flags: mysql_async::consts::ColumnFlags,
) -> serde_json::Value {
    match value {
        mysql_async::Value::NULL => serde_json::Value::Null,

        mysql_async::Value::Bytes(bytes) => serialize_bytes_value(bytes, col_type, flags),

        mysql_async::Value::Int(n) => {
            if (-JS_SAFE_INTEGER_MAX..=JS_SAFE_INTEGER_MAX).contains(n) {
                serde_json::Value::from(*n)
            } else {
                serde_json::Value::String(n.to_string())
            }
        }

        mysql_async::Value::UInt(n) => {
            if *n > JS_SAFE_INTEGER_MAX as u64 {
                serde_json::Value::String(n.to_string())
            } else {
                serde_json::Value::from(*n)
            }
        }

        mysql_async::Value::Float(f) => serde_json::Number::from_f64(*f as f64)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),

        mysql_async::Value::Double(f) => serde_json::Number::from_f64(*f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),

        mysql_async::Value::Date(year, month, day, hour, min, sec, micro) => {
            if *hour == 0 && *min == 0 && *sec == 0 && *micro == 0 {
                // DATE only
                serde_json::Value::String(format!("{:04}-{:02}-{:02}", year, month, day))
            } else if *micro == 0 {
                // DATETIME/TIMESTAMP without microseconds
                serde_json::Value::String(format!(
                    "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
                    year, month, day, hour, min, sec
                ))
            } else {
                // DATETIME/TIMESTAMP with microseconds
                serde_json::Value::String(format!(
                    "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:06}",
                    year, month, day, hour, min, sec, micro
                ))
            }
        }

        mysql_async::Value::Time(is_negative, days, hours, minutes, seconds, micro) => {
            let sign = if *is_negative { "-" } else { "" };
            let total_hours = (*days as u32) * 24 + (*hours as u32);
            if *micro == 0 {
                serde_json::Value::String(format!(
                    "{sign}{total_hours:02}:{minutes:02}:{seconds:02}"
                ))
            } else {
                serde_json::Value::String(format!(
                    "{sign}{total_hours:02}:{minutes:02}:{seconds:02}.{micro:06}"
                ))
            }
        }
    }
}

// ── Error mapping ──────────────────────────────────────────────────────────────

/// Map a `mysql_async::Error` to a user-friendly error string.
///
/// MySQL error 1317 (ER_QUERY_INTERRUPTED) is mapped to "Query cancelled".
#[cfg(not(coverage))]
fn map_mysql_error(e: &mysql_async::Error) -> String {
    if let mysql_async::Error::Server(ref server_err) = e {
        if server_err.code == 1317 {
            return "Query cancelled".to_string();
        }
    }
    format!("Query failed: {e}")
}

// ── Connection builder ─────────────────────────────────────────────────────────

/// Build a new `mysql_async` connection from stored connection parameters.
///
/// Retrieves the password from the OS keychain using `profile_id` + `keychain_ref`.
/// Configures SSL/TLS to match the existing sqlx pool configuration.
#[cfg(not(coverage))]
pub async fn build_connection(
    params: &crate::mysql::registry::StoredConnectionParams,
) -> Result<mysql_async::Conn, String> {
    // Retrieve password from keychain
    let password = if params.has_password {
        crate::credentials::retrieve_password_for_connection(
            &params.profile_id,
            params.keychain_ref.as_deref(),
        )?
    } else {
        String::new()
    };

    let mut builder = mysql_async::OptsBuilder::default()
        .ip_or_hostname(&params.host)
        .tcp_port(params.port)
        .user(Some(&params.username))
        .pass(Some(&password));

    if let Some(ref db) = params.default_database {
        if !db.is_empty() {
            builder = builder.db_name(Some(db));
        }
    }

    // SSL/TLS configuration
    if params.ssl_enabled {
        let mut ssl_opts = mysql_async::SslOpts::default();

        if let Some(ref ca_path) = params.ssl_ca_path {
            ssl_opts = ssl_opts.with_root_certs(vec![std::path::PathBuf::from(ca_path).into()]);
        } else {
            // No CA cert: accept any cert (equivalent to sqlx Required mode)
            ssl_opts = ssl_opts.with_danger_accept_invalid_certs(true);
        }

        if let (Some(ref cert_path), Some(ref key_path)) =
            (&params.ssl_cert_path, &params.ssl_key_path)
        {
            let identity = mysql_async::ClientIdentity::new(
                std::path::PathBuf::from(cert_path).into(),
                std::path::PathBuf::from(key_path).into(),
            );
            ssl_opts = ssl_opts.with_client_identity(Some(identity));
        }

        builder = builder.ssl_opts(Some(ssl_opts));
    }

    let opts: mysql_async::Opts = builder.into();
    let conn = mysql_async::Conn::new(opts)
        .await
        .map_err(|e| format!("Failed to connect via mysql_async: {e}"))?;

    Ok(conn)
}

// ── Per-statement helpers ──────────────────────────────────────────────────────

/// Execute a SELECT-like statement on the given connection.
///
/// Returns a `(StoredResult, MultiQueryResultItem)` pair on success.
/// Handles auto-LIMIT internally. Row collection errors propagate via `?`.
#[cfg(not(coverage))]
async fn execute_single_select_statement(
    conn: &mut mysql_async::Conn,
    sql: &str,
    auto_limit_applied: bool,
    page_size_used: usize,
) -> Result<
    (
        crate::mysql::query_executor::StoredResult,
        crate::mysql::query_executor::MultiQueryResultItem,
    ),
    String,
> {
    use crate::mysql::query_executor::{
        calculate_total_pages, get_page_rows, inject_limit_into_select, ColumnMeta,
        MultiQueryResultItem, StoredResult,
    };
    use mysql_async::prelude::Queryable;

    let sql_to_execute = if auto_limit_applied {
        inject_limit_into_select(sql, 1000)
    } else {
        sql.to_string()
    };

    let start = std::time::Instant::now();
    crate::mysql::query_log::log_outgoing_sql(&sql_to_execute);
    let mut result = conn
        .query_iter(&sql_to_execute)
        .await
        .map_err(|e| map_mysql_error(&e))?;

    let columns_ref = result.columns_ref();
    let columns: Vec<ColumnMeta> = columns_ref
        .iter()
        .map(|c: &mysql_async::Column| ColumnMeta {
            name: c.name_str().to_string(),
            data_type: column_type_display_name(c.column_type(), c.flags()),
        })
        .collect();

    let col_types: Vec<(
        mysql_async::consts::ColumnType,
        mysql_async::consts::ColumnFlags,
    )> = columns_ref
        .iter()
        .map(|c: &mysql_async::Column| (c.column_type(), c.flags()))
        .collect();

    let rows: Vec<mysql_async::Row> = result.collect().await.map_err(|e| map_mysql_error(&e))?;

    // Drop remaining result sets (if any unexpected ones)
    drop(result);

    let serialized_rows: Vec<Vec<serde_json::Value>> = rows
        .iter()
        .map(|row| serialize_row(row, &col_types))
        .collect();

    let execution_time_ms = start.elapsed().as_millis() as u64;
    let total_rows = serialized_rows.len();
    let total_pages = calculate_total_pages(total_rows, page_size_used);
    let first_page = get_page_rows(&serialized_rows, 1, page_size_used).to_vec();
    let query_id = uuid::Uuid::new_v4().to_string();

    Ok((
        StoredResult {
            query_id: query_id.clone(),
            columns: columns.clone(),
            rows: serialized_rows,
            execution_time_ms,
            affected_rows: 0,
            auto_limit_applied,
            page_size: page_size_used,
        },
        MultiQueryResultItem {
            query_id,
            source_sql: sql.to_string(),
            columns,
            total_rows: total_rows as i64,
            execution_time_ms: execution_time_ms as i64,
            affected_rows: 0,
            first_page,
            total_pages: total_pages as i64,
            auto_limit_applied,
            error: None,
            re_executable: true,
        },
    ))
}

/// Execute a DML/DDL statement on the given connection.
///
/// Returns a `(StoredResult, MultiQueryResultItem)` pair on success.
/// The result drains the response and captures affected rows.
#[cfg(not(coverage))]
async fn execute_single_dml_statement(
    conn: &mut mysql_async::Conn,
    sql: &str,
    page_size_used: usize,
) -> Result<
    (
        crate::mysql::query_executor::StoredResult,
        crate::mysql::query_executor::MultiQueryResultItem,
    ),
    String,
> {
    use crate::mysql::query_executor::{MultiQueryResultItem, StoredResult};
    use mysql_async::prelude::Queryable;

    let start = std::time::Instant::now();
    crate::mysql::query_log::log_outgoing_sql(sql);
    let mut result = conn
        .query_iter(sql)
        .await
        .map_err(|e| map_mysql_error(&e))?;

    let affected = result.affected_rows();
    // Drain remaining result
    let _: Vec<mysql_async::Row> = result.collect().await.unwrap_or_default();

    let execution_time_ms = start.elapsed().as_millis() as u64;
    let query_id = uuid::Uuid::new_v4().to_string();

    Ok((
        StoredResult {
            query_id: query_id.clone(),
            columns: vec![],
            rows: vec![],
            execution_time_ms,
            affected_rows: affected,
            auto_limit_applied: false,
            page_size: page_size_used,
        },
        MultiQueryResultItem {
            query_id,
            source_sql: sql.to_string(),
            columns: vec![],
            total_rows: 0,
            execution_time_ms: execution_time_ms as i64,
            affected_rows: affected,
            first_page: vec![],
            total_pages: 1,
            auto_limit_applied: false,
            error: None,
            re_executable: true,
        },
    ))
}

/// Execute a CALL statement and collect all returned result sets.
///
/// Returns a `Vec<(StoredResult, MultiQueryResultItem)>` — one entry per
/// row-bearing result set, or a single synthetic DML-style entry if the
/// procedure produced no row results.
/// Row collection errors propagate via `?`.
#[cfg(not(coverage))]
async fn execute_call_statement(
    conn: &mut mysql_async::Conn,
    sql: &str,
    page_size_used: usize,
) -> Result<
    Vec<(
        crate::mysql::query_executor::StoredResult,
        crate::mysql::query_executor::MultiQueryResultItem,
    )>,
    String,
> {
    use crate::mysql::query_executor::{
        calculate_total_pages, get_page_rows, ColumnMeta, MultiQueryResultItem, StoredResult,
    };
    use mysql_async::prelude::Queryable;

    let start = std::time::Instant::now();
    crate::mysql::query_log::log_outgoing_sql(sql);
    let mut result = conn
        .query_iter(sql)
        .await
        .map_err(|e| map_mysql_error(&e))?;

    let mut pairs: Vec<(StoredResult, MultiQueryResultItem)> = Vec::new();
    let mut call_has_results = false;
    let mut call_last_affected: u64 = 0;

    loop {
        let columns_ref = result.columns_ref();
        if columns_ref.is_empty() {
            // No columns — DML-like result or trailing OK packet.
            call_last_affected = result.affected_rows();
            let _: Vec<mysql_async::Row> = result.collect().await.unwrap_or_default();
            if result.is_empty() {
                break;
            }
            continue;
        }

        call_has_results = true;

        let columns: Vec<ColumnMeta> = columns_ref
            .iter()
            .map(|c: &mysql_async::Column| ColumnMeta {
                name: c.name_str().to_string(),
                data_type: column_type_display_name(c.column_type(), c.flags()),
            })
            .collect();

        let col_types: Vec<(
            mysql_async::consts::ColumnType,
            mysql_async::consts::ColumnFlags,
        )> = columns_ref
            .iter()
            .map(|c: &mysql_async::Column| (c.column_type(), c.flags()))
            .collect();

        let rows: Vec<mysql_async::Row> =
            result.collect().await.map_err(|e| map_mysql_error(&e))?;

        let serialized_rows: Vec<Vec<serde_json::Value>> = rows
            .iter()
            .map(|row| serialize_row(row, &col_types))
            .collect();

        let execution_time_ms = start.elapsed().as_millis() as u64;
        let total_rows = serialized_rows.len();
        let total_pages = calculate_total_pages(total_rows, page_size_used);
        let first_page = get_page_rows(&serialized_rows, 1, page_size_used).to_vec();
        let query_id = uuid::Uuid::new_v4().to_string();

        pairs.push((
            StoredResult {
                query_id: query_id.clone(),
                columns: columns.clone(),
                rows: serialized_rows,
                execution_time_ms,
                affected_rows: 0,
                auto_limit_applied: false,
                page_size: page_size_used,
            },
            MultiQueryResultItem {
                query_id,
                source_sql: sql.to_string(),
                columns,
                total_rows: total_rows as i64,
                execution_time_ms: execution_time_ms as i64,
                affected_rows: 0,
                first_page,
                total_pages: total_pages as i64,
                auto_limit_applied: false,
                error: None,
                re_executable: false,
            },
        ));

        if result.is_empty() {
            break;
        }
    }

    // If no row-bearing result was seen, emit a single synthetic DML-style success entry.
    if !call_has_results {
        let execution_time_ms = start.elapsed().as_millis() as u64;
        let query_id = uuid::Uuid::new_v4().to_string();

        pairs.push((
            StoredResult {
                query_id: query_id.clone(),
                columns: vec![],
                rows: vec![],
                execution_time_ms,
                affected_rows: call_last_affected,
                auto_limit_applied: false,
                page_size: page_size_used,
            },
            MultiQueryResultItem {
                query_id,
                source_sql: sql.to_string(),
                columns: vec![],
                total_rows: 0,
                execution_time_ms: execution_time_ms as i64,
                affected_rows: call_last_affected,
                first_page: vec![],
                total_pages: 1,
                auto_limit_applied: false,
                error: None,
                re_executable: false,
            },
        ));
    }

    Ok(pairs)
}

// ── Batch executor ─────────────────────────────────────────────────────────────

/// Execute multiple SQL statements sequentially on a single `mysql_async` connection.
///
/// Returns a tuple of `(Vec<StoredResult>, Vec<MultiQueryResultItem>)`.
/// Stops on first error (which is included as the last result item).
///
/// Thread ID is registered with `state.running_queries` before execution starts
/// and removed on completion.
#[cfg(not(coverage))]
pub async fn execute_multi_query_internal(
    state: &crate::state::AppState,
    connection_id: &str,
    tab_id: &str,
    statements: &[String],
    page_size: usize,
    is_read_only: bool,
) -> Result<
    (
        Vec<crate::mysql::query_executor::StoredResult>,
        Vec<crate::mysql::query_executor::MultiQueryResultItem>,
    ),
    String,
> {
    use crate::mysql::query_executor::{
        find_with_main_keyword, get_first_keyword, is_read_only_allowed, is_select_like,
        needs_auto_limit, strip_non_executable_comments, MultiQueryResultItem, StoredResult,
    };
    use mysql_async::prelude::Queryable;

    let params = state
        .registry
        .get_connection_params(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found in registry"))?;

    let mut conn = build_connection(&params).await?;

    // Get connection thread ID for cancel support
    let thread_id: u64 = conn
        .query_first::<u64, _>("SELECT CONNECTION_ID()")
        .await
        .map_err(|e| format!("Failed to get connection ID: {e}"))?
        .ok_or_else(|| "CONNECTION_ID() returned NULL".to_string())?;

    // Register thread ID for cancellation
    let key = (connection_id.to_string(), tab_id.to_string());
    state
        .running_queries
        .write()
        .await
        .insert(key.clone(), thread_id);

    let page_size_used = if page_size == 0 { 1000 } else { page_size };
    let mut stored_results: Vec<StoredResult> = Vec::new();
    let mut result_items: Vec<MultiQueryResultItem> = Vec::new();

    // Run the main statement loop inside an inner block so that cleanup
    // (running_queries removal + connection disconnect) ALWAYS executes,
    // even when early-return `?` operators propagate errors.
    let loop_result: Result<(), String> = async {
        for sql in statements {
            let sql = sql.trim();
            if sql.is_empty() {
                continue;
            }

            // Read-only enforcement per statement
            if is_read_only && !is_read_only_allowed(sql) {
                let query_id = uuid::Uuid::new_v4().to_string();
                let error_msg = "This connection is read-only. Only SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, USE, and SET (non-GLOBAL) statements are allowed.".to_string();

                stored_results.push(StoredResult {
                    query_id: query_id.clone(),
                    columns: vec![],
                    rows: vec![],
                    execution_time_ms: 0,
                    affected_rows: 0,
                    auto_limit_applied: false,
                    page_size: page_size_used,
                });
                result_items.push(MultiQueryResultItem {
                    query_id,
                    source_sql: sql.to_string(),
                    columns: vec![],
                    total_rows: 0,
                    execution_time_ms: 0,
                    affected_rows: 0,
                    first_page: vec![],
                    total_pages: 1,
                    auto_limit_applied: false,
                    error: Some(error_msg),
                    re_executable: false,
                });
                break; // Stop on read-only violation
            }

            let stripped = strip_non_executable_comments(sql);
            let keyword = get_first_keyword(&stripped);

            if is_call_statement(sql) {
                // Handle CALL statement — may produce multiple result sets
                match execute_call_statement(&mut conn, sql, page_size_used).await {
                    Ok(pairs) => {
                        for (sr, ri) in pairs {
                            stored_results.push(sr);
                            result_items.push(ri);
                        }
                    }
                    Err(error_msg) => {
                        let execution_time_ms = 0u64;
                        let query_id = uuid::Uuid::new_v4().to_string();

                        stored_results.push(StoredResult {
                            query_id: query_id.clone(),
                            columns: vec![],
                            rows: vec![],
                            execution_time_ms,
                            affected_rows: 0,
                            auto_limit_applied: false,
                            page_size: page_size_used,
                        });
                        result_items.push(MultiQueryResultItem {
                            query_id,
                            source_sql: sql.to_string(),
                            columns: vec![],
                            total_rows: 0,
                            execution_time_ms: execution_time_ms as i64,
                            affected_rows: 0,
                            first_page: vec![],
                            total_pages: 1,
                            auto_limit_applied: false,
                            error: Some(error_msg),
                            re_executable: false,
                        });
                        break; // Stop on error
                    }
                }
            } else {
                // Non-CALL statement: SELECT-like or DML/DDL
                let is_result_set = if keyword == "WITH" {
                    let main_kw = find_with_main_keyword(&stripped);
                    is_select_like(&main_kw) || main_kw.is_empty()
                } else {
                    is_select_like(&keyword)
                };

                let auto_limit_applied = needs_auto_limit(sql);

                let stmt_result = if is_result_set {
                    execute_single_select_statement(&mut conn, sql, auto_limit_applied, page_size_used).await
                } else {
                    execute_single_dml_statement(&mut conn, sql, page_size_used).await
                };

                match stmt_result {
                    Ok((sr, ri)) => {
                        stored_results.push(sr);
                        result_items.push(ri);
                    }
                    Err(error_msg) => {
                        let query_id = uuid::Uuid::new_v4().to_string();

                        stored_results.push(StoredResult {
                            query_id: query_id.clone(),
                            columns: vec![],
                            rows: vec![],
                            execution_time_ms: 0,
                            affected_rows: 0,
                            auto_limit_applied: false,
                            page_size: page_size_used,
                        });
                        result_items.push(MultiQueryResultItem {
                            query_id,
                            source_sql: sql.to_string(),
                            columns: vec![],
                            total_rows: 0,
                            execution_time_ms: 0,
                            affected_rows: 0,
                            first_page: vec![],
                            total_pages: 1,
                            auto_limit_applied: false,
                            error: Some(error_msg),
                            re_executable: false,
                        });
                        break; // Stop on error
                    }
                }
            }
        }

        Ok(())
    }.await;

    // CLEANUP: Always remove thread ID and disconnect, regardless of success or error.
    state.running_queries.write().await.remove(&key);
    let _ = conn.disconnect().await;

    // Propagate any error from the statement loop
    loop_result?;

    Ok((stored_results, result_items))
}

/// Serialize a single `mysql_async::Row` to a `Vec<serde_json::Value>`.
#[cfg(not(coverage))]
fn serialize_row(
    row: &mysql_async::Row,
    col_types: &[(
        mysql_async::consts::ColumnType,
        mysql_async::consts::ColumnFlags,
    )],
) -> Vec<serde_json::Value> {
    (0..col_types.len())
        .map(|i| {
            let (col_type, flags) = col_types[i];
            match row.get::<mysql_async::Value, _>(i) {
                Some(value) => serialize_mysql_value(&value, col_type, flags),
                None => serde_json::Value::Null,
            }
        })
        .collect()
}
