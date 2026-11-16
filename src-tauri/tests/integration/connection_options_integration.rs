//! The shared mysql_async connection-options builder: TLS policy, client identity, socket
//! preference, default database and the connect-timeout wrapper.

use std::time::Duration;

use sqllumen_lib::mysql::connection_options::{
    connect_timed_out_error, connect_timeout, mysql_opts, ConnectTimedOut,
    CLIENT_IDENTITY_INCOMPLETE_MESSAGE,
};
use sqllumen_lib::mysql::pool::{ConnectionParams, SslSettings};

use crate::common::tls_fixtures::fixture_path;

const ONE_SECOND: Duration = Duration::from_secs(1);

fn params(port: u16, ssl: SslSettings) -> ConnectionParams {
    ConnectionParams {
        host: "127.0.0.1".to_string(),
        port,
        username: "root".to_string(),
        password: String::new(),
        default_database: None,
        ssl,
        connect_timeout_secs: 1,
    }
}

fn plain_params() -> ConnectionParams {
    params(3306, SslSettings::default())
}

fn tls_settings(ca_file: Option<&str>) -> SslSettings {
    SslSettings {
        enabled: true,
        ca_path: ca_file.map(fixture_path),
        cert_path: None,
        key_path: None,
    }
}

fn client_identity_settings(cert_file: Option<&str>, key_file: Option<&str>) -> SslSettings {
    SslSettings {
        cert_path: cert_file.map(fixture_path),
        key_path: key_file.map(fixture_path),
        ..tls_settings(Some("ca.pem"))
    }
}

#[test]
fn options_carry_host_port_user_and_never_prefer_a_socket() {
    let opts = mysql_opts(&plain_params()).expect("plain options should build");

    assert_eq!(opts.ip_or_hostname(), "127.0.0.1");
    assert_eq!(opts.tcp_port(), 3306);
    assert_eq!(opts.user(), Some("root"));
    assert!(!opts.prefer_socket());
}

#[test]
fn empty_password_is_sent_as_no_password() {
    let opts = mysql_opts(&plain_params()).expect("plain options should build");
    assert_eq!(opts.pass(), None);

    let with_password = ConnectionParams {
        password: "secret".to_string(),
        ..plain_params()
    };
    let opts = mysql_opts(&with_password).expect("options with a password should build");
    assert_eq!(opts.pass(), Some("secret"));
}

#[test]
fn default_database_is_applied_only_when_non_empty() {
    let with_database = ConnectionParams {
        default_database: Some("shop".to_string()),
        ..plain_params()
    };
    let empty_database = ConnectionParams {
        default_database: Some(String::new()),
        ..plain_params()
    };

    let opts = mysql_opts(&with_database).expect("options should build");
    assert_eq!(opts.db_name(), Some("shop"));
    let opts = mysql_opts(&empty_database).expect("options should build");
    assert_eq!(opts.db_name(), None);
    let opts = mysql_opts(&plain_params()).expect("options should build");
    assert_eq!(opts.db_name(), None);
}

#[test]
fn ssl_off_sends_no_tls_options() {
    let opts = mysql_opts(&plain_params()).expect("plain options should build");
    assert!(opts.ssl_opts().is_none());
}

#[test]
fn ssl_with_ca_verifies_the_chain_but_skips_the_hostname() {
    let opts = mysql_opts(&params(3306, tls_settings(Some("ca.pem")))).expect("should build");
    let ssl = opts.ssl_opts().expect("TLS options should be present");

    let root_certs = format!("{:?}", ssl.root_certs());
    assert_eq!(ssl.root_certs().len(), 1);
    assert!(root_certs.contains(&fixture_path("ca.pem")), "{root_certs}");
    assert!(ssl.skip_domain_validation());
    assert!(!ssl.accept_invalid_certs());
    assert!(!ssl.disable_built_in_roots());
    assert!(ssl.client_identity().is_none());
}

#[test]
fn ssl_without_ca_accepts_any_certificate() {
    let opts = mysql_opts(&params(3306, tls_settings(None))).expect("should build");
    let ssl = opts.ssl_opts().expect("TLS options should be present");

    assert!(ssl.accept_invalid_certs());
    assert!(ssl.root_certs().is_empty());
}

#[test]
fn client_certificate_and_key_together_set_the_client_identity() {
    let ssl = client_identity_settings(Some("client.pem"), Some("client-key.pem"));
    let opts = mysql_opts(&params(3306, ssl)).expect("should build");

    let tls = opts.ssl_opts().expect("TLS options should be present");
    assert!(tls.client_identity().is_some());
}

