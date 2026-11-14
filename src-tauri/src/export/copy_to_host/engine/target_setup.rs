use super::*;

pub async fn open_pool_for_profile(
    state: &AppState,
    profile_id: &str,
) -> Result<MySqlPool, String> {
    let record = {
        let conn = state
            .db
            .lock()
            .map_err(|error| format!("Failed to lock database: {error}"))?;
        match crate::db::connections::get_connection(&conn, profile_id) {
            Ok(Some(record)) => record,
            Ok(None) => return Err(format!("Connection '{profile_id}' not found")),
            Err(error) => return Err(error.to_string()),
        }
    };

    let password = crate::credentials::resolve_password(profile_id, record.has_password)?;

    let stored = StoredConnectionParams::from_connection_record(profile_id, &record);

    let params = stored.to_connection_params(password);
    pool::create_pool(&params)
        .await
        .map_err(|error| format!("Failed to connect to target: {error}"))
}

pub async fn resolve_target_pool(
    state: &AppState,
    target_profile_id: &str,
) -> Result<ResolvedTargetPool, String> {
    if let Some(pool) = state.registry.get_pool_by_profile(target_profile_id) {
        return Ok(ResolvedTargetPool { pool, owned: false });
    }

    let pool = open_pool_for_profile(state, target_profile_id).await?;
    Ok(ResolvedTargetPool { pool, owned: true })
}

pub async fn read_source_charset(
    source: &MySqlPool,
    database: &str,
) -> Result<DatabaseEncoding, String> {
    let sql = "SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME \
               FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?";
    query_log::log_outgoing_sql_bound(sql, &[database.to_string()]);
    let row = sqlx::query(sql)
        .bind(database)
        .fetch_optional(source)
        .await
        .map_err(|error| {
            query_log::log_execute_error(&error);
            format!("Failed to read source charset: {error}")
        })?
        .ok_or_else(|| format!("Source database '{database}' not found"))?;
    query_log::log_mysql_row(&row);
    Ok(DatabaseEncoding {
        charset: row.try_get(0).unwrap_or_default(),
        collation: row.try_get(1).unwrap_or_default(),
    })
}

pub async fn target_database_exists(
    target: &mut MySqlConnection,
    database: &str,
) -> Result<bool, String> {
    let sql = "SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?";
    query_log::log_outgoing_sql_bound(sql, &[database.to_string()]);
    let row = sqlx::query(sql)
        .bind(database)
        .fetch_optional(&mut *target)
        .await
        .map_err(|error| {
            query_log::log_execute_error(&error);
            format!("Failed to check target database: {error}")
        })?;
    if let Some(row) = &row {
        query_log::log_mysql_row(row);
    }
    Ok(row.is_some())
}

pub async fn ensure_target_database(
    source: &MySqlPool,
    target: &mut MySqlConnection,
    params: &CopyToHostParams,
) -> Result<(), String> {
    let target_database = params.target_database.as_str();
    if target_database_exists(&mut *target, target_database).await? {
        return Ok(());
    }
    let DatabaseEncoding { charset, collation } =
        read_source_charset(source, &params.source_database).await?;
    validate_mysql_identifier_token("charset", &charset)?;
    validate_mysql_identifier_token("collation", &collation)?;
    let safe_db = safe_identifier(target_database)?;
    let mut sql = format!("CREATE DATABASE IF NOT EXISTS {safe_db}");
    if !charset.is_empty() {
        sql.push_str(&format!(" CHARACTER SET {charset}"));
    }
    if !collation.is_empty() {
        sql.push_str(&format!(" COLLATE {collation}"));
    }
    run_target_statement(&mut *target, &sql).await
}

pub async fn read_max_allowed_packet(target: &mut MySqlConnection) -> Option<u64> {
    let sql = "SELECT @@max_allowed_packet";
    query_log::log_outgoing_sql(sql);
    match sqlx::query(sql).fetch_optional(&mut *target).await {
        Ok(Some(row)) => row
            .try_get::<i64, _>(0)
            .ok()
            .map(|value| value.max(0) as u64),
        Ok(None) => None,
        Err(error) => {
            query_log::log_execute_error(&error);
            None
        }
    }
}

pub async fn run_target_statement(target: &mut MySqlConnection, sql: &str) -> Result<(), String> {
    query_log::log_outgoing_sql(sql);
    match sqlx::query(sqlx::AssertSqlSafe(sql))
        .execute(&mut *target)
        .await
    {
        Ok(result) => {
            query_log::log_execute_result(&result);
            Ok(())
        }
        Err(error) => {
            query_log::log_execute_error(&error);
            Err(error.to_string())
        }
    }
}
