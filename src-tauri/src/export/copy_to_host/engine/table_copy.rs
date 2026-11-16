use super::*;

pub(super) async fn copy_object_structure(
    run: &CopyRun<'_>,
    connections: &mut CopyConnections<'_>,
    object: CopyObject<'_>,
) -> Result<(), String> {
    let CopyObject { object_type, name } = object;
    let options = &run.params.options;
    let target_database = run.params.target_database.as_str();
    let source_object = crate::mysql::schema_queries::SchemaObjectRef {
        database: &run.params.source_database,
        object_name: name,
        object_type: object_type.ddl_type_str(),
    };
    let mut ddl = query_ddl_on_connection(connections.source, source_object).await?;
    if ddl.trim().is_empty() {
        return Err(format!(
            "Empty DDL for {} '{name}' (insufficient privileges?)",
            object_type.label()
        ));
    }

    let should_strip_definer = options.ignore_definer && object_type.supports_definer();
    if should_strip_definer {
        ddl = strip_definer(&ddl);
    }
    if options.create_if_not_exists {
        ddl = apply_create_if_not_exists(object_type, &ddl);
    }
    let target_object = TargetObject {
        object_type,
        target_database,
        object_name: name,
    };
    ddl = rewrite_non_table_ddl_schema(&ddl, target_object);

    if options.drop_if_exists {
        safe_identifier(name)?;
        let escaped = name.replace('`', "``");
        safe_identifier(target_database)?;
        let drop = qualified_drop_if_exists_statement(object_type, target_database, &escaped);
        run_target_statement(connections.target, &drop).await?;
    }

    let ddl = ddl.trim_end().trim_end_matches(';');
    let ddl = match object_type {
        CopyObjectType::Table => qualify_table_ddl_schema(ddl, target_database, name),
        _ => ddl.to_string(),
    };
    run_target_statement(connections.target, &ddl).await
}

#[derive(Clone, Copy)]
pub struct SourceTable<'a> {
    pub database: &'a str,
    pub table: &'a str,
}

pub async fn count_source_rows(
    source: &mut Conn,
    source_table: SourceTable<'_>,
) -> Result<u64, String> {
    let table = source_table.table;
    let safe_db = safe_identifier(source_table.database)?;
    let safe_table = safe_identifier(table)?;
    let sql = format!("SELECT COUNT(*) AS row_count FROM {safe_db}.{safe_table}");
    let row = fetch_first_decoded(source, LoggedStatement::text(&sql))
        .await
        .map_err(|error| format!("Failed to count rows in '{table}': {error}"))?
        .ok_or_else(|| format!("Failed to count rows in '{table}': no row returned"))?;

    let row_count = row
        .signed("row_count")
        .map_err(|error| format!("Failed to decode row count for '{table}': {error}"))?;
    Ok(row_count.max(0) as u64)
}

pub(super) async fn truncate_target_table(
    run: &CopyRun<'_>,
    target: &mut Conn,
    table: &str,
) -> Result<(), String> {
    let safe_target_table = safe_identifier(table)?;
    let safe_target_db = safe_identifier(&run.params.target_database)?;
    run_target_statement(
        target,
        &format!("TRUNCATE TABLE {safe_target_db}.{safe_target_table}"),
    )
    .await
}

pub(super) fn serialize_row_values(row: &DecodedRow) -> Vec<SqlDumpValue> {
    crate::commands::sql_dump::serialize_dump_row(row)
}

pub(super) struct TableCopyBatch<'a> {
    pub(super) run: &'a CopyRun<'a>,
    pub(super) table: &'a str,
    pub(super) limits: BatchLimits,
    pub(super) prefix: Option<String>,
    pub(super) batch: Vec<RenderedRow>,
    pub(super) byte_count: usize,
    pub(super) rows_done: u64,
}

