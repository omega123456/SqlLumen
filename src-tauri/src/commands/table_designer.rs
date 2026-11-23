use crate::mysql::ddl_detector::{DdlDetectionResult, detect_ddl_tables};
use crate::mysql::metadata_cache::{
    TableEviction, evict_metadata_cache_for_connection, evict_metadata_cache_for_tables,
};
use crate::mysql::table_designer::{
    self, DesignerTableProperties, DesignerTableSchema, GenerateDdlRequest, GenerateDdlResponse,
};
use crate::state::AppState;
use serde::Deserialize;

use crate::commands::query_history_bridge::{HistoryStatement, run_with_history};
#[cfg(not(coverage))]
use crate::mysql::cell_values::DecodedRow;
#[cfg(not(coverage))]
use crate::mysql::logged_query::{
    LoggedStatement, execute_pooled, fetch_decoded_pooled, fetch_first_decoded_pooled,
};
#[cfg(not(coverage))]
use crate::mysql::pool::BackgroundPool;
#[cfg(not(coverage))]
use crate::mysql::table_designer::{
    DefaultValueModel, DesignerColumnDef, DesignerForeignKeyDef, DesignerIndexDef,
};
#[cfg(not(coverage))]
use tauri::State;

mod row_decoding;
pub use row_decoding::*;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadTableForDesignerRequest {
    pub connection_id: String,
    pub database: String,
    pub table_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyTableDdlRequest {
    pub connection_id: String,
    pub database: String,
    pub ddl: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedColumnType {
    pub base_type: String,
    pub length: String,
    pub type_modifier: String,
}

impl ParsedColumnType {
    fn without_length(base_type: String, type_modifier: String) -> Self {
        Self {
            base_type,
            length: String::new(),
            type_modifier,
        }
    }
}

fn check_not_read_only(state: &AppState, connection_id: &str) -> Result<(), String> {
    if state.registry.is_read_only(connection_id) {
        return Err("Operation not permitted: connection is read-only".to_string());
    }

    Ok(())
}

#[cfg(not(coverage))]
fn get_pool(state: &AppState, connection_id: &str) -> Result<BackgroundPool, String> {
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' is not open"))
}

#[cfg(not(coverage))]
pub async fn load_table_for_designer_impl(
    state: &AppState,
    request: &LoadTableForDesignerRequest,
) -> Result<DesignerTableSchema, String> {
    let pool = get_pool(state, &request.connection_id)?;
    let lookup = DesignerTableLookup {
        pool: &pool,
        database: &request.database,
        table_name: &request.table_name,
    };

    let column_rows = lookup
        .fetch_all(table_designer::load_columns_query())
        .await?;
    let metadata_row = lookup.fetch_metadata_row().await?;
    let index_rows = lookup
        .fetch_all(table_designer::load_indexes_query())
        .await?;
    let foreign_key_rows = lookup
        .fetch_all(table_designer::load_foreign_keys_query())
        .await?;

    let columns = column_rows
        .iter()
        .map(designer_column_from_row)
        .collect::<Result<Vec<_>, String>>()?;

    Ok(DesignerTableSchema {
        table_name: request.table_name.clone(),
        columns,
        indexes: designer_indexes_from_rows(&index_rows)?,
        foreign_keys: designer_foreign_keys_from_rows(&foreign_key_rows)?,
        properties: table_properties_from_row(&metadata_row)?,
    })
}

#[cfg(coverage)]
pub async fn load_table_for_designer_impl(
    state: &AppState,
    request: &LoadTableForDesignerRequest,
) -> Result<DesignerTableSchema, String> {
    let connection_id = request.connection_id.as_str();
    if state.registry.get_pool(connection_id).is_none() {
        return Err(format!("Connection '{connection_id}' is not open"));
    }

    Ok(DesignerTableSchema {
        table_name: request.table_name.clone(),
        columns: vec![],
        indexes: vec![],
        foreign_keys: vec![],
        properties: DesignerTableProperties {
            engine: String::new(),
            charset: String::new(),
            collation: String::new(),
            auto_increment: None,
            row_format: String::new(),
            comment: String::new(),
        },
    })
}

#[cfg(not(coverage))]
pub async fn generate_table_ddl_impl(
    request: GenerateDdlRequest,
) -> Result<GenerateDdlResponse, String> {
    crate::mysql::schema_queries::safe_identifier(&request.database)
        .map(|_| ())
        .map_err(|error| format!("Database name: {error}"))?;
    table_designer::validate_schema(&request.current_schema)?;

    match request.mode.as_str() {
        "create" => Ok(GenerateDdlResponse {
            ddl: table_designer::generate_create_table_ddl(
                &request.current_schema,
                &request.database,
            ),
            warnings: vec![],
        }),
        "alter" => {
            let original_schema = request
                .original_schema
                .as_ref()
                .ok_or_else(|| "Original schema is required for alter mode".to_string())?;
            table_designer::validate_schema(original_schema)?;
            Ok(table_designer::generate_alter_table_ddl(
                original_schema,
                &request.current_schema,
                &request.database,
            ))
        }
        _ => Err(format!(
            "Unsupported DDL generation mode: '{}'",
            request.mode
        )),
    }
}

#[cfg(coverage)]
pub async fn generate_table_ddl_impl(
    request: GenerateDdlRequest,
) -> Result<GenerateDdlResponse, String> {
    crate::mysql::schema_queries::safe_identifier(&request.database)
        .map(|_| ())
        .map_err(|error| format!("Database name: {error}"))?;
    table_designer::validate_schema(&request.current_schema)?;

    match request.mode.as_str() {
        "create" => Ok(GenerateDdlResponse {
            ddl: String::new(),
            warnings: vec![],
        }),
        "alter" => {
            if request.original_schema.is_none() {
                return Err("Original schema is required for alter mode".to_string());
            }

            if let Some(original_schema) = request.original_schema.as_ref() {
                table_designer::validate_schema(original_schema)?;
            }

            Ok(GenerateDdlResponse {
                ddl: String::new(),
                warnings: vec![],
            })
        }
        _ => Err(format!(
            "Unsupported DDL generation mode: '{}'",
            request.mode
        )),
    }
}

#[cfg(not(coverage))]
pub async fn apply_table_ddl_impl(
    state: &AppState,
    request: &ApplyTableDdlRequest,
) -> Result<(), String> {
    check_not_read_only(state, &request.connection_id)?;
    let pool = get_pool(state, &request.connection_id)?;
    let ddl = request.ddl.as_str();

    execute_pooled(&pool, LoggedStatement::text(ddl))
        .await
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn invalidate_metadata_cache_for_applied_table_ddl(
    state: &AppState,
    request: &ApplyTableDdlRequest,
) {
    match detect_ddl_tables(&request.ddl) {
        DdlDetectionResult::NoDdl => {}
        DdlDetectionResult::DdlDetected(affected_tables) => {
            let eviction = TableEviction {
                connection_id: &request.connection_id,
                affected_tables: &affected_tables,
                default_database: Some(&request.database),
            };
            evict_metadata_cache_for_tables(state, &eviction);
        }
        DdlDetectionResult::ParseFailed => {
            evict_metadata_cache_for_connection(state, &request.connection_id);
        }
    }
}

#[cfg(coverage)]
pub async fn apply_table_ddl_impl(
    state: &AppState,
    request: &ApplyTableDdlRequest,
) -> Result<(), String> {
    let connection_id = request.connection_id.as_str();
    check_not_read_only(state, connection_id)?;

    if state.registry.get_pool(connection_id).is_none() {
        return Err(format!("Connection '{connection_id}' is not open"));
    }

    if request.ddl.trim().is_empty() {
        return Err("DDL cannot be empty".to_string());
    }

    Ok(())
}

fn designer_load_history_sql(request: &LoadTableForDesignerRequest) -> String {
    let database = &request.database;
    let table_name = &request.table_name;
    format!(
        "/* table designer */ SELECT ... FROM INFORMATION_SCHEMA FOR TABLE `{database}`.`{table_name}`"
    )
}

pub async fn load_table_for_designer_with_history(
    state: &AppState,
    request: &LoadTableForDesignerRequest,
) -> Result<DesignerTableSchema, String> {
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: designer_load_history_sql(request),
    };
    run_with_history(
        state,
        statement,
        load_table_for_designer_impl(state, request),
    )
    .await
}

pub async fn apply_table_ddl_with_history(
    state: &AppState,
    request: &ApplyTableDdlRequest,
) -> Result<(), String> {
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: request.ddl.clone(),
    };
    run_with_history(state, statement, apply_table_ddl_impl(state, request)).await?;
    invalidate_metadata_cache_for_applied_table_ddl(state, request);
    Ok(())
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn load_table_for_designer(
    payload: LoadTableForDesignerRequest,
    state: State<'_, AppState>,
) -> Result<DesignerTableSchema, String> {
    load_table_for_designer_with_history(&state, &payload).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn generate_table_ddl(
    request: GenerateDdlRequest,
) -> Result<GenerateDdlResponse, String> {
    generate_table_ddl_impl(request).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn apply_table_ddl(
    payload: ApplyTableDdlRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    apply_table_ddl_with_history(&state, &payload).await
}
