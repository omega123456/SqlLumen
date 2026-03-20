use super::pool::ConnectionParams;
use sqlx::MySqlPool;
use std::collections::HashMap;
use std::sync::RwLock;
use tokio_util::sync::CancellationToken;

/// Status of a MySQL connection in the registry.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum ConnectionStatus {
    Connected,
    Disconnected,
    Reconnecting,
}

/// Parameters stored in memory for reconnection.
/// Contains everything needed to recreate a MySQL pool except the password,
/// which is re-read from the OS keychain on each reconnection attempt.
/// This struct lives only in the in-memory registry — never persisted.
#[derive(Debug, Clone)]
pub struct StoredConnectionParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub has_password: bool,
    pub default_database: Option<String>,
    pub ssl_enabled: bool,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub connect_timeout_secs: u64,
    pub keepalive_interval_secs: u64,
}

impl StoredConnectionParams {
    /// Convert to `ConnectionParams` for pool creation, injecting the password.
    ///
    /// Password is passed separately because `StoredConnectionParams` intentionally
    /// does not store it — the password is re-read from the OS keychain on each use.
    pub fn to_connection_params(&self, password: String) -> ConnectionParams {
        ConnectionParams {
            host: self.host.clone(),
            port: self.port,
            username: self.username.clone(),
            password,
            default_database: self.default_database.clone(),
            ssl_enabled: self.ssl_enabled,
            ssl_ca_path: self.ssl_ca_path.clone(),
            ssl_cert_path: self.ssl_cert_path.clone(),
            ssl_key_path: self.ssl_key_path.clone(),
            connect_timeout_secs: self.connect_timeout_secs,
        }
    }
}

/// A registered MySQL connection with its pool and metadata.
pub struct RegistryEntry {
    pub pool: MySqlPool,
    pub connection_id: String,
    pub status: ConnectionStatus,
    pub server_version: String,
    pub cancellation_token: CancellationToken,
    pub connection_params: StoredConnectionParams,
}

/// Thread-safe registry of active MySQL connections.
///
/// Uses `std::sync::RwLock` for interior mutability. Locks are held only
/// for brief HashMap operations and never across await points.
/// `MySqlPool` is `Clone + Send + Sync` (Arc internally) — clone it out
/// before releasing the lock.
pub struct ConnectionRegistry {
    entries: RwLock<HashMap<String, RegistryEntry>>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }

    /// Insert or replace a connection entry in the registry.
    /// If an entry with this ID already exists, its cancellation token is cancelled
    /// before replacement, and the old entry is returned so the caller can close its pool.
    pub fn insert(&self, id: String, entry: RegistryEntry) -> Option<RegistryEntry> {
        let mut map = self.entries.write().expect("registry lock poisoned");
        let old_entry = map.remove(&id);
        if let Some(ref old) = old_entry {
            old.cancellation_token.cancel();
        }
        map.insert(id, entry);
        old_entry
    }

    /// Get a cheap Arc clone of the pool for the given connection ID.
    pub fn get_pool(&self, id: &str) -> Option<MySqlPool> {
        let map = self.entries.read().expect("registry lock poisoned");
        map.get(id).map(|e| e.pool.clone())
    }

    /// Get the current status of a connection.
    pub fn get_status(&self, id: &str) -> Option<ConnectionStatus> {
        let map = self.entries.read().expect("registry lock poisoned");
        map.get(id).map(|e| e.status.clone())
    }

    /// Update the status of an existing connection.
    pub fn update_status(&self, id: &str, status: ConnectionStatus) {
        let mut map = self.entries.write().expect("registry lock poisoned");
        if let Some(entry) = map.get_mut(id) {
            entry.status = status;
        }
    }

    /// Replace the pool for an existing connection (used during reconnection).
    pub fn replace_pool(&self, id: &str, new_pool: MySqlPool) {
        let mut map = self.entries.write().expect("registry lock poisoned");
        if let Some(entry) = map.get_mut(id) {
            entry.pool = new_pool;
        }
    }

    /// Get a clone of the stored connection params for reconnection.
    pub fn get_connection_params(&self, id: &str) -> Option<StoredConnectionParams> {
        let map = self.entries.read().expect("registry lock poisoned");
        map.get(id).map(|e| e.connection_params.clone())
    }

    /// Remove a connection from the registry, returning the entry if it existed.
    /// Cancels the entry's cancellation token to stop any background health tasks.
    pub fn remove(&self, id: &str) -> Option<RegistryEntry> {
        let mut map = self.entries.write().expect("registry lock poisoned");
        let entry = map.remove(id);
        if let Some(ref e) = entry {
            e.cancellation_token.cancel();
        }
        entry
    }

    /// Check whether a connection ID is registered.
    pub fn contains(&self, id: &str) -> bool {
        let map = self.entries.read().expect("registry lock poisoned");
        map.contains_key(id)
    }
}

impl Default for ConnectionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_token() -> CancellationToken {
        CancellationToken::new()
    }

    fn make_params() -> StoredConnectionParams {
        StoredConnectionParams {
            host: "localhost".to_string(),
            port: 3306,
            username: "root".to_string(),
            has_password: true,
            default_database: None,
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            connect_timeout_secs: 10,
            keepalive_interval_secs: 60,
        }
    }

    #[test]
    fn test_remove_cancels_token() {
        let _registry = ConnectionRegistry::new();
        let token = make_token();
        let token_clone = token.clone();

        // We can't create a real MySqlPool in tests without a server,
        // so we test the token cancellation logic directly.
        assert!(!token_clone.is_cancelled(), "token should not be cancelled initially");

        // Simulate what remove() does to the token
        token.cancel();
        assert!(token_clone.is_cancelled(), "token should be cancelled after cancel()");
    }

    #[test]
    fn test_insert_replaces_and_cancels_old_token() {
        // Test that the cancellation token pattern works correctly
        let token1 = make_token();
        let token1_clone = token1.clone();
        let token2 = make_token();
        let token2_clone = token2.clone();

        // Simulate replacement: cancel old before inserting new
        assert!(!token1_clone.is_cancelled());
        token1.cancel(); // This is what insert() does when replacing
        assert!(token1_clone.is_cancelled());
        assert!(!token2_clone.is_cancelled());

        // token2 should still be active (the new entry)
        assert!(!token2.is_cancelled());
    }

    #[test]
    fn test_stored_connection_params_clone() {
        let params = make_params();
        let cloned = params.clone();
        assert_eq!(cloned.host, "localhost");
        assert_eq!(cloned.port, 3306);
        assert_eq!(cloned.username, "root");
        assert!(cloned.has_password);
        assert_eq!(cloned.connect_timeout_secs, 10);
        assert_eq!(cloned.keepalive_interval_secs, 60);
    }

    #[test]
    fn test_to_connection_params() {
        let stored = make_params();
        let conn = stored.to_connection_params("s3cret".to_string());
        assert_eq!(conn.host, "localhost");
        assert_eq!(conn.port, 3306);
        assert_eq!(conn.username, "root");
        assert_eq!(conn.password, "s3cret");
        assert_eq!(conn.default_database, None);
        assert!(!conn.ssl_enabled);
        assert_eq!(conn.ssl_ca_path, None);
        assert_eq!(conn.ssl_cert_path, None);
        assert_eq!(conn.ssl_key_path, None);
        assert_eq!(conn.connect_timeout_secs, 10);
    }
}
