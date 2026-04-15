//! Schema enumeration and DDL commands for MySQL connections.
//!
//! Each public `*_impl` function is the testable core logic, and the
//! `#[tauri::command]` wrappers are thin delegates.

#[cfg(not(coverage))]
use crate::commands::query_history_bridge::{
    log_batch_entries, log_single_entry, resolve_connection_context,
};
#[cfg(not(coverage))]
use crate::db::history::NewHistoryEntry;
#[cfg(not(coverage))]
use crate::mysql::query_log;
use crate::mysql::schema_queries::{
    self, CharsetInfo, CollationInfo, ColumnInfo, DatabaseDetails, ForeignKeyInfo,
    SchemaInfoResponse,
};
use crate::state::AppState;
#[cfg(not(coverage))]
use tauri::State;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

#[cfg(not(coverage))]
fn get_pool(state: &AppState, connection_id: &str) -> Result<sqlx::MySqlPool, String> {
    state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' is not open"))
}

fn check_not_read_only(state: &AppState, connection_id: &str) -> Result<(), String> {
    if state.registry.is_read_only(connection_id) {
        return Err("Operation not permitted: connection is read-only".to_string());
    }
    Ok(())
}

/// Validates optional charset and collation values against the server's lists.
/// Returns the SQL clause to append (e.g., " CHARACTER SET `utf8mb4` COLLATE `utf8mb4_unicode_ci`")
/// or empty string if neither is specified.
#[cfg(not(coverage))]
async fn build_encoding_clause(
    pool: &sqlx::MySqlPool,
    charset: Option<&str>,
    collation: Option<&str>,
) -> Result<String, String> {
    // Validate charset/collation against server-provided lists
    if let Some(cs) = charset {
        schema_queries::validate_charset(pool, cs).await?;
    }
    if let Some(coll) = collation {
        schema_queries::validate_collation(pool, coll, charset).await?;
    }

    // Build the SQL clause
    let mut clause = String::new();
    if let Some(cs) = charset {
        let safe_cs = schema_queries::safe_identifier(cs)?;
        clause.push_str(&format!(" CHARACTER SET {safe_cs}"));
    }
    if let Some(coll) = collation {
        let safe_coll = schema_queries::safe_identifier(coll)?;
        clause.push_str(&format!(" COLLATE {safe_coll}"));
    }
    Ok(clause)
}

/// Coverage-mode helper: validates identifier safety for charset/collation without a pool.
#[cfg(coverage)]
fn validate_encoding_identifiers(
    charset: Option<&str>,
    collation: Option<&str>,
) -> Result<(), String> {
    if let Some(cs) = charset {
        let _ = schema_queries::safe_identifier(cs)?;
    }
    if let Some(coll) = collation {
        let _ = schema_queries::safe_identifier(coll)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Read-only query commands — _impl + wrapper
// ---------------------------------------------------------------------------

// ---- list_databases ----

#[cfg(not(coverage))]
pub async fn list_databases_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<String>, String> {
    let pool = get_pool(state, connection_id)?;
    schema_queries::query_list_databases(&pool).await
}

#[cfg(coverage)]
pub async fn list_databases_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<String>, String> {
    if state.registry.get_pool(connection_id).is_none() {
        return Err(format!("Connection '{connection_id}' is not open"));
    }
    Ok(vec![])
}

// ---- list_schema_objects ----

#[cfg(not(coverage))]
pub async fn list_schema_objects_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    object_type: &str,
) -> Result<Vec<String>, String> {
    let pool = get_pool(state, connection_id)?;
    schema_queries::query_list_schema_objects(&pool, database, object_type).await
}

#[cfg(coverage)]
pub async fn list_schema_objects_impl(
    _state: &AppState,
    _connection_id: &str,
    _database: &str,
    object_type: &str,
) -> Result<Vec<String>, String> {
    // Validate object_type even in coverage stubs
    match object_type {
        "table" | "view" | "procedure" | "function" | "trigger" | "event" => Ok(vec![]),
        _ => Err(format!("Unknown object type: '{object_type}'")),
    }
}

// ---- list_columns ----

#[cfg(not(coverage))]
pub async fn list_columns_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let pool = get_pool(state, connection_id)?;
    schema_queries::query_list_columns(&pool, database, table).await
}

