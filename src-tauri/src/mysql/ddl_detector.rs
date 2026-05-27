use sqlparser::ast::{AlterTableOperation, ObjectName, ObjectType, RenameTableNameKind, Statement};
use sqlparser::dialect::MySqlDialect;
use sqlparser::parser::Parser;
use tracing::debug;

pub type AffectedTable = (Option<String>, String);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DdlDetectionResult {
    NoDdl,
    DdlDetected(Vec<AffectedTable>),
    ParseFailed,
}

pub fn detect_ddl_tables(sql: &str) -> DdlDetectionResult {
    if sql.trim().is_empty() {
        return DdlDetectionResult::NoDdl;
    }

    let dialect = MySqlDialect {};
    let statements = match Parser::parse_sql(&dialect, sql) {
        Ok(statements) => statements,
        Err(error) => {
            debug!(?error, "Failed to parse SQL for DDL detection");
            return DdlDetectionResult::ParseFailed;
        }
    };

    let mut affected_tables = Vec::new();

    for statement in &statements {
        collect_statement_tables(statement, &mut affected_tables);
    }

    if affected_tables.is_empty() {
        DdlDetectionResult::NoDdl
    } else {
        debug!(
            ?affected_tables,
            "Detected DDL statements affecting metadata cache"
        );
        DdlDetectionResult::DdlDetected(affected_tables)
    }
}

fn collect_statement_tables(statement: &Statement, affected_tables: &mut Vec<AffectedTable>) {
    match statement {
        Statement::AlterTable {
            name, operations, ..
        } => {
            if operations
                .iter()
                .any(|operation| matches!(operation, AlterTableOperation::RenameTable { .. }))
            {
                affected_tables.extend(extract_rename_targets(name, operations));
                return;
            }

            push_object_name(affected_tables, name);
        }
        Statement::CreateTable(create_table) => {
            push_object_name(affected_tables, &create_table.name);
        }
        Statement::Drop {
            object_type,
            names,
            table,
            ..
        } => match object_type {
            ObjectType::Table => {
                for name in names {
                    push_object_name(affected_tables, name);
                }
            }
            ObjectType::Index => {
                if let Some(table_name) = table {
                    push_object_name(affected_tables, table_name);
                }
            }
            _ => {}
        },
        Statement::CreateIndex(create_index) => {
            push_object_name(affected_tables, &create_index.table_name);
        }
        Statement::RenameTable(rename_table) => {
            for table_name in rename_table {
                push_object_name(affected_tables, &table_name.old_name);
                push_object_name(affected_tables, &table_name.new_name);
            }
        }
        Statement::Truncate { .. } => {}
        _ => {}
    }
}

fn extract_rename_targets(
    name: &ObjectName,
    operations: &[AlterTableOperation],
) -> Vec<AffectedTable> {
    let mut tables = vec![split_object_name(name)];

    for operation in operations {
        if let AlterTableOperation::RenameTable { table_name } = operation {
            match table_name {
                RenameTableNameKind::As(name) | RenameTableNameKind::To(name) => {
                    tables.push(split_object_name(name));
                }
            }
        }
    }

    tables
}

fn push_object_name(affected_tables: &mut Vec<AffectedTable>, name: &ObjectName) {
    affected_tables.push(split_object_name(name));
}

fn split_object_name(name: &ObjectName) -> AffectedTable {
    match &split_name_parts(name)[..] {
        [table] => (None, (*table).to_string()),
        [database, table] => (Some((*database).to_string()), (*table).to_string()),
        parts if !parts.is_empty() => {
            let table = parts[parts.len() - 1].to_string();
            let database = parts[parts.len() - 2].to_string();
            (Some(database), table)
        }
        _ => (None, String::new()),
    }
}

fn split_name_parts(name: &ObjectName) -> Vec<&str> {
    name.0
        .iter()
        .filter_map(|identifier| identifier.as_ident().map(|ident| ident.value.as_str()))
        .collect()
}
