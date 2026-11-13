use crate::mysql::schema_queries::safe_identifier;
use crate::mysql::sql_chars::is_blank_identifier;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

mod column_clauses;
mod ddl_generation;
mod load_queries;
mod schema_diff;
mod validation;
pub use column_clauses::*;
pub use ddl_generation::*;
pub use load_queries::*;
use schema_diff::*;
pub use validation::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "tag", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DefaultValueModel {
    NoDefault,
    NullDefault,
    Literal { value: String },
    Expression { value: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesignerColumnDef {
    pub name: String,
    pub r#type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub type_modifier: String,
    pub length: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub is_auto_increment: bool,
    pub default_value: DefaultValueModel,
    pub comment: String,
    pub original_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesignerIndexDef {
    pub name: String,
    pub index_type: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesignerForeignKeyDef {
    pub name: String,
    pub source_column: String,
    pub referenced_database: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub on_delete: String,
    pub on_update: String,
    pub is_composite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesignerTableProperties {
    pub engine: String,
    pub charset: String,
    pub collation: String,
    pub auto_increment: Option<u64>,
    pub row_format: String,
    pub comment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesignerTableSchema {
    pub table_name: String,
    pub columns: Vec<DesignerColumnDef>,
    pub indexes: Vec<DesignerIndexDef>,
    pub foreign_keys: Vec<DesignerForeignKeyDef>,
    pub properties: DesignerTableProperties,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GenerateDdlRequest {
    pub original_schema: Option<DesignerTableSchema>,
    pub current_schema: DesignerTableSchema,
    pub database: String,
    pub mode: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GenerateDdlResponse {
    pub ddl: String,
    pub warnings: Vec<String>,
}
