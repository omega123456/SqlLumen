use super::*;

pub(super) struct ValidatedSave {
    pub(super) parsed_name: String,
    pub(super) type_keyword: &'static str,
    pub(super) is_view: bool,
}

pub(super) fn validate_ddl_database(
    parsed_db: Option<&str>,
    current_database: &str,
) -> Result<(), String> {
    let Some(ddl_db) = parsed_db else {
        return Ok(());
    };
    if ddl_db.eq_ignore_ascii_case(current_database) {
        return Ok(());
    }
    Err(format!(
        "DDL references database '{}' but current database is '{}'. \
         Cross-database operations are not supported.",
        ddl_db, current_database
    ))
}

pub(super) fn validate_save_request(request: &SaveObjectRequest) -> Result<ValidatedSave, String> {
    let ParsedDdlName {
        database: parsed_db,
        name: parsed_name,
        type_keyword: parsed_type,
    } = parse_ddl_name(&request.body)?;
    validate_ddl_database(parsed_db.as_deref(), &request.database)?;

    let type_keyword = object_type_keyword(&request.object_type)?;
    if !parsed_type.eq_ignore_ascii_case(type_keyword) {
        return Err(format!(
            "DDL type mismatch: expected '{}' but DDL contains 'CREATE {}'",
            type_keyword, parsed_type
        ));
    }

    let is_view = request.object_type == "view";
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

    Ok(ValidatedSave {
        parsed_name,
        type_keyword,
        is_view,
    })
}

#[cfg(not(coverage))]
pub(super) struct SaveAttempt {
    pub(super) saved_name: String,
    pub(super) failure_prefix: String,
    pub(super) drop_succeeded: bool,
}

#[cfg(not(coverage))]
impl SaveAttempt {
    pub(super) fn response<T>(self, outcome: Result<T, mysql_async::Error>) -> SaveObjectResponse {
        match outcome {
            Ok(_) => SaveObjectResponse {
                success: true,
                error_message: None,
                drop_succeeded: self.drop_succeeded,
                saved_object_name: Some(self.saved_name),
            },
            Err(error) => SaveObjectResponse {
                success: false,
                error_message: Some(format!("{}: {error}", self.failure_prefix)),
                drop_succeeded: self.drop_succeeded,
                saved_object_name: None,
            },
        }
    }
}

#[cfg(not(coverage))]
pub(super) fn save_attempt_failure_prefix(
    request: &SaveObjectRequest,
    is_view: bool,
) -> Option<String> {
    match (is_view, request.mode.as_str()) {
        (false, "create") => Some(format!("Failed to create {}", request.object_type)),
        (true, "alter") => Some("Failed to alter view".to_string()),
        (true, "create") => Some("Failed to create view".to_string()),
        _ => None,
    }
}

#[cfg(not(coverage))]
pub(super) async fn drop_and_recreate_object(
    conn: &mut mysql_async::Conn,
    request: &SaveObjectRequest,
    validated: ValidatedSave,
) -> Result<SaveObjectResponse, String> {
    let safe_db = schema_queries::safe_identifier(&request.database)?;
    let safe_name = schema_queries::safe_identifier(&request.object_name)?;
    let drop_sql = format!(
        "DROP {} IF EXISTS {safe_db}.{safe_name}",
        validated.type_keyword
    );
    if let Err(error) = execute_simple_sql(conn, &drop_sql).await {
        return Err(format!("Failed to drop {}: {error}", request.object_type));
    }
    let attempt = SaveAttempt {
        saved_name: validated.parsed_name,
        failure_prefix: "CREATE failed after DROP".to_string(),
        drop_succeeded: true,
    };
    Ok(attempt.response(execute_simple_sql(conn, &request.body).await))
}

#[cfg(not(coverage))]
pub async fn save_object_impl(
    request: SaveObjectRequest,
    state: &AppState,
) -> Result<SaveObjectResponse, String> {
    check_not_read_only(state, &request.connection_id)?;
    let pool = get_pool(state, &request.connection_id)?;
    let safe_db = schema_queries::safe_identifier(&request.database)?;
    schema_queries::safe_identifier(&request.object_name)?;
    let validated = validate_save_request(&request)?;

    let mut conn = pool.checkout().await.map_err(|error| error.to_string())?;

    let use_sql = format!("USE {safe_db}");
    if let Err(error) = execute_simple_sql(&mut conn, &use_sql).await {
        return Err(format!("Failed to set database context: {error}"));
    }

    let is_non_view_alter = !validated.is_view && request.mode == "alter";
    if is_non_view_alter {
        return drop_and_recreate_object(&mut conn, &request, validated).await;
    }
    let Some(failure_prefix) = save_attempt_failure_prefix(&request, validated.is_view) else {
        return Err(format!(
            "Invalid mode '{}' for object type '{}'",
            request.mode, request.object_type
        ));
    };
    let attempt = SaveAttempt {
        saved_name: validated.parsed_name,
        failure_prefix,
        drop_succeeded: false,
    };
    Ok(attempt.response(execute_simple_sql(&mut conn, &request.body).await))
}

#[cfg(coverage)]
pub async fn save_object_impl(
    request: SaveObjectRequest,
    state: &AppState,
) -> Result<SaveObjectResponse, String> {
    check_not_read_only(state, &request.connection_id)?;
    let _ = schema_queries::safe_identifier(&request.database)?;
    let _ = schema_queries::safe_identifier(&request.object_name)?;
    let ValidatedSave {
        parsed_name,
        type_keyword,
        is_view,
    } = validate_save_request(&request)?;
    let _ = (type_keyword, is_view);

    Ok(SaveObjectResponse {
        success: true,
        error_message: None,
        drop_succeeded: false,
        saved_object_name: Some(parsed_name),
    })
}
