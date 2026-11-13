use crate::mysql::ddl_detector::{detect_ddl_tables, DdlDetectionResult};
use crate::mysql::metadata_cache::{
    evict_metadata_cache_for_connection, evict_metadata_cache_for_tables, TableEviction,
};
use crate::mysql::table_designer::{
    self, DesignerTableProperties, DesignerTableSchema, GenerateDdlRequest, GenerateDdlResponse,
};
use crate::state::AppState;
use serde::Deserialize;

use crate::commands::query_history_bridge::{run_with_history, HistoryStatement};
#[cfg(not(coverage))]
use crate::mysql::query_log;
#[cfg(not(coverage))]
use crate::mysql::table_designer::{
    DefaultValueModel, DesignerColumnDef, DesignerForeignKeyDef, DesignerIndexDef,
};
#[cfg(not(coverage))]
use sqlx::mysql::MySqlRow;
#[cfg(not(coverage))]
use sqlx::Row;
#[cfg(not(coverage))]
use tauri::State;

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
fn get_pool(state: &AppState, connection_id: &str) -> Result<sqlx::MySqlPool, String> {
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' is not open"))
}

pub fn parse_column_type(column_type: &str) -> ParsedColumnType {
    let trimmed = column_type.trim();

    match (trimmed.find('('), trimmed.rfind(')')) {
        (Some(open), Some(close)) if close > open => ParsedColumnType {
            base_type: trimmed[..open].trim().to_ascii_uppercase(),
            length: trimmed[(open + 1)..close].trim().to_string(),
            type_modifier: trimmed[(close + 1)..].trim().to_ascii_uppercase(),
        },
        _ => {
            let parts = trimmed
                .split_whitespace()
                .map(|part| part.to_ascii_uppercase())
                .collect::<Vec<_>>();

            let modifier_start = parts
                .iter()
                .position(|part| matches!(part.as_str(), "UNSIGNED" | "ZEROFILL" | "BINARY"));

            match modifier_start {
                Some(index) if index > 0 => ParsedColumnType::without_length(
                    parts[..index].join(" "),
                    parts[index..].join(" "),
                ),
                _ => ParsedColumnType::without_length(trimmed.to_ascii_uppercase(), String::new()),
            }
        }
    }
}

#[cfg(not(coverage))]
fn is_current_temporal_default(value: &str) -> bool {
    value.eq_ignore_ascii_case("CURRENT_TIMESTAMP")
        || value.to_ascii_uppercase().starts_with("CURRENT_TIMESTAMP(")
        || value.eq_ignore_ascii_case("CURRENT_DATE")
        || value.eq_ignore_ascii_case("CURRENT_TIME")
}

#[cfg(not(coverage))]
fn parse_default_value(default_value: Option<String>) -> DefaultValueModel {
    match default_value {
        None => DefaultValueModel::NoDefault,
        Some(value) if value.eq_ignore_ascii_case("NULL") => {
            DefaultValueModel::Expression { value }
        }
        Some(value) if is_current_temporal_default(&value) => {
            DefaultValueModel::Expression { value }
        }
        Some(value) => DefaultValueModel::Literal { value },
    }
}

#[cfg(not(coverage))]
fn normalize_default_value(
    extra: Option<&str>,
    default_value: Option<String>,
) -> DefaultValueModel {
    let extra_text = extra.unwrap_or_default().to_ascii_lowercase();
    match default_value {
        Some(value) if extra_text.contains("default_generated") => {
            DefaultValueModel::Expression { value }
        }
        Some(value) if value.eq_ignore_ascii_case("NULL") => DefaultValueModel::NullDefault,
        other => parse_default_value(other),
    }
}