#[test]
fn client_certificate_without_key_is_a_configuration_error() {
    let ssl = client_identity_settings(Some("client.pem"), None);
    let error = mysql_opts(&params(3306, ssl)).expect_err("cert without key must be rejected");
    assert_eq!(error, CLIENT_IDENTITY_INCOMPLETE_MESSAGE);
}

#[test]
fn client_key_without_certificate_is_a_configuration_error() {
    let ssl = client_identity_settings(None, Some("client-key.pem"));
    let error = mysql_opts(&params(3306, ssl)).expect_err("key without cert must be rejected");
    assert_eq!(error, CLIENT_IDENTITY_INCOMPLETE_MESSAGE);
}

#[test]
fn connect_timeout_comes_from_the_profile() {
    let params = ConnectionParams {
        connect_timeout_secs: 7,
        ..plain_params()
    };
    assert_eq!(connect_timeout(&params), Duration::from_secs(7));
}

#[test]
fn timeout_error_names_the_timeout() {
    let error = connect_timed_out_error(ONE_SECOND);

    assert!(error.is_fatal());
    assert!(
        error.to_string().contains("timed out after 1 s"),
        "unexpected error text: {error}"
    );
    let timed_out = ConnectTimedOut {
        timeout: Duration::from_secs(3),
    };
    assert_eq!(
        timed_out.to_string(),
        "connecting to MySQL timed out after 3 s"
    );
}

#[cfg(coverage)]
mod coverage_stubs {
    use super::*;
    use crate::common::mock_session::mock_pool_with_params;
    use sqllumen_lib::mysql::connection_options::connect_within_timeout;

    #[tokio::test]
    async fn connecting_is_stubbed_out_as_a_timeout() {
        let opts = mysql_opts(&plain_params()).expect("plain options should build");

        let error = connect_within_timeout(opts, ONE_SECOND)
            .await
            .expect_err("coverage builds never connect");
        assert!(error.to_string().contains("timed out after 1 s"));

        let pool = mock_pool_with_params(&plain_params());
        let error = pool
            .checkout()
            .await
            .expect_err("coverage builds never check out");
        assert!(error.to_string().contains("timed out after 1 s"));
    }
}

#[cfg(not(coverage))]
mod sockets {
    use super::*;
    use crate::common::mock_session::mock_pool_with_params;
    use crate::common::silent_listener::{closed_port, SilentListener};
    use sqllumen_lib::mysql::connection_options::connect_within_timeout;
    use std::time::Instant;

    const TIMEOUT_UPPER_BOUND: Duration = Duration::from_millis(1_500);

    #[tokio::test]
    async fn a_silent_server_times_out_within_the_connect_timeout() {
        let listener = SilentListener::start().await;
        let opts = mysql_opts(&params(listener.port, SslSettings::default())).expect("opts");

        let started = Instant::now();
        let error = connect_within_timeout(opts, ONE_SECOND)
            .await
            .expect_err("a silent server must time out");

        let elapsed = started.elapsed();
        assert!(elapsed >= ONE_SECOND, "gave up too early: {elapsed:?}");
        assert!(elapsed < TIMEOUT_UPPER_BOUND, "took too long: {elapsed:?}");
        assert!(error.to_string().contains("timed out after 1 s"), "{error}");
    }

    #[tokio::test]
    async fn a_pool_checkout_from_a_silent_server_times_out() {
        let listener = SilentListener::start().await;
        let pool = mock_pool_with_params(&params(listener.port, SslSettings::default()));

        let started = Instant::now();
        let error = pool
            .checkout()
            .await
            .expect_err("a silent server must time out");

        assert!(started.elapsed() < TIMEOUT_UPPER_BOUND);
        assert!(error.to_string().contains("timed out after 1 s"), "{error}");
    }

    #[tokio::test]
    async fn a_closed_port_is_refused_immediately() {
        let opts = mysql_opts(&params(closed_port(), SslSettings::default())).expect("opts");

        let started = Instant::now();
        let error = connect_within_timeout(opts, ONE_SECOND)
            .await
            .expect_err("a closed port must refuse the connection");

        assert!(started.elapsed() < ONE_SECOND);
        assert!(!error.to_string().contains("timed out"), "{error}");
    }
}

#[cfg(not(coverage))]
mod tls_handshakes {
    use super::*;
    use crate::common::mock_mysql_server::{MockMySqlServer, MockScript};
    use crate::common::tls_fixtures::{server_tls_config, ClientCertificates, ServerCertificate};
    use sqllumen_lib::mysql::connection_options::connect_within_timeout;

    async fn tls_server(
        certificate: ServerCertificate,
        client_certificates: ClientCertificates,
    ) -> MockMySqlServer {
        let tls_config = server_tls_config(certificate, client_certificates);
        MockMySqlServer::start_with_tls(MockScript::default(), tls_config).await
    }

