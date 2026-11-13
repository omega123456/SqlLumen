use super::*;

#[cfg(not(coverage))]
pub(super) fn log_table_data_sql(sql: &str, params: &[serde_json::Value]) {
    let binds: Vec<String> = params.iter().map(|value| value.to_string()).collect();
    crate::mysql::query_log::log_outgoing_sql_bound(sql, &binds);
}

#[cfg(not(coverage))]
const COLUMN_METADATA_SQL: &str =
    "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, \
                   COLUMN_DEFAULT, EXTRA \
                   FROM INFORMATION_SCHEMA.COLUMNS \
                   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
                   ORDER BY ORDINAL_POSITION";

#[cfg(not(coverage))]
const PRIMARY_KEY_COLUMNS_SQL: &str = "SELECT kcu.COLUMN_NAME \
                  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu \
                  JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc \
                    ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME \
                    AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA \
                    AND kcu.TABLE_NAME = tc.TABLE_NAME \
                  WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? \
                    AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY' \
                  ORDER BY kcu.ORDINAL_POSITION";

#[cfg(not(coverage))]
const UNIQUE_KEY_COLUMNS_SQL: &str = "SELECT tc.CONSTRAINT_NAME, kcu.COLUMN_NAME \
                    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc \
                    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu \
                      ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME \
                      AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA \
                      AND tc.TABLE_NAME = kcu.TABLE_NAME \
                    WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ? \
                      AND tc.CONSTRAINT_TYPE = 'UNIQUE' \
                    ORDER BY tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION";

#[cfg(not(coverage))]
struct MetadataRowsQuery<'a> {
    sql: &'static str,
    database: &'a str,
    table: &'a str,
    failure_label: &'static str,
}

#[cfg(not(coverage))]
async fn fetch_metadata_rows(
    pool: &sqlx::MySqlPool,
    query: MetadataRowsQuery<'_>,
) -> Result<Vec<sqlx::mysql::MySqlRow>, String> {
    log_table_data_sql(
        query.sql,
        &[
            serde_json::Value::String(query.database.to_string()),
            serde_json::Value::String(query.table.to_string()),
        ],
    );
    let rows = sqlx::query(query.sql)
        .bind(query.database)
        .bind(query.table)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to fetch {}: {error}", query.failure_label))?;
    crate::mysql::query_log::log_mysql_rows(&rows);
    Ok(rows)
}

#[cfg(not(coverage))]
fn column_meta_from_row(row: &sqlx::mysql::MySqlRow) -> TableDataColumnMeta {
    let data_type = decode_text(row, 1).to_uppercase();
    let column_type = decode_text(row, 2);
    let is_nullable = decode_text(row, 3) == "YES";
    let column_key = decode_text(row, 4);
    let column_default = decode_optional_text(row, 5);
    let extra = decode_text(row, 6).to_lowercase();
    TableDataColumnMeta {
        name: decode_text(row, 0),
        is_binary: is_binary_data_type(&data_type),
        is_boolean_alias: is_boolean_alias_column(&data_type, &column_type),
        enum_values: parse_enum_values(&column_type),
        set_values: parse_set_values(&column_type),
        data_type,
        is_nullable,
        is_primary_key: column_key.contains("PRI"),
        is_unique_key: column_key.contains("UNI"),
        has_default: column_default.is_some() || is_nullable,
        column_default,
        is_auto_increment: extra.contains("auto_increment"),
    }
}

#[cfg(not(coverage))]
fn key_metadata(
    columns: Vec<TableDataColumnMeta>,
    key_columns: Vec<String>,
    is_unique_key_fallback: bool,
) -> TableKeyMetadata {
    let has_auto_increment = columns
        .iter()
        .any(|column| is_auto_increment_key_column(column, &key_columns));
    TableKeyMetadata {
        primary_key: Some(PrimaryKeyInfo {
            key_columns,
            has_auto_increment,
            is_unique_key_fallback,
        }),
        columns,
    }
}

#[cfg(not(coverage))]
struct UniqueConstraintColumns {
    name: String,
    columns: Vec<String>,
}

#[cfg(not(coverage))]
fn group_unique_constraints(rows: &[sqlx::mysql::MySqlRow]) -> Vec<UniqueConstraintColumns> {
    let mut constraints: Vec<UniqueConstraintColumns> = Vec::new();
    for row in rows {
        let constraint_name = decode_text(row, 0);
        let column_name = decode_text(row, 1);
        match constraints.last_mut() {
            Some(last) if last.name == constraint_name => last.columns.push(column_name),
            _ => constraints.push(UniqueConstraintColumns {
                name: constraint_name,
                columns: vec![column_name],
            }),
        }
    }
    constraints
}

