use sha2::{Digest, Sha256};
use std::collections::HashMap;

use super::super::types::{FkEdge, FkInput, TableDdlInput};
use super::ddl_parsing::{
    extract_table_comment, parse_columns_from_ddl, parse_fks_from_ddl, parse_pk_from_ddl,
    parse_unique_indexes_from_ddl,
};
use super::ddl_text::{compact_ddl_for_llm, normalize_table_ddl};

const UNASSIGNED_CONNECTION_ID: &str = "";
const DEFAULT_ON_DELETE_RULE: &str = "RESTRICT";

pub struct TableEmbeddingDescription<'a> {
    pub db_name: &'a str,
    pub table_name: &'a str,
    pub table_comment: Option<&'a str>,
    pub columns: &'a [(String, String, Option<String>)],
    pub primary_key_columns: &'a [String],
    pub unique_indexes: &'a [String],
    pub foreign_keys: &'a [FkEdge],
    pub row_count: Option<i64>,
}

fn foreign_key_description(foreign_key: &FkEdge) -> String {
    let on_delete_clause = foreign_key
        .on_delete
        .as_deref()
        .filter(|rule| *rule != DEFAULT_ON_DELETE_RULE)
        .map(|rule| format!(" [ON DELETE {rule}]"))
        .unwrap_or_default();
    format!(
        "  - {} references `{}`.`{}`({}){on_delete_clause}",
        foreign_key.src_col, foreign_key.dst_db, foreign_key.dst_tbl, foreign_key.dst_col
    )
}

fn column_description(column: &(String, String, Option<String>)) -> String {
    let (name, column_type, comment) = column;
    match comment {
        Some(comment_text) => format!("{name} ({column_type}, \"{comment_text}\")"),
        None => format!("{name} ({column_type})"),
    }
}

fn table_identity_line(description: &TableEmbeddingDescription<'_>) -> String {
    let table_name = description.table_name;
    let default_comment = format!("stores {table_name} data");
    let comment_description = description
        .table_comment
        .filter(|comment| !comment.is_empty())
        .unwrap_or(&default_comment);
    format!(
        "Table `{}`.`{table_name}` — {comment_description}.",
        description.db_name
    )
}

pub fn generate_text_for_embedding(description: &TableEmbeddingDescription<'_>) -> String {
    let mut parts = vec![table_identity_line(description)];

    if !description.columns.is_empty() {
        let column_descriptions: Vec<String> =
            description.columns.iter().map(column_description).collect();
        parts.push(format!("Columns: {}.", column_descriptions.join(", ")));
    }

    if !description.primary_key_columns.is_empty() {
        parts.push(format!(
            "Primary key: {}.",
            description.primary_key_columns.join(", ")
        ));
    }

    if !description.unique_indexes.is_empty() {
        parts.push(format!(
            "Unique indexes: {}.",
            description.unique_indexes.join(", ")
        ));
    }

    if !description.foreign_keys.is_empty() {
        parts.push("Foreign keys:".to_string());
        parts.extend(description.foreign_keys.iter().map(foreign_key_description));
    }

    if let Some(count) = description.row_count {
        parts.push(format!("Approximate rows: {count}."));
    }

    parts.join("\n")
}

pub fn generate_fk_chunk_text(foreign_key: &FkInput) -> String {
    let cols = foreign_key.columns.join(", ");
    let ref_cols = foreign_key.ref_columns.join(", ");
    format!(
        "Table {db}.{table} has a foreign key ({cols}) that references {ref_db}.{ref_table}({ref_cols}) ON DELETE {on_delete} ON UPDATE {on_update}",
        db = foreign_key.db_name,
        table = foreign_key.table_name,
        ref_db = foreign_key.ref_db_name,
        ref_table = foreign_key.ref_table_name,
        on_delete = foreign_key.on_delete,
        on_update = foreign_key.on_update,
    )
}

pub fn compute_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn split_identifier_segments(name: &str) -> Vec<String> {
    name.split('_')
        .filter(|part| !part.is_empty())
        .flat_map(split_camel_case)
        .collect()
}

fn split_camel_case(part: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut current = String::new();
    for character in part.chars() {
        let starts_new_segment = character.is_uppercase() && !current.is_empty();
        if starts_new_segment {
            segments.push(current.to_ascii_lowercase());
            current = String::new();
        }
        current.push(character);
    }
    if !current.is_empty() {
        segments.push(current.to_ascii_lowercase());
    }
    segments
}

pub fn table_chunk_key(db_name: &str, table_name: &str) -> String {
    format!("table:{db_name}.{table_name}")
}

pub fn fk_chunk_key(db_name: &str, table_name: &str, constraint_name: &str) -> String {
    format!("fk:{db_name}.{table_name}:{constraint_name}")
}

#[derive(Debug, Clone)]
pub struct GeneratedTableChunk {
    pub chunk_key: String,
    pub ddl_text: String,
    pub ddl_hash: String,
    pub db_name: String,
    pub table_name: String,
    pub text_for_embedding: Option<String>,
    pub row_count_approx: Option<i64>,
}

