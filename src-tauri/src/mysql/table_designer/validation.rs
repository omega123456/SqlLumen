use super::*;

pub(super) fn validate_identifier(name: &str, label: &str) -> Result<(), String> {
    safe_identifier(name)
        .map(|_| ())
        .map_err(|error| format!("{label}: {error}"))
}

pub(super) fn validate_optional_identifier(name: &str, label: &str) -> Result<(), String> {
    if is_blank_identifier(name) {
        return Ok(());
    }

    validate_identifier(name, label)
}

pub fn validate_schema(schema: &DesignerTableSchema) -> Result<(), String> {
    validate_identifier(&schema.table_name, "Table name")?;

    let mut seen = HashSet::new();

    for column in &schema.columns {
        validate_identifier(&column.name, "Column name")?;

        if !seen.insert(column.name.clone()) {
            return Err(format!("Duplicate column name: '{}'", column.name));
        }
    }

    for index in &schema.indexes {
        validate_optional_identifier(&index.name, "Index name")?;
        for column in &index.columns {
            validate_optional_identifier(column, "Index column")?;
        }
    }

    for foreign_key in &schema.foreign_keys {
        validate_optional_identifier(&foreign_key.name, "Foreign key name")?;
        validate_optional_identifier(&foreign_key.source_column, "Foreign key source column")?;
        validate_optional_identifier(
            &foreign_key.referenced_database,
            "Foreign key referenced database",
        )?;
        validate_optional_identifier(
            &foreign_key.referenced_table,
            "Foreign key referenced table",
        )?;
        validate_optional_identifier(
            &foreign_key.referenced_column,
            "Foreign key referenced column",
        )?;
    }

    Ok(())
}