#[cfg(not(coverage))]
fn is_not_null_column(columns: &[TableDataColumnMeta], column_name: &str) -> bool {
    columns
        .iter()
        .find(|column| column.name == column_name)
        .is_some_and(|column| !column.is_nullable)
}

#[cfg(not(coverage))]
fn first_not_null_unique_key(
    columns: &[TableDataColumnMeta],
    constraints: Vec<UniqueConstraintColumns>,
) -> Option<Vec<String>> {
    constraints
        .into_iter()
        .map(|constraint| constraint.columns)
        .find(|key_columns| {
            key_columns
                .iter()
                .all(|column_name| is_not_null_column(columns, column_name))
        })
}

#[cfg(not(coverage))]
pub async fn fetch_table_pk_impl(
    pool: &sqlx::MySqlPool,
    database: &str,
    table: &str,
) -> Result<TableKeyMetadata, String> {
    let metadata_query = |sql, failure_label| MetadataRowsQuery {
        sql,
        database,
        table,
        failure_label,
    };
    let column_rows =
        fetch_metadata_rows(pool, metadata_query(COLUMN_METADATA_SQL, "column metadata")).await?;
    let columns: Vec<TableDataColumnMeta> = column_rows.iter().map(column_meta_from_row).collect();

    let primary_key_rows = fetch_metadata_rows(
        pool,
        metadata_query(PRIMARY_KEY_COLUMNS_SQL, "primary key info"),
    )
    .await?;
    let primary_key_columns: Vec<String> = primary_key_rows
        .iter()
        .map(|row| decode_text(row, 0))
        .collect();
    if !primary_key_columns.is_empty() {
        return Ok(key_metadata(columns, primary_key_columns, false));
    }

    let unique_rows = fetch_metadata_rows(
        pool,
        metadata_query(UNIQUE_KEY_COLUMNS_SQL, "unique key info"),
    )
    .await?;
    let unique_key = first_not_null_unique_key(&columns, group_unique_constraints(&unique_rows));
    let Some(unique_key_columns) = unique_key else {
        return Ok(TableKeyMetadata {
            primary_key: None,
            columns,
        });
    };
    Ok(key_metadata(columns, unique_key_columns, true))
}

#[cfg(not(coverage))]
pub async fn fetch_table_pk_cached(
    context: &TableDataContext<'_>,
    database: &str,
    table: &str,
) -> Result<TableKeyMetadata, String> {
    let key = MetadataTableKey::new(context.connection_id, database, table);
    if let Some(metadata) = context.metadata_cache.get(&key) {
        return Ok(metadata);
    }

    let metadata = fetch_table_pk_impl(context.pool, database, table).await?;
    context.metadata_cache.insert(key, metadata.clone());

    Ok(metadata)
}

#[cfg(coverage)]
pub async fn fetch_table_pk_cached(
    context: &TableDataContext<'_>,
    database: &str,
    table: &str,
) -> Result<TableKeyMetadata, String> {
    let key = MetadataTableKey::new(context.connection_id, database, table);
    Ok(context
        .metadata_cache
        .get(&key)
        .unwrap_or_else(|| TableKeyMetadata {
            primary_key: None,
            columns: Vec::new(),
        }))
}