pub type GeneratedFkChunk = (String, String, String, FkInput);

#[derive(Debug, Clone)]
pub struct GeneratedChunks {
    pub table_chunks: Vec<GeneratedTableChunk>,
    pub foreign_key_chunks: Vec<GeneratedFkChunk>,
}

pub fn generate_all_chunks(ddl_inputs: &[TableDdlInput]) -> GeneratedChunks {
    generate_all_chunks_with_row_counts(ddl_inputs, &HashMap::new())
}

pub(crate) fn foreign_key_edges(connection_id: &str, foreign_key: &FkInput) -> Vec<FkEdge> {
    foreign_key
        .columns
        .iter()
        .zip(foreign_key.ref_columns.iter())
        .map(|(src_col, dst_col)| FkEdge {
            connection_id: connection_id.to_string(),
            src_db: foreign_key.db_name.clone(),
            src_tbl: foreign_key.table_name.clone(),
            src_col: src_col.clone(),
            dst_db: foreign_key.ref_db_name.clone(),
            dst_tbl: foreign_key.ref_table_name.clone(),
            dst_col: dst_col.clone(),
            constraint_name: foreign_key.constraint_name.clone(),
            on_delete: Some(foreign_key.on_delete.clone()),
            on_update: Some(foreign_key.on_update.clone()),
        })
        .collect()
}

struct TableChunkSource<'a> {
    input: &'a TableDdlInput,
    foreign_keys: &'a [FkInput],
    row_count: Option<i64>,
}

fn embedding_text_for_table(source: &TableChunkSource<'_>) -> String {
    let raw_ddl = &source.input.create_table_sql;
    let columns = parse_columns_from_ddl(raw_ddl);
    let primary_key_columns = parse_pk_from_ddl(raw_ddl);
    let unique_indexes = parse_unique_indexes_from_ddl(raw_ddl);
    let table_comment = extract_table_comment(raw_ddl);
    let foreign_key_edges: Vec<FkEdge> = source
        .foreign_keys
        .iter()
        .flat_map(|foreign_key| foreign_key_edges(UNASSIGNED_CONNECTION_ID, foreign_key))
        .collect();
    generate_text_for_embedding(&TableEmbeddingDescription {
        db_name: &source.input.db_name,
        table_name: &source.input.table_name,
        table_comment: table_comment.as_deref(),
        columns: &columns,
        primary_key_columns: &primary_key_columns,
        unique_indexes: &unique_indexes,
        foreign_keys: &foreign_key_edges,
        row_count: source.row_count,
    })
}

fn generate_table_chunk(source: TableChunkSource<'_>) -> GeneratedTableChunk {
    let input = source.input;
    let text_for_embedding = embedding_text_for_table(&source);
    let compacted = compact_ddl_for_llm(&input.create_table_sql);
    let mut compacted = normalize_table_ddl(&input.db_name, &input.table_name, &compacted);
    let hash = compute_hash(&compacted);
    if let Some(count) = source.row_count {
        compacted = format!("{compacted}\n-- approximate rows: {count}");
    }
    GeneratedTableChunk {
        chunk_key: table_chunk_key(&input.db_name, &input.table_name),
        ddl_text: compacted,
        ddl_hash: hash,
        db_name: input.db_name.clone(),
        table_name: input.table_name.clone(),
        text_for_embedding: Some(text_for_embedding),
        row_count_approx: source.row_count,
    }
}

fn generate_fk_chunk(foreign_key: FkInput) -> GeneratedFkChunk {
    let foreign_key_text = generate_fk_chunk_text(&foreign_key);
    let foreign_key_hash = compute_hash(&foreign_key_text);
    let foreign_key_key = fk_chunk_key(
        &foreign_key.db_name,
        &foreign_key.table_name,
        &foreign_key.constraint_name,
    );
    (
        foreign_key_key,
        foreign_key_text,
        foreign_key_hash,
        foreign_key,
    )
}

pub fn generate_all_chunks_with_row_counts(
    ddl_inputs: &[TableDdlInput],
    row_counts: &HashMap<(String, String), i64>,
) -> GeneratedChunks {
    let mut table_chunks = Vec::new();
    let mut foreign_key_chunks = Vec::new();
    for input in ddl_inputs {
        let foreign_keys =
            parse_fks_from_ddl(&input.db_name, &input.table_name, &input.create_table_sql);
        let row_count = row_counts
            .get(&(input.db_name.clone(), input.table_name.clone()))
            .copied();
        table_chunks.push(generate_table_chunk(TableChunkSource {
            input,
            foreign_keys: &foreign_keys,
            row_count,
        }));
        foreign_key_chunks.extend(foreign_keys.into_iter().map(generate_fk_chunk));
    }
    GeneratedChunks {
        table_chunks,
        foreign_key_chunks,
    }
}
