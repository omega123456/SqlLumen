use super::*;

pub fn parse_column_type(column_type: &str) -> ParsedColumnType {
    let trimmed = column_type.trim();

    match (trimmed.find('('), trimmed.rfind(')')) {
        (Some(open), Some(close)) if close > open => ParsedColumnType {
            base_type: trimmed[..open].trim().to_ascii_uppercase(),
            length: trimmed[(open + 1)..close].trim().to_string(),
            type_modifier: trimmed[(close + 1)..].trim().to_ascii_uppercase(),
        },
        _ => {
            let parts = trimmed
                .split_whitespace()
                .map(|part| part.to_ascii_uppercase())
                .collect::<Vec<_>>();

            let modifier_start = parts
                .iter()
                .position(|part| matches!(part.as_str(), "UNSIGNED" | "ZEROFILL" | "BINARY"));

            match modifier_start {
                Some(index) if index > 0 => ParsedColumnType::without_length(
                    parts[..index].join(" "),
                    parts[index..].join(" "),
                ),
                _ => ParsedColumnType::without_length(trimmed.to_ascii_uppercase(), String::new()),
            }
        }
    }
}

#[cfg(not(coverage))]
pub(super) fn is_current_temporal_default(value: &str) -> bool {
    value.eq_ignore_ascii_case("CURRENT_TIMESTAMP")
        || value.to_ascii_uppercase().starts_with("CURRENT_TIMESTAMP(")
        || value.eq_ignore_ascii_case("CURRENT_DATE")
        || value.eq_ignore_ascii_case("CURRENT_TIME")
}

#[cfg(not(coverage))]
pub(super) fn parse_default_value(default_value: Option<String>) -> DefaultValueModel {
    match default_value {
        None => DefaultValueModel::NoDefault,
        Some(value) if value.eq_ignore_ascii_case("NULL") => {
            DefaultValueModel::Expression { value }
        }
        Some(value) if is_current_temporal_default(&value) => {
            DefaultValueModel::Expression { value }
        }
        Some(value) => DefaultValueModel::Literal { value },
    }
}

#[cfg(not(coverage))]
pub(super) fn normalize_default_value(
    extra: Option<&str>,
    default_value: Option<String>,
) -> DefaultValueModel {
    let extra_text = extra.unwrap_or_default().to_ascii_lowercase();
    match default_value {
        Some(value) if extra_text.contains("default_generated") => {
            DefaultValueModel::Expression { value }
        }
        Some(value) if value.eq_ignore_ascii_case("NULL") => DefaultValueModel::NullDefault,
        other => parse_default_value(other),
    }
}

#[cfg(not(coverage))]
pub(super) fn decode_text_cell_named(row: &DecodedRow, column: &str) -> Result<String, String> {
    row.required_text(column)
}

#[cfg(not(coverage))]
pub(super) fn decode_optional_text_cell_named(
    row: &DecodedRow,
    column: &str,
) -> Result<Option<String>, String> {
    row.optional_text(column)
}

#[cfg(not(coverage))]
pub(super) fn build_index_type(index_name: &str, non_unique: i64, index_type: &str) -> String {
    if index_name == "PRIMARY" {
        return "PRIMARY".to_string();
    }
    if non_unique == 0 {
        return "UNIQUE".to_string();
    }
    if index_type.eq_ignore_ascii_case("FULLTEXT") {
        return "FULLTEXT".to_string();
    }
    "INDEX".to_string()
}

#[cfg(not(coverage))]
pub(super) struct IndexRowGroup {
    pub(super) name: String,
    pub(super) non_unique: i64,
    pub(super) index_type: String,
    pub(super) columns: Vec<String>,
}

#[cfg(not(coverage))]
pub(super) fn designer_index_from_group(group: IndexRowGroup) -> DesignerIndexDef {
    DesignerIndexDef {
        index_type: build_index_type(&group.name, group.non_unique, &group.index_type),
        name: group.name,
        columns: group.columns,
    }
}

#[cfg(not(coverage))]
pub(super) fn charset_for_collation(collation: &str) -> String {
    if collation.is_empty() {
        return String::new();
    }
    table_designer::derive_charset_from_collation(collation)
}

#[cfg(not(coverage))]
pub(super) struct DesignerTableLookup<'a> {
    pub(super) pool: &'a BackgroundPool,
    pub(super) database: &'a str,
    pub(super) table_name: &'a str,
}

#[cfg(not(coverage))]
impl DesignerTableLookup<'_> {
    fn statement<'a>(&self, sql: &'a str) -> LoggedStatement<'a> {
        LoggedStatement::bound(sql, vec![self.database.into(), self.table_name.into()])
    }

    pub(super) async fn fetch_all(&self, sql: &'static str) -> Result<Vec<DecodedRow>, String> {
        fetch_decoded_pooled(self.pool, self.statement(sql))
            .await
            .map_err(|error| error.to_string())
    }

    pub(super) async fn fetch_metadata_row(&self) -> Result<DecodedRow, String> {
        let metadata_sql = table_designer::load_table_metadata_query();
        let database = self.database;
        let table_name = self.table_name;
        fetch_first_decoded_pooled(self.pool, self.statement(metadata_sql))
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("Table '{database}.{table_name}' was not found"))
    }
}

#[cfg(not(coverage))]
pub(super) fn is_auto_increment_extra(extra: Option<&str>) -> bool {
    extra
        .unwrap_or_default()
        .to_ascii_lowercase()
        .contains("auto_increment")
}

