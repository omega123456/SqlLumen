use super::*;

pub(super) fn schema_info_history_sql(request: &SchemaObjectRequest) -> String {
    let type_upper = request.object_type.to_uppercase();
    let database = &request.database;
    let object_name = &request.object_name;
    format!(
        "/* schema info */ SELECT ... FROM INFORMATION_SCHEMA FOR {type_upper} `{database}`.`{object_name}`"
    )
}

pub(super) fn evict_tables_after_success(
    state: &AppState,
    connection_id: &str,
    affected_tables: &[(Option<String>, String)],
) {
    let eviction = TableEviction {
        connection_id,
        affected_tables,
        default_database: None,
    };
    evict_metadata_cache_for_tables(state, &eviction);
}

pub async fn get_schema_info_with_history(
    state: &AppState,
    request: &SchemaObjectRequest,
) -> Result<SchemaInfoResponse, String> {
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: schema_info_history_sql(request),
    };
    run_with_history(state, statement, get_schema_info_impl(state, request)).await
}

pub async fn create_database_with_history(
    state: &AppState,
    request: &DatabaseEncodingRequest,
) -> Result<(), String> {
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: encoding_history_sql("CREATE DATABASE", request),
    };
    run_with_history(state, statement, create_database_impl(state, request)).await
}

pub async fn alter_database_with_history(
    state: &AppState,
    request: &DatabaseEncodingRequest,
) -> Result<(), String> {
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: encoding_history_sql("ALTER DATABASE", request),
    };
    run_with_history(state, statement, alter_database_impl(state, request)).await
}

pub async fn drop_database_with_history(
    state: &AppState,
    request: &DropDatabaseRequest,
) -> Result<(), String> {
    let name = &request.name;
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: format!("DROP DATABASE `{name}`"),
    };
    run_with_history(state, statement, drop_database_impl(state, request)).await?;
    evict_metadata_cache_for_database(state, &request.connection_id, name);
    Ok(())
}

pub(super) fn rename_database_history_statements(request: &RenameDatabaseRequest) -> Vec<String> {
    let old_name = &request.old_name;
    let new_name = &request.new_name;
    vec![
        format!("CREATE DATABASE `{new_name}`"),
        format!("RENAME TABLE ... (from `{old_name}` to `{new_name}`)"),
        format!("DROP DATABASE `{old_name}`"),
    ]
}

pub async fn rename_database_with_history(
    state: &AppState,
    request: &RenameDatabaseRequest,
) -> Result<(), String> {
    let started_at = Instant::now();
    let result = rename_database_impl(state, request).await;
    let batch_record = HistoryRecord::for_outcome(String::new(), started_at, &result);
    let records = rename_database_history_statements(request)
        .into_iter()
        .map(|sql_text| batch_record.for_statement(sql_text))
        .collect();
    log_history_batch(state, &request.connection_id, records);
    result
}

pub async fn drop_table_with_history(
    state: &AppState,
    request: &TableRequest,
) -> Result<(), String> {
    let database = &request.database;
    let table = &request.table;
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: format!("DROP TABLE `{database}`.`{table}`"),
    };
    run_with_history(state, statement, drop_table_impl(state, request)).await?;
    let affected_tables = [(Some(database.clone()), table.clone())];
    evict_tables_after_success(state, &request.connection_id, &affected_tables);
    Ok(())
}

pub async fn truncate_table_with_history(
    state: &AppState,
    request: &TableRequest,
) -> Result<(), String> {
    let database = &request.database;
    let table = &request.table;
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: format!("TRUNCATE TABLE `{database}`.`{table}`"),
    };
    run_with_history(state, statement, truncate_table_impl(state, request)).await
}

pub async fn rename_table_with_history(
    state: &AppState,
    request: &RenameTableRequest,
) -> Result<(), String> {
    let database = &request.database;
    let old_name = &request.old_name;
    let new_name = &request.new_name;
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: format!("RENAME TABLE `{database}`.`{old_name}` TO `{database}`.`{new_name}`"),
    };
    run_with_history(state, statement, rename_table_impl(state, request)).await?;
    let affected_tables = [
        (Some(database.clone()), old_name.clone()),
        (Some(database.clone()), new_name.clone()),
    ];
    evict_tables_after_success(state, &request.connection_id, &affected_tables);
    Ok(())
}
