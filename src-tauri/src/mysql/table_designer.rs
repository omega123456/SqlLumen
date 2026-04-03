use crate::mysql::schema_queries::safe_identifier;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "tag", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DefaultValueModel {
    NoDefault,
    NullDefault,
    Literal { value: String },
    Expression { value: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesignerColumnDef {
    pub name: String,
    pub r#type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub type_modifier: String,
    pub length: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub is_auto_increment: bool,
    pub default_value: DefaultValueModel,
    pub comment: String,
    pub original_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesignerIndexDef {
    pub name: String,
    pub index_type: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesignerForeignKeyDef {
    pub name: String,
    pub source_column: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub on_delete: String,
    pub on_update: String,
    pub is_composite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesignerTableProperties {
    pub engine: String,
    pub charset: String,
    pub collation: String,
    pub auto_increment: Option<u64>,
    pub row_format: String,
    pub comment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesignerTableSchema {
    pub table_name: String,
    pub columns: Vec<DesignerColumnDef>,
    pub indexes: Vec<DesignerIndexDef>,
    pub foreign_keys: Vec<DesignerForeignKeyDef>,
    pub properties: DesignerTableProperties,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GenerateDdlRequest {
    pub original_schema: Option<DesignerTableSchema>,
    pub current_schema: DesignerTableSchema,
    pub database: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GenerateDdlResponse {
    pub ddl: String,
    pub warnings: Vec<String>,
}

fn validate_identifier(name: &str, label: &str) -> Result<(), String> {
    safe_identifier(name)
        .map(|_| ())
        .map_err(|error| format!("{label}: {error}"))
}

fn validate_optional_identifier(name: &str, label: &str) -> Result<(), String> {
    if identifier_is_blank(name) {
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

pub fn generate_create_table_ddl(schema: &DesignerTableSchema, database: &str) -> String {
    if validate_schema(schema).is_err() {
        return String::new();
    }

    if validate_identifier(database, "Database name").is_err() {
        return String::new();
    }

    if identifier_is_blank(&schema.table_name) {
        return String::new();
    }

    let table_name = quote_identifier(&schema.table_name);
    let database_name = quote_identifier(database);

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

    for index in schema
        .indexes
        .iter()
        .filter(|index| is_generatable_index(index))
    {
        let normalized_type = normalize_index_type(&index.index_type);
        let index_columns = quoted_identifiers(&index.columns);

        let clause = match normalized_type.as_str() {
            "UNIQUE" => Some(format!(
                "  UNIQUE KEY {} ({})",
                quote_identifier(&index.name),
                index_columns.join(", ")
            )),
            "INDEX" => Some(format!(
                "  INDEX {} ({})",
                quote_identifier(&index.name),
                index_columns.join(", ")
            )),
            "FULLTEXT" => Some(format!(
                "  FULLTEXT KEY {} ({})",
                quote_identifier(&index.name),
                index_columns.join(", ")
            )),
            _ => None,
        };

        if let Some(clause) = clause {
            definitions.push(clause);
        }
    }

    for fk in schema
        .foreign_keys
        .iter()
        .filter(|fk| is_generatable_foreign_key(fk))
    {
        definitions.push(format!(
            "  CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({}) ON DELETE {} ON UPDATE {}",
            quote_identifier(&fk.name),
            quote_identifier(&fk.source_column),
            quote_identifier(&fk.referenced_table),
            quote_identifier(&fk.referenced_column),
            fk.on_delete,
            fk.on_update
        ));
    }

    let table_options = build_create_table_options(&schema.properties);

    if table_options.is_empty() {
        format!(
            "CREATE TABLE {}.{} (\n{}\n);",
            database_name,
            table_name,
            definitions.join(",\n")
        )
    } else {
        format!(
            "CREATE TABLE {}.{} (\n{}\n) {};",
            database_name,
            table_name,
            definitions.join(",\n"),
            table_options.join(" ")
        )
    }
}

pub fn generate_alter_table_ddl(
    original: &DesignerTableSchema,
    current: &DesignerTableSchema,
    database: &str,
) -> (String, Vec<String>) {
    if validate_schema(original).is_err() || validate_schema(current).is_err() {
        return (String::new(), vec![]);
    }

    if validate_identifier(database, "Database name").is_err() {
        return (String::new(), vec![]);
    }

    if identifier_is_blank(&current.table_name) {
        return (String::new(), vec![]);
    }

    let mut warnings = collect_rename_warnings(current);

    let original_names: HashSet<&str> = original
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect();
    let current_names: HashSet<&str> = current
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect();
    let original_map: HashMap<&str, &DesignerColumnDef> = original
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect();

    let mut drop_fk_clauses = diff_drop_foreign_keys(original, current);
    let mut drop_index_clauses = diff_drop_indexes(original, current);
    let drop_column_clauses = original
        .columns
        .iter()
        .filter(|column| !current_names.contains(column.name.as_str()))
        .map(|column| format!("DROP COLUMN {}", quote_identifier(&column.name)))
        .collect::<Vec<_>>();

    let modify_column_clauses = current
        .columns
        .iter()
        .filter(|column| column.original_name == column.name)
        .filter_map(|column| {
            original_map
                .get(column.name.as_str())
                .copied()
                .filter(|original_column| column_requires_modify(original_column, column))
                .map(|_| {
                    format!(
                        "MODIFY COLUMN {}",
                        format_column_definition(column, &column.name)
                    )
                })
        })
        .collect::<Vec<_>>();

    let add_column_clauses = current
        .columns
        .iter()
        .enumerate()
        .filter(|(_, column)| !original_names.contains(column.name.as_str()))
        .map(|(index, column)| {
            let position_clause = if index == 0 {
                " FIRST".to_string()
            } else {
                format!(
                    " AFTER {}",
                    quote_identifier(&current.columns[index - 1].name)
                )
            };

            format!(
                "ADD COLUMN {}{}",
                format_column_definition(column, &column.name),
                position_clause
            )
        })
        .collect::<Vec<_>>();

    let mut add_index_clauses = diff_add_indexes(original, current);
    let add_fk_clauses = diff_add_foreign_keys(original, current);
    let table_option_clauses = diff_table_options(&original.properties, &current.properties);

    let mut clauses = Vec::new();
    clauses.append(&mut drop_fk_clauses);
    clauses.append(&mut drop_index_clauses);
    clauses.extend(drop_column_clauses);
    clauses.extend(modify_column_clauses);
    clauses.extend(add_column_clauses);
    clauses.append(&mut add_index_clauses);
    clauses.extend(add_fk_clauses);
    clauses.extend(table_option_clauses);

    if clauses.is_empty() {
        warnings.shrink_to_fit();
        return (String::new(), warnings);
    }

    let ddl = format!(
        "ALTER TABLE {}.{}\n  {};",
        quote_identifier(database),
        quote_identifier(&current.table_name),
        clauses.join(",\n  ")
    );

    (ddl, warnings)
}

pub fn load_columns_query() -> &'static str {
    r#"SELECT 
        COLUMN_NAME,
        COLUMN_TYPE,
        IS_NULLABLE,
        COLUMN_KEY,
        COLUMN_DEFAULT,
        EXTRA,
        COLUMN_COMMENT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION"#
}

pub fn load_table_metadata_query() -> &'static str {
    r#"SELECT 
        ENGINE,
        TABLE_COLLATION,
        AUTO_INCREMENT,
        ROW_FORMAT,
        TABLE_COMMENT
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?"#
}

pub fn load_indexes_query() -> &'static str {
    r#"SELECT
        INDEX_NAME,
        NON_UNIQUE,
        COLUMN_NAME,
        INDEX_TYPE,
        SEQ_IN_INDEX
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY INDEX_NAME, SEQ_IN_INDEX"#
}

pub fn load_foreign_keys_query() -> &'static str {
    r#"SELECT
        kcu.CONSTRAINT_NAME,
        kcu.COLUMN_NAME,
        kcu.REFERENCED_TABLE_NAME,
        kcu.REFERENCED_COLUMN_NAME,
        rc.DELETE_RULE,
        rc.UPDATE_RULE
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
    JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
        ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
    WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ?
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION"#
}

pub fn derive_charset_from_collation(collation: &str) -> String {
    collation.split('_').next().unwrap_or(collation).to_string()
}

fn quote_identifier(name: &str) -> String {
    safe_identifier(name).unwrap_or_else(|error| panic!("Invalid identifier '{name}': {error}"))
}

fn identifier_is_blank(name: &str) -> bool {
    name.trim().is_empty()
}

fn is_generatable_index(index: &DesignerIndexDef) -> bool {
    !identifier_is_blank(&index.name)
        && !index.columns.is_empty()
        && index
            .columns
            .iter()
            .all(|column| !identifier_is_blank(column))
}

fn is_generatable_foreign_key(fk: &DesignerForeignKeyDef) -> bool {
    !fk.is_composite
        && !identifier_is_blank(&fk.name)
        && !identifier_is_blank(&fk.source_column)
        && !identifier_is_blank(&fk.referenced_table)
        && !identifier_is_blank(&fk.referenced_column)
}

fn escape_sql_string(value: &str) -> String {
    value.replace('\'', "''")
}

fn quoted_identifiers(names: &[String]) -> Vec<String> {
    names.iter().map(|name| quote_identifier(name)).collect()
}

fn normalize_index_type(index_type: &str) -> String {
    index_type.trim().to_ascii_uppercase()
}

fn primary_key_columns(columns: &[DesignerColumnDef]) -> Vec<String> {
    columns
        .iter()
        .filter(|column| column.is_primary_key)
        .map(|column| quote_identifier(&column.name))
        .collect()
}

fn default_clause(default_value: &DefaultValueModel) -> Option<String> {
    match default_value {
        DefaultValueModel::NoDefault => None,
        DefaultValueModel::NullDefault => Some("DEFAULT NULL".to_string()),
        DefaultValueModel::Literal { value } => {
            Some(format!("DEFAULT '{}'", escape_sql_string(value)))
        }
        DefaultValueModel::Expression { value } => Some(format!("DEFAULT {value}")),
    }
}

fn format_column_definition(column: &DesignerColumnDef, identifier_name: &str) -> String {
    let base_type_clause = if column.length.is_empty() {
        column.r#type.clone()
    } else {
        format!("{}({})", column.r#type, column.length)
    };
    let type_clause = if column.type_modifier.is_empty() {
        base_type_clause
    } else {
        format!("{} {}", base_type_clause, column.type_modifier)
    };

    let mut parts = vec![format!(
        "{} {}",
        quote_identifier(identifier_name),
        type_clause
    )];
    parts.push(if column.nullable {
        "NULL".to_string()
    } else {
        "NOT NULL".to_string()
    });

    if let Some(default_clause) = default_clause(&column.default_value) {
        parts.push(default_clause);
    }

    if column.is_auto_increment {
        parts.push("AUTO_INCREMENT".to_string());
    }

    if !column.comment.is_empty() {
        parts.push(format!("COMMENT '{}'", escape_sql_string(&column.comment)));
    }

    parts.join(" ")
}

fn build_create_table_options(properties: &DesignerTableProperties) -> Vec<String> {
    let mut options = Vec::new();

    if !properties.engine.is_empty() {
        options.push(format!("ENGINE={}", properties.engine));
    }
    if !properties.charset.is_empty() {
        options.push(format!("DEFAULT CHARSET={}", properties.charset));
    }
    if !properties.collation.is_empty() {
        options.push(format!("COLLATE={}", properties.collation));
    }
    if let Some(auto_increment) = properties.auto_increment {
        options.push(format!("AUTO_INCREMENT={auto_increment}"));
    }
    if !properties.row_format.is_empty() {
        options.push(format!("ROW_FORMAT={}", properties.row_format));
    }
    if !properties.comment.is_empty() {
        options.push(format!(
            "COMMENT='{}'",
            escape_sql_string(&properties.comment)
        ));
    }

    options
}

fn collect_rename_warnings(current: &DesignerTableSchema) -> Vec<String> {
    current
        .columns
        .iter()
        .filter(|column| !column.original_name.is_empty() && column.original_name != column.name)
        .map(|column| {
            format!(
                "Column '{}' was renamed to '{}'. Because MySQL rename-column syntax is not supported in this version, this will be executed as DROP COLUMN + ADD COLUMN. Existing data in this column will be permanently lost.",
                column.original_name, column.name
            )
        })
        .collect()
}

fn column_requires_modify(original: &DesignerColumnDef, current: &DesignerColumnDef) -> bool {
    original.r#type != current.r#type
        || original.type_modifier != current.type_modifier
        || original.length != current.length
        || original.nullable != current.nullable
        || original.default_value != current.default_value
        || original.comment != current.comment
        || original.is_auto_increment != current.is_auto_increment
}

fn primary_key_names(columns: &[DesignerColumnDef]) -> Vec<String> {
    columns
        .iter()
        .filter(|column| column.is_primary_key)
        .map(|column| column.name.clone())
        .collect()
}

fn indexes_equal(left: &DesignerIndexDef, right: &DesignerIndexDef) -> bool {
    normalize_index_type(&left.index_type) == normalize_index_type(&right.index_type)
        && left.columns == right.columns
}

fn foreign_keys_equal(left: &DesignerForeignKeyDef, right: &DesignerForeignKeyDef) -> bool {
    left.source_column == right.source_column
        && left.referenced_table == right.referenced_table
        && left.referenced_column == right.referenced_column
        && left.on_delete == right.on_delete
        && left.on_update == right.on_update
}

fn diff_drop_indexes(original: &DesignerTableSchema, current: &DesignerTableSchema) -> Vec<String> {
    let mut clauses = Vec::new();

    let original_primary = primary_key_names(&original.columns);
    let current_primary = primary_key_names(&current.columns);
    if original_primary != current_primary && !original_primary.is_empty() {
        clauses.push("DROP PRIMARY KEY".to_string());
    }

    let current_indexes = current
        .indexes
        .iter()
        .filter(|index| is_generatable_index(index))
        .filter(|index| normalize_index_type(&index.index_type) != "PRIMARY")
        .map(|index| (index.name.as_str(), index))
        .collect::<HashMap<_, _>>();

    for index in original
        .indexes
        .iter()
        .filter(|index| is_generatable_index(index))
        .filter(|index| normalize_index_type(&index.index_type) != "PRIMARY")
    {
        match current_indexes.get(index.name.as_str()) {
            Some(current_index) if indexes_equal(index, current_index) => {}
            _ => clauses.push(format!("DROP INDEX {}", quote_identifier(&index.name))),
        }
    }

    clauses
}

fn diff_add_indexes(original: &DesignerTableSchema, current: &DesignerTableSchema) -> Vec<String> {
    let mut clauses = Vec::new();

    let original_primary = primary_key_names(&original.columns);
    let current_primary = primary_key_names(&current.columns);
    if original_primary != current_primary && !current_primary.is_empty() {
        clauses.push(format!(
            "ADD PRIMARY KEY ({})",
            quoted_identifiers(&current_primary).join(", ")
        ));
    }

    let original_indexes = original
        .indexes
        .iter()
        .filter(|index| is_generatable_index(index))
        .filter(|index| normalize_index_type(&index.index_type) != "PRIMARY")
        .map(|index| (index.name.as_str(), index))
        .collect::<HashMap<_, _>>();

    for index in current
        .indexes
        .iter()
        .filter(|index| is_generatable_index(index))
        .filter(|index| normalize_index_type(&index.index_type) != "PRIMARY")
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

fn diff_drop_foreign_keys(
    original: &DesignerTableSchema,
    current: &DesignerTableSchema,
) -> Vec<String> {
    let current_foreign_keys = current
        .foreign_keys
        .iter()
        .filter(|fk| is_generatable_foreign_key(fk))
        .map(|fk| (fk.name.as_str(), fk))
        .collect::<HashMap<_, _>>();

    original
        .foreign_keys
        .iter()
        .filter(|fk| is_generatable_foreign_key(fk))
        .filter_map(|fk| match current_foreign_keys.get(fk.name.as_str()) {
            Some(current_fk) if foreign_keys_equal(fk, current_fk) => None,
            _ => Some(format!("DROP FOREIGN KEY {}", quote_identifier(&fk.name))),
        })
        .collect()
}

fn diff_add_foreign_keys(
    original: &DesignerTableSchema,
    current: &DesignerTableSchema,
) -> Vec<String> {
    let original_foreign_keys = original
        .foreign_keys
        .iter()
        .filter(|fk| is_generatable_foreign_key(fk))
        .map(|fk| (fk.name.as_str(), fk))
        .collect::<HashMap<_, _>>();

    current
        .foreign_keys
        .iter()
        .filter(|fk| is_generatable_foreign_key(fk))
        .filter_map(|fk| {
            let should_add = match original_foreign_keys.get(fk.name.as_str()) {
                Some(original_fk) => !foreign_keys_equal(original_fk, fk),
                None => true,
            };

            if should_add {
                Some(format!(
                    "ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({}) ON DELETE {} ON UPDATE {}",
                    quote_identifier(&fk.name),
                    quote_identifier(&fk.source_column),
                    quote_identifier(&fk.referenced_table),
                    quote_identifier(&fk.referenced_column),
                    fk.on_delete,
                    fk.on_update
                ))
            } else {
                None
            }
        })
        .collect()
}

fn diff_table_options(
    original: &DesignerTableProperties,
    current: &DesignerTableProperties,
) -> Vec<String> {
    let mut clauses = Vec::new();

    if original.engine != current.engine && !current.engine.is_empty() {
        clauses.push(format!("ENGINE={}", current.engine));
    }
    if original.charset != current.charset && !current.charset.is_empty() {
        clauses.push(format!("DEFAULT CHARSET={}", current.charset));
    }
    if original.collation != current.collation && !current.collation.is_empty() {
        clauses.push(format!("COLLATE={}", current.collation));
    }
    if original.auto_increment != current.auto_increment {
        if let Some(auto_increment) = current.auto_increment {
            clauses.push(format!("AUTO_INCREMENT={auto_increment}"));
        }
    }
    if original.row_format != current.row_format && !current.row_format.is_empty() {
        clauses.push(format!("ROW_FORMAT={}", current.row_format));
    }
    if original.comment != current.comment {
        clauses.push(format!("COMMENT='{}'", escape_sql_string(&current.comment)));
    }

    clauses
}
