use super::*;

pub(super) const UNKNOWN_OBJECT_TYPE_KEYWORD: &str = "UNKNOWN";

pub(super) fn object_type_keyword_or_unknown(object_type: &str) -> &'static str {
    object_type_keyword(object_type).unwrap_or(UNKNOWN_OBJECT_TYPE_KEYWORD)
}

pub(super) fn drop_if_exists_history_sql(
    object_type: &str,
    database: &str,
    object_name: &str,
) -> String {
    let type_keyword = object_type_keyword_or_unknown(object_type);
    format!("DROP {type_keyword} IF EXISTS `{database}`.`{object_name}`")
}

pub(super) fn drop_object_history_sql(request: &SchemaObjectRequest) -> String {
    drop_if_exists_history_sql(
        &request.object_type,
        &request.database,
        &request.object_name,
    )
}

pub(super) fn show_create_history_sql(request: &SchemaObjectRequest) -> String {
    let type_upper = request.object_type.to_uppercase();
    let database = &request.database;
    let object_name = &request.object_name;
    format!("SHOW CREATE {type_upper} `{database}`.`{object_name}`")
}

pub async fn get_object_body_with_history(
    state: &AppState,
    request: &SchemaObjectRequest,
) -> Result<String, String> {
    let started_at = Instant::now();
    let result = get_object_body_impl(state, request).await;
    let row_count = single_row_count(result.is_ok());
    let record = HistoryRecord::for_outcome(show_create_history_sql(request), started_at, &result)
        .with_row_count(row_count);
    log_history_record(state, &request.connection_id, record);
    result
}

pub(super) struct SaveObjectHistory {
    pub(super) session_id: String,
    pub(super) body: String,
    pub(super) drop_sql: String,
}

impl SaveObjectHistory {
    pub(super) fn for_request(request: &SaveObjectRequest) -> Self {
        Self {
            session_id: request.connection_id.clone(),
            body: request.body.clone(),
            drop_sql: drop_if_exists_history_sql(
                &request.object_type,
                &request.database,
                &request.object_name,
            ),
        }
    }

    pub(super) fn records(
        self,
        started_at: Instant,
        result: &Result<SaveObjectResponse, String>,
    ) -> Vec<HistoryRecord> {
        let save_record = HistoryRecord::for_outcome(self.body, started_at, result);
        let Ok(response) = result else {
            return vec![save_record];
        };
        let save_record = save_record.with_error_message(response.error_message.clone());
        if !response.drop_succeeded {
            return vec![save_record];
        }
        let drop_record = save_record
            .for_statement(self.drop_sql)
            .with_error_message(None);
        vec![drop_record, save_record]
    }
}

pub async fn save_object_with_history(
    state: &AppState,
    request: SaveObjectRequest,
) -> Result<SaveObjectResponse, String> {
    let history = SaveObjectHistory::for_request(&request);
    let session_id = history.session_id.clone();
    let started_at = Instant::now();
    let result = save_object_impl(request, state).await;
    log_history_batch(state, &session_id, history.records(started_at, &result));
    result
}

pub async fn drop_object_with_history(
    state: &AppState,
    request: &SchemaObjectRequest,
) -> Result<(), String> {
    let statement = HistoryStatement {
        session_id: &request.connection_id,
        sql_text: drop_object_history_sql(request),
    };
    run_with_history(state, statement, drop_object_impl(state, request)).await
}
