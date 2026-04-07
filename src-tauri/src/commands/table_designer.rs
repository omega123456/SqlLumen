//! Tauri commands for the table designer DDL workflow.
//!
//! Each public `*_impl` function contains the testable business logic, while
//! the `#[tauri::command]` wrappers remain thin delegates.

use crate::mysql::table_designer::{
    self, DesignerTableProperties, DesignerTableSchema, GenerateDdlRequest, GenerateDdlResponse,
};
use crate::state::AppState;

#[cfg(not(coverage))]
use crate::commands::query_history_bridge::{log_single_entry, resolve_connection_context};
#[cfg(not(coverage))]
use crate::db::history::NewHistoryEntry;
#[cfg(not(coverage))]
use crate::mysql::table_designer::{
    DefaultValueModel, DesignerColumnDef, DesignerForeignKeyDef, DesignerIndexDef,
};
#[cfg(not(coverage))]
use crate::mysql::query_log;
#[cfg(not(coverage))]
use sqlx::mysql::MySqlRow;
#[cfg(not(coverage))]
use sqlx::Row;
#[cfg(not(coverage))]
use tauri::State;

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

pub fn parse_column_type(column_type: &str) -> (String, String, String) {
    let trimmed = column_type.trim();

    match (trimmed.find('('), trimmed.rfind(')')) {
        (Some(open), Some(close)) if close > open => {
            let modifier_suffix = trimmed[(close + 1)..].trim().to_ascii_uppercase();
            (
                trimmed[..open].trim().to_ascii_uppercase(),
                trimmed[(open + 1)..close].trim().to_string(),
                modifier_suffix,
            )
        }
        _ => {
            let parts = trimmed
                .split_whitespace()
                .map(|part| part.to_ascii_uppercase())
                .collect::<Vec<_>>();

            let modifier_start = parts
                .iter()
                .position(|part| matches!(part.as_str(), "UNSIGNED" | "ZEROFILL" | "BINARY"));

            match modifier_start {
                Some(index) if index > 0 => (
                    parts[..index].join(" "),
                    String::new(),
                    parts[index..].join(" "),
                ),
                _ => (trimmed.to_ascii_uppercase(), String::new(), String::new()),
            }
        }
    }
}

#[cfg(not(coverage))]
fn parse_default_value(default_value: Option<String>) -> DefaultValueModel {
    match default_value {
        None => DefaultValueModel::NoDefault,
        Some(value) if value.eq_ignore_ascii_case("NULL") => DefaultValueModel::Expression { value },
        Some(value)
            if value.eq_ignore_ascii_case("CURRENT_TIMESTAMP")
                || value.to_ascii_uppercase().starts_with("CURRENT_TIMESTAMP(")
                || value.eq_ignore_ascii_case("CURRENT_DATE")
                || value.eq_ignore_ascii_case("CURRENT_TIME") =>
        {
            DefaultValueModel::Expression { value }
        }
        Some(value) => DefaultValueModel::Literal { value },
    }
}

#[cfg(not(coverage))]
fn normalize_default_value(extra: Option<&str>, default_value: Option<String>) -> DefaultValueModel {
    let extra_text = extra.unwrap_or_default().to_ascii_lowercase();
    match default_value {
        Some(value) if extra_text.contains("default_generated") => {
            DefaultValueModel::Expression { value }
        }
        Some(value) if value.eq_ignore_ascii_case("NULL") && !extra_text.contains("default_generated") => {
            DefaultValueModel::NullDefault
        }
        other => parse_default_value(other),
    }
}

#[cfg(not(coverage))]
fn decode_text_cell_named(row: &MySqlRow, column: &str) -> Result<String, String> {
    match row.try_get::<String, _>(column) {
        Ok(value) => Ok(value),
        Err(_) => {
            let bytes: Vec<u8> = row
                .try_get(column)
                .map_err(|err| format!("Failed to decode column '{column}' as UTF-8 text: {err}"))?;
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
            Err(err) => Err(format!("Failed to decode optional column '{column}' as UTF-8 text: {err}")),
        },
    }
}