impl TableCopyBatch<'_> {
    pub(super) fn insert_prefix(&self, row: &DecodedRow) -> Result<String, String> {
        let col_list = row
            .columns()
            .iter()
            .map(|column| format!("`{}`", column.name_str().replace('`', "``")))
            .collect::<Vec<_>>()
            .join(", ");
        let safe_target_table = safe_identifier(self.table)?;
        let safe_target_db = safe_identifier(&self.run.params.target_database)?;
        Ok(format!(
            "{} {} ({}) VALUES ",
            self.run.params.options.insert_mode.keyword(),
            format_args!("{safe_target_db}.{safe_target_table}"),
            col_list
        ))
    }

    pub(super) fn ensure_prefix(&mut self, row: &DecodedRow) -> Result<(), String> {
        if self.prefix.is_some() {
            return Ok(());
        }
        let built = self.insert_prefix(row)?;
        self.byte_count = built.len();
        self.prefix = Some(built);
        Ok(())
    }

    pub(super) fn prefix_text(&self) -> &str {
        self.prefix.as_deref().unwrap_or("")
    }

    pub(super) async fn flush(&mut self, target: &mut Conn) -> Result<(), String> {
        let insert = PendingInsert {
            prefix: self.prefix_text(),
            rows: &self.batch,
            rows_done: self.rows_done,
        };
        self.rows_done = flush_batch(target, &insert, self.run.job).await?;
        self.batch.clear();
        self.byte_count = self.prefix_text().len();
        Ok(())
    }

    pub(super) async fn append_row(
        &mut self,
        target: &mut Conn,
        row: &DecodedRow,
    ) -> Result<(), String> {
        self.ensure_prefix(row)?;
        let rendered = render_row(&serialize_row_values(row));
        let fill = BatchFill {
            row_count: self.batch.len(),
            byte_count: self.byte_count,
        };
        if should_start_new_batch(fill, rendered.byte_len, self.limits) {
            self.flush(target).await?;
        }
        self.byte_count += tuple_separator_len(self.batch.len()) + rendered.byte_len;
        self.batch.push(rendered);
        Ok(())
    }

    pub(super) async fn flush_remaining(&mut self, target: &mut Conn) -> Result<(), String> {
        if self.batch.is_empty() {
            return Ok(());
        }
        self.flush(target).await
    }
}

pub(super) async fn copy_table_data(
    run: &CopyRun<'_>,
    connections: &mut CopyConnections<'_>,
    table: &str,
) -> Result<bool, String> {
    if run.params.options.truncate_before_insert {
        truncate_target_table(run, connections.target, table).await?;
    }

    let safe_db = safe_identifier(&run.params.source_database)?;
    let safe_table = safe_identifier(table)?;
    let select_sql = format!("SELECT * FROM {safe_db}.{safe_table}");
    let read_failure =
        |error: mysql_async::Error| format!("Failed to read data from '{table}': {error}");
    let mut rows = stream(connections.source, LoggedStatement::text(&select_sql))
        .await
        .map_err(read_failure)?;

    let mut batch = TableCopyBatch {
        run,
        table,
        limits: BatchLimits {
            byte_budget: run.byte_budget as usize,
            row_cap: COPY_BATCH_ROW_CAP.max(1),
        },
        prefix: None,
        batch: Vec::new(),
        byte_count: 0,
        rows_done: 0,
    };
    loop {
        if run.job.is_cancel_requested() {
            return Ok(false);
        }
        let next = rows.next_decoded().await.map_err(read_failure)?;
        let Some(row) = next else {
            break;
        };
        batch.append_row(connections.target, &row).await?;
    }
    rows.finish();
    batch.flush_remaining(connections.target).await?;
    Ok(true)
}

pub(super) async fn flush_batch(
    target: &mut Conn,
    insert: &PendingInsert<'_>,
    job: &CopyJob,
) -> Result<u64, String> {
    let mut stmt = String::with_capacity(insert.prefix.len() + insert.rows.len() * 32);
    stmt.push_str(insert.prefix);
    for (batch_index, row) in insert.rows.iter().enumerate() {
        if batch_index > 0 {
            stmt.push_str(", ");
        }
        stmt.push_str(&row.tuple);
    }
    run_target_statement(target, &stmt).await?;

    let new_rows_done = insert.rows_done + insert.rows.len() as u64;
    job.record_rows_done(new_rows_done);
    Ok(new_rows_done)
}