#[cfg(coverage)]
pub async fn list_columns_impl(
    _state: &AppState,
    _connection_id: &str,
    _database: &str,
    _table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    Ok(vec![])
}

// ---- get_table_foreign_keys ----

#[cfg(not(coverage))]
pub async fn get_table_foreign_keys_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    table: &str,
) -> Result<Vec<ForeignKeyInfo>, String> {
    let pool = get_pool(state, connection_id)?;
    schema_queries::query_foreign_keys(&pool, database, table).await
}

#[cfg(coverage)]
pub async fn get_table_foreign_keys_impl(
    _state: &AppState,
    _connection_id: &str,
    _database: &str,
    _table: &str,
) -> Result<Vec<ForeignKeyInfo>, String> {
    Ok(vec![])
}

// ---- get_schema_info ----

#[cfg(not(coverage))]
pub async fn get_schema_info_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    object_name: &str,
    object_type: &str,
) -> Result<SchemaInfoResponse, String> {
    let pool = get_pool(state, connection_id)?;
    schema_queries::query_schema_info(&pool, database, object_name, object_type).await
}

#[cfg(coverage)]
pub async fn get_schema_info_impl(
    _state: &AppState,
    _connection_id: &str,
    _database: &str,
    _object_name: &str,
    _object_type: &str,
) -> Result<SchemaInfoResponse, String> {
    Ok(SchemaInfoResponse {
        columns: vec![],
        indexes: vec![],
        foreign_keys: vec![],
        ddl: String::new(),
        metadata: None,
    })
}

// ---- get_database_details ----

#[cfg(not(coverage))]
pub async fn get_database_details_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
) -> Result<DatabaseDetails, String> {
    let pool = get_pool(state, connection_id)?;
    schema_queries::query_database_details(&pool, database).await
}

#[cfg(coverage)]
pub async fn get_database_details_impl(
    _state: &AppState,
    _connection_id: &str,
    database: &str,
) -> Result<DatabaseDetails, String> {
    Ok(DatabaseDetails {
        name: database.to_string(),
        default_character_set: String::new(),
        default_collation: String::new(),
    })
}

// ---- list_charsets ----

#[cfg(not(coverage))]
pub async fn list_charsets_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<CharsetInfo>, String> {
    let pool = get_pool(state, connection_id)?;
    schema_queries::query_list_charsets(&pool).await
}

#[cfg(coverage)]
pub async fn list_charsets_impl(
    _state: &AppState,
    _connection_id: &str,
) -> Result<Vec<CharsetInfo>, String> {
    Ok(vec![])
}

// ---- list_collations ----

