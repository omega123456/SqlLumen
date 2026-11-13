use super::*;

/// Issue a logged `USE` for `database` on the held connection.
pub(super) async fn use_database_on(
    conn: &mut mysql_async::Conn,
    database: &str,
) -> Result<(), mysql_async::Error> {
    use mysql_async::prelude::Queryable;

    let sql = match crate::mysql::schema_queries::safe_identifier(database) {
        Ok(identifier) => format!("USE {identifier}"),
        Err(message) => {
            return Err(mysql_async::Error::Other(message.into()));
        }
    };
    crate::mysql::query_log::log_outgoing_sql(&sql);
    conn.query_drop(&sql).await.inspect_err(|error| {
        crate::mysql::query_log::log_mysql_async_error(error);
    })
}

pub(super) fn is_other_database(current: Option<&str>, database: &str) -> bool {
    current != Some(database)
}

/// Read the session's current database and switch to the stored run
/// database when it differs. Returns what to restore afterwards: `None` when
/// no `USE` was issued, `Some(previous)` otherwise (`previous` is `None` when
/// the session had no database).
pub(super) async fn switch_to_run_database(
    conn: &mut mysql_async::Conn,
    prepared: &PreparedResultExport,
) -> Result<Option<Option<String>>, String> {
    use mysql_async::prelude::Queryable;

    let sql = "SELECT DATABASE()";
    crate::mysql::query_log::log_outgoing_sql(sql);
    let current: Option<String> = conn
        .query_first::<Option<String>, _>(sql)
        .await
        .map_err(|error| {
            crate::mysql::query_log::log_mysql_async_error(&error);
            format!("Couldn't read the session's database: {error}")
        })?
        .flatten();

    match &prepared.run_database {
        RunDatabase::Named(database) if is_other_database(current.as_deref(), database) => {
            use_database_on(conn, database).await.map_err(|error| {
                tracing::warn!(
                    job_id = prepared.job_id,
                    database,
                    ?error,
                    "result export: couldn't switch to the query's database"
                );
                format!("Couldn't switch to database '{database}': {error}")
            })?;
            Ok(Some(current))
        }
        _ => Ok(None),
    }
}

/// Restore the session's previous database after the re-run. Retries once on
/// error 1317, which a late export `KILL QUERY` can cause. A NULL previous
/// database can't be restored and is skipped with a warning.
pub(super) async fn restore_database(
    conn: &mut mysql_async::Conn,
    connection_id: &str,
    previous: Option<String>,
) -> Option<String> {
    let Some(previous) = previous else {
        tracing::warn!(
            connection_id,
            "result export: the session had no database before the export; it stays on the query's database"
        );
        return None;
    };
    let mut result = use_database_on(conn, &previous).await;
    if matches!(&result, Err(error) if crate::mysql::multi_result::is_query_interrupted(error)) {
        result = use_database_on(conn, &previous).await;
    }
    match result {
        Ok(()) => None,
        Err(error) => {
            tracing::warn!(
                connection_id,
                database = previous,
                ?error,
                "result export: couldn't restore the session's database"
            );
            Some(format!(
                "The session couldn't switch back to database '{previous}': {error}"
            ))
        }
    }
}