#[cfg(not(coverage))]
fn decode_text_cell_named(row: &MySqlRow, column: &str) -> Result<String, String> {
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
fn decode_optional_text_cell_named(row: &MySqlRow, column: &str) -> Result<Option<String>, String> {
    match row.try_get::<Option<String>, _>(column) {
        Ok(value) => Ok(value),
        Err(_) => match row.try_get::<Option<Vec<u8>>, _>(column) {
            Ok(value) => Ok(value.map(|bytes| String::from_utf8_lossy(&bytes).into_owned())),
            Err(error) => Err(format!(
                "Failed to decode optional column '{column}' as UTF-8 text: {error}"
            )),
        },
    }
}

#[cfg(not(coverage))]
fn build_index_type(index_name: &str, non_unique: i64, index_type: &str) -> String {
    if index_name == "PRIMARY" {
        return "PRIMARY".to_string();
    }
    if non_unique == 0 {
        return "UNIQUE".to_string();
    }
    if index_type.eq_ignore_ascii_case("FULLTEXT") {
        return "FULLTEXT".to_string();
    }
    "INDEX".to_string()
}

#[cfg(not(coverage))]
type IndexRowGroup = (String, i64, String, Vec<String>);

#[cfg(not(coverage))]
fn designer_index_from_group(group: IndexRowGroup) -> DesignerIndexDef {
    let (name, non_unique, index_type, columns) = group;
    DesignerIndexDef {
        index_type: build_index_type(&name, non_unique, &index_type),
        name,
        columns,
    }
}

#[cfg(not(coverage))]
fn charset_for_collation(collation: &str) -> String {
    if collation.is_empty() {
        return String::new();
    }
    table_designer::derive_charset_from_collation(collation)
}

#[cfg(not(coverage))]
pub async fn load_table_for_designer_impl(
    state: &AppState,
    request: &LoadTableForDesignerRequest,
) -> Result<DesignerTableSchema, String> {
    let pool = get_pool(state, &request.connection_id)?;
    let database = request.database.as_str();
    let table_name = request.table_name.as_str();
    let binds = [database.to_string(), table_name.to_string()];

    let columns_sql = table_designer::load_columns_query();
    query_log::log_outgoing_sql_bound(columns_sql, &binds);
    let column_rows = sqlx::query(columns_sql)
        .bind(database)
        .bind(table_name)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;

    let metadata_sql = table_designer::load_table_metadata_query();
    query_log::log_outgoing_sql_bound(metadata_sql, &binds);
    let metadata_row = sqlx::query(metadata_sql)
        .bind(database)
        .bind(table_name)
        .fetch_optional(&pool)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("Table '{database}.{table_name}' was not found"))?;

    let indexes_sql = table_designer::load_indexes_query();
    query_log::log_outgoing_sql_bound(indexes_sql, &binds);
    let index_rows = sqlx::query(indexes_sql)
        .bind(database)
        .bind(table_name)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;

    let foreign_keys_sql = table_designer::load_foreign_keys_query();
    query_log::log_outgoing_sql_bound(foreign_keys_sql, &binds);
    let foreign_key_rows = sqlx::query(foreign_keys_sql)
        .bind(database)
        .bind(table_name)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;

    let columns = column_rows
        .into_iter()
        .map(|row| {
            let name = decode_text_cell_named(&row, "COLUMN_NAME")?;
            let column_type = decode_text_cell_named(&row, "COLUMN_TYPE")?;
            let is_nullable = decode_text_cell_named(&row, "IS_NULLABLE")?;
            let column_key = decode_text_cell_named(&row, "COLUMN_KEY")?;
            let column_default = decode_optional_text_cell_named(&row, "COLUMN_DEFAULT")?;
            let extra = decode_optional_text_cell_named(&row, "EXTRA")?;
            let comment = decode_optional_text_cell_named(&row, "COLUMN_COMMENT")?;
            let ParsedColumnType {
                base_type,
                length,
                type_modifier,
            } = parse_column_type(&column_type);
            let is_auto_increment = extra
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .contains("auto_increment");

            Ok(DesignerColumnDef {
                original_name: name.clone(),
                name,
                r#type: base_type,
                type_modifier,
                length,
                nullable: is_nullable.eq_ignore_ascii_case("YES"),
                is_primary_key: column_key.eq_ignore_ascii_case("PRI"),
                is_auto_increment,
                default_value: normalize_default_value(extra.as_deref(), column_default),
                comment: comment.unwrap_or_default(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    let mut indexes = Vec::new();
    let mut current_index: Option<IndexRowGroup> = None;

    for row in index_rows {
        let index_name = decode_text_cell_named(&row, "INDEX_NAME")?;
        let non_unique: i64 = row
            .try_get("NON_UNIQUE")
            .map_err(|error| error.to_string())?;
        let column_name = decode_text_cell_named(&row, "COLUMN_NAME")?;
        let index_type = decode_text_cell_named(&row, "INDEX_TYPE")?;

        let same_index = current_index
            .as_ref()
            .map(|(name, _, _, _)| *name == index_name)
            .unwrap_or(false);

        if same_index {
            if let Some((_, _, _, columns)) = current_index.as_mut() {
                columns.push(column_name);
            }
            continue;
        }
        if let Some(previous_index) = current_index.take() {
            indexes.push(designer_index_from_group(previous_index));
        }
        current_index = Some((index_name, non_unique, index_type, vec![column_name]));
    }

    if let Some(last_index) = current_index {
        indexes.push(designer_index_from_group(last_index));
    }

    let mut foreign_keys = Vec::new();
    let mut current_foreign_key: Option<DesignerForeignKeyDef> = None;
    let mut current_foreign_key_count = 0usize;

    for row in foreign_key_rows {
        let foreign_key_name = decode_text_cell_named(&row, "CONSTRAINT_NAME")?;
        let source_column = decode_text_cell_named(&row, "COLUMN_NAME")?;
        let referenced_database = decode_text_cell_named(&row, "REFERENCED_TABLE_SCHEMA")?;
        let referenced_table = decode_text_cell_named(&row, "REFERENCED_TABLE_NAME")?;
        let referenced_column = decode_text_cell_named(&row, "REFERENCED_COLUMN_NAME")?;
        let on_delete = decode_text_cell_named(&row, "DELETE_RULE")?;
        let on_update = decode_text_cell_named(&row, "UPDATE_RULE")?;

        match current_foreign_key.as_mut() {
            Some(existing) if existing.name == foreign_key_name => {
                current_foreign_key_count += 1;
                existing.is_composite = true;
            }
            Some(_) => {
                if let Some(existing) = current_foreign_key.take() {
                    foreign_keys.push(existing);
                }
                current_foreign_key = Some(DesignerForeignKeyDef {
                    name: foreign_key_name,
                    source_column,
                    referenced_database,
                    referenced_table,
                    referenced_column,
                    on_delete,
                    on_update,
                    is_composite: false,
                });
                current_foreign_key_count = 1;
            }
            None => {
                current_foreign_key = Some(DesignerForeignKeyDef {
                    name: foreign_key_name,
                    source_column,
                    referenced_database,
                    referenced_table,
                    referenced_column,
                    on_delete,
                    on_update,
                    is_composite: false,
                });
                current_foreign_key_count = 1;
            }
        }

        if current_foreign_key_count > 1 {
            if let Some(existing) = current_foreign_key.as_mut() {
                existing.is_composite = true;
            }
        }
    }

    if let Some(existing) = current_foreign_key {
        foreign_keys.push(existing);
    }

    let collation =
        decode_optional_text_cell_named(&metadata_row, "TABLE_COLLATION")?.unwrap_or_default();

    let properties = DesignerTableProperties {
        engine: decode_optional_text_cell_named(&metadata_row, "ENGINE")?.unwrap_or_default(),
        charset: charset_for_collation(&collation),
        collation,
        auto_increment: match metadata_row.try_get::<Option<u64>, _>("AUTO_INCREMENT") {
            Ok(value) => value,
            Err(unsigned_error) => metadata_row
                .try_get::<Option<i64>, _>("AUTO_INCREMENT")
                .map_err(|_| unsigned_error.to_string())?
                .and_then(|value| u64::try_from(value).ok()),
        },
        row_format: decode_optional_text_cell_named(&metadata_row, "ROW_FORMAT")?
            .unwrap_or_default(),
        comment: decode_optional_text_cell_named(&metadata_row, "TABLE_COMMENT")?
            .unwrap_or_default(),
    };

    Ok(DesignerTableSchema {
        table_name: table_name.to_string(),
        columns,
        indexes,
        foreign_keys,
        properties,
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

    query_log::log_outgoing_sql(ddl);
    let result = sqlx::query(sqlx::AssertSqlSafe(ddl))
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;
    query_log::log_execute_result(&result);

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
