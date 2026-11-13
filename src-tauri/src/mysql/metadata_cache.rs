use super::table_data::{PrimaryKeyInfo, TableDataColumnMeta};
use crate::mysql::ddl_detector::AffectedTable;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;
use tauri::Emitter;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MetadataTableKey {
    pub connection_id: String,
    pub database: String,
    pub table: String,
}

impl MetadataTableKey {
    pub fn new(connection_id: &str, database: &str, table: &str) -> Self {
        Self {
            connection_id: connection_id.to_string(),
            database: database.to_string(),
            table: table.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TableKeyMetadata {
    pub primary_key: Option<PrimaryKeyInfo>,
    pub columns: Vec<TableDataColumnMeta>,
}

pub struct TableEviction<'a> {
    pub connection_id: &'a str,
    pub affected_tables: &'a [AffectedTable],
    pub default_database: Option<&'a str>,
}

pub const SCHEMA_METADATA_INVALIDATED_EVENT: &str = "schema-metadata-invalidated";

pub struct MetadataCache {
    entries: RwLock<HashMap<MetadataTableKey, TableKeyMetadata>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataCacheInvalidatedPayload {
    pub connection_id: String,
    pub scope: String,
    pub tables: Vec<String>,
}

impl MetadataCache {
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }

    pub fn get(&self, key: &MetadataTableKey) -> Option<TableKeyMetadata> {
        let entries = self.entries.read().expect("metadata cache lock poisoned");
        let value = entries.get(key).cloned();

        let lookup_outcome = cache_lookup_outcome(value.is_some());
        tracing::debug!(
            connection_id = %key.connection_id,
            database = %key.database,
            table = %key.table,
            "metadata cache {lookup_outcome}"
        );

        value
    }

    pub fn insert(&self, key: MetadataTableKey, metadata: TableKeyMetadata) {
        let columns_len = metadata.columns.len();
        tracing::debug!(
            connection_id = %key.connection_id,
            database = %key.database,
            table = %key.table,
            columns_len,
            "metadata cache insert"
        );
        let mut entries = self.entries.write().expect("metadata cache lock poisoned");
        entries.insert(key, metadata);
    }

    pub fn evict_table(&self, key: &MetadataTableKey) -> bool {
        let mut entries = self.entries.write().expect("metadata cache lock poisoned");
        let removed = entries.remove(key).is_some();

        tracing::debug!(
            connection_id = %key.connection_id,
            database = %key.database,
            table = %key.table,
            removed,
            "metadata cache evict table"
        );

        removed
    }

    pub fn evict_connection(&self, connection_id: &str) -> usize {
        let mut entries = self.entries.write().expect("metadata cache lock poisoned");
        let before = entries.len();
        entries.retain(|key, _| key.connection_id != connection_id);
        let removed = before.saturating_sub(entries.len());

        tracing::debug!(connection_id, removed, "metadata cache evict connection");

        removed
    }

    pub fn evict_all(&self) -> usize {
        let mut entries = self.entries.write().expect("metadata cache lock poisoned");
        let removed = entries.len();
        entries.clear();

        tracing::debug!(removed, "metadata cache evict all");

        removed
    }
}

impl Default for MetadataCache {
    fn default() -> Self {
        Self::new()
    }
}

fn emit_metadata_cache_invalidated(state: &AppState, payload: &MetadataCacheInvalidatedPayload) {
    if let Some(app_handle) = state.app_handle.as_ref() {
        let _ = app_handle.emit(SCHEMA_METADATA_INVALIDATED_EVENT, payload);
    }
}

pub fn evict_metadata_cache_for_connection(
    state: &AppState,
    connection_id: &str,
) -> MetadataCacheInvalidatedPayload {
    state.metadata_cache.evict_connection(connection_id);

    let payload = MetadataCacheInvalidatedPayload {
        connection_id: connection_id.to_string(),
        scope: "connection".to_string(),
        tables: Vec::new(),
    };
    emit_metadata_cache_invalidated(state, &payload);
    payload
}

pub fn evict_metadata_cache_for_database(
    state: &AppState,
    connection_id: &str,
    database: &str,
) -> MetadataCacheInvalidatedPayload {
    let mut removed_tables = Vec::new();
    {
        let entries = state
            .metadata_cache
            .entries
            .read()
            .expect("metadata cache lock poisoned");
        for key in entries.keys() {
            let is_in_database = key.connection_id == connection_id && key.database == database;
            if is_in_database {
                removed_tables.push(key.table.clone());
            }
        }
    }

    for table in &removed_tables {
        state
            .metadata_cache
            .evict_table(&MetadataTableKey::new(connection_id, database, table));
    }

    let payload = MetadataCacheInvalidatedPayload {
        connection_id: connection_id.to_string(),
        scope: "tables".to_string(),
        tables: removed_tables
            .into_iter()
            .map(|table| format!("{database}.{table}"))
            .collect(),
    };
    emit_metadata_cache_invalidated(state, &payload);
    payload
}

pub fn evict_metadata_cache_for_tables(
    state: &AppState,
    eviction: &TableEviction<'_>,
) -> MetadataCacheInvalidatedPayload {
    let connection_id = eviction.connection_id;
    let mut emitted_tables = Vec::new();

    for (database, table) in eviction.affected_tables {
        let Some(database_name) = database.as_deref().or(eviction.default_database) else {
            tracing::debug!(
                connection_id,
                table,
                "metadata cache DDL eviction fell back to connection scope: missing database"
            );
            return evict_metadata_cache_for_connection(state, connection_id);
        };

        let qualified_table = format!("{database_name}.{table}");
        if emitted_tables
            .iter()
            .any(|existing| existing == &qualified_table)
        {
            continue;
        }

        state.metadata_cache.evict_table(&MetadataTableKey::new(
            connection_id,
            database_name,
            table,
        ));
        emitted_tables.push(qualified_table);
    }

    let payload = MetadataCacheInvalidatedPayload {
        connection_id: connection_id.to_string(),
        scope: "tables".to_string(),
        tables: emitted_tables,
    };
    emit_metadata_cache_invalidated(state, &payload);
    payload
}

fn cache_lookup_outcome(is_hit: bool) -> &'static str {
    if is_hit {
        return "hit";
    }
    "miss"
}