#[cfg(not(coverage))]
pub async fn list_collations_impl(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<CollationInfo>, String> {
    let pool = get_pool(state, connection_id)?;
    schema_queries::query_list_collations(&pool).await
}

#[cfg(coverage)]
pub async fn list_collations_impl(
    _state: &AppState,
    _connection_id: &str,
) -> Result<Vec<CollationInfo>, String> {
    Ok(vec![])
}

// ---------------------------------------------------------------------------
// Mutating commands — check read-only before proceeding
// ---------------------------------------------------------------------------

// ---- create_database ----

#[cfg(not(coverage))]
pub async fn create_database_impl(
    state: &AppState,
    connection_id: &str,
    name: &str,
    charset: Option<&str>,
    collation: Option<&str>,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let pool = get_pool(state, connection_id)?;

    let encoding_clause = build_encoding_clause(&pool, charset, collation).await?;

    let safe_name = schema_queries::safe_identifier(name)?;
    let sql = format!("CREATE DATABASE {safe_name}{encoding_clause}");

    query_log::log_outgoing_sql(&sql);
    let r = sqlx::query(&sql)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create database '{name}': {e}"))?;
    query_log::log_execute_result(&r);

    Ok(())
}

#[cfg(coverage)]
pub async fn create_database_impl(
    state: &AppState,
    connection_id: &str,
    name: &str,
    charset: Option<&str>,
    collation: Option<&str>,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let _ = schema_queries::safe_identifier(name)?;
    validate_encoding_identifiers(charset, collation)?;
    Ok(())
}

// ---- drop_database ----

#[cfg(not(coverage))]
pub async fn drop_database_impl(
    state: &AppState,
    connection_id: &str,
    name: &str,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let pool = get_pool(state, connection_id)?;
    let safe_name = schema_queries::safe_identifier(name)?;
    let sql = format!("DROP DATABASE {safe_name}");
    query_log::log_outgoing_sql(&sql);
    let r = sqlx::query(&sql)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to drop database '{name}': {e}"))?;
    query_log::log_execute_result(&r);

    Ok(())
}

#[cfg(coverage)]
pub async fn drop_database_impl(
    state: &AppState,
    connection_id: &str,
    name: &str,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let _ = schema_queries::safe_identifier(name)?;
    Ok(())
}

// ---- alter_database ----

#[cfg(not(coverage))]
pub async fn alter_database_impl(
    state: &AppState,
    connection_id: &str,
    name: &str,
    charset: Option<&str>,
    collation: Option<&str>,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let pool = get_pool(state, connection_id)?;

    let encoding_clause = build_encoding_clause(&pool, charset, collation).await?;

    let safe_name = schema_queries::safe_identifier(name)?;
    let sql = format!("ALTER DATABASE {safe_name}{encoding_clause}");

    query_log::log_outgoing_sql(&sql);
    let r = sqlx::query(&sql)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to alter database '{name}': {e}"))?;
    query_log::log_execute_result(&r);

    Ok(())
}

#[cfg(coverage)]
pub async fn alter_database_impl(
    state: &AppState,
    connection_id: &str,
    name: &str,
    charset: Option<&str>,
    collation: Option<&str>,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let _ = schema_queries::safe_identifier(name)?;
    validate_encoding_identifiers(charset, collation)?;
    Ok(())
}

// ---- rename_database ----

#[cfg(not(coverage))]
pub async fn rename_database_impl(
    state: &AppState,
    connection_id: &str,
    old_name: &str,
    new_name: &str,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let pool = get_pool(state, connection_id)?;

    // Preflight: reject if database has non-table objects
    schema_queries::check_rename_safe(&pool, old_name).await?;

    let safe_old = schema_queries::safe_identifier(old_name)?;
    let safe_new = schema_queries::safe_identifier(new_name)?;

    // 1. Get all table names before creating the new database
    let tables = schema_queries::query_table_names(&pool, old_name).await?;

    // 2. Create new database
    let create_sql = format!("CREATE DATABASE {safe_new}");
    query_log::log_outgoing_sql(&create_sql);
    let r = sqlx::query(&create_sql)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create target database '{new_name}': {e}"))?;
    query_log::log_execute_result(&r);

    // 3. Move all tables atomically with a single RENAME TABLE statement
    if !tables.is_empty() {
        let mut rename_pairs = Vec::with_capacity(tables.len());
        for table in &tables {
            let safe_table = schema_queries::safe_identifier(table)?;
            rename_pairs.push(format!(
                "{safe_old}.{safe_table} TO {safe_new}.{safe_table}"
            ));
        }
        let sql = format!("RENAME TABLE {}", rename_pairs.join(", "));
        query_log::log_outgoing_sql(&sql);
        let r = sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| format!("Failed to move tables from '{old_name}' to '{new_name}': {e}"))?;
        query_log::log_execute_result(&r);
    }

    // 4. Drop old database
    let drop_sql = format!("DROP DATABASE {safe_old}");
    query_log::log_outgoing_sql(&drop_sql);
    let r = sqlx::query(&drop_sql)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to drop source database '{old_name}': {e}"))?;
    query_log::log_execute_result(&r);

    Ok(())
}

