use super::pool::{BackgroundPool, ConnectionParams, SslSettings};
use crate::db::connections::ConnectionRecord;
use std::collections::HashMap;
use std::fmt;
use std::sync::RwLock;
use tokio_util::sync::CancellationToken;

pub const DEFAULT_CONNECT_TIMEOUT_SECS: i64 = 10;
const MIN_CONNECT_TIMEOUT_SECS: i64 = 1;
const DEFAULT_KEEPALIVE_INTERVAL_SECS: i64 = 60;
const MIN_KEEPALIVE_INTERVAL_SECS: i64 = 0;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    Connected,
    Disconnected,
    Reconnecting,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenConnectionSession {
    pub session_id: String,
    pub profile_id: String,
    pub status: ConnectionStatus,
    pub server_version: String,
    pub session_database: Option<String>,
}

#[derive(Clone, PartialEq, Eq)]
pub struct SessionPassword(String);

impl SessionPassword {
    pub fn new(password: String) -> Self {
        Self(password)
    }
}

impl fmt::Debug for SessionPassword {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SessionPassword(<redacted>)")
    }
}

#[derive(Debug, Clone)]
pub struct StoredConnectionParams {
    pub profile_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub has_password: bool,
    pub keychain_ref: Option<String>,
    pub default_database: Option<String>,
    pub ssl: SslSettings,
    pub connect_timeout_secs: u64,
    pub keepalive_interval_secs: u64,
    pub session_password: Option<SessionPassword>,
}

impl StoredConnectionParams {
    pub fn from_connection_record(profile_id: &str, record: &ConnectionRecord) -> Self {
        Self {
            profile_id: profile_id.to_string(),
            host: record.host.clone(),
            port: record.port as u16,
            username: record.username.clone(),
            has_password: record.has_password,
            keychain_ref: record.keychain_ref.clone(),
            default_database: record.default_database.clone(),
            ssl: SslSettings {
                mode: record.ssl_mode,
                ca_path: record.ssl_ca_path.clone(),
                cert_path: record.ssl_cert_path.clone(),
                key_path: record.ssl_key_path.clone(),
            },
            connect_timeout_secs: record
                .connect_timeout_secs
                .unwrap_or(DEFAULT_CONNECT_TIMEOUT_SECS)
                .max(MIN_CONNECT_TIMEOUT_SECS) as u64,
            keepalive_interval_secs: record
                .keepalive_interval_secs
                .unwrap_or(DEFAULT_KEEPALIVE_INTERVAL_SECS)
                .max(MIN_KEEPALIVE_INTERVAL_SECS) as u64,
            session_password: None,
        }
    }

    pub fn resolve_password(&self) -> Result<String, String> {
        if let Some(SessionPassword(password)) = &self.session_password {
            return Ok(password.clone());
        }
        crate::credentials::resolve_password(&self.profile_id, self.has_password)
    }

    pub fn to_connection_params(&self, password: String) -> ConnectionParams {
        ConnectionParams {
            host: self.host.clone(),
            port: self.port,
            username: self.username.clone(),
            password,
            default_database: self.default_database.clone(),
            ssl: self.ssl.clone(),
            connect_timeout_secs: self.connect_timeout_secs,
        }
    }
}

pub struct RegistryEntry {
    pub pool: BackgroundPool,
    pub session_id: String,
    pub profile_id: String,
    pub status: ConnectionStatus,
    pub server_version: String,
    pub cancellation_token: CancellationToken,
    pub connection_params: StoredConnectionParams,
    pub read_only: bool,
}

impl RegistryEntry {
    fn is_reusable_for_profile(&self, profile_id: &str) -> bool {
        self.profile_id == profile_id
            && self.status == ConnectionStatus::Connected
            && !self.read_only
    }
}

pub struct ConnectionRegistry {
    entries: RwLock<HashMap<String, RegistryEntry>>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }

    pub fn insert(&self, id: String, entry: RegistryEntry) -> Option<RegistryEntry> {
        let mut map = self.entries.write().expect("registry lock poisoned");
        let old_entry = map.remove(&id);
        if let Some(ref old) = old_entry {
            old.cancellation_token.cancel();
        }
        map.insert(id, entry);
        old_entry
    }

    pub fn get_pool(&self, id: &str) -> Option<BackgroundPool> {
        let map = self.entries.read().expect("registry lock poisoned");
        map.get(id).map(|entry| entry.pool.clone())
    }

    pub fn get_status(&self, id: &str) -> Option<ConnectionStatus> {
        let map = self.entries.read().expect("registry lock poisoned");
        map.get(id).map(|entry| entry.status.clone())
    }

    pub fn update_status(&self, id: &str, status: ConnectionStatus) {
        let mut map = self.entries.write().expect("registry lock poisoned");
        if let Some(entry) = map.get_mut(id) {
            entry.status = status;
        }
    }

    pub fn replace_pool(&self, id: &str, new_pool: BackgroundPool) {
        let mut map = self.entries.write().expect("registry lock poisoned");
        if let Some(entry) = map.get_mut(id) {
            entry.pool = new_pool;
        }
    }

    pub fn get_connection_params(&self, id: &str) -> Option<StoredConnectionParams> {
        let map = self.entries.read().expect("registry lock poisoned");
        map.get(id).map(|entry| entry.connection_params.clone())
    }

    pub fn server_version(&self, id: &str) -> Option<String> {
        let map = self.entries.read().expect("registry lock poisoned");
        map.get(id).map(|entry| entry.server_version.clone())
    }

    pub fn set_default_database(&self, id: &str, default_database: Option<String>) {
        let mut map = self.entries.write().expect("registry lock poisoned");
        if let Some(entry) = map.get_mut(id) {
            entry.connection_params.default_database = default_database;
        }
    }

    pub fn remove(&self, id: &str) -> Option<RegistryEntry> {
        let mut map = self.entries.write().expect("registry lock poisoned");
        let entry = map.remove(id);
        if let Some(ref removed) = entry {
            removed.cancellation_token.cancel();
        }
        entry
    }

    pub fn contains(&self, id: &str) -> bool {
        let map = self.entries.read().expect("registry lock poisoned");
        map.contains_key(id)
    }

    pub fn is_read_only(&self, id: &str) -> bool {
        let map = self.entries.read().expect("registry lock poisoned");
        map.get(id).map(|entry| entry.read_only).unwrap_or(false)
    }

    pub fn get_profile_id(&self, session_id: &str) -> Option<String> {
        let map = self.entries.read().expect("registry lock poisoned");
        map.get(session_id).map(|entry| entry.profile_id.clone())
    }

    pub fn list_sessions(&self) -> Vec<OpenConnectionSession> {
        let map = self.entries.read().expect("registry lock poisoned");
        let mut sessions = map
            .values()
            .map(|entry| OpenConnectionSession {
                session_id: entry.session_id.clone(),
                profile_id: entry.profile_id.clone(),
                status: entry.status.clone(),
                server_version: entry.server_version.clone(),
                session_database: entry.connection_params.default_database.clone(),
            })
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        sessions
    }

    pub fn get_pool_by_profile(&self, profile_id: &str) -> Option<BackgroundPool> {
        let map = self.entries.read().expect("registry lock poisoned");
        map.values()
            .find(|entry| entry.is_reusable_for_profile(profile_id))
            .map(|entry| entry.pool.clone())
    }
}

impl Default for ConnectionRegistry {
    fn default() -> Self {
        Self::new()
    }
}
