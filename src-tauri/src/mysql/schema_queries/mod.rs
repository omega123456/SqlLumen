use serde::{Deserialize, Serialize};
use sqlx::mysql::MySqlRow;
use sqlx::Row;

mod batch;
#[cfg(not(coverage))]
mod catalog;
mod connection_keys;
mod routines;
#[cfg(not(coverage))]
mod table_details;

pub use batch::{
    query_all_foreign_keys_batch, query_all_indexes_batch, query_all_triggers_batch,
    query_all_views_batch,
};
#[cfg(not(coverage))]
pub use catalog::{
    check_rename_safe, query_database_details, query_list_charsets, query_list_collations,
    query_list_columns, query_list_databases, query_list_schema_objects, query_table_names,
    validate_charset, validate_collation,
};
pub use connection_keys::{query_all_foreign_keys, query_all_indexes};
#[cfg(not(coverage))]
pub(crate) use routines::query_routine_parameters_inner;
pub use routines::RoutineParameterRow;
#[cfg(not(coverage))]
pub use routines::{
    query_routine_exists, query_routine_parameters, query_routine_parameters_with_return_type,
};
#[cfg(not(coverage))]
pub use table_details::{
    query_ddl, query_foreign_keys, query_full_columns, query_indexes, query_schema_info,
    query_table_metadata,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDetails {
    pub name: String,
    pub default_character_set: String,
    pub default_collation: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharsetInfo {
    pub charset: String,
    pub description: String,
    pub default_collation: String,
    pub max_length: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollationInfo {
    pub name: String,
    pub charset: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObject {
    pub name: String,
    pub object_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub column_key: String,
    pub default_value: Option<String>,
    pub extra: String,
    pub ordinal_position: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub index_type: String,
    pub cardinality: Option<i64>,
    pub columns: Vec<String>,
    pub is_visible: bool,
    pub is_unique: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInfo {
    pub name: String,
    pub column_name: String,
    pub referenced_database: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub on_delete: String,
    pub on_update: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableMetadata {
    pub engine: String,
    pub collation: String,
    pub auto_increment: Option<i64>,
    pub create_time: Option<String>,
    pub table_rows: i64,
    pub data_length: i64,
    pub index_length: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfoResponse {
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub ddl: String,
    pub metadata: Option<TableMetadata>,
}

pub fn safe_identifier(name: &str) -> Result<String, String> {
    if name.is_empty() {
        return Err("Identifier cannot be empty".to_string());
    }
    let char_count = name.chars().count();
    if char_count > 64 {
        return Err(format!(
            "Identifier exceeds 64 characters (got {char_count})"
        ));
    }
    let escaped = name.replace('`', "``");
    Ok(format!("`{escaped}`"))
}

pub(crate) fn decode_mysql_text_cell(row: &MySqlRow, index: usize) -> Result<String, String> {
    match row.try_get::<String, _>(index) {
        Ok(value) => Ok(value),
        Err(_) => {
            let bytes: Vec<u8> = row.try_get(index).map_err(|error| {
                format!("Failed to decode column index {index} as UTF-8 text: {error}")
            })?;
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        }
    }
}

pub(crate) fn decode_mysql_text_cell_named(row: &MySqlRow, column: &str) -> Result<String, String> {
    match row.try_get::<String, _>(column) {
        Ok(value) => Ok(value),
        Err(_) => {
            let bytes: Vec<u8> = row.try_get(column).map_err(|error| {
                format!("Failed to decode column '{column}' as UTF-8 text: {error}")
            })?;
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        }
    }
}

#[cfg(not(coverage))]
fn decode_mysql_optional_text_cell(row: &MySqlRow, index: usize) -> Result<Option<String>, String> {
    match row.try_get::<Option<String>, _>(index) {
        Ok(value) => Ok(value),
        Err(_) => match row.try_get::<Option<Vec<u8>>, _>(index) {
            Ok(opt) => Ok(opt.map(|bytes: Vec<u8>| String::from_utf8_lossy(&bytes).into_owned())),
            Err(error) => Err(format!(
                "Failed to decode optional text column index {index}: {error}"
            )),
        },
    }
}

#[cfg(all(not(coverage), any(test, feature = "test-utils")))]
pub fn decode_mysql_text_cell_for_test(row: &MySqlRow, index: usize) -> Result<String, String> {
    decode_mysql_text_cell(row, index)
}

#[cfg(all(not(coverage), any(test, feature = "test-utils")))]
pub fn decode_mysql_text_cell_named_for_test(
    row: &MySqlRow,
    column: &str,
) -> Result<String, String> {
    decode_mysql_text_cell_named(row, column)
}

#[cfg(all(not(coverage), any(test, feature = "test-utils")))]
pub fn decode_mysql_optional_text_cell_for_test(
    row: &MySqlRow,
    index: usize,
) -> Result<Option<String>, String> {
    decode_mysql_optional_text_cell(row, index)
}

#[derive(Debug, Clone, Copy)]
pub struct SchemaObjectRef<'a> {
    pub database: &'a str,
    pub object_name: &'a str,
    pub object_type: &'a str,
}

#[derive(Debug, Clone, Copy)]
pub struct RoutineRef<'a> {
    pub database: &'a str,
    pub routine_name: &'a str,
    pub routine_type: &'a str,
}