#[cfg(coverage)]
pub async fn rename_database_impl(
    state: &AppState,
    connection_id: &str,
    old_name: &str,
    new_name: &str,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let _ = schema_queries::safe_identifier(old_name)?;
    let _ = schema_queries::safe_identifier(new_name)?;
    Ok(())
}

// ---- drop_table ----

#[cfg(not(coverage))]
pub async fn drop_table_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    table: &str,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let pool = get_pool(state, connection_id)?;
    let safe_db = schema_queries::safe_identifier(database)?;
    let safe_table = schema_queries::safe_identifier(table)?;
    let sql = format!("DROP TABLE {safe_db}.{safe_table}");
    query_log::log_outgoing_sql(&sql);
    let r = sqlx::query(&sql)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to drop table '{database}'.'{table}': {e}"))?;
    query_log::log_execute_result(&r);

    Ok(())
}

#[cfg(coverage)]
pub async fn drop_table_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    table: &str,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let _ = schema_queries::safe_identifier(database)?;
    let _ = schema_queries::safe_identifier(table)?;
    Ok(())
}

// ---- truncate_table ----

#[cfg(not(coverage))]
pub async fn truncate_table_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    table: &str,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let pool = get_pool(state, connection_id)?;
    let safe_db = schema_queries::safe_identifier(database)?;
    let safe_table = schema_queries::safe_identifier(table)?;
    let sql = format!("TRUNCATE TABLE {safe_db}.{safe_table}");
    query_log::log_outgoing_sql(&sql);
    let r = sqlx::query(&sql)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to truncate table '{database}'.'{table}': {e}"))?;
    query_log::log_execute_result(&r);

    Ok(())
}

#[cfg(coverage)]
pub async fn truncate_table_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    table: &str,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let _ = schema_queries::safe_identifier(database)?;
    let _ = schema_queries::safe_identifier(table)?;
    Ok(())
}

// ---- rename_table ----

#[cfg(not(coverage))]
pub async fn rename_table_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    old_name: &str,
    new_name: &str,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let pool = get_pool(state, connection_id)?;
    let safe_db = schema_queries::safe_identifier(database)?;
    let safe_old = schema_queries::safe_identifier(old_name)?;
    let safe_new = schema_queries::safe_identifier(new_name)?;
    let sql = format!("RENAME TABLE {safe_db}.{safe_old} TO {safe_db}.{safe_new}");
    query_log::log_outgoing_sql(&sql);
    let r = sqlx::query(&sql)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to rename table '{old_name}' to '{new_name}': {e}"))?;
    query_log::log_execute_result(&r);

    Ok(())
}

