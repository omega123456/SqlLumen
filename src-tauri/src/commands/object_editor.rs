//! Object editor commands: DDL fetch, save, drop, and routine parameters.
//!
//! Each public `*_impl` function is the testable core logic, and the
//! `#[tauri::command]` wrappers are thin delegates.

use regex::Regex;
use serde::{Deserialize, Serialize};

#[cfg(not(coverage))]
use crate::commands::query_history_bridge::{log_single_entry, resolve_connection_context};
#[cfg(not(coverage))]
use crate::db::history::NewHistoryEntry;
#[cfg(not(coverage))]
use crate::mysql::query_log;
use crate::mysql::schema_queries;
use crate::state::AppState;
#[cfg(not(coverage))]
use sqlx::Executor;
#[cfg(not(coverage))]
use tauri::State;

// ---------------------------------------------------------------------------
// Data models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineParameter {
    pub name: String,
    pub data_type: String,
    pub mode: String,
    pub ordinal_position: i32,
}

/// Response for `get_routine_parameters_with_return_type` — includes a `found` flag
/// so the frontend can distinguish "zero-parameter routine" from "routine not found".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineParametersWithFoundResponse {
    pub parameters: Vec<RoutineParameter>,
    pub found: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveObjectRequest {
    pub connection_id: String,
    pub database: String,
    pub object_name: String,
    pub object_type: String,
    pub body: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveObjectResponse {
    pub success: bool,
    pub error_message: Option<String>,
    pub drop_succeeded: bool,
    pub saved_object_name: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

#[cfg(not(coverage))]
fn get_pool(state: &AppState, connection_id: &str) -> Result<sqlx::MySqlPool, String> {
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' is not open"))
}

#[cfg(not(coverage))]
async fn execute_simple_sql(
    conn: &mut sqlx::MySqlConnection,
    sql: &str,
) -> Result<sqlx::mysql::MySqlQueryResult, sqlx::Error> {
    query_log::log_outgoing_sql(sql);
    match conn.execute(sql).await {
        Ok(result) => {
            query_log::log_execute_result(&result);
            Ok(result)
        }
        Err(error) => {
            query_log::log_execute_error(&error);
            Err(error)
        }
    }
}

fn check_not_read_only(state: &AppState, connection_id: &str) -> Result<(), String> {
    if state.registry.is_read_only(connection_id) {
        return Err("Operation not permitted: connection is read-only".to_string());
    }
    Ok(())
}

/// Map a lowercase object type string to its SQL keyword.
fn object_type_keyword(object_type: &str) -> Result<&'static str, String> {
    match object_type {
        "view" => Ok("VIEW"),
        "procedure" => Ok("PROCEDURE"),
        "function" => Ok("FUNCTION"),
        "trigger" => Ok("TRIGGER"),
        "event" => Ok("EVENT"),
        _ => Err(format!("Unknown object type: '{object_type}'")),
    }
}

fn unescape_backtick_identifier(identifier: &str) -> String {
    identifier.replace("``", "`")
}

/// Parse the optional database qualifier, object name, and DDL type keyword from a
/// DDL CREATE statement.
///
/// Returns `(optional_database, object_name, type_keyword)`.
///
/// Handles:
/// - Backtick-quoted and unquoted identifiers
/// - Optional `OR REPLACE`, `DEFINER`, `SQL SECURITY`, `ALGORITHM` clauses
pub fn parse_ddl_name(body: &str) -> Result<(Option<String>, String, String), String> {
    // Capture groups:
    //   1 = type keyword (PROCEDURE, FUNCTION, VIEW, TRIGGER, EVENT)
    //   2 = backtick-quoted database
    //   3 = unquoted database
    //   4 = backtick-quoted name
    //   5 = unquoted name
    let re = Regex::new(
        r"(?i)CREATE\s+(?:OR\s+REPLACE\s+)?(?:ALGORITHM\s*=\s*\w+\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?(\w+)\s+(?:(?:`((?:``|[^`])+)`|(\w+))\.)?(?:`((?:``|[^`])+)`|(\w+))",
    )
    .map_err(|e| format!("Internal regex error: {e}"))?;

    let caps = re.captures(body.trim()).ok_or_else(|| {
        "Could not parse object name from DDL. Expected CREATE ... `name` or CREATE ... name syntax.".to_string()
    })?;

    let type_keyword = caps
        .get(1)
        .ok_or("Could not extract object type from DDL")?
        .as_str()
        .to_uppercase();

    let db = caps
        .get(2)
        .map(|m| unescape_backtick_identifier(m.as_str()))
        .or_else(|| caps.get(3).map(|m| m.as_str().to_string()));
    let name = caps
        .get(4)
        .map(|m| unescape_backtick_identifier(m.as_str()))
        .or_else(|| caps.get(5).map(|m| m.as_str().to_string()))
        .ok_or("Could not extract object name from DDL")?;

    Ok((db, name, type_keyword))
}

/// Validate that a view DDL statement has the correct prefix for the given mode.
///
/// - **alter**: must start with `CREATE OR REPLACE [ALGORITHM=...] [DEFINER=...] [SQL SECURITY ...] VIEW`
/// - **create**: must start with `CREATE [ALGORITHM=...] [DEFINER=...] [SQL SECURITY ...] VIEW`
///   (rejects `CREATE OR REPLACE ...`)
pub fn validate_view_ddl_prefix(body: &str, mode: &str) -> Result<(), String> {
    let trimmed = body.trim();

    match mode {
        "alter" => {
            let re = Regex::new(r"(?i)^\s*CREATE\s+OR\s+REPLACE\s+(?:ALGORITHM\s*=\s*\w+\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?VIEW\s+")
                .map_err(|e| format!("Internal regex error: {e}"))?;
            if !re.is_match(trimmed) {
                return Err(
                    "View DDL in alter mode must start with 'CREATE OR REPLACE VIEW'".to_string(),
                );
            }
        }
        "create" => {
            let re_or_replace = Regex::new(r"(?i)^\s*CREATE\s+OR\s+REPLACE\s+")
                .map_err(|e| format!("Internal regex error: {e}"))?;
            if re_or_replace.is_match(trimmed) {
                return Err(
                    "View DDL in create mode must not use 'CREATE OR REPLACE VIEW' — use 'CREATE VIEW' instead"
                        .to_string(),
                );
            }
            let re_create_view = Regex::new(r"(?i)^\s*CREATE\s+(?:ALGORITHM\s*=\s*\w+\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?VIEW\s+")
                .map_err(|e| format!("Internal regex error: {e}"))?;
            if !re_create_view.is_match(trimmed) {
                return Err("View DDL in create mode must start with 'CREATE VIEW'".to_string());
            }
        }
        _ => return Err(format!("Invalid mode: '{mode}'")),
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// get_object_body — _impl + wrapper
// ---------------------------------------------------------------------------

#[cfg(not(coverage))]
pub async fn get_object_body_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    object_name: &str,
    object_type: &str,
) -> Result<String, String> {
    let pool = get_pool(state, connection_id)?;
    let ddl = schema_queries::query_ddl(&pool, database, object_name, object_type).await?;

    if ddl.is_empty() {
        return Err(format!(
            "DDL is empty for {object_type} '{object_name}' — insufficient privileges or object not found"
        ));
    }

    // For views: normalise SHOW CREATE VIEW output to CREATE OR REPLACE VIEW
    if object_type == "view" {
        let re = Regex::new(
            r"(?i)^(\s*CREATE\s+)((?:ALGORITHM\s*=\s*\w+\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?)VIEW\s+",
        )
        .map_err(|e| format!("Internal regex error: {e}"))?;
        let normalized = re.replace(&ddl, "${1}OR REPLACE ${2}VIEW ").to_string();
        return Ok(normalized);
    }

    Ok(ddl)
}

#[cfg(coverage)]
pub async fn get_object_body_impl(
    _state: &AppState,
    _connection_id: &str,
    _database: &str,
    _object_name: &str,
    object_type: &str,
) -> Result<String, String> {
    match object_type {
        "view" => Ok("CREATE OR REPLACE VIEW `v` AS SELECT 1".to_string()),
        "procedure" => Ok("CREATE PROCEDURE `p`() BEGIN SELECT 1; END".to_string()),
        "function" => Ok("CREATE FUNCTION `f`() RETURNS INT BEGIN RETURN 1; END".to_string()),
        "trigger" => {
            Ok("CREATE TRIGGER `t` BEFORE INSERT ON `tbl` FOR EACH ROW BEGIN END".to_string())
        }
        "event" => Ok("CREATE EVENT `e` ON SCHEDULE EVERY 1 DAY DO SELECT 1".to_string()),
        "table" => Ok("CREATE TABLE `t` (id INT)".to_string()),
        _ => Err(format!("Unknown object type: '{object_type}'")),
    }
}

// ---------------------------------------------------------------------------
// save_object — _impl + wrapper
// ---------------------------------------------------------------------------

#[cfg(not(coverage))]
pub async fn save_object_impl(
    request: SaveObjectRequest,
    state: &AppState,
) -> Result<SaveObjectResponse, String> {
    check_not_read_only(state, &request.connection_id)?;
    let pool = get_pool(state, &request.connection_id)?;
    let safe_db = schema_queries::safe_identifier(&request.database)?;
    let safe_name = schema_queries::safe_identifier(&request.object_name)?;

    // Parse object name and type from DDL body
    let (parsed_db, parsed_name, parsed_type) = parse_ddl_name(&request.body)?;

    // Database qualifier validation
    if let Some(ref ddl_db) = parsed_db {
        if !ddl_db.eq_ignore_ascii_case(&request.database) {
            return Err(format!(
                "DDL references database '{}' but current database is '{}'. \
                 Cross-database operations are not supported.",
                ddl_db, request.database
            ));
        }
    }

    // DDL type validation — reject if the DDL keyword doesn't match the requested object type
    let type_keyword = object_type_keyword(&request.object_type)?;
    if !parsed_type.eq_ignore_ascii_case(type_keyword) {
        return Err(format!(
            "DDL type mismatch: expected '{}' but DDL contains 'CREATE {}'",
            type_keyword, parsed_type
        ));
    }

    let is_view = request.object_type == "view";

    // View-specific prefix validation
    if is_view {
        validate_view_ddl_prefix(&request.body, &request.mode)?;
    }

    // Name mismatch validation for alter mode
    if request.mode == "alter" && !parsed_name.eq_ignore_ascii_case(&request.object_name) {
        let label = if is_view { "View" } else { "Object" };
        return Err(format!(
            "{label} name mismatch: expected '{}' but DDL defines '{}'",
            request.object_name, parsed_name
        ));
    }

    // --- SQL execution phase ---
    // Acquire a single connection so that USE, DROP, and CREATE all run on
    // the same session.  With a pool, each `.execute(&pool)` may pick a
    // different connection, making the USE ineffective.
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // Set session database to ensure the object is created in the correct schema
    let use_sql = format!("USE {safe_db}");
    if let Err(error) = execute_simple_sql(&mut conn, &use_sql).await {
        return Err(format!("Failed to set database context: {error}"));
    }

    match (is_view, request.mode.as_str()) {
        // -----------------------------------------------------------------
        // Non-view, alter mode: DROP IF EXISTS → CREATE
        // -----------------------------------------------------------------
        (false, "alter") => {
            // DROP
            let drop_sql = format!("DROP {type_keyword} IF EXISTS {safe_db}.{safe_name}");
            if let Err(error) = execute_simple_sql(&mut conn, &drop_sql).await {
                return Err(format!("Failed to drop {}: {error}", request.object_type));
            }

            // CREATE
            match execute_simple_sql(&mut conn, &request.body).await {
                Ok(_) => Ok(SaveObjectResponse {
                    success: true,
                    error_message: None,
                    drop_succeeded: true,
                    saved_object_name: Some(parsed_name),
                }),
                Err(e) => Ok(SaveObjectResponse {
                    success: false,
                    error_message: Some(format!("CREATE failed after DROP: {e}")),
                    drop_succeeded: true,
                    saved_object_name: None,
                }),
            }
        }

        // -----------------------------------------------------------------
        // Non-view, create mode: CREATE only
        // -----------------------------------------------------------------
        (false, "create") => match execute_simple_sql(&mut conn, &request.body).await {
            Ok(_) => Ok(SaveObjectResponse {
                success: true,
                error_message: None,
                drop_succeeded: false,
                saved_object_name: Some(parsed_name),
            }),
            Err(e) => Ok(SaveObjectResponse {
                success: false,
                error_message: Some(format!("Failed to create {}: {e}", request.object_type)),
                drop_succeeded: false,
                saved_object_name: None,
            }),
        },

        // -----------------------------------------------------------------
        // View, alter mode: CREATE OR REPLACE VIEW
        // -----------------------------------------------------------------
        (true, "alter") => match execute_simple_sql(&mut conn, &request.body).await {
            Ok(_) => Ok(SaveObjectResponse {
                success: true,
                error_message: None,
                drop_succeeded: false,
                saved_object_name: Some(parsed_name),
            }),
            Err(e) => Ok(SaveObjectResponse {
                success: false,
                error_message: Some(format!("Failed to alter view: {e}")),
                drop_succeeded: false,
                saved_object_name: None,
            }),
        },

        // -----------------------------------------------------------------
        // View, create mode: CREATE VIEW
        // -----------------------------------------------------------------
        (true, "create") => match execute_simple_sql(&mut conn, &request.body).await {
            Ok(_) => Ok(SaveObjectResponse {
                success: true,
                error_message: None,
                drop_succeeded: false,
                saved_object_name: Some(parsed_name),
            }),
            Err(e) => Ok(SaveObjectResponse {
                success: false,
                error_message: Some(format!("Failed to create view: {e}")),
                drop_succeeded: false,
                saved_object_name: None,
            }),
        },

        // -----------------------------------------------------------------
        // Invalid combination
        // -----------------------------------------------------------------
        _ => Err(format!(
            "Invalid mode '{}' for object type '{}'",
            request.mode, request.object_type
        )),
    }
}

#[cfg(coverage)]
pub async fn save_object_impl(
    request: SaveObjectRequest,
    state: &AppState,
) -> Result<SaveObjectResponse, String> {
    check_not_read_only(state, &request.connection_id)?;
    let _ = schema_queries::safe_identifier(&request.database)?;
    let _ = schema_queries::safe_identifier(&request.object_name)?;

    // Parse object name and type from DDL body
    let (parsed_db, parsed_name, parsed_type) = parse_ddl_name(&request.body)?;

    // Database qualifier validation
    if let Some(ref ddl_db) = parsed_db {
        if !ddl_db.eq_ignore_ascii_case(&request.database) {
            return Err(format!(
                "DDL references database '{}' but current database is '{}'. \
                 Cross-database operations are not supported.",
                ddl_db, request.database
            ));
        }
    }

    // DDL type validation — reject if the DDL keyword doesn't match the requested object type
    let expected_type = object_type_keyword(&request.object_type)?;
    if !parsed_type.eq_ignore_ascii_case(expected_type) {
        return Err(format!(
            "DDL type mismatch: expected '{}' but DDL contains 'CREATE {}'",
            expected_type, parsed_type
        ));
    }

    let is_view = request.object_type == "view";

    // View prefix validation
    if is_view {
        validate_view_ddl_prefix(&request.body, &request.mode)?;
    }

    // Name mismatch validation for alter mode
    if request.mode == "alter" && !parsed_name.eq_ignore_ascii_case(&request.object_name) {
        let label = if is_view { "View" } else { "Object" };
        return Err(format!(
            "{label} name mismatch: expected '{}' but DDL defines '{}'",
            request.object_name, parsed_name
        ));
    }

    Ok(SaveObjectResponse {
        success: true,
        error_message: None,
        drop_succeeded: false,
        saved_object_name: Some(parsed_name),
    })
}

// ---------------------------------------------------------------------------
// drop_object — _impl + wrapper
// ---------------------------------------------------------------------------

#[cfg(not(coverage))]
pub async fn drop_object_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    object_name: &str,
    object_type: &str,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let pool = get_pool(state, connection_id)?;
    let safe_db = schema_queries::safe_identifier(database)?;
    let safe_name = schema_queries::safe_identifier(object_name)?;
    let type_keyword = object_type_keyword(object_type)?;
    let sql = format!("DROP {type_keyword} IF EXISTS {safe_db}.{safe_name}");
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    match execute_simple_sql(&mut conn, &sql).await {
        Ok(_) => Ok(()),
        Err(error) => Err(format!(
            "Failed to drop {object_type} '{object_name}': {error}"
        )),
    }
}

#[cfg(coverage)]
pub async fn drop_object_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    object_name: &str,
    object_type: &str,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let _ = schema_queries::safe_identifier(database)?;
    let _ = schema_queries::safe_identifier(object_name)?;
    let _ = object_type_keyword(object_type)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// get_routine_parameters / get_routine_parameters_with_return_type — shared _impl
// ---------------------------------------------------------------------------

#[cfg(not(coverage))]
async fn get_routine_parameters_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    routine_name: &str,
    routine_type: &str,
    include_return_type: bool,
) -> Result<Vec<RoutineParameter>, String> {
    let pool = get_pool(state, connection_id)?;
    let rows = if include_return_type {
        schema_queries::query_routine_parameters_with_return_type(
            &pool,
            database,
            routine_name,
            routine_type,
        )
        .await?
    } else {
        schema_queries::query_routine_parameters(&pool, database, routine_name, routine_type)
            .await?
    };
    Ok(rows
        .into_iter()
        .map(|r| RoutineParameter {
            name: r.name,
            data_type: r.data_type,
            mode: r.mode,
            ordinal_position: r.ordinal_position,
        })
        .collect())
}

