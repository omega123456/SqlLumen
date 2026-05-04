//! OS-native credential storage for connection passwords.
//!
//! Uses the `keyring` crate to store passwords in OS-native secure storage:
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

pub fn secure_storage_display_name() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        return "macOS Keychain";
    }

    #[cfg(target_os = "windows")]
    {
        return "Windows Credential Manager";
    }

    #[cfg(target_os = "linux")]
    {
        return "Linux Secret Service / keyring";
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        return "secure storage";
    }
}

fn linux_unavailable_guidance() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        return " Linux Secret Service / keyring is unavailable or locked. Unlock your keyring or install a Secret Service provider such as GNOME Keyring, then try again.";
    }

    #[cfg(not(target_os = "linux"))]
    {
        return "";
    }
}

fn secure_storage_error(action: &str, error: impl std::fmt::Display) -> String {
    format!(
        "Failed to {action} in {}: {error}{}",
        secure_storage_display_name(),
        linux_unavailable_guidance()
    )
}

fn secure_storage_missing_entry_error(action: &str) -> String {
    format!(
        "Failed to {action} in {}: No matching entry found in secure storage",
        secure_storage_display_name()
    )
}

#[cfg(target_os = "macos")]
fn shared_vault_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE_NAME, MACOS_SHARED_VAULT_ACCOUNT).map_err(|error| {
        warn!(error = %error, "failed to access macOS shared credential vault entry");
        secure_storage_error("access secure storage", error)
    })
}

#[cfg(target_os = "macos")]
fn read_shared_vault(entry: &keyring::Entry) -> Result<Option<SharedVault>, String> {
    match entry.get_password() {
        Ok(raw_vault) => {
            let vault = serde_json::from_str::<SharedVault>(&raw_vault).map_err(|error| {
                warn!(error = %error, "failed to deserialize shared password vault from secure storage");
                format!(
                    "Failed to parse shared password vault from {}: {error}",
                    secure_storage_display_name()
                )
            })?;

            if vault.version != 1 {
                warn!(
                    version = vault.version,
                    "unsupported shared password vault version in secure storage"
                );
                return Err(format!(
                    "Failed to parse shared password vault from {}: unsupported vault version {}",
                    secure_storage_display_name(),
                    vault.version
                ));
            }

            Ok(Some(vault))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => {
            warn!(error = %error, "failed to retrieve shared password vault from secure storage");
            Err(secure_storage_error(
                "retrieve shared password vault",
                error,
            ))
        }
    }
}

#[cfg(target_os = "macos")]
fn write_shared_vault(entry: &keyring::Entry, vault: &SharedVault) -> Result<(), String> {
    let payload = serde_json::to_string(vault)
        .map_err(|error| format!("Failed to serialize shared password vault: {error}"))?;

    entry.set_password(&payload).map_err(|error| {
        warn!(error = %error, "failed to store shared password vault in secure storage");
        secure_storage_error("store shared password vault", error)
    })
}

/// Store a password in OS-native secure storage for the given saved connection profile id.
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
        warn!(profile_id, error = %error, "failed to access secure-storage entry for password store");
        secure_storage_error("access secure storage", error)
    })?;

    #[cfg(not(target_os = "macos"))]
    entry.set_password(password).map_err(|error| {
        warn!(profile_id, error = %error, "failed to store password in secure storage");
        secure_storage_error("store password", error)
    })
}

/// Retrieve a password from OS-native secure storage for the given saved connection profile id.
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
        warn!(profile_id, error = %error, "failed to access secure-storage entry for password retrieval");
        secure_storage_error("access secure storage", error)
    })?;

    #[cfg(not(target_os = "macos"))]
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => {
            warn!(profile_id, error = %error, "failed to retrieve password from secure storage");
            Err(secure_storage_error("retrieve password", error))
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

    get_password(profile_id)?.ok_or_else(|| secure_storage_missing_entry_error("retrieve password"))
}

/// Delete a password from OS-native secure storage for the given saved connection profile id.
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
            return Err(secure_storage_missing_entry_error("delete password"));
        }

        if vault.passwords.is_empty() {
            return match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => {
                    warn!(error = %error, "failed to delete shared password vault from secure storage");
                    Err(secure_storage_error("delete shared password vault", error))
                }
            };
        }

        return write_shared_vault(&entry, &vault);
    }

    #[cfg(not(target_os = "macos"))]
    let entry = keyring::Entry::new(SERVICE_NAME, profile_id).map_err(|error| {
        warn!(profile_id, error = %error, "failed to access secure-storage entry for password deletion");
        secure_storage_error("access secure storage", error)
    })?;

    #[cfg(not(target_os = "macos"))]
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(error) => {
            warn!(profile_id, error = %error, "failed to delete password from secure storage");
            Err(secure_storage_error("delete password", error))
        }
    }
}