#[cfg(coverage)]
pub async fn rename_table_impl(
    state: &AppState,
    connection_id: &str,
    database: &str,
    old_name: &str,
    new_name: &str,
) -> Result<(), String> {
    check_not_read_only(state, connection_id)?;
    let _ = schema_queries::safe_identifier(database)?;
    let _ = schema_queries::safe_identifier(old_name)?;
    let _ = schema_queries::safe_identifier(new_name)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Thin Tauri command wrappers
// ---------------------------------------------------------------------------

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_databases(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    list_databases_impl(&state, &connection_id).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_schema_objects(
    connection_id: String,
    database: String,
    object_type: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    list_schema_objects_impl(&state, &connection_id, &database, &object_type).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_columns(
    connection_id: String,
    database: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<ColumnInfo>, String> {
    list_columns_impl(&state, &connection_id, &database, &table).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_table_foreign_keys(
    connection_id: String,
    database: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<ForeignKeyInfo>, String> {
    get_table_foreign_keys_impl(&state, &connection_id, &database, &table).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn get_schema_info(
    connection_id: String,
    database: String,
    object_name: String,
    object_type: String,
    state: State<'_, AppState>,
) -> Result<SchemaInfoResponse, String> {
    let start = std::time::Instant::now();
    let result = get_schema_info_impl(
        &state,
        &connection_id,
        &database,
        &object_name,
        &object_type,
    )
    .await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);
    let type_upper = object_type.to_uppercase();
    let sql_text = format!(
        "/* schema info */ SELECT ... FROM INFORMATION_SCHEMA FOR {type_upper} `{database}`.`{object_name}`"
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
pub async fn get_database_details(
    connection_id: String,
    database: String,
    state: State<'_, AppState>,
) -> Result<DatabaseDetails, String> {
    get_database_details_impl(&state, &connection_id, &database).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_charsets(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<CharsetInfo>, String> {
    list_charsets_impl(&state, &connection_id).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn list_collations(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<CollationInfo>, String> {
    list_collations_impl(&state, &connection_id).await
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn create_database(
    connection_id: String,
    name: String,
    charset: Option<String>,
    collation: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let start = std::time::Instant::now();
    let result = create_database_impl(
        &state,
        &connection_id,
        &name,
        charset.as_deref(),
        collation.as_deref(),
    )
    .await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);

    let mut sql_text = format!("CREATE DATABASE `{name}`");
    if let Some(ref cs) = charset {
        sql_text.push_str(&format!(" CHARACTER SET `{cs}`"));
    }
    if let Some(ref coll) = collation {
        sql_text.push_str(&format!(" COLLATE `{coll}`"));
    }

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
pub async fn drop_database(
    connection_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let start = std::time::Instant::now();
    let result = drop_database_impl(&state, &connection_id, &name).await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);
    let sql_text = format!("DROP DATABASE `{name}`");

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
pub async fn alter_database(
    connection_id: String,
    name: String,
    charset: Option<String>,
    collation: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let start = std::time::Instant::now();
    let result = alter_database_impl(
        &state,
        &connection_id,
        &name,
        charset.as_deref(),
        collation.as_deref(),
    )
    .await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);

    let mut sql_text = format!("ALTER DATABASE `{name}`");
    if let Some(ref cs) = charset {
        sql_text.push_str(&format!(" CHARACTER SET `{cs}`"));
    }
    if let Some(ref coll) = collation {
        sql_text.push_str(&format!(" COLLATE `{coll}`"));
    }

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
pub async fn rename_database(
    connection_id: String,
    old_name: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let start = std::time::Instant::now();
    let result = rename_database_impl(&state, &connection_id, &old_name, &new_name).await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);

    // Rename database involves CREATE + RENAME TABLE(s) + DROP — log as a batch
    let stmts = vec![
        format!("CREATE DATABASE `{new_name}`"),
        format!("RENAME TABLE ... (from `{old_name}` to `{new_name}`)"),
        format!("DROP DATABASE `{old_name}`"),
    ];
    let entries: Vec<NewHistoryEntry> = stmts
        .into_iter()
        .map(|sql_text| NewHistoryEntry {
            connection_id: conn_id.clone(),
            database_name: database_name.clone(),
            sql_text,
            duration_ms: Some(duration_ms),
            row_count: Some(0),
            affected_rows: Some(0),
            success: result.is_ok(),
            error_message: result.as_ref().err().cloned(),
        })
        .collect();

    log_batch_entries(&state.db, entries);

    result
}

#[cfg(not(coverage))]
#[tauri::command]
pub async fn drop_table(
    connection_id: String,
    database: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let start = std::time::Instant::now();
    let result = drop_table_impl(&state, &connection_id, &database, &table).await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);
    let sql_text = format!("DROP TABLE `{database}`.`{table}`");

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
pub async fn truncate_table(
    connection_id: String,
    database: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let start = std::time::Instant::now();
    let result = truncate_table_impl(&state, &connection_id, &database, &table).await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);
    let sql_text = format!("TRUNCATE TABLE `{database}`.`{table}`");

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
pub async fn rename_table(
    connection_id: String,
    database: String,
    old_name: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let start = std::time::Instant::now();
    let result = rename_table_impl(&state, &connection_id, &database, &old_name, &new_name).await;

    let duration_ms = start.elapsed().as_millis() as i64;
    let (conn_id, database_name) = resolve_connection_context(&state, &connection_id);
    let sql_text = format!("RENAME TABLE `{database}`.`{old_name}` TO `{database}`.`{new_name}`");

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
