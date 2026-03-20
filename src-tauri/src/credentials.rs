//! OS-native credential storage for connection passwords.
//!
//! Uses the `keyring` crate to store passwords in the OS keychain:
//! - macOS: Keychain
//! - Windows: Credential Manager
//!
//! Service name is `"mysql-client"`, user key is the connection UUID.

const SERVICE_NAME: &str = "mysql-client";

/// Store a password in the OS keychain for the given connection ID.
pub fn store_password(connection_id: &str, password: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, connection_id)
        .map_err(|e| format!("Failed to access keychain: {e}"))?;
    entry
        .set_password(password)
        .map_err(|e| format!("Failed to store password in keychain: {e}"))
}

/// Retrieve a password from the OS keychain for the given connection ID.
pub fn retrieve_password(connection_id: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(SERVICE_NAME, connection_id)
        .map_err(|e| format!("Failed to access keychain: {e}"))?;
    entry
        .get_password()
        .map_err(|e| format!("Failed to retrieve password from keychain: {e}"))
}

/// Delete a password from the OS keychain for the given connection ID.
pub fn delete_password(connection_id: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, connection_id)
        .map_err(|e| format!("Failed to access keychain: {e}"))?;
    entry
        .delete_credential()
        .map_err(|e| format!("Failed to delete password from keychain: {e}"))
}
