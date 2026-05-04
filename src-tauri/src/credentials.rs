//! OS-native credential storage for connection passwords.
//!
//! Uses the `keyring` crate to store passwords in the OS keychain:
//! - macOS: Keychain (`apple-native` feature — see `Cargo.toml`)
//! - Windows: Credential Manager (`windows-native`)
//! - Linux: keyutils + Secret Service (`linux-native-sync-persistent`, etc.)
//!
//! On macOS all saved connection passwords are consolidated into one shared
//! keychain item. Other platforms continue to store one item per connection id.

use tracing::warn;

const SERVICE_NAME: &str = "sqllumen";
#[cfg(target_os = "macos")]
const MACOS_SHARED_VAULT_ACCOUNT: &str = "connection-passwords-v1";

#[cfg(target_os = "macos")]
static MACOS_SHARED_VAULT_LOCK: std::sync::LazyLock<std::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(()));

#[cfg(target_os = "macos")]
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct SharedVault {
    version: u32,
    passwords: std::collections::HashMap<String, String>,
}

#[cfg(target_os = "macos")]
impl SharedVault {
    fn empty() -> Self {
        Self {
            version: 1,
            passwords: std::collections::HashMap::new(),
        }
    }
}

#[cfg(any(test, feature = "test-utils"))]
#[derive(Clone, Copy)]
pub struct TestCredentialBackend {
    pub store_password: fn(&str, &str) -> Result<(), String>,
    pub get_password: fn(&str) -> Result<Option<String>, String>,
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

#[cfg(target_os = "macos")]
fn shared_vault_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE_NAME, MACOS_SHARED_VAULT_ACCOUNT).map_err(|error| {
        warn!(error = %error, "failed to access macOS shared credential vault entry");
        format!("Failed to access keychain: {error}")
    })
}

#[cfg(target_os = "macos")]
fn read_shared_vault(entry: &keyring::Entry) -> Result<Option<SharedVault>, String> {
    match entry.get_password() {
        Ok(raw_vault) => {
            let vault = serde_json::from_str::<SharedVault>(&raw_vault).map_err(|error| {
                warn!(error = %error, "failed to deserialize shared password vault from keychain");
                format!("Failed to parse shared password vault from keychain: {error}")
            })?;

            if vault.version != 1 {
                warn!(
                    version = vault.version,
                    "unsupported shared password vault version in keychain"
                );
                return Err(format!(
                    "Failed to parse shared password vault from keychain: unsupported vault version {}",
                    vault.version
                ));
            }

            Ok(Some(vault))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => {
            warn!(error = %error, "failed to retrieve shared password vault from keychain");
            Err(format!(
                "Failed to retrieve shared password vault from keychain: {error}"
            ))
        }
    }
}

#[cfg(target_os = "macos")]
fn write_shared_vault(entry: &keyring::Entry, vault: &SharedVault) -> Result<(), String> {
    let payload = serde_json::to_string(vault)
        .map_err(|error| format!("Failed to serialize shared password vault: {error}"))?;

    entry.set_password(&payload).map_err(|error| {
        warn!(error = %error, "failed to store shared password vault in keychain");
        format!("Failed to store shared password vault in keychain: {error}")
    })
}

/// Store a password in the OS keychain for the given saved connection profile id.
pub fn store_password(profile_id: &str, password: &str) -> Result<(), String> {
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(backend) = *TEST_CREDENTIAL_BACKEND
        .lock()
        .expect("test credential backend lock poisoned")
    {
        return (backend.store_password)(profile_id, password);
    }

    #[cfg(target_os = "macos")]
    {
        let _guard = MACOS_SHARED_VAULT_LOCK
            .lock()
            .expect("shared vault lock poisoned");
        let entry = shared_vault_entry()?;
        let mut vault = read_shared_vault(&entry)?.unwrap_or_else(SharedVault::empty);
        vault
            .passwords
            .insert(profile_id.to_string(), password.to_string());
        return write_shared_vault(&entry, &vault);
    }

    #[cfg(not(target_os = "macos"))]
    let entry = keyring::Entry::new(SERVICE_NAME, profile_id).map_err(|error| {
        warn!(profile_id, error = %error, "failed to access keychain entry for password store");
        format!("Failed to access keychain: {error}")
    })?;

    #[cfg(not(target_os = "macos"))]
    entry.set_password(password).map_err(|error| {
        warn!(profile_id, error = %error, "failed to store password in keychain");
        format!("Failed to store password in keychain: {error}")
    })
}

/// Retrieve a password from the OS keychain for the given saved connection profile id.
pub fn get_password(profile_id: &str) -> Result<Option<String>, String> {
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(backend) = *TEST_CREDENTIAL_BACKEND
        .lock()
        .expect("test credential backend lock poisoned")
    {
        return (backend.get_password)(profile_id);
    }

    #[cfg(target_os = "macos")]
    {
        let _guard = MACOS_SHARED_VAULT_LOCK
            .lock()
            .expect("shared vault lock poisoned");
        let entry = shared_vault_entry()?;
        let vault = read_shared_vault(&entry)?;
        return Ok(vault.and_then(|shared_vault| shared_vault.passwords.get(profile_id).cloned()));
    }

    #[cfg(not(target_os = "macos"))]
    let entry = keyring::Entry::new(SERVICE_NAME, profile_id).map_err(|error| {
        warn!(profile_id, error = %error, "failed to access keychain entry for password retrieval");
        format!("Failed to access keychain: {error}")
    })?;

    #[cfg(not(target_os = "macos"))]
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => {
            warn!(profile_id, error = %error, "failed to retrieve password from keychain");
            Err(format!(
                "Failed to retrieve password from keychain: {error}"
            ))
        }
    }
}