#[cfg(not(coverage))]
fn primary_key_column_names(
    primary_key_info: Option<&PrimaryKeyInfo>,
) -> std::collections::HashSet<&str> {
    primary_key_info
        .map(|primary_key| {
            primary_key
                .key_columns
                .iter()
                .map(|column_name| column_name.as_str())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(not(coverage))]
type RunningTableQueries = TokioRwLock<HashMap<(String, String), u64>>;

#[cfg(not(coverage))]
struct CancellablePageFetch<'a> {
    running_queries: &'a RunningTableQueries,
    cancel_key: (String, String),
    sql: &'a str,
    params: &'a [serde_json::Value],
}

#[cfg(not(coverage))]
async fn fetch_cancellable_page_rows(
    pool: &sqlx::MySqlPool,
    fetch: CancellablePageFetch<'_>,
) -> Result<Vec<sqlx::mysql::MySqlRow>, String> {
    let mut conn = pool
        .acquire()
        .await
        .map_err(|error| format!("Failed to acquire connection: {error}"))?;
    let thread_id: Option<u64> = sqlx::query_scalar("SELECT CONNECTION_ID()")
        .fetch_one(&mut *conn)
        .await
        .ok();
    if let Some(tid) = thread_id {
        fetch
            .running_queries
            .write()
            .await
            .insert(fetch.cancel_key.clone(), tid);
    }

    let mut data_query = sqlx::query(sqlx::AssertSqlSafe(fetch.sql));
    for param in fetch.params {
        data_query = bind_json_value(data_query, param);
    }
    let data_result = data_query.fetch_all(&mut *conn).await;

    if thread_id.is_some() {
        fetch
            .running_queries
            .write()
            .await
            .remove(&fetch.cancel_key);
    }

    let data_rows = data_result.map_err(|error| format!("Data query failed: {error}"))?;
    crate::mysql::query_log::log_mysql_rows(&data_rows);
    Ok(data_rows)
}

#[cfg(not(coverage))]
fn serialize_page_row(
    row: &sqlx::mysql::MySqlRow,
    columns: &[TableDataColumnMeta],
    primary_key_columns: &std::collections::HashSet<&str>,
) -> Vec<serde_json::Value> {
    let row_col_count = row.columns().len();
    columns
        .iter()
        .enumerate()
        .map(|(column_index, col_meta)| {
            if column_index >= row_col_count {
                return serde_json::Value::Null;
            }
            let encoding = CellEncoding {
                is_binary: col_meta.is_binary,
                is_primary_key: primary_key_columns.contains(col_meta.name.as_str()),
            };
            serialize_table_value(row, column_index, encoding)
        })
        .collect()
}

#[cfg(not(coverage))]
pub async fn fetch_table_data_impl(
    context: &TableDataContext<'_>,
    running_queries: &RunningTableQueries,
    query: &TableDataPageQuery,
) -> Result<TableDataResponse, String> {
    let start = std::time::Instant::now();
    let database = query.database.as_str();
    let table = query.table.as_str();
    let page_size = query.page_size;

    let TableKeyMetadata {
        primary_key: primary_key_info,
        columns,
    } = fetch_table_pk_cached(context, database, table).await?;
    let primary_key_column_set = primary_key_column_names(primary_key_info.as_ref());

    let filter_clause = translate_filter_model_with_columns(&query.filter_model, &columns);
    let where_sql = where_clause_sql(&filter_clause.sql);
    let order_sql = order_by_sql(query.sort.as_ref())?;
    let safe_db = safe_identifier(database)?;
    let safe_table = safe_identifier(table)?;
    let projection = build_table_data_projection(&columns, &primary_key_column_set)?;

    let page = query.page.max(1);
    let offset = (page - 1) as u64 * page_size as u64;
    let data_sql = format!(
        "SELECT {projection} FROM {safe_db}.{safe_table}{where_sql}{order_sql} LIMIT {page_size} OFFSET {offset}"
    );
    log_table_data_sql(&data_sql, &filter_clause.params);

    let page_fetch = CancellablePageFetch {
        running_queries,
        cancel_key: (context.connection_id.to_string(), query.tab_id.clone()),
        sql: &data_sql,
        params: &filter_clause.params,
    };
    let data_rows = fetch_cancellable_page_rows(context.pool, page_fetch).await?;
    let execution_time_ms = start.elapsed().as_millis() as u64;

    let serialized_rows: Vec<Vec<serde_json::Value>> = data_rows
        .iter()
        .map(|row| serialize_page_row(row, &columns, &primary_key_column_set))
        .collect();

    Ok(TableDataResponse {
        columns,
        rows: Arc::new(serialized_rows),
        current_page: page,
        page_size,
        primary_key: primary_key_info,
        execution_time_ms,
    })
}

#[cfg(coverage)]
pub async fn fetch_table_data_impl(
    _context: &TableDataContext<'_>,
    _running_queries: &TokioRwLock<HashMap<(String, String), u64>>,
    query: &TableDataPageQuery,
) -> Result<TableDataResponse, String> {
    Ok(TableDataResponse {
        columns: vec![],
        rows: Arc::new(vec![]),
        current_page: query.page,
        page_size: query.page_size,
        primary_key: None,
        execution_time_ms: 0,
    })
}
