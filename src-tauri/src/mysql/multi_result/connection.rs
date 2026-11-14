use super::*;

pub(crate) fn map_mysql_error(error: &mysql_async::Error) -> String {
    crate::mysql::query_log::log_mysql_async_error(error);
    if is_query_interrupted(error) {
        return "Query cancelled".to_string();
    }
    format!("Query failed: {error}")
}

pub async fn build_connection(
    params: &crate::mysql::registry::StoredConnectionParams,
) -> Result<mysql_async::Conn, String> {
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

    if params.ssl.enabled {
        let mut ssl_opts = mysql_async::SslOpts::default();

        ssl_opts = match params.ssl.ca_path {
            Some(ref ca_path) => {
                ssl_opts.with_root_certs(vec![std::path::PathBuf::from(ca_path).into()])
            }
            None => ssl_opts.with_danger_accept_invalid_certs(true),
        };

        if let (Some(ref cert_path), Some(ref key_path)) =
            (&params.ssl.cert_path, &params.ssl.key_path)
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
        .map_err(|error| format!("Failed to connect via mysql_async: {error}"))?;

    Ok(conn)
}
