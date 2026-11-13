use super::*;

pub(super) fn build_create_table_options(properties: &DesignerTableProperties) -> Vec<String> {
    let mut options = Vec::new();

    let has_engine = !properties.engine.is_empty();
    if has_engine {
        options.push(format!("ENGINE={}", properties.engine));
    }
    let has_charset = !properties.charset.is_empty();
    if has_charset {
        options.push(format!("DEFAULT CHARSET={}", properties.charset));
    }
    let has_collation = !properties.collation.is_empty();
    if has_collation {
        options.push(format!("COLLATE={}", properties.collation));
    }
    if let Some(auto_increment) = properties.auto_increment {
        options.push(format!("AUTO_INCREMENT={auto_increment}"));
    }
    let has_row_format = !properties.row_format.is_empty();
    if has_row_format {
        options.push(format!("ROW_FORMAT={}", properties.row_format));
    }
    let has_comment = !properties.comment.is_empty();
    if has_comment {
        options.push(format!(
            "COMMENT='{}'",
            escape_sql_string(&properties.comment)
        ));
    }

    options
}

pub(super) fn collect_rename_warnings(current: &DesignerTableSchema) -> Vec<String> {
    current
        .columns
        .iter()
        .filter(|column| is_renamed_column(column))
        .map(|column| {
            format!(
                "Column '{}' was renamed to '{}'. Because MySQL rename-column syntax is not supported in this version, this will be executed as DROP COLUMN + ADD COLUMN. Existing data in this column will be permanently lost.",
                column.original_name, column.name
            )
        })
        .collect()
}

pub(super) fn column_requires_modify(
    original: &DesignerColumnDef,
    current: &DesignerColumnDef,
) -> bool {
    original.r#type != current.r#type
        || original.type_modifier != current.type_modifier
        || original.length != current.length
        || original.nullable != current.nullable
        || original.default_value != current.default_value
        || original.comment != current.comment
        || original.is_auto_increment != current.is_auto_increment
}

pub(super) fn primary_key_names(columns: &[DesignerColumnDef]) -> Vec<String> {
    columns
        .iter()
        .filter(|column| column.is_primary_key)
        .map(|column| column.name.clone())
        .collect()
}

pub(super) fn indexes_equal(left: &DesignerIndexDef, right: &DesignerIndexDef) -> bool {
    normalize_index_type(&left.index_type) == normalize_index_type(&right.index_type)
        && left.columns == right.columns
}

pub(super) fn foreign_keys_equal(
    left: &DesignerForeignKeyDef,
    right: &DesignerForeignKeyDef,
) -> bool {
    left.source_column == right.source_column
        && left.referenced_database == right.referenced_database
        && left.referenced_table == right.referenced_table
        && left.referenced_column == right.referenced_column
        && left.on_delete == right.on_delete
        && left.on_update == right.on_update
}

pub(super) fn diff_drop_indexes(
    original: &DesignerTableSchema,
    current: &DesignerTableSchema,
) -> Vec<String> {
    let mut clauses = Vec::new();

    let original_primary = primary_key_names(&original.columns);
    let current_primary = primary_key_names(&current.columns);
    let drops_primary_key = original_primary != current_primary && !original_primary.is_empty();
    if drops_primary_key {
        clauses.push("DROP PRIMARY KEY".to_string());
    }

    let current_indexes = current
        .indexes
        .iter()
        .filter(|index| is_generatable_index(index))
        .filter(|index| is_secondary_index(index))
        .map(|index| (index.name.as_str(), index))
        .collect::<HashMap<_, _>>();

    for index in original
        .indexes
        .iter()
        .filter(|index| is_generatable_index(index))
        .filter(|index| is_secondary_index(index))
    {
        match current_indexes.get(index.name.as_str()) {
            Some(current_index) if indexes_equal(index, current_index) => {}
            _ => clauses.push(format!("DROP INDEX {}", quote_identifier(&index.name))),
        }
    }

    clauses
}

