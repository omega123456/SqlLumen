use super::*;

/// Generate, transform, and apply the DDL for a single object to the target.
///
/// All target writes go through the pinned connection.
pub(super) async fn copy_object_structure(
    run: &CopyRun<'_>,
    target: &mut MySqlConnection,
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
    let mut ddl = query_ddl(run.source, source_object).await?;
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
        // Validate the identifier (length/shape) before interpolating it,
        // matching the source-side SELECT / `ensure_target_database` path.
        // `safe_identifier` returns the name wrapped in backticks with inner
        // backticks doubled; `drop_if_exists_statement` re-wraps an already
        // doubled-but-unwrapped name, so feed it the manually escaped form
        // after the validation has run.
        safe_identifier(name)?;
        let escaped = name.replace('`', "``");
        safe_identifier(target_database)?;
        let drop = qualified_drop_if_exists_statement(object_type, target_database, &escaped);
        run_target_statement(&mut *target, &drop).await?;
    }

    let ddl = ddl.trim_end().trim_end_matches(';');
    let ddl = match object_type {
        CopyObjectType::Table => qualify_table_ddl_schema(ddl, target_database, name),
        _ => ddl.to_string(),
    };
    run_target_statement(&mut *target, &ddl).await
}

/// Count the exact number of rows to copy from the source table so progress
/// can report `rowsDone / rowsTotal` for the active table.
pub async fn count_source_rows(
    source: &MySqlPool,
    source_database: &str,
    table: &str,
) -> Result<u64, String> {
    let safe_db = safe_identifier(source_database)?;
    let safe_table = safe_identifier(table)?;
    let sql = format!("SELECT COUNT(*) AS row_count FROM {safe_db}.{safe_table}");
    query_log::log_outgoing_sql(&sql);
    let row = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
        .fetch_one(source)
        .await
        .map_err(|error| {
            query_log::log_execute_error(&error);
            format!("Failed to count rows in '{table}': {error}")
        })?;
    query_log::log_mysql_row(&row);

    let row_count = row
        .try_get::<i64, _>("row_count")
        .map_err(|error| format!("Failed to decode row count for '{table}': {error}"))?;
    Ok(row_count.max(0) as u64)
}

pub(super) async fn truncate_target_table(
    run: &CopyRun<'_>,
    target: &mut MySqlConnection,
    table: &str,
) -> Result<(), String> {
    // Validate the target identifier the same way as the source-side
    // SELECT instead of interpolating a raw, unvalidated name.
    let safe_target_table = safe_identifier(table)?;
    let safe_target_db = safe_identifier(&run.params.target_database)?;
    run_target_statement(
        &mut *target,
        &format!("TRUNCATE TABLE {safe_target_db}.{safe_target_table}"),
    )
    .await
}

pub(super) fn serialize_row_values(row: &sqlx::mysql::MySqlRow) -> Vec<SqlDumpValue> {
    (0..row.columns().len())
        .map(|column_index| crate::commands::sql_dump::serialize_dump_value(row, column_index))
        .collect()
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
    pub(super) fn insert_prefix(&self, row: &sqlx::mysql::MySqlRow) -> Result<String, String> {
        let col_list = row
            .columns()
            .iter()
            .map(|column| format!("`{}`", column.name().replace('`', "``")))
            .collect::<Vec<_>>()
            .join(", ");
        // Validate the target table identifier (length/shape) on the
        // write path too, matching the source-side SELECT.
        let safe_target_table = safe_identifier(self.table)?;
        let safe_target_db = safe_identifier(&self.run.params.target_database)?;
        Ok(format!(
            "{} {} ({}) VALUES ",
            self.run.params.options.insert_mode.keyword(),
            format_args!("{safe_target_db}.{safe_target_table}"),
            col_list
        ))
    }

    pub(super) fn ensure_prefix(&mut self, row: &sqlx::mysql::MySqlRow) -> Result<(), String> {
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

    pub(super) async fn flush(&mut self, target: &mut MySqlConnection) -> Result<(), String> {
        let insert = PendingInsert {
            prefix: self.prefix_text(),
            rows: &self.batch,
            rows_done: self.rows_done,
        };
        self.rows_done = flush_batch(&mut *target, &insert, self.run.job).await?;
        self.batch.clear();
        self.byte_count = self.prefix_text().len();
        Ok(())
    }

    pub(super) async fn append_row(
        &mut self,
        target: &mut MySqlConnection,
        row: &sqlx::mysql::MySqlRow,
    ) -> Result<(), String> {
        self.ensure_prefix(row)?;
        let rendered = render_row(&serialize_row_values(row));
        let fill = BatchFill {
            row_count: self.batch.len(),
            byte_count: self.byte_count,
        };
        if should_start_new_batch(fill, rendered.byte_len, self.limits) {
            self.flush(&mut *target).await?;
        }
        self.byte_count += tuple_separator_len(self.batch.len()) + rendered.byte_len;
        self.batch.push(rendered);
        Ok(())
    }

    pub(super) async fn flush_remaining(
        &mut self,
        target: &mut MySqlConnection,
    ) -> Result<(), String> {
        if self.batch.is_empty() {
            return Ok(());
        }
        self.flush(target).await
    }
}

/// Copy a single table's data as adaptive byte-budgeted multi-row INSERTs.
///
/// Streams source rows one at a time (never loading the whole table into
/// RAM), accumulating rendered value-tuples into a batch and flushing the
/// batch — to the pinned target connection — once the row cap or byte budget
/// is reached. Updates `progress.rows_done` after each flushed batch and
/// honors cancellation at batch boundaries. Returns `Ok(true)` if completed,
/// `Ok(false)` if cancelled mid-way.
pub(super) async fn copy_table_data(
    run: &CopyRun<'_>,
    target: &mut MySqlConnection,
    table: &str,
) -> Result<bool, String> {
    if run.params.options.truncate_before_insert {
        truncate_target_table(run, &mut *target, table).await?;
    }

    // Stream rows from the source (never `fetch_all` — large tables would
    // otherwise be loaded into RAM in full).
    let safe_db = safe_identifier(&run.params.source_database)?;
    let safe_table = safe_identifier(table)?;
    let select_sql = format!("SELECT * FROM {safe_db}.{safe_table}");
    query_log::log_outgoing_sql(&select_sql);
    let mut stream = sqlx::query(sqlx::AssertSqlSafe(select_sql.as_str())).fetch(run.source);

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
        let next = stream.next().await.transpose().map_err(|error| {
            query_log::log_execute_error(&error);
            format!("Failed to read data from '{table}': {error}")
        })?;
        let Some(row) = next else {
            break;
        };
        batch.append_row(&mut *target, &row).await?;
    }
    batch.flush_remaining(&mut *target).await?;
    Ok(true)
}

/// Render and execute one INSERT batch against the pinned target connection,
/// then bump `progress.rows_done`. Returns the updated running row count.
pub(super) async fn flush_batch(
    target: &mut MySqlConnection,
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
    run_target_statement(&mut *target, &stmt).await?;

    let new_rows_done = insert.rows_done + insert.rows.len() as u64;
    job.record_rows_done(new_rows_done);
    Ok(new_rows_done)
}
