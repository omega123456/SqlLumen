use super::*;

pub const QUERY_CANCELLED_MESSAGE: &str = "Query cancelled";

pub(crate) fn map_mysql_error(error: &mysql_async::Error) -> String {
    crate::mysql::query_log::log_mysql_async_error(error);
    if is_query_interrupted(error) {
        return QUERY_CANCELLED_MESSAGE.to_string();
    }
    format!("Query failed: {error}")
}

pub async fn build_connection(
    params: &crate::mysql::registry::StoredConnectionParams,
) -> Result<mysql_async::Conn, String> {
    use crate::mysql::connection_options::connect_with_params;

    let password = params.resolve_password()?;
    let connection_params = params.to_connection_params(password);
    connect_with_params(&connection_params)
        .await
        .map_err(|failure| format!("Failed to connect via mysql_async: {failure}"))
}
