//! In-memory credential backend for integration tests (no OS secure-storage dependency).

use sqllumen_lib::credentials::{set_test_credential_backend, TestCredentialBackend};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, Once};

type CredentialMap = HashMap<String, String>;

static TEST_KEYCHAIN: LazyLock<Mutex<CredentialMap>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static TEST_CREDENTIAL_ERROR: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));

static INSTALL_BACKEND: Once = Once::new();
static KEYCHAIN_ISOLATION_LOCK: Mutex<()> = Mutex::new(());

fn storage_label() -> &'static str {
    sqllumen_lib::credentials::secure_storage_display_name()
}

fn credential_error(action: &str, error: &str) -> String {
    format!("Failed to {action} in {}: {error}", storage_label())
}

fn missing_entry_error(action: &str) -> String {
    format!(
        "Failed to {action} in {}: No matching entry found in secure storage",
        storage_label()
    )
}

fn clear_keychain_state() {
    TEST_KEYCHAIN
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clear();
    *TEST_CREDENTIAL_ERROR
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
}

/// Install the in-memory credential backend once per integration test process.
pub fn ensure_fake_backend_once() {
    INSTALL_BACKEND.call_once(|| {
        set_test_credential_backend(Some(TestCredentialBackend {
            store_password: fake_store_password,
            get_password: fake_get_password,
            delete_password: fake_delete_password,
        }));
    });
}

/// Serializes tests that need a clean fake keychain; does not remove the test backend on drop.
pub struct FakeKeychainIsolationGuard {
    _guard: std::sync::MutexGuard<'static, ()>,
}

/// Lock, clear map/errors, return guard. Always installs fake backend first.
pub fn isolate_fake_keychain() -> FakeKeychainIsolationGuard {
    ensure_fake_backend_once();
    let guard = KEYCHAIN_ISOLATION_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    clear_keychain_state();
    FakeKeychainIsolationGuard { _guard: guard }
}

fn fake_store_password(connection_id: &str, password: &str) -> Result<(), String> {
    if let Some(error) = take_fake_error() {
        return Err(credential_error("store password", &error));
    }

    TEST_KEYCHAIN
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(connection_id.to_string(), password.to_string());
    Ok(())
}

fn fake_get_password(connection_id: &str) -> Result<Option<String>, String> {
    if let Some(error) = take_fake_error() {
        return Err(credential_error("retrieve password", &error));
    }

    Ok(TEST_KEYCHAIN
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(connection_id)
        .cloned())
}

fn fake_delete_password(connection_id: &str) -> Result<(), String> {
    if let Some(error) = take_fake_error() {
        return Err(credential_error("delete password", &error));
    }

    TEST_KEYCHAIN
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(connection_id)
        .map(|_| ())
        .ok_or_else(|| missing_entry_error("delete password"))
}

pub fn queue_fake_credential_error(message: &str) {
    *TEST_CREDENTIAL_ERROR
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(message.to_string());
}

fn take_fake_error() -> Option<String> {
    TEST_CREDENTIAL_ERROR
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()
}
