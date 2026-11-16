use super::*;

pub async fn list_copyable_objects_impl(
    state: &AppState,
    request: &crate::commands::requests::DatabaseRequest,
) -> Result<CopyableObjects, String> {
    let connection_id = request.connection_id.as_str();
    let database = request.database.as_str();
    if is_system_schema(database) {
        return Err(format!(
            "Database '{database}' is a system schema and cannot be copied"
        ));
    }

    let pool = state
        .registry
        .get_pool(connection_id)
        .ok_or_else(|| format!("Connection '{connection_id}' not found in registry"))?;

    let schema = SchemaObjects {
        pool: &pool,
        database,
    };
    let tables = build_copyable_tables(&schema.decoded_tables().await?);
    let RoutineNames {
        procedures,
        functions,
    } = split_routines(&schema.decoded_routines().await?);
    let triggers = collect_names(&schema.decoded_names(TRIGGER_NAMES).await?);
    let events = collect_names(&schema.decoded_names(EVENT_NAMES).await?);

    Ok(CopyableObjects {
        tables,
        procedures,
        functions,
        triggers,
        events,
    })
}

pub(super) struct SchemaObjectQuery {
    pub(super) sql: &'static str,
    pub(super) label: &'static str,
    pub(super) name_column: &'static str,
}

pub(super) const TABLE_OBJECTS: SchemaObjectQuery = SchemaObjectQuery {
    sql: "\
        SELECT TABLE_NAME, TABLE_TYPE, CAST(TABLE_ROWS AS SIGNED) AS TABLE_ROWS \
        FROM information_schema.TABLES \
        WHERE TABLE_SCHEMA = ? \
          AND TABLE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
          AND TABLE_TYPE = 'BASE TABLE' \
        ORDER BY TABLE_NAME",
    label: "tables",
    name_column: "TABLE_NAME",
};

pub(super) const ROUTINE_OBJECTS: SchemaObjectQuery = SchemaObjectQuery {
    sql: "\
        SELECT ROUTINE_NAME, ROUTINE_TYPE \
        FROM information_schema.ROUTINES \
        WHERE ROUTINE_SCHEMA = ? \
          AND ROUTINE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
        ORDER BY ROUTINE_NAME",
    label: "routines",
    name_column: "ROUTINE_NAME",
};

pub(super) const TRIGGER_NAMES: SchemaObjectQuery = SchemaObjectQuery {
    sql: "\
        SELECT TRIGGER_NAME \
        FROM information_schema.TRIGGERS \
        WHERE TRIGGER_SCHEMA = ? \
          AND TRIGGER_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
        ORDER BY TRIGGER_NAME",
    label: "triggers",
    name_column: "TRIGGER_NAME",
};

pub(super) const EVENT_NAMES: SchemaObjectQuery = SchemaObjectQuery {
    sql: "\
        SELECT EVENT_NAME \
        FROM information_schema.EVENTS \
        WHERE EVENT_SCHEMA = ? \
          AND EVENT_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
        ORDER BY EVENT_NAME",
    label: "events",
    name_column: "EVENT_NAME",
};

pub(super) struct SchemaObjects<'a> {
    pub(super) pool: &'a BackgroundPool,
    pub(super) database: &'a str,
}

impl SchemaObjects<'_> {
    pub(super) async fn fetch_rows(
        &self,
        query: &SchemaObjectQuery,
    ) -> Result<Vec<DecodedRow>, String> {
        let statement = LoggedStatement::bound(query.sql, vec![self.database.into()]);
        fetch_decoded_pooled(self.pool, statement)
            .await
            .map_err(|error| format!("Failed to list {}: {error}", query.label))
    }

    pub(super) async fn decoded_tables(&self) -> Result<Vec<(String, String, i64)>, String> {
        let rows = self.fetch_rows(&TABLE_OBJECTS).await?;
        let decoded = rows
            .iter()
            .map(|row| {
                let name = row
                    .required_text(TABLE_OBJECTS.name_column)
                    .unwrap_or_default();
                let table_type = row.required_text("TABLE_TYPE").unwrap_or_default();
                let estimated_rows = row.signed("TABLE_ROWS").unwrap_or(0);
                (name, table_type, estimated_rows)
            })
            .collect();
        Ok(decoded)
    }

    pub(super) async fn decoded_routines(&self) -> Result<Vec<(String, String)>, String> {
        let rows = self.fetch_rows(&ROUTINE_OBJECTS).await?;
        let decoded = rows
            .iter()
            .map(|row| {
                let name = row
                    .required_text(ROUTINE_OBJECTS.name_column)
                    .unwrap_or_default();
                let routine_type = row.required_text("ROUTINE_TYPE").unwrap_or_default();
                (name, routine_type)
            })
            .collect();
        Ok(decoded)
    }

    pub(super) async fn decoded_names(
        &self,
        query: SchemaObjectQuery,
    ) -> Result<Vec<String>, String> {
        let rows = self.fetch_rows(&query).await?;
        let decoded = rows
            .iter()
            .map(|row| row.required_text(query.name_column).unwrap_or_default())
            .collect();
        Ok(decoded)
    }
}
