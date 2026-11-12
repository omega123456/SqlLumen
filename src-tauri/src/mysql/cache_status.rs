use crate::mysql::result_cache::CacheGet;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CacheStatus {
    Available,
    Expired,
    Missing,
    Synced,
}

impl<V> CacheGet<V> {
    pub fn lookup_status(&self) -> CacheStatus {
        match self {
            Self::Found(_) | Self::ReWarmed(_) => CacheStatus::Available,
            Self::Expired => CacheStatus::Expired,
            Self::NeverStored => CacheStatus::Missing,
        }
    }
}

pub fn cache_status_json(status: CacheStatus) -> serde_json::Value {
    serde_json::json!({ "status": status })
}