#[cfg(not(coverage))]
pub async fn get_routine_parameters_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    routine_name: &str,
    routine_type: &str,
) -> Result<Vec<RoutineParameter>, String> {
    get_routine_parameters_inner(
        state,
        connection_id,
        database,
        routine_name,
        routine_type,
        false,
    )
    .await
}

#[cfg(coverage)]
pub async fn get_routine_parameters_impl(
    _state: &AppState,
    _connection_id: &str,
    _database: &str,
    _routine_name: &str,
    _routine_type: &str,
) -> Result<Vec<RoutineParameter>, String> {
    Ok(vec![])
}

#[cfg(not(coverage))]
pub async fn get_routine_parameters_with_return_type_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    routine_name: &str,
    routine_type: &str,
) -> Result<RoutineParametersWithFoundResponse, String> {
    let params = get_routine_parameters_inner(
        state,
        connection_id,
        database,
        routine_name,
        routine_type,
        true,
    )
    .await?;

    // When the parameters query returns zero rows, we cannot distinguish between
    // "routine exists but has no parameters" and "routine does not exist" using
    // INFORMATION_SCHEMA.PARAMETERS alone. Check INFORMATION_SCHEMA.ROUTINES.
    let found = if params.is_empty() {
        let pool = get_pool(state, connection_id)?;
        schema_queries::query_routine_exists(&pool, database, routine_name, routine_type).await?
    } else {
        true
    };

    Ok(RoutineParametersWithFoundResponse {
        parameters: params,
        found,
    })
}

