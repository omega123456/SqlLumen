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
    use crate::mysql::connection_options::{connect_timeout, connect_within_timeout, mysql_opts};

    let password = crate::credentials::resolve_password(&params.profile_id, params.has_password)?;
    let connection_params = params.to_connection_params(password);
    let opts = mysql_opts(&connection_params)?;
    connect_within_timeout(opts, connect_timeout(&connection_params))
        .await
        .map_err(|error| format!("Failed to connect via mysql_async: {error}"))
}
