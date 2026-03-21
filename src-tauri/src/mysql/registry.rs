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
    pub read_only: bool,
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

    /// Check whether a registered connection is read-only.
    /// Returns `false` if the connection ID is not in the registry.
    pub fn is_read_only(&self, id: &str) -> bool {
        let map = self.entries.read().expect("registry lock poisoned");
        map.get(id).map(|e| e.read_only).unwrap_or(false)
    }
}

impl Default for ConnectionRegistry {
    fn default() -> Self {
        Self::new()
    }
}