    async fn connect(port: u16, ssl: SslSettings) -> Result<(), mysql_async::Error> {
        let opts = mysql_opts(&params(port, ssl)).expect("TLS options should build");
        let conn = connect_within_timeout(opts, ONE_SECOND).await?;
        conn.disconnect().await
    }

    #[tokio::test]
    async fn ca_set_connects_although_the_certificate_name_does_not_match() {
        let server = tls_server(
            ServerCertificate::SignedByTestCa,
            ClientCertificates::NotRequested,
        )
        .await;

        connect(server.port, tls_settings(Some("ca.pem")))
            .await
            .expect("chain-only verification should accept a name mismatch");
    }

    #[tokio::test]
    async fn ca_set_rejects_a_certificate_from_an_unrelated_ca() {
        let server = tls_server(
            ServerCertificate::SignedByUnrelatedCa,
            ClientCertificates::NotRequested,
        )
        .await;

        let error = connect(server.port, tls_settings(Some("ca.pem")))
            .await
            .expect_err("a certificate from another CA must fail the handshake");
        assert!(error.is_fatal(), "{error}");
    }

    #[tokio::test]
    async fn no_ca_accepts_a_self_signed_version_1_certificate() {
        let server = tls_server(
            ServerCertificate::SelfSignedVersion1,
            ClientCertificates::NotRequested,
        )
        .await;

        connect(server.port, tls_settings(None))
            .await
            .expect("SSL without a CA should accept any certificate");
    }

    #[tokio::test]
    async fn a_server_requiring_client_certificates_accepts_the_test_ca_client() {
        let server = tls_server(
            ServerCertificate::SignedByTestCa,
            ClientCertificates::RequiredFromTestCa,
        )
        .await;

        let ssl = client_identity_settings(Some("client.pem"), Some("client-key.pem"));
        connect(server.port, ssl)
            .await
            .expect("the client certificate should satisfy the server");
    }

    #[tokio::test]
    async fn a_server_requiring_client_certificates_rejects_a_client_without_one() {
        let server = tls_server(
            ServerCertificate::SignedByTestCa,
            ClientCertificates::RequiredFromTestCa,
        )
        .await;

        let error = connect(server.port, tls_settings(Some("ca.pem")))
            .await
            .expect_err("a client without a certificate must be refused");
        assert!(error.is_fatal(), "{error}");
    }
}

#[cfg(not(coverage))]
mod editor_session_timeout {
    use super::*;
    use crate::common::mock_session::{
        mock_connection_params, mock_pool, register_mock_connection,
    };
    use crate::common::silent_listener::{closed_port, SilentListener};
    use sqllumen_lib::state::AppState;
    use std::time::Instant;

    const CONNECTION_ID: &str = "editor-timeout";
    const TIMEOUT_UPPER_BOUND: Duration = Duration::from_millis(1_500);

    fn state_for_port(port: u16) -> AppState {
        let state = crate::common::test_app_state();
        let connection_params = sqllumen_lib::mysql::registry::StoredConnectionParams {
            connect_timeout_secs: 1,
            ..mock_connection_params(CONNECTION_ID, port)
        };
        register_mock_connection(&state, mock_pool(port), connection_params);
        state
    }

    async fn open_editor_session(state: &AppState) -> String {
        sqllumen_lib::mysql::session::acquire(state, CONNECTION_ID)
            .await
            .err()
            .expect("the editor session must not connect")
    }

    #[tokio::test]
    async fn editor_session_gives_up_on_a_silent_server_within_the_timeout() {
        let listener = SilentListener::start().await;
        let state = state_for_port(listener.port);

        let started = Instant::now();
        let error = open_editor_session(&state).await;

        let elapsed = started.elapsed();
        assert!(elapsed >= ONE_SECOND, "gave up too early: {elapsed:?}");
        assert!(elapsed < TIMEOUT_UPPER_BOUND, "took too long: {elapsed:?}");
        assert!(
            error.starts_with("Failed to connect via mysql_async:"),
            "{error}"
        );
        assert!(error.contains("timed out after 1 s"), "{error}");
    }

    #[tokio::test]
    async fn editor_session_fails_immediately_on_a_closed_port() {
        let state = state_for_port(closed_port());

        let started = Instant::now();
        let error = open_editor_session(&state).await;

        assert!(started.elapsed() < ONE_SECOND);
        assert!(
            error.starts_with("Failed to connect via mysql_async:"),
            "{error}"
        );
        assert!(!error.contains("timed out"), "{error}");
    }
}
