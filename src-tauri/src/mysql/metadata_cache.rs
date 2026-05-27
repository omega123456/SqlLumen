use super::table_data::{PrimaryKeyInfo, TableDataColumnMeta};
use crate::mysql::ddl_detector::AffectedTable;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;
use tauri::Emitter;

type MetadataCacheKey = (String, String, String);
type MetadataCacheValue = (Option<PrimaryKeyInfo>, Vec<TableDataColumnMeta>);

pub const SCHEMA_METADATA_INVALIDATED_EVENT: &str = "schema-metadata-invalidated";

/// In-memory cache for table primary-key and column metadata.
pub struct MetadataCache {
    entries: RwLock<HashMap<MetadataCacheKey, MetadataCacheValue>>,
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

    pub fn get(
        &self,
        connection_id: &str,
        database: &str,
        table: &str,
    ) -> Option<MetadataCacheValue> {
        let entries = self.entries.read().expect("metadata cache lock poisoned");
        let value = entries
            .get(&(
                connection_id.to_string(),
                database.to_string(),
                table.to_string(),
            ))
            .cloned();

        if value.is_some() {
            tracing::debug!(connection_id, database, table, "metadata cache hit");
        } else {
            tracing::debug!(connection_id, database, table, "metadata cache miss");
        }

        value
    }

    pub fn insert(
        &self,
        connection_id: &str,
        database: &str,
        table: &str,
        primary_key: Option<PrimaryKeyInfo>,
        columns: Vec<TableDataColumnMeta>,
    ) {
        let columns_len = columns.len();
        let mut entries = self.entries.write().expect("metadata cache lock poisoned");
        entries.insert(
            (
                connection_id.to_string(),
                database.to_string(),
                table.to_string(),
            ),
            (primary_key, columns),
        );

        tracing::debug!(
            connection_id,
            database,
            table,
            columns_len,
            "metadata cache insert"
        );
    }

    pub fn evict_table(&self, connection_id: &str, database: &str, table: &str) -> bool {
        let mut entries = self.entries.write().expect("metadata cache lock poisoned");
        let removed = entries
            .remove(&(
                connection_id.to_string(),
                database.to_string(),
                table.to_string(),
            ))
            .is_some();

        tracing::debug!(
            connection_id,
            database,
            table,
            removed,
            "metadata cache evict table"
        );

        removed
    }

    pub fn evict_connection(&self, connection_id: &str) -> usize {
        let mut entries = self.entries.write().expect("metadata cache lock poisoned");
        let before = entries.len();
        entries.retain(|(cached_connection_id, _, _), _| cached_connection_id != connection_id);
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
        for (cached_connection_id, cached_database, cached_table) in entries.keys() {
            if cached_connection_id == connection_id && cached_database == database {
                removed_tables.push(cached_table.clone());
            }
        }
    }

    for table in &removed_tables {
        state
            .metadata_cache
            .evict_table(connection_id, database, table.as_str());
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
    connection_id: &str,
    affected_tables: &[AffectedTable],
    default_database: Option<&str>,
) -> MetadataCacheInvalidatedPayload {
    let mut emitted_tables = Vec::new();

    for (database, table) in affected_tables {
        let Some(database_name) = database.as_deref().or(default_database) else {
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

        state
            .metadata_cache
            .evict_table(connection_id, database_name, table.as_str());
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