#[cfg(not(coverage))]
pub(super) fn designer_column_from_row(row: &DecodedRow) -> Result<DesignerColumnDef, String> {
    let name = decode_text_cell_named(row, "COLUMN_NAME")?;
    let column_type = decode_text_cell_named(row, "COLUMN_TYPE")?;
    let is_nullable = decode_text_cell_named(row, "IS_NULLABLE")?;
    let column_key = decode_text_cell_named(row, "COLUMN_KEY")?;
    let column_default = decode_optional_text_cell_named(row, "COLUMN_DEFAULT")?;
    let extra = decode_optional_text_cell_named(row, "EXTRA")?;
    let comment = decode_optional_text_cell_named(row, "COLUMN_COMMENT")?;
    let ParsedColumnType {
        base_type,
        length,
        type_modifier,
    } = parse_column_type(&column_type);

    Ok(DesignerColumnDef {
        original_name: name.clone(),
        name,
        r#type: base_type,
        type_modifier,
        length,
        nullable: is_nullable.eq_ignore_ascii_case("YES"),
        is_primary_key: column_key.eq_ignore_ascii_case("PRI"),
        is_auto_increment: is_auto_increment_extra(extra.as_deref()),
        default_value: normalize_default_value(extra.as_deref(), column_default),
        comment: comment.unwrap_or_default(),
    })
}

#[cfg(not(coverage))]
pub(super) fn index_row_group(row: &DecodedRow) -> Result<IndexRowGroup, String> {
    Ok(IndexRowGroup {
        name: decode_text_cell_named(row, "INDEX_NAME")?,
        non_unique: row.signed("NON_UNIQUE")?,
        index_type: decode_text_cell_named(row, "INDEX_TYPE")?,
        columns: vec![decode_text_cell_named(row, "COLUMN_NAME")?],
    })
}

#[cfg(not(coverage))]
pub(super) fn append_index_row(groups: &mut Vec<IndexRowGroup>, row_group: IndexRowGroup) {
    match groups.last_mut() {
        Some(last) if last.name == row_group.name => last.columns.extend(row_group.columns),
        _ => groups.push(row_group),
    }
}

#[cfg(not(coverage))]
pub(super) fn designer_indexes_from_rows(
    rows: &[DecodedRow],
) -> Result<Vec<DesignerIndexDef>, String> {
    let mut groups: Vec<IndexRowGroup> = Vec::new();
    for row in rows {
        append_index_row(&mut groups, index_row_group(row)?);
    }
    Ok(groups.into_iter().map(designer_index_from_group).collect())
}

#[cfg(not(coverage))]
pub(super) fn foreign_key_from_row(row: &DecodedRow) -> Result<DesignerForeignKeyDef, String> {
    Ok(DesignerForeignKeyDef {
        name: decode_text_cell_named(row, "CONSTRAINT_NAME")?,
        source_column: decode_text_cell_named(row, "COLUMN_NAME")?,
        referenced_database: decode_text_cell_named(row, "REFERENCED_TABLE_SCHEMA")?,
        referenced_table: decode_text_cell_named(row, "REFERENCED_TABLE_NAME")?,
        referenced_column: decode_text_cell_named(row, "REFERENCED_COLUMN_NAME")?,
        on_delete: decode_text_cell_named(row, "DELETE_RULE")?,
        on_update: decode_text_cell_named(row, "UPDATE_RULE")?,
        is_composite: false,
    })
}

#[cfg(not(coverage))]
pub(super) fn append_foreign_key_row(
    foreign_keys: &mut Vec<DesignerForeignKeyDef>,
    foreign_key: DesignerForeignKeyDef,
) {
    match foreign_keys.last_mut() {
        Some(last) if last.name == foreign_key.name => last.is_composite = true,
        _ => foreign_keys.push(foreign_key),
    }
}

#[cfg(not(coverage))]
pub(super) fn designer_foreign_keys_from_rows(
    rows: &[DecodedRow],
) -> Result<Vec<DesignerForeignKeyDef>, String> {
    let mut foreign_keys = Vec::new();
    for row in rows {
        append_foreign_key_row(&mut foreign_keys, foreign_key_from_row(row)?);
    }
    Ok(foreign_keys)
}

#[cfg(not(coverage))]
pub(super) fn decode_auto_increment(row: &DecodedRow) -> Result<Option<u64>, String> {
    row.optional_unsigned("AUTO_INCREMENT")
}

#[cfg(not(coverage))]
pub(super) fn optional_text_or_empty(row: &DecodedRow, column: &str) -> Result<String, String> {
    Ok(decode_optional_text_cell_named(row, column)?.unwrap_or_default())
}

#[cfg(not(coverage))]
pub(super) fn table_properties_from_row(
    row: &DecodedRow,
) -> Result<DesignerTableProperties, String> {
    let collation = optional_text_or_empty(row, "TABLE_COLLATION")?;
    Ok(DesignerTableProperties {
        engine: optional_text_or_empty(row, "ENGINE")?,
        charset: charset_for_collation(&collation),
        collation,
        auto_increment: decode_auto_increment(row)?,
        row_format: optional_text_or_empty(row, "ROW_FORMAT")?,
        comment: optional_text_or_empty(row, "TABLE_COMMENT")?,
    })
}
