#[cfg(not(coverage))]
use crate::mysql::query_log;
#[cfg(not(coverage))]
use sqlx::MySqlPool;
#[cfg(not(coverage))]
use sqlx::Row;

#[cfg(not(coverage))]
use super::decode_mysql_optional_text_cell;
#[cfg(not(coverage))]
use super::{decode_mysql_text_cell, RoutineRef};

#[derive(Debug)]
pub struct RoutineParameterRow {
    pub name: String,
    pub data_type: String,
    pub mode: String,
    pub ordinal_position: i32,
}

#[cfg(not(coverage))]
fn routine_parameter_ordinal_filter(include_return_type: bool) -> &'static str {
    if include_return_type {
        return "ORDINAL_POSITION >= 0";
    }
    "ORDINAL_POSITION > 0"
}

#[cfg(not(coverage))]
pub(crate) async fn query_routine_parameters_inner(
    pool: &MySqlPool,
    routine: RoutineRef<'_>,
    include_return_type: bool,
) -> Result<Vec<RoutineParameterRow>, String> {
    let RoutineRef {
        database,
        routine_name,
        routine_type,
    } = routine;
    let ordinal_filter = routine_parameter_ordinal_filter(include_return_type);
    let sql = format!(
        "SELECT \
        PARAMETER_NAME, DTD_IDENTIFIER, PARAMETER_MODE, \
        CAST(ORDINAL_POSITION AS SIGNED) \
        FROM INFORMATION_SCHEMA.PARAMETERS \
        WHERE SPECIFIC_SCHEMA = ? AND SPECIFIC_NAME = ? \
        AND ROUTINE_TYPE = ? AND {ordinal_filter} \
        ORDER BY ORDINAL_POSITION"
    );
    query_log::log_outgoing_sql_bound(
        &sql,
        &[
            database.to_string(),
            routine_name.to_string(),
            routine_type.to_string(),
        ],
    );
    let rows = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(database)
        .bind(routine_name)
        .bind(routine_type)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to get routine parameters: {error}"))?;
    query_log::log_mysql_rows(&rows);

    let mut params = Vec::with_capacity(rows.len());
    for row in &rows {
        params.push(RoutineParameterRow {
            name: decode_mysql_optional_text_cell(row, 0)?.unwrap_or_default(),
            data_type: decode_mysql_text_cell(row, 1)?,
            mode: decode_mysql_optional_text_cell(row, 2)?.unwrap_or_default(),
            ordinal_position: row.try_get::<i64, _>(3).unwrap_or(0) as i32,
        });
    }
    Ok(params)
}

#[cfg(not(coverage))]
pub async fn query_routine_parameters(
    pool: &MySqlPool,
    routine: RoutineRef<'_>,
) -> Result<Vec<RoutineParameterRow>, String> {
    query_routine_parameters_inner(pool, routine, false).await
}

#[cfg(not(coverage))]
pub async fn query_routine_parameters_with_return_type(
    pool: &MySqlPool,
    routine: RoutineRef<'_>,
) -> Result<Vec<RoutineParameterRow>, String> {
    query_routine_parameters_inner(pool, routine, true).await
}

#[cfg(not(coverage))]
pub async fn query_routine_exists(
    pool: &MySqlPool,
    routine: RoutineRef<'_>,
) -> Result<bool, String> {
    let RoutineRef {
        database,
        routine_name,
        routine_type,
    } = routine;
    let sql = "SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES \
               WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ? AND ROUTINE_TYPE = ?";
    query_log::log_outgoing_sql_bound(
        sql,
        &[
            database.to_string(),
            routine_name.to_string(),
            routine_type.to_string(),
        ],
    );
    let row = sqlx::query(sql)
        .bind(database)
        .bind(routine_name)
        .bind(routine_type)
        .fetch_one(pool)
        .await
        .map_err(|error| format!("Failed to check routine existence: {error}"))?;
    query_log::log_mysql_rows(std::slice::from_ref(&row));
    let count: i64 = row.try_get(0).unwrap_or(0);
    Ok(count > 0)
}
