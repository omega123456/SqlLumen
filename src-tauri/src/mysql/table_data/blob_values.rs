use super::*;

pub const BLOB_FETCH_CAP: usize = 10 * 1024 * 1024;

pub const BLOB_ENVELOPE_MARKER: &str = "__sqllumen_blob__";

#[derive(Debug, Clone, PartialEq)]
pub enum BlobBind {
    Bytes(Vec<u8>),
    Empty,
    Null,
}

pub(super) fn is_over_blob_fetch_cap(byte_count: usize) -> bool {
    byte_count > BLOB_FETCH_CAP
}

pub(super) fn is_blob_envelope(object: &serde_json::Map<String, serde_json::Value>) -> bool {
    object.get(BLOB_ENVELOPE_MARKER) == Some(&serde_json::Value::Bool(true))
}

pub fn decode_blob_envelope(value: &serde_json::Value) -> Option<Result<BlobBind, String>> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let obj = value.as_object()?;
    if !is_blob_envelope(obj) {
        return None;
    }

    let kind = match obj.get("kind").and_then(|kind| kind.as_str()) {
        Some(kind) => kind,
        None => {
            return Some(Err(
                "Blob envelope is missing a string `kind` field".to_string()
            ))
        }
    };

    match kind {
        "null" => Some(Ok(BlobBind::Null)),
        "empty" => Some(Ok(BlobBind::Empty)),
        "bytes" => {
            let b64 = match obj.get("base64").and_then(|encoded| encoded.as_str()) {
                Some(encoded) => encoded,
                None => {
                    return Some(Err(
                        "Blob envelope of kind `bytes` is missing the `base64` field".to_string(),
                    ))
                }
            };
            match B64.decode(b64) {
                Ok(bytes) => Some(Ok(BlobBind::Bytes(bytes))),
                Err(error) => Some(Err(format!("Invalid base64 in blob envelope: {error}"))),
            }
        }
        other => Some(Err(format!("Unknown blob envelope kind: {other}"))),
    }
}

pub fn validate_blob_envelopes(values: &HashMap<String, serde_json::Value>) -> Result<(), String> {
    for (col, value) in values {
        if let Some(Err(error)) = decode_blob_envelope(value) {
            return Err(format!("Column `{col}`: {error}"));
        }
    }
    Ok(())
}

#[cfg(not(coverage))]
struct BlobRowLookup<'a> {
    pool: &'a BackgroundPool,
    request: &'a FetchBlobValueRequest,
}

#[cfg(not(coverage))]
struct BlobRowQuery<'a> {
    sql: String,
    failure_label: &'a str,
}

#[cfg(not(coverage))]
impl BlobRowLookup<'_> {
    async fn fetch_first_row(&self, query: BlobRowQuery<'_>) -> Result<DecodedRow, String> {
        use crate::mysql::logged_query::fetch_first_decoded_pooled;

        let primary_key_values: Vec<serde_json::Value> = self
            .request
            .primary_key_pairs
            .iter()
            .map(|(_, value)| value.clone())
            .collect();
        let statement = json_bound_statement(&query.sql, &primary_key_values);
        fetch_first_decoded_pooled(self.pool, statement)
            .await
            .map_err(|error| format!("{} failed: {error}", query.failure_label))?
            .ok_or_else(|| "No row matched the supplied primary key".to_string())
    }
}

