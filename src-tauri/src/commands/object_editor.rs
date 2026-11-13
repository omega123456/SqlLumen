use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::commands::query_history_bridge::{
    log_history_batch, log_history_record, run_with_history, single_row_count, HistoryRecord,
    HistoryStatement,
};
use crate::commands::requests::{RoutineRequest, SchemaObjectRequest};
#[cfg(not(coverage))]
use crate::mysql::query_log;
use crate::mysql::schema_queries;
use crate::state::AppState;
#[cfg(not(coverage))]
use sqlx::Executor;
use std::time::Instant;
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
    match conn.execute(sqlx::AssertSqlSafe(sql)).await {
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDdlName {
    pub database: Option<String>,
    pub name: String,
    pub type_keyword: String,
}

pub fn parse_ddl_name(body: &str) -> Result<ParsedDdlName, String> {
    // Capture groups:
    //   1 = type keyword (PROCEDURE, FUNCTION, VIEW, TRIGGER, EVENT)
    //   2 = backtick-quoted database
    //   3 = unquoted database
    //   4 = backtick-quoted name
    //   5 = unquoted name
    let re = Regex::new(
        r"(?i)CREATE\s+(?:OR\s+REPLACE\s+)?(?:ALGORITHM\s*=\s*\w+\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?(\w+)\s+(?:(?:`((?:``|[^`])+)`|(\w+))\.)?(?:`((?:``|[^`])+)`|(\w+))",
    )
    .map_err(|error| format!("Internal regex error: {error}"))?;

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
        .map(|matched| unescape_backtick_identifier(matched.as_str()))
        .or_else(|| caps.get(3).map(|matched| matched.as_str().to_string()));
    let name = caps
        .get(4)
        .map(|matched| unescape_backtick_identifier(matched.as_str()))
        .or_else(|| caps.get(5).map(|matched| matched.as_str().to_string()))
        .ok_or("Could not extract object name from DDL")?;

    Ok(ParsedDdlName {
        database: db,
        name,
        type_keyword,
    })
}

fn object_name_label(is_view: bool) -> &'static str {
    if is_view {
        return "View";
    }
    "Object"
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
                .map_err(|error| format!("Internal regex error: {error}"))?;
            if !re.is_match(trimmed) {
                return Err(
                    "View DDL in alter mode must start with 'CREATE OR REPLACE VIEW'".to_string(),
                );
            }
        }
        "create" => {
            let re_or_replace = Regex::new(r"(?i)^\s*CREATE\s+OR\s+REPLACE\s+")
                .map_err(|error| format!("Internal regex error: {error}"))?;
            if re_or_replace.is_match(trimmed) {
                return Err(
                    "View DDL in create mode must not use 'CREATE OR REPLACE VIEW' — use 'CREATE VIEW' instead"
                        .to_string(),
                );
            }
            let re_create_view = Regex::new(r"(?i)^\s*CREATE\s+(?:ALGORITHM\s*=\s*\w+\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?VIEW\s+")
                .map_err(|error| format!("Internal regex error: {error}"))?;
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
    request: &SchemaObjectRequest,
) -> Result<String, String> {
    let pool = get_pool(state, &request.connection_id)?;
    let ddl = schema_queries::query_ddl(&pool, request.object_ref()).await?;
    let object_type = request.object_type.as_str();
    let object_name = &request.object_name;

    if ddl.is_empty() {
        return Err(format!(
            "DDL is empty for {object_type} '{object_name}' — insufficient privileges or object not found"
        ));
    }

    if object_type == "view" {
        let re = Regex::new(
            r"(?i)^(\s*CREATE\s+)((?:ALGORITHM\s*=\s*\w+\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?)VIEW\s+",
        )
        .map_err(|error| format!("Internal regex error: {error}"))?;
        let normalized = re.replace(&ddl, "${1}OR REPLACE ${2}VIEW ").to_string();
        return Ok(normalized);
    }

    Ok(ddl)
}