pub(super) fn diff_add_indexes(
    original: &DesignerTableSchema,
    current: &DesignerTableSchema,
) -> Vec<String> {
    let mut clauses = Vec::new();

    let original_primary = primary_key_names(&original.columns);
    let current_primary = primary_key_names(&current.columns);
    let adds_primary_key = original_primary != current_primary && !current_primary.is_empty();
    if adds_primary_key {
        clauses.push(format!(
            "ADD PRIMARY KEY ({})",
            quoted_identifiers(&current_primary).join(", ")
        ));
    }

    let original_indexes = original
        .indexes
        .iter()
        .filter(|index| is_generatable_index(index))
        .filter(|index| is_secondary_index(index))
        .map(|index| (index.name.as_str(), index))
        .collect::<HashMap<_, _>>();

    for index in current
        .indexes
        .iter()
        .filter(|index| is_generatable_index(index))
        .filter(|index| is_secondary_index(index))
    {
        let should_add = match original_indexes.get(index.name.as_str()) {
            Some(original_index) => !indexes_equal(original_index, index),
            None => true,
        };

        if !should_add {
            continue;
        }

        let columns = quoted_identifiers(&index.columns).join(", ");
        let normalized_type = normalize_index_type(&index.index_type);
        let clause = match normalized_type.as_str() {
            "UNIQUE" => format!(
                "ADD UNIQUE KEY {} ({})",
                quote_identifier(&index.name),
                columns
            ),
            "FULLTEXT" => {
                format!(
                    "ADD FULLTEXT KEY {} ({})",
                    quote_identifier(&index.name),
                    columns
                )
            }
            _ => format!("ADD INDEX {} ({})", quote_identifier(&index.name), columns),
        };

        clauses.push(clause);
    }

    clauses
}

pub(super) fn diff_drop_foreign_keys(
    original: &DesignerTableSchema,
    current: &DesignerTableSchema,
) -> Vec<String> {
    let current_foreign_keys = current
        .foreign_keys
        .iter()
        .filter(|foreign_key| is_generatable_foreign_key(foreign_key))
        .map(|foreign_key| (foreign_key.name.as_str(), foreign_key))
        .collect::<HashMap<_, _>>();

    original
        .foreign_keys
        .iter()
        .filter(|foreign_key| is_generatable_foreign_key(foreign_key))
        .filter_map(
            |foreign_key| match current_foreign_keys.get(foreign_key.name.as_str()) {
                Some(current_foreign_key)
                    if foreign_keys_equal(foreign_key, current_foreign_key) =>
                {
                    None
                }
                _ => Some(format!(
                    "DROP FOREIGN KEY {}",
                    quote_identifier(&foreign_key.name)
                )),
            },
        )
        .collect()
}

pub(super) fn diff_add_foreign_keys(
    original: &DesignerTableSchema,
    current: &DesignerTableSchema,
    database: &str,
) -> Vec<String> {
    let original_foreign_keys = original
        .foreign_keys
        .iter()
        .filter(|foreign_key| is_generatable_foreign_key(foreign_key))
        .map(|foreign_key| (foreign_key.name.as_str(), foreign_key))
        .collect::<HashMap<_, _>>();

    current
        .foreign_keys
        .iter()
        .filter(|foreign_key| is_generatable_foreign_key(foreign_key))
        .filter(
            |foreign_key| match original_foreign_keys.get(foreign_key.name.as_str()) {
                Some(original_foreign_key) => {
                    !foreign_keys_equal(original_foreign_key, foreign_key)
                }
                None => true,
            },
        )
        .map(|foreign_key| {
            format!(
                "ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({}) ON DELETE {} ON UPDATE {}",
                quote_identifier(&foreign_key.name),
                quote_identifier(&foreign_key.source_column),
                format_referenced_table_name(foreign_key, database),
                quote_identifier(&foreign_key.referenced_column),
                foreign_key.on_delete,
                foreign_key.on_update
            )
        })
        .collect()
}

pub(super) fn is_changed_to_non_empty(original: &str, current: &str) -> bool {
    original != current && !current.is_empty()
}

pub(super) fn diff_table_options(
    original: &DesignerTableProperties,
    current: &DesignerTableProperties,
) -> Vec<String> {
    let mut clauses = Vec::new();

    if is_changed_to_non_empty(&original.engine, &current.engine) {
        clauses.push(format!("ENGINE={}", current.engine));
    }
    if is_changed_to_non_empty(&original.charset, &current.charset) {
        clauses.push(format!("DEFAULT CHARSET={}", current.charset));
    }
    if is_changed_to_non_empty(&original.collation, &current.collation) {
        clauses.push(format!("COLLATE={}", current.collation));
    }
    if original.auto_increment != current.auto_increment {
        if let Some(auto_increment) = current.auto_increment {
            clauses.push(format!("AUTO_INCREMENT={auto_increment}"));
        }
    }
    if is_changed_to_non_empty(&original.row_format, &current.row_format) {
        clauses.push(format!("ROW_FORMAT={}", current.row_format));
    }
    if original.comment != current.comment {
        clauses.push(format!("COMMENT='{}'", escape_sql_string(&current.comment)));
    }

    clauses
}
