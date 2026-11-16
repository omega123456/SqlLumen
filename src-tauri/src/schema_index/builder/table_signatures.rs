use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::Instant;

use crate::mysql::cell_values::DecodedRow;
use crate::mysql::logged_query::{fetch_decoded_pooled, LoggedStatement};
use crate::mysql::pool::BackgroundPool;

use super::mysql_fetch::{decode_number, decode_string, is_system_schema, TableKey};

const SYSTEM_SCHEMA_FILTER: &str =
    "TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys')";
const FIRST_SIGNATURE_FIELD_COLUMN: usize = 2;

#[derive(Clone, Copy)]
enum SignatureFieldKind {
    Text,
    Number,
}

enum SignatureField {
    Text(String),
    Number(i64),
}

struct SignatureQuery {
    sql: String,
    tag: &'static [u8],
    fields: &'static [SignatureFieldKind],
    failure_label: &'static str,
    completion_message: &'static str,
}

const COLUMN_SIGNATURE_FIELDS: [SignatureFieldKind; 10] = [
    SignatureFieldKind::Number,
    SignatureFieldKind::Text,
    SignatureFieldKind::Text,
    SignatureFieldKind::Text,
    SignatureFieldKind::Text,
    SignatureFieldKind::Text,
    SignatureFieldKind::Text,
    SignatureFieldKind::Text,
    SignatureFieldKind::Text,
    SignatureFieldKind::Text,
];

const INDEX_SIGNATURE_FIELDS: [SignatureFieldKind; 5] = [
    SignatureFieldKind::Text,
    SignatureFieldKind::Number,
    SignatureFieldKind::Text,
    SignatureFieldKind::Number,
    SignatureFieldKind::Text,
];

const FOREIGN_KEY_SIGNATURE_FIELDS: [SignatureFieldKind; 8] = [
    SignatureFieldKind::Text,
    SignatureFieldKind::Number,
    SignatureFieldKind::Text,
    SignatureFieldKind::Text,
    SignatureFieldKind::Text,
    SignatureFieldKind::Text,
    SignatureFieldKind::Text,
    SignatureFieldKind::Text,
];

fn column_signature_query() -> SignatureQuery {
    SignatureQuery {
        sql: format!(
            "SELECT TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, \
                    IS_NULLABLE, IFNULL(COLUMN_DEFAULT, ''), EXTRA, COLUMN_KEY, \
                    IFNULL(COLUMN_COMMENT, ''), IFNULL(CHARACTER_SET_NAME, ''), IFNULL(COLLATION_NAME, '') \
             FROM information_schema.COLUMNS \
             WHERE {SYSTEM_SCHEMA_FILTER} \
             ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
        ),
        tag: b"C|",
        fields: &COLUMN_SIGNATURE_FIELDS,
        failure_label: "column",
        completion_message: "schema_index signatures: COLUMNS bulk query complete",
    }
}

fn index_signature_query() -> SignatureQuery {
    SignatureQuery {
        sql: format!(
            "SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, \
                    NON_UNIQUE, IFNULL(INDEX_TYPE, '') \
             FROM information_schema.STATISTICS \
             WHERE {SYSTEM_SCHEMA_FILTER} \
             ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX"
        ),
        tag: b"I|",
        fields: &INDEX_SIGNATURE_FIELDS,
        failure_label: "index",
        completion_message: "schema_index signatures: STATISTICS bulk query complete",
    }
}

fn foreign_key_signature_query() -> SignatureQuery {
    SignatureQuery {
        sql: format!(
            "SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION, \
                    kcu.COLUMN_NAME, IFNULL(kcu.REFERENCED_TABLE_SCHEMA, ''), \
                    IFNULL(kcu.REFERENCED_TABLE_NAME, ''), IFNULL(kcu.REFERENCED_COLUMN_NAME, ''), \
                    IFNULL(rc.UPDATE_RULE, ''), IFNULL(rc.DELETE_RULE, '') \
             FROM information_schema.KEY_COLUMN_USAGE kcu \
             LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc \
                  ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA \
                 AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME \
                 AND rc.TABLE_NAME = kcu.TABLE_NAME \
             WHERE kcu.REFERENCED_TABLE_NAME IS NOT NULL \
               AND kcu.{SYSTEM_SCHEMA_FILTER} \
             ORDER BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION"
        ),
        tag: b"F|",
        fields: &FOREIGN_KEY_SIGNATURE_FIELDS,
        failure_label: "FK",
        completion_message: "schema_index signatures: KEY_COLUMN_USAGE bulk query complete",
    }
}

fn signature_fields(row: &DecodedRow, kinds: &[SignatureFieldKind]) -> Vec<SignatureField> {
    kinds
        .iter()
        .enumerate()
        .map(|(offset, kind)| {
            let column = FIRST_SIGNATURE_FIELD_COLUMN + offset;
            match kind {
                SignatureFieldKind::Text => {
                    SignatureField::Text(decode_string(row, column).unwrap_or_default())
                }
                SignatureFieldKind::Number => SignatureField::Number(decode_number(row, column)),
            }
        })
        .collect()
}

fn update_signature(hasher: &mut Sha256, tag: &[u8], fields: &[SignatureField]) {
    hasher.update(tag);
    for (index, field) in fields.iter().enumerate() {
        if index > 0 {
            hasher.update(b"|");
        }
        match field {
            SignatureField::Text(text) => hasher.update(text.as_bytes()),
            SignatureField::Number(number) => hasher.update(number.to_le_bytes()),
        }
    }
    hasher.update(b"\x1e");
}

fn record_signature_rows(
    hashers: &mut HashMap<TableKey, Sha256>,
    rows: &[DecodedRow],
    query: &SignatureQuery,
) -> Result<(), String> {
    for row in rows {
        let schema = decode_string(row, 0).map_err(|error| format!("schema: {error}"))?;
        if is_system_schema(&schema) {
            continue;
        }
        let table = decode_string(row, 1).map_err(|error| format!("table: {error}"))?;
        let hasher = hashers.entry((schema, table)).or_default();
        update_signature(hasher, query.tag, &signature_fields(row, query.fields));
    }
    Ok(())
}

async fn hash_signature_query(
    pool: &BackgroundPool,
    hashers: &mut HashMap<TableKey, Sha256>,
    query: SignatureQuery,
) -> Result<(), String> {
    let started = Instant::now();
    let rows = fetch_decoded_pooled(pool, LoggedStatement::text(&query.sql))
        .await
        .map_err(|error| {
            format!(
                "Failed to fetch {} signatures: {error}",
                query.failure_label
            )
        })?;
    record_signature_rows(hashers, &rows, &query)?;
    tracing::debug!(
        rows = rows.len(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        "{}",
        query.completion_message
    );
    Ok(())
}

pub(super) async fn fetch_all_table_signatures(
    pool: &BackgroundPool,
) -> Result<HashMap<TableKey, String>, String> {
    let mut hashers: HashMap<TableKey, Sha256> = HashMap::new();
    hash_signature_query(pool, &mut hashers, column_signature_query()).await?;
    hash_signature_query(pool, &mut hashers, index_signature_query()).await?;
    hash_signature_query(pool, &mut hashers, foreign_key_signature_query()).await?;
    let out = hashers
        .into_iter()
        .map(|(key, hasher)| (key, hex::encode(hasher.finalize())))
        .collect();
    Ok(out)
}
