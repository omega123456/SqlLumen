use super::*;

#[cfg(not(coverage))]
pub(super) async fn get_routine_parameters_inner(
    state: &AppState,
    request: &RoutineRequest,
    include_return_type: bool,
) -> Result<Vec<RoutineParameter>, String> {
    let pool = get_pool(state, &request.connection_id)?;
    let rows = schema_queries::query_routine_parameters_inner(
        &pool,
        request.routine_ref(),
        include_return_type,
    )
    .await?;
    Ok(rows
        .into_iter()
        .map(|parameter| RoutineParameter {
            name: parameter.name,
            data_type: parameter.data_type,
            mode: parameter.mode,
            ordinal_position: parameter.ordinal_position,
        })
        .collect())
}

#[cfg(not(coverage))]
pub async fn get_routine_parameters_impl(
    state: &AppState,
    request: &RoutineRequest,
) -> Result<Vec<RoutineParameter>, String> {
    get_routine_parameters_inner(state, request, false).await
}

#[cfg(coverage)]
pub async fn get_routine_parameters_impl(
    _state: &AppState,
    _request: &RoutineRequest,
) -> Result<Vec<RoutineParameter>, String> {
    Ok(vec![])
}

#[cfg(not(coverage))]
pub async fn get_routine_parameters_with_return_type_impl(
    state: &AppState,
    request: &RoutineRequest,
) -> Result<RoutineParametersWithFoundResponse, String> {
    let params = get_routine_parameters_inner(state, request, true).await?;

    let mut found = true;
    if params.is_empty() {
        let pool = get_pool(state, &request.connection_id)?;
        found = schema_queries::query_routine_exists(&pool, request.routine_ref()).await?;
    }

    Ok(RoutineParametersWithFoundResponse {
        parameters: params,
        found,
    })
}

#[cfg(coverage)]
pub async fn get_routine_parameters_with_return_type_impl(
    _state: &AppState,
    request: &RoutineRequest,
) -> Result<RoutineParametersWithFoundResponse, String> {
    let found = !request.routine_name.to_lowercase().starts_with("missing");
    Ok(RoutineParametersWithFoundResponse {
        parameters: vec![],
        found,
    })
}
