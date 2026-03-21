//! OS-native credential storage for connection passwords.
//!
//! Uses the `keyring` crate to store passwords in the OS keychain:
//! - macOS: Keychain (`apple-native` feature — see `Cargo.toml`)
//! - Windows: Credential Manager (`windows-native`)
//! - Linux: keyutils + Secret Service (`linux-native-sync-persistent`, etc.)
//!
//! Service name is `"mysql-client"`, user key is the connection UUID.

const SERVICE_NAME: &str = "mysql-client";

#[cfg(any(test, feature = "test-utils"))]
#[derive(Clone, Copy)]
pub struct TestCredentialBackend {
    pub store_password: fn(&str, &str) -> Result<(), String>,
    pub retrieve_password: fn(&str) -> Result<String, String>,
    pub delete_password: fn(&str) -> Result<(), String>,
}

#[cfg(any(test, feature = "test-utils"))]
static TEST_CREDENTIAL_BACKEND: std::sync::Mutex<Option<TestCredentialBackend>> =
    std::sync::Mutex::new(None);

#[cfg(any(test, feature = "test-utils"))]
pub fn set_test_credential_backend(backend: Option<TestCredentialBackend>) {
    let mut guard = TEST_CREDENTIAL_BACKEND
        .lock()
        .expect("test credential backend lock poisoned");
    *guard = backend;
}

/// Store a password in the OS keychain for the given connection ID.
pub fn store_password(connection_id: &str, password: &str) -> Result<(), String> {
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(backend) = *TEST_CREDENTIAL_BACKEND
        .lock()
        .expect("test credential backend lock poisoned")
    {
        return (backend.store_password)(connection_id, password);
    }

    let entry = keyring::Entry::new(SERVICE_NAME, connection_id)
        .map_err(|e| format!("Failed to access keychain: {e}"))?;
    entry
        .set_password(password)
        .map_err(|e| format!("Failed to store password in keychain: {e}"))
}

/// Resolve the concrete keychain lookup key for a connection.
pub fn effective_keychain_ref<'a>(
    connection_id: &'a str,
    keychain_ref: Option<&'a str>,
) -> &'a str {
    keychain_ref
        .filter(|reference| !reference.is_empty())
        .unwrap_or(connection_id)
}

/// Retrieve a password using the stored keychain reference when present.
pub fn retrieve_password_for_connection(
    connection_id: &str,
    keychain_ref: Option<&str>,
) -> Result<String, String> {
    retrieve_password(effective_keychain_ref(connection_id, keychain_ref))
}

/// Retrieve a password from the OS keychain for the given connection ID.
pub fn retrieve_password(connection_id: &str) -> Result<String, String> {
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(backend) = *TEST_CREDENTIAL_BACKEND
        .lock()
        .expect("test credential backend lock poisoned")
    {
        return (backend.retrieve_password)(connection_id);
    }

    let entry = keyring::Entry::new(SERVICE_NAME, connection_id)
        .map_err(|e| format!("Failed to access keychain: {e}"))?;
    entry
        .get_password()
        .map_err(|e| format!("Failed to retrieve password from keychain: {e}"))
}

/// Delete a password from the OS keychain for the given connection ID.
pub fn delete_password(connection_id: &str) -> Result<(), String> {
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(backend) = *TEST_CREDENTIAL_BACKEND
        .lock()
        .expect("test credential backend lock poisoned")
    {
        return (backend.delete_password)(connection_id);
    }

    let entry = keyring::Entry::new(SERVICE_NAME, connection_id)
        .map_err(|e| format!("Failed to access keychain: {e}"))?;
    entry
        .delete_credential()
        .map_err(|e| format!("Failed to delete password from keychain: {e}"))
}
