//! TLS server configurations for the fake MySQL server, built from `tests/fixtures/tls/`.

use opensrv_rustls::server::WebPkiClientVerifier;
use opensrv_rustls::{RootCertStore, ServerConfig};
use rustls_pki_types::pem::PemObject;
use rustls_pki_types::{CertificateDer, PrivateKeyDer};
use std::path::PathBuf;
use std::sync::Arc;

const FIXTURE_DIRECTORY: &str = "tests/fixtures/tls";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerCertificate {
    SignedByTestCa,
    SignedByUnrelatedCa,
    SelfSignedVersion1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientCertificates {
    NotRequested,
    RequiredFromTestCa,
}

pub fn fixture_path(file_name: &str) -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(FIXTURE_DIRECTORY)
        .join(file_name)
        .to_string_lossy()
        .into_owned()
}

fn certificate_chain(file_name: &str) -> Vec<CertificateDer<'static>> {
    CertificateDer::pem_file_iter(fixture_path(file_name))
        .expect("should open certificate fixture")
        .map(|certificate| certificate.expect("should parse certificate fixture"))
        .collect()
}

fn private_key(file_name: &str) -> PrivateKeyDer<'static> {
    PrivateKeyDer::from_pem_file(fixture_path(file_name)).expect("should parse key fixture")
}

struct ServerIdentityFiles {
    certificate: &'static str,
    key: &'static str,
}

fn server_identity(certificate: ServerCertificate) -> ServerIdentityFiles {
    match certificate {
        ServerCertificate::SignedByTestCa => ServerIdentityFiles {
            certificate: "server.pem",
            key: "server-key.pem",
        },
        ServerCertificate::SignedByUnrelatedCa => ServerIdentityFiles {
            certificate: "other-server.pem",
            key: "other-server-key.pem",
        },
        ServerCertificate::SelfSignedVersion1 => ServerIdentityFiles {
            certificate: "self-signed-v1.pem",
            key: "self-signed-v1-key.pem",
        },
    }
}

fn test_ca_client_verifier() -> Arc<dyn opensrv_rustls::server::danger::ClientCertVerifier> {
    let mut roots = RootCertStore::empty();
    for certificate in certificate_chain("ca.pem") {
        roots.add(certificate).expect("should trust the test CA");
    }
    WebPkiClientVerifier::builder(Arc::new(roots))
        .build()
        .expect("should build the client certificate verifier")
}

pub fn server_tls_config(
    certificate: ServerCertificate,
    client_certificates: ClientCertificates,
) -> Arc<ServerConfig> {
    let identity = server_identity(certificate);
    let builder = ServerConfig::builder();
    let builder = match client_certificates {
        ClientCertificates::NotRequested => builder.with_no_client_auth(),
        ClientCertificates::RequiredFromTestCa => {
            builder.with_client_cert_verifier(test_ca_client_verifier())
        }
    };
    let config = builder
        .with_single_cert(
            certificate_chain(identity.certificate),
            private_key(identity.key),
        )
        .expect("should build the server TLS configuration");
    Arc::new(config)
}
