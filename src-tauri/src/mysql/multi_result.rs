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
/// used for strings, DECIMAL, BIT, BLOB/BINARY types, and — over the text
/// protocol — every numeric and temporal column.
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

        // Text protocol sends numbers as ASCII — parse them so they serialize the
        // same as binary-protocol `Int`/`UInt`/`Double` values.
        MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT | MYSQL_TYPE_INT24 | MYSQL_TYPE_LONG
        | MYSQL_TYPE_LONGLONG | MYSQL_TYPE_YEAR => {
            let s = String::from_utf8_lossy(bytes);
            let parsed = s
                .parse::<i64>()
                .map(mysql_async::Value::Int)
                .or_else(|_| s.parse::<u64>().map(mysql_async::Value::UInt));
            match parsed {
                Ok(value) => serialize_mysql_value(&value, col_type, flags),
                Err(_) => serde_json::Value::String(s.into_owned()),
            }
        }
        MYSQL_TYPE_FLOAT | MYSQL_TYPE_DOUBLE => {
            let s = String::from_utf8_lossy(bytes);
            match s.parse::<f64>() {
                Ok(f) => serialize_mysql_value(&mysql_async::Value::Double(f), col_type, flags),
                Err(_) => serde_json::Value::String(s.into_owned()),
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
            let total_hours = *days * 24 + (*hours as u32);
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
pub(crate) fn map_mysql_error(e: &mysql_async::Error) -> String {
    crate::mysql::query_log::log_mysql_async_error(e);
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
/// Retrieves the password from OS-native secure storage using the saved `profile_id`.
/// Configures SSL/TLS to match the existing sqlx pool configuration.
#[cfg(not(coverage))]
pub async fn build_connection(
    params: &crate::mysql::registry::StoredConnectionParams,
) -> Result<mysql_async::Conn, String> {
    // Retrieve password from secure storage
    let password = crate::credentials::resolve_password(&params.profile_id, params.has_password)?;

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

// ── Ceiling enforcement ────────────────────────────────────────────────────────

/// Per-run decode settings passed down from the session-holding entry points.
#[cfg(not(coverage))]
pub struct DecodeContext<'a> {
    /// Hard row ceiling: the only cap on stored rows.
    pub ceiling: usize,
    /// Registry connection id (for KILL logging).
    pub connection_id: &'a str,
    /// MySQL thread id of the held editor session (the KILL target).
    pub thread_id: u64,
    /// Pool used to issue `KILL QUERY` on a separate connection.
    pub pool: Option<sqlx::MySqlPool>,
}

/// Pool-acquire timeout for the ceiling KILL. Short, so a KILL that can't be
/// issued (e.g. an exhausted pool) falls back to draining quickly.
#[cfg(not(coverage))]
const CEILING_KILL_ACQUIRE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1);

/// Rows decoded from one result set, bounded by the ceiling.
#[cfg(not(coverage))]
struct DecodedRows {
    rows: Vec<crate::mysql::query_executor::SharedRow>,
    /// True when at least one row beyond the ceiling was seen (not stored).
    overflowed: bool,
}

/// True for MySQL error 1317 (ER_QUERY_INTERRUPTED).
#[cfg(not(coverage))]
pub(crate) fn is_query_interrupted(e: &mysql_async::Error) -> bool {
    matches!(e, mysql_async::Error::Server(server_err) if server_err.code == 1317)
}

/// Issue `KILL QUERY <thread_id>` over a pool connection after the ceiling was
/// reached. Returns `false` (with a warning) when the KILL could not be sent,
/// in which case the caller drains the rest of the stream instead.
#[cfg(not(coverage))]
async fn kill_for_ceiling(ctx: &DecodeContext<'_>) -> bool {
    let Some(pool) = ctx.pool.as_ref() else {
        tracing::warn!(
            connection_id = ctx.connection_id,
            thread_id = ctx.thread_id,
            "row ceiling reached but no pool is available for KILL QUERY; draining instead"
        );
        return false;
    };
    let mut conn = match tokio::time::timeout(CEILING_KILL_ACQUIRE_TIMEOUT, pool.acquire()).await {
        Ok(Ok(conn)) => conn,
        Ok(Err(error)) => {
            tracing::warn!(
                connection_id = ctx.connection_id,
                thread_id = ctx.thread_id,
                %error,
                "row ceiling reached but a pool connection for KILL QUERY failed; draining instead"
            );
            return false;
        }
        Err(_) => {
            tracing::warn!(
                connection_id = ctx.connection_id,
                thread_id = ctx.thread_id,
                "row ceiling reached but no pool connection for KILL QUERY within 1 s; draining instead"
            );
            return false;
        }
    };
    let kill_sql = format!("KILL QUERY {}", ctx.thread_id);
    tracing::debug!(
        connection_id = ctx.connection_id,
        thread_id = ctx.thread_id,
        ceiling = ctx.ceiling,
        "row ceiling reached: issuing KILL QUERY"
    );
    crate::mysql::query_log::log_outgoing_sql(&kill_sql);
    match sqlx::query(sqlx::AssertSqlSafe(kill_sql.as_str()))
        .execute(&mut *conn)
        .await
    {
        Ok(result) => {
            crate::mysql::query_log::log_execute_result(&result);
            true
        }
        Err(error) => {
            crate::mysql::query_log::log_execute_error(&error);
            tracing::warn!(
                connection_id = ctx.connection_id,
                thread_id = ctx.thread_id,
                %error,
                "row ceiling KILL QUERY failed; draining the rest of the result instead"
            );
            false
        }
    }
}

/// Read and discard the rest of a SELECT after the ceiling. The stream ends
/// normally, or with error 1317 from the ceiling KILL; either way the result
/// is a truncated success. Other errors are logged and also end the drain:
/// the stored rows up to the ceiling are complete. Returns `true` when the
/// stream ended with 1317 (the KILL was consumed by this statement).
#[cfg(not(coverage))]
async fn drain_after_ceiling<P>(
    result: &mut mysql_async::QueryResult<'_, '_, P>,
    ctx: &DecodeContext<'_>,
) -> bool
where
    P: mysql_async::prelude::Protocol,
{
    loop {
        match result.next().await {
            Ok(Some(_)) => continue,
            Ok(None) => return false,
            Err(error) if is_query_interrupted(&error) => {
                tracing::debug!(
                    connection_id = ctx.connection_id,
                    "row ceiling: stream ended by KILL QUERY (1317)"
                );
                return true;
            }
            Err(error) => {
                crate::mysql::query_log::log_mysql_async_error(&error);
                tracing::warn!(
                    connection_id = ctx.connection_id,
                    ?error,
                    "row ceiling: error while draining a truncated result; keeping stored rows"
                );
                return false;
            }
        }
    }
}

/// Absorb a `KILL QUERY` that may have reached the session after the statement
/// it targeted had already ended, so it can't interrupt the next statement
/// (another statement of the batch, or another tab's query on the shared
/// session). Runs a logged `DO 0`: error 1317 means the late KILL landed here,
/// which is the point; any other error is logged and ignored.
#[cfg(not(coverage))]
pub(crate) async fn absorb_late_kill(conn: &mut mysql_async::Conn, connection_id: &str) {
    use mysql_async::prelude::Queryable;

    let sql = "DO 0";
    crate::mysql::query_log::log_outgoing_sql(sql);
    match conn.query_drop(sql).await {
        Ok(()) => {}
        Err(error) if is_query_interrupted(&error) => {
            tracing::debug!(
                connection_id,
                "a late KILL QUERY was absorbed before the next statement"
            );
        }
        Err(error) => {
            crate::mysql::query_log::log_mysql_async_error(&error);
            tracing::warn!(
                connection_id,
                ?error,
                "could not absorb a possibly late KILL QUERY"
            );
        }
    }
}

/// Read `SELECT DATABASE()` on the held session to record the database a
/// truncated, re-runnable result ran in. A failure (e.g. a late ceiling KILL
/// landing on this statement with 1317) is a warning, never a statement error,
/// and yields `None` (the caller marks the export blocked: `unknownDatabase`).
#[cfg(not(coverage))]
async fn capture_session_database(
    conn: &mut mysql_async::Conn,
    connection_id: &str,
) -> Option<crate::mysql::query_executor::RunDatabase> {
    use crate::mysql::query_executor::RunDatabase;
    use mysql_async::prelude::Queryable;

    let sql = "SELECT DATABASE()";
    crate::mysql::query_log::log_outgoing_sql(sql);
    match conn.query_first::<Option<String>, _>(sql).await {
        Ok(Some(Some(database))) => Some(RunDatabase::Named(database)),
        Ok(_) => Some(RunDatabase::NoDatabase),
        Err(error) => {
            crate::mysql::query_log::log_mysql_async_error(&error);
            tracing::warn!(
                connection_id,
                ?error,
                "could not record the database of a truncated result; full export disabled for it"
            );
            None
        }
    }
}

// ── Per-statement helpers ──────────────────────────────────────────────────────

/// Execute a SELECT-like statement on the given connection.
///
/// Returns a `(StoredResult, MultiQueryResultItem)` pair on success.
/// Handles auto-LIMIT internally and stores at most `ctx.ceiling` rows. When
/// the ceiling is exceeded, the rest of the stream is stopped with `KILL QUERY`
/// (or drained when the KILL can't be sent) and the result is a truncated
/// success. Row collection errors otherwise propagate via `?`.
#[cfg(not(coverage))]
async fn execute_single_select_statement(
    conn: &mut mysql_async::Conn,
    sql: &str,
    auto_limit_applied: bool,
    row_limit_used: usize,
    ctx: &DecodeContext<'_>,
) -> Result<
    (
        crate::mysql::query_executor::StoredResult,
        crate::mysql::query_executor::MultiQueryResultItem,
    ),
    String,
> {
    use crate::mysql::query_executor::{
        inject_limit_into_select, statement_blocked_reason, ColumnMeta, FullExportBlockedReason,
        MultiQueryResultItem, StoredResult,
    };
    use mysql_async::prelude::Queryable;

    let sql_to_execute = if auto_limit_applied {
        inject_limit_into_select(sql, row_limit_used)
    } else {
        sql.to_string()
    };

    let start = std::time::Instant::now();
    crate::mysql::query_log::log_outgoing_sql(&sql_to_execute);
    let mut result = conn
        .query_iter(&sql_to_execute)
        .await
        .map_err(|e| map_mysql_error(&e))?;

    // Result header is available — record execution time before row transfer.
    let execution_time_ms = start.elapsed().as_millis() as u64;

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

    let capacity_hint = if auto_limit_applied {
        row_limit_used.min(ROW_CAPACITY_HINT_MAX)
    } else {
        0
    };
    let decoded =
        stream_serialized_rows(&mut result, &col_types, capacity_hint, ctx.ceiling).await?;
    let mut late_kill_possible = false;
    if decoded.overflowed {
        // Rows remain unread: stop the server sending them. If the KILL can't
        // be sent, the drain below still reads (and discards) the rest.
        let kill_sent = kill_for_ceiling(ctx).await;
        let interrupted = drain_after_ceiling(&mut result, ctx).await;
        // The stream ended on its own after the KILL was sent: the KILL may
        // still be pending on the session.
        late_kill_possible = kill_sent && !interrupted;
    }

    // Drop remaining result sets (if any unexpected ones)
    drop(result);
    if late_kill_possible {
        absorb_late_kill(conn, ctx.connection_id).await;
    }

    // All rows streamed and serialized — record total time.
    let total_time_ms = start.elapsed().as_millis() as u64;
    let query_id = uuid::Uuid::new_v4().to_string();

    let mut stored = StoredResult::new(
        query_id,
        columns,
        Arc::new(decoded.rows),
        execution_time_ms,
        total_time_ms,
        0,
        auto_limit_applied,
    );
    stored.truncated = decoded.overflowed;
    stored.row_ceiling = ctx.ceiling;
    stored.applied_row_limit = auto_limit_applied.then_some(row_limit_used);
    stored.source_sql = sql.to_string();
    stored.full_export_blocked_reason = statement_blocked_reason(sql, false);
    if stored.truncated && stored.full_export_blocked_reason.is_none() {
        match capture_session_database(conn, ctx.connection_id).await {
            Some(database) => stored.run_database = database,
            None => {
                stored.full_export_blocked_reason = Some(FullExportBlockedReason::UnknownDatabase)
            }
        }
    }

    let item = MultiQueryResultItem::from_stored(&stored, None, true);
    Ok((stored, item))
}

/// Execute a DML/DDL statement on the given connection.
///
/// Returns a `(StoredResult, MultiQueryResultItem)` pair on success.
/// The result drains the response and captures affected rows.
#[cfg(not(coverage))]
async fn execute_single_dml_statement(
    conn: &mut mysql_async::Conn,
    sql: &str,
    ctx: &DecodeContext<'_>,
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

    // Statement executed (header available) — record execution time.
    let execution_time_ms = start.elapsed().as_millis() as u64;

    let affected = result.affected_rows();
    crate::mysql::query_log::log_mysql_async_result(affected, result.last_insert_id());
    // Drain remaining result
    drain_result_set(&mut result).await;

    // No row-transfer phase for DML; total time is measured after draining.
    let total_time_ms = start.elapsed().as_millis() as u64;
    let query_id = uuid::Uuid::new_v4().to_string();

    let mut stored = StoredResult::new(
        query_id,
        vec![],
        Arc::new(vec![]),
        execution_time_ms,
        total_time_ms,
        affected,
        false,
    );
    stored.row_ceiling = ctx.ceiling;
    stored.source_sql = sql.to_string();
    let item = MultiQueryResultItem::from_stored(&stored, None, true);
    Ok((stored, item))
}

/// Execute a CALL statement and collect all returned result sets.
///
/// Returns a `Vec<(StoredResult, MultiQueryResultItem)>` — one entry per
/// row-bearing result set, or a single synthetic DML-style entry if the
/// procedure produced no row results. A result set over the ceiling is drained
/// (never killed, so the procedure's writes are not aborted) and marked
/// truncated; later result sets are still read.
/// Row collection errors propagate via `?`.
#[cfg(not(coverage))]
async fn execute_call_statement(
    conn: &mut mysql_async::Conn,
    sql: &str,
    ctx: &DecodeContext<'_>,
) -> Result<
    Vec<(
        crate::mysql::query_executor::StoredResult,
        crate::mysql::query_executor::MultiQueryResultItem,
    )>,
    String,
> {
    use crate::mysql::query_executor::{
        ColumnMeta, FullExportBlockedReason, MultiQueryResultItem, StoredResult,
    };
    use mysql_async::prelude::Queryable;

    let start = std::time::Instant::now();
    crate::mysql::query_log::log_outgoing_sql(sql);
    let mut result = conn
        .query_iter(sql)
        .await
        .map_err(|e| map_mysql_error(&e))?;

    // Procedure executed and the first result-set header is available — record
    // execution time once. All result sets share this single header time; each
    // set's total time is recorded at its own collection point.
    let execution_time_ms = start.elapsed().as_millis() as u64;

    let mut pairs: Vec<(StoredResult, MultiQueryResultItem)> = Vec::new();
    let mut call_has_results = false;
    let mut call_last_affected: u64 = 0;

    let finish = |stored: &mut StoredResult| {
        stored.row_ceiling = ctx.ceiling;
        stored.source_sql = sql.to_string();
        stored.full_export_blocked_reason = Some(FullExportBlockedReason::Call);
    };

    loop {
        let columns_ref = result.columns_ref();
        if columns_ref.is_empty() {
            // No columns — DML-like result or trailing OK packet.
            call_last_affected = result.affected_rows();
            drain_result_set(&mut result).await;
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

        let decoded = stream_serialized_rows(&mut result, &col_types, 0, ctx.ceiling).await?;
        if decoded.overflowed {
            tracing::debug!(
                connection_id = ctx.connection_id,
                ceiling = ctx.ceiling,
                "row ceiling reached in a CALL result set: draining the rest of the set"
            );
            while result
                .next()
                .await
                .map_err(|e| map_mysql_error(&e))?
                .is_some()
            {}
        }

        // This result set's rows are streamed and serialized — record its total
        // time. Execution time is the shared header time captured above.
        let total_time_ms = start.elapsed().as_millis() as u64;
        let query_id = uuid::Uuid::new_v4().to_string();

        let mut stored = StoredResult::new(
            query_id,
            columns,
            Arc::new(decoded.rows),
            execution_time_ms,
            total_time_ms,
            0,
            false,
        );
        finish(&mut stored);
        stored.truncated = decoded.overflowed;
        let item = MultiQueryResultItem::from_stored(&stored, None, false);
        pairs.push((stored, item));

        if result.is_empty() {
            break;
        }
    }

    // If no row-bearing result was seen, emit a single synthetic DML-style success entry.
    if !call_has_results {
        // No row-bearing result set; total time is measured after draining.
        let total_time_ms = start.elapsed().as_millis() as u64;
        let query_id = uuid::Uuid::new_v4().to_string();

        let mut stored = StoredResult::new(
            query_id,
            vec![],
            Arc::new(vec![]),
            execution_time_ms,
            total_time_ms,
            call_last_affected,
            false,
        );
        finish(&mut stored);
        let item = MultiQueryResultItem::from_stored(&stored, None, false);
        pairs.push((stored, item));
    }

    Ok(pairs)
}

// ── Error result helper ────────────────────────────────────────────────────────

/// Push a matching `(StoredResult, MultiQueryResultItem)` pair representing a
/// failed statement onto the running result vectors.
///
/// Generates a fresh query id internally and fills both structs with empty rows,
/// zeroed numerics, `re_executable: false`, and the given error message.
#[cfg(not(coverage))]
fn push_error_result(
    stored: &mut Vec<crate::mysql::query_executor::StoredResult>,
    items: &mut Vec<crate::mysql::query_executor::MultiQueryResultItem>,
    sql: &str,
    error_msg: String,
) {
    use crate::mysql::query_executor::{MultiQueryResultItem, StoredResult};

    let mut result = StoredResult::empty(uuid::Uuid::new_v4().to_string());
    result.source_sql = sql.to_string();
    items.push(MultiQueryResultItem::from_stored(
        &result,
        Some(error_msg),
        false,
    ));
    stored.push(result);
}

// ── Batch executor ─────────────────────────────────────────────────────────────

/// Execute multiple SQL statements sequentially on the connection's shared editor session.
///
/// Returns a tuple of `(Vec<StoredResult>, Vec<MultiQueryResultItem>)`.
/// Stops on first error (which is included as the last result item).
///
/// Thread ID is registered with `state.running_queries` before execution starts
/// and removed on completion. `row_limit` is the (already clamped) auto-LIMIT;
/// decoding is capped by the cache's row ceiling.
#[cfg(not(coverage))]
pub async fn execute_multi_query_internal(
    state: &crate::state::AppState,
    connection_id: &str,
    tab_id: &str,
    statements: &[String],
    row_limit: usize,
    is_read_only: bool,
) -> Result<
    (
        Vec<crate::mysql::query_executor::StoredResult>,
        Vec<crate::mysql::query_executor::MultiQueryResultItem>,
    ),
    String,
> {
    use crate::mysql::query_executor::{is_read_only_allowed, MultiQueryResultItem, StoredResult};

    let run = crate::mysql::session::TabRun::new(connection_id, tab_id);
    let mut guard = crate::mysql::session::acquire_for_run(state, &run).await?;
    let session = guard.as_mut().expect("acquire always yields a session");
    let key = run.running_query_key();

    let ctx = DecodeContext {
        ceiling: state.result_cache.row_ceiling(),
        connection_id,
        thread_id: session.thread_id,
        pool: state.registry.get_pool(connection_id),
    };
    let row_limit_used = if row_limit == 0 { 1000 } else { row_limit };
    let mut stored_results: Vec<StoredResult> = Vec::new();
    let mut result_items: Vec<MultiQueryResultItem> = Vec::new();

    for sql in statements {
        let sql = sql.trim();
        if sql.is_empty() {
            continue;
        }

        // Read-only enforcement per statement
        if is_read_only && !is_read_only_allowed(sql) {
            let error_msg = "This connection is read-only. Only SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, USE, and SET (non-GLOBAL) statements are allowed.".to_string();
            push_error_result(&mut stored_results, &mut result_items, sql, error_msg);
            break; // Stop on read-only violation
        }

        let stmt_result = if is_call_statement(sql) {
            // CALL may produce multiple result sets
            execute_call_statement(&mut session.conn, sql, &ctx).await
        } else {
            execute_statement(&mut session.conn, sql, row_limit_used, &ctx)
                .await
                .map(|pair| vec![pair])
        };

        match stmt_result {
            Ok(pairs) => {
                for (sr, ri) in pairs {
                    stored_results.push(sr);
                    result_items.push(ri);
                }
            }
            Err(error_msg) => {
                push_error_result(&mut stored_results, &mut result_items, sql, error_msg);
                break; // Stop on error
            }
        }
    }

    state.running_queries.write().await.remove(&key);

    Ok((stored_results, result_items))
}

/// Execute one non-CALL statement on the connection's shared editor session,
/// registering the session thread ID for cancellation while it runs.
/// `row_limit` is the (already clamped) auto-LIMIT.
#[cfg(not(coverage))]
pub async fn execute_single_on_session(
    state: &crate::state::AppState,
    connection_id: &str,
    tab_id: &str,
    sql: &str,
    row_limit: usize,
) -> Result<
    (
        crate::mysql::query_executor::StoredResult,
        crate::mysql::query_executor::MultiQueryResultItem,
    ),
    String,
> {
    let run = crate::mysql::session::TabRun::new(connection_id, tab_id);
    let mut guard = crate::mysql::session::acquire_for_run(state, &run).await?;
    let session = guard.as_mut().expect("acquire always yields a session");
    let key = run.running_query_key();

    let ctx = DecodeContext {
        ceiling: state.result_cache.row_ceiling(),
        connection_id,
        thread_id: session.thread_id,
        pool: state.registry.get_pool(connection_id),
    };
    let result = execute_statement(&mut session.conn, sql, row_limit, &ctx).await;

    state.running_queries.write().await.remove(&key);

    result
}

/// Execute a SELECT-like or DML/DDL statement (anything but CALL).
#[cfg(not(coverage))]
async fn execute_statement(
    conn: &mut mysql_async::Conn,
    sql: &str,
    row_limit: usize,
    ctx: &DecodeContext<'_>,
) -> Result<
    (
        crate::mysql::query_executor::StoredResult,
        crate::mysql::query_executor::MultiQueryResultItem,
    ),
    String,
> {
    use crate::mysql::query_executor::{
        find_with_main_keyword, get_first_keyword, is_select_like, needs_auto_limit,
        strip_non_executable_comments,
    };

    let stripped = strip_non_executable_comments(sql);
    let keyword = get_first_keyword(&stripped);
    let is_result_set = if keyword == "WITH" {
        let main_kw = find_with_main_keyword(&stripped);
        is_select_like(&main_kw) || main_kw.is_empty()
    } else {
        is_select_like(&keyword)
    };

    if is_result_set {
        execute_single_select_statement(conn, sql, needs_auto_limit(sql), row_limit, ctx).await
    } else {
        execute_single_dml_statement(conn, sql, ctx).await
    }
}

/// Upper bound for the up-front row `Vec` reservation when an auto-LIMIT tells
/// us roughly how many rows to expect. Larger results grow normally.
#[cfg(not(coverage))]
const ROW_CAPACITY_HINT_MAX: usize = 10_000;

/// Stream the current result set, serializing each row as it arrives, and stop
/// storing at `ceiling` rows.
///
/// Each driver row is logged, converted to a `SharedRow` and dropped before the
/// next one is read, so driver rows and JSON rows are never all alive at once.
/// Reading stops right after the first row beyond the ceiling (which is not
/// stored), so the caller can KILL or drain while rows remain unread.
/// On error (including a user `KILL`), the partial rows are dropped.
#[cfg(not(coverage))]
async fn stream_serialized_rows<P>(
    result: &mut mysql_async::QueryResult<'_, '_, P>,
    col_types: &[(
        mysql_async::consts::ColumnType,
        mysql_async::consts::ColumnFlags,
    )],
    capacity_hint: usize,
    ceiling: usize,
) -> Result<DecodedRows, String>
where
    P: mysql_async::prelude::Protocol,
{
    let mut serialized_rows = Vec::with_capacity(capacity_hint.min(ceiling));
    let mut overflowed = false;
    while let Some(row) = result.next().await.map_err(|e| map_mysql_error(&e))? {
        if serialized_rows.len() >= ceiling {
            overflowed = true;
            break;
        }
        crate::mysql::query_log::log_mysql_async_row(serialized_rows.len(), &row);
        serialized_rows.push(serialize_row(&row, col_types));
    }
    crate::mysql::query_log::log_mysql_async_row_count(serialized_rows.len());
    Ok(DecodedRows {
        rows: serialized_rows,
        overflowed,
    })
}

/// Read and discard the rest of the current result set (DML responses and
/// column-less CALL result sets). Errors are tolerated, matching the previous
/// best-effort drain.
#[cfg(not(coverage))]
async fn drain_result_set<P>(result: &mut mysql_async::QueryResult<'_, '_, P>)
where
    P: mysql_async::prelude::Protocol,
{
    if let Err(e) = result.for_each(|_| {}).await {
        tracing::debug!(error = %e, "ignoring error while draining result set");
    }
}

/// Serialize a single `mysql_async::Row` to a `SharedRow`, borrowing each cell.
#[cfg(not(coverage))]
pub(crate) fn serialize_row(
    row: &mysql_async::Row,
    col_types: &[(
        mysql_async::consts::ColumnType,
        mysql_async::consts::ColumnFlags,
    )],
) -> crate::mysql::query_executor::SharedRow {
    col_types
        .iter()
        .enumerate()
        .map(|(i, &(col_type, flags))| match row.as_ref(i) {
            Some(value) => serialize_mysql_value(value, col_type, flags),
            None => serde_json::Value::Null,
        })
        .collect()
}