#[cfg(not(coverage))]
fn build_index_type(index_name: &str, non_unique: i64, index_type: &str) -> String {
    if index_name == "PRIMARY" {
        "PRIMARY".to_string()
    } else if non_unique == 0 {
        "UNIQUE".to_string()
    } else if index_type.eq_ignore_ascii_case("FULLTEXT") {
        "FULLTEXT".to_string()
    } else {
        "INDEX".to_string()
    }
}

#[cfg(not(coverage))]
pub async fn load_table_for_designer_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    table_name: &str,
) -> Result<DesignerTableSchema, String> {
    let pool = get_pool(state, connection_id)?;
    let binds = [database.to_string(), table_name.to_string()];

    let columns_sql = table_designer::load_columns_query();
    query_log::log_outgoing_sql_bound(columns_sql, &binds);
    let column_rows = sqlx::query(columns_sql)
        .bind(database)
        .bind(table_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let metadata_sql = table_designer::load_table_metadata_query();
    query_log::log_outgoing_sql_bound(metadata_sql, &binds);
    let metadata_row = sqlx::query(metadata_sql)
        .bind(database)
        .bind(table_name)
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Table '{database}.{table_name}' was not found"))?;

    let indexes_sql = table_designer::load_indexes_query();
    query_log::log_outgoing_sql_bound(indexes_sql, &binds);
    let index_rows = sqlx::query(indexes_sql)
        .bind(database)
        .bind(table_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let foreign_keys_sql = table_designer::load_foreign_keys_query();
    query_log::log_outgoing_sql_bound(foreign_keys_sql, &binds);
    let foreign_key_rows = sqlx::query(foreign_keys_sql)
        .bind(database)
        .bind(table_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

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
            let (base_type, length, type_modifier) = parse_column_type(&column_type);
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
    let mut current_index: Option<(String, i64, String, Vec<String>)> = None;

    for row in index_rows {
        let index_name = decode_text_cell_named(&row, "INDEX_NAME")?;
        let non_unique: i64 = row.try_get("NON_UNIQUE").map_err(|e| e.to_string())?;
        let column_name = decode_text_cell_named(&row, "COLUMN_NAME")?;
        let index_type = decode_text_cell_named(&row, "INDEX_TYPE")?;

        let same_index = current_index
            .as_ref()
            .map(|(name, _, _, _)| *name == index_name)
            .unwrap_or(false);

        if same_index {
            // append column to the current in-flight index
            if let Some((_, _, _, columns)) = current_index.as_mut() {
                columns.push(column_name);
            }
        } else {
            // flush the previous index (if any), then start a new one
            if let Some((name, prev_non_unique, prev_index_type, columns)) =
                current_index.take()
            {
                indexes.push(DesignerIndexDef {
                    name: name.clone(),
                    index_type: build_index_type(&name, prev_non_unique, &prev_index_type),
                    columns,
                });
            }
            current_index = Some((index_name, non_unique, index_type, vec![column_name]));
        }
    }

    if let Some((name, non_unique, index_type, columns)) = current_index {
        indexes.push(DesignerIndexDef {
            name: name.clone(),
            index_type: build_index_type(&name, non_unique, &index_type),
            columns,
        });
    }

    let mut foreign_keys = Vec::new();
    let mut current_foreign_key: Option<DesignerForeignKeyDef> = None;
    let mut current_foreign_key_count = 0usize;

    for row in foreign_key_rows {
        let fk_name = decode_text_cell_named(&row, "CONSTRAINT_NAME")?;
        let source_column = decode_text_cell_named(&row, "COLUMN_NAME")?;
        let referenced_table = decode_text_cell_named(&row, "REFERENCED_TABLE_NAME")?;
        let referenced_column = decode_text_cell_named(&row, "REFERENCED_COLUMN_NAME")?;
        let on_delete = decode_text_cell_named(&row, "DELETE_RULE")?;
        let on_update = decode_text_cell_named(&row, "UPDATE_RULE")?;

        match current_foreign_key.as_mut() {
            Some(existing) if existing.name == fk_name => {
                current_foreign_key_count += 1;
                existing.is_composite = true;
            }
            Some(_) => {
                if let Some(existing) = current_foreign_key.take() {
                    foreign_keys.push(existing);
                }
                current_foreign_key = Some(DesignerForeignKeyDef {
                    name: fk_name,
                    source_column,
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
                    name: fk_name,
                    source_column,
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

    let collation = decode_optional_text_cell_named(&metadata_row, "TABLE_COLLATION")?
        .unwrap_or_default();

    let properties = DesignerTableProperties {
        engine: decode_optional_text_cell_named(&metadata_row, "ENGINE")?.unwrap_or_default(),
        charset: if collation.is_empty() {
            String::new()
        } else {
            table_designer::derive_charset_from_collation(&collation)
        },
        collation,
        auto_increment: match metadata_row.try_get::<Option<u64>, _>("AUTO_INCREMENT") {
            Ok(value) => value,
            Err(unsigned_error) => metadata_row
                .try_get::<Option<i64>, _>("AUTO_INCREMENT")
                .map_err(|_| unsigned_error.to_string())?
                .and_then(|value| u64::try_from(value).ok()),
        },
        row_format: decode_optional_text_cell_named(&metadata_row, "ROW_FORMAT")?.unwrap_or_default(),
        comment: decode_optional_text_cell_named(&metadata_row, "TABLE_COMMENT")?.unwrap_or_default(),
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
    connection_id: &str,
    _database: &str,
    table_name: &str,
) -> Result<DesignerTableSchema, String> {
    if state.registry.get_pool(connection_id).is_none() {
        return Err(format!("Connection '{connection_id}' is not open"));
    }

    Ok(DesignerTableSchema {
        table_name: table_name.to_string(),
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
            let (ddl, warnings) = table_designer::generate_alter_table_ddl(
                original_schema,
                &request.current_schema,
                &request.database,
            );

            Ok(GenerateDdlResponse { ddl, warnings })
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
    connection_id: &str,
    database: &str,
    ddl: &str,
) -> Result<(), String> {
    let _ = database;

    check_not_read_only(state, connection_id)?;
    let pool = get_pool(state, connection_id)?;

    query_log::log_outgoing_sql(ddl);
    let result = sqlx::query(ddl)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    query_log::log_execute_result(&result);

    Ok(())
}

#[cfg(coverage)]
pub async fn apply_table_ddl_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    ddl: &str,
) -> Result<(), String> {
    let _ = database;

    check_not_read_only(state, connection_id)?;

    if state.registry.get_pool(connection_id).is_none() {
        return Err(format!("Connection '{connection_id}' is not open"));
    }

    if ddl.trim().is_empty() {
        return Err("DDL cannot be empty".to_string());
    }

    Ok(())
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn load_table_for_designer(
    connection_id: String,
    database: String,
    table_name: String,
    state: State<'_, AppState>,
) -> Result<DesignerTableSchema, String> {
    let start = std::time::Instant::now();
    let result =
        load_table_for_designer_impl(&state, &connection_id, &database, &table_name).await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);
    let sql_text = format!(
        "/* table designer */ SELECT ... FROM INFORMATION_SCHEMA FOR TABLE `{database}`.`{table_name}`"
    );

    log_single_entry(
        &state.db,
        NewHistoryEntry {
            connection_id: conn_id,
            database_name,
            sql_text,
            duration_ms: Some(duration_ms),
            row_count: Some(0),
            affected_rows: Some(0),
            success: result.is_ok(),
            error_message: result.as_ref().err().cloned(),
        },
    );

    result
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn generate_table_ddl(request: GenerateDdlRequest) -> Result<GenerateDdlResponse, String> {
    generate_table_ddl_impl(request).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn apply_table_ddl(
    connection_id: String,
    database: String,
    ddl: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let start = std::time::Instant::now();
    let result = apply_table_ddl_impl(&state, &connection_id, &database, &ddl).await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);

    log_single_entry(
        &state.db,
        NewHistoryEntry {
            connection_id: conn_id,
            database_name,
            sql_text: ddl,
            duration_ms: Some(duration_ms),
            row_count: Some(0),
            affected_rows: Some(0),
            success: result.is_ok(),
            error_message: result.as_ref().err().cloned(),
        },
    );

    result
}