#[cfg(not(coverage))]
fn primary_key_where_clause(request: &FetchBlobValueRequest) -> Result<String, String> {
    let where_parts = request
        .primary_key_pairs
        .iter()
        .map(|(primary_key_column, _)| {
            safe_identifier(primary_key_column).map(|safe_key| format!("{safe_key} = ?"))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(where_parts.join(" AND "))
}

#[cfg(not(coverage))]
fn empty_blob_response(byte_length: u64, too_large: bool) -> BlobValueResponse {
    BlobValueResponse {
        base64: None,
        byte_length,
        too_large,
    }
}

#[cfg(not(coverage))]
fn blob_bytes_response(bytes: Option<Vec<u8>>) -> BlobValueResponse {
    let Some(bytes) = bytes else {
        return empty_blob_response(0, false);
    };
    BlobValueResponse {
        base64: Some(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &bytes,
        )),
        byte_length: bytes.len() as u64,
        too_large: false,
    }
}

#[cfg(not(coverage))]
pub async fn fetch_blob_value_impl(
    pool: &BackgroundPool,
    request: &FetchBlobValueRequest,
) -> Result<BlobValueResponse, String> {
    if request.primary_key_pairs.is_empty() {
        return Err("Cannot fetch blob: no primary key values specified".to_string());
    }
    let safe_db = safe_identifier(&request.database)?;
    let safe_table = safe_identifier(&request.table)?;
    let safe_col = safe_identifier(&request.column)?;
    let where_sql = primary_key_where_clause(request)?;
    let lookup = BlobRowLookup { pool, request };

    let length_query = BlobRowQuery {
        sql: format!(
            "SELECT OCTET_LENGTH({safe_col}) AS `len` FROM {safe_db}.{safe_table} WHERE {where_sql} LIMIT 1"
        ),
        failure_label: "Blob length query",
    };
    let len_row = lookup.fetch_first_row(length_query).await?;
    let stored_len = len_row
        .optional_signed("len")
        .map_err(|error| format!("Failed to read blob length: {error}"))?;
    let Some(stored_len) = stored_len else {
        return Ok(empty_blob_response(0, false));
    };
    let byte_length = u64::try_from(stored_len).unwrap_or(0);
    if is_over_blob_fetch_cap(byte_length as usize) {
        return Ok(empty_blob_response(byte_length, true));
    }

    let data_query = BlobRowQuery {
        sql: format!(
            "SELECT {safe_col} AS `val` FROM {safe_db}.{safe_table} WHERE {where_sql} LIMIT 1"
        ),
        failure_label: "Blob fetch query",
    };
    let data_row = lookup.fetch_first_row(data_query).await?;
    let bytes = data_row
        .into_optional_bytes("val")
        .map_err(|error| format!("Failed to read blob bytes: {error}"))?;
    Ok(blob_bytes_response(bytes))
}

#[cfg(coverage)]
pub async fn fetch_blob_value_impl(
    _pool: &BackgroundPool,
    _request: &FetchBlobValueRequest,
) -> Result<BlobValueResponse, String> {
    Ok(BlobValueResponse {
        base64: None,
        byte_length: 0,
        too_large: false,
    })
}

pub fn read_file_bytes_impl(path: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let file_path = std::path::Path::new(path);
    let metadata = std::fs::metadata(file_path).map_err(|error| {
        tracing::error!(path = %path, error = %error, "Failed to read file metadata for blob read");
        format!("Failed to read file metadata: {error}")
    })?;
    if is_over_blob_fetch_cap(metadata.len() as usize) {
        return Err("File exceeds the 10 MB limit".to_string());
    }
    let bytes = std::fs::read(file_path).map_err(|error| {
        tracing::error!(path = %path, error = %error, "Failed to read file bytes for blob read");
        format!("Failed to read file: {error}")
    })?;
    if is_over_blob_fetch_cap(bytes.len()) {
        return Err("File exceeds the 10 MB limit".to_string());
    }
    Ok(B64.encode(&bytes))
}

fn ensure_parent_directory(file_path: &std::path::Path) -> Result<(), String> {
    let Some(parent) = file_path.parent() else {
        return Ok(());
    };
    if crate::is_empty_path(parent) {
        return Ok(());
    }
    std::fs::create_dir_all(parent).map_err(|error| {
        tracing::error!(path = %file_path.display(), error = %error, "Failed to create parent dirs for blob write");
        format!("Failed to create directories: {error}")
    })
}

pub fn write_file_bytes_impl(path: &str, base64: &str) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let bytes = B64.decode(base64).map_err(|error| {
        tracing::error!(path = %path, error = %error, "Invalid base64 supplied to blob write");
        format!("Invalid base64 content: {error}")
    })?;

    let file_path = std::path::Path::new(path);
    ensure_parent_directory(file_path)?;
    std::fs::write(file_path, &bytes).map_err(|error| {
        tracing::error!(path = %path, error = %error, "Failed to write blob bytes");
        format!("Failed to write file: {error}")
    })
}
