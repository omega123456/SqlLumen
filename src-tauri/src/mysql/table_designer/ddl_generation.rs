use super::*;

pub(super) fn create_index_clause(index: &DesignerIndexDef) -> Option<String> {
    let keyword = match normalize_index_type(&index.index_type).as_str() {
        "UNIQUE" => "UNIQUE KEY",
        "INDEX" => "INDEX",
        "FULLTEXT" => "FULLTEXT KEY",
        _ => return None,
    };
    Some(format!(
        "  {keyword} {} ({})",
        quote_identifier(&index.name),
        quoted_identifiers(&index.columns).join(", ")
    ))
}

pub(super) fn create_foreign_key_clause(
    foreign_key: &DesignerForeignKeyDef,
    database: &str,
) -> String {
    format!(
        "  CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({}) ON DELETE {} ON UPDATE {}",
        quote_identifier(&foreign_key.name),
        quote_identifier(&foreign_key.source_column),
        format_referenced_table_name(foreign_key, database),
        quote_identifier(&foreign_key.referenced_column),
        foreign_key.on_delete,
        foreign_key.on_update
    )
}

pub(super) fn create_table_definitions(
    schema: &DesignerTableSchema,
    database: &str,
) -> Vec<String> {
    let mut definitions: Vec<String> = schema
        .columns
        .iter()
        .map(|column| format!("  {}", format_column_definition(column, &column.name)))
        .collect();

    let primary_key_columns = primary_key_columns(&schema.columns);
    if !primary_key_columns.is_empty() {
        definitions.push(format!(
            "  PRIMARY KEY ({})",
            primary_key_columns.join(", ")
        ));
    }

    let index_clauses = schema
        .indexes
        .iter()
        .filter(|index| is_generatable_index(index))
        .filter_map(create_index_clause);
    definitions.extend(index_clauses);

    let foreign_key_clauses = schema
        .foreign_keys
        .iter()
        .filter(|foreign_key| is_generatable_foreign_key(foreign_key))
        .map(|foreign_key| create_foreign_key_clause(foreign_key, database));
    definitions.extend(foreign_key_clauses);
    definitions
}

pub(super) fn is_generatable_target(schema: &DesignerTableSchema, database: &str) -> bool {
    validate_schema(schema).is_ok()
        && validate_identifier(database, "Database name").is_ok()
        && !is_blank_identifier(&schema.table_name)
}

pub fn generate_create_table_ddl(schema: &DesignerTableSchema, database: &str) -> String {
    if !is_generatable_target(schema, database) {
        return String::new();
    }

    let table_name = quote_identifier(&schema.table_name);
    let database_name = quote_identifier(database);
    let definitions = create_table_definitions(schema, database);
    let table_options = build_create_table_options(&schema.properties);

    if table_options.is_empty() {
        return format!(
            "CREATE TABLE {}.{} (\n{}\n);",
            database_name,
            table_name,
            definitions.join(",\n")
        );
    }
    format!(
        "CREATE TABLE {}.{} (\n{}\n) {};",
        database_name,
        table_name,
        definitions.join(",\n"),
        table_options.join(" ")
    )
}

pub(super) fn column_names(schema: &DesignerTableSchema) -> HashSet<&str> {
    schema
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect()
}

pub(super) fn drop_column_clauses(
    original: &DesignerTableSchema,
    current: &DesignerTableSchema,
) -> Vec<String> {
    let current_names = column_names(current);
    original
        .columns
        .iter()
        .filter(|column| !current_names.contains(column.name.as_str()))
        .map(|column| format!("DROP COLUMN {}", quote_identifier(&column.name)))
        .collect()
}

pub(super) fn modify_column_clauses(
    original: &DesignerTableSchema,
    current: &DesignerTableSchema,
) -> Vec<String> {
    let original_map: HashMap<&str, &DesignerColumnDef> = original
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect();
    current
        .columns
        .iter()
        .filter(|column| column.original_name == column.name)
        .filter(|column| {
            original_map
                .get(column.name.as_str())
                .is_some_and(|original_column| column_requires_modify(original_column, column))
        })
        .map(|column| {
            format!(
                "MODIFY COLUMN {}",
                format_column_definition(column, &column.name)
            )
        })
        .collect()
}

pub(super) fn add_column_clauses(
    original: &DesignerTableSchema,
    current: &DesignerTableSchema,
) -> Vec<String> {
    let original_names = column_names(original);
    current
        .columns
        .iter()
        .enumerate()
        .filter(|(_, column)| !original_names.contains(column.name.as_str()))
        .map(|(index, column)| {
            format!(
                "ADD COLUMN {}{}",
                format_column_definition(column, &column.name),
                column_position_clause(&current.columns, index)
            )
        })
        .collect()
}

pub(super) fn alter_table_clauses(
    original: &DesignerTableSchema,
    current: &DesignerTableSchema,
    database: &str,
) -> Vec<String> {
    let mut clauses = Vec::new();
    clauses.extend(diff_drop_foreign_keys(original, current));
    clauses.extend(diff_drop_indexes(original, current));
    clauses.extend(drop_column_clauses(original, current));
    clauses.extend(modify_column_clauses(original, current));
    clauses.extend(add_column_clauses(original, current));
    clauses.extend(diff_add_indexes(original, current));
    clauses.extend(diff_add_foreign_keys(original, current, database));
    clauses.extend(diff_table_options(
        &original.properties,
        &current.properties,
    ));
    clauses
}

pub fn generate_alter_table_ddl(
    original: &DesignerTableSchema,
    current: &DesignerTableSchema,
    database: &str,
) -> GenerateDdlResponse {
    let is_generatable =
        validate_schema(original).is_ok() && is_generatable_target(current, database);
    if !is_generatable {
        return GenerateDdlResponse::default();
    }

    let mut warnings = collect_rename_warnings(current);
    let clauses = alter_table_clauses(original, current, database);
    if clauses.is_empty() {
        warnings.shrink_to_fit();
        return GenerateDdlResponse {
            ddl: String::new(),
            warnings,
        };
    }

    let ddl = format!(
        "ALTER TABLE {}.{}\n  {};",
        quote_identifier(database),
        quote_identifier(&current.table_name),
        clauses.join(",\n  ")
    );

    GenerateDdlResponse { ddl, warnings }
}
