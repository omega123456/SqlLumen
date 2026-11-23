#[cfg(not(coverage))]
use crate::mysql::logged_query::{
    LoggedStatement, fetch_decoded_pooled, fetch_first_decoded_pooled,
};
#[cfg(not(coverage))]
use crate::mysql::pool::BackgroundPool;

#[cfg(not(coverage))]
use super::RoutineRef;

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
    pool: &BackgroundPool,
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
    let rows = fetch_decoded_pooled(
        pool,
        LoggedStatement::bound(
            &sql,
            vec![database.into(), routine_name.into(), routine_type.into()],
        ),
    )
    .await
    .map_err(|error| format!("Failed to get routine parameters: {error}"))?;

    let mut params = Vec::with_capacity(rows.len());
    for row in &rows {
        params.push(RoutineParameterRow {
            name: row.optional_text(0)?.unwrap_or_default(),
            data_type: row.required_text(1)?,
            mode: row.optional_text(2)?.unwrap_or_default(),
            ordinal_position: row.signed(3).unwrap_or(0) as i32,
        });
    }
    Ok(params)
}

#[cfg(not(coverage))]
pub async fn query_routine_parameters(
    pool: &BackgroundPool,
    routine: RoutineRef<'_>,
) -> Result<Vec<RoutineParameterRow>, String> {
    query_routine_parameters_inner(pool, routine, false).await
}

#[cfg(not(coverage))]
pub async fn query_routine_parameters_with_return_type(
    pool: &BackgroundPool,
    routine: RoutineRef<'_>,
) -> Result<Vec<RoutineParameterRow>, String> {
    query_routine_parameters_inner(pool, routine, true).await
}

#[cfg(not(coverage))]
pub async fn query_routine_exists(
    pool: &BackgroundPool,
    routine: RoutineRef<'_>,
) -> Result<bool, String> {
    let RoutineRef {
        database,
        routine_name,
        routine_type,
    } = routine;
    let sql = "SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES \
               WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ? AND ROUTINE_TYPE = ?";
    let first_row = fetch_first_decoded_pooled(
        pool,
        LoggedStatement::bound(
            sql,
            vec![database.into(), routine_name.into(), routine_type.into()],
        ),
    )
    .await
    .map_err(|error| format!("Failed to check routine existence: {error}"))?;
    let count = first_row.map(|row| row.signed(0).unwrap_or(0)).unwrap_or(0);
    Ok(count > 0)
}
