use super::*;

pub(super) async fn use_database_on(
    conn: &mut mysql_async::Conn,
    database: &str,
) -> Result<(), mysql_async::Error> {
    use crate::mysql::logged_query::{execute, LoggedStatement};

    let sql = match crate::mysql::schema_queries::safe_identifier(database) {
        Ok(identifier) => format!("USE {identifier}"),
        Err(message) => {
            return Err(mysql_async::Error::Other(message.into()));
        }
    };
    execute(conn, LoggedStatement::text(&sql)).await.map(|_| ())
}

pub(super) fn is_other_database(current: Option<&str>, database: &str) -> bool {
    current != Some(database)
}

pub(super) async fn switch_to_run_database(
    conn: &mut mysql_async::Conn,
    prepared: &PreparedResultExport,
) -> Result<Option<Option<String>>, String> {
    let current = read_session_database(conn).await?;

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

async fn read_session_database(conn: &mut mysql_async::Conn) -> Result<Option<String>, String> {
    use crate::mysql::logged_query::{fetch_first, LoggedStatement};

    let first_row = fetch_first(conn, LoggedStatement::text("SELECT DATABASE()"))
        .await
        .map_err(|error| format!("Couldn't read the session's database: {error}"))?;
    let Some(row) = first_row else {
        return Ok(None);
    };
    crate::mysql::cell_values::DecodedRow::from_row(&row)
        .optional_text(0)
        .map_err(|error| format!("Couldn't read the session's database: {error}"))
}

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