#[cfg(coverage)]
pub async fn get_routine_parameters_with_return_type_impl(
    _state: &AppState,
    _connection_id: &str,
    _database: &str,
    routine_name: &str,
    _routine_type: &str,
) -> Result<RoutineParametersWithFoundResponse, String> {
    // In coverage mode, treat routines with names starting with "missing" as not found
    let found = !routine_name.to_lowercase().starts_with("missing");
    Ok(RoutineParametersWithFoundResponse {
        parameters: vec![],
        found,
    })
}

// ---------------------------------------------------------------------------
// Thin Tauri command wrappers
// ---------------------------------------------------------------------------

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_object_body(
    connection_id: String,
    database: String,
    object_name: String,
    object_type: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let start = std::time::Instant::now();
    let result = get_object_body_impl(
        &state,
        &connection_id,
        &database,
        &object_name,
        &object_type,
    )
    .await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);
    let type_upper = object_type.to_uppercase();
    let sql_text = format!("SHOW CREATE {type_upper} `{database}`.`{object_name}`");

    log_single_entry(
        &state.db,
        NewHistoryEntry {
            connection_id: conn_id,
            database_name,
            sql_text,
            duration_ms: Some(duration_ms),
            row_count: Some(if result.is_ok() { 1 } else { 0 }),
            affected_rows: Some(0),
            success: result.is_ok(),
            error_message: result.as_ref().err().cloned(),
        },
    );

    result
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn save_object(
    request: SaveObjectRequest,
    state: State<'_, AppState>,
) -> Result<SaveObjectResponse, String> {
    let start = std::time::Instant::now();
    let connection_id_for_log = request.connection_id.clone();
    let sql_text = request.body.clone();
    let result = save_object_impl(request, &state).await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id_for_log);

    match &result {
        Ok(response) => {
            log_single_entry(
                &state.db,
                NewHistoryEntry {
                    connection_id: conn_id,
                    database_name,
                    sql_text,
                    duration_ms: Some(duration_ms),
                    row_count: Some(0),
                    affected_rows: Some(0),
                    success: response.success,
                    error_message: response.error_message.clone(),
                },
            );
        }
        Err(e) => {
            log_single_entry(
                &state.db,
                NewHistoryEntry {
                    connection_id: conn_id,
                    database_name,
                    sql_text,
                    duration_ms: Some(duration_ms),
                    row_count: Some(0),
                    affected_rows: Some(0),
                    success: false,
                    error_message: Some(e.clone()),
                },
            );
        }
    }

    result
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn drop_object(
    connection_id: String,
    database: String,
    object_name: String,
    object_type: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let start = std::time::Instant::now();
    let result = drop_object_impl(
        &state,
        &connection_id,
        &database,
        &object_name,
        &object_type,
    )
    .await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);
    let type_keyword = object_type_keyword(&object_type).unwrap_or("UNKNOWN");
    let sql_text = format!("DROP {type_keyword} IF EXISTS `{database}`.`{object_name}`");

    log_single_entry(
        &state.db,
        NewHistoryEntry {
            connection_id: conn_id,
            database_name,
            sql_text,
            duration_ms: Some(duration_ms),
            row_count: Some(0),
            affected_rows: Some(0),
            success: result.is_ok(),
            error_message: result.as_ref().err().cloned(),
        },
    );

    result
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_routine_parameters(
    connection_id: String,
    database: String,
    routine_name: String,
    routine_type: String,
    state: State<'_, AppState>,
) -> Result<Vec<RoutineParameter>, String> {
    get_routine_parameters_impl(
        &state,
        &connection_id,
        &database,
        &routine_name,
        &routine_type,
    )
    .await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_routine_parameters_with_return_type(
    connection_id: String,
    database: String,
    routine_name: String,
    routine_type: String,
    state: State<'_, AppState>,
) -> Result<RoutineParametersWithFoundResponse, String> {
    get_routine_parameters_with_return_type_impl(
        &state,
        &connection_id,
        &database,
        &routine_name,
        &routine_type,
    )
    .await
}