/// Resolve the password for a saved connection profile.
///
/// Returns an empty string when the profile does not use a saved password.
/// When `has_password` is true, the password must exist in secure storage.
pub fn resolve_password(profile_id: &str, has_password: bool) -> Result<String, String> {
    if !has_password {
        return Ok(String::new());
    }

    get_password(profile_id)?.ok_or_else(|| {
        "Failed to retrieve password from keychain: No matching entry found in secure storage"
            .to_string()
    })
}

/// Delete a password from the OS keychain for the given saved connection profile id.
pub fn delete_password(profile_id: &str) -> Result<(), String> {
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(backend) = *TEST_CREDENTIAL_BACKEND
        .lock()
        .expect("test credential backend lock poisoned")
    {
        return (backend.delete_password)(profile_id);
    }

    #[cfg(target_os = "macos")]
    {
        let _guard = MACOS_SHARED_VAULT_LOCK
            .lock()
            .expect("shared vault lock poisoned");
        let entry = shared_vault_entry()?;
        let mut vault = match read_shared_vault(&entry)? {
            Some(shared_vault) => shared_vault,
            None => {
                return Ok(());
            }
        };

        if vault.passwords.remove(profile_id).is_none() {
            warn!(
                profile_id,
                "shared password vault did not contain requested profile during delete"
            );
            return Err(
                "Failed to delete password from keychain: No matching entry found in secure storage"
                    .to_string(),
            );
        }

        if vault.passwords.is_empty() {
            return match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => {
                    warn!(error = %error, "failed to delete shared password vault from keychain");
                    Err(format!(
                        "Failed to delete shared password vault from keychain: {error}"
                    ))
                }
            };
        }

        return write_shared_vault(&entry, &vault);
    }

    #[cfg(not(target_os = "macos"))]
    let entry = keyring::Entry::new(SERVICE_NAME, profile_id).map_err(|error| {
        warn!(profile_id, error = %error, "failed to access keychain entry for password deletion");
        format!("Failed to access keychain: {error}")
    })?;

    #[cfg(not(target_os = "macos"))]
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(error) => {
            warn!(profile_id, error = %error, "failed to delete password from keychain");
            Err(format!("Failed to delete password from keychain: {error}"))
        }
    }
}
