use crate::mysql::schema_queries::{RoutineRef, SchemaObjectRef};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTabRequest {
    pub connection_id: String,
    pub tab_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseRequest {
    pub connection_id: String,
    pub database: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObjectRequest {
    pub connection_id: String,
    pub database: String,
    pub object_name: String,
    pub object_type: String,
}

impl SchemaObjectRequest {
    pub fn object_ref(&self) -> SchemaObjectRef<'_> {
        SchemaObjectRef {
            database: &self.database,
            object_name: &self.object_name,
            object_type: &self.object_type,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineRequest {
    pub connection_id: String,
    pub database: String,
    pub routine_name: String,
    pub routine_type: String,
}

impl RoutineRequest {
    pub fn routine_ref(&self) -> RoutineRef<'_> {
        RoutineRef {
            database: &self.database,
            routine_name: &self.routine_name,
            routine_type: &self.routine_type,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContentRequest {
    pub path: String,
    pub content: String,
}