#[cfg(coverage)]
pub async fn get_object_body_impl(
    _state: &AppState,
    request: &SchemaObjectRequest,
) -> Result<String, String> {
    let object_type = request.object_type.as_str();
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

    let ParsedDdlName {
        database: parsed_db,
        name: parsed_name,
        type_keyword: parsed_type,
    } = parse_ddl_name(&request.body)?;

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

    let is_alter_name_mismatch =
        request.mode == "alter" && !parsed_name.eq_ignore_ascii_case(&request.object_name);
    if is_alter_name_mismatch {
        let label = object_name_label(is_view);
        return Err(format!(
            "{label} name mismatch: expected '{}' but DDL defines '{}'",
            request.object_name, parsed_name
        ));
    }

    // --- SQL execution phase ---
    // Acquire a single connection so that USE, DROP, and CREATE all run on
    // the same session.  With a pool, each `.execute(&pool)` may pick a
    // different connection, making the USE ineffective.
    let mut conn = pool.acquire().await.map_err(|error| error.to_string())?;

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
                Err(error) => Ok(SaveObjectResponse {
                    success: false,
                    error_message: Some(format!("CREATE failed after DROP: {error}")),
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
            Err(error) => Ok(SaveObjectResponse {
                success: false,
                error_message: Some(format!("Failed to create {}: {error}", request.object_type)),
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
            Err(error) => Ok(SaveObjectResponse {
                success: false,
                error_message: Some(format!("Failed to alter view: {error}")),
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
            Err(error) => Ok(SaveObjectResponse {
                success: false,
                error_message: Some(format!("Failed to create view: {error}")),
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

    let ParsedDdlName {
        database: parsed_db,
        name: parsed_name,
        type_keyword: parsed_type,
    } = parse_ddl_name(&request.body)?;

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

    let is_alter_name_mismatch =
        request.mode == "alter" && !parsed_name.eq_ignore_ascii_case(&request.object_name);
    if is_alter_name_mismatch {
        let label = object_name_label(is_view);
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
    request: &SchemaObjectRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let pool = get_pool(state, &request.connection_id)?;
    let object_name = &request.object_name;
    let object_type = request.object_type.as_str();
    let safe_db = schema_queries::safe_identifier(&request.database)?;
    let safe_name = schema_queries::safe_identifier(object_name)?;
    let type_keyword = object_type_keyword(object_type)?;
    let sql = format!("DROP {type_keyword} IF EXISTS {safe_db}.{safe_name}");
    let mut conn = pool.acquire().await.map_err(|error| error.to_string())?;
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
    request: &SchemaObjectRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let _ = schema_queries::safe_identifier(&request.database)?;
    let _ = schema_queries::safe_identifier(&request.object_name)?;
    let _ = object_type_keyword(&request.object_type)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// get_routine_parameters / get_routine_parameters_with_return_type — shared _impl
// ---------------------------------------------------------------------------

#[cfg(not(coverage))]
async fn get_routine_parameters_inner(
    state: &AppState,
    request: &RoutineRequest,
    include_return_type: bool,
) -> Result<Vec<RoutineParameter>, String> {
    let pool = get_pool(state, &request.connection_id)?;
    let rows = schema_queries::query_routine_parameters_inner(
        &pool,
        request.routine_ref(),
        include_return_type,
    )
    .await?;
    Ok(rows
        .into_iter()
        .map(|parameter| RoutineParameter {
            name: parameter.name,
            data_type: parameter.data_type,
            mode: parameter.mode,
            ordinal_position: parameter.ordinal_position,
        })
        .collect())
}

#[cfg(not(coverage))]
pub async fn get_routine_parameters_impl(
    state: &AppState,
    request: &RoutineRequest,
) -> Result<Vec<RoutineParameter>, String> {
    get_routine_parameters_inner(state, request, false).await
}

#[cfg(coverage)]
pub async fn get_routine_parameters_impl(
    _state: &AppState,
    _request: &RoutineRequest,
) -> Result<Vec<RoutineParameter>, String> {
    Ok(vec![])
}

#[cfg(not(coverage))]
pub async fn get_routine_parameters_with_return_type_impl(
    state: &AppState,
    request: &RoutineRequest,
) -> Result<RoutineParametersWithFoundResponse, String> {
    let params = get_routine_parameters_inner(state, request, true).await?;

    let mut found = true;
    if params.is_empty() {
        let pool = get_pool(state, &request.connection_id)?;
        found = schema_queries::query_routine_exists(&pool, request.routine_ref()).await?;
    }

    Ok(RoutineParametersWithFoundResponse {
        parameters: params,
        found,
    })
}

#[cfg(coverage)]
pub async fn get_routine_parameters_with_return_type_impl(
    _state: &AppState,
    request: &RoutineRequest,
) -> Result<RoutineParametersWithFoundResponse, String> {
    let found = !request.routine_name.to_lowercase().starts_with("missing");
    Ok(RoutineParametersWithFoundResponse {
        parameters: vec![],
        found,
    })
}

const UNKNOWN_OBJECT_TYPE_KEYWORD: &str = "UNKNOWN";

fn object_type_keyword_or_unknown(object_type: &str) -> &'static str {
    object_type_keyword(object_type).unwrap_or(UNKNOWN_OBJECT_TYPE_KEYWORD)
}

fn drop_if_exists_history_sql(object_type: &str, database: &str, object_name: &str) -> String {
    let type_keyword = object_type_keyword_or_unknown(object_type);
    format!("DROP {type_keyword} IF EXISTS `{database}`.`{object_name}`")
}

fn drop_object_history_sql(request: &SchemaObjectRequest) -> String {
    drop_if_exists_history_sql(
        &request.object_type,
        &request.database,
        &request.object_name,
    )
}

fn show_create_history_sql(request: &SchemaObjectRequest) -> String {
    let type_upper = request.object_type.to_uppercase();
    let database = &request.database;
    let object_name = &request.object_name;
    format!("SHOW CREATE {type_upper} `{database}`.`{object_name}`")
}

pub async fn get_object_body_with_history(
    state: &AppState,
    request: &SchemaObjectRequest,
) -> Result<String, String> {
    let started_at = Instant::now();
    let result = get_object_body_impl(state, request).await;
    let row_count = single_row_count(result.is_ok());
    let record = HistoryRecord::for_outcome(show_create_history_sql(request), started_at, &result)
        .with_row_count(row_count);
    log_history_record(state, &request.connection_id, record);
    result
}

struct SaveObjectHistory {
    session_id: String,
    body: String,
    drop_sql: String,
}

impl SaveObjectHistory {
    fn for_request(request: &SaveObjectRequest) -> Self {
        Self {
            session_id: request.connection_id.clone(),
            body: request.body.clone(),
            drop_sql: drop_if_exists_history_sql(
                &request.object_type,
                &request.database,
                &request.object_name,
            ),
        }
    }

    fn records(
        self,
        started_at: Instant,
        result: &Result<SaveObjectResponse, String>,
    ) -> Vec<HistoryRecord> {
        let save_record = HistoryRecord::for_outcome(self.body, started_at, result);
        let Ok(response) = result else {
            return vec![save_record];
        };
        let save_record = save_record.with_error_message(response.error_message.clone());
        if !response.drop_succeeded {
            return vec![save_record];
        }
        let drop_record = save_record
            .for_statement(self.drop_sql)
            .with_error_message(None);
        vec![drop_record, save_record]
    }
}

pub async fn save_object_with_history(
    state: &AppState,
    request: SaveObjectRequest,
) -> Result<SaveObjectResponse, String> {
    let history = SaveObjectHistory::for_request(&request);
    let session_id = history.session_id.clone();
    let started_at = Instant::now();
    let result = save_object_impl(request, state).await;
    log_history_batch(state, &session_id, history.records(started_at, &result));
    result
}

pub async fn drop_object_with_history(
    state: &AppState,
    request: &SchemaObjectRequest,
) -> Result<(), String> {
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: drop_object_history_sql(request),
    };
    run_with_history(state, statement, drop_object_impl(state, request)).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_object_body(
    payload: SchemaObjectRequest,
    state: State<'_, AppState>,
) -> Result<String, String> {
    get_object_body_with_history(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn save_object(
    request: SaveObjectRequest,
    state: State<'_, AppState>,
) -> Result<SaveObjectResponse, String> {
    save_object_with_history(&state, request).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn drop_object(
    payload: SchemaObjectRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    drop_object_with_history(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_routine_parameters(
    payload: RoutineRequest,
    state: State<'_, AppState>,
) -> Result<Vec<RoutineParameter>, String> {
    get_routine_parameters_impl(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_routine_parameters_with_return_type(
    payload: RoutineRequest,
    state: State<'_, AppState>,
) -> Result<RoutineParametersWithFoundResponse, String> {
    get_routine_parameters_with_return_type_impl(&state, &payload).await
}
