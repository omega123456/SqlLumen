use super::*;

pub fn derive_charset_from_collation(collation: &str) -> String {
    collation.split('_').next().unwrap_or(collation).to_string()
}

pub(super) fn quote_identifier(name: &str) -> String {
    safe_identifier(name).unwrap_or_else(|error| panic!("Invalid identifier '{name}': {error}"))
}

pub(super) fn is_generatable_index(index: &DesignerIndexDef) -> bool {
    !is_blank_identifier(&index.name)
        && !index.columns.is_empty()
        && index
            .columns
            .iter()
            .all(|column| !is_blank_identifier(column))
}

pub(super) fn is_secondary_index(index: &DesignerIndexDef) -> bool {
    normalize_index_type(&index.index_type) != "PRIMARY"
}

pub(super) fn is_renamed_column(column: &DesignerColumnDef) -> bool {
    !column.original_name.is_empty() && column.original_name != column.name
}

pub(super) fn is_generatable_foreign_key(foreign_key: &DesignerForeignKeyDef) -> bool {
    !foreign_key.is_composite
        && !is_blank_identifier(&foreign_key.name)
        && !is_blank_identifier(&foreign_key.source_column)
        && !is_blank_identifier(&foreign_key.referenced_table)
        && !is_blank_identifier(&foreign_key.referenced_column)
}

pub(super) fn column_position_clause(columns: &[DesignerColumnDef], index: usize) -> String {
    if index == 0 {
        return " FIRST".to_string();
    }
    format!(" AFTER {}", quote_identifier(&columns[index - 1].name))
}

pub(super) fn referenced_database_name<'a>(
    foreign_key: &'a DesignerForeignKeyDef,
    database: &'a str,
) -> &'a str {
    if is_blank_identifier(&foreign_key.referenced_database) {
        return database;
    }
    &foreign_key.referenced_database
}

pub(super) fn format_referenced_table_name(
    foreign_key: &DesignerForeignKeyDef,
    database: &str,
) -> String {
    let referenced_database = referenced_database_name(foreign_key, database);

    format!(
        "{}.{}",
        quote_identifier(referenced_database),
        quote_identifier(&foreign_key.referenced_table)
    )
}

pub(super) fn escape_sql_string(value: &str) -> String {
    value.replace('\'', "''")
}

pub(super) fn quoted_identifiers(names: &[String]) -> Vec<String> {
    names.iter().map(|name| quote_identifier(name)).collect()
}

pub(super) fn normalize_index_type(index_type: &str) -> String {
    index_type.trim().to_ascii_uppercase()
}

pub(super) fn primary_key_columns(columns: &[DesignerColumnDef]) -> Vec<String> {
    columns
        .iter()
        .filter(|column| column.is_primary_key)
        .map(|column| quote_identifier(&column.name))
        .collect()
}

pub(super) fn default_clause(default_value: &DefaultValueModel) -> Option<String> {
    match default_value {
        DefaultValueModel::NoDefault => None,
        DefaultValueModel::NullDefault => Some("DEFAULT NULL".to_string()),
        DefaultValueModel::Literal { value } => {
            Some(format!("DEFAULT '{}'", escape_sql_string(value)))
        }
        DefaultValueModel::Expression { value } => Some(format!("DEFAULT {value}")),
    }
}

pub(super) fn column_type_clause(column: &DesignerColumnDef) -> String {
    let mut type_clause = column.r#type.clone();
    let has_length = !column.length.is_empty();
    if has_length {
        type_clause = format!("{type_clause}({})", column.length);
    }
    let has_type_modifier = !column.type_modifier.is_empty();
    if has_type_modifier {
        type_clause = format!("{type_clause} {}", column.type_modifier);
    }
    type_clause
}

pub(super) fn nullability_clause(nullable: bool) -> &'static str {
    if nullable {
        return "NULL";
    }
    "NOT NULL"
}

pub(super) fn format_column_definition(
    column: &DesignerColumnDef,
    identifier_name: &str,
) -> String {
    let mut parts = vec![format!(
        "{} {}",
        quote_identifier(identifier_name),
        column_type_clause(column)
    )];
    parts.push(nullability_clause(column.nullable).to_string());

    if let Some(default_clause) = default_clause(&column.default_value) {
        parts.push(default_clause);
    }

    if column.is_auto_increment {
        parts.push("AUTO_INCREMENT".to_string());
    }

    let has_comment = !column.comment.is_empty();
    if has_comment {
        parts.push(format!("COMMENT '{}'", escape_sql_string(&column.comment)));
    }

    parts.join(" ")
}
